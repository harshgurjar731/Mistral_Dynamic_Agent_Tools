"""
Post-build smoke test and rollback.

The tool service verifies generated code in its sandbox before registering it,
but a registered version still has to load and run through the real execution
path (``POST /execute``) — the one a workflow step uses. A version that passed
the sandbox and then fails there is "built broken": it would bind to the
workflow and fail on the first run.

:func:`smoke_test` runs the version that was just built against its worked
examples through that path. :func:`roll_back` rejects a broken version; the
tool service then reactivates the previous approved version of the same name,
if there is one, and will rebuild rather than reuse the rejected code.
"""

from __future__ import annotations

import logging
import math
from typing import Any, Optional

from app.core.specs import CodeRequirement

logger = logging.getLogger(__name__)

#: Worked examples executed per build. Each one is a real execution.
MAX_SMOKE_EXAMPLES = 3


def smoke_testable(requirement: Optional[CodeRequirement]) -> bool:
    """Only code that is safe to call for real is smoke-tested.

    An ``http`` activity would call a live API, and one with side effects would
    write or delete something; the sandbox's fixtures are their verification.
    """
    if requirement is None:
        return False
    return requirement.kind == "pure" and (requirement.side_effects or "none") == "none"


async def smoke_test(requirement: CodeRequirement, build: dict) -> list[str]:
    """Run the built version against its worked examples. Returns the problems found."""
    from app.services.tool_resolver import tool_resolver

    name = build.get("tool_name") or requirement.name
    version = build.get("version")
    examples = build.get("examples") if isinstance(build.get("examples"), list) else requirement.examples
    examples = [e for e in (examples or []) if isinstance(e, dict) and isinstance(e.get("input"), dict)]

    cases = examples[:MAX_SMOKE_EXAMPLES] or [None]
    problems: list[str] = []
    for i, example in enumerate(cases, 1):
        arguments = example["input"] if example else {}
        response = await tool_resolver.execute_tool(name, arguments, version=version)
        label = f"example {i}" if example else "a call with no arguments"
        if "error" in response and "result" not in response:
            if example is None:
                # No worked example to call it with: an argument error still
                # proves the version loaded. Anything else does not.
                if _is_argument_error(str(response["error"])):
                    continue
            problems.append(f"{label}: execution failed — {str(response['error'])[:300]}")
            continue
        if example is None:
            continue
        result = response.get("result")
        if isinstance(result, dict) and str(result.get("status", "")).lower() == "error":
            detail = result.get("message") or result.get("error") or result
            problems.append(f"{label}: the activity returned an error — {str(detail)[:300]}")
            continue
        if "output" in example and example["output"] is not None:
            data = result.get("data", result) if isinstance(result, dict) else result
            mismatch = values_match(example["output"], data)
            if mismatch:
                problems.append(f"{label}: output differs from the worked example — {mismatch}")
                continue
        missing = _missing_required(requirement.output_schema, result)
        if missing:
            problems.append(f"{label}: output is missing required field(s) {', '.join(missing)}")
    if problems:
        logger.warning("Smoke test of '%s' v%s failed: %s", name, version, "; ".join(problems))
    return problems


async def roll_back(build: dict) -> str:
    """Reject the version in ``build``. Returns what the tool service did."""
    from app.services.tool_resolver import tool_resolver

    tool_id = build.get("tool_id")
    if not tool_id:
        return "nothing to roll back (no version id)"
    outcome = await tool_resolver.reject_tool(int(tool_id))
    message = str(outcome.get("message") or outcome.get("error") or outcome)
    logger.info("Rolled back '%s' v%s: %s", build.get("tool_name"), build.get("version"), message)
    return message


def _is_argument_error(text: str) -> bool:
    lowered = text.lower()
    return any(k in lowered for k in ("argument", "parameter", "required", "missing", "typeerror"))


def _missing_required(schema: Optional[dict], result: Any) -> list[str]:
    if not isinstance(schema, dict) or schema.get("type", "object") != "object":
        return []
    data = result.get("data", result) if isinstance(result, dict) else result
    if not isinstance(data, dict):
        return []
    return [k for k in (schema.get("required") or []) if k not in data]


def values_match(expected: Any, actual: Any, path: str = "data") -> Optional[str]:
    """None when ``actual`` satisfies ``expected``, else where it differs.

    The same rules the tool service verifies examples with: numbers compare
    with a small tolerance (or at the example's rounding), and dicts compare on
    the keys the example states.
    """
    if isinstance(expected, bool) or isinstance(actual, bool):
        return None if expected is actual else f"{path}: expected {expected!r}, got {actual!r}"
    if isinstance(expected, (int, float)) and isinstance(actual, (int, float)):
        if math.isclose(expected, actual, rel_tol=1e-6, abs_tol=1e-6):
            return None
        places = _decimals(float(expected))
        if places is not None and places <= 6 and round(float(actual), places) == round(float(expected), places):
            return None
        return f"{path}: expected {expected!r}, got {actual!r}"
    if isinstance(expected, str) and isinstance(actual, str):
        return None if expected.strip() == actual.strip() else f"{path}: expected {expected!r}, got {actual!r}"
    if isinstance(expected, dict):
        if not isinstance(actual, dict):
            return f"{path}: expected an object, got {type(actual).__name__}"
        for key, value in expected.items():
            if key not in actual:
                return f"{path}: missing key '{key}'"
            problem = values_match(value, actual[key], f"{path}.{key}")
            if problem:
                return problem
        return None
    if isinstance(expected, list):
        if not isinstance(actual, list):
            return f"{path}: expected a list, got {type(actual).__name__}"
        if len(expected) != len(actual):
            return f"{path}: expected {len(expected)} items, got {len(actual)}"
        for i, (e, a) in enumerate(zip(expected, actual)):
            problem = values_match(e, a, f"{path}[{i}]")
            if problem:
                return problem
        return None
    if expected is None:
        return None if actual is None else f"{path}: expected null, got {actual!r}"
    return None if expected == actual else f"{path}: expected {expected!r}, got {actual!r}"


def _decimals(value: float) -> Optional[int]:
    text = repr(value)
    if "e" in text or "E" in text:
        return None
    return len(text.split(".")[1]) if "." in text else 0
