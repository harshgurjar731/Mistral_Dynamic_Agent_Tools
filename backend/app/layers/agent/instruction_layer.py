"""
InstructionAuthoringLayer — Writes the agent's system instructions.

The last design decision, and the one that determines whether the agent
actually performs. Every layer before it decided what the agent HAS; this one
decides how it THINKS.

In the single-call orchestrator this was one field among nine, and it showed:
instructions came back short often enough that ``_parse_agent_config`` grew a
fallback that rewrote them from the agent's name and description. Given a
prompt that asks for nothing else — and the tools, connectors, tier and safety
envelope already decided — the model has both the room and the context to write
something specific. The length fallback survives here, but as a guard rather
than a routine path.
"""

import logging

from app.core.context import PipelineContext
from app.core.decision import LONG_TIMEOUT_MS, AgentDecisionLayer
from app.layers.agent.facets import _requirements_block
from app.layers.agent.guardrail_layer import describe_capabilities

logger = logging.getLogger(__name__)

#: Below this, the instructions are generic enough to be worth replacing.
#: The old threshold was 50 characters, which only ever caught an empty answer.
_MIN_INSTRUCTION_CHARS = 400


class InstructionAuthoringLayer(AgentDecisionLayer):
    """Author the six-section system instructions for the assembled agent."""

    name = "instruction_authoring"
    label = "Write the instructions"
    detail = "Decides how this agent thinks, expressing every prior decision to the model."
    phase = "instruction authoring"
    status_message = "Writing the agent's instructions…"
    # Authoring writes substantially more than a facet decision does.
    timeout_ms = LONG_TIMEOUT_MS
    # Instructions are prose, not a classification. A little more latitude here
    # produces better-structured writing than the near-greedy facet setting.
    temperature = 0.3

    def build_prompt(self, ctx: PipelineContext) -> tuple[str, str]:
        from app.prompts_decisions import (
            INSTRUCTION_AUTHORING_SYSTEM_PROMPT,
            INSTRUCTION_AUTHORING_USER_PROMPT,
        )

        from app.rules import engine as rules_engine, store as rules_store

        spec = ctx.agent_spec
        caps = describe_capabilities(ctx)
        rules = rules_store.effective_rules(
            "agent", [r["rule_id"] for r in spec.rules or []]
        )

        return (
            INSTRUCTION_AUTHORING_SYSTEM_PROMPT,
            INSTRUCTION_AUTHORING_USER_PROMPT.format(
                rules=rules_engine.summary_lines(rules) or "None.",
                requirements=_requirements_block(ctx),
                agent_name=spec.agent_name or "Assistant",
                tier=spec.tier or "domain",
                description=spec.description or "",
                user_query=ctx.query,
                tool_detail=caps["tool_detail"],
                connector_detail=caps["connector_detail"],
                library_detail=caps["library_detail"],
                knowledge_graph=caps["knowledge_graph"],
            ),
        )

    def apply(self, ctx: PipelineContext, data: dict) -> None:
        instructions = data.get("agent_instructions")
        if not isinstance(instructions, str):
            instructions = str(instructions or "")
        instructions = instructions.strip()

        if len(instructions) < _MIN_INSTRUCTION_CHARS:
            logger.warning(
                "Authored instructions too short (%d chars) — using composed fallback",
                len(instructions),
            )
            instructions = self._compose(ctx)

        ctx.agent_spec.agent_instructions = instructions
        ctx.agent_spec.rationale["instructions"] = str(data.get("reasoning") or "")
        logger.info("Instructions authored: %d chars", len(instructions))

    def fallback(self, ctx: PipelineContext) -> None:
        ctx.agent_spec.agent_instructions = self._compose(ctx)

    # ── Composed fallback ───────────────────────────────────────────────

    def _compose(self, ctx: PipelineContext) -> str:
        """Build instructions from the decisions that did succeed.

        Every other layer's output is already specific — the tier, the
        deliverable, the success criteria, the safety envelope. Composing them
        yields something far closer to the intent than the old fallback, which
        could only restate the agent's own name back at it.
        """
        spec = ctx.agent_spec
        req = ctx.requirements
        caps = describe_capabilities(ctx)

        name = spec.agent_name or "Assistant"
        domain = (req.domain if req else "") or "the user's subject area"
        deliverable = (req.deliverable if req else "") or "a clear, accurate answer"
        task_type = (req.task_type if req else "") or "conversation"

        approaches = {
            "lookup": (
                "Locate the specific fact requested. Verify it against a second "
                "source where one is available. Report it with its source."
            ),
            "analysis": (
                "Establish what the data actually says. Perform the analysis "
                "step by step. Interpret the result, and state your confidence "
                "and any caveat that affects how it should be read."
            ),
            "generation": (
                "Outline the structure first. Draft against that outline. Check "
                "the draft against every stated constraint, then revise."
            ),
            "transformation": (
                "Parse the input completely before transforming anything. Map it "
                "to the target structure. Verify that nothing was dropped."
            ),
            "conversation": (
                "Establish what the user already knows, answer at that level, "
                "and offer the most useful next step."
            ),
        }
        approach = approaches.get(task_type, approaches["conversation"])

        if spec.tools:
            approach += (
                f" You have these tools available: {caps['tool_detail']}. Call a "
                f"tool whenever it would give you a fact you would otherwise "
                f"have to assume."
            )

        criteria = (req.success_criteria if req else []) or []
        criteria_block = (
            "\n".join(f"  - {c}" for c in criteria)
            if criteria
            else "  - The answer directly addresses what was asked."
        )

        # Task constraints only. Content moderation is enforced by the
        # platform's guardrail, configured separately and applied outside the
        # model, so restating it here would add nothing enforceable.
        constraints = list((req.constraints if req else []) or [])
        constraints_block = "\n".join(f"- {c}" for c in constraints) or (
            "- Do not fabricate figures, sources, or quotations."
        )

        unknowns = (req.unknowns if req else []) or []
        unknowns_block = (
            " State these assumptions explicitly where they apply: "
            + "; ".join(unknowns)
            + "."
            if unknowns
            else ""
        )

        return (
            f"ROLE:\n"
            f"You are {name}, a specialist in {domain}.\n\n"
            f"TASK:\n"
            f"Produce {deliverable} The work is complete when all of the "
            f"following are true:\n{criteria_block}\n\n"
            f"REASONING APPROACH:\n{approach}\n\n"
            f"OUTPUT FORMAT:\n"
            f"Respond in markdown. Lead with the answer itself, then supporting "
            f"detail under clear headings. Use bullet points for lists and a "
            f"table where you are comparing items across the same dimensions. "
            f"Keep it as short as the question allows.\n\n"
            f"CONSTRAINTS:\n{constraints_block}\n\n"
            f"FALLBACK:\n"
            f"If information is uncertain or unavailable, state the assumption "
            f"you are making and continue on that basis.{unknowns_block} Never "
            f"return an empty response."
        )
