"""
Layer — Abstract base class for pipeline layers + ParallelGroup.

Every pipeline feature is implemented as a Layer subclass.  Layers follow the
middleware pattern: receive context, do work, call ``await next(ctx)`` to pass
control downstream, and optionally post-process.
"""

from __future__ import annotations

import asyncio
import logging
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

    def __init__(self, name: str, layers: list[Layer]):
        self.name = name
        self.layers = layers

    async def process(self, ctx: PipelineContext, next: NextFn) -> PipelineContext:
        async def _run_one(layer: Layer) -> PipelineContext | None:
            if not layer.should_run(ctx):
                return None
            branch_ctx = ctx.snapshot()
            try:
                return await layer.process(branch_ctx, _noop_next)
            except Exception:
                logger.exception("Layer '%s' failed inside ParallelGroup '%s'", layer.name, self.name)
                return None

        results = await asyncio.gather(*[_run_one(l) for l in self.layers])

        for result in results:
            if result is not None:
                ctx.merge(result)

        return await next(ctx)
