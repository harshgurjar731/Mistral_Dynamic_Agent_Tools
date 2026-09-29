"""
The code-generation pipeline — G1 to G10, assembled.

    G1  IntakeLayer       the spec is implementable (profile rules)
    G2  IdentityLayer     reuse a version built from this exact spec
    G3  TestPlanLayer     decide what the code will be held to
    G4–G7 BuildLoopLayer  generate → verify → diagnose/repair (→ arbitrate)
    G8  ReviewGateLayer   auto-approve or hold for a person
    G9  RegisterLayer     atomic, versioned install
    G10 PublishLayer      the result

The layers are shared by tools and activities; everything that differs between
the two lives in the profile (``app.synthesis.profiles``) the context carries.
"""

from __future__ import annotations

import logging
import time
from typing import Callable, Optional

from app.config import settings
from app.synthesis.layers import (
    BuildLoopLayer,
    IdentityLayer,
    IntakeLayer,
    Pipeline,
    PublishLayer,
    RegisterLayer,
    ReviewGateLayer,
    SynthesisContext,
    TestPlanLayer,
)
from app.synthesis.profiles import get_profile
from app.synthesis.spec import SynthesisSpec

logger = logging.getLogger(__name__)

code_pipeline = Pipeline([
    IntakeLayer(),
    IdentityLayer(),
    TestPlanLayer(),
    BuildLoopLayer(),
    ReviewGateLayer(),
    RegisterLayer(),
    PublishLayer(),
])


def run_synthesis(
    spec: SynthesisSpec,
    session_factory: Callable,
    *,
    emit: Optional[Callable[[str, str, Optional[dict]], None]] = None,
    job_id: Optional[str] = None,
) -> dict:
    """Run one job to completion and return its result dict. Never raises."""
    ctx = SynthesisContext(
        spec=spec,
        profile=get_profile(spec.purpose),
        session_factory=session_factory,
        emit_fn=emit,
        job_id=job_id,
    )
    ctx.deadline = time.monotonic() + settings.SYNTHESIS_WALL_CLOCK_SECONDS
    try:
        ctx = code_pipeline.run(ctx)
    except Exception as e:  # noqa: BLE001 — a job must end with a result, not a trace
        logger.exception("Synthesis of '%s' raised", spec.name)
        return {"status": "failed", "tool_name": spec.name, "purpose": spec.purpose,
                "message": f"Synthesis error: {type(e).__name__}: {e}", "fault": "harness"}
    return ctx.result or {"status": "failed", "tool_name": spec.name, "purpose": spec.purpose,
                          "message": "The pipeline ended without a result", "fault": "harness"}
