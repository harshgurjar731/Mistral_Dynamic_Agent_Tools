"""
Test inputs for the sandbox.

Generated from the tool's own JSON schema. The point is to exercise the
function the way a caller will, so the values have to be plausible rather than
merely type-correct: an object parameter given a bare ``{}`` makes any tool
that reads a field from it fail, and that failure is the schema's fault, not
the code's — the repair model then spends attempts "fixing" correct code.
"""

from __future__ import annotations

from typing import Any

#: Field-name hints, so a `date` gets a date and an `email` gets an email.
#: Purely to give generated code something realistic to parse.
_NAME_HINTS: tuple[tuple[tuple[str, ...], Any], ...] = (
    (("date", "_at", "timestamp"), "2026-01-15"),
    (("email",), "person@example.com"),
    (("url", "endpoint", "link"), "https://example.com/resource"),
    (("currency",), "GBP"),
    (("country",), "GB"),
    (("postcode", "postal", "zip"), "SW1A 1AA"),
    (("phone", "mobile"), "+44 20 7946 0000"),
    (("id", "reference", "ref"), "REF-00123"),
    (("name",), "Example Name"),
    (("address",), "1 Example Street, London"),
    (("amount", "total", "value", "price", "cost"), 1250.0),
    (("rate", "percentage", "percent"), 0.05),
    (("count", "quantity", "number", "years", "age"), 3),
)


def _hinted(param_name: str) -> Any:
    lowered = param_name.lower()
    for needles, value in _NAME_HINTS:
        if any(needle in lowered for needle in needles):
            return value
    return None


def _sample(param_name: str, definition: Any, depth: int = 0) -> Any:
    """One plausible value for a parameter definition."""
    if not isinstance(definition, dict):
        definition = {"type": "string", "description": str(definition)}

    if "default" in definition:
        return definition["default"]
    enum = definition.get("enum")
    if isinstance(enum, list) and enum:
        return enum[0]

    ptype = definition.get("type", "string")

    if ptype == "object":
        # Build from the nested schema when there is one. A bare {} is the
        # value that made `generate_claim_summary` unverifiable: every field
        # access against it raises, and the traceback looks like a code bug.
        nested = definition.get("properties")
        if isinstance(nested, dict) and nested and depth < 3:
            return {k: _sample(k, v, depth + 1) for k, v in nested.items()}
        return {"key": "value"} if depth < 3 else {}

    if ptype == "array":
        items = definition.get("items")
        if isinstance(items, dict) and depth < 3:
            return [_sample(param_name, items, depth + 1)]
        return ["item"]

    if ptype == "boolean":
        return True
    if ptype == "integer":
        hinted = _hinted(param_name)
        return int(hinted) if isinstance(hinted, (int, float)) else 3
    if ptype == "number":
        hinted = _hinted(param_name)
        return float(hinted) if isinstance(hinted, (int, float)) else 1250.0

    hinted = _hinted(param_name)
    if isinstance(hinted, str):
        return hinted
    return f"sample_{param_name}"


def build_test_inputs(properties: dict, required: list[str]) -> list[dict]:
    """Cases to run the generated tool against.

    Two of them where it helps: everything populated, and required-only. A tool
    that reads an optional argument without a guard passes the first and fails
    the second, which is a real defect worth catching before the tool is
    registered.
    """
    if not properties:
        return [{}]

    full = {name: _sample(name, definition) for name, definition in properties.items()}

    cases = [full]
    required_only = {k: v for k, v in full.items() if k in (required or [])}
    if required_only and required_only != full:
        cases.append(required_only)
    return cases
