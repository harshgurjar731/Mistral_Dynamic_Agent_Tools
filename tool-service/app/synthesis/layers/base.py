"""
The layer framework for the code-generation pipeline.

Same shape as the backend's orchestration layers (``backend/app/core/layer.py``):
each layer receives the context, does its one job, and calls ``next(ctx)`` —
or returns without calling it to stop the pipeline with a result. Synchronous,
because a synthesis job runs on a worker thread and every step in it (a model
call, a sandbox process) blocks anyway.
"""

from __future__ import annotations

import logging
import time
from dataclasses import dataclass, field
from typing import Any, Callable, Optional

from app.synthesis.profiles import CodeProfile
from app.synthesis.spec import Candidate, SynthesisSpec, Verdict
from app.synthesis.testplan import TestPlan

logger = logging.getLogger(__name__)

NextFn = Callable[["SynthesisContext"], "SynthesisContext"]
EmitFn = Callable[[str, str, Optional[dict]], None]


@dataclass
class SynthesisContext:
    """Everything a synthesis job knows, passed from layer to layer."""

    spec: SynthesisSpec
    profile: CodeProfile
    session_factory: Callable
    emit_fn: Optional[EmitFn] = None
    job_id: Optional[str] = None
    started: float = field(default_factory=time.monotonic)
    deadline: float = 0.0

    spec_hash: str = ""
    warnings: list[str] = field(default_factory=list)
    plan: Optional[TestPlan] = None
    candidate: Candidate = field(default_factory=Candidate)
    verdict: Optional[Verdict] = None
    #: Highest-scoring verified-or-not code seen, reported when the budget runs out.
    best_code: str = ""
    best_verdict: Optional[Verdict] = None
    arbitration: list[dict] = field(default_factory=list)
    #: G7's reference implementation's output per example (None: not yet run).
    reference_outputs: Optional[dict] = None
    #: Worked examples G7 corrected: [{"case_id", "was", "now"}].
    corrections: list[dict] = field(default_factory=list)
    review: Any = None
    #: (tool_id, version_no, status) once G9 has stored the version.
    registered: Optional[tuple] = None
    #: The job's answer. A layer that sets it and returns ends the pipeline.
    result: Optional[dict] = None

    def emit(self, stage: str, message: str, data: Optional[dict] = None) -> None:
        logger.info("[%s] %s: %s", self.spec.name, stage, message)
        if self.emit_fn:
            try:
                self.emit_fn(stage, message, data)
            except Exception:  # noqa: BLE001 — progress must never break a job
                logger.debug("progress emit failed", exc_info=True)

    def seconds_left(self) -> float:
        return self.deadline - time.monotonic()

    def finish(self, status: str, message: str, **extra) -> "SynthesisContext":
        self.result = {"status": status, "tool_name": self.spec.name, "purpose": self.spec.purpose,
                       "message": message, "warnings": list(self.warnings), **extra}
        return self


class Layer:
    name: str = "layer"
    label: str = ""

    def process(self, ctx: SynthesisContext, next: NextFn) -> SynthesisContext:
        raise NotImplementedError


class Pipeline:
    def __init__(self, layers: list[Layer]):
        self.layers = layers

    def run(self, ctx: SynthesisContext) -> SynthesisContext:
        def step(index: int) -> NextFn:
            def _next(c: SynthesisContext) -> SynthesisContext:
                if index >= len(self.layers) or c.result is not None:
                    return c
                layer = self.layers[index]
                c.emit("layer", layer.label or layer.name, {"layer": layer.name})
                return layer.process(c, step(index + 1))
            return _next

        return step(0)(ctx)
