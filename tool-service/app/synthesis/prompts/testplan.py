"""
Test-plan prompt — realistic inputs for code that has no worked examples.

Schema sampling produces type-correct but meaningless values; a function that
correctly rejects "sample_invoice" proves nothing. The model writes inputs a
real caller would send, so the plan can hold them to *success*.
"""

from __future__ import annotations

import json

from app.synthesis.spec import SynthesisSpec

SYSTEM = """\
You write test inputs for a function before it is implemented. Return ONLY a
JSON object:

{"cases": [{"input": {<keyword arguments>}, "note": "<what this case covers>"}]}

Rules:
- 3 cases. Each input must be VALID: it satisfies the input schema and a
  correct implementation must be able to succeed on it without network access
  to anything other than what the data source describes.
- Use realistic values a real caller would send — real-looking names, amounts,
  dates, nested records with every field the description implies.
- Case 1: every parameter. Case 2: only the required parameters. Case 3: a
  realistic edge (several items, a zero amount, a long string).
- Never include parameters that are not in the schema.
"""


def user(spec: SynthesisSpec) -> str:
    return (
        f"Function: {spec.name}\n"
        f"Purpose: {spec.description}\n"
        f"Data source: {spec.api_details}\n"
        f"Input schema:\n{json.dumps(spec.input_schema, indent=2)}\n"
        + (f"Output schema:\n{json.dumps(spec.output_schema, indent=2)}\n" if spec.output_schema else "")
    )
