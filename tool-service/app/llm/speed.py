"""
How fast each model answers — so a slow one cannot stall a build.

The tool service's copy of the backend's ``app/core/model_speed.py`` (the two
services deploy separately). Measured on the deployment: building six small
activities took 70 minutes, because each model call waited out a 5-minute
timeout — up to three times on the same model — before the fallback answered in
seconds.

* **Hedge** — a primary that has not answered after ``TOOL_MODEL_HEDGE_SECONDS``,
  when the fallback is expected to be faster, is raced against the fallback.
* **Breaker** — a model that loses ``STRIKES`` races (or times out) in a row is
  skipped for ``OPEN_SECONDS``.
"""

from __future__ import annotations

import logging
import threading
import time

logger = logging.getLogger(__name__)

STRIKES = 2
OPEN_SECONDS = 900.0
_PRIOR_SLOW, _PRIOR_FAST = 90.0, 12.0

_lock = threading.Lock()
_stats: dict[str, dict] = {}


def _entry(model: str) -> dict:
    return _stats.setdefault(model, {"ewma": None, "strikes": 0, "open_until": 0.0})


def expected(model: str) -> float:
    with _lock:
        ewma = _entry(model)["ewma"]
    if ewma is not None:
        return float(ewma)
    return _PRIOR_SLOW if "large" in (model or "").lower() else _PRIOR_FAST


def record(model: str, seconds: float) -> None:
    with _lock:
        e = _entry(model)
        e["ewma"] = seconds if e["ewma"] is None else 0.6 * e["ewma"] + 0.4 * seconds
        e["strikes"] = 0


def strike(model: str, seconds: float, why: str) -> bool:
    """``model`` was too slow. True when it is now skipped."""
    with _lock:
        e = _entry(model)
        e["ewma"] = seconds if e["ewma"] is None else max(e["ewma"], 0.6 * e["ewma"] + 0.4 * seconds)
        e["strikes"] += 1
        if e["strikes"] < STRIKES:
            return False
        e["strikes"] = 0
        e["open_until"] = time.monotonic() + OPEN_SECONDS
    logger.warning("Model %s is answering slowly (%s) — using the fallback model for the next %d min",
                   model, why, int(OPEN_SECONDS // 60))
    return True


def skipped(model: str) -> bool:
    with _lock:
        return _entry(model)["open_until"] > time.monotonic()


def reset() -> None:
    with _lock:
        _stats.clear()
