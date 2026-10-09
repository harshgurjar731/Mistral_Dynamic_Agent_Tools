"""
AgentProvisioningLayer — Creates the designed agents on Mistral.

No LLM call: every configuration was decided by :class:`AgentDesignLayer`. This
layer creates them, annotates them against the ontology, and publishes the flat
agent records the topology and data-flow layers bind steps to.

Reused agents pass through here too, so that ``provisioned_agents`` is the
single list of everything the workflow can bind to, regardless of whether it
was created just now or years ago.
"""

import asyncio
import json
import logging
from functools import partial

from app.core.context import PipelineContext
from app.layers.workflow.base import WorkflowStepLayer

from app.layers.workflow import plan_control

logger = logging.getLogger(__name__)


async def _provision_library(cap, ctx) -> str | None:
    """Create the empty library this agent was designed around, if it asked.

    Same reasoning as the agent pipeline's LibraryProvisioningLayer: a step
    wired to a library that does not exist is more useful than one silently
    left without the documents its instructions assume.
    """
    from app.services import library_service

    request = getattr(cap.spec, "requested_library", None) or {}
    name = str(request.get("name") or "").strip()
    if not name:
        return None
    try:
        library = await library_service.create_library(
            name=name, description=str(request.get("description") or ""),
        )
    except Exception as e:
        logger.error("Could not create library '%s' for step '%s': %s", name, cap.id, e)
        ctx.emit("library_provisioned", json.dumps(
            {"created": False, "name": name, "capability": cap.id, "error": str(e)}
        ))
        return None

    library_id = library.get("id")
    if library_id:
        logger.info("Created library '%s' (%s) for step '%s'", name, library_id, cap.id)
        ctx.emit("library_provisioned", json.dumps({
            "created": True, "library_id": library_id, "name": name,
            "capability": cap.id, "empty": True,
        }))
    return library_id


#: Agent creation is a fast API call, so this is higher than the synthesis and
#: design bounds — it exists to be polite to the API, not to pace a queue.
_CREATION_CONCURRENCY = 5


