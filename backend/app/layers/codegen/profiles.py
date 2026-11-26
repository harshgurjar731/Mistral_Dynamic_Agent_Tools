"""
Requirement profiles — how authoring a tool differs from authoring an activity.

The counterpart of the tool service's CodeProfile. The layers are shared; the
profile decides what the specification must say and how it must fit what is
around it:

    tool       written for an agent to choose and call: descriptions, enums,
               examples of valid calls; exact outputs optional
    activity   written for a workflow: every capability output is a named
               output field, and worked examples carry exact values
"""

from __future__ import annotations

import json
import logging
import re
from typing import Optional

from app.core.specs import CodeRequirement
from app.prompts_codegen import ACTIVITY_SPEC_SYSTEM, TOOL_SPEC_SYSTEM

logger = logging.getLogger(__name__)

_SNAKE = re.compile(r"[^a-z0-9]+")


def snake(text: str) -> str:
    value = _SNAKE.sub("_", str(text or "").strip().lower()).strip("_")
    if value and not value[0].isalpha():
        value = f"f_{value}"
    return value[:64]


class RequirementProfile:
    purpose = "tool"
    noun = "agent tool"
    author_system = TOOL_SPEC_SYSTEM

    def in_catalogue(self, tool: dict) -> bool:
        """Whether a catalogue entry can satisfy a need of this purpose."""
        purpose = tool.get("purpose") or "tool"
        active = tool.get("is_active", tool.get("status") == "approved")
        return purpose == self.purpose and tool.get("status") == "approved" and bool(active)

    def author_user(self, *, need, normalised: dict, issues: list[str],
                    previous: Optional[CodeRequirement]) -> str:
        parts = [f"## Need\n{need.intent or normalised.get('summary', '')}"]
        if need.guidance:
            parts.append("## Guidance from the user (follow it; it overrides the need where they conflict)\n"
                         + "\n".join(f"- {g}" for g in need.guidance))
        if need.goal:
            parts.append(f"## Wider goal\n{need.goal}")
        if normalised:
            parts.append("## Structured need\n" + json.dumps(normalised, indent=2))
        if need.draft:
            parts.append("## Draft from the caller (refine it; do not trust it blindly)\n"
                         + json.dumps(need.draft, indent=2, default=str))
        parts.extend(self.context_blocks(need))
        if getattr(need, "industry_knowledge", None):
            from app.knowledge.industry import render_for_code

            parts.append(render_for_code(need.industry_knowledge))
        if issues and previous is not None:
            parts.append("## Your previous specification was rejected\n"
                         + json.dumps(previous.as_request(), indent=2, default=str)
                         + "\n\nProblems to fix:\n" + "\n".join(f"- {i}" for i in issues))
        return "\n\n".join(parts)

    def context_blocks(self, need) -> list[str]:
        return []

    def bind_contract(self, need, req: CodeRequirement) -> list[str]:
        """Does the spec fit what surrounds it? Returns issues."""
        issues = []
        props = (req.input_schema or {}).get("properties") or {}
        undocumented = [n for n, d in props.items()
                        if not (isinstance(d, dict) and str(d.get("description") or "").strip())]
        if undocumented:
            issues.append("every parameter needs a description an agent can choose values "
                          "from; missing for: " + ", ".join(undocumented))
        return issues

    def preflight(self, req: CodeRequirement) -> list[str]:
        return []


class ActivityRequirementProfile(RequirementProfile):
    purpose = "activity"
    noun = "workflow activity"
    author_system = ACTIVITY_SPEC_SYSTEM

    def context_blocks(self, need) -> list[str]:
        blocks = []
        cap = need.capability or {}
        if cap:
            blocks.append(
                "## Capability this activity implements\n"
                + json.dumps({k: cap.get(k) for k in ("id", "name", "purpose", "inputs", "outputs")},
                             indent=2)
                + "\nThe output_schema must contain every name in \"outputs\"."
            )
        contract = getattr(need, "contract", None) or {}
        if contract.get("input_schema") or contract.get("output_schema"):
            blocks.append(
                "## DATA CONTRACT (mandatory — the workflow is built to it)\n"
                "input_schema MUST be exactly:\n" + json.dumps(contract.get("input_schema"), indent=2)
                + "\noutput_schema MUST be exactly:\n" + json.dumps(contract.get("output_schema"), indent=2)
                + "\nUse these property names, nesting, types and required fields as given; write "
                  "the worked examples to these exact shapes.")
        if need.upstream:
            blocks.append("## Steps that feed it (their outputs become its inputs)\n"
                          + json.dumps(need.upstream, indent=2, default=str))
            if any(isinstance(u, dict) and u.get("output_schema") for u in need.upstream):
                blocks.append(
                    "Where a feeding step lists an output_schema, that is exactly what it returns. "
                    "Every input that carries that data must use the same field names and nesting "
                    "(no renamed fields, no added unit suffixes such as _gbp), so the workflow can "
                    "pass the output straight through.")
        if need.downstream:
            blocks.append("## Steps that read its output\n"
                          + json.dumps(need.downstream, indent=2, default=str))
        return blocks

    def bind_contract(self, need, req: CodeRequirement) -> list[str]:
        issues = _hold_to_contract(need, req)
        normalise_example_nulls(req)
        out_props = ((req.output_schema or {}).get("properties") or {})
        if not out_props:
            return ["output_schema must declare the fields later steps read"]
        wanted = [snake(o) for o in (need.capability or {}).get("outputs") or [] if snake(o)]
        missing = [o for o in wanted if o not in out_props]
        if missing:
            issues.append("output_schema is missing the capability outputs later steps "
                          "will reference: " + ", ".join(missing)
                          + f" (present: {', '.join(sorted(out_props))})")
        issues += _renamed_upstream_fields(need, req)
        dropped = drop_composed_text(req)
        if dropped:
            import logging

            logging.getLogger(__name__).info(
                "Activity '%s': composed text left out of worked example outputs: %s",
                req.name, "; ".join(dropped))
        with_output = [e for e in req.examples if isinstance(e, dict) and e.get("output") is not None]
        if len(with_output) < (2 if req.kind == "pure" else 1):
            issues.append("give at least 2 worked examples with exact outputs")
        if req.side_effects in ("write", "delete"):
            issues.append("an activity may not write or delete; that belongs to a connector step")
        return issues


