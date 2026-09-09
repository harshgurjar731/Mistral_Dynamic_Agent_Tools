"""
Pipeline — The executor that chains layers together in middleware fashion.

Usage::

    pipeline = Pipeline()
    pipeline.add(RequirementAnalysisLayer())
    pipeline.add(ExecutionLayer())

    ctx = PipelineContext(query="Hello")
    ctx = await pipeline.execute(ctx)
"""

from __future__ import annotations

import logging
import time
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

    def manifest(self) -> list[dict]:
        """The ordered chain, as the UI should draw it before the run starts."""
        return [layer.describe() for layer in self._layers]

    async def execute(self, ctx: PipelineContext) -> PipelineContext:
        """Run all layers in sequence, middleware-style.

        Each layer receives a ``next`` callable.  When it calls
        ``await next(ctx)``, the *next* layer in the chain is invoked.
        The last layer's ``next`` is a no-op that simply returns the context.

        The chain is announced to the client up front and each layer's state
        change is emitted as it happens, so the UI can show the whole pipeline
        with the current position marked rather than an append-only log.
        """
        ctx.emit("pipeline", {"layers": self.manifest()})

        # Build the middleware chain from the inside out (last layer first).
        async def _terminal(c: PipelineContext) -> PipelineContext:
            return c

        chain: NextFn = _terminal

        for layer in reversed(self._layers):
            # Capture ``layer`` and ``chain`` via default args to avoid
            # late-binding closure issues.
            def _make_next(current_layer: Layer, downstream: NextFn) -> NextFn:
                async def _next(c: PipelineContext) -> PipelineContext:
                    if not current_layer.should_run(c):
                        c.emit_layer(current_layer.name, "skipped")
                        return await downstream(c)

                    c.emit_layer(current_layer.name, "active")
                    started = time.monotonic()
                    settled = False

                    def _settle(state: str, **kw) -> None:
                        nonlocal settled
                        if settled:
                            return
                        settled = True
                        c.emit_layer(
                            current_layer.name, state,
                            ms=(time.monotonic() - started) * 1000,
                            summary=c.layer_summary(current_layer.name),
                            **kw,
                        )

                    async def _handoff(inner: PipelineContext) -> PipelineContext:
                        # A layer calling next() has finished its own work. This
                        # is the moment it completed — not when process() returns,
                        # which for a wrapping layer is after the entire rest of
                        # the pipeline has run.
                        _settle("completed")
                        return await downstream(inner)

                    try:
                        result = await current_layer.process(c, _handoff)
                    except Exception as e:
                        _settle("failed", error=str(e))
                        raise
                    # A layer that short-circuited without calling next() still
                    # finished; settle it here.
                    _settle("completed")
                    return result
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
