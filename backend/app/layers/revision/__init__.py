"""
Workflow revision layers — change a saved workflow from an instruction.

Chain, as assembled in ``app.layers``:

    RevisionContextLayer     load the workflow, what it can bind, what is wrong (no LLM)
    RevisionIntentLayer      what edits does the instruction mean
    RevisionApplyLayer       carry the edits out on a copy                    (no LLM)
    RevisionNormaliseLayer   repair what the edits left inconsistent          (no LLM)
    RevisionValidationLayer  is the result runnable, and does it follow its rules (no LLM)
    RevisionDiffLayer        what exactly would change                        (no LLM)
    RevisionProposalLayer    record the proposal for the user to review       (no LLM)

The model is asked one thing — which edit operations the instruction means —
and never to produce a definition. Everything after that is deterministic, so
the same operations always produce the same workflow (see
``app.workflow_revisions.operations``).

An edit chosen directly in the UI (remove this step, make these parallel)
arrives with its operations already given; the intent layer then skips, and
the edit gets the same validation, diff and review as one said in words.

Nothing here writes to the stored workflow. Applying a proposal is a separate,
explicit step (``workflow_revision_service.apply``).

Once ``ctx.error`` is set, or the instruction needs clarifying, every layer
up to the proposal passes straight through — the proposal layer always runs,
so the user is told what happened.
"""

from app.layers.revision.apply_layers import RevisionApplyLayer, RevisionNormaliseLayer
from app.layers.revision.context_layer import RevisionContextLayer
from app.layers.revision.intent_layer import RevisionIntentLayer
from app.layers.revision.review_layers import (
    RevisionDiffLayer,
    RevisionProposalLayer,
    RevisionValidationLayer,
)

__all__ = [
    "RevisionContextLayer",
    "RevisionIntentLayer",
    "RevisionApplyLayer",
    "RevisionNormaliseLayer",
    "RevisionValidationLayer",
    "RevisionDiffLayer",
    "RevisionProposalLayer",
]
