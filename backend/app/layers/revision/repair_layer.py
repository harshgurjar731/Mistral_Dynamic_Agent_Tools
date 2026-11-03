"""
RevisionRepairLayer — fix what the edits broke, before the user sees them.

Refine with AI used to stop at one model answer: an operation that could not be
applied, or an edit that left a template reading a variable nothing produces,
went straight into the proposal as "introduces 1 error", and the user had to
ask again. The editor is now shown exactly what went wrong — each failed
operation with its reason, each error the edit introduced — and asked for a
corrected operation list, which is applied to the original workflow and
checked by the same validation as before.

A repair is adopted only when it is strictly better: fewer introduced errors,
or the same number with fewer failed operations — and it still changes
something. At most ``MAX_ROUNDS`` rounds. Edits chosen directly in the UI are
never second-guessed.
"""

from __future__ import annotations

import json
import logging

from app.core.context import PipelineContext
from app.layers.revision.base import RevisionStepLayer
from app.workflow_revisions import operations as ops
from app.workflow_revisions.operations import validate_operation_shape

logger = logging.getLogger(__name__)

MAX_ROUNDS = 2
_MAX_OPERATIONS = 25


def _introduced_errors(validation: dict | None) -> list[dict]:
    return [i for i in (validation or {}).get("introduced") or [] if i.get("severity") == "error"]


def _score(outcomes: list[dict], validation: dict | None) -> tuple[int, int]:
    return len(_introduced_errors(validation)), sum(1 for o in outcomes if not o.get("ok"))


def prepare(base: dict, operations: list[dict]) -> tuple[dict, list[dict], list[str], int]:
    """Apply, normalise and tidy the inputs, as the apply and normalise layers do."""
    result = ops.apply_operations(base, operations, repair=False)
    proposed = result.definition
    notes = ops.normalise(proposed) + ops.dangling_references(proposed)
    notes += finalise_inputs(proposed)
    return proposed, result.outcomes, notes, result.applied


def finalise_inputs(proposed: dict) -> list[str]:
    """Keep the run form accurate after the edits. Returns a note when it changed."""
    try:
        from app.workflow_inputs.designer import finalise_input_schema, registry_catalogue

        before = list(proposed.get("input_schema") or [])
        after = finalise_input_schema(before, proposed.get("steps") or [],
                                      proposed.get("entry_step"),
                                      variables=proposed.get("variables") or {},
                                      catalogue=registry_catalogue())
    except Exception as e:  # noqa: BLE001 — the inputs are a refinement, never a blocker
        logger.warning("Input schema check after revision failed: %s", e)
        return []
    if after == before:
        return []
    proposed["input_schema"] = after
    added = sorted({f["name"] for f in after} - {f.get("name") for f in before})
    return ["Run inputs updated to match the edited steps"
            + (f" (added: {', '.join(added)})" if added else "") + "."]


class RevisionRepairLayer(RevisionStepLayer):
    """Ask the editor to correct operations that failed or introduced errors."""

    name = "revision_repair"
    label = "Fix what the edits broke"
    detail = "Sends failed edits and new errors back to the editor, and keeps a better result."

    def should_run(self, ctx: PipelineContext) -> bool:
        spec = ctx.revision_spec
        return (super().should_run(ctx) and not spec.operations_given
                and spec.proposed is not None)

    async def process(self, ctx: PipelineContext, next):
        spec = ctx.revision_spec
        start = _score(spec.outcomes, spec.validation)
        if start == (0, 0):
            ctx.set_layer_summary(self.name, "Nothing to repair.")
            return await next(ctx)

        rounds = 0
        current = start
        while rounds < MAX_ROUNDS and current != (0, 0):
            rounds += 1
            ctx.emit("status", f"Fixing what the edits broke (round {rounds})…")
            operations, summary = await self._ask(ctx)
            if not operations:
                break
            proposed, outcomes, notes, applied = prepare(spec.base, operations)
            if applied == 0:
                break
            from app.layers.revision.review_layers import validation_of

            validation = await validation_of(spec.base_issues, proposed, ctx.client)
            score = _score(outcomes, validation)
            if score >= current:
                logger.info("Revision repair round %d not better (%s vs %s)", rounds, score, current)
                break
            spec.operations, spec.proposed, spec.outcomes = operations, proposed, outcomes
            spec.notes, spec.validation, current = notes, validation, score
            if summary:
                spec.summary = summary

        ctx.set_layer_summary(
            self.name,
            "Nothing could be improved." if current == start else
            f"Repaired in {rounds} round(s): {start[0]} → {current[0]} new error(s), "
            f"{start[1]} → {current[1]} failed edit(s).",
        )
        return await next(ctx)

    async def _ask(self, ctx: PipelineContext) -> tuple[list[dict], str]:
        from app.core.decision import decide, parse_json
        from app.layers.revision.intent_layer import RevisionIntentLayer
        from app.prompts_decisions import REVISION_REPAIR_ADDENDUM

        spec = ctx.revision_spec
        system, user = RevisionIntentLayer().build_prompt(ctx)
        evidence = {
            "your_operations": spec.operations,
            "what_happened_to_each": [
                {k: o.get(k) for k in ("index", "op", "ok", "note")} for o in spec.outcomes
            ],
            "new_errors": [
                {k: i.get(k) for k in ("code", "step_id", "field", "message")}
                for i in _introduced_errors(spec.validation)
            ],
        }
        user += ("\n\nYOUR PREVIOUS ATTEMPT AND WHAT WENT WRONG:\n"
                 + json.dumps(evidence, indent=2, default=str))
        try:
            raw = await decide(ctx.client, route="workflow_revision",
                               system=system + REVISION_REPAIR_ADDENDUM, user=user,
                               phase="revision repair")
        except Exception as e:  # noqa: BLE001 — the first proposal stands
            logger.warning("Revision repair call failed: %s", e)
            return [], ""
        data = parse_json(raw, None)
        if not isinstance(data, dict):
            return [], ""
        operations = []
        for op in data.get("operations") if isinstance(data.get("operations"), list) else []:
            if validate_operation_shape(op) is None:
                operations.append(op)
        return operations[:_MAX_OPERATIONS], str(data.get("summary") or "").strip()[:600]
