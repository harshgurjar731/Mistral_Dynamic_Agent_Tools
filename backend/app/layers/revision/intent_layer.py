"""
RevisionIntentLayer — what edits does the instruction mean?

The one LLM decision in the revision chain. It returns edit operations, never a
definition: a model that regenerated the whole graph to change one step would
also, sooner or later, quietly change three others. Operations name only what
was asked for, and the diff the user reviews shows nothing else.

When the instruction is ambiguous it asks one question instead of guessing.
The question becomes the proposal; the user's answer is the next instruction,
interpreted with this turn in its history.
"""

import json
import logging

from app.core.context import PipelineContext
from app.layers.revision.base import RevisionDecisionLayer
from app.workflow_revisions.operations import validate_operation_shape

logger = logging.getLogger(__name__)

#: Long templates are cut for the prompt — the model needs to know what a step
#: does and reads, not every word of its instructions.
_TEXT_BUDGET = 1200
_MAX_OPERATIONS = 25


def _trim(value):
    if isinstance(value, str) and len(value) > _TEXT_BUDGET:
        return value[:_TEXT_BUDGET] + "…"
    if isinstance(value, dict):
        return {k: _trim(v) for k, v in value.items()}
    if isinstance(value, list):
        return [_trim(v) for v in value]
    return value


def prompt_definition(base: dict) -> dict:
    """The parts of a definition that say what it does."""
    return _trim({k: base.get(k) for k in
                  ("name", "description", "entry_step", "input_schema", "variables", "steps")})


class RevisionIntentLayer(RevisionDecisionLayer):
    """Turn the instruction into edit operations, or one clarifying question."""

    name = "revision_intent"
    label = "Understand the request"
    detail = "Works out exactly which edits your instruction asks for."
    phase = "revision intent"
    status_message = "Working out what to change…"

    def should_run(self, ctx: PipelineContext) -> bool:
        return super().should_run(ctx) and not ctx.revision_spec.operations_given

    def build_prompt(self, ctx: PipelineContext) -> tuple[str, str]:
        from app.prompts_decisions import REVISION_INTENT_SYSTEM_PROMPT, REVISION_INTENT_USER_PROMPT

        spec = ctx.revision_spec
        catalog = spec.catalog or {}
        issues = [
            {k: i.get(k) for k in ("severity", "code", "step_id", "message")}
            for i in spec.base_issues
        ]
        return (
            REVISION_INTENT_SYSTEM_PROMPT,
            REVISION_INTENT_USER_PROMPT.format(
                definition=json.dumps(prompt_definition(spec.base), indent=2),
                issues=json.dumps(issues, indent=2) if issues else "(none)",
                agents=json.dumps(catalog.get("agents") or [], indent=2),
                activities=json.dumps(catalog.get("activities") or [], indent=2),
                connectors=catalog.get("connectors") or "(none available)",
                history=json.dumps(spec.history, indent=2) if spec.history else "(this is the first turn)",
                focus=", ".join(spec.focus_step_ids) or "(none — the whole workflow)",
                instruction=spec.instruction,
            ),
        )

    def apply(self, ctx: PipelineContext, data: dict) -> None:
        spec = ctx.revision_spec
        raw_ops = data.get("operations")
        operations = []
        for op in raw_ops if isinstance(raw_ops, list) else []:
            problem = validate_operation_shape(op)
            if problem:
                logger.warning("Revision intent returned a malformed operation (%s): %s", problem, op)
                continue
            operations.append(op)

        spec.operations = operations[:_MAX_OPERATIONS]
        spec.summary = str(data.get("summary") or "").strip()[:600]
        spec.reasoning = str(data.get("reasoning") or "").strip()[:1200]
        clarification = str(data.get("clarification") or "").strip()[:600]

        if not operations or data.get("understood") is False:
            spec.status = "needs_clarification"
            spec.clarification = clarification or (
                "I could not tell what to change from that. Which step should change, and how?"
            )
            spec.operations = []

    def fallback(self, ctx: PipelineContext) -> None:
        spec = ctx.revision_spec
        spec.status = "failed"
        ctx.error = ("The request could not be interpreted right now — the model did not "
                     "answer. Try again in a moment.")
