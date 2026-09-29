"""
Tool profile — code an LLM agent calls.

What matters is that the agent can use it: a description and parameter schema
the model reads correctly, tolerance for the loose values models write, and
output the agent can answer from. Exact output values are not required —
examples, when given, pin shape and success, not numbers.
"""

from __future__ import annotations

from typing import Optional

from app.config import settings
from app.synthesis.profiles.base import CodeProfile, RuntimePolicy
from app.synthesis.prompts import tool as prompts
from app.synthesis.spec import SynthesisSpec
from app.synthesis.testplan import TestPlan


class ToolProfile(CodeProfile):
    purpose = "tool"

    def validate_purpose(self, spec, *, strict, issues, warnings):
        undocumented = [
            name for name, d in spec.properties.items()
            if not (isinstance(d, dict) and str(d.get("description") or "").strip())
        ]
        if undocumented:
            # An agent chooses arguments from these descriptions; without them
            # it guesses. A warning, since the tool can still be built.
            warnings.append("parameters without a description: " + ", ".join(undocumented))

    def wants_llm_cases(self, spec: SynthesisSpec) -> bool:
        return len(spec.examples) < 2

    def compare_example_outputs(self, spec: SynthesisSpec) -> bool:
        # An agent tool's examples illustrate; its outputs may legitimately vary
        # (live data, wording), so only an activity is held to exact values.
        return False

    def system_prompt(self, spec: SynthesisSpec, plan: TestPlan) -> str:
        return prompts.system_prompt(spec, plan)

    def user_prompt(self, spec: SynthesisSpec) -> str:
        return prompts.user_prompt(spec)

    def runtime_policy(self, spec: Optional[SynthesisSpec] = None) -> RuntimePolicy:
        return RuntimePolicy(
            lenient_inputs=True,
            validate_output=True,
            allow_fallback=settings.TOOL_RUNTIME_FALLBACK,
        )
