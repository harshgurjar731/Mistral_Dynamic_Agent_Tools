"""
Base classes for the revision layers.

As in the planning chain, a layer that runs after an upstream failure does
worse than nothing — validating or diffing a definition no edit was applied to
would present "no changes" as a result. Both bases below refuse to run once
the revision has stopped: an error was set, or the instruction needs
clarifying before anything can be changed.
"""

from app.core.context import PipelineContext
from app.core.decision import DecisionLayer
from app.core.layer import Layer


def revision_ready(ctx: PipelineContext) -> bool:
    """True while the revision is still producing a proposal."""
    spec = ctx.revision_spec
    return ctx.error is None and spec is not None and spec.status == "proposed"


class RevisionDecisionLayer(DecisionLayer):
    """A revision layer whose work is one focused LLM decision."""

    def should_run(self, ctx: PipelineContext) -> bool:
        return self.enabled and revision_ready(ctx)


class RevisionStepLayer(Layer):
    """A revision layer that does deterministic work."""

    def should_run(self, ctx: PipelineContext) -> bool:
        return self.enabled and revision_ready(ctx)
