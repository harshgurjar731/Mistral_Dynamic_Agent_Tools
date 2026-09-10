"""
Typed carriers for the synthesis pipeline.

The pipeline used to be one 200-line function threading a dozen locals through
six stages, with the retry loop reaching back across three of them. These types
are what let the stages be separated: each one reads a ``CodeSpec`` and returns
a verdict on a ``Candidate``, and nothing needs to know what came before it.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from hashlib import sha256
from typing import Optional


@dataclass
class CodeSpec:
    """The normalised request to build one tool.

    Normalisation happens once, here, rather than being re-derived by each
    stage — the double-nested ``properties`` that some callers send used to be
    flattened in the orchestrating function while the prompt builder and the
    test-input generator each read the raw shape.
    """

    name: str
    description: str
    parameters: dict = field(default_factory=dict)
    required: list[str] = field(default_factory=list)
    api_details: str = "No external API. This is a pure computation using the standard library."
    expected_output_shape: str = "A dictionary containing the result."
    purpose: str = "tool"

    @classmethod
    def normalise(cls, **kwargs) -> "CodeSpec":
        parameters = dict(kwargs.pop("parameters", None) or {})

        # Some callers send {"properties": {"properties": {...}, "type": "object"}}.
        props = parameters.get("properties")
        if isinstance(props, dict) and props.get("type") == "object" and "properties" in props:
            parameters["properties"] = props["properties"]

        # A bare {"x": {...}} map with no "properties" key is the same thing
        # one level up, and the prompt and the test generator both expect the
        # JSON-Schema shape.
        if "properties" not in parameters and parameters:
            looks_like_props = all(isinstance(v, (dict, str)) for v in parameters.values())
            if looks_like_props and parameters.get("type") != "object":
                parameters = {"properties": parameters}

        parameters.setdefault("properties", {})
        return cls(parameters=parameters, **kwargs)

    @property
    def properties(self) -> dict:
        props = self.parameters.get("properties")
        return props if isinstance(props, dict) else {}

    def content_hash(self) -> str:
        """Stable identity for deduplication."""
        payload = json.dumps(
            {"name": self.name, "description": self.description, "parameters": self.parameters},
            sort_keys=True,
        )
        return sha256(payload.encode()).hexdigest()

    def tool_schema(self) -> dict:
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


@dataclass
class Verdict:
    """One verifier's finding on a candidate.

    ``diagnostic`` is what gets shown to the repair model, so it must be the
    complete error — a truncated traceback sends the model back to fix a
    symptom it cannot see. The previous pipeline logged only the first 200
    characters, which is exactly long enough to show a traceback header and cut
    off the exception itself.
    """

    ok: bool
    stage: str = ""
    diagnostic: str = ""
    #: Set when a verifier can fix the code itself (ruff format, say) — the
    #: repair model is not consulted for something a formatter can do.
    repaired_code: Optional[str] = None
    #: True when the failure is in the harness or the toolchain rather than in
    #: the generated code. Asking the model to repair one of these wastes an
    #: attempt on code that was never wrong.
    our_fault: bool = False


@dataclass
class Attempt:
    """One pass through generate-and-verify, kept for the timeline and the log."""

    number: int
    stage: str
    ok: bool
    diagnostic: str = ""
    chars: int = 0


@dataclass
class Candidate:
    """A piece of generated code and everything learned about it."""

    code: str = ""
    attempts: list[Attempt] = field(default_factory=list)
    model_used: str = ""

    def record(self, number: int, stage: str, ok: bool, diagnostic: str = "") -> None:
        self.attempts.append(
            Attempt(number=number, stage=stage, ok=ok,
                    diagnostic=diagnostic, chars=len(self.code))
        )

    def history(self) -> str:
        return "; ".join(
            f"#{a.number} {a.stage} {'ok' if a.ok else 'failed'}" for a in self.attempts
        )
