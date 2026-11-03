"""
Model routing — which Mistral model does which job.

Choice of model
---------------
``mistral-large-4`` is the largest model on the platform (reasoning, 1M-token
context; listed by ``GET /v1/models``). Writing a whole function from a
specification, reading a traceback to find its cause, recomputing an expected
value independently and planning realistic test inputs are all reasoning
tasks where a wrong answer costs a whole build, so every code job runs on it
at ``reasoning_effort="high"``.

``mistral-medium-2604`` (Medium 3.5, also reasoning) is the fallback: a
different model, so an outage of one is not an outage of both.

Dated or versioned IDs are pinned rather than ``-latest`` aliases. The aliases
are repointed without notice, and a silent model change is exactly what the
evaluation set in ``evals/`` exists to catch before it reaches production.

Reasoning effort
----------------
Measured, not assumed: ``mistral-large-4`` accepts ``"low"``, ``"medium"`` and
``"high"`` and rejects ``"none"``; ``mistral-medium-2604`` accepts ``"high"`` and
``"none"``; ``mistral-large-2512`` accepts none at all ("not enabled"). The
client drops the parameter and retries whenever a model rejects it, so a route
can be pointed at any of them from the Settings page.

Every field is overridable per role on the backend's Settings page or from the
environment, e.g. ``ROUTE_CODEGEN_MODEL=mistral-large-2512`` or
``ROUTE_ARBITER_EFFORT=omit``. A Settings-page value wins.
"""

from __future__ import annotations

import os
from dataclasses import dataclass, replace
from typing import Optional

PRIMARY = "mistral-large-4"
FALLBACK = "mistral-medium-2604"
LIGHT = "mistral-small-2603"


@dataclass(frozen=True)
class ModelRoute:
    """How one job is sent to a model."""

    role: str
    model: str
    reasoning_effort: Optional[str] = None  # "high" | "medium" | "low" | "none" | None (omit)
    temperature: Optional[float] = None
    timeout_ms: int = 180_000
    max_tokens: Optional[int] = None
    fallback_model: Optional[str] = None


#: The routing table. Keys are roles; see the module docstring for the choices.
_ROUTES: dict[str, ModelRoute] = {
    # G4 — first generation of a candidate.
    "codegen": ModelRoute("codegen", PRIMARY, "high", timeout_ms=300_000,
                          fallback_model=FALLBACK),
    # G6 — repair from a targeted diagnostic.
    "repair": ModelRoute("repair", PRIMARY, "high", timeout_ms=300_000,
                         fallback_model=FALLBACK),
    # G6 — fresh restart after the same failure repeats. Same model with a
    # clean context: the conversation, not the model, is what has stalled.
    "codegen_fresh": ModelRoute("codegen_fresh", PRIMARY, "high", timeout_ms=300_000,
                                fallback_model=FALLBACK),
    # G3 — realistic extra test inputs.
    # Realistic inputs decide what the code is held to, so they are reasoned
    # out by the same large model rather than sampled quickly.
    "testplan": ModelRoute("testplan", PRIMARY, "high", timeout_ms=180_000,
                           fallback_model=FALLBACK),
    # G7 — blind recomputation of an activity example's expected output.
    "arbiter": ModelRoute("arbiter", PRIMARY, "high", timeout_ms=240_000,
                          fallback_model=FALLBACK),
    # Runtime — optional, clearly-labelled degraded answer for a failed tool.
    "runtime_fallback": ModelRoute("runtime_fallback", LIGHT, "none",
                                   temperature=0.2, timeout_ms=60_000),
}


def _env(role: str, field: str) -> Optional[str]:
    key = f"ROUTE_{role.upper()}_{field}"
    # The backend's Settings page wins over the environment.
    from app.runtime_settings import override

    saved = override(key)
    if saved is not None:
        return saved
    value = os.environ.get(key)
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
