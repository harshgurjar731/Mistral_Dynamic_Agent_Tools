"""
In-process counters for synthesis and model calls.

Deliberately small: a dict of counters and timing summaries behind a lock,
exposed at ``GET /metrics``. Enough to answer the questions that decide model
and prompt changes — first-pass rate, attempts per tool, which fault classes
dominate, and what each model route costs in latency and tokens — without a
metrics backend.
"""

from __future__ import annotations

import threading
from collections import defaultdict

_lock = threading.Lock()
_counters: dict[str, int] = defaultdict(int)
_timings: dict[str, dict[str, float]] = {}


def incr(name: str, amount: int = 1) -> None:
    with _lock:
        _counters[name] += amount


def observe(name: str, value: float) -> None:
    """Record one observation (seconds, tokens, attempts) under ``name``."""
    with _lock:
        stats = _timings.setdefault(name, {"count": 0, "sum": 0.0, "max": 0.0})
        stats["count"] += 1
        stats["sum"] += value
        stats["max"] = max(stats["max"], value)


def snapshot() -> dict:
    with _lock:
        timings = {
            name: {**s, "mean": (s["sum"] / s["count"]) if s["count"] else 0.0}
            for name, s in _timings.items()
        }
        return {"counters": dict(_counters), "timings": timings}


def reset() -> None:
    """For tests."""
    with _lock:
        _counters.clear()
        _timings.clear()
