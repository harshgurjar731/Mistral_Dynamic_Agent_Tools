"""
Typed carriers for the synthesis pipeline.

``SynthesisSpec`` is the contract between a caller and this service: what to
build, for whom (``purpose``), and how to tell that it works (``output_schema``
and ``examples``). Everything downstream reads it; nothing re-derives it.

``Verdict`` and ``Candidate`` carry what the verification loop learns. A
verdict names the *fault class* of a failure — code, spec, harness or
transport — because each one demands a different response, and routing them
all to "repair the code" is how correct code used to be rewritten until the
attempt budget ran out.
"""

from __future__ import annotations

import json
from dataclasses import asdict, dataclass, field
from hashlib import sha256
from typing import Any, Literal, Optional

Purpose = Literal["tool", "activity"]
Kind = Literal["pure", "http"]
Fault = Literal["code", "spec", "harness", "transport"]

PURE_API_DETAILS = "No external API. This is a pure computation using the standard library."

#: Python type names models write into JSON Schema, and what they mean.
_TYPE_FIXES = {
    "float": "number", "double": "number", "decimal": "number", "int": "integer",
    "str": "string", "text": "string", "bool": "boolean", "dict": "object",
    "map": "object", "list": "array", "tuple": "array",
}


def fix_schema_types(schema: Any) -> Any:
    """Rewrite Python-flavoured ``"type"`` values to JSON Schema, recursively."""
    if isinstance(schema, dict):
        out = {}
        for key, value in schema.items():
            if key == "type" and isinstance(value, str):
                out[key] = _TYPE_FIXES.get(value.lower(), value.lower())
            elif key == "type" and isinstance(value, list):
                out[key] = [_TYPE_FIXES.get(str(v).lower(), str(v).lower()) for v in value]
            else:
                out[key] = fix_schema_types(value)
        return out
    if isinstance(schema, list):
        return [fix_schema_types(v) for v in schema]
    return schema


def normalise_input_schema(parameters: Any, required: Optional[list] = None) -> dict:
    """Coerce every parameter shape callers send into one JSON-Schema object.

    Accepted: a full ``{"type": "object", "properties": ...}`` schema; the
    double-nested ``{"properties": {"type": "object", "properties": ...}}``
    some callers produce; and a bare ``{"x": {...}}`` property map.
    """
    params = dict(parameters or {}) if isinstance(parameters, dict) else {}

    props = params.get("properties")
    if isinstance(props, dict) and props.get("type") == "object" and "properties" in props:
        inner_required = props.get("required")
        params = {**params, "properties": props["properties"]}
        if isinstance(inner_required, list) and not params.get("required"):
            params["required"] = inner_required

    if "properties" not in params and params and params.get("type") != "object":
        if all(isinstance(v, (dict, str)) for v in params.values()):
            params = {"properties": params}

    properties = params.get("properties") if isinstance(params.get("properties"), dict) else {}
    # A bare string definition is a description.
    properties = {
        k: (v if isinstance(v, dict) else {"type": "string", "description": str(v)})
        for k, v in properties.items()
    }

    req = required if isinstance(required, list) and required else params.get("required")
    req = [r for r in (req or []) if isinstance(r, str) and r in properties]

    schema = {"type": "object", "properties": fix_schema_types(properties), "required": req}
    return schema


@dataclass
class Example:
    """One worked example: an input and, for activities, its exact output."""

    input: dict
    output: Optional[Any] = None
    note: str = ""

    @classmethod
    def parse(cls, raw: Any) -> Optional["Example"]:
        if not isinstance(raw, dict):
            return None
        inp = raw.get("input", raw.get("inputs", raw.get("arguments")))
        if not isinstance(inp, dict):
            return None
        out = raw.get("output", raw.get("expected_output", raw.get("expected")))
        return cls(input=inp, output=out, note=str(raw.get("note") or raw.get("explanation") or ""))


