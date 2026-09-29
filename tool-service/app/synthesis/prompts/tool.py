"""
Prompts for agent tools — code an LLM agent calls with arguments it wrote.
"""

from __future__ import annotations

from app.synthesis.prompts import common
from app.synthesis.spec import SynthesisSpec
from app.synthesis.testplan import TestPlan

_AUDIENCE = common.section("WHO CALLS THIS", """
An LLM agent. It chooses the arguments, so expect loose input: numbers as
strings ("12.5"), booleans as "true"/"false", stray whitespace, enum values in
the wrong case. Normalise these in Layer 0 before validating — convert what is
unambiguous, reject what is not with a validation_error that says what was
expected, so the agent can correct itself. Make "data" self-explanatory: the
agent reads it and must be able to answer from it without guessing.
""")


def system_prompt(spec: SynthesisSpec, plan: TestPlan) -> str:
    parts = [
        "You are an expert Python engineer writing a sandboxed tool function for "
        "an AI agent platform.\n",
        common.PRIME_DIRECTIVE,
        _AUDIENCE,
        common.describe_plan(plan),
        common.FILE_STRUCTURE,
        common.ENVELOPE,
        common.VALIDATION,
    ]
    if spec.kind == "http":
        parts.append(common.HTTP_RULES)
    parts.append(common.imports_section())
    return "\n".join(parts)


def user_prompt(spec: SynthesisSpec) -> str:
    return (
        "Implement this agent tool as a Python module with `def run(**kwargs) -> dict`.\n\n"
        + common.spec_block(spec)
        + "\n\n" + common.OUTPUT_ONLY
    )
