"""
Activity profile — a deterministic workflow step.

What matters is the contract: later steps address fields of this step's output
by name, so ``output_schema`` is mandatory and enforced, worked examples are
held to their exact values, and the same input must always give the same
output. Activities never fall back to an LLM answer at run time — a workflow
step that cannot compute its result must fail, not be invented.
"""

from __future__ import annotations

from typing import Optional

from app.synthesis import policy
from app.synthesis.profiles.base import CodeProfile, ReviewDecision, RuntimePolicy
from app.synthesis.prompts import activity as prompts
from app.synthesis.spec import SynthesisSpec, Verdict
from app.synthesis.testplan import TestPlan


class ActivityProfile(CodeProfile):
    purpose = "activity"

    def validate_purpose(self, spec, *, strict, issues, warnings):
        needed_examples = 2 if spec.kind == "pure" else 1
        with_output = [e for e in spec.examples if e.output is not None]
        target = issues if strict else warnings

        if not spec.output_schema:
            target.append("an activity needs output_schema — later steps read its fields "
                          "by name, and nothing else defines them")
        elif spec.output_schema.get("type") not in (None, "object"):
            warnings.append("output_schema is not an object; later steps cannot address fields in it")

        if len(with_output) < needed_examples:
            target.append(f"an activity needs at least {needed_examples} worked example(s) "
                          f"with the exact expected output (has {len(with_output)})")

        if spec.side_effects in ("write", "delete"):
            issues.append("an activity may not have write/delete side effects — "
                          "use a connector step for that")

    def wants_llm_cases(self, spec: SynthesisSpec) -> bool:
        return len([e for e in spec.examples if e.output is not None]) < 2

    def check_determinism(self, spec: SynthesisSpec) -> bool:
        return spec.kind == "pure"

    def boundary_cases(self, spec: SynthesisSpec) -> bool:
        return True

    def extra_forbidden_modules(self, spec: SynthesisSpec) -> frozenset[str]:
        if spec.kind == "http":
            return frozenset(policy.NONDETERMINISTIC_FOR_ACTIVITIES - {"requests"})
        return frozenset(policy.NONDETERMINISTIC_FOR_ACTIVITIES)

    def system_prompt(self, spec: SynthesisSpec, plan: TestPlan) -> str:
        return prompts.system_prompt(spec, plan)

    def user_prompt(self, spec: SynthesisSpec) -> str:
        return prompts.user_prompt(spec)

    def arbitrates(self) -> bool:
        return True

    def review_purpose(self, spec: SynthesisSpec, verdict: Verdict, plan: TestPlan) -> ReviewDecision:
        example_cases = [c for c in verdict.cases if c.origin == "example"]
        if example_cases and all(c.ok for c in example_cases) and not plan.weak:
            return ReviewDecision(True, False, "every worked example reproduced exactly")
        return ReviewDecision(False, False, "no worked example was reproduced — needs a human check")

    def runtime_policy(self, spec: Optional[SynthesisSpec] = None) -> RuntimePolicy:
        return RuntimePolicy(lenient_inputs=False, validate_output=True, allow_fallback=False)
