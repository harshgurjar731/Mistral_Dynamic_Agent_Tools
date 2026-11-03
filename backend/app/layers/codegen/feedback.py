"""
Rebuild from an error — revise the specification before rebuilding.

A rebuild used to send the stored specification unchanged, with the user's
comment attached as prose and an instruction to "keep the same input schema
and output schema". So an instruction that changed what the code must do —
"round to 2 decimals", "accept a missing discount", "also return the tax
line" — reached the generator as a request that contradicted its own contract
and worked examples. The examples won: the code was tested against the old
behaviour, and the rebuilt version did not do what the user asked.

Here the stored specification is revised first, by the large model on the
``spec_revision`` route, so its description, schemas and worked examples
already say what the user asked. The user's instructions also become a
checklist (``feedback["directives"]``) the tool service puts at the top of the
generation prompt and repeats in every repair round.

The revision is checked before it is used: valid schemas, examples that
satisfy them, no worked example lost and no output field silently dropped.
A revision that fails a check is not used — the stored specification is
rebuilt with the directives instead.
"""

from __future__ import annotations

import json
import logging
from typing import Any, Optional

from app.core.decision import decide, parse_json
from app.core.specs import CodeRequirement

logger = logging.getLogger(__name__)

#: Spec fields the revision may change. name, purpose and side_effects never change.
_REVISABLE = ("description", "kind", "input_schema", "output_schema", "examples",
              "api_details", "http_fixtures", "secrets")
_MAX_DIRECTIVES = 12


def user_prompt(req: CodeRequirement, feedback: dict, expected_output: Any = None) -> str:
    current = {k: v for k, v in req.as_request().items() if k not in ("feedback", "origin")}
    parts = ["## Current specification\n" + json.dumps(current, indent=2, default=str)]
    if feedback.get("runtime_error"):
        parts.append("## Error seen at run time\n" + str(feedback["runtime_error"]))
    if feedback.get("comment"):
        parts.append("## The user's instructions (authoritative)\n" + str(feedback["comment"]))
    if feedback.get("failing_input"):
        parts.append("## Input it failed on (the rebuilt version must succeed on it)\n"
                     + json.dumps(feedback["failing_input"], indent=2, default=str))
    if expected_output is not None:
        parts.append("## Output the user says it should have produced for that input\n"
                     + json.dumps(expected_output, indent=2, default=str))
    if feedback.get("previous_code"):
        parts.append("## The code that failed (context only)\n"
                     + str(feedback["previous_code"])[:8000])
    return "\n\n".join(parts)


def _schema_problem(schema: Any) -> Optional[str]:
    if not isinstance(schema, dict) or schema.get("type") not in (None, "object"):
        return "must be an object schema"
    try:
        import jsonschema

        jsonschema.Draft202012Validator.check_schema(schema)
    except ImportError:  # pragma: no cover — declared in requirements
        return None
    except Exception as e:  # noqa: BLE001 — jsonschema.SchemaError
        return getattr(e, "message", str(e))
    return None


def _instance_problem(schema: dict, value: Any) -> Optional[str]:
    try:
        import jsonschema

        jsonschema.validate(value, schema)
    except ImportError:  # pragma: no cover
        return None
    except Exception as e:  # noqa: BLE001
        return getattr(e, "message", str(e))
    return None


def _without_required(schema: Any) -> Any:
    if isinstance(schema, dict):
        return {k: _without_required(v) for k, v in schema.items() if k != "required"}
    if isinstance(schema, list):
        return [_without_required(v) for v in schema]
    return schema


def _with_output(examples: list) -> int:
    return len([e for e in examples or [] if isinstance(e, dict) and e.get("output") is not None])