def _hold_to_contract(need, req: CodeRequirement) -> list[str]:
    """The workflow's data contract is the activity's schema: set it, and check the examples fit.

    The author was told the schemas; enforcing them here means a spec that
    drifted (a renamed field, a flattened record) is corrected rather than
    built, and worked examples written to another shape send it back.
    """
    contract = getattr(need, "contract", None) or {}
    if not (contract.get("input_schema") or contract.get("output_schema")):
        return []
    if contract.get("input_schema"):
        req.input_schema = json.loads(json.dumps(contract["input_schema"]))
    if contract.get("output_schema"):
        req.output_schema = json.loads(json.dumps(contract["output_schema"]))
    try:
        import jsonschema
    except ImportError:  # pragma: no cover — declared in requirements
        return []
    normalise_example_nulls(req)
    issues = []
    bad: set[int] = set()
    for i, example in enumerate(req.examples, 1):
        if not isinstance(example, dict):
            continue
        for part, schema in (("input", req.input_schema), ("output", req.output_schema)):
            value = example.get(part)
            if value is None or not isinstance(schema, dict):
                continue
            try:
                jsonschema.validate(value, schema)
            except jsonschema.ValidationError as e:
                where = "/".join(str(p) for p in e.absolute_path) or part
                if part == "output" and e.validator == "required":
                    continue  # an example may leave out fields it cannot predict
                bad.add(i)
                issues.append(f"worked example {i} {part} does not match the data contract at "
                              f"{where}: {e.message}")
    if bad:
        # One example off the contract does not need the whole specification
        # written again (50–70 s each time, and two of seven activities in one
        # plan went round twice): when enough sound examples remain, the bad
        # one is left out. An input the contract rejects never reaches the
        # activity at run time anyway — the step's arguments are checked first.
        sound = [e for i, e in enumerate(req.examples, 1) if i not in bad]
        with_output = [e for e in sound if isinstance(e, dict) and e.get("output") is not None]
        if len(with_output) >= (2 if req.kind == "pure" else 1):
            logger.info("Activity '%s': left out %d worked example(s) that did not match the data "
                        "contract (%s)", req.name, len(bad), "; ".join(issues)[:300])
            req.examples = sound
            return []
    return issues[:6]


def normalise_example_nulls(req: CodeRequirement) -> None:
    """Leave out of every worked example the optional fields written as null.

    Three of six specifications in one plan were sent back to their author —
    minutes each — because an example said ``"email": null`` for an optional
    string field. Null there means "absent"; the example is rewritten to say so,
    at every depth, exactly as the step runner treats run-time arguments.
    """
    from app.services.workflow_engine.conform import drop_optional_nulls_deep

    for example in req.examples:
        if not isinstance(example, dict):
            continue
        for part, schema in (("input", req.input_schema), ("output", req.output_schema)):
            if isinstance(example.get(part), dict) and isinstance(schema, dict):
                example[part] = drop_optional_nulls_deep(example[part], schema)


#: Composed text: a string of this many words or more is prose, not a value.
_PROSE_WORDS = 6


def _strings_in(value) -> set[str]:
    if isinstance(value, str):
        return {value.strip()}
    if isinstance(value, dict):
        return set().union(*(_strings_in(v) for v in value.values())) if value else set()
    if isinstance(value, list):
        return set().union(*(_strings_in(v) for v in value)) if value else set()
    return set()


