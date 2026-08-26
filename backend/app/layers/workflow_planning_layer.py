"""
WorkflowPlanningLayer — 5-Phase SSE generator for workflow planning.

Extracted from workflow_planner.py (370 lines).  Parallelism is applied
*internally* within the layer:

- Phase 1: Resource fetching (tools, agents, workflows) via asyncio.gather
- Phase 2: Tool synthesis via bounded asyncio.gather + Semaphore(3)
- Phase 3: Agent creation via bounded asyncio.gather + Semaphore(5)
- Phase 4 & 5: Sequential (DAG build requires agent IDs from Phase 3)
"""

import asyncio
import json
import logging
import os
import time
from functools import partial
from typing import AsyncGenerator

import httpx

from app.core.context import PipelineContext
from app.core.layer import Layer, NextFn

logger = logging.getLogger(__name__)

# Concurrency limits to avoid overwhelming external services.
_SYNTHESIS_CONCURRENCY = 3
_AGENT_CREATION_CONCURRENCY = 5

# How much of an agent's instructions the planner sees.
#
# The analysis prompt only has to answer "does an agent for this already
# exist" — it never executes the instructions, so the operating detail is
# dead weight. Sending them in full put ~16k tokens of agent definitions into
# a single request (one agent alone carries 7.6k characters), which is what
# pushed the call past the client's read timeout and hung the planner.
_INSTRUCTION_BUDGET = 400

# Planning calls are long by nature — a large model producing a whole DAG as
# JSON. Given an explicit budget rather than inheriting the client default, so
# the limit is visible where it matters and can be raised without touching
# every other Mistral call in the process.
_PLANNER_TIMEOUT_MS = 180_000


def _summarise_instructions(text: str) -> str:
    """Trim an agent's instructions to what the planner needs to recognise it.

    Cuts on a sentence boundary when there is one near the budget, so the
    summary reads as a complete thought rather than a severed clause.
    """
    text = (text or "").strip()
    if len(text) <= _INSTRUCTION_BUDGET:
        return text

    window = text[:_INSTRUCTION_BUDGET]
    cut = max(window.rfind(". "), window.rfind("\n"))
    if cut > _INSTRUCTION_BUDGET // 2:
        return window[: cut + 1].strip()
    return window.rstrip() + "…"


class PlannerTimeout(Exception):
    """A planning call exceeded its budget. Carries a message worth showing."""


async def _complete(client, *, model: str, system: str, user: str, phase: str):
    """One planning completion, off the event loop and with a real timeout.

    The Mistral client here is synchronous. Called inline from this coroutine it
    blocked the whole API for the duration of the request — during a two-minute
    planning call the backend served nothing at all, which made a slow plan look
    like a dead server.
    """
    started = time.monotonic()
    logger.info("Planner %s: requesting (%d chars in)", phase, len(user))

    try:
        result = await asyncio.to_thread(
            client.chat.complete,
            model=model,
            messages=[
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ],
            temperature=0.1,
            response_format={"type": "json_object"},
            timeout_ms=_PLANNER_TIMEOUT_MS,
        )
    except Exception as e:
        elapsed = time.monotonic() - started
        text = str(e).lower()
        if "timed out" in text or "timeout" in text:
            raise PlannerTimeout(
                f"The {phase} step timed out after {elapsed:.0f}s. The goal may be too "
                f"broad — try narrowing it, or reduce how many agents are in scope."
            ) from e
        raise

    logger.info("Planner %s: completed in %.1fs", phase, time.monotonic() - started)
    return result


def _safe_parse(raw: str, fallback):
    """Parse JSON, stripping markdown fences if present."""
    text = raw.strip()
    if text.startswith("```"):
        lines = text.split("\n")
        lines = [l for l in lines if not l.strip().startswith("```")]
        text = "\n".join(lines).strip()
    try:
        return json.loads(text)
    except Exception as e:
        logger.error("JSON parse failed: %s — raw: %s", e, text[:200])
        return fallback


