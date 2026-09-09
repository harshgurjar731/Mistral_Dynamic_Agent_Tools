"""
GuardrailConfigLayer — Configures the platform's moderation guardrail.

Placed after the facet ParallelGroup and before instruction authoring, because
the risk an agent carries is a property of what it can actually do rather than
of what was asked for. An agent that only summarises text and an agent holding
a database tool and a write-capable integration warrant different moderation,
and nothing in the user's request distinguishes them.

What it produces is Mistral's own guardrail configuration — a moderation model
scoring every turn against named categories and blocking above a threshold —
passed to agent creation alongside the tools. It is deliberately *not* prose in
the agent's instructions: instructions are advice the model may disregard or be
talked around, whereas this runs outside the model and holds regardless. The
instruction layer is told not to restate it.
"""

import json
import logging

from app.core.context import PipelineContext
from app.core.decision import AgentDecisionLayer
from app.core.specs import V1_CATEGORIES, V2_CATEGORIES, GuardrailSpec
from app.layers.agent.facets import _requirements_block

logger = logging.getLogger(__name__)

_VALID_ACTIONS = {"block", "none"}

#: Categories that describe *subject matter* rather than harm. An agent whose
#: job is one of these scores near 1.0 on it every turn — a clinical agent
#: discussing a routine medication review scores 0.9997 on `health` — so any
#: threshold below ~0.99 blocks the agent's own work on its first real
#: question. The keywords are matched against the requirement's stated domain.
_TOPIC_CATEGORY_DOMAINS: dict[str, tuple[str, ...]] = {
    "health": (
        "health", "clinical", "medical", "medicine", "patient", "diagnos",
        "pharma", "drug", "nhs", "care", "hospital", "therap", "nurs",
    ),
    "financial": (
        "financ", "banking", "mortgage", "lending", "loan", "credit", "invest",
        "insurance", "payment", "tax", "accounting", "underwrit", "claim",
        "treasury", "trading", "actuar",
    ),
    "law": (
        "law", "legal", "regulat", "compliance", "contract", "litigation",
        "statut", "policy", "governance", "juris",
    ),
}

#: Per Mistral's guardrail docs, a threshold of 1 explicitly disables a
#: category. This is the only way to exempt one: a category left out of
#: ``custom_category_thresholds`` is not skipped, it falls back to an
#: undisclosed default — and that default blocks a clinical agent at
#: health=0.9997. Omission is not neutral, which is what made the first
#: attempt at this guard fail in exactly the same way it was meant to prevent.
_CATEGORY_DISABLED = 1.0


def _own_topic_categories(domain: str) -> set[str]:
    """Topic categories that describe this agent's own subject."""
    text = (domain or "").strip().lower()
    if not text:
        return set()
    return {
        category
        for category, keywords in _TOPIC_CATEGORY_DOMAINS.items()
        if any(word in text for word in keywords)
    }


def describe_capabilities(ctx: PipelineContext) -> dict[str, str]:
    """Render the assembled capabilities for a prompt.

    Shared with InstructionAuthoringLayer: both layers need the same view of
    what the agent holds, and describing it twice would let the two drift.
    """
    spec = ctx.agent_spec
    tools = spec.tools or []
    connectors = spec.connectors or []
    libraries = spec.document_library_ids or []

    tool_just = ctx.metadata.get("facet_tools_justification") or {}
    conn_just = ctx.metadata.get("facet_connector_justification") or {}

    def _with_reasons(items: list[str], reasons: dict) -> str:
        if not items:
            return "none"
        return "; ".join(
            f"{item} ({reasons[item]})" if reasons.get(item) else item
            for item in items
        )

    return {
        "tool_detail": _with_reasons(tools, tool_just),
        "connector_detail": _with_reasons(connectors, conn_just),
        "library_detail": ", ".join(libraries) if libraries else "none",
        "knowledge_graph": "enabled" if spec.knowledge_graph else "disabled",
        "write_risk": ", ".join(ctx.metadata.get("facet_write_risk") or []) or "none",
    }


