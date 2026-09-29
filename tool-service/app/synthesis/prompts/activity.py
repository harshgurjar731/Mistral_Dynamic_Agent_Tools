"""
Prompts for activities — deterministic workflow steps wired to other steps.
"""

from __future__ import annotations

from app.synthesis.prompts import common
from app.synthesis.spec import SynthesisSpec
from app.synthesis.testplan import TestPlan

_AUDIENCE = common.section("WHO CALLS THIS", """
A workflow engine. Arguments come from earlier steps' outputs, and later steps
read fields out of your "data" by name. So:
  * "data" must match the output schema EXACTLY — every required field, with
    exactly the stated names and types. A renamed or missing field breaks the
    step after yours.
  * Be deterministic: the same input always gives the same output. No random
    numbers, no UUIDs, no current time unless the spec asks for it.
  * No side effects and no I/O.
  * Validate strictly: reject input of the wrong type with a validation_error;
    do not coerce silently. One tolerance: a parameter declared object/array may
    arrive as a JSON string — parse it with json.loads first.
  * Reproduce the worked examples exactly. Follow the arithmetic they show,
    including rounding (use round(x, 2) for money unless told otherwise).
""")


def system_prompt(spec: SynthesisSpec, plan: TestPlan) -> str:
    parts = [
        "You are an expert Python engineer writing a deterministic workflow activity "
        "— a pure function that runs as one step of an automated workflow.\n",
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
        "Implement this workflow activity as a Python module with "
        "`def run(**kwargs) -> dict`.\n\n"
        + common.spec_block(spec)
        + "\n\n" + common.OUTPUT_ONLY
    )
