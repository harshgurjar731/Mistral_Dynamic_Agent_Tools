"""
Pipeline — The executor that chains layers together in middleware fashion.

Usage::

    pipeline = Pipeline()
    pipeline.add(SynthesisLayer())
    pipeline.add(ExecutionLayer())

    ctx = PipelineContext(query="Hello")
    ctx = await pipeline.execute(ctx)
"""

from __future__ import annotations

import logging
from typing import Optional

from app.core.context import PipelineContext
from app.core.layer import Layer, NextFn

logger = logging.getLogger(__name__)


class Pipeline:
    """Ordered chain of Layer instances executed in middleware (onion) style."""

    def __init__(self) -> None:
        self._layers: list[Layer] = []

    # ── Registration ────────────────────────────────────────────────────

    def add(
        self,
        layer: Layer,
        *,
        before: Optional[str] = None,
        after: Optional[str] = None,
    ) -> "Pipeline":
        """Register a layer.  Optionally position it relative to another.

        Parameters
        ----------
        layer : Layer
            The layer instance to add.
        before : str, optional
            Insert *before* the layer with this name.
        after : str, optional
            Insert *after* the layer with this name.

        Returns
        -------
        Pipeline
            ``self``, for fluent chaining.
        """
        if before:
            for i, existing in enumerate(self._layers):
                if existing.name == before:
                    self._layers.insert(i, layer)
                    return self
            logger.warning("Layer '%s' not found for 'before' positioning; appending '%s' at end", before, layer.name)
        elif after:
            for i, existing in enumerate(self._layers):
                if existing.name == after:
                    self._layers.insert(i + 1, layer)
                    return self
            logger.warning("Layer '%s' not found for 'after' positioning; appending '%s' at end", after, layer.name)

        self._layers.append(layer)
        return self

    def remove(self, name: str) -> "Pipeline":
        """Remove a layer by name.

        Returns
        -------
        Pipeline
            ``self``, for fluent chaining.
        """
        self._layers = [l for l in self._layers if l.name != name]
        return self

    # ── Execution ───────────────────────────────────────────────────────

    async def execute(self, ctx: PipelineContext) -> PipelineContext:
        """Run all layers in sequence, middleware-style.

        Each layer receives a ``next`` callable.  When it calls
        ``await next(ctx)``, the *next* layer in the chain is invoked.
        The last layer's ``next`` is a no-op that simply returns the context.
        """
        # Build the middleware chain from the inside out (last layer first).
        async def _terminal(c: PipelineContext) -> PipelineContext:
            return c

        chain: NextFn = _terminal

        for layer in reversed(self._layers):
            # Capture ``layer`` and ``chain`` via default args to avoid
            # late-binding closure issues.
            def _make_next(current_layer: Layer, downstream: NextFn) -> NextFn:
                async def _next(c: PipelineContext) -> PipelineContext:
                    if current_layer.should_run(c):
                        return await current_layer.process(c, downstream)
                    return await downstream(c)
                return _next

            chain = _make_next(layer, chain)

        return await chain(ctx)

    # ── Introspection ───────────────────────────────────────────────────

    @property
    def layer_names(self) -> list[str]:
        """Return the ordered list of layer names (useful for debugging)."""
        return [l.name for l in self._layers]

    def __repr__(self) -> str:
        return f"Pipeline({' -> '.join(self.layer_names)})"
