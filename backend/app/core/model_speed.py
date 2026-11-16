"""
How fast each model answers — so a slow one cannot stall a build.

Measured on the deployment: a plan spent 140 minutes, most of it waiting.
Nearly every decision ran on a large reasoning model that did not answer inside
its 3–5 minute budget; the answer then came from the fallback model in 10–20
seconds. The same decision, timed directly: 140–190 s on ``mistral-large-4``,
6–16 s on ``mistral-medium-2604``, with the same correct result.

Two mechanisms keep any configuration fast, both driven by what is observed:

* **Hedge** — when the primary has not answered after ``DECISION_HEDGE_SECONDS``
  and the fallback is expected to be faster, the fallback is started alongside
  and the first good answer is used.
* **Breaker** — a model that loses ``STRIKES`` hedges (or times out) in a row is
  skipped for ``OPEN_SECONDS``: decisions go straight to the fallback, and the
  slow model is tried again afterwards.

Per process, per model name; no persistence — a restart starts from the priors.
"""

from __future__ import annotations

import logging
import threading
import time

logger = logging.getLogger(__name__)

#: Losses in a row before a model is skipped.
STRIKES = 2
#: How long a skipped model stays skipped.
OPEN_SECONDS = 900.0
#: Latency assumed for a model nothing has been observed on yet (seconds).
_PRIOR_SLOW, _PRIOR_FAST = 90.0, 12.0

_lock = threading.Lock()
_stats: dict[str, dict] = {}


def _entry(model: str) -> dict:
    return _stats.setdefault(model, {"ewma": None, "strikes": 0, "open_until": 0.0})


def _prior(model: str) -> float:
    low = (model or "").lower()
    return _PRIOR_SLOW if "large" in low else _PRIOR_FAST


def expected(model: str) -> float:
    """Seconds a call to ``model`` is expected to take."""
    with _lock:
        ewma = _entry(model)["ewma"]
    return float(ewma) if ewma is not None else _prior(model)


def record(model: str, seconds: float) -> None:
    """A call to ``model`` answered in ``seconds``."""
    with _lock:
        e = _entry(model)
        e["ewma"] = seconds if e["ewma"] is None else 0.6 * e["ewma"] + 0.4 * seconds
        e["strikes"] = 0


def strike(model: str, seconds: float, why: str) -> bool:
    """``model`` was too slow (lost a hedge, or timed out). True when it is now skipped."""
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
    """True while ``model`` is being skipped for answering too slowly."""
    with _lock:
        return _entry(model)["open_until"] > time.monotonic()


def snapshot() -> dict:
    """What has been observed, for the health page and the logs."""
    now = time.monotonic()
    with _lock:
        return {m: {"seconds": round(e["ewma"], 1) if e["ewma"] is not None else None,
                    "skipped_for": max(0, round(e["open_until"] - now))}
                for m, e in _stats.items()}


def reset() -> None:
    with _lock:
        _stats.clear()
