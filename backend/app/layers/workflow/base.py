"""
Base classes for the workflow planning layers.

The chain is long and each link depends on the one before it, so a layer that
runs after an upstream failure does not degrade gracefully — it plans against
an empty capability list and produces a workflow with no steps, which is worse
than the error it was hiding.

Both bases below refuse to run once ``ctx.error`` is set. The pipeline still
walks to the end (the adapter needs the events), but every remaining layer
passes straight through.
"""

import logging

from app.core.context import PipelineContext
from app.core.decision import DecisionLayer
from app.core.layer import Layer

logger = logging.getLogger(__name__)


def workflow_ready(ctx: PipelineContext) -> bool:
    """True when planning is still viable."""
    return ctx.error is None and ctx.workflow_spec is not None


class WorkflowDecisionLayer(DecisionLayer):
    """A workflow layer whose work is one focused LLM decision."""

    def should_run(self, ctx: PipelineContext) -> bool:
        return self.enabled and workflow_ready(ctx)


class WorkflowStepLayer(Layer):
    """A workflow layer that does deterministic work — I/O, validation, saving."""

    def should_run(self, ctx: PipelineContext) -> bool:
        return self.enabled and workflow_ready(ctx)
