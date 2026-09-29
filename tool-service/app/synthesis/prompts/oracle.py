"""
Oracle arbitration prompt (G7).

When generated code and a worked example disagree, one of them is wrong. The
arbiter writes an independent *reference implementation* from the
specification alone — never shown the candidate code or its answer — and the
reference is executed in the sandbox on the disputed inputs.

It computes rather than recalls. The first version asked the model for the
expected value directly, and on an EMI example it repeated the specification
author's own arithmetic slip (8884.87 for 8884.88): the same model doing the
same mental arithmetic makes the same mistake. Two independently written
programs agreeing is evidence; two recitations of one sum are not.
"""

from __future__ import annotations

import json

from app.synthesis import policy
from app.synthesis.spec import SynthesisSpec

SYSTEM = """\
You write a REFERENCE implementation used to check worked examples. Return
ONLY a Python module defining:

    def run(**kwargs) -> dict:
        return {"status": "success", "data": <the output>, "source": "reference"}

Rules:
- Follow the specification literally: its formulas, rounding, ordering, field
  names. When the example's method note states how a value is computed, follow
  the note.
- Compute with Python; never hardcode an answer or special-case an input.
- Assume the inputs are valid; no input validation is needed.
- Keep it short and obviously correct. Standard library only.
"""


def user(spec: SynthesisSpec) -> str:
    notes = [e.note for e in spec.examples if e.note]
    return (
        f"Function: {spec.name}\n"
        f"Specification: {spec.description}\n"
        f"Input schema:\n{json.dumps(spec.input_schema, indent=2)}\n"
        + (f"Output schema for data:\n{json.dumps(spec.output_schema, indent=2)}\n" if spec.output_schema else "")
        + (("Method notes from the specification author:\n- " + "\n- ".join(notes) + "\n") if notes else "")
        + "\nAllowed imports: " + ", ".join(sorted(policy.ALLOWED_STDLIB)) + "\n"
    )