class AgentProvisioningLayer(WorkflowStepLayer):
    """Create designed agents; collect reused ones into the same record list."""

    name = "agent_provisioning"
    label = "Provision the agents"
    detail = "Creates the designed agents and collects the reused ones."

    async def process(self, ctx: PipelineContext, next):
        from app.config import map_model_name
        from app.ontology import autotag as ontology_autotag
        from app.rag.rag_tools import with_rag_tools
        from app.services.agent_service import build_guardrails
        from app.services.tool_registry import get_tools

        spec = ctx.workflow_spec
        contracts = ctx.metadata.get("output_contracts") or {}
        tool_rationale = ctx.metadata.get("tool_rationale") or {}
        agent_caps = [c for c in spec.capabilities if c.kind == "agent"]

        # ── Reused agents ────────────────────────────────────────────────
        by_agent_id = {a["id"]: a for a in spec.inventory.get("all_agents", [])}
        provisioned: list[dict] = []

        for cap in agent_caps:
            if not cap.reuse_agent_id:
                continue
            existing = by_agent_id.get(cap.reuse_agent_id)
            if not existing:
                continue
            record = {
                "capability_id": cap.id,
                "agent_id": existing["id"],
                "agent_name": existing["name"],
                "model": "",
                "tier": existing.get("tier", "foundation"),
                "tools": [],
                "why_agent": cap.mode_rationale,
                # What the agent already has attached in Mistral, not what this
                # plan asked for — reuse never re-attaches.
                "connectors": existing.get("connectors", []),
                "description": existing.get("description", ""),
                "output_contract": contracts.get(cap.id, {}).get("output_contract", ""),
                "output_contract_detail": contracts.get(cap.id, {}).get(
                    "output_contract_detail", ""
                ),
                "reused": True,
            }
            provisioned.append(record)
            ctx.emit("agent_exists", json.dumps(record))

        # ── New agents ───────────────────────────────────────────────────
        to_create = [c for c in agent_caps if not c.reuse_agent_id and c.spec]
        if to_create:
            ctx.emit("status", f"Creating {len(to_create)} agent(s)…")
            semaphore = asyncio.Semaphore(_CREATION_CONCURRENCY)
            # Libraries made for a capability, kept across retries so a retried
            # agent is not given a second, duplicate library.
            libraries: dict[str, str | None] = {}

            async def _create(cap):
                agent_spec = cap.spec
                # Created before to_config so the new id is in the attachment
                # list this agent is built with.
                if cap.id not in libraries:
                    libraries[cap.id] = await _provision_library(cap, ctx)
                    if libraries[cap.id]:
                        requested = getattr(agent_spec, "requested_library", None) or {}
                        plan_control.record_created(ctx, "library", libraries[cap.id],
                                                    str(requested.get("name") or ""))
                        agent_spec.document_library_ids = list(
                            agent_spec.document_library_ids or []
                        ) + [libraries[cap.id]]
                config = agent_spec.to_config()

                # The same creation gate the chat pipeline uses, in pipeline
                # mode — see app.rules.apply.
                from app.rules import apply as rules_apply

                prepared = rules_apply.prepare_agent(
                    model=config["model"],
                    instructions=config["agent_instructions"],
                    tool_keys=config["tools"],
                    connector_ids=config["connectors"],
                    guardrails=[config["guardrails"]] if config.get("guardrails") else [],
                    selection=config.get("rules") or [],
                    mode="pipeline",
                )
                config["model"] = prepared.model
                config["tools"] = prepared.tool_keys
                config["connectors"] = prepared.connector_ids
                config["guardrails"] = prepared.guardrails or None

                async with semaphore:
                    tool_definitions = get_tools(
                        with_rag_tools(
                            config["tools"],
                            config["document_library_ids"],
                            config["knowledge_graph"],
                        ),
                        document_library_ids=config["document_library_ids"] or None,
                        connectors=[
                            {"connector_id": cid} for cid in config["connectors"]
                        ],
                    )

                    create_kwargs = {
                        "model": map_model_name(config["model"]),
                        "name": config["agent_name"],
                        "instructions": config["agent_instructions"],
                        "description": config["description"],
                        "metadata": {
                            "workflow_goal": spec.goal[:200],
                            "source": "workflow_planner",
                            "tier": config["tier"],
                        },
                    }
                    if tool_definitions:
                        create_kwargs["tools"] = tool_definitions
                    if config["temperature"] is not None:
                        create_kwargs["completion_args"] = {
                            "temperature": config["temperature"]
                        }

                    # The platform's moderation guardrail, built by the same
                    # helper the agents API uses. Never written into the
                    # instructions — it is enforced outside the model.
                    if config.get("guardrails"):
                        guardrails = build_guardrails(config["guardrails"])
                        if guardrails:
                            create_kwargs["guardrails"] = guardrails

                    agent_obj = await asyncio.to_thread(
                        partial(ctx.client.beta.agents.create, **create_kwargs)
                    )

                    try:
                        # The tier already went into Mistral's metadata above, but
                        # metadata is invisible to scoping and validation — only the
                        # concept store drives those. Without this the planner's own
                        # agents were unclassified the moment they were made.
                        await asyncio.to_thread(
                            partial(
                                ontology_autotag.annotate_agent,
                                agent_obj.id,
                                name=config["agent_name"],
                                description=config["description"],
                                instructions=config["agent_instructions"],
                                tier=config["tier"],
                                goal=spec.goal,
                            )
                        )
                        rule_summary = rules_apply.finish_agent(
                            agent_obj.id, prepared, config.get("rules") or [], default_source="ai"
                        )
                    except Exception:
                        # Half-made: remove it, so a retry does not leave a
                        # duplicate behind.
                        try:
                            await asyncio.to_thread(ctx.client.beta.agents.delete,
                                                    agent_id=agent_obj.id)
                        except Exception as e:  # noqa: BLE001
                            logger.warning("Could not remove half-made agent %s: %s",
                                           agent_obj.id, e)
                        raise
                    agent_spec.agent_id = agent_obj.id
                    return {
                        "rules_applied": rule_summary,
                        "capability_id": cap.id,
                        "agent_id": agent_obj.id,
                        "agent_name": config["agent_name"],
                        "model": map_model_name(config["model"]),
                        "tier": config["tier"],
                        "tools": config["tools"],
                        # Explanations for the tools that survived the rules
                        # gate — a tool the gate removed is not attached.
                        "tool_rationale": [
                            t for t in tool_rationale.get(cap.id, [])
                            if t.get("tool") in config["tools"]
                        ],
                        "why_agent": cap.mode_rationale,
                        "connectors": config["connectors"],
                        "description": config["description"],
                        "output_contract": contracts.get(cap.id, {}).get(
                            "output_contract", ""
                        ),
                        "output_contract_detail": contracts.get(cap.id, {}).get(
                            "output_contract_detail", ""
                        ),
                        "guardrails": (
                            agent_spec.guardrails.describe()
                            if agent_spec.guardrails else None
                        ),
                        "guardrails_applied": bool(config.get("guardrails")),
                        "document_library_ids": config["document_library_ids"],
                        "reused": False,
                    }

            # Every failed agent is tried once more automatically; after that
            # the user decides (see plan_control).
            pending, attempts, auto_retried = list(to_create), 0, False
            while pending:
                results = await asyncio.gather(
                    *[_create(c) for c in pending], return_exceptions=True
                )
                attempts += 1
                failures = []
                for cap, item in zip(pending, results):
                    if isinstance(item, Exception):
                        logger.error("Agent creation for '%s' failed: %s", cap.id, item)
                        failures.append((cap, item))
                        continue
                    plan_control.record_created(ctx, "agent", item["agent_id"], item["agent_name"])
                    provisioned.append(item)
                    ctx.emit("agent_new", json.dumps(item))
                pending = [cap for cap, _ in failures]
                if not pending:
                    break
                if not auto_retried:
                    auto_retried = True
                    ctx.emit("status", f"Retrying {len(pending)} agent(s) that could not be created…")
                    continue

                rows = plan_control.failure_rows([
                    {"id": cap.id, "name": _agent_name(cap), "step": cap.name,
                     "error": f"{type(err).__name__}: {err}"}
                    for cap, err in failures])
                choice = await plan_control.ask_build_failed(ctx, "agent", rows, attempts=attempts)
                if choice == "retry":
                    ctx.emit("status", f"Retrying {len(pending)} agent(s) at your request…")
                    continue
                if choice == "rollback":
                    await plan_control.roll_back_plan(ctx, "agents could not be created")
                    return await next(ctx)
                # Manual: finish without them. Their steps stay unbound, and
                # validation reports each one until an agent is chosen.
                issues = ctx.metadata.setdefault("build_issues", [])
                for row in rows:
                    issues.append({
                        "severity": "error", "code": "agent.unbuilt", "step_id": row["id"],
                        "field": "agent_id",
                        "message": (f"No agent could be created for '{row['step']}': "
                                    f"{row['error'][:300]}. Choose or create an agent for "
                                    f"this step in the builder, then register the workflow."),
                    })
                ctx.emit("agents_failed", json.dumps({"failures": rows, "manual": True}))
                break

        spec.provisioned_agents = provisioned
        logger.info(
            "Provisioned %d agents (%d reused, %d created)",
            len(provisioned),
            sum(1 for a in provisioned if a["reused"]),
            sum(1 for a in provisioned if not a["reused"]),
        )

        return await next(ctx)


def _agent_name(cap) -> str:
    return str(getattr(cap.spec, "agent_name", "") or cap.name)
