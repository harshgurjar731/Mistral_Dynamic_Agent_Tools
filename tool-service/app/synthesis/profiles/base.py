"""
CodeProfile — everything that differs between building a tool and an activity.

The pipeline layers are the same for both purposes; each delegates the
purpose-specific decision to the profile: what a valid spec must contain, how
the code is tested, how it is prompted, what counts as passing, whether it may
be auto-approved, and how it behaves at run time.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Optional

from app.synthesis.sandbox import SandboxOptions
from app.synthesis.spec import PURE_API_DETAILS, SynthesisSpec, Verdict
from app.synthesis.testplan import (
    EXPECT_SUCCESS,
    TestCase,
    TestPlan,
    missing_required_cases,
    sample_value,
    schema_cases,
    validate_input,
)
from app.synthesis.verifiers import validate_against

NAME_RE = re.compile(r"^[a-z][a-z0-9_]{2,63}$")


@dataclass(frozen=True)
class RuntimePolicy:
    """How a built tool is executed."""

    #: Convert loose argument values ("12" → 12, "true" → True) before validating.
    lenient_inputs: bool
    #: Validate ``data`` against the stored output schema, failing on mismatch.
    validate_output: bool
    #: Permit the labelled LLM "degraded" answer when the code fails.
    allow_fallback: bool


@dataclass
class ReviewDecision:
    auto_approve: bool
    #: True when a person must approve regardless of platform settings — callers
    #: must not force-approve it.
    review_required: bool
    reason: str


class CodeProfile:
    purpose: str = "tool"

    # ── G1: spec validation ─────────────────────────────────────────────

    def validate_spec(self, spec: SynthesisSpec, *, strict: bool) -> tuple[list[str], list[str]]:
        """Return ``(issues, warnings)``. Any issue makes the spec invalid."""
        issues: list[str] = []
        warnings: list[str] = []

        if not NAME_RE.match(spec.name or ""):
            issues.append(f"name '{spec.name}' must be snake_case: 3–64 chars of a-z, 0-9, _ "
                          f"starting with a letter")
        if len(spec.description) < 10:
            issues.append("description is missing or too short to implement from")

        schema_issue = _schema_problem(spec.input_schema)
        if schema_issue:
            issues.append(f"input_schema is not valid JSON Schema: {schema_issue}")
        if spec.output_schema is not None:
            schema_issue = _schema_problem(spec.output_schema)
            if schema_issue:
                issues.append(f"output_schema is not valid JSON Schema: {schema_issue}")

        for pname, pdef in spec.properties.items():
            if isinstance(pdef, dict) and pdef.get("type") == "object" and not pdef.get("properties"):
                warnings.append(f"parameter '{pname}' is an object with no declared properties")
            if not pname.isidentifier():
                warnings.append(f"parameter '{pname}' is not a Python identifier")

        for i, example in enumerate(spec.examples, 1):
            problem = validate_input(spec.input_schema, example.input)
            if problem:
                issues.append(f"example {i} input does not satisfy input_schema — {problem}")
            if example.output is not None and spec.output_schema:
                # An example may state only the fields it can predict exactly
                # (not free-text messages), so field presence is not required
                # here — but every field it does state must have the right type.
                problem = validate_against(_without_required(spec.output_schema), example.output)
                if problem:
                    issues.append(f"example {i} output does not satisfy output_schema — {problem}")

        if spec.kind == "http" and spec.api_details.strip() == PURE_API_DETAILS:
            issues.append("kind is 'http' but api_details does not name the API to call")

        self.validate_purpose(spec, strict=strict, issues=issues, warnings=warnings)
        return issues, warnings

    def validate_purpose(self, spec: SynthesisSpec, *, strict: bool,
                         issues: list[str], warnings: list[str]) -> None:
        """Purpose-specific spec rules."""

    # ── G3: test planning ───────────────────────────────────────────────

    def wants_llm_cases(self, spec: SynthesisSpec) -> bool:
        return True

    def build_test_plan(self, spec: SynthesisSpec, llm_inputs: list[dict]) -> TestPlan:
        plan = TestPlan()
        for i, example in enumerate(spec.examples, 1):
            plan.add(TestCase(
                f"example_{i}", "example", example.input, EXPECT_SUCCESS,
                expected=example.output if self.compare_example_outputs(spec) else None,
                check_repeat=self.check_determinism(spec),
                note=example.note,
            ))
        for i, fixture in enumerate(spec.http_fixtures, 1):
            if spec.kind == "http" and isinstance(fixture.get("for_input"), dict):
                plan.add(TestCase(f"fixture_{i}", "fixture", fixture["for_input"], EXPECT_SUCCESS,
                                  note="the canned API response answers exactly this input"))
        for i, inputs in enumerate(llm_inputs, 1):
            plan.add(TestCase(f"realistic_{i}", "llm", inputs, EXPECT_SUCCESS,
                              check_repeat=self.check_determinism(spec)))

        for case in schema_cases(spec.properties, spec.required, boundary=self.boundary_cases(spec)):
            plan.add(case)

        base = (spec.examples[0].input if spec.examples
                else llm_inputs[0] if llm_inputs
                else {n: sample_value(n, d) for n, d in spec.properties.items()})
        for case in missing_required_cases(spec.properties, spec.required, base):
            plan.add(case)

        plan.weak = not any(c.expect == EXPECT_SUCCESS for c in plan.cases)
        return plan

    def compare_example_outputs(self, spec: SynthesisSpec) -> bool:
        return True

    def check_determinism(self, spec: SynthesisSpec) -> bool:
        return False

    def boundary_cases(self, spec: SynthesisSpec) -> bool:
        return False

    # ── G4: prompts ─────────────────────────────────────────────────────

    def system_prompt(self, spec: SynthesisSpec, plan: TestPlan) -> str:
        raise NotImplementedError

    def user_prompt(self, spec: SynthesisSpec) -> str:
        raise NotImplementedError

    # ── G5: verification settings ───────────────────────────────────────

    def extra_forbidden_modules(self, spec: SynthesisSpec) -> frozenset[str]:
        return frozenset()

    def sandbox_options(self, spec: SynthesisSpec) -> SandboxOptions:
        return SandboxOptions(
            block_network=spec.kind == "pure",
            http_stub=spec.kind == "http",
            fixtures=list(spec.http_fixtures),
            secrets={name: "sandbox-test-secret" for name in spec.secrets} or None,
        )

    def allow_transport_errors(self, spec: SynthesisSpec) -> bool:
        # The stub refuses calls, or answers every call with the same canned
        # response whatever was asked — so on an arbitrary input an HTTP tool
        # can only show that it reports the mismatch properly. The "fixture"
        # cases (a fixture's own ``for_input``) are held to real success.
        return spec.kind == "http"

    # ── G7 ──────────────────────────────────────────────────────────────

    def arbitrates(self) -> bool:
        return False

    # ── G8: review ──────────────────────────────────────────────────────

    def review(self, spec: SynthesisSpec, verdict: Verdict, plan: TestPlan,
               *, auto_approve_enabled: bool) -> ReviewDecision:
        if spec.side_effects in ("write", "delete"):
            return ReviewDecision(False, True, f"declares '{spec.side_effects}' side effects")
        if not auto_approve_enabled:
            return ReviewDecision(False, False, "auto-approval is disabled on this service")
        return self.review_purpose(spec, verdict, plan)

    def review_purpose(self, spec: SynthesisSpec, verdict: Verdict, plan: TestPlan) -> ReviewDecision:
        return ReviewDecision(True, False, "verified")

    # ── Runtime ─────────────────────────────────────────────────────────

    def runtime_policy(self, spec: Optional[SynthesisSpec] = None) -> RuntimePolicy:
        raise NotImplementedError


def _without_required(schema):
    """A copy of ``schema`` with every ``required`` list removed, recursively."""
    if isinstance(schema, dict):
        return {k: _without_required(v) for k, v in schema.items() if k != "required"}
    if isinstance(schema, list):
        return [_without_required(v) for v in schema]
    return schema


def _schema_problem(schema: dict) -> Optional[str]:
    try:
        import jsonschema
    except ImportError:  # pragma: no cover
        return None
    try:
        jsonschema.Draft202012Validator.check_schema(schema)
        return None
    except jsonschema.SchemaError as e:
        return e.message
