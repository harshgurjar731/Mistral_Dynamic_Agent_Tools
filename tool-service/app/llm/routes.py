"""
Model routing — which Mistral model does which job.

Choice of model
---------------
``mistral-medium-2604`` (Medium 3.5) is the newest large-tier model on the
platform, the one Mistral's own coding agent and Magistral aliases resolve to,
and the only one of the large tier with reasoning. Writing a whole function
from a specification, reading a traceback to find its cause, and recomputing an
expected value independently are all reasoning tasks, so it takes every heavy
job here at ``reasoning_effort="high"``.

``mistral-large-2512`` (Large 3) is the fallback: a different model, so an
outage of one is not an outage of both.

Dated IDs are pinned rather than ``-latest`` aliases. The aliases are repointed
without notice, and a silent model change is exactly what the evaluation set in
``evals/`` exists to catch before it reaches production.

Reasoning effort
----------------
Measured, not assumed: these models accept only ``"high"`` or ``"none"`` —
``"medium"``/``"xhigh"`` are rejected with a 400. Routes therefore use those two
values only, and the client drops the parameter and retries if a model rejects
it anyway.

Every field is overridable per role from the environment, e.g.
``ROUTE_CODEGEN_MODEL=mistral-large-2512`` or ``ROUTE_ARBITER_EFFORT=none``.
"""

from __future__ import annotations

import os
from dataclasses import dataclass, replace
from typing import Optional

PRIMARY = "mistral-medium-2604"
FALLBACK = "mistral-large-2512"
LIGHT = "mistral-small-2603"


@dataclass(frozen=True)
class ModelRoute:
    """How one job is sent to a model."""

    role: str
    model: str
    reasoning_effort: Optional[str] = None  # "high" | "none" | None (omit)
    temperature: Optional[float] = None
    timeout_ms: int = 180_000
    max_tokens: Optional[int] = None
    fallback_model: Optional[str] = None


#: The routing table. Keys are roles; see the module docstring for the choices.
_ROUTES: dict[str, ModelRoute] = {
    # G4 — first generation of a candidate.
    "codegen": ModelRoute("codegen", PRIMARY, "high", timeout_ms=240_000,
                          fallback_model=FALLBACK),
    # G6 — repair from a targeted diagnostic.
    "repair": ModelRoute("repair", PRIMARY, "high", timeout_ms=240_000,
                         fallback_model=FALLBACK),
    # G6 — fresh restart after the same failure repeats. Same model with a
    # clean context: the conversation, not the model, is what has stalled.
    "codegen_fresh": ModelRoute("codegen_fresh", PRIMARY, "high", timeout_ms=240_000,
                                fallback_model=FALLBACK),
    # G3 — realistic extra test inputs.
    "testplan": ModelRoute("testplan", PRIMARY, "none", temperature=0.2,
                           timeout_ms=90_000, fallback_model=FALLBACK),
    # G7 — blind recomputation of an activity example's expected output.
    "arbiter": ModelRoute("arbiter", PRIMARY, "high", timeout_ms=180_000,
                          fallback_model=FALLBACK),
    # Runtime — optional, clearly-labelled degraded answer for a failed tool.
    "runtime_fallback": ModelRoute("runtime_fallback", LIGHT, "none",
                                   temperature=0.2, timeout_ms=60_000),
}


def _env(role: str, field: str) -> Optional[str]:
    value = os.environ.get(f"ROUTE_{role.upper()}_{field}")
    return value.strip() if value and value.strip() else None


def route_for(role: str) -> ModelRoute:
    """The route for ``role``, with any environment overrides applied."""
    base = _ROUTES.get(role)
    if base is None:
        raise KeyError(f"No model route for role '{role}'")

    overrides: dict = {}
    if (model := _env(role, "MODEL")):
        overrides["model"] = model
    if (effort := _env(role, "EFFORT")):
        overrides["reasoning_effort"] = None if effort.lower() == "omit" else effort
    if (timeout := _env(role, "TIMEOUT_MS")):
        overrides["timeout_ms"] = int(timeout)
    if (fallback := _env(role, "FALLBACK")):
        overrides["fallback_model"] = None if fallback.lower() == "none" else fallback
    return replace(base, **overrides) if overrides else base


def all_routes() -> dict[str, ModelRoute]:
    """Every route with overrides applied — for the health/config endpoint."""
    return {role: route_for(role) for role in _ROUTES}