class WorkflowPlanningLayer(Layer):
    """Full 5-phase workflow planner wrapped as a pipeline layer.

    This layer emits many SSE events during execution and is designed to
    be used in a *workflow-specific* pipeline (not the chat pipeline).
    """

    name = "workflow_planning"

    async def process(self, ctx: PipelineContext, next_fn: NextFn) -> PipelineContext:
        from app.config import settings, map_model_name
        from app.prompts import (
            WORKFLOW_ANALYSIS_SYSTEM_PROMPT,
            WORKFLOW_ANALYSIS_USER_PROMPT,
            WORKFLOW_DAG_SYSTEM_PROMPT,
            WORKFLOW_DAG_USER_PROMPT,
        )
        from app.services.tool_resolver import tool_resolver
        from app.services.tool_registry import refresh_dynamic_tools, get_tools
        from app.services.workflow_engine.engine import save_workflow
        from app.services.workflow_engine.models import WorkflowDefinition
        from app.services import agent_service, connector_service
        from app.ontology import autotag as ontology_autotag
        from app.ontology import matcher as ontology_matcher
        from app.ontology.vocab import AgentTier, Predicate, SubjectType

        goal = ctx.query
        client = ctx.client

        try:
            # ── Phase 1: Analyse goal (parallel resource fetching) ────────
            ctx.emit("status", "Analysing your workflow goal…")

            async def _fetch_workflows():
                try:
                    resp = httpx.get(
                        "https://api.mistral.ai/v1/workflows",
                        headers={"Authorization": f"Bearer {settings.MISTRAL_API_KEY}"},
                        timeout=5.0,
                    )
                    if resp.status_code == 200:
                        return [w.get("name") for w in resp.json().get("workflows", [])]
                except Exception:
                    pass
                return []

            # Resolved before the fetch so the connector inventory can be
            # narrowed in the same round trip as everything else.
            scope = ontology_matcher.scope_for_goal(goal)

            # ── PARALLEL: fetch tools, agents, workflows and connectors ──
            from app.rag import inventory as library_inventory

            (
                existing_tools,
                agents_resp,
                existing_workflows,
                (connector_descriptions, connector_ids),
                (library_descriptions, library_ids),
            ) = await asyncio.gather(
                tool_resolver.list_tools(),
                agent_service.list_agents(client, page=0, page_size=100),
                _fetch_workflows(),
                connector_service.describe_for_prompt(scope),
                library_inventory.describe_for_prompt(scope),
            )

            existing_tool_names = [t.get("name", "") for t in existing_tools]
            all_agents = [
                {
                    "id": a["id"],
                    "name": a["name"],
                    "tier": a.get("tier", "foundation"),
                    "description": a.get("description") or "",
                    "instructions": _summarise_instructions(a.get("instructions", "")),
                    "connectors": [
                        ref["connector_id"]
                        for ref in (a.get("connectors") or [])
                        if ref.get("connector_id")
                    ],
                }
                for a in agents_resp.get("items", [])
            ]

            # ── Ontology scoping ─────────────────────────────────────────
            # Passing the whole inventory costs tokens, but the real damage is
            # precision: a mortgage goal should never have to rule out a
            # Medical Information Extractor. Narrow to the matched domain
            # subtree, always keeping foundation agents — they are
            # domain-agnostic by definition and reused in every workflow.
            foundation_ids = {
                a["id"] for a in all_agents
                if a.get("tier") == AgentTier.FOUNDATION.value
            }
            in_scope = ontology_matcher.filter_subjects(
                SubjectType.AGENT.value,
                [a["id"] for a in all_agents],
                scope,
                Predicate.SERVES_DOMAIN.value,
                always_include=foundation_ids,
            )

            scoped_agents = [a for a in all_agents if a["id"] in in_scope]
            if scope["scoped"] and len(scoped_agents) < len(all_agents):
                ctx.emit(
                    "status",
                    f"Scoped to {ontology_matcher.describe_scope(scope)} — "
                    f"{len(scoped_agents)} of {len(all_agents)} agents in play",
                )
                logger.info(
                    "Planner scope %s: %d/%d agents",
                    scope["domains"], len(scoped_agents), len(all_agents),
                )

            foundation_agents = [a for a in scoped_agents if a.get("tier") == AgentTier.FOUNDATION.value]
            domain_agents = [a for a in scoped_agents if a.get("tier") == AgentTier.DOMAIN.value]
            usecase_agents = [a for a in scoped_agents if a.get("tier") == AgentTier.USE_CASE.value]

            analysis_prompt = WORKFLOW_ANALYSIS_USER_PROMPT.format(
                existing_foundation_agents=json.dumps(foundation_agents, indent=2),
                existing_domain_agents=json.dumps(domain_agents, indent=2),
                existing_usecase_agents=json.dumps(usecase_agents, indent=2),
                existing_tools=json.dumps(existing_tool_names, indent=2),
                existing_connectors=connector_descriptions,
                existing_libraries=library_descriptions,
                existing_workflows=json.dumps(existing_workflows, indent=2),
                goal=goal,
            )
            logger.info(
                "Planner analysis prompt: %d chars (~%d tokens)",
                len(analysis_prompt), len(analysis_prompt) // 4,
            )

            analysis_result = await _complete(
                client,
                model=settings.MISTRAL_ORCHESTRATOR_MODEL,
                system=WORKFLOW_ANALYSIS_SYSTEM_PROMPT,
                user=analysis_prompt,
                phase="analysis",
            )
            raw = analysis_result.choices[0].message.content
            requirements = _safe_parse(raw, {"tools_needed": [], "agents_needed": [], "workflow_description": goal})

            ctx.emit("requirements", json.dumps({
                "tools_needed": [t["name"] for t in requirements.get("tools_needed", [])],
                "agents_needed": [a.get("agent_name", a.get("name", "")) for a in requirements.get("agents_needed", [])],
                "description": requirements.get("workflow_description", goal),
            }))

            # ── Phase 2: Synthesise missing tools (bounded parallel) ──────
            tools_needed = requirements.get("tools_needed", [])
            tools_to_synthesize = []
            for tool_spec in tools_needed:
                tool_name = tool_spec.get("name", "unknown")
                is_reused = tool_spec.get("is_reused", False)
                if is_reused or tool_name in existing_tool_names:
                    ctx.emit("tool_exists", json.dumps({"tool_name": tool_name, "status": "exists"}))
                else:
                    tools_to_synthesize.append(tool_spec)

            if tools_to_synthesize:
                ctx.emit("status", f"Synthesising {len(tools_to_synthesize)} tool(s)…")

                semaphore = asyncio.Semaphore(_SYNTHESIS_CONCURRENCY)

                async def _synth_one(tool_spec: dict) -> tuple[str, dict]:
                    tool_name = tool_spec.get("name", "unknown")
                    async with semaphore:
                        synth_result = await tool_resolver.trigger_synthesis(
                            name=tool_name,
                            description=tool_spec.get("description", f"Tool to {tool_name}"),
                            parameters=tool_spec.get("parameters", {"type": "object", "properties": {}}),
                            required=tool_spec.get("required", []),
                            api_details=tool_spec.get("api_details", "No external API. This is a pure computation using standard library."),
                            expected_output_shape=tool_spec.get("expected_output_shape", "A dictionary containing the result."),
                        )
                        return tool_name, synth_result

                # ── PARALLEL: synthesize all missing tools concurrently ──
                synth_results = await asyncio.gather(
                    *[_synth_one(ts) for ts in tools_to_synthesize],
                    return_exceptions=True,
                )

                for result in synth_results:
                    if isinstance(result, Exception):
                        logger.error("Tool synthesis task failed: %s", result)
                        ctx.emit("fatal_error", json.dumps({"error": f"Tool synthesis failed: {result}"}))
                        return ctx
                    tool_name, synth_result = result
                    status = synth_result.get("status", "unknown")
                    if status in ("failed", "error"):
                        error_msg = synth_result.get("message", f"Tool synthesis failed for {tool_name}")
                        ctx.emit("fatal_error", json.dumps({"error": error_msg}))
                        return ctx
                    ctx.emit("tool_new", json.dumps({"tool_name": tool_name, "status": status}))

                # Single refresh after all tools are synthesized
                await refresh_dynamic_tools()

            # ── Phase 3: Create agents (bounded parallel) ─────────────────
            agents_needed = requirements.get("agents_needed", [])
            agents_to_create = []
            reused_agents: list[dict] = []

            for agent_spec in agents_needed:
                agent_name = agent_spec.get("agent_name", agent_spec.get("name", "WorkflowAgent"))
                is_reused = agent_spec.get("is_reused", False)
                existing_id = agent_spec.get("existing_id")

                existing_agent = None
                if is_reused and existing_id and existing_id != "null":
                    existing_agent = next((a for a in all_agents if a["id"] == existing_id), None)
                if not existing_agent:
                    existing_agent = next((a for a in all_agents if a["name"] == agent_name), None)

                if existing_agent:
                    ctx.emit("status", f"Reusing existing agent: {agent_name}")
                    agent_info = {
                        "agent_id": existing_agent["id"],
                        "agent_name": existing_agent["name"],
                        "model": map_model_name(agent_spec.get("model", "mistral-large-latest")),
                        "tier": agent_spec.get("tier", "foundation"),
                        "tools": agent_spec.get("tools", []),
                        # What the agent already has attached in Mistral, not
                        # what this plan asked for — reuse never re-attaches.
                        "connectors": existing_agent.get("connectors", []),
                        "description": agent_spec.get("description", ""),
                        "output_contract": agent_spec.get("output_contract", ""),
                        "output_contract_detail": agent_spec.get("output_contract_detail", ""),
                    }
                    reused_agents.append(agent_info)
                    ctx.emit("agent_exists", json.dumps(agent_info))
                else:
                    agents_to_create.append(agent_spec)

            created_agents = list(reused_agents)

            if agents_to_create:
                ctx.emit("status", f"Creating {len(agents_to_create)} agent(s)…")

                agent_semaphore = asyncio.Semaphore(_AGENT_CREATION_CONCURRENCY)

                async def _create_one(agent_spec: dict) -> dict:
                    agent_name = agent_spec.get("agent_name", agent_spec.get("name", "WorkflowAgent"))
                    async with agent_semaphore:
                        tool_keys = agent_spec.get("tools", [])
                        # Ignore any connector id the model did not get from the
                        # inventory — an unknown id fails agent creation outright.
                        agent_connectors = [
                            {"connector_id": cid}
                            for cid in (agent_spec.get("connectors") or [])
                            if cid in connector_ids
                        ]
                        from app.rag.rag_tools import with_rag_tools

                        agent_libraries = [
                            lid for lid in (agent_spec.get("document_library_ids") or [])
                            if lid in library_ids
                        ]
                        tool_definitions = get_tools(
                            with_rag_tools(
                                tool_keys, agent_libraries, agent_spec.get("domains")
                            ),
                            document_library_ids=agent_libraries or None,
                            connectors=agent_connectors,
                        )

                        instructions = agent_spec.get(
                            "agent_instructions",
                            agent_spec.get("instructions", f"You are {agent_name}, a specialist agent."),
                        )

                        create_kwargs = {
                            "model": map_model_name(agent_spec.get("model", "mistral-large-latest")),
                            "name": agent_name,
                            "instructions": instructions,
                            "description": agent_spec.get("description", f"Workflow agent: {agent_name}"),
                            "metadata": {
                                "workflow_goal": goal[:200],
                                "source": "workflow_planner",
                                "tier": agent_spec.get("tier", "foundation"),
                            },
                        }
                        if tool_definitions:
                            create_kwargs["tools"] = tool_definitions

                        comp_args = {}
                        temp = agent_spec.get("temperature")
                        if temp is not None:
                            comp_args["temperature"] = temp
                        if comp_args:
                            create_kwargs["completion_args"] = comp_args

                        agent_obj = await asyncio.to_thread(
                            partial(client.beta.agents.create, **create_kwargs)
                        )

                        # The tier already went into Mistral's metadata above,
                        # but metadata is invisible to scoping and validation —
                        # only the concept store drives those. Without this the
                        # planner's own agents were unclassified the moment they
                        # were made, and stayed that way until someone ran the
                        # backfill script.
                        await asyncio.to_thread(
                            partial(
                                ontology_autotag.annotate_agent,
                                agent_obj.id,
                                name=agent_name,
                                description=agent_spec.get("description", ""),
                                instructions=instructions,
                                tier=agent_spec.get("tier"),
                                goal=goal,
                            )
                        )

                        return {
                            "agent_id": agent_obj.id,
                            "agent_name": agent_name,
                            "model": map_model_name(agent_spec.get("model", "mistral-large-latest")),
                            "tier": agent_spec.get("tier", "foundation"),
                            "tools": tool_keys,
                            "connectors": [c["connector_id"] for c in agent_connectors],
                            "description": agent_spec.get("description", ""),
                            "output_contract": agent_spec.get("output_contract", ""),
                            "output_contract_detail": agent_spec.get("output_contract_detail", ""),
                        }

                # ── PARALLEL: create all agents concurrently ──
                creation_results = await asyncio.gather(
                    *[_create_one(a) for a in agents_to_create],
                    return_exceptions=True,
                )

                for result in creation_results:
                    if isinstance(result, Exception):
                        logger.error("Agent creation task failed: %s", result)
                        ctx.emit("fatal_error", json.dumps({"error": f"Agent creation failed: {result}"}))
                        return ctx
                    created_agents.append(result)
                    ctx.emit("agent_new", json.dumps(result))

            # ── Phase 4: Build DAG ────────────────────────────────────────
            ctx.emit("status", "Building workflow DAG…")

            dag_result = await _complete(
                client,
                model=settings.MISTRAL_ORCHESTRATOR_MODEL,
                system=WORKFLOW_DAG_SYSTEM_PROMPT,
                user=WORKFLOW_DAG_USER_PROMPT.format(
                    agents_json=json.dumps(created_agents, indent=2),
                    existing_connectors=connector_descriptions,
                    goal=goal,
                    requirements_json=json.dumps(requirements, indent=2),
                ),
                phase="DAG build",
            )
            raw_dag = dag_result.choices[0].message.content
            dag_dict = _safe_parse(raw_dag, None)

            if not dag_dict:
                raise ValueError("LLM returned invalid DAG JSON")

            # ── Phase 5: Save & compile & register ────────────────────────
            ctx.emit("status", "Saving workflow…")

            workflow_def = WorkflowDefinition(**dag_dict)
            workflow_name = save_workflow(workflow_def)

            ctx.emit("workflow_ready", json.dumps({
                "workflow_name": workflow_name,
                "description": workflow_def.description or goal,
                "step_count": len(workflow_def.steps),
                "entry_step": workflow_def.entry_step,
                "agents": [a["agent_name"] for a in created_agents],
                "dag": dag_dict,
            }))

            # Phase 5b: Compile to Mistral SDK Python
            ctx.emit("status", "Compiling workflow to Mistral SDK…")
            try:
                from app.services.mistral_workflows_compiler import compile_workflow_to_python

                workflows_dir = os.path.abspath(
                    os.path.join(os.getcwd(), settings.MISTRAL_WORKFLOWS_DIR)
                )
                os.makedirs(workflows_dir, exist_ok=True)

                python_code = compile_workflow_to_python(workflow_def)
                file_name = f"workflow_{workflow_name}.py"
                file_path = os.path.join(workflows_dir, file_name)

                await asyncio.to_thread(lambda: open(file_path, "w", encoding="utf-8").write(python_code))

                logger.info("Compiled workflow '%s' → %s", workflow_name, file_path)
                ctx.emit("compiled", json.dumps({
                    "workflow_name": workflow_name,
                    "file_path": file_path,
                }))
            except Exception as e:
                logger.error("Workflow compilation failed: %s", e)
                ctx.emit("compiled", json.dumps({"workflow_name": workflow_name, "error": str(e)}))

            # Phase 5c: Register on Mistral server
            ctx.emit("status", "Registering workflow on Mistral server…")
            mistral_workflow_id = None
            worker_deployment = os.environ.get("DEPLOYMENT_NAME", "default")
            try:
                def _register_on_mistral():
                    headers = {
                        "Authorization": f"Bearer {settings.MISTRAL_API_KEY}",
                        "Content-Type": "application/json",
                    }

                    # Step 1: Check if already registered
                    existing_id = None
                    try:
                        r = httpx.get(
                            "https://api.mistral.ai/v1/workflows",
                            headers={"Authorization": f"Bearer {settings.MISTRAL_API_KEY}"},
                            timeout=8.0,
                        )
                        if r.status_code == 200:
                            for wf in r.json().get("workflows", []):
                                if wf.get("name") == workflow_name:
                                    existing_id = wf.get("id")
                                    break
                    except Exception as e:
                        logger.warning("Failed to list existing workflows: %s", e)

                    # Step 2: Register with worker_deployment so the Mistral
                    # server routes execution tasks to our worker's queue.
                    reg_body = {
                        "name": workflow_name,
                        "worker_deployment": worker_deployment,
                        "worker_identifier": worker_deployment,
                    }
                    if workflow_def.description:
                        reg_body["description"] = workflow_def.description

                    if existing_id:
                        # Try PUT, then PATCH, then DELETE+POST
                        resp = None
                        for method, url in [
                            ("PUT",   f"/v1/workflows/{existing_id}"),
                            ("PATCH", f"/v1/workflows/{existing_id}"),
                        ]:
                            try:
                                fn = httpx.put if method == "PUT" else httpx.patch
                                resp = fn(
                                    f"https://api.mistral.ai{url}",
                                    headers=headers,
                                    json=reg_body,
                                    timeout=15.0,
                                )
                                if resp.status_code in (200, 201, 204):
                                    logger.info("%s /v1/workflows/%s → %d", method, existing_id, resp.status_code)
                                    break
                                logger.warning("%s returned %d: %s", method, resp.status_code, resp.text[:100])
                                resp = None
                            except Exception as e:
                                logger.warning("%s failed: %s", method, e)
                                resp = None

                        if resp and resp.status_code in (200, 201, 204):
                            return existing_id
                        # Last resort: delete and recreate
                        try:
                            httpx.delete(
                                f"https://api.mistral.ai/v1/workflows/{existing_id}",
                                headers={"Authorization": f"Bearer {settings.MISTRAL_API_KEY}"},
                                timeout=15.0,
                            )
                        except Exception:
                            pass
                        resp = httpx.post(
                            "https://api.mistral.ai/v1/workflows",
                            headers=headers,
                            json=reg_body,
                            timeout=15.0,
                        )
                        if resp.status_code in (200, 201):
                            return resp.json().get("id")
                        return None
                    else:
                        # New workflow — POST to create
                        resp = httpx.post(
                            "https://api.mistral.ai/v1/workflows",
                            headers=headers,
                            json=reg_body,
                            timeout=15.0,
                        )
                        if resp.status_code in (200, 201):
                            return resp.json().get("id")
                        logger.warning(
                            "POST /v1/workflows returned %d: %s",
                            resp.status_code, resp.text[:200],
                        )
                        return None

                mistral_workflow_id = await asyncio.to_thread(_register_on_mistral)

                if mistral_workflow_id:
                    workflow_def.is_deployed = True
                    workflow_def.id = mistral_workflow_id
                    # Baseline for change tracking: a planner-authored workflow
                    # that is live must compare as clean until someone edits it
                    # in the visual builder.
                    workflow_def.published_hash = workflow_def.semantic_hash()
                    save_workflow(workflow_def)
                    logger.info(
                        "Workflow '%s' registered on Mistral (id=%s, worker_deployment='%s')",
                        workflow_name, mistral_workflow_id, worker_deployment,
                    )
                    ctx.emit("registered", json.dumps({
                        "workflow_name": workflow_name,
                        "mistral_workflow_id": mistral_workflow_id,
                        "worker_deployment": worker_deployment,
                    }))
                else:
                    logger.warning(
                        "Could not register workflow '%s' on Mistral server. "
                        "It is saved locally and will run via the local DAG engine.",
                        workflow_name,
                    )
                    ctx.emit("registered", json.dumps({
                        "workflow_name": workflow_name,
                        "error": "Server registration failed. Workflow saved locally — it will run via the local DAG engine.",
                    }))
            except Exception as e:
                logger.error("Workflow registration failed: %s", e)
                ctx.emit("fatal_error", json.dumps({"error": f"Registration failed: {e}"}))
                return ctx

            # Final done
            ctx.emit("done", json.dumps({
                "workflow_name": workflow_name,
                "mistral_workflow_id": mistral_workflow_id,
            }))

        except PlannerTimeout as e:
            # Already phrased for a human and tells them what to do next.
            logger.error("Workflow planning timed out: %s", e)
            ctx.emit("error", str(e))

        except Exception as e:
            logger.error("Workflow planning failed: %s", e, exc_info=True)
            # A bare exception string is often unrecognisable out of context
            # ("The read operation timed out"), so name the stage it came from.
            ctx.emit("error", f"{type(e).__name__} during workflow planning: {e}")

        return await next_fn(ctx)
