"""
Layer — Abstract base class for pipeline layers + ParallelGroup.

Every pipeline feature is implemented as a Layer subclass.  Layers follow the
middleware pattern: receive context, do work, call ``await next(ctx)`` to pass
control downstream, and optionally post-process.
"""

from __future__ import annotations

import asyncio
import logging
import time
from abc import ABC, abstractmethod
from typing import Callable, Awaitable

from app.core.context import PipelineContext

logger = logging.getLogger(__name__)

# Type alias for the "next" function passed to each layer.
NextFn = Callable[[PipelineContext], Awaitable[PipelineContext]]


async def _noop_next(ctx: PipelineContext) -> PipelineContext:
    """A no-op next function used as the terminal in parallel branches."""
    return ctx


class Layer(ABC):
    """Abstract base class that all pipeline layers implement."""

    name: str = "unnamed"
    enabled: bool = True

    #: Human-readable name for this step, shown in the UI timeline.
    #: Defaults to the machine name with underscores turned into spaces.
    label: str = ""

    #: One line describing the single decision this layer makes. The timeline
    #: shows it under the label, so a user watching a run can see what the
    #: pipeline is deciding rather than only that it is busy.
    detail: str = ""

    #: False for layers with no user-facing meaning. A wrapping layer sorts
    #: first in the chain because it encloses everything after it, which in a
    #: timeline reads as "this is the opening step" — the opposite of what it
    #: is. Such layers are kept out of the drawn chain.
    timeline: bool = True

    def describe(self) -> dict:
        """Manifest entry for this layer, sent to the UI before the run starts."""
        return {
            "name": self.name,
            "label": self.label or self.name.replace("_", " ").title(),
            "detail": self.detail,
            "hidden": not self.timeline,
        }

    @abstractmethod
    async def process(self, ctx: PipelineContext, next: NextFn) -> PipelineContext:
        """Process the context and call ``next(ctx)`` to continue the pipeline.

        A layer may:
        - **Pre-process**: modify ctx before calling next
        - **Short-circuit**: return ctx without calling next (e.g., cache hit)
        - **Post-process**: transform ctx after next returns
        """
        ...

    def should_run(self, ctx: PipelineContext) -> bool:
        """Override to conditionally skip this layer."""
        return self.enabled


class ParallelGroup(Layer):
    """Run multiple layers concurrently via ``asyncio.gather``.

    Each layer in the group receives a *snapshot* of the input context so they
    can write without data races.  After all complete, results are merged back
    into the original context in deterministic order (insertion order of
    ``self.layers``).

    After the group finishes, ``next(ctx)`` is called to continue the pipeline.
    """

    def __init__(self, name: str, layers: list[Layer], label: str = "", detail: str = ""):
        self.name = name
        self.layers = layers
        self.label = label
        self.detail = detail

    def describe(self) -> dict:
        """Manifest entry naming this group and every branch inside it.

        The UI draws the branches as one concurrent block rather than a
        sequence, so it needs to know they belong together — a flat list would
        misrepresent five simultaneous decisions as five successive ones.
        """
        entry = super().describe()
        entry["concurrent"] = [l.describe() for l in self.layers]
        return entry

    async def process(self, ctx: PipelineContext, next: NextFn) -> PipelineContext:
        ctx.emit_layer(self.name, "active")

        async def _run_one(layer: Layer) -> PipelineContext | None:
            if not layer.should_run(ctx):
                ctx.emit_layer(layer.name, "skipped")
                return None
            # Branches emit onto the shared queue rather than their snapshot's
            # event list, so their progress reaches the client as it happens
            # instead of arriving in a batch once the whole group settles.
            ctx.emit_layer(layer.name, "active")
            branch_ctx = ctx.snapshot()
            started = time.monotonic()
            from app.observability import tracing

            with tracing.span(
                f"layer {layer.name}", kind="layer",
                attrs={"app.layer.name": layer.name, "app.layer.group": self.name,
                       "app.layer.label": layer.describe().get("label")},
            ) as span:
                try:
                    result = await layer.process(branch_ctx, _noop_next)
                    # The branch wrote its summary onto its own snapshot, which is
                    # merged back only after the whole group settles — read it
                    # across now so this branch's row can carry its reasoning.
                    summary = result.layer_summary(layer.name) if result else ""
                    ms = (time.monotonic() - started) * 1000
                    ctx.emit_layer(layer.name, "completed", ms=ms, summary=summary)
                    tracing.set_attrs(span, {"app.layer.state": "completed", "app.layer.summary": summary or None,
                                             "app.layer.duration_ms": round(ms, 1)})
                    return result
                except Exception as e:
                    logger.exception("Layer '%s' failed inside ParallelGroup '%s'", layer.name, self.name)
                    ctx.emit_layer(layer.name, "failed", error=str(e))
                    span.set_attribute("app.layer.state", "failed")
                    tracing.mark_error(span, e)
                    return None

        started = time.monotonic()
        results = await asyncio.gather(*[_run_one(l) for l in self.layers])

        for result in results:
            if result is not None:
                ctx.merge(result)

        ctx.emit_layer(self.name, "completed", ms=(time.monotonic() - started) * 1000)
        return await next(ctx)
