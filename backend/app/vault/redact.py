"""
Scrub resolved vault values out of anything that leaves the execution path.

A tool's result goes to an LLM, into run events, traces and logs. Code that
echoes its key back — an error message carrying the request URL with
``?appid=…``, a debug field — would otherwise spread the value everywhere the
result goes. Each occurrence is replaced with ``[vault:NAME]``.
"""

from __future__ import annotations

from typing import Any

#: Shorter values are not scrubbed: replacing every "eu" or "1" in a result
#: would corrupt it, and a value that short is not a meaningful secret.
MIN_SCRUB_CHARS = 6


def _pairs(values: dict[str, str]) -> list[tuple[str, str]]:
    # Longest first, so a value containing another is replaced whole.
    return sorted(((v, f"[vault:{k}]") for k, v in values.items()
                   if isinstance(v, str) and len(v) >= MIN_SCRUB_CHARS),
                  key=lambda p: -len(p[0]))


def scrub(obj: Any, values: dict[str, str]) -> Any:
    """``obj`` with every value in ``values`` masked. Returns a new structure."""
    pairs = _pairs(values or {})
    if not pairs:
        return obj
    return _walk(obj, pairs)


def _walk(obj: Any, pairs: list[tuple[str, str]]) -> Any:
    if isinstance(obj, str):
        for value, mask in pairs:
            if value in obj:
                obj = obj.replace(value, mask)
        return obj
    if isinstance(obj, dict):
        return {_walk(k, pairs) if isinstance(k, str) else k: _walk(v, pairs) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return type(obj)(_walk(v, pairs) for v in obj)
    return obj
