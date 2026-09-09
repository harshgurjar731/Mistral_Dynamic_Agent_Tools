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

            async def _create(cap):
                agent_spec = cap.spec
                # Created before to_config so the new id is in the attachment
                # list this agent is built with.
                new_library = await _provision_library(cap, ctx)
                if new_library:
                    agent_spec.document_library_ids = list(
                        agent_spec.document_library_ids or []
                    ) + [new_library]
                config = agent_spec.to_config()
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
                    guardrail_request = config.get("guardrails")
                    if guardrail_request:
                        guardrails = build_guardrails([guardrail_request])
                        if guardrails:
                            create_kwargs["guardrails"] = guardrails

                    agent_obj = await asyncio.to_thread(
                        partial(ctx.client.beta.agents.create, **create_kwargs)
                    )

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

                    agent_spec.agent_id = agent_obj.id
                    return {
                        "capability_id": cap.id,
                        "agent_id": agent_obj.id,
                        "agent_name": config["agent_name"],
                        "model": map_model_name(config["model"]),
                        "tier": config["tier"],
                        "tools": config["tools"],
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

            results = await asyncio.gather(
                *[_create(c) for c in to_create], return_exceptions=True
            )

            for item in results:
                if isinstance(item, Exception):
                    # Fatal: a capability with no agent leaves a step that cannot
                    # be bound, and a workflow saved in that state fails at run
                    # time in a way that is hard to trace back to planning.
                    logger.error("Agent creation failed: %s", item)
                    ctx.emit("fatal_error", json.dumps(
                        {"error": f"Agent creation failed: {item}"}
                    ))
                    ctx.set_error(f"Agent creation failed: {item}")
                    return await next(ctx)
                provisioned.append(item)
                ctx.emit("agent_new", json.dumps(item))

        spec.provisioned_agents = provisioned
        logger.info(
            "Provisioned %d agents (%d reused, %d created)",
            len(provisioned),
            sum(1 for a in provisioned if a["reused"]),
            sum(1 for a in provisioned if not a["reused"]),
        )

        return await next(ctx)
