"""
Prompts for the code-requirement pipeline (app/layers/codegen).

System prompts are plain strings and user prompts are built by the layers with
concatenation, so the JSON in these prompts needs no brace escaping.
"""

# ── R1 — need normalisation ─────────────────────────────────────────────────

NEED_NORMALISE_SYSTEM = """\
You turn a request for a new tool or workflow activity into a structured need.
Return ONLY a JSON object:

{
  "name": "verb_noun_snake_case",
  "summary": "<one sentence: what it does and what it returns>",
  "inputs": ["<name of each input it needs>"],
  "outputs": ["<name of each value it returns>"],
  "data_source": "<the external API it must call, or 'pure computation'>",
  "side_effects": "none | read-only | write | delete"
}

Describe the smallest function that satisfies the request. Do not invent an
external API when the work can be computed locally.
"""

# ── R2 — policy gate ────────────────────────────────────────────────────────

# The safety screen's prompt is built from the rules switched on for it —
# see app.safety.apply.screen_prompt.

# ── R3 — reuse resolution ───────────────────────────────────────────────────

REUSE_SYSTEM = """\
You decide whether an existing {noun} already does what is needed, so the
platform does not build a near-duplicate.

A match must perform the same transformation on the same kind of input and
return what is needed. A similar name is not enough — read the descriptions,
parameters and output fields. {extra}

Return ONLY a JSON object:
{"action": "exists" | "create", "existing_name": "<name or null>",
 "reason": "<one sentence a reviewer can check>"}
"""

REUSE_EXTRA_ACTIVITY = (
    "For an activity the output fields matter: later workflow steps read them by "
    "name, so an existing activity matches only if it returns every needed output."
)
REUSE_EXTRA_TOOL = (
    "For an agent tool, an existing tool that covers the need with different "
    "parameter names is still a match."
)

# ── R4 — spec authoring ─────────────────────────────────────────────────────

_SPEC_SHAPE = """\
Return ONLY a JSON object:
{
  "name": "snake_case_name",
  "description": "<precise: what it does, the formula or rules, units, rounding>",
  "kind": "pure" | "http",
  "input_schema": {"type": "object", "properties": {...}, "required": [...]},
  "output_schema": {"type": "object", "properties": {...}, "required": [...]},
  "examples": [{"input": {...}, "output": {...}, "note": "<how the output follows>"}],
  "api_details": "<exact endpoint, method, auth and response shape — or 'No external API. This is a pure computation using the standard library.'>",
  "http_fixtures": [{"status": 200, "json": {...}, "for_input": {...}}],
  "secrets": ["<ENV_VAR_NAME for a credential, if any>"],
  "side_effects": "none | read-only | write | delete"
}

JSON Schema rules: types are string, number, integer, boolean, array, object —
never float/int/str/dict/list. Every array has "items"; every object parameter
has "properties". Property names are snake_case Python identifiers.

Robustness — most code that passes its tests and then fails in production
fails on input the specification never mentioned:
- Mark a field "required" only when the function cannot work without it.
  Real callers (an agent, an earlier workflow step) omit optional fields,
  send null, or send an empty list — say in the description what happens then.
- Use ["<type>", "null"] for a field real data may leave empty.
- Describe the exact behaviour for empty lists, zero, missing nested fields and
  malformed values, so the code and its tests agree on them.
"""

TOOL_SPEC_SYSTEM = """\
You write the specification for an AGENT TOOL — a function an LLM agent calls
with arguments it chooses. The specification is what the code is generated
from and tested against, so it must be implementable without questions.

What makes a good agent tool specification:
- A description the agent can choose it from: what it does, when to use it,
  what it returns.
- Every parameter has a description with format and an example value; use
  "enum" for fixed choices and "minimum"/"maximum" for known ranges.
- An output_schema describing "data" so the agent can read the result.
- 1–3 examples with realistic, VALID inputs. Give "output" only when it is
  exactly predictable (pure computation); omit it for live data.
- kind "http" only when the work needs an external API; then api_details
  names the real endpoint and response shape, and http_fixtures holds one
  realistic response with "for_input" set to the input it answers.
<<TOOL_SAFETY_RULES>>

""" + _SPEC_SHAPE

