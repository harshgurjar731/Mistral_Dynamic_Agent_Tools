"""
Facet layers — Five independent decisions about one agent, made concurrently.

These are the branches of the ``agent_facets`` ParallelGroup. Each answers one
question against the requirement spec and the shared inventory, and none reads
another's output — which is exactly why they can run at once. Anything that
needs to see several facets together (the safety envelope, the instructions)
is a layer after the group, not a branch inside it.

Each branch writes only its own fields on ``ctx.agent_spec``. The group gives
every branch a deep copy of the spec and merges them field-wise afterwards, so
a branch that fails leaves the others' work intact.

Every layer here validates its output against the real inventory before
writing it. A tool key, connector id or library id the model invented fails
agent creation outright, and the failure surfaces far from its cause.
"""

import json
import logging

from app.core.context import PipelineContext
from app.core.decision import AgentDecisionLayer
from app.layers.agent.inventory_layer import INVENTORY_KEY

logger = logging.getLogger(__name__)

_VALID_MODELS = {
    "mistral-large-latest",
    "mistral-medium-latest",
    "mistral-small-latest",
}

_VALID_TIERS = {"foundation", "domain", "use_case"}

#: Tool keys owned by LibrarySelectionLayer, not by ToolSelectionLayer.
#:
#: ``document_library`` is attached by supplying library ids, and
#: ``search_domain_knowledge`` is what the knowledge-graph flag turns on. Both
#: are added and removed by ``with_rag_tools`` from the library layer's
#: decision. Offering them here let two concurrent layers answer the same
#: question: tool selection would pick ``search_domain_knowledge``, the library
#: layer would independently decide ``knowledge_graph: false``, and
#: ``with_rag_tools`` would then silently strip the tool — leaving an agent
#: missing a capability its own timeline row claimed it had.
_LIBRARY_OWNED_KEYS = {"document_library", "search_domain_knowledge"}


def _inventory(ctx: PipelineContext) -> dict:
    return ctx.metadata.get(INVENTORY_KEY) or {}


def _requirements_block(ctx: PipelineContext) -> str:
    return ctx.requirements.as_prompt_block() if ctx.requirements else "{}"


def _kept(selected, valid: list[str], what: str) -> list[str]:
    """Keep only ids that exist, logging what was dropped.

    Silently dropping is the right behaviour — an agent missing one connector
    still works, an agent creation call with an unknown id does not — but it
    must be visible in the logs or the cause of a thin agent is invisible.
    """
    if not isinstance(selected, (list, tuple)):
        return []
    valid_set = set(valid)
    kept, dropped = [], []
    for item in selected:
        key = str(item).strip()
        (kept if key in valid_set else dropped).append(key)
    if dropped:
        logger.warning("Dropped %d invented %s: %s", len(dropped), what, dropped)
    return kept


# ── 1. Tools ────────────────────────────────────────────────────────────────


class ToolSelectionLayer(AgentDecisionLayer):
    """Decide which platform tools this agent needs."""

    name = "tool_selection"
    label = "Choose tools"
    detail = "Decides which platform capabilities this agent needs."
    phase = "tool selection"
    status_message = "Choosing tools…"

    def _selectable(self, ctx: PipelineContext) -> list[str]:
        """The keys this layer may choose from — its own, not another layer's."""
        return [
            k for k in (_inventory(ctx).get("tool_keys") or [])
            if k not in _LIBRARY_OWNED_KEYS
        ]

    def build_prompt(self, ctx: PipelineContext) -> tuple[str, str]:
        from app.prompts_decisions import (
            TOOL_SELECTION_SYSTEM_PROMPT,
            TOOL_SELECTION_USER_PROMPT,
        )

        inv = _inventory(ctx)
        return (
            TOOL_SELECTION_SYSTEM_PROMPT,
            TOOL_SELECTION_USER_PROMPT.format(
                requirements=_requirements_block(ctx),
                user_query=ctx.query,
                tool_descriptions=inv.get("tool_descriptions", ""),
                tool_keys=json.dumps(self._selectable(ctx)),
            ),
        )

    def apply(self, ctx: PipelineContext, data: dict) -> None:
        tools = _kept(data.get("tools"), self._selectable(ctx), "tool keys")
        ctx.agent_spec.tools = tools
        ctx.agent_spec.rationale["tools"] = str(data.get("reasoning") or "")
        ctx.metadata["facet_tools_justification"] = data.get("per_tool_justification") or {}
        logger.info("Tool selection: %s", tools)

    def fallback(self, ctx: PipelineContext) -> None:
        # No tools is a working agent that answers from the model's own
        # knowledge. Guessing a tool list here would be worse than none.
        ctx.agent_spec.tools = []


