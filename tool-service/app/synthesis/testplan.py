"""
Test plans — the cases a candidate must pass, and what each must produce.

The previous harness ran generated code against schema-sampled inputs and
accepted anything that did not raise. That made "verified" nearly vacuous: a
tool that answered every input with ``{"status": "error"}`` passed, because
``"sample_raw_invoice_data"`` is not an invoice and rejecting it is correct.

A plan here pairs every input with an *expectation*:

    success   the call must succeed (and match its expected output, if given)
    envelope  any well-formed result is acceptable — the input is synthetic
              and the code is only required not to crash on it
    error     the call must return an error envelope, not raise and not succeed

Only inputs that are known to be valid — worked examples, and realistic inputs
the test-plan model wrote and the input schema accepted — are held to
``success``. Schema-sampled inputs are held to ``envelope``.
"""

from __future__ import annotations

import copy
from dataclasses import asdict, dataclass, field
from typing import Any, Optional

#: Field-name hints so a ``date`` gets a date and an ``email`` gets an email.
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

EXPECT_SUCCESS = "success"
EXPECT_ENVELOPE = "envelope"
EXPECT_ERROR = "error"


@dataclass
class TestCase:
    __test__ = False  # not a pytest class

    case_id: str
    origin: str  # example | llm | schema_full | required_only | boundary | missing_required
    kwargs: dict
    expect: str
    expected: Optional[Any] = None
    check_repeat: bool = False
    note: str = ""


@dataclass
class TestPlan:
    __test__ = False

    cases: list[TestCase] = field(default_factory=list)
    #: True when nothing in the plan is held to ``success`` — the plan can then
    #: only show the code does not crash, and the report says so.
    weak: bool = False

    def to_dict(self) -> dict:
        return {"weak": self.weak, "cases": [asdict(c) for c in self.cases]}

    @classmethod
    def from_dict(cls, data: dict) -> "TestPlan":
        cases = [TestCase(**c) for c in (data or {}).get("cases", [])]
        return cls(cases=cases, weak=bool((data or {}).get("weak")))

    def add(self, case: TestCase) -> None:
        self.cases.append(case)


# ── Sampling ───────────────────────────────────────────────────────────────


def _hinted(param_name: str) -> Any:
    lowered = param_name.lower()
    for needles, value in _NAME_HINTS:
        if any(needle in lowered for needle in needles):
            return value
    return None


def sample_value(param_name: str, definition: Any, depth: int = 0) -> Any:
    """One plausible value for a parameter definition."""
    if not isinstance(definition, dict):
        definition = {"type": "string", "description": str(definition)}

    if "default" in definition:
        return copy.deepcopy(definition["default"])
    enum = definition.get("enum")
    if isinstance(enum, list) and enum:
        return enum[0]
    if "examples" in definition and isinstance(definition["examples"], list) and definition["examples"]:
        return copy.deepcopy(definition["examples"][0])

    ptype = definition.get("type", "string")
    if isinstance(ptype, list):
        ptype = next((t for t in ptype if t != "null"), "string")

    if ptype == "object":
        nested = definition.get("properties")
        if isinstance(nested, dict) and nested and depth < 3:
            return {k: sample_value(k, v, depth + 1) for k, v in nested.items()}
        return {"key": "value"} if depth < 3 else {}

    if ptype == "array":
        items = definition.get("items")
        if isinstance(items, dict) and depth < 3:
            return [sample_value(param_name, items, depth + 1)]
        return ["item"]

    if ptype == "boolean":
        return True
    if ptype == "integer":
        hinted = _hinted(param_name)
        value = int(hinted) if isinstance(hinted, (int, float)) and not isinstance(hinted, bool) else 3
        return _clamp(value, definition, integer=True)
    if ptype == "number":
        hinted = _hinted(param_name)
        value = float(hinted) if isinstance(hinted, (int, float)) and not isinstance(hinted, bool) else 1250.0
        return _clamp(value, definition, integer=False)
    if ptype == "null":
        return None

    hinted = _hinted(param_name)
    if isinstance(hinted, str):
        return hinted
    return f"sample_{param_name}"


def _clamp(value, definition: dict, integer: bool):
    lo, hi = definition.get("minimum"), definition.get("maximum")
    if isinstance(lo, (int, float)) and value < lo:
        value = lo
    if isinstance(hi, (int, float)) and value > hi:
        value = hi
    return int(value) if integer else float(value)


def _boundary_value(definition: dict) -> tuple[bool, Any]:
    """An edge value for one parameter, if it has an interesting edge."""
    ptype = definition.get("type")
    if ptype == "array":
        return True, []
    if ptype in ("number", "integer"):
        lo = definition.get("minimum")
        return True, lo if isinstance(lo, (int, float)) else 0
    if ptype == "string" and not definition.get("enum"):
        return True, ""
    return False, None


# ── Plan construction ─────────────────────────────────────────────────────


def schema_cases(properties: dict, required: list[str], *, boundary: bool) -> list[TestCase]:
    """Cases derived from the input schema alone, all held to ``envelope``."""
    if not properties:
        return [TestCase("schema_empty", "schema_full", {}, EXPECT_ENVELOPE)]

    full = {name: sample_value(name, d) for name, d in properties.items()}
    cases = [TestCase("schema_full", "schema_full", full, EXPECT_ENVELOPE)]

    required_only = {k: v for k, v in full.items() if k in (required or [])}
    if required_only != full:
        cases.append(TestCase("required_only", "required_only", required_only, EXPECT_ENVELOPE))

    if boundary:
        for name, definition in properties.items():
            if not isinstance(definition, dict):
                continue
            has_edge, edge = _boundary_value(definition)
            if has_edge:
                cases.append(TestCase(
                    f"boundary_{name}", "boundary", {**full, name: edge}, EXPECT_ENVELOPE,
                    note=f"edge value for '{name}'",
                ))
    return cases


def missing_required_cases(properties: dict, required: list[str], base: dict) -> list[TestCase]:
    """Drop each required parameter in turn; the code must return an error."""
    cases = []
    for name in (required or [])[:3]:
        if name not in properties:
            continue
        kwargs = {k: v for k, v in base.items() if k != name}
        cases.append(TestCase(
            f"missing_{name}", "missing_required", kwargs, EXPECT_ERROR,
            note=f"required parameter '{name}' omitted",
        ))
    return cases


def validate_input(schema: dict, value: dict) -> Optional[str]:
    """None if ``value`` satisfies ``schema``, else the first error message."""
    try:
        import jsonschema
    except ImportError:  # pragma: no cover — declared in requirements
        return None
    try:
        jsonschema.validate(value, schema)
        return None
    except jsonschema.ValidationError as e:
        path = "/".join(str(p) for p in e.absolute_path)
        return f"{path or '(root)'}: {e.message}"
    except jsonschema.SchemaError as e:
        return f"invalid schema: {e.message}"
