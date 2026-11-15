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

import copy
import logging
import time
from typing import Optional, Union

from app.core.context import PipelineContext
from app.core.layer import Layer, NextFn
from app.core.stages import (
    MAX_REWINDS,
    REPAIR_ISSUES_KEY,
    REWIND_COUNT_KEY,
    REWIND_KEY,
    Stage,
)

logger = logging.getLogger(__name__)


class Pipeline:
    """Ordered chain of Layer instances executed in middleware (onion) style."""

    def __init__(self, name: str = "pipeline") -> None:
        #: Names the pipeline's trace on Mistral ("pipeline agent_chat").
        self.name = name
        self._layers: list[Layer] = []
        #: Top-level entries in order — a Stage or a stage-less Layer — for the manifest.
        self._entries: list[Union[Stage, Layer]] = []
        #: layer name → the stage it belongs to.
        self._stage_of: dict[str, Stage] = {}

    # ── Registration ────────────────────────────────────────────────────

    def add(
        self,
        layer: Union[Layer, Stage],
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
        if isinstance(layer, Stage):
            # A stage: its layers join the flat chain, in order; the stage itself
            # is only how they are grouped for the timeline.
            self._entries.append(layer)
            for child in layer.layers:
                self._stage_of[child.name] = layer
                self._layers.append(child)
            return self

        anchor = before or after
        if anchor:
            for i, existing in enumerate(self._layers):
                if existing.name == anchor:
                    self._layers.insert(i if before else i + 1, layer)
                    stage = self._stage_of.get(anchor)
                    if stage is not None:
                        # Inserted beside a layer of a stage: it belongs to that stage.
                        j = [c.name for c in stage.layers].index(anchor)
                        stage.layers.insert(j if before else j + 1, layer)
                        self._stage_of[layer.name] = stage
                    else:
                        k = next(n for n, e in enumerate(self._entries) if e is existing)
                        self._entries.insert(k if before else k + 1, layer)
                    return self
            logger.warning("Layer '%s' not found for positioning; appending '%s' at end", anchor, layer.name)

        self._layers.append(layer)
        self._entries.append(layer)
        return self

    def remove(self, name: str) -> "Pipeline":
        """Remove a layer by name.

        Returns
        -------
        Pipeline
            ``self``, for fluent chaining.
        """
        self._layers = [l for l in self._layers if l.name != name]
        self._entries = [e for e in self._entries if not (isinstance(e, Layer) and e.name == name)]
        stage = self._stage_of.pop(name, None)
        if stage is not None:
            stage.layers = [c for c in stage.layers if c.name != name]
        return self

    # ── Execution ───────────────────────────────────────────────────────

    def manifest(self) -> list[dict]:
        """The ordered chain, as the UI should draw it: stages with their layers nested."""
        return [entry.describe() for entry in self._entries]

    def flat_manifest(self) -> list[dict]:
        """Every layer, in run order, without the stage grouping."""
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

        # Stage rows: active when their first layer starts, settled when their
        # last one does. Reset for the stages a rewind runs again.
        stage_runs: dict[str, dict] = {}

        def _stage_start(c: PipelineContext, layer_name: str) -> None:
            stage = self._stage_of.get(layer_name)
            if stage is None or stage.name in stage_runs:
                return
            stage_runs[stage.name] = {"started": time.monotonic(), "settled": set(), "failed": False}
            c.emit_layer(stage.name, "active")

        def _stage_settle(c: PipelineContext, layer_name: str, state: str) -> None:
            stage = self._stage_of.get(layer_name)
            if stage is None:
                return
            if stage.name not in stage_runs:
                _stage_start(c, layer_name)
            run = stage_runs[stage.name]
            run["settled"].add(layer_name)
            run["failed"] = run["failed"] or state == "failed"
            if run["settled"] >= {child.name for child in stage.layers}:
                c.emit_layer(stage.name, "failed" if run["failed"] else "completed",
                             ms=(time.monotonic() - run["started"]) * 1000)

        # The spec as it was before each rewindable layer, so a later layer can
        # send the run back to it (see app.core.stages).
        snapshots: dict[str, tuple] = {}

        def _snapshot(c: PipelineContext, layer_name: str) -> None:
            meta = {}
            for key, value in c.metadata.items():
                try:
                    meta[key] = copy.deepcopy(value)
                except Exception:  # noqa: BLE001 — an uncopyable value is restored by reference
                    meta[key] = value
            snapshots[layer_name] = (copy.deepcopy(c.workflow_spec), meta)

        def _restore(c: PipelineContext, layer_name: str) -> None:
            spec, meta = snapshots[layer_name]
            keep = {k: c.metadata.get(k) for k in (REPAIR_ISSUES_KEY, REWIND_COUNT_KEY)}
            c.workflow_spec = copy.deepcopy(spec)
            c.metadata.clear()
            c.metadata.update(copy.deepcopy(meta) if meta else {})
            c.metadata.update({k: v for k, v in keep.items() if v is not None})

        index_of = {layer.name: i for i, layer in enumerate(self._layers)}
        chain_at: dict[int, NextFn] = {}

        async def _rewind(c: PipelineContext, request: dict) -> Optional[PipelineContext]:
            """Run the chain again from the earliest responsible layer, or None to go on."""
            targets = [t for t in request.get("issues", {})
                       if t in snapshots and t in index_of]
            if not targets or int(c.metadata.get(REWIND_COUNT_KEY) or 0) >= MAX_REWINDS:
                return None
            target = min(targets, key=lambda t: index_of[t])
            count = int(c.metadata.get(REWIND_COUNT_KEY) or 0) + 1
            _restore(c, target)
            c.metadata[REWIND_COUNT_KEY] = count
            c.metadata.setdefault(REPAIR_ISSUES_KEY, {}).update(request["issues"])
            rerun = [layer.name for layer in self._layers[index_of[target]:]]
            for name in {self._stage_of[n].name for n in rerun if n in self._stage_of}:
                stage_runs.pop(name, None)
            c.emit("rewind", {
                "to": target, "from": request.get("from"), "round": count,
                "reason": request.get("reason") or "",
                "issues": {k: v[:10] for k, v in request["issues"].items()},
                "reset": rerun,
            })
            c.emit("status", f"Going back to fix {len(sum(request['issues'].values(), []))} "
                             f"problem(s) found by the checks (round {count} of {MAX_REWINDS})…")
            return await chain_at[index_of[target]](c)

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
                        _stage_start(c, current_layer.name)
                        c.emit_layer(current_layer.name, "skipped")
                        _stage_settle(c, current_layer.name, "skipped")
                        tracing.event_span(
                            f"layer {current_layer.name}", kind="layer",
                            attrs={"app.layer.name": current_layer.name, "app.layer.state": "skipped"},
                        )
                        return await downstream(c)

                    if getattr(current_layer, "rewindable", False):
                        _snapshot(c, current_layer.name)
                    _stage_start(c, current_layer.name)
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
                        _stage_settle(c, current_layer.name, state)
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
                    # It stopped to send the run back to an earlier layer.
                    request = result.metadata.pop(REWIND_KEY, None) if result is not None else None
                    if request and request.get("from") == current_layer.name:
                        rerun = await _rewind(result, request)
                        if rerun is not None:
                            return rerun
                        # Rewinds are spent: carry on with what there is.
                        return await downstream(result)
                    return result
                return _next

            chain = _make_next(layer, chain)
            chain_at[index_of[layer.name]] = chain

        return await chain(ctx)

    # ── Introspection ───────────────────────────────────────────────────

    @property
    def layer_names(self) -> list[str]:
        """Return the ordered list of layer names (useful for debugging)."""
        return [l.name for l in self._layers]

    def __repr__(self) -> str:
        return f"Pipeline({' -> '.join(self.layer_names)})"
