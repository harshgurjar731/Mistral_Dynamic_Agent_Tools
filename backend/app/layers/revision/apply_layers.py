"""
RevisionApplyLayer and RevisionNormaliseLayer — carry the edits out, then repair.

No LLM. Applying works on a copy of the base definition; the stored workflow
is untouched. Normalising is separate because it is a different promise:
applying does what was asked, normalising guarantees the result obeys the same
invariants a planned workflow does (no links to missing steps, parallel groups
that converge, an entry step that exists) whatever was asked.
"""

import logging

from app.core.context import PipelineContext
from app.layers.revision.base import RevisionStepLayer
from app.workflow_revisions import operations as ops

logger = logging.getLogger(__name__)


class RevisionApplyLayer(RevisionStepLayer):
    """Apply each edit operation to a copy of the workflow."""

    name = "revision_apply"
    label = "Make the edits"
    detail = "Applies each edit to a copy of the workflow, rewiring around added and removed steps."

    async def process(self, ctx: PipelineContext, next):
        spec = ctx.revision_spec
        result = ops.apply_operations(spec.base, spec.operations, repair=False)
        spec.proposed = result.definition
        spec.outcomes = result.outcomes
        if not spec.summary:
            # A direct edit has no model-written summary; its outcomes are one.
            spec.summary = " ".join(o["note"] for o in result.outcomes if o["ok"])[:600]

        failed = result.failed
        if result.applied == 0:
            spec.status = "failed"
            reasons = "; ".join(f["note"] for f in failed) or "there was nothing to apply"
            ctx.error = f"None of the edits could be made: {reasons}"
        ctx.set_layer_summary(
            self.name,
            f"{result.applied} of {len(result.outcomes)} edit(s) applied"
            + (f" — {len(failed)} could not be: " + "; ".join(f["note"] for f in failed)
               if failed else ""),
        )
        return await next(ctx)


class RevisionNormaliseLayer(RevisionStepLayer):
    """Repair dangling links, divergent groups and a missing entry step."""

    name = "revision_normalise"
    label = "Keep the graph whole"
    detail = "Repairs links, parallel groups and the entry step the edits left inconsistent."

    async def process(self, ctx: PipelineContext, next):
        spec = ctx.revision_spec
        notes = ops.normalise(spec.proposed)
        notes += ops.dangling_references(spec.proposed)
        spec.notes = notes
        ctx.set_layer_summary(self.name, " ".join(notes) if notes else "Nothing needed repairing.")
        return await next(ctx)