ACTIVITY_SPEC_SYSTEM = """\
You write the specification for a WORKFLOW ACTIVITY — a deterministic function
that runs as one step of an automated workflow. Earlier steps' outputs are its
inputs; later steps read fields of its output BY NAME. The specification is
what the code is generated from and tested against.

Rules:
- output_schema is mandatory. Its properties MUST include every output the
  capability lists, with exactly those names (snake_case). Mark them required.
- input_schema properties should be named after the inputs the capability
  lists. An input that is a record or list gets a full nested schema.
- description states the exact rules: formulas, rounding (e.g. "rounded to 2
  decimals"), ordering, units, how edge cases (empty list, zero) behave.
- At least 2 worked examples with EXACT outputs. Compute every output value
  carefully, step by step, before writing it — the code is rejected if it
  disagrees with your example, and a wrong example wastes the whole build.
  Put the calculation in "note". An example may omit output fields whose
  exact value cannot be predicted (free-text messages).
- Prefer kind "pure". Use "http" only if the capability cannot be computed
  locally, and then give api_details and an http_fixture with "for_input".
- side_effects must be "none" or "read-only": writes belong to connector steps.
- When the activity CHECKS something an earlier step produced (output
  moderation, compliance, completeness, a letter or report review), add
  "checks": one entry per rule it enforces, {"code": "<the reason code it
  reports, e.g. missing_decision_reasons>", "requirement": "<one sentence:
  what the checked input must contain or satisfy to pass>"}. These rules are
  given to the step that writes the checked input, so state them concretely
  (e.g. "letter_text states the APR as a percentage"). Omit "checks" for any
  activity that does not check another step's output.

<<TOOL_SAFETY_RULES>>
""" + _SPEC_SHAPE

# ── Rebuild from an error — specification revision ────────────────────────

SPEC_REVISION_SYSTEM = """\
A <<NOUN>> failed (or did the wrong thing) when it ran, and the user is
rebuilding it. You revise its SPECIFICATION — the contract new code is
generated from and tested against — so the rebuilt version does exactly what
the user asked and cannot fail the same way. You do not write code.

You are given the current specification, the error seen at run time, the
user's instructions, and possibly the input it failed on and the code that
failed.

Rules:
1. The user's instructions are authoritative. Every change they ask for must
   show up in the specification: the description (rules, formulas, rounding,
   units, edge-case behaviour), the schemas if they ask for a different input
   or output, and the worked examples.
2. Keep "name", "purpose" and "side_effects" unchanged.
3. Keep the input and output schemas unless (a) the user asks to change them,
   or (b) the error or the failing input proves the schema is wrong — e.g. a
   field real callers omit or send as null must become optional / nullable,
   a list field must accept an empty list, a nested record needs the fields
   it really has. Never remove or rename an output field unless the user asks:
   later workflow steps read those fields by name.
4. Worked examples must agree with the revised rules EXACTLY. When a change
   alters what an existing example produces (new rounding, a new field, a new
   rule), recompute that example's output step by step and put the arithmetic
   in its "note". Keep at least as many examples as before. Add the failing
   input as an example only when its expected output follows unambiguously
   from the rules (or the user stated it).
5. Make the description precise enough that two engineers would write the
   same function: state how missing, null, empty and malformed values behave.
6. "directives": the user's instructions rewritten as a short checklist of
   concrete, testable requirements for the code (one per item, imperative,
   no duplicates). Include the fix for the run-time error as one item.

Return ONLY a JSON object:
{
  "specification": {
    "name": "<unchanged>",
    "description": "string",
    "kind": "pure" | "http",
    "input_schema": {"type": "object", "properties": {...}, "required": [...]},
    "output_schema": {"type": "object", "properties": {...}, "required": [...]},
    "examples": [{"input": {...}, "output": {...}, "note": "<how the output follows>"}],
    "api_details": "string",
    "http_fixtures": [],
    "secrets": [],
    "side_effects": "<unchanged>"
  },
  "directives": ["<concrete requirement>"],
  "contract_changed": true | false,
  "reasoning": "<what you changed and why, in two or three sentences>"
}

JSON Schema rules: types are string, number, integer, boolean, array, object,
null — never float/int/str/dict/list. Every array has "items"; every object
has "properties". Property names are snake_case Python identifiers.
"""