@dataclass
class SynthesisSpec:
    """The normalised request to build one tool or activity."""

    name: str
    description: str
    purpose: Purpose = "tool"
    kind: Kind = "pure"
    input_schema: dict = field(default_factory=lambda: {"type": "object", "properties": {}, "required": []})
    output_schema: Optional[dict] = None
    examples: list[Example] = field(default_factory=list)
    api_details: str = PURE_API_DETAILS
    expected_output_shape: str = ""
    secrets: list[str] = field(default_factory=list)
    side_effects: str = "none"
    #: Canned HTTP replies for the sandbox's ``requests`` stub:
    #: ``[{"status": 200, "json": {...}}]``. Without them every call raises
    #: ConnectionError, which still exercises the error paths.
    http_fixtures: list[dict] = field(default_factory=list)
    origin: str = "explicit"

    # ── Construction ────────────────────────────────────────────────────

    @classmethod
    def from_request(cls, **kw) -> "SynthesisSpec":
        """Build from a request body, accepting both v1 and v2 field names."""
        input_schema = normalise_input_schema(
            kw.get("input_schema") or kw.get("parameters"), kw.get("required")
        )
        output_schema = kw.get("output_schema")
        output_schema = fix_schema_types(output_schema) if isinstance(output_schema, dict) and output_schema else None

        purpose = kw.get("purpose") if kw.get("purpose") in ("tool", "activity") else "tool"
        api_details = str(kw.get("api_details") or "").strip() or PURE_API_DETAILS
        kind = kw.get("kind")
        if kind not in ("pure", "http"):
            kind = "pure" if _looks_pure(api_details) else "http"

        examples = [e for e in (Example.parse(x) for x in (kw.get("examples") or [])) if e]
        side_effects = str(kw.get("side_effects") or "none").strip().lower()
        if side_effects not in ("none", "read-only", "write", "delete"):
            side_effects = "none"

        return cls(
            name=str(kw.get("name") or "").strip(),
            description=str(kw.get("description") or "").strip(),
            purpose=purpose,
            kind=kind,
            input_schema=input_schema,
            output_schema=output_schema,
            examples=examples,
            api_details=api_details,
            expected_output_shape=str(kw.get("expected_output_shape") or "").strip(),
            secrets=[str(s) for s in (kw.get("secrets") or []) if str(s).strip()],
            side_effects=side_effects,
            http_fixtures=[f for f in (kw.get("http_fixtures") or []) if isinstance(f, dict)],
            origin=str(kw.get("origin") or "explicit"),
        )

    @classmethod
    def from_dict(cls, data: dict) -> "SynthesisSpec":
        return cls.from_request(**data)

    def to_dict(self) -> dict:
        data = asdict(self)
        data["examples"] = [asdict(e) for e in self.examples]
        return data

    # ── Views ───────────────────────────────────────────────────────────

    @property
    def properties(self) -> dict:
        props = self.input_schema.get("properties")
        return props if isinstance(props, dict) else {}

    @property
    def required(self) -> list[str]:
        return list(self.input_schema.get("required") or [])

    def content_hash(self) -> str:
        """Identity for deduplication: everything that changes what gets built."""
        payload = json.dumps(
            {
                "name": self.name,
                "purpose": self.purpose,
                "kind": self.kind,
                "description": self.description,
                "input_schema": self.input_schema,
                "output_schema": self.output_schema,
                "examples": [asdict(e) for e in self.examples],
                "api_details": self.api_details,
            },
            sort_keys=True,
            default=str,
        )
        return sha256(payload.encode()).hexdigest()

    def tool_schema(self) -> dict:
        """The function-calling schema agents and the catalogue see."""
        return {
            "type": "function",
            "function": {
                "name": self.name,
                "description": self.description,
                "parameters": {
                    "type": "object",
                    "properties": self.properties,
                    "required": self.required,
                },
            },
        }


def _looks_pure(api_details: str) -> bool:
    text = (api_details or "").lower()
    return (
        not text
        or "no external api" in text
        or "pure computation" in text
        or ("http" not in text and "endpoint" not in text and "api" not in text)
    )


# ── Verification results ───────────────────────────────────────────────────


@dataclass
class CaseReport:
    """One test case's outcome, kept for the repair prompt and the report."""

    case_id: str
    origin: str
    ok: bool
    expectation: str
    detail: str = ""
    input: Any = None
    expected: Any = None
    actual: Any = None


@dataclass
class Verdict:
    """One verification pass's finding on a candidate.

    ``diagnostic`` is what the repair model is shown, so it must be complete —
    a truncated traceback sends the model to fix a symptom it cannot see.
    """

    ok: bool
    stage: str = ""
    diagnostic: str = ""
    fault: Optional[Fault] = None
    #: Set when a verifier fixed the code itself (formatting, --fix lint).
    repaired_code: Optional[str] = None
    cases: list[CaseReport] = field(default_factory=list)
    #: Example cases whose output disagreed with the stated expectation —
    #: the input to oracle arbitration.
    mismatches: list[CaseReport] = field(default_factory=list)

    @property
    def cases_passed(self) -> int:
        return sum(1 for c in self.cases if c.ok)

    @property
    def our_fault(self) -> bool:
        return self.fault == "harness"

    def signature(self) -> str:
        """Identity of the failure, to notice when repair is going in circles."""
        failing = sorted(c.case_id for c in self.cases if not c.ok)
        head = (self.diagnostic or "").strip().splitlines()
        return f"{self.stage}|{','.join(failing)}|{head[-1][:120] if head else ''}"


@dataclass
class Attempt:
    """One pass through generate-and-verify, for the timeline and the report."""

    number: int
    stage: str
    ok: bool
    fault: Optional[str] = None
    diagnostic: str = ""
    chars: int = 0
    cases_passed: int = 0
    cases_total: int = 0
    model: str = ""
    mode: str = "generate"  # generate | repair | fresh


@dataclass
class Candidate:
    """A piece of generated code and everything learned about it."""

    code: str = ""
    model_used: str = ""
    attempts: list[Attempt] = field(default_factory=list)

    def record(self, number: int, verdict: "Verdict", mode: str) -> None:
        self.attempts.append(Attempt(
            number=number,
            stage="verified" if verdict.ok else verdict.stage,
            ok=verdict.ok,
            fault=verdict.fault,
            diagnostic=(verdict.diagnostic or "")[-2000:],
            chars=len(self.code),
            cases_passed=verdict.cases_passed,
            cases_total=len(verdict.cases),
            model=self.model_used,
            mode=mode,
        ))

    def history(self) -> str:
        return "; ".join(
            f"#{a.number} {a.mode} {a.stage} {'ok' if a.ok else 'failed'}"
            + (f" ({a.cases_passed}/{a.cases_total})" if a.cases_total else "")
            for a in self.attempts
        )


# Retained name: earlier modules imported ``CodeSpec``.
CodeSpec = SynthesisSpec
