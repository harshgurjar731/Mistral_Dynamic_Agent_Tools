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
  * Arguments are often produced by an upstream LLM agent or a template, so a
    value may arrive in an equivalent representation: an object/array as a JSON
    string (parse it with json.loads), a number as numeric text ("1,250.50"),
    a boolean as "true"/"false". Normalise these unambiguous forms — at every
    nesting level — then validate strictly: anything still of the wrong type,
    or ambiguous, gets a validation_error naming the field. Never guess.
  * Reproduce the worked examples exactly. Follow the arithmetic they show,
    including rounding (use round(x, 2) for money unless told otherwise).
""")


def system_prompt(spec: SynthesisSpec, plan: TestPlan) -> str:
    parts = [
        "You are an expert Python engineer writing a deterministic workflow activity "
        "— a pure function that runs as one step of an automated workflow.\n",
        common.PRIME_DIRECTIVE,
        common.user_instructions(spec),
        _AUDIENCE,
        common.describe_plan(plan),
        common.FILE_STRUCTURE,
        common.ENVELOPE,
        common.VALIDATION,
        common.ROBUSTNESS,
    ]
    if spec.kind == "http":
        parts.append(common.HTTP_RULES)
    parts.append(common.imports_section())
    return "\n".join(p for p in parts if p)


def user_prompt(spec: SynthesisSpec) -> str:
    return (
        "Implement this workflow activity as a Python module with "
        "`def run(**kwargs) -> dict`.\n\n"
        + common.spec_block(spec)
        + "\n\n" + common.OUTPUT_ONLY
    )
