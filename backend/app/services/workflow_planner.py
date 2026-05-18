"""
Workflow Planner Service — 5-Phase SSE generator.

Phase 1 — Analyse goal   → extract tools + agents needed
Phase 2 — Synthesise     → trigger Docker Tool Service for missing tools
Phase 3 — Create agents  → create Mistral agents with required tools
Phase 4 — Build DAG      → LLM assembles WorkflowDefinition JSON
Phase 5 — Save & emit    → persist workflow, emit workflow_ready + done
"""

import asyncio
import json
import logging
from typing import AsyncGenerator

import httpx
from mistralai.client import Mistral
from app.config import settings
from app.prompts import WORKFLOW_ANALYSIS_PROMPT, WORKFLOW_DAG_PROMPT

logger = logging.getLogger(__name__)


# ── SSE helper (mirrors orchestrator_service) ─────────────────────────────

def _sse(data, event: str = "message") -> str:
    payload = json.dumps(data) if not isinstance(data, str) else data
    if isinstance(payload, str):
        payload = payload.replace("\n", "\ndata: ")
    return f"event: {event}\ndata: {payload}\n\n"


# ── Main SSE Generator ─────────────────────────────────────────────────────

async def plan_workflow_stream(
    client: Mistral,
    goal: str,
) -> AsyncGenerator[str, None]:
    """
    5-phase async generator that streams SSE events for workflow planning.
    Mirrors orchestrate_stream() in orchestrator_service.py.
    """
    from app.services.tool_resolver import tool_resolver
    from app.services.tool_registry import refresh_dynamic_tools
    from app.services.workflow_engine.engine import save_workflow
    from app.services.workflow_engine.models import WorkflowDefinition

    try:
        # ── Phase 1: Analyse goal ─────────────────────────────────────────
        yield _sse("Analysing your workflow goal…", "status")

        # Fetch existing tools
        existing_tools = await tool_resolver.list_tools()
        existing_tool_names = [t.get("name", "") for t in existing_tools]

        # Fetch existing agents
        from app.services import agent_service
        agents_resp = await agent_service.list_agents(client, page=0, page_size=100)
        existing_agents = [{"id": a["id"], "name": a["name"], "instructions": a.get("instructions", "")} for a in agents_resp.get("items", [])]
        
        # Fetch existing workflows
        import httpx
        try:
            wf_resp = httpx.get("https://api.mistral.ai/v1/workflows", headers={"Authorization": f"Bearer {settings.MISTRAL_API_KEY}"}, timeout=5.0)
            existing_workflows = [w.get("name") for w in wf_resp.json().get("workflows", [])] if wf_resp.status_code == 200 else []
        except Exception:
            existing_workflows = []

        analysis_result = client.chat.complete(
            model=settings.MISTRAL_ORCHESTRATOR_MODEL,
            messages=[
                {
                    "role": "system",
                    "content": WORKFLOW_ANALYSIS_PROMPT.format(
                        existing_tools=json.dumps(existing_tool_names),
                        existing_agents=json.dumps(existing_agents),
                        existing_workflows=json.dumps(existing_workflows)
                    ),
                },
                {"role": "user", "content": f"Goal: {goal}"},
            ],
            temperature=0.1,
            response_format={"type": "json_object"},
        )
        raw = analysis_result.choices[0].message.content
        requirements = _safe_parse(raw, {"tools_needed": [], "agents_needed": [], "workflow_description": goal})

        yield _sse(json.dumps({
            "tools_needed": [t["name"] for t in requirements.get("tools_needed", [])],
            "agents_needed": [a.get("agent_name", a.get("name", "")) for a in requirements.get("agents_needed", [])],
            "description": requirements.get("workflow_description", goal),
        }), "requirements")

        # ── Phase 2: Synthesise missing tools ─────────────────────────────
        tools_needed = requirements.get("tools_needed", [])
        for tool_spec in tools_needed:
            tool_name = tool_spec.get("name", "unknown")
            is_reused = tool_spec.get("is_reused", False)

            # Skip if flagged as reused OR already exists in registry
            if is_reused or tool_name in existing_tool_names:
                yield _sse(json.dumps({"tool_name": tool_name, "status": "exists"}), "tool_exists")
                continue

            yield _sse(f"Synthesising tool: {tool_name}…", "status")
            try:
                synth_result = await tool_resolver.trigger_synthesis(
                    name=tool_name,
                    description=tool_spec.get("description", f"Tool to {tool_name}"),
                    parameters=tool_spec.get("parameters", {"type": "object", "properties": {}}),
                    required=tool_spec.get("required", []),
                    api_details=tool_spec.get("api_details", "No external API. This is a pure computation using standard library."),
                    expected_output_shape=tool_spec.get("expected_output_shape", "A dictionary containing the result.")
                )
                status = synth_result.get("status", "unknown")
                if status in ("failed", "error"):
                    error_msg = synth_result.get("message", f"Tool synthesis failed for {tool_name}")
                    yield _sse(json.dumps({"error": error_msg}), "fatal_error")
                    return
                yield _sse(json.dumps({"tool_name": tool_name, "status": status}), "tool_new")

                # Refresh tool cache so agents can use the new tool
                await refresh_dynamic_tools()
            except Exception as e:
                logger.error("Tool synthesis failed for %s: %s", tool_name, e)
                yield _sse(json.dumps({"error": f"Tool synthesis failed for {tool_name}: {e}"}), "fatal_error")
                return

        # ── Phase 3: Create agents ────────────────────────────────────────
        agents_needed = requirements.get("agents_needed", [])
        created_agents: list[dict] = []

        for agent_spec in agents_needed:
            # v2.0 uses agent_name/agent_instructions; fall back to v1 name/instructions
            agent_name = agent_spec.get("agent_name", agent_spec.get("name", "WorkflowAgent"))
            is_reused = agent_spec.get("is_reused", False)
            existing_id = agent_spec.get("existing_id")

            # ── Try to find existing agent: by explicit ID, then by name match ──
            existing_agent = None
            if is_reused and existing_id and existing_id != "null":
                existing_agent = next((a for a in existing_agents if a["id"] == existing_id), None)
            if not existing_agent:
                # Fallback: match by exact name
                existing_agent = next((a for a in existing_agents if a["name"] == agent_name), None)

            if existing_agent:
                yield _sse(f"Reusing existing agent: {agent_name}", "status")
                agent_info = {
                    "agent_id": existing_agent["id"],
                    "agent_name": existing_agent["name"],
                    "model": agent_spec.get("model", "mistral-large-latest"),
                    "tools": agent_spec.get("tools", []),
                    "description": agent_spec.get("description", ""),
                    "output_contract": agent_spec.get("output_contract", ""),
                    "output_contract_detail": agent_spec.get("output_contract_detail", ""),
                }
                created_agents.append(agent_info)
                yield _sse(json.dumps(agent_info), "agent_exists")
                continue

            yield _sse(f"Creating agent: {agent_name}…", "status")
            try:
                from app.services.tool_registry import get_tools
                tool_keys = agent_spec.get("tools", [])
                tool_definitions = get_tools(tool_keys)

                # v2.0 uses agent_instructions; fall back to v1 instructions
                instructions = agent_spec.get(
                    "agent_instructions",
                    agent_spec.get("instructions", f"You are {agent_name}, a specialist agent."),
                )

                create_kwargs: dict = {
                    "model": agent_spec.get("model", "mistral-large-latest"),
                    "name": agent_name,
                    "instructions": instructions,
                    "description": agent_spec.get("description", f"Workflow agent: {agent_name}"),
                    "metadata": {"workflow_goal": goal[:200], "source": "workflow_planner"},
                }
                if tool_definitions:
                    create_kwargs["tools"] = tool_definitions

                comp_args = {}
                temp = agent_spec.get("temperature")
                if temp is not None:
                    comp_args["temperature"] = temp
                if comp_args:
                    create_kwargs["completion_args"] = comp_args

                agent_obj = client.beta.agents.create(**create_kwargs)
                agent_id = agent_obj.id

                agent_info = {
                    "agent_id": agent_id,
                    "agent_name": agent_name,
                    "model": agent_spec.get("model", "mistral-large-latest"),
                    "tools": tool_keys,
                    "description": agent_spec.get("description", ""),
                    "output_contract": agent_spec.get("output_contract", ""),
                    "output_contract_detail": agent_spec.get("output_contract_detail", ""),
                }
                created_agents.append(agent_info)

                yield _sse(json.dumps(agent_info), "agent_new")

            except Exception as e:
                logger.error("Agent creation failed for %s: %s", agent_name, e)
                yield _sse(json.dumps({"error": f"Agent creation failed for {agent_name}: {e}"}), "fatal_error")
                return

        # ── Phase 4: Build DAG ────────────────────────────────────────────
        yield _sse("Building workflow DAG…", "status")

        dag_result = client.chat.complete(
            model=settings.MISTRAL_ORCHESTRATOR_MODEL,
            messages=[
                {
                    "role": "system",
                    "content": WORKFLOW_DAG_PROMPT.format(
                        agents_json=json.dumps(created_agents, indent=2),
                        goal=goal,
                        requirements_json=json.dumps(requirements, indent=2),
                    ),
                },
                {"role": "user", "content": "Build the WorkflowDefinition JSON now."},
            ],
            temperature=0.1,
            response_format={"type": "json_object"},
        )
        raw_dag = dag_result.choices[0].message.content
        dag_dict = _safe_parse(raw_dag, None)

        if not dag_dict:
            raise ValueError("LLM returned invalid DAG JSON")

        # ── Phase 5: Save & compile & register & le Chat ──────────────────
        yield _sse("Saving workflow…", "status")

        workflow_def = WorkflowDefinition(**dag_dict)
        workflow_name = save_workflow(workflow_def)

        yield _sse(json.dumps({
            "workflow_name": workflow_name,
            "description": workflow_def.description or goal,
            "step_count": len(workflow_def.steps),
            "entry_step": workflow_def.entry_step,
            "agents": [a["agent_name"] for a in created_agents],
            "dag": dag_dict,
        }), "workflow_ready")

        # ── Phase 5b: Compile to Mistral Workflows SDK Python ────────────
        yield _sse("Compiling workflow to Mistral SDK…", "status")
        try:
            import os
            from app.services.mistral_workflows_compiler import compile_workflow_to_python

            workflows_dir = os.path.abspath(
                os.path.join(os.getcwd(), settings.MISTRAL_WORKFLOWS_DIR)
            )
            os.makedirs(workflows_dir, exist_ok=True)

            python_code = compile_workflow_to_python(workflow_def)
            file_name = f"workflow_{workflow_name}.py"
            file_path = os.path.join(workflows_dir, file_name)

            # Use asyncio.to_thread so the write doesn't block the event loop
            import asyncio as _asyncio

            def _write_file():
                with open(file_path, "w", encoding="utf-8") as f:
                    f.write(python_code)

            await _asyncio.to_thread(_write_file)

            logger.info("Compiled workflow '%s' → %s", workflow_name, file_path)
            yield _sse(json.dumps({
                "workflow_name": workflow_name,
                "file_path": file_path,
            }), "compiled")

        except Exception as e:
            logger.error("Workflow compilation failed: %s", e)
            yield _sse(json.dumps({"workflow_name": workflow_name, "error": str(e)}), "compiled")

        # ── Phase 5c: Register on Mistral Workflows server ────────────────
        yield _sse("Checking Mistral server registration…", "status")
        mistral_workflow_id = None
        try:
            def _check_registration():
                try:
                    r = httpx.get(
                        "https://api.mistral.ai/v1/workflows",
                        headers={"Authorization": f"Bearer {settings.MISTRAL_API_KEY}"},
                        timeout=5.0,
                    )
                    if r.status_code == 200:
                        for wf in r.json().get("workflows", []):
                            if wf.get("name") == workflow_name:
                                return wf.get("id")
                except Exception:
                    pass
                return None

            mistral_workflow_id = await asyncio.to_thread(_check_registration)

            if mistral_workflow_id:
                workflow_def.is_deployed = True
                workflow_def.id = mistral_workflow_id
                save_workflow(workflow_def)
                logger.info("Workflow '%s' confirmed on Mistral (id=%s)", workflow_name, mistral_workflow_id)
                yield _sse(json.dumps({
                    "workflow_name": workflow_name,
                    "mistral_workflow_id": mistral_workflow_id,
                }), "registered")
            else:
                # Normal when Temporal worker is not running — not an error.
                yield _sse(json.dumps({
                    "workflow_name": workflow_name,
                    "error": "Workflow compiled and saved locally. It will auto-register when the Mistral worker connects.",
                }), "registered")

        except Exception as e:
            logger.error("Workflow registration check failed: %s", e)
            yield _sse(json.dumps({"error": f"Registration check failed: {e}"}), "fatal_error")
            return

        # ── Final done ────────────────────────────────────────────────────
        yield _sse(json.dumps({
            "workflow_name": workflow_name,
            "mistral_workflow_id": mistral_workflow_id,
        }), "done")

    except Exception as e:
        logger.error("Workflow planning failed: %s", e)
        yield _sse(str(e), "error")


def _safe_parse(raw: str, fallback) -> dict | None:
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