# ── 2. Connectors ───────────────────────────────────────────────────────────


class ConnectorSelectionLayer(AgentDecisionLayer):
    """Decide which external services this agent must reach."""

    name = "connector_selection"
    label = "Choose integrations"
    detail = "Decides which external services this agent must reach."
    phase = "connector selection"
    status_message = "Choosing integrations…"

    def build_prompt(self, ctx: PipelineContext) -> tuple[str, str]:
        from app.prompts_decisions import (
            CONNECTOR_SELECTION_SYSTEM_PROMPT,
            CONNECTOR_SELECTION_USER_PROMPT,
        )

        inv = _inventory(ctx)
        return (
            CONNECTOR_SELECTION_SYSTEM_PROMPT,
            CONNECTOR_SELECTION_USER_PROMPT.format(
                requirements=_requirements_block(ctx),
                user_query=ctx.query,
                connector_descriptions=inv.get("connector_descriptions", ""),
                connector_ids=json.dumps(inv.get("connector_ids", [])),
            ),
        )

    def apply(self, ctx: PipelineContext, data: dict) -> None:
        inv = _inventory(ctx)
        valid = inv.get("connector_ids", [])
        connectors = _kept(data.get("connectors"), valid, "connector ids")
        ctx.agent_spec.connectors = connectors
        ctx.agent_spec.rationale["connectors"] = str(data.get("reasoning") or "")

        # The guardrail layer reads this: a connector that can modify external
        # state is the single biggest driver of a stricter envelope, and only
        # this layer is in a position to say which ones can.
        ctx.metadata["facet_write_risk"] = _kept(
            data.get("write_risk"), valid, "write-risk connector ids"
        )
        ctx.metadata["facet_connector_justification"] = (
            data.get("per_connector_justification") or {}
        )
        logger.info("Connector selection: %s (write risk: %s)",
                    connectors, ctx.metadata["facet_write_risk"])

    def fallback(self, ctx: PipelineContext) -> None:
        ctx.agent_spec.connectors = []


# ── 3. Libraries and knowledge graph ────────────────────────────────────────


class LibrarySelectionLayer(AgentDecisionLayer):
    """Decide what grounding material this agent reads."""

    name = "library_selection"
    label = "Choose knowledge"
    detail = "Decides what documents this agent reads, and whether it reasons over the graph."
    phase = "library selection"
    status_message = "Choosing knowledge sources…"

    def build_prompt(self, ctx: PipelineContext) -> tuple[str, str]:
        from app.prompts_decisions import (
            LIBRARY_SELECTION_SYSTEM_PROMPT,
            LIBRARY_SELECTION_USER_PROMPT,
        )

        inv = _inventory(ctx)
        return (
            LIBRARY_SELECTION_SYSTEM_PROMPT,
            LIBRARY_SELECTION_USER_PROMPT.format(
                requirements=_requirements_block(ctx),
                user_query=ctx.query,
                library_descriptions=inv.get("library_descriptions", ""),
                library_ids=json.dumps(inv.get("library_ids", [])),
            ),
        )

    def apply(self, ctx: PipelineContext, data: dict) -> None:
        inv = _inventory(ctx)
        libraries = _kept(
            data.get("document_library_ids"), inv.get("library_ids", []), "library ids"
        )
        ctx.agent_spec.document_library_ids = libraries
        ctx.agent_spec.knowledge_graph = bool(data.get("knowledge_graph"))
        ctx.agent_spec.rationale["libraries"] = str(data.get("reasoning") or "")

        # Nothing in the inventory covered the subject, but the requirement
        # calls for the user's own documents. LibraryProvisioningLayer creates
        # it empty rather than leaving the agent grounded in nothing.
        request = data.get("create_library")
        if not libraries and isinstance(request, dict) and request.get("name"):
            ctx.agent_spec.requested_library = {
                "name": str(request.get("name"))[:100],
                "description": str(request.get("description") or "")[:500],
            }
            logger.info("Library selection requested a new library: %s",
                        ctx.agent_spec.requested_library["name"])

        logger.info(
            "Library selection: %s (knowledge_graph=%s)",
            libraries, ctx.agent_spec.knowledge_graph,
        )

    def fallback(self, ctx: PipelineContext) -> None:
        ctx.agent_spec.document_library_ids = []
        ctx.agent_spec.knowledge_graph = False


