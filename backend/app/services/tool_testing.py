"""
Run one tool or activity version by hand, and judge the result.

Used by the Test dialog on a tool/activity page: the user fills the parameters
(or picks a worked example, which prefills them) and runs that exact version.
The answer says not only what came back but whether it is right — the example's
expected output and the output schema's required fields are checked — so a
failure can go straight into a rebuild.
"""

from __future__ import annotations

import json
import time
from typing import Any, Optional


class TestRefused(ValueError):
    """The version cannot be run as asked (not approved, side effects unconfirmed…)."""


def _call_error(message: str) -> str:
    """The tool service's own message out of ``Tool Service returned 422: {"detail": …}``."""
    _, _, body = message.partition(": ")
    try:
        detail = json.loads(body).get("detail")
    except (ValueError, AttributeError):
        return message
    return detail if isinstance(detail, str) else message


async def run_test(tool_id: int, arguments: dict, *, example_index: Optional[int] = None,
                   allow_side_effects: bool = False) -> dict:
    from app.layers.codegen.smoke import _missing_required, values_match
    from app.services.tool_resolver import tool_resolver

    record = await tool_resolver.get_tool(int(tool_id))
    if record is None:
        raise TestRefused(f"Version {tool_id} was not found.")
    name, version = record["name"], record.get("version_no")
    if record.get("status") != "approved":
        raise TestRefused(f"Version {version} of '{name}' is '{record.get('status')}'. Only an "
                          f"approved version can run — approve it first.")
    side_effects = record.get("side_effects") or "none"
    if side_effects in ("write", "delete") and not allow_side_effects:
        raise TestRefused(f"'{name}' declares '{side_effects}' side effects, so a test run changes "
                          f"real data. Confirm to run it anyway.")

    spec = record.get("spec") or {}
    examples = [e for e in spec.get("examples") or [] if isinstance(e, dict)]
    expected: Any = None
    if example_index is not None:
        if not 0 <= example_index < len(examples):
            raise TestRefused(f"'{name}' has no worked example {example_index + 1}.")
        expected = examples[example_index].get("output")

    started = time.monotonic()
    response = await tool_resolver.execute_tool(name, arguments or {}, version=version)
    ms = round((time.monotonic() - started) * 1000)
    base = {"tool_id": record.get("id"), "tool_name": name, "version": version,
            "arguments": arguments, "duration_ms": ms, "expected": expected}

    if "error" in response and "result" not in response:
        return {**base, "outcome": "call_failed", "ok": False,
                "error": _call_error(str(response["error"])), "result": None}

    result = response.get("result")
    if isinstance(result, dict) and str(result.get("status", "")).lower() == "error":
        detail = " — ".join(str(result.get(k)) for k in ("error_type", "message", "detail")
                            if result.get(k))
        return {**base, "outcome": "returned_error", "ok": False,
                "error": detail or json.dumps(result, default=str)[:1000], "result": result}

    data = result.get("data", result) if isinstance(result, dict) else result
    mismatch = values_match(expected, data) if expected is not None else None
    missing = _missing_required(record.get("output_schema"), result)
    if mismatch or missing:
        problems = [p for p in (mismatch, f"missing required field(s): {', '.join(missing)}"
                                if missing else None) if p]
        return {**base, "outcome": "wrong_output", "ok": False, "error": "; ".join(problems),
                "mismatch": mismatch, "missing_fields": missing, "result": result, "data": data}
    return {**base, "outcome": "passed" if expected is not None else "succeeded", "ok": True,
            "error": None, "result": result, "data": data}
