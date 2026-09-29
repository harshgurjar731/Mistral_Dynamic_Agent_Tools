"""
ResourceInventoryLayer — Gathers everything the planner may draw on.

No LLM call. Formerly Phase 1 of the monolithic planning layer, minus the
analysis completion that was welded to it. Separating them matters: the
inventory is pure I/O and the decomposition is pure judgement, and mixing them
meant the ontology scoping — which decides how much the planner even sees —
happened inside a function whose name said it was analysing a goal.

Everything here lands on ``ctx.workflow_spec.inventory`` for the layers after.
"""

import asyncio
import logging

import httpx

from app.core.context import PipelineContext
from app.core.layer import Layer, NextFn
from app.core.specs import WorkflowSpec

logger = logging.getLogger(__name__)

# How much of an agent's instructions the planner sees.
#
# The reuse decision only has to answer "does an agent for this already exist"
# — it never executes the instructions, so the operating detail is dead weight.
# Sending them in full put ~16k tokens of agent definitions into a single
# request (one agent alone carries 7.6k characters), which is what pushed the
# call past the client's read timeout and hung the planner.
_INSTRUCTION_BUDGET = 400


def summarise_instructions(text: str) -> str:
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


class ResourceInventoryLayer(Layer):
    """Fetch tools, agents, workflows, connectors and libraries; resolve scope."""

    name = "resource_inventory"
    label = "Take inventory"
    detail = "Gathers the agents, activities, integrations and documents already available."

    async def process(self, ctx: PipelineContext, next: NextFn) -> PipelineContext:
        from app.config import settings
        from app.ontology import matcher as ontology_matcher
        from app.ontology.vocab import (
            SYSTEM_DOMAIN,
            AgentTier,
            Predicate,
            SubjectType,
            coerce_tier,
        )
        from app.rag import inventory as library_inventory
        from app.services import agent_service, connector_service
        from app.services.tool_registry import AVAILABLE_TOOL_KEYS, get_tool_descriptions
        from app.services.tool_resolver import tool_resolver

        goal = ctx.query
        ctx.workflow_spec = WorkflowSpec(goal=goal)
        ctx.emit("status", "Taking inventory of available resources…")

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

        # Resolved before the fetch so the connector and library inventories can
        # be narrowed in the same round trip as everything else.
        scope = ontology_matcher.scope_for_goal(goal)

        (
            existing_tools,
            agents_resp,
            existing_workflows,
            (connector_descriptions, connector_ids),
            (library_descriptions, library_ids),
        ) = await asyncio.gather(
            tool_resolver.list_tools(),
            agent_service.list_agents(ctx.client, page=0, page_size=100),
            _fetch_workflows(),
            connector_service.describe_for_prompt(scope),
            library_inventory.describe_for_prompt(scope),
        )

        # Catalog of Activities (standalone tool steps) the topology layer may
        # bind to. Disjoint from the tools attached to agents — only records
        # classified "activity" belong here.
        activities_catalog: list[dict] = []
        for t in existing_tools:
            if t.get("purpose") != "activity":
                continue
            schema = t.get("schema") or {}
            fn = schema.get("function", {}) if isinstance(schema, dict) else {}
            name = fn.get("name") or t.get("name")
            if not name:
                continue
            params = fn.get("parameters", {}) or {}
            activities_catalog.append({
                "name": name,
                "description": fn.get("description") or "",
                "parameters": params.get("properties", {}),
                "required": params.get("required", []),
                # The fields later steps may read. Data-flow wiring and its
                # validation both work from this contract.
                "output_schema": t.get("output_schema"),
                "version": t.get("version_no"),
            })

        all_agents = [
            {
                "id": a["id"],
                "name": a["name"],
                # Not `.get("tier", "foundation")`. A missing tier now means
                # more than a label: foundation is what puts an agent under
                # System and exempts it from domain scoping, so defaulting to
                # it would quietly grant that exemption to any agent whose tier
                # failed to resolve. `coerce_tier` defaults to domain, which is
                # the answer that fails safe.
                "tier": coerce_tier(a.get("tier")),
                "description": a.get("description") or "",
                "instructions": summarise_instructions(a.get("instructions", "")),
                "connectors": [
                    ref["connector_id"]
                    for ref in (a.get("connectors") or [])
                    if ref.get("connector_id")
                ],
            }
            for a in agents_resp.get("items", [])
        ]

        # ── Ontology scoping ─────────────────────────────────────────────
        # Passing the whole inventory costs tokens, but the real damage is
        # precision: a mortgage goal should never have to rule out a Medical
        # Information Extractor. Narrow to the matched domain subtree, always
        # keeping foundation agents — they are domain-agnostic by definition
        # and reused in every workflow.
        #
        # `scope_for_goal` already puts the System subtree in every scope, so a
        # correctly annotated foundation agent survives on its annotation
        # alone. This stays as the floor under that: an agent whose tier is
        # known but whose System annotation has not been written yet — a fresh
        # create, an un-backfilled agent — is kept on the strength of the tier.
        # Dropping a guardrail because the store is a step behind would be a
        # silent safety regression, not a scoping nicety.
        foundation_ids = {
            a["id"] for a in all_agents if a.get("tier") == AgentTier.FOUNDATION.value
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

        ctx.workflow_spec.inventory = {
            "scope": scope,
            "scope_description": ontology_matcher.describe_scope(scope),
            # Where foundation agents sit in the domain tree, carried through
            # so the layers after this one — and anything reading a plan back —
            # can say *why* a guardrail was in play for an unrelated goal
            # without re-deriving it from the tier.
            "system_domain": SYSTEM_DOMAIN,
            "all_agents": all_agents,
            "scoped_agents": scoped_agents,
            "foundation_agents": [
                a for a in scoped_agents if a.get("tier") == AgentTier.FOUNDATION.value
            ],
            "domain_agents": [
                a for a in scoped_agents if a.get("tier") == AgentTier.DOMAIN.value
            ],
            "usecase_agents": [
                a for a in scoped_agents if a.get("tier") == AgentTier.USE_CASE.value
            ],
            "existing_tools": existing_tools,
            "existing_tool_names": [t.get("name", "") for t in existing_tools],
            "activities": activities_catalog,
            "existing_workflows": existing_workflows,
            "tool_descriptions": get_tool_descriptions(),
            "tool_keys": list(AVAILABLE_TOOL_KEYS),
            "connector_descriptions": connector_descriptions,
            "connector_ids": list(connector_ids),
            "library_descriptions": library_descriptions,
            "library_ids": list(library_ids),
        }

        logger.info(
            "Inventory: %d agents in scope, %d activities, %d connectors, %d libraries",
            len(scoped_agents), len(activities_catalog),
            len(connector_ids), len(library_ids),
        )

        return await next(ctx)
