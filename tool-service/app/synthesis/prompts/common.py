"""
Prompt sections shared by the tool and activity profiles.

Built by concatenation rather than ``str.format`` so the JSON and Python braces
in the examples need no escaping — an unescaped brace in the old template was
one more way for a prompt edit to break synthesis at runtime.
"""

from __future__ import annotations

import json

from app.synthesis import policy
from app.synthesis.spec import SynthesisSpec
from app.synthesis.testplan import EXPECT_ERROR, EXPECT_SUCCESS, TestPlan

RULE = "═" * 60


def section(title: str, body: str) -> str:
    return f"{RULE}\n{title}\n{RULE}\n{body.strip()}\n"


PRIME_DIRECTIVE = section("PRIME DIRECTIVE", """
Never fabricate data. When a real result cannot be produced — invalid input,
network failure, bad status, missing field — return an error envelope that
states the real problem. Never invent, guess, mock or substitute a
plausible-looking value. A wrong answer is worse than an honest error.
Your only output is one raw Python module. No markdown fences, no prose.
""")

FILE_STRUCTURE = section("FILE STRUCTURE", """
  [1] imports — at the top, allowed modules only
  [2] module-level constants (e.g. REQUEST_TIMEOUT = 10) — optional
  [3] helper functions — optional, private (leading underscore)
  [4] def run(**kwargs) -> dict:   ← the entry point, exactly this signature
        docstring: one sentence — what it does and what "data" holds
        Layer 0: read and validate every parameter from kwargs
        Layer 1: core logic in try/except
        every return path returns an envelope dict

Nothing else at module level: no statements, no prints, no
`if __name__ == "__main__":` block, no global mutable state.
""")

ENVELOPE = section("RETURN ENVELOPE — every return path", """
Success:
  {"status": "success", "data": <the result>, "source": "<computed | api name>"}

Error:
  {"status": "error",
   "error_type": "<validation_error | network_error | http_error | parse_error |
                  empty_response | configuration_error | unexpected_error>",
   "message": "<what went wrong, for a human>",
   "detail": "<raw exception text or status code>"}

Never return None, a bare value, or an empty dict. Everything inside must be
JSON-serialisable: convert datetime → isoformat(), Decimal → float, set → list.
The outermost `except Exception as e:` must return an unexpected_error envelope.
""")

VALIDATION = section("INPUT VALIDATION (Layer 0)", """
Read parameters with kwargs.get("name"). For each REQUIRED parameter, if it is
missing (None) or the wrong type, return a validation_error envelope at once —
never raise, never guess a value. Optional parameters get an explicit default.
Nested objects and list items: read fields with .get(), never with [...].
bool is a subclass of int in Python: check isinstance(x, bool) first when a
number is expected.
""")

HTTP_RULES = section("HTTP RULES", """
Use `requests` with timeout=REQUEST_TIMEOUT on every call. Pass query values via
params=, never by string interpolation; quote path segments with
urllib.parse.quote(value, safe=""). Catch requests.exceptions.Timeout and
requests.exceptions.ConnectionError before RequestException, each returning a
network_error envelope. Check resp.status_code before parsing, check the
Content-Type before resp.json(), wrap resp.json() in try/except ValueError, and
read fields with .get(). Never hardcode a key, token or invented base URL.
Credentials arrive in kwargs["_secrets"] (a dict), e.g.
kwargs.get("_secrets", {}).get("API_KEY"); if absent, return a
configuration_error envelope.
""")


def imports_section() -> str:
    return section("IMPORTS", policy.render_imports_section())


def describe_plan(plan: TestPlan) -> str:
    """Tell the model exactly what it will be tested with."""
    lines = []
    for case in plan.cases:
        if case.expect == EXPECT_SUCCESS:
            want = "must succeed" + (" and return exactly the expected data" if case.expected is not None else "")
        elif case.expect == EXPECT_ERROR:
            want = "must return an error envelope (validation_error)"
        else:
            want = "must return a well-formed envelope and never raise"
        extra = " — also run twice; both results must be identical" if case.check_repeat else ""
        lines.append(f"  - {case.case_id} ({case.origin}): {want}{extra}")
    return section(
        "HOW YOUR CODE IS TESTED",
        "Before acceptance your module is linted, then EXECUTED in a sandbox against\n"
        "these cases. Every case must meet its expectation:\n" + "\n".join(lines),
    )


def spec_block(spec: SynthesisSpec) -> str:
    """The task, rendered for the user message."""
    parts = [
        f"## Name\n{spec.name}",
        f"## Purpose\n{spec.description}",
        "## Input schema (JSON Schema; parameters arrive as keyword arguments)\n"
        + json.dumps(spec.input_schema, indent=2),
    ]
    if spec.output_schema:
        parts.append("## Output schema — `data` on success must validate against this\n"
                     + json.dumps(spec.output_schema, indent=2))
    elif spec.expected_output_shape:
        parts.append(f"## Shape of `data` on success\n{spec.expected_output_shape}")
    if spec.examples:
        rendered = []
        for i, ex in enumerate(spec.examples, 1):
            item = {"input": ex.input}
            if ex.output is not None:
                item["expected_data"] = ex.output
            if ex.note:
                item["how"] = ex.note
            rendered.append(f"Example {i}:\n{json.dumps(item, indent=2, default=str)}")
        parts.append("## Worked examples\n"
                     "An example may list only some fields of `data`; every field it lists "
                     "must match exactly, and the rest must still follow the output schema.\n\n"
                     + "\n\n".join(rendered))
    parts.append(f"## Data source\n{spec.api_details}")
    if spec.http_fixtures:
        sample = {k: v for k, v in spec.http_fixtures[0].items() if k != "for_input"}
        parts.append("## Sample API response (status and body)\n"
                     + json.dumps(sample, indent=2, default=str))
    if spec.secrets:
        parts.append("## Credentials\nAvailable as kwargs['_secrets'][NAME] for: "
                     + ", ".join(spec.secrets))
    if spec.side_effects not in ("none", ""):
        parts.append(f"## Side effects\n{spec.side_effects}")
    return "\n\n".join(parts)


OUTPUT_ONLY = "Return ONLY the complete Python module — no fences, no explanation."
