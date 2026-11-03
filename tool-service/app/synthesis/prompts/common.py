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

ROBUSTNESS = section("RUN-TIME ROBUSTNESS — what breaks code after it ships", """
Real inputs are messier than the examples. The code must survive all of these
without raising (each is a frequent cause of a version that passed its tests
and then failed in production):
  * an optional field — top level or nested — that is absent, None or "";
  * an empty list, a list with one item, or many items;
  * a nested record missing a key you expected: use .get() with a default and
    decide explicitly what a missing value means;
  * division by zero, or a ratio over an empty set — handle it explicitly;
  * a number that arrives as text ("1,250.50", "£1,200", "12%"): convert it
    when the meaning is unambiguous, otherwise return a validation_error that
    says which field and what was expected;
  * a date in a common format (YYYY-MM-DD, DD/MM/YYYY, ISO 8601 with time):
    parse what is unambiguous, reject the rest with a validation_error;
  * text with surprising case or surrounding whitespace in an enum-like field.
Never use bare indexing (x["k"], items[0]) on data you did not construct.
Never let an exception escape run(): the outermost handler returns the
unexpected_error envelope, but a specific, explanatory error is always better.
Every required output field is always present on success, with its declared
type — never None unless the output schema allows null.
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


def directives_of(spec: SynthesisSpec) -> list[str]:
    """The user's rebuild instructions as a list (the comment when none were split out)."""
    feedback = spec.feedback or {}
    items = [str(d) for d in (feedback.get("directives") or []) if str(d).strip()]
    comment = str(feedback.get("comment") or "").strip()
    return items or ([comment] if comment else [])


def user_instructions(spec: SynthesisSpec) -> str:
    """The user's explicit instructions for this version, as a mandatory checklist.

    Shown in the system prompt — where it outranks everything else — and again
    in every repair round, because a repair that fixes a test by undoing what
    the user asked for is the commonest way such an instruction gets lost.
    """
    items = directives_of(spec)
    if not items:
        return ""
    lines = "\n".join(f"  {i}. {item}" for i, item in enumerate(items, 1))
    body = (
        "The user rebuilding this module gave these instructions. Each one is\n"
        "MANDATORY and takes precedence over the defaults in this prompt (the\n"
        "envelope, sandbox and import rules still apply). The task's schemas\n"
        "already reflect any change to inputs or outputs the user asked for.\n"
        + lines
        + "\nBefore answering, check your module against every item above."
    )
    comment = str((spec.feedback or {}).get("comment") or "").strip()
    if comment and (spec.feedback or {}).get("directives"):
        body += "\n\nThe user's own words:\n" + comment
    return section("USER'S INSTRUCTIONS — MANDATORY", body)


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
    if spec.feedback:
        parts.append(feedback_block(spec.feedback))
    return "\n\n".join(parts)


def feedback_block(feedback: dict) -> str:
    """The previous version's failure, for a rebuild: fix this, keep the contract."""
    lines = ["## The previous version failed — fix it",
             "Write a corrected module that implements the name, input schema and output "
             "schema given above exactly (they already include any change the user asked "
             "for). Find the root cause of the failure below and change the implementation "
             "so it cannot happen again, and carry out every instruction the user gave."]
    if feedback.get("directives"):
        lines.append("### The user's instructions (each one is mandatory)\n"
                     + "\n".join(f"{i}. {d}" for i, d in enumerate(feedback["directives"], 1)))
    if feedback.get("runtime_error"):
        lines.append("### Error seen at run time\n" + feedback["runtime_error"])
    if feedback.get("failing_input"):
        lines.append("### Input it failed on (must now succeed)\n"
                     + json.dumps(feedback["failing_input"], indent=2, default=str))
    if feedback.get("comment"):
        lines.append("### What the user wants changed (their words)\n" + feedback["comment"])
    if feedback.get("previous_code"):
        lines.append("### The code that failed (for reference — keep what works, do not copy "
                     "its bug, and do not keep anything the user asked to change)\n"
                     + feedback["previous_code"])
    return "\n\n".join(lines)


OUTPUT_ONLY = "Return ONLY the complete Python module — no fences, no explanation."