class GuardrailConfigLayer(AgentDecisionLayer):
    """Decide the moderation configuration from the assembled agent."""

    name = "guardrail_config"
    label = "Configure guardrails"
    detail = "Decides the moderation categories and thresholds Mistral enforces on this agent."
    phase = "guardrail configuration"
    status_message = "Configuring guardrails…"

    def build_prompt(self, ctx: PipelineContext) -> tuple[str, str]:
        from app.prompts_decisions import (
            GUARDRAIL_CONFIG_SYSTEM_PROMPT,
            GUARDRAIL_CONFIG_USER_PROMPT,
        )

        spec = ctx.agent_spec
        caps = describe_capabilities(ctx)

        configuration = json.dumps(
            {
                "agent_name": spec.agent_name,
                "tier": spec.tier,
                "description": spec.description,
                "model": spec.model,
                "temperature": spec.temperature,
                "tools": spec.tools or [],
                "connectors": spec.connectors or [],
                "document_library_ids": spec.document_library_ids or [],
                "knowledge_graph": bool(spec.knowledge_graph),
            },
            indent=2,
        )

        return (
            GUARDRAIL_CONFIG_SYSTEM_PROMPT,
            GUARDRAIL_CONFIG_USER_PROMPT.format(
                requirements=_requirements_block(ctx),
                agent_configuration=configuration,
                domain=(ctx.requirements.domain if ctx.requirements else "") or "general",
                **caps,
            ),
        )

    def apply(self, ctx: PipelineContext, data: dict) -> None:
        domain = ctx.requirements.domain if ctx.requirements else ""
        ctx.agent_spec.guardrails = parse_guardrails(data, domain)
        g = ctx.agent_spec.guardrails
        ctx.agent_spec.rationale["guardrails"] = g.rationale

        logger.info(
            "Guardrails: enabled=%s %s action=%s categories=%s rounds=%d",
            g.enabled, g.version, g.action, sorted(g.thresholds), g.max_tool_rounds,
        )
        ctx.emit("guardrails", json.dumps(g.describe()))

    def fallback(self, ctx: PipelineContext) -> None:
        """Leave moderation off, but keep a conservative tool budget.

        Guessing thresholds for an agent whose configuration was never assessed
        would be worse than not configuring them: a wrong strict value blocks
        legitimate work, a wrong loose one is security theatre. Reporting that
        the decision did not happen is the honest outcome.
        """
        ctx.agent_spec.guardrails = GuardrailSpec(
            enabled=False,
            max_tool_rounds=5,
            rationale="Not configured — the guardrail decision could not be made.",
        )
        ctx.emit("guardrails", json.dumps(ctx.agent_spec.guardrails.describe()))


def parse_guardrails(data: dict, domain: str = "") -> GuardrailSpec:
    """Coerce a model-supplied guardrail block into a valid configuration.

    Shared with the workflow pipeline's AgentDesignLayer, which decides the
    same thing for each agent it designs. One parser keeps the validation
    identical on both paths.

    ``domain`` is the agent's own subject. It is used to drop thresholds on
    topic categories the agent is *about*: those score near 1.0 on every turn,
    so a threshold there blocks the agent from doing its job. The prompt says
    so, but a prompt is advice — this is the part that holds when the model
    ignores it, and it is how a clinical agent stopped being 403'd on its first
    question by its own `health` guardrail.
    """
    version = str(data.get("version") or "v2").strip().lower()
    version = version if version in {"v1", "v2"} else "v2"
    valid = V1_CATEGORIES if version == "v1" else V2_CATEGORIES

    action = str(data.get("action") or "").strip().lower()
    action = action if action in _VALID_ACTIONS else "block"

    thresholds: dict[str, float] = {}
    for key, value in (data.get("thresholds") or {}).items():
        name = str(key).strip().lower()
        if name not in valid:
            # A category the chosen moderation version does not have would be
            # dropped by the SDK anyway; logging it here names the cause.
            logger.info("Dropping unknown moderation category '%s' for %s", name, version)
            continue
        try:
            score = float(value)
        except (TypeError, ValueError):
            continue
        thresholds[name] = max(0.0, min(1.0, score))

    # Explicitly disable any topic category that is the agent's own subject.
    #
    # This has to *add* the entry, not merely correct one the model supplied:
    # with ``ignore_other_categories`` false, every category not named is still
    # evaluated at its default, and the default blocks a clinical agent whose
    # every turn scores ~1.0 on `health`. Setting it to 1 is the documented way
    # to exempt a category.
    own_topics = _own_topic_categories(domain)
    for category in sorted(own_topics):
        current = thresholds.get(category)
        if current is None:
            logger.info(
                "Disabling %s for this agent — it is its own subject (%r), and an "
                "unlisted category would still be evaluated at its default",
                category, domain,
            )
            thresholds[category] = _CATEGORY_DISABLED
        elif current < _CATEGORY_DISABLED:
            logger.warning(
                "Raising %s threshold %.2f to 1 (disabled) — it is this agent's own "
                "subject (%r), which scores ~1.0 every turn and would block it outright",
                category, current, domain,
            )
            thresholds[category] = _CATEGORY_DISABLED

    try:
        rounds = int(data.get("max_tool_rounds"))
    except (TypeError, ValueError):
        rounds = 5
    rounds = max(1, min(10, rounds))

    # An "enabled" guardrail naming no categories configures nothing — the
    # request would carry an action and no thresholds, which is a no-op the API
    # still counts against the agent's guardrail budget.
    enabled = bool(data.get("enabled")) and bool(thresholds)
    if data.get("enabled") and not thresholds:
        logger.info("Guardrail marked enabled but named no categories — treating as off")

    return GuardrailSpec(
        enabled=enabled,
        version=version,
        action=action,
        thresholds=thresholds,
        ignore_other_categories=bool(data.get("ignore_other_categories")),
        block_on_error=bool(data.get("block_on_error", True)),
        max_tool_rounds=rounds,
        rationale=str(data.get("reasoning") or ""),
    )
