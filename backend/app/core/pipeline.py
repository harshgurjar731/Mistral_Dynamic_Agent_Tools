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

    def __init__(self, name: str = "pipeline") -> None:
        #: Names the pipeline's trace on Mistral ("pipeline agent_chat").
        self.name = name
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

        Traced on Mistral as one ``pipeline`` span with a child span per layer.
        A layer's span covers its own work only — it ends when the layer hands
        off — and the layers after it nest under the pipeline, not inside it,
        so the trace reads as the sequence it is rather than an onion.
        """
        from app.observability import tracing

        attrs = {
            "app.pipeline.name": self.name,
            "app.pipeline.layers": self.layer_names,
            "app.pipeline.query": ctx.query,
            "app.pipeline.tier": ctx.tier,
            "gen_ai.agent.id": ctx.agent_id,
            "gen_ai.conversation.id": ctx.conversation_id,
            "app.pipeline.stream": ctx.stream,
        }
        with tracing.span(f"pipeline {self.name}", kind="pipeline", attrs=attrs) as pipeline_span, \
                tracing.rule_tally() as tally:
            try:
                result = await self._execute(ctx, pipeline_span)
            finally:
                final = ctx
                tracing.set_attrs(pipeline_span, {
                    "app.pipeline.created_agent_id": final.created_agent_id,
                    "app.pipeline.response": final.response_text,
                    "app.pipeline.result": final.result or None,
                    "app.pipeline.error": final.error,
                    "app.pipeline.workflow_spec": final.workflow_spec,
                    **tracing.tally_attrs(tally),
                })
                if final.error:
                    tracing.mark_error(pipeline_span, final.error, error_type="pipeline_error")
            return result

    async def _execute(self, ctx: PipelineContext, pipeline_span) -> PipelineContext:
        from opentelemetry import context as otel_context, trace as otel_trace

        from app.observability import tracing

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
                        tracing.event_span(
                            f"layer {current_layer.name}", kind="layer",
                            attrs={"app.layer.name": current_layer.name, "app.layer.state": "skipped"},
                        )
                        return await downstream(c)

                    c.emit_layer(current_layer.name, "active")
                    started = time.monotonic()
                    settled = False
                    describe = current_layer.describe()
                    layer_span = tracing.start_detached(
                        f"layer {current_layer.name}", kind="layer", parent_span=pipeline_span,
                        attrs={
                            "app.layer.name": current_layer.name,
                            "app.layer.label": describe.get("label"),
                            "app.layer.detail": describe.get("detail") or None,
                            "app.layer.concurrent": [b["name"] for b in describe.get("concurrent", [])] or None,
                        },
                    )
                    # The layer's own work — its model calls, rule verdicts —
                    # nests under its span.
                    token = otel_context.attach(otel_trace.set_span_in_context(layer_span))
                    log_handle = tracing.begin_logs()

                    def _settle(state: str, **kw) -> None:
                        nonlocal settled
                        if settled:
                            return
                        settled = True
                        ms = (time.monotonic() - started) * 1000
                        summary = c.layer_summary(current_layer.name)
                        c.emit_layer(current_layer.name, state, ms=ms, summary=summary, **kw)
                        tracing.set_attrs(layer_span, {
                            "app.layer.state": state,
                            "app.layer.duration_ms": round(ms, 1),
                            "app.layer.summary": summary or None,
                        })
                        if state == "failed":
                            tracing.mark_error(layer_span, kw.get("error") or "Layer failed", error_type="layer_failed")
                        tracing.finish_logs(layer_span, log_handle)
                        layer_span.end()

                    async def _handoff(inner: PipelineContext) -> PipelineContext:
                        # A layer calling next() has finished its own work. This
                        # is the moment it completed — not when process() returns,
                        # which for a wrapping layer is after the entire rest of
                        # the pipeline has run.
                        _settle("completed")
                        with otel_trace.use_span(pipeline_span, end_on_exit=False):
                            return await downstream(inner)

                    try:
                        result = await current_layer.process(c, _handoff)
                    except Exception as e:
                        _settle("failed", error=str(e))
                        raise
                    finally:
                        try:
                            otel_context.detach(token)
                        except Exception:
                            pass
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
