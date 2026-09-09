"""
AgentInventoryLayer — Fetches what the agent could be given.

No LLM call. It exists as its own layer because the five facet layers that
follow run concurrently and each needs part of the same inventory: fetching it
inside the ParallelGroup would issue the same network round trips five times
over, once per branch.

Scoping is resolved here too, and now from the requirement spec's domain and
intent rather than the raw query. A query worded around a symptom
("my numbers look wrong") scopes poorly; the analysed domain
("financial reporting") scopes correctly.
"""

import asyncio
import logging

from app.core.context import PipelineContext
from app.core.layer import Layer, NextFn

logger = logging.getLogger(__name__)

#: Where the facet layers read the inventory from.
INVENTORY_KEY = "inventory"


class AgentInventoryLayer(Layer):
    """Resolve ontology scope and fetch scoped connectors and libraries."""

    name = "agent_inventory"
    label = "Take inventory"
    detail = "Gathers the tools, integrations and documents this agent could be given."

    def should_run(self, ctx: PipelineContext) -> bool:
        return self.enabled and not ctx.agent_id and not ctx.conversation_id

    async def process(self, ctx: PipelineContext, next: NextFn) -> PipelineContext:
        from app.ontology import matcher as ontology_matcher
        from app.rag import inventory as library_inventory
        from app.services import connector_service
        from app.services.tool_registry import AVAILABLE_TOOL_KEYS, get_tool_descriptions

        # Scope from the analysed domain when we have one. A single-agent
        # request needs one or two integrations at most; offering all of them
        # makes the choice harder, not easier.
        if ctx.requirements and ctx.requirements.domain not in ("", "general"):
            scope_text = f"{ctx.requirements.domain} {ctx.requirements.intent}"
        else:
            scope_text = ctx.query
        scope = ontology_matcher.scope_for_goal(scope_text)

        # Connectors and libraries are both "what can this agent reach" and are
        # fetched together — neither depends on the other, and each is a network
        # round trip the request would otherwise wait through in turn.
        (
            (connector_descriptions, connector_ids),
            (library_descriptions, library_ids),
        ) = await asyncio.gather(
            connector_service.describe_for_prompt(scope),
            library_inventory.describe_for_prompt(scope),
        )

        # Names for the ids above. Every id the layers pass around is opaque,
        # and an agent card reading "019e641f-1058-70d3-…" tells a user nothing
        # about what their agent can read.
        library_names: dict[str, str] = {}
        try:
            from app.services import library_service

            for library in await library_service.list_libraries():
                if library.get("id"):
                    library_names[library["id"]] = library.get("name") or library["id"]
        except Exception as e:
            logger.debug("Could not resolve library names: %s", e)

        ctx.metadata[INVENTORY_KEY] = {
            "scope": scope,
            "library_names": library_names,
            "scope_description": ontology_matcher.describe_scope(scope),
            "tool_descriptions": get_tool_descriptions(),
            "tool_keys": list(AVAILABLE_TOOL_KEYS),
            "connector_descriptions": connector_descriptions,
            "connector_ids": list(connector_ids),
            "library_descriptions": library_descriptions,
            "library_ids": list(library_ids),
        }

        logger.info(
            "Inventory for scope %s: %d tool keys, %d connectors, %d libraries",
            scope.get("domains"), len(AVAILABLE_TOOL_KEYS),
            len(connector_ids), len(library_ids),
        )

        return await next(ctx)
