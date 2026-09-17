"""
AgentRuleSelectionLayer — Decides which optional agent rules this agent follows.

Placed after the guardrail layer and before instruction authoring. After the
guardrail layer, because which rules fit depends on what the agent actually
holds — a redaction rule matters for an agent reading customer records, not for
one formatting public text. Before instruction authoring, so the instructions
can be written for the rules (a JSON-answer rule changes the output format).

The model only picks from rules people have defined on the Rules page; it
cannot invent one. Always-on rules are not its decision — they apply to every
agent. Enforcement happens in AgentAssemblyLayer and at runtime, not here.
"""

import json
import logging

from app.core.context import PipelineContext
from app.core.decision import AgentDecisionLayer
from app.core.layer import NextFn
from app.layers.agent.facets import _requirements_block

logger = logging.getLogger(__name__)


class AgentRuleSelectionLayer(AgentDecisionLayer):
    """Choose the optional agent rules that fit this agent."""

    name = "rule_selection"
    label = "Choose rules"
    detail = "Decides which of your optional agent rules this agent must follow."
    phase = "rule selection"
    status_message = "Choosing rules…"

    async def process(self, ctx: PipelineContext, next: NextFn) -> PipelineContext:
        from app.rules import store

        # Nothing to choose from — skip the completion entirely.
        if not store.selectable_rules("agent"):
            ctx.agent_spec.rules = []
            self._emit(ctx, [], "No optional agent rules are defined; only always-on rules apply.", True)
            ctx.set_layer_summary(self.name, "Only always-on rules apply.")
            return await next(ctx)
        return await super().process(ctx, next)

    def build_prompt(self, ctx: PipelineContext) -> tuple[str, str]:
        from app.rules import select

        spec = ctx.agent_spec
        req = ctx.requirements
        subject = select.agent_subject(
            name=spec.agent_name or "",
            description=spec.description or "",
            tier=spec.tier or "",
            model=spec.model or "",
            tools=spec.tools or [],
            connectors=spec.connectors or [],
            libraries=spec.document_library_ids or [],
            domain=(req.domain if req else "") or "",
            requirements=_requirements_block(ctx),
        )
        return select.build_prompt("agent", subject)

    def apply(self, ctx: PipelineContext, data: dict) -> None:
        from app.rules import select

        selection, reasoning = select.parse_selection(data, "agent")
        ctx.agent_spec.rules = selection
        ctx.agent_spec.rationale["rules"] = reasoning
        logger.info("Rule selection: %s", [s["rule_id"] for s in selection])
        self._emit(ctx, selection, reasoning, True)

    def fallback(self, ctx: PipelineContext) -> None:
        """Always-on rules still apply; only the optional ones are skipped."""
        ctx.agent_spec.rules = []
        self._emit(ctx, [], "Rule selection could not be made — only always-on rules apply.", False)

    def _emit(self, ctx: PipelineContext, selection: list, reasoning: str, decided: bool) -> None:
        from app.rules import store

        ctx.emit("rules_selected", json.dumps({
            "scope": "agent",
            "selected": selection,
            "always_on": [
                {"rule_id": r["id"], "name": r["name"], "summary": r["summary"]}
                for r in store.always_on_rules("agent")
            ],
            "reasoning": reasoning,
            "decided": decided,
        }))