# ── 4. Model and temperature ────────────────────────────────────────────────


class ModelSelectionLayer(AgentDecisionLayer):
    """Decide the model and sampling temperature."""

    name = "model_selection"
    label = "Choose a model"
    detail = "Decides the model and how deterministic its answers should be."
    phase = "model selection"
    status_message = "Choosing a model…"

    def build_prompt(self, ctx: PipelineContext) -> tuple[str, str]:
        from app.prompts_decisions import (
            MODEL_SELECTION_SYSTEM_PROMPT,
            MODEL_SELECTION_USER_PROMPT,
        )

        return (
            MODEL_SELECTION_SYSTEM_PROMPT,
            MODEL_SELECTION_USER_PROMPT.format(requirements=_requirements_block(ctx)),
        )

    def apply(self, ctx: PipelineContext, data: dict) -> None:
        from app.config import map_model_name

        model = map_model_name(str(data.get("model") or "").strip())
        if model not in _VALID_MODELS:
            logger.warning("Model '%s' not recognised — defaulting to large", model)
            model = "mistral-large-latest"

        try:
            temperature = float(data.get("temperature"))
        except (TypeError, ValueError):
            temperature = 0.3
        # A temperature outside this range is either a model slip or a unit
        # confusion; clamping is safer than passing it to the API.
        temperature = max(0.0, min(1.0, temperature))

        ctx.agent_spec.model = model
        ctx.agent_spec.temperature = temperature
        ctx.agent_spec.rationale["model"] = str(data.get("reasoning") or "")
        logger.info("Model selection: %s @ %.2f", model, temperature)

    def fallback(self, ctx: PipelineContext) -> None:
        ctx.agent_spec.model = "mistral-large-latest"
        ctx.agent_spec.temperature = 0.3


# ── 5. Identity (tier, name, description) ───────────────────────────────────


class IdentityLayer(AgentDecisionLayer):
    """Decide what this agent is: its tier, name and description.

    Tier and name are one decision because the naming convention is a function
    of the tier — a foundation agent carrying a domain word in its name is
    misfiled, and a use-case agent without a product word is ambiguous. Split
    across two layers, neither could enforce that.
    """

    name = "identity"
    label = "Define the agent"
    detail = "Decides the tier, and therefore the name and remit."
    phase = "identity"
    status_message = "Defining the agent…"

    def build_prompt(self, ctx: PipelineContext) -> tuple[str, str]:
        from app.prompts_decisions import IDENTITY_SYSTEM_PROMPT, IDENTITY_USER_PROMPT

        return (
            IDENTITY_SYSTEM_PROMPT,
            IDENTITY_USER_PROMPT.format(
                requirements=_requirements_block(ctx),
                user_query=ctx.query,
            ),
        )

    def apply(self, ctx: PipelineContext, data: dict) -> None:
        tier = str(data.get("tier") or "").strip().lower()
        if tier not in _VALID_TIERS:
            tier = "domain"

        # An explicit user choice outranks the model's classification — the
        # tier selector in the UI exists precisely to override this.
        if ctx.tier:
            tier = ctx.tier

        ctx.agent_spec.tier = tier
        ctx.agent_spec.agent_name = str(data.get("agent_name") or "Dynamic Agent").strip()[:100]
        ctx.agent_spec.description = str(data.get("description") or "").strip()[:500]
        ctx.agent_spec.rationale["identity"] = str(data.get("reasoning") or "")
        logger.info(
            "Identity: %s (tier=%s)", ctx.agent_spec.agent_name, ctx.agent_spec.tier
        )

    def fallback(self, ctx: PipelineContext) -> None:
        req = ctx.requirements
        domain = (req.domain if req else "general") or "general"
        ctx.agent_spec.tier = ctx.tier or "domain"
        ctx.agent_spec.agent_name = f"{domain.title()} Assistant"[:100]
        ctx.agent_spec.description = (
            req.deliverable if req and req.deliverable else "Assists with the user's request."
        )[:500]
