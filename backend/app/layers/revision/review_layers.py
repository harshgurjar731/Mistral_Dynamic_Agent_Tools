"""
Validation, diff and proposal — what the user reviews before anything is saved.

No LLM. Validation uses the same structural checks and workflow rules as save
and publish, and also says which issues the change fixes and which it
introduces, so a proposal reads as "fixes 2 problems, adds 1" rather than as a
bare list. The diff is semantic (``app.workflow_revisions.diff``). The proposal
layer always runs — even after a failure or a clarifying question — so every
turn is recorded and the user is always told what happened.
"""

import asyncio
import json
import logging

from app.core.context import PipelineContext
from app.core.layer import Layer
from app.layers.revision.base import RevisionStepLayer

logger = logging.getLogger(__name__)


def _issue_key(issue: dict) -> tuple:
    return issue.get("code"), issue.get("step_id")


class RevisionValidationLayer(RevisionStepLayer):
    """Validate the proposed definition, and compare its issues with the base's."""

    name = "revision_validation"
    label = "Check it still runs"
    detail = "Runs the same structural checks and workflow rules as publishing."

    async def process(self, ctx: PipelineContext, next):
        from pydantic import ValidationError

        from app.services.workflow_engine.models import WorkflowDefinition
        from app.services.workflow_engine.rule_validation import validate_with_rules

        spec = ctx.revision_spec
        try:
            definition = WorkflowDefinition(**spec.proposed)
        except ValidationError as e:
            first = e.errors()[0] if e.errors() else {}
            message = f"{'.'.join(str(p) for p in first.get('loc', ()))}: {first.get('msg', e)}"
            spec.validation = {
                "valid": False, "error_count": 1, "warning_count": 0,
                "issues": [{"severity": "error", "code": "workflow.malformed",
                            "message": f"The edited workflow is malformed — {message}",
                            "step_id": None, "field": None}],
                "introduced": [], "resolved": [],
            }
            ctx.set_layer_summary(self.name, "The edits produced a malformed workflow.")
            return await next(ctx)

        result = await validate_with_rules(definition, client=ctx.client)
        issues = [i.model_dump() for i in result.issues]

        before_errors = {_issue_key(i) for i in spec.base_issues if i.get("severity") == "error"}
        after_errors = {_issue_key(i) for i in issues if i.get("severity") == "error"}
        before_all = {_issue_key(i) for i in spec.base_issues}
        after_all = {_issue_key(i) for i in issues}

        spec.validation = {
            **result.model_dump(),
            "issues": issues,
            # Problems this change creates, and ones it clears.
            "introduced": [i for i in issues if _issue_key(i) not in before_all],
            "resolved": [i for i in spec.base_issues if _issue_key(i) not in after_all],
        }
        fixed = len(before_errors - after_errors)
        added = len(after_errors - before_errors)
        ctx.set_layer_summary(
            self.name,
            ("Valid" if result.valid else f"{result.error_count} error(s)")
            + f", {result.warning_count} warning(s)"
            + (f" — fixes {fixed} error(s)" if fixed else "")
            + (f" — introduces {added} error(s)" if added else ""),
        )
        return await next(ctx)


class RevisionDiffLayer(RevisionStepLayer):
    """Compute exactly what the proposal would change."""

    name = "revision_diff"
    label = "Compare"
    detail = "Lists every step, link and input the change adds, removes or edits."

    async def process(self, ctx: PipelineContext, next):
        from app.workflow_revisions.diff import diff_definitions

        spec = ctx.revision_spec
        spec.diff = diff_definitions(spec.base, spec.proposed)
        if not spec.diff["changed"]:
            spec.status = "failed"
            ctx.error = "That would not change the workflow — it already works that way."
            ctx.set_layer_summary(self.name, "No change.")
            return await next(ctx)

        stats = spec.diff["stats"]
        parts = [f"{n} {label}" for n, label in (
            (stats["added"], "added"), (stats["removed"], "removed"),
            (stats["modified"], "modified"), (stats["edges"], "link change(s)"),
            (stats["inputs"], "input change(s)"),
        ) if n]
        ctx.set_layer_summary(self.name, ", ".join(parts))
        return await next(ctx)


class RevisionProposalLayer(Layer):
    """Record the outcome — proposal, question or failure — for the user."""

    name = "revision_proposal"
    label = "Propose"
    detail = "Records the proposed change for you to review, apply or discard."

    def should_run(self, ctx: PipelineContext) -> bool:
        spec = ctx.revision_spec
        # Nothing to record when the workflow itself could not be read.
        return self.enabled and spec is not None and bool(spec.base)

    async def process(self, ctx: PipelineContext, next):
        from app.workflow_revisions import store

        spec = ctx.revision_spec
        status = spec.status
        if ctx.error and status == "proposed":
            status = "failed"
        spec.status = status

        record = await asyncio.to_thread(
            store.create_revision,
            spec.workflow_name,
            instruction=spec.instruction,
            origin=spec.origin,
            focus_step_ids=spec.focus_step_ids,
            status=status,
            base_hash=spec.base_hash,
            summary=spec.summary or None,
            clarification=spec.clarification or None,
            reasoning=spec.reasoning or None,
            operations=spec.operations,
            notes=[*(o["note"] for o in spec.outcomes if not o["ok"]), *spec.notes],
            diff=spec.diff,
            validation=spec.validation,
            proposed_definition=spec.proposed if status == "proposed" else None,
            error=ctx.error if status == "failed" else None,
        )
        spec.revision_id = record["id"]
        ctx.emit("revision_proposed", json.dumps({"id": record["id"], "status": status}))
        ctx.set_layer_summary(self.name, {
            "proposed": "Ready for your review.",
            "needs_clarification": "Asked a clarifying question.",
        }.get(status, "Could not produce a change."))
        return await next(ctx)