def check_revision(original: CodeRequirement, revised: dict, *, user_comment: str = "") -> list[str]:
    """Problems that make a revised specification unusable. Empty: use it."""
    from app.layers.codegen.preflight import fix_types

    problems = []
    for key in ("input_schema", "output_schema"):
        if revised.get(key) is not None:
            revised[key] = fix_types(revised[key])
            problem = _schema_problem(revised[key])
            if problem:
                problems.append(f"{key}: {problem}")
    if problems:
        return problems

    in_schema = revised.get("input_schema") or original.input_schema or {}
    out_schema = revised.get("output_schema") or original.output_schema or {}
    old_out = set(((original.output_schema or {}).get("properties") or {}))
    new_out = set((out_schema.get("properties") or {}))
    dropped = sorted(name for name in old_out - new_out if name not in (user_comment or ""))
    if dropped:
        # Later workflow steps read these by name; only the user may remove one.
        problems.append("output field(s) removed without being asked: " + ", ".join(dropped))

    examples = revised.get("examples", original.examples)
    if not isinstance(examples, list):
        return problems + ["examples must be a list"]
    if _with_output(examples) < _with_output(original.examples):
        problems.append("the revision dropped worked examples")
    for i, example in enumerate(examples, 1):
        if not isinstance(example, dict) or not isinstance(example.get("input"), dict):
            problems.append(f"example {i} has no input object")
            continue
        problem = _instance_problem(in_schema, example["input"])
        if problem:
            problems.append(f"example {i} input breaks the input schema: {problem}")
        if example.get("output") is not None and out_schema:
            problem = _instance_problem(_without_required(out_schema), example["output"])
            if problem:
                problems.append(f"example {i} output breaks the output schema: {problem}")
    return problems


def directives_from(raw: Any, comment: str, error: str) -> list[str]:
    """The user's instructions as a checklist; the comment itself when none came back."""
    items: list[str] = []
    for item in raw if isinstance(raw, list) else []:
        text = str(item or "").strip()
        if text and text not in items:
            items.append(text[:500])
    if not items:
        if comment:
            items.append(comment[:500])
        if error:
            items.append("Make sure this run-time error cannot happen again: " + error[:400])
    return items[:_MAX_DIRECTIVES]


async def revise_for_feedback(ctx, *, expected_output: Any = None) -> bool:
    """Revise ``ctx.requirement`` for a rebuild. Returns True when the spec changed.

    Never raises and never stops the rebuild. Sets ``feedback["directives"]``
    in every case, and the revised fields only when the revision checks out.
    """
    req: CodeRequirement = ctx.requirement
    feedback = dict(req.feedback or {})
    comment = str(feedback.get("comment") or "").strip()
    error = str(feedback.get("runtime_error") or "").strip()
    if not (comment or error):
        return False

    from app.prompts_codegen import SPEC_REVISION_SYSTEM

    ctx.emit("author", "revising the specification to follow your instructions")
    data: Any = None
    try:
        raw = await decide(ctx.client, route="spec_revision",
                           system=SPEC_REVISION_SYSTEM.replace("<<NOUN>>", ctx.profile.noun),
                           user=user_prompt(req, feedback, expected_output),
                           phase="rebuild specification revision")
        data = parse_json(raw, None)
    except Exception as e:  # noqa: BLE001 — the rebuild goes ahead on the stored spec
        logger.warning("Specification revision for '%s' failed: %s", req.name, e)
    data = data if isinstance(data, dict) else {}

    feedback["directives"] = directives_from(data.get("directives"), comment, error)
    req.feedback = feedback
    revised = data.get("specification")
    if not isinstance(revised, dict):
        ctx.emit("author", "kept the stored specification; your instructions go to the code "
                           "generator as a checklist")
        return False

    revised = {k: revised[k] for k in _REVISABLE if k in revised}
    for key in ("description", "api_details", "kind"):
        if key in revised and not str(revised[key] or "").strip():
            revised.pop(key)
    for key in ("secrets", "http_fixtures", "examples"):
        if key in revised and not isinstance(revised[key], list):
            revised.pop(key)
    problems = check_revision(req, revised, user_comment=comment)
    if problems:
        logger.warning("Specification revision for '%s' rejected: %s", req.name, problems)
        ctx.emit("author", "kept the stored specification — the revision did not check out ("
                           + "; ".join(problems)[:240] + ")")
        return False

    for key, value in revised.items():
        setattr(req, key, value)
    reason = str(data.get("reasoning") or "").strip()
    changed = bool(data.get("contract_changed"))
    ctx.emit("author", ("specification revised" + (" — inputs/outputs changed" if changed else ""))
             + (f": {reason[:240]}" if reason else ""))
    return True