def _enum_values(schema) -> set[str]:
    out: set[str] = set()
    if isinstance(schema, dict):
        out |= {str(v) for v in schema.get("enum") or []}
        for v in schema.values():
            out |= _enum_values(v)
    elif isinstance(schema, list):
        for v in schema:
            out |= _enum_values(v)
    return out


def _is_prose(text: str, keep: set[str]) -> bool:
    text = text.strip()
    return len(text.split()) >= _PROSE_WORDS and text not in keep


def _without_prose(value, keep: set[str], path: str, dropped: list[str]):
    """``value`` with prose strings removed (dict keys left out, list items kept)."""
    if isinstance(value, dict):
        out = {}
        for k, v in value.items():
            if isinstance(v, str) and _is_prose(v, keep):
                dropped.append(f"{path}.{k}" if path else k)
                continue
            out[k] = _without_prose(v, keep, f"{path}.{k}" if path else k, dropped)
        return out
    if isinstance(value, list):
        return [_without_prose(v, keep, f"{path}[{i}]", dropped) for i, v in enumerate(value)]
    return value


def drop_composed_text(req: CodeRequirement) -> list[str]:
    """Leave composed text out of the worked examples' outputs. Returns what was dropped.

    The tool service compares an example's output with the code's word for word,
    and no code reproduces a written sentence exactly — "Output Safety and
    Delivery" failed its build that way. An example only states the fields it
    names, so the message field stays in the schema and is simply not compared.
    Text copied from the example's input and enum values are kept.
    """
    keep_schema = _enum_values(req.output_schema)
    dropped: list[str] = []
    for i, example in enumerate(req.examples, 1):
        if not isinstance(example, dict) or not isinstance(example.get("output"), (dict, list)):
            continue
        keep = keep_schema | _strings_in(example.get("input"))
        found: list[str] = []
        example["output"] = _without_prose(example["output"], keep, "", found)
        dropped += [f"example {i}: {p}" for p in found]
    return dropped


#: Suffixes that only restate a unit or currency — the renames worth refusing.
_UNIT_SUFFIXES = ("gbp", "usd", "eur", "inr", "pct", "percent", "percentage", "amount", "value",
                  "num", "number", "count", "qty", "months", "days", "years")
_CONTAINERS = ("object", "array")


def _fields(schema, depth: int = 0) -> dict[str, dict]:
    """Field name → its schema, down one level of nesting."""
    props = (schema or {}).get("properties") if isinstance(schema, dict) else None
    if not isinstance(props, dict):
        return {}
    out = {k: v for k, v in props.items() if isinstance(v, dict)}
    if depth < 1:
        for sub in props.values():
            for k, v in _fields(sub, depth + 1).items():
                out.setdefault(k, v)
    return out


def _field_names(schema, depth: int = 0) -> set[str]:
    return set(_fields(schema, depth))


def _kind(schema: dict) -> str:
    t = schema.get("type")
    if isinstance(t, list):
        t = next((x for x in t if x != "null"), None)
    if not t and isinstance(schema.get("properties"), dict):
        return "object"
    return str(t or "")


def _unit_rename(a: str, b: str) -> bool:
    """``a`` and ``b`` differ only by a unit suffix (``equipment_cost`` / ``equipment_cost_gbp``)."""
    short, long = sorted((a, b), key=len)
    return long.startswith(short + "_") and long[len(short) + 1:] in _UNIT_SUFFIXES


def _renamed_upstream_fields(need, req: CodeRequirement) -> list[str]:
    """Inputs that rename a value an upstream activity returns (``equipment_cost_gbp`` for
    ``equipment_cost``). Each forces a mapping in the workflow that was easy to get wrong.

    Only plain values whose names differ by a unit suffix count: a record such as
    ``incident`` is not a renamed ``incident_date``. With a data contract the
    contract fixes the names, so there is nothing to compare.
    """
    contract = getattr(need, "contract", None) or {}
    if contract.get("input_schema") or contract.get("output_schema"):
        return []
    upstream: dict[str, dict] = {}
    for u in need.upstream or []:
        if isinstance(u, dict):
            for k, v in _fields(u.get("output_schema")).items():
                upstream.setdefault(k, v)
    if not upstream:
        return []
    renamed = []
    for name, schema in sorted(_fields(req.input_schema).items()):
        if name in upstream or _kind(schema) in _CONTAINERS:
            continue
        for field, theirs in sorted(upstream.items()):
            if _kind(theirs) in _CONTAINERS or not _unit_rename(name, field):
                continue
            renamed.append(f"'{name}' (the feeding step returns '{field}')")
            break
    if not renamed:
        return []
    return ["input_schema renames fields the feeding steps return — use their exact names: "
            + ", ".join(renamed)]


PROFILES = {"tool": RequirementProfile(), "activity": ActivityRequirementProfile()}


def profile_for(purpose: str) -> RequirementProfile:
    return PROFILES.get(purpose or "tool", PROFILES["tool"])
