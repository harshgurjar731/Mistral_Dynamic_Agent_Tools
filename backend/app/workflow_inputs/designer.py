"""
The workflow input schema, designed — every field accurate, every example valid.

The run form is built from ``input_schema`` and the run is checked against it,
so a wrong field is a workflow nobody can start: a number declared as text, a
record declared as "object" with no fields (the user types ``{}`` and the
activity behind it fails), an input the steps read but nobody declared, an
example the run check itself rejects.

The planner's data-flow decision writes the schema as a by-product of wiring
templates. This module is the authority that comes after it, deterministic and
model-free:

* **Usage** — which steps read each input, and how: as a whole tool argument,
  as a field of one (``{{claim.amount}}``), inside an agent's template, in a
  condition.
* **Binding** — an input passed to an activity's parameter takes that
  parameter's type, constraints and nested schema. The activity's contract is
  ground truth; a model's guess is not.
* **Discovery** — variables read before anything could have produced them are
  inputs, declared or not.
* **Cleanup** — one spelling per type, formats that fit the type, enums of the
  right type, bounds that make sense, a nested ``schema`` for structured
  values, a human label.
* **Examples** — every field gets one realistic example that passes exactly
  the check a run is held to (``run_input``) and its nested schema; together
  they make one payload "Fill example" can submit as is.

``InputSchemaLayer`` (``app/layers/workflow/input_schema_layer.py``) asks the
large model for descriptions, labels and one coherent example scenario, then
runs everything here over its answer, so the model can improve the schema but
never break it.
"""

from __future__ import annotations

import copy
import json
import re
from datetime import date, timedelta
from typing import Any, Optional

from app.workflow_inputs import schema as base

_WHOLE_REF = re.compile(r"^\s*\{{2,}\s*([A-Za-z_][\w.]*)\s*\}{2,}\s*$")
_ANY_REF = re.compile(r"\{{2,}\s*([^{}\s]+?)\s*\}{2,}")
_STEP_OUTPUT = re.compile(r"^step_.+_output$")

#: Presentation formats each type may carry. A string can be collected as an
#: amount or a whole number (the form parses it; the run check accepts it).
FORMATS_BY_TYPE: dict[str, set[str]] = {
    "string": {"text", "long_text", "email", "url", "date", "datetime",
               "currency", "percent", "integer"},
    "number": {"currency", "percent"},
    "integer": {"integer"},
}
_FORMAT_ALIASES = {
    "textarea": "long_text", "multiline": "long_text", "paragraph": "long_text",
    "date-time": "datetime", "timestamp": "datetime", "uri": "url", "link": "url",
    "money": "currency", "amount": "currency", "percentage": "percent",
    "int": "integer", "whole": "integer", "e-mail": "email",
}
#: JSON Schema ``format`` values a tool parameter may carry → run-form format.
_JSON_FORMATS = {"date": "date", "date-time": "datetime", "email": "email", "uri": "url",
                 "url": "url"}
_ITEM_TYPES = ("string", "number", "integer", "boolean", "object")

#: Name hints for synthesised examples, most specific first.
_HINTS: tuple[tuple[tuple[str, ...], Any], ...] = (
    (("email",), "jane.doe@example.com"),
    (("url", "website", "link", "endpoint"), "https://www.example.com"),
    (("phone", "mobile"), "+44 20 7946 0958"),
    (("postcode", "postal_code", "zip"), "SW1A 1AA"),
    (("country",), "United Kingdom"),
    (("currency",), "GBP"),
    (("city",), "London"),
    (("address",), "221B Baker Street, London NW1 6XE"),
    (("first_name", "firstname"), "Jane"),
    (("last_name", "surname", "lastname"), "Doe"),
    (("company", "organisation", "organization", "employer", "vendor", "supplier"),
     "Acme Industries Ltd"),
    (("name",), "Jane Doe"),
    (("invoice_number", "invoice_no", "invoice_id"), "INV-2026-0042"),
    (("policy_number", "policy_no", "policy_id"), "POL-778812"),
    (("claim_number", "claim_id"), "CLM-104233"),
    (("order", "po_number"), "PO-58231"),
    (("account",), "ACC-0098812"),
    (("id", "reference", "ref", "number", "code"), "REF-00123"),
    (("description", "details", "summary", "notes", "comment", "message", "text",
      "content", "query", "question", "request", "body", "narrative"), None),
)


# ── Usage ───────────────────────────────────────────────────────────────────


def _step_dict(step: Any) -> dict:
    if isinstance(step, dict):
        return step
    return {
        "id": getattr(step, "id", ""),
        "type": getattr(getattr(step, "type", ""), "value", getattr(step, "type", "")),
        "config": getattr(step, "config", None) or {},
        "next_steps": list(getattr(step, "next_steps", None) or []),
        "description": getattr(step, "description", "") or "",
    }


def _strings_with_keys(value: Any, key: str = ""):
    if isinstance(value, str):
        yield key, value
    elif isinstance(value, dict):
        for k, v in value.items():
            yield from _strings_with_keys(v, k if not key else key)
    elif isinstance(value, (list, tuple)):
        for v in value:
            yield from _strings_with_keys(v, key)


def _snippet(text: str, start: int, end: int, radius: int = 160) -> str:
    lo, hi = max(0, start - radius), min(len(text), end + radius)
    return ("…" if lo else "") + text[lo:hi].strip() + ("…" if hi < len(text) else "")


def usages(steps: list) -> dict[str, list[dict]]:
    """Every reference to a non-step variable, by root name.

    Each usage: ``{"step_id", "step_type", "where", "path", "snippet"}`` where
    ``where`` is ``argument:<param>`` for a tool/connector argument and the
    config key otherwise (``query_template``, ``expression``…), and ``path`` is
    the dotted remainder (``amount`` for ``{{claim.amount}}``).
    """
    out: dict[str, list[dict]] = {}
    for raw in steps or []:
        step = _step_dict(raw)
        config = step.get("config") or {}
        arguments = config.get("arguments") if isinstance(config.get("arguments"), dict) else {}
        for key, value in config.items():
            if key == "arguments":
                continue
            for _, text in _strings_with_keys(value):
                for m in _ANY_REF.finditer(text):
                    _add_usage(out, step, m.group(1), key, _snippet(text, m.start(), m.end()))
        for param, value in arguments.items():
            for _, text in _strings_with_keys(value):
                for m in _ANY_REF.finditer(text):
                    whole = _WHOLE_REF.match(text)
                    _add_usage(out, step, m.group(1), f"argument:{param}", text.strip()[:200],
                               whole=bool(whole and whole.group(1) == m.group(1)))
    return out


def _add_usage(out: dict, step: dict, ref: str, where: str, snippet: str, whole: bool = False):
    root, _, path = ref.partition(".")
    if not root or _STEP_OUTPUT.match(root):
        return
    out.setdefault(root, []).append({
        "step_id": step.get("id"), "step_type": str(step.get("type") or ""),
        "where": where, "path": path, "snippet": snippet, "whole": whole,
    })


# ── Discovery ───────────────────────────────────────────────────────────────


def _upstream(steps: list[dict]) -> dict[str, set[str]]:
    """Every step's transitive predecessors."""
    parents: dict[str, set[str]] = {s["id"]: set() for s in steps}
    for s in steps:
        for nxt in s.get("next_steps") or []:
            if nxt in parents:
                parents[nxt].add(s["id"])
    memo: dict[str, set[str]] = {}

    def walk(sid: str, seen: frozenset) -> set[str]:
        if sid in memo:
            return memo[sid]
        found: set[str] = set()
        for p in parents.get(sid, ()):
            if p in seen:
                continue
            found |= {p} | walk(p, seen | {p})
        memo[sid] = found
        return found

    return {sid: walk(sid, frozenset({sid})) for sid in parents}


def _known_outputs(step: dict, param_lookup: "ParamLookup",
                   step_outputs: Optional[dict] = None) -> Optional[set[str]]:
    """Field names a step's output is promoted to; None when they cannot be known."""
    if step_outputs and step.get("id") in step_outputs:
        return set(step_outputs[step["id"]] or [])
    stype = str(step.get("type") or "")
    config = step.get("config") or {}
    if stype in ("tool",):
        out = param_lookup.output_schema(step)
        props = (out or {}).get("properties") if isinstance(out, dict) else None
        return set(props) if isinstance(props, dict) else None
    if stype in ("condition", "human_review"):
        return set()
    if stype == "agent":
        fields = config.get("output_fields") or config.get("output_keys")
        return set(fields) if isinstance(fields, list) else None
    return None


def undeclared_inputs(steps: list, entry_step: Optional[str], declared: set[str],
                      variables: set[str], param_lookup: "ParamLookup",
                      step_outputs: Optional[dict] = None) -> list[str]:
    """Variables some step reads that nothing could have produced before it.

    The entry step's unknown references are inputs by definition. A later
    step's are inputs only when every step before it has a known output shape
    — an agent's free-form JSON may promote any key, and guessing there would
    put a field on the run form nobody needs to fill.
    """
    steps = [_step_dict(s) for s in steps or []]
    by_id = {s["id"]: s for s in steps}
    ups = _upstream(steps)
    found: list[str] = []
    for root, uses in usages(steps).items():
        if root in declared or root in variables or root in found or not base.valid_name(root):
            continue
        for use in uses:
            sid = use["step_id"]
            if sid == entry_step:
                found.append(root)
                break
            produced: set[str] = set()
            unknown = False
            for p in ups.get(sid, set()):
                outs = _known_outputs(by_id[p], param_lookup, step_outputs)
                if outs is None:
                    unknown = True
                    break
                produced |= outs
            if not unknown and root not in produced:
                found.append(root)
                break
    return sorted(found)


# ── Binding to activity parameters ──────────────────────────────────────────


class ParamLookup:
    """Parameter and output schemas of the activities tool steps call.

    Sources, best first: the step's stored ``code_requirement`` (the exact
    spec it was built from), then catalogue entries handed in (planning
    inventory or the tool registry).
    """

    def __init__(self, catalogue: Optional[list[dict]] = None):
        self._by_name: dict[str, dict] = {}
        for entry in catalogue or []:
            name = entry.get("name")
            if not name:
                continue
            params = entry.get("parameters")
            if isinstance(params, dict) and "properties" not in params:
                params = {"type": "object", "properties": params,
                          "required": list(entry.get("required") or [])}
            self._by_name[name] = {"input": params if isinstance(params, dict) else {},
                                   "output": entry.get("output_schema")}

    def _for(self, step: dict) -> dict:
        config = step.get("config") or {}
        req = config.get("code_requirement")
        if isinstance(req, dict) and isinstance(req.get("input_schema"), dict):
            return {"input": req["input_schema"], "output": req.get("output_schema")}
        return self._by_name.get(str(config.get("tool_name") or ""), {})

    def param(self, step: dict, name: str) -> Optional[dict]:
        props = (self._for(step).get("input") or {}).get("properties") or {}
        value = props.get(name)
        return value if isinstance(value, dict) else None

    def param_required(self, step: dict, name: str) -> bool:
        return name in ((self._for(step).get("input") or {}).get("required") or [])

    def output_schema(self, step: dict) -> Optional[dict]:
        out = self._for(step).get("output")
        return out if isinstance(out, dict) else None


def _primary_type(schema: dict) -> str:
    t = schema.get("type")
    if isinstance(t, list):
        t = next((x for x in t if x != "null"), "string")
    return base.normalise_type(t or ("object" if "properties" in schema else "string"))


def _nest(path: str, leaf: dict) -> dict:
    """``a.b`` + leaf → an object schema with ``a`` holding ``b``."""
    schema = copy.deepcopy(leaf)
    for part in reversed([p for p in path.split(".") if p]):
        schema = {"type": "object", "properties": {part: schema}, "required": [part]}
    return schema


def _merge(a: Optional[dict], b: dict) -> dict:
    if a is None:
        return copy.deepcopy(b)
    if _primary_type(a) == "object" and _primary_type(b) == "object":
        props = dict(a.get("properties") or {})
        for k, v in (b.get("properties") or {}).items():
            props[k] = _merge(props.get(k), v) if k in props else copy.deepcopy(v)
        required = list(dict.fromkeys([*(a.get("required") or []), *(b.get("required") or [])]))
        return {**a, "type": "object", "properties": props, "required": required}
    return a


def _whole_refs(value: Any, schema: Optional[dict]):
    """``(reference, the parameter schema it fills)`` for every whole reference in an argument,
    at any depth — ``{"application": {"term": "{{raw.loan_term_months}}"}}`` included."""
    if isinstance(value, str):
        m = _WHOLE_REF.match(value)
        if m and isinstance(schema, dict):
            yield m.group(1), schema
    elif isinstance(value, dict):
        props = (schema or {}).get("properties") if isinstance(schema, dict) else None
        for key, sub in value.items():
            yield from _whole_refs(sub, (props or {}).get(key) if isinstance(props, dict) else None)
    elif isinstance(value, list):
        items = (schema or {}).get("items") if isinstance(schema, dict) else None
        for sub in value:
            yield from _whole_refs(sub, items if isinstance(items, dict) else None)


def bindings(steps: list, param_lookup: ParamLookup) -> dict[str, dict]:
    """The JSON Schema each input must satisfy, from the activity parameters it feeds."""
    out: dict[str, dict] = {}
    for raw in steps or []:
        step = _step_dict(raw)
        if str(step.get("type") or "") != "tool":
            continue
        arguments = (step.get("config") or {}).get("arguments") or {}
        if not isinstance(arguments, dict):
            continue
        for param, value in arguments.items():
            for ref, leaf in _whole_refs(value, param_lookup.param(step, param)):
                root, _, path = ref.partition(".")
                if _STEP_OUTPUT.match(root) or not leaf:
                    continue
                out[root] = _merge(out.get(root), _nest(path, leaf) if path else leaf)
    return out


def _nest_optional(path: str, leaf: dict) -> dict:
    """Like ``_nest``, without marking the path required."""
    schema = copy.deepcopy(leaf)
    for part in reversed([p for p in path.split(".") if p]):
        schema = {"type": "object", "properties": {part: schema}}
    return schema


def read_paths(steps: list) -> dict[str, dict]:
    """Every field a step reads from an input record, as a nested schema per input.

    An agent prompt that reads ``{{raw_application.credit_file}}`` needs that
    field on every run, but nothing declared it: the run form did not offer it
    and the example omitted it. Paths read anywhere are declared here (optional,
    untyped unless an activity binding types them).
    """
    out: dict[str, dict] = {}
    for root, uses in usages(steps).items():
        for use in uses:
            path = use.get("path") or ""
            if not path or any(p.isdigit() for p in path.split(".")):
                continue
            leaf = {"description": f"Read by step '{use.get('step_id')}'."}
            out[root] = _merge(out.get(root), _nest_optional(path, leaf))
    return out


# ── Examples ────────────────────────────────────────────────────────────────


def _hint(name: str) -> Any:
    lowered = (name or "").lower()
    for needles, value in _HINTS:
        if any(n in lowered for n in needles):
            return value
    return None


def _number_for(name: str, schema: dict, integer: bool) -> float | int:
    lowered = (name or "").lower()
    lo, hi = schema.get("minimum", schema.get("min")), schema.get("maximum", schema.get("max"))
    if any(k in lowered for k in ("percent", "pct", "rate", "ratio")):
        value: float = 7.5
    elif any(k in lowered for k in ("age",)):
        value = 42
    elif any(k in lowered for k in ("year",)) and "years" not in lowered:
        value = date.today().year
    elif any(k in lowered for k in ("years", "term", "tenure")):
        value = 5
    elif any(k in lowered for k in ("months",)):
        value = 12
    elif any(k in lowered for k in ("days",)):
        value = 30
    elif any(k in lowered for k in ("count", "qty", "quantity", "number_of", "num_", "items")):
        value = 3
    elif any(k in lowered for k in ("score",)):
        value = 720
    elif any(k in lowered for k in ("amount", "price", "cost", "total", "salary", "income",
                                     "premium", "fee", "budget", "revenue", "payment",
                                     "balance", "limit", "principal", "loan", "value")):
        value = 25000
    else:
        value = 10
    if isinstance(lo, (int, float)) and not isinstance(lo, bool) and value < lo:
        value = lo if not isinstance(hi, (int, float)) else (lo + hi) / 2
    if isinstance(hi, (int, float)) and not isinstance(hi, bool) and value > hi:
        value = hi if not isinstance(lo, (int, float)) else (lo + hi) / 2
    return int(round(value)) if integer else (float(value) if not float(value).is_integer()
                                              else int(value))


def _string_for(name: str, fmt: str, description: str) -> str:
    today = date.today()
    if fmt == "email":
        return "jane.doe@example.com"
    if fmt == "url":
        return "https://www.example.com"
    if fmt == "date":
        lowered = name.lower()
        if any(k in lowered for k in ("birth", "dob")):
            return "1985-06-14"
        if any(k in lowered for k in ("due", "deadline", "end", "expiry", "until")):
            return (today + timedelta(days=30)).isoformat()
        return (today - timedelta(days=7)).isoformat()
    if fmt == "datetime":
        return (today - timedelta(days=1)).isoformat() + "T09:30:00Z"
    if fmt in ("currency",):
        return "25000"
    if fmt == "percent":
        return "7.5"
    if fmt == "integer":
        return "3"
    hinted = _hint(name)
    if isinstance(hinted, str):
        return hinted
    subject = base_label(name).lower()
    if fmt == "long_text" or hinted is None and any(
            k in name.lower() for k in ("description", "details", "notes", "message", "text")):
        what = (description or "").strip().rstrip(".")
        return (f"{what}: " if what and len(what) < 120 else "") + (
            f"Sample {subject} for a test run — replace it with the real {subject}.")
    return f"Sample {subject}"


def sample_from_schema(schema: dict, name: str = "", depth: int = 0) -> Any:
    """A value satisfying a JSON Schema, realistic where the name allows."""
    if not isinstance(schema, dict):
        return _string_for(name, "", "")
    for key in ("default", "example"):
        if key in schema and schema[key] is not None:
            return copy.deepcopy(schema[key])
    if isinstance(schema.get("examples"), list) and schema["examples"]:
        return copy.deepcopy(schema["examples"][0])
    if isinstance(schema.get("enum"), list) and schema["enum"]:
        return schema["enum"][0]
    t = _primary_type(schema)
    if t == "object":
        props = schema.get("properties") if isinstance(schema.get("properties"), dict) else {}
        if depth >= 4:
            return {}
        return {k: sample_from_schema(v, k, depth + 1) for k, v in props.items()}
    if t == "array":
        items = schema.get("items") if isinstance(schema.get("items"), dict) else {"type": "string"}
        count = max(1, min(int(schema.get("minItems") or 2), 3))
        first = sample_from_schema(items, _singular(name), depth + 1)
        values = [first]
        for i in range(1, count):
            nxt = sample_from_schema(items, _singular(name), depth + 1)
            values.append(_vary(nxt, i))
        return values
    if t == "boolean":
        return True
    if t in ("number", "integer"):
        return _number_for(name, schema, integer=t == "integer")
    fmt = _JSON_FORMATS.get(str(schema.get("format") or "").lower(), "")
    return _string_for(name, fmt, str(schema.get("description") or ""))


def _singular(name: str) -> str:
    return name[:-1] if name.endswith("s") and not name.endswith("ss") else name


def _vary(value: Any, i: int) -> Any:
    """A second list entry that is not a copy of the first."""
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return value + i * (value if value else 1) / 2 if isinstance(value, float) else value + i
    if isinstance(value, str):
        return f"{value} ({i + 1})" if not re.match(r"^\d{4}-\d{2}-\d{2}", value) else value
    if isinstance(value, dict):
        return {k: _vary(v, i) for k, v in value.items()}
    return value


def coerce_to_schema(value: Any, schema: Any) -> Any:
    """Unambiguous representations made exact, at every depth of a nested schema.

    "4,250.50" → 4250.5 for a number, "true" → True for a boolean, JSON text →
    the object it spells. Anything ambiguous is left for validation to reject.
    """
    if not isinstance(schema, dict):
        return value
    t = _primary_type(schema)
    if t == "object":
        if isinstance(value, str):
            try:
                value = json.loads(value)
            except ValueError:
                return value
        props = schema.get("properties") if isinstance(schema.get("properties"), dict) else {}
        if isinstance(value, dict):
            return {k: coerce_to_schema(v, props.get(k)) for k, v in value.items()}
        return value
    if t == "array":
        if isinstance(value, str):
            try:
                value = json.loads(value)
            except ValueError:
                return value
        if isinstance(value, list):
            return [coerce_to_schema(v, schema.get("items")) for v in value]
        return value
    if t in ("number", "integer") and isinstance(value, str):
        text = value.strip().replace(",", "").lstrip("£$€").rstrip("%").strip()
        try:
            number = float(text)
        except ValueError:
            return value
        return int(number) if t == "integer" or number.is_integer() else number
    if t == "integer" and isinstance(value, float) and value.is_integer():
        return int(value)
    if t == "boolean" and isinstance(value, str) and value.strip().lower() in ("true", "false"):
        return value.strip().lower() == "true"
    if t == "string" and isinstance(value, (int, float)) and not isinstance(value, bool):
        return str(value)
    return value


def coerce_example(field: dict, value: Any) -> Any:
    """``value`` in the representation the run check expects for ``field``."""
    kind = base.normalise_type(field.get("type"))
    if value is None:
        return None
    if kind in ("object", "array") and isinstance(field.get("schema"), dict):
        return coerce_to_schema(value, field["schema"])
    if kind in ("number", "integer") and isinstance(value, str):
        text = value.strip().replace(",", "").lstrip("£$€").rstrip("%").strip()
        try:
            number = float(text)
        except ValueError:
            return value
        return int(number) if kind == "integer" or number.is_integer() else number
    if kind == "integer" and isinstance(value, float) and value.is_integer():
        return int(value)
    if kind == "boolean" and isinstance(value, str) and value.strip().lower() in ("true", "false"):
        return value.strip().lower() == "true"
    if kind in ("object", "array") and isinstance(value, str):
        try:
            parsed = json.loads(value)
        except ValueError:
            return value
        return parsed
    if kind == "string" and isinstance(value, (int, float)) and not isinstance(value, bool):
        fmt = str(field.get("format") or "").lower()
        return value if fmt in ("currency", "percent", "integer") else str(value)
    if isinstance(field.get("enum"), list) and field["enum"] and not isinstance(value, (dict, list)):
        match = next((o for o in field["enum"] if str(o).lower() == str(value).strip().lower()), None)
        if match is not None:
            return match
    return value


def example_problem(field: dict, value: Any) -> Optional[str]:
    """Why ``value`` would be refused for ``field`` on a real run; None if it would pass."""
    from app.workflow_inputs import run_input

    if value is None or (isinstance(value, str) and not value.strip()):
        return "empty"
    problems = run_input.check_value(field, value)
    if problems:
        return problems[0]
    nested = field.get("schema")
    if isinstance(nested, dict):
        try:
            import jsonschema

            jsonschema.validate(value, nested)
        except ImportError:  # pragma: no cover
            pass
        except Exception as e:  # noqa: BLE001 — ValidationError / SchemaError
            return getattr(e, "message", str(e))
    return None


def synthesise_example(field: dict) -> Any:
    kind = base.normalise_type(field.get("type"))
    name = str(field.get("name") or "")
    if isinstance(field.get("enum"), list) and field["enum"]:
        return field["enum"][0]
    nested = field.get("schema")
    if kind in ("object", "array") and isinstance(nested, dict):
        return sample_from_schema(nested, name)
    if kind == "object":
        return {}
    if kind == "array":
        items = str(field.get("items") or "string")
        if items in ("number", "integer"):
            return [_number_for(_singular(name), field, items == "integer"),
                    _number_for(_singular(name), field, items == "integer") + 1]
        if items == "boolean":
            return [True, False]
        if items == "object":
            return [{}]
        hinted = _hint(_singular(name))
        first = hinted if isinstance(hinted, str) else f"Sample {base_label(_singular(name)).lower()}"
        return [first, f"{first} (2)"]
    if kind == "boolean":
        return True
    if kind in ("number", "integer"):
        schema = {"minimum": field.get("min"), "maximum": field.get("max")}
        return _number_for(name, schema, kind == "integer")
    fmt = str(field.get("format") or "").lower()
    if fmt in ("currency", "percent", "integer"):
        return _number_for(name, {"minimum": field.get("min"), "maximum": field.get("max")},
                           fmt == "integer")
    return _string_for(name, fmt, str(field.get("description") or ""))


def best_example(field: dict, *candidates: Any) -> Any:
    """The first candidate that passes the run check, else a synthesised one."""
    for candidate in (*candidates, synthesise_example(field)):
        if candidate is None:
            continue
        value = coerce_example(field, copy.deepcopy(candidate))
        if example_problem(field, value) is None:
            return value
    return None


# ── Field cleanup ───────────────────────────────────────────────────────────


def base_label(name: str) -> str:
    words = re.sub(r"[_\-]+", " ", re.sub(r"([a-z])([A-Z])", r"\1 \2", name or "")).strip()
    return words[:1].upper() + words[1:] if words else name


def _bool(value: Any, default: bool = True) -> bool:
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        return value.strip().lower() not in ("false", "no", "0", "optional", "")
    if value is None:
        return default
    return bool(value)


def _num(value: Any) -> Optional[float | int]:
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        return value
    if isinstance(value, str):
        try:
            number = float(value.strip().replace(",", ""))
        except ValueError:
            return None
        return int(number) if number.is_integer() else number
    return None


def _format_for(kind: str, raw: Any) -> Optional[str]:
    fmt = str(raw or "").strip().lower()
    fmt = _FORMAT_ALIASES.get(fmt, fmt)
    return fmt if fmt in FORMATS_BY_TYPE.get(kind, set()) else None


def clean_schema(schema: Any, depth: int = 0) -> Optional[dict]:
    """A nested JSON Schema with fixed type spellings, or None."""
    if not isinstance(schema, dict) or depth > 6:
        return None
    out: dict = {}
    t = schema.get("type")
    if isinstance(t, list):
        out["type"] = [base.normalise_type(x) if x != "null" else "null" for x in t]
    elif t:
        nt = base.normalise_type(t)
        out["type"] = nt if nt in ("string", "number", "integer", "boolean", "object", "array",
                                   "null") else "string"
    for key in ("description", "enum", "minimum", "maximum", "minItems", "maxItems", "format",
                "pattern", "minLength", "maxLength", "title"):
        if key in schema:
            out[key] = copy.deepcopy(schema[key])
    if isinstance(schema.get("properties"), dict):
        out["properties"] = {k: clean_schema(v, depth + 1) or {"type": "string"}
                             for k, v in schema["properties"].items()}
        out.setdefault("type", "object")
        req = [r for r in (schema.get("required") or []) if r in out["properties"]]
        if req:
            out["required"] = req
    if isinstance(schema.get("items"), dict):
        out["items"] = clean_schema(schema["items"], depth + 1) or {"type": "string"}
        out.setdefault("type", "array")
    try:
        import jsonschema

        jsonschema.Draft202012Validator.check_schema(out)
    except ImportError:  # pragma: no cover
        pass
    except Exception:  # noqa: BLE001 — an unusable nested schema is dropped, not trusted
        return None
    return out


def finalise_field(raw: dict, *, bound: Optional[dict] = None,
                   example_candidates: tuple = ()) -> Optional[dict]:
    """One input field made strict. ``bound``: the activity parameter schema it feeds."""
    name = str(raw.get("name") or "").strip()
    if not base.valid_name(name):
        return None
    kind = base.normalise_type(raw.get("type"))
    if kind not in base.INPUT_TYPES:
        kind = "string"
    if kind == "file":
        field = {k: v for k, v in raw.items() if k not in ("example", "schema", "default")}
        field.update(name=name, label=str(raw.get("label") or "").strip() or base_label(name),
                     required=_bool(raw.get("required")),
                     description=str(raw.get("description") or "").strip())
        return base.normalise_file_field(field)

    field: dict = {"name": name}
    nested = clean_schema(raw.get("schema")) if isinstance(raw.get("schema"), dict) else None
    if bound:
        # The activity's contract decides what the value must be.
        kind = _primary_type(bound)
        bound_clean = clean_schema(bound)
        if kind in ("object", "array") and bound_clean:
            nested = bound_clean
    field["type"] = kind
    field["label"] = str(raw.get("label") or "").strip() or base_label(name)
    description = str(raw.get("description") or "").strip()
    if not description and bound and bound.get("description"):
        description = str(bound["description"]).strip()
    field["description"] = description
    field["required"] = _bool(raw.get("required"))

    fmt = _format_for(kind, raw.get("format"))
    if fmt is None and bound and kind == "string":
        fmt = _JSON_FORMATS.get(str(bound.get("format") or "").lower())
    if fmt:
        field["format"] = fmt

    enum = raw.get("enum")
    if bound and isinstance(bound.get("enum"), list) and bound["enum"]:
        enum = bound["enum"]
    if isinstance(enum, list) and kind in ("string", "number", "integer"):
        values = []
        for option in enum:
            if isinstance(option, (dict, list)) or option is None:
                continue
            if kind in ("number", "integer"):
                option = _num(option)
                if option is None:
                    continue
            else:
                option = str(option)
            if option not in values:
                values.append(option)
        if values:
            field["enum"] = values
            field.pop("format", None)

    if kind in ("number", "integer") or (kind == "string" and fmt in ("currency", "percent",
                                                                       "integer")):
        lo = _num(raw.get("min", raw.get("minimum")))
        hi = _num(raw.get("max", raw.get("maximum")))
        if bound:
            lo = _num(bound.get("minimum")) if _num(bound.get("minimum")) is not None else lo
            hi = _num(bound.get("maximum")) if _num(bound.get("maximum")) is not None else hi
        if lo is not None and hi is not None and lo > hi:
            lo, hi = hi, lo
        if lo is not None:
            field["min"] = lo
        if hi is not None:
            field["max"] = hi

    if kind in ("object", "array"):
        if nested and _primary_type(nested) == kind:
            field["schema"] = nested
        if kind == "array":
            items = None
            if nested and isinstance(nested.get("items"), dict):
                items = _primary_type(nested["items"])
            if items is None:
                declared = base.normalise_type(raw.get("items")) if raw.get("items") else None
                items = declared if declared in _ITEM_TYPES else None
            field["items"] = items if items in _ITEM_TYPES else "string"

    if raw.get("default") is not None:
        default = coerce_example(field, raw["default"])
        if example_problem(field, default) is None:
            field["default"] = default

    field["example"] = best_example(field, *example_candidates, raw.get("example"),
                                    raw.get("default"))
    if field["example"] is None:
        field.pop("example")
    return field


# ── The whole schema ────────────────────────────────────────────────────────


def finalise_input_schema(
    input_schema: list,
    steps: list,
    entry_step: Optional[str],
    *,
    variables: Optional[dict] = None,
    catalogue: Optional[list[dict]] = None,
    example_payload: Optional[dict] = None,
    step_outputs: Optional[dict] = None,
) -> list[dict]:
    """The input schema made accurate: bound, discovered, cleaned, exemplified.

    Pure and idempotent — running it on its own output changes nothing — so
    it is safe on save, after a revision, and after the model's design.

    ``step_outputs``: field names known to be produced per step id (agent
    steps' declared outputs during planning). Without it, a variable read
    after an agent step is never assumed to be an input.
    """
    lookup = ParamLookup(catalogue)
    bound = bindings(steps, lookup)
    payload = example_payload if isinstance(example_payload, dict) else {}

    fields: list[dict] = []
    seen: set[str] = set()
    for raw in input_schema or []:
        if not isinstance(raw, dict):
            continue
        name = str(raw.get("name") or "").strip()
        if not name or name in seen:
            continue
        field = finalise_field(raw, bound=bound.get(name),
                               example_candidates=(payload.get(name),))
        if field is None:
            continue
        seen.add(name)
        fields.append(field)

    declared = {f["name"] for f in fields}
    uses = usages(steps)
    for name in undeclared_inputs(steps, entry_step, declared, set((variables or {}).keys()),
                                  lookup, step_outputs):
        schema_for = bound.get(name)
        inferred = _primary_type(schema_for) if schema_for else _type_from_usage(name, uses)
        draft = {"name": name, "type": inferred,
                 "required": True,
                 "description": (schema_for or {}).get("description") or "Read by the workflow's "
                                "steps; nothing earlier produces it."}
        field = finalise_field(draft, bound=schema_for, example_candidates=(payload.get(name),))
        if field is not None:
            fields.append(field)

    # Declare every path the steps read from an input record, so the run form,
    # the example and the activities agree on one field list.
    paths = read_paths(steps)
    for field in fields:
        extra = paths.get(field["name"])
        if not extra or field.get("type") != "object":
            continue
        merged = clean_schema(_merge(field.get("schema") or {"type": "object", "properties": {}}, extra))
        if merged:
            field["schema"] = merged
    return fields


def _type_from_usage(name: str, uses: dict) -> str:
    """``number`` for a variable only ever compared numerically in conditions."""
    found = uses.get(name) or []
    compare = re.compile(r"\{\{\s*" + re.escape(name) + r"\s*\}\}\s*(<=|>=|<|>)|"
                         r"(<=|>=|<|>)\s*\{\{\s*" + re.escape(name) + r"\s*\}\}")
    if found and all(u["where"] == "expression" and compare.search(u["snippet"]) for u in found):
        return "number"
    return "string"


def example_payload_of(input_schema: list) -> dict:
    """``{name: example}`` for every field that has one (documents never do)."""
    return {f["name"]: copy.deepcopy(f["example"]) for f in input_schema or []
            if isinstance(f, dict) and f.get("name") and "example" in f}


def usage_report(steps: list, input_schema: list, catalogue: Optional[list[dict]] = None) -> list[dict]:
    """For the design prompt: each input, how it is used, and what is fixed about it."""
    lookup = ParamLookup(catalogue)
    bound = bindings(steps, lookup)
    uses = usages(steps)
    report = []
    for field in input_schema or []:
        name = field.get("name")
        entry = {"name": name, "used_by": uses.get(name, [])[:6]}
        if name in bound:
            entry["bound_to_activity_parameter"] = bound[name]
        report.append(entry)
    return report


def registry_catalogue() -> list[dict]:
    """Activity parameter schemas from the loaded tool registry (no I/O)."""
    try:
        from app.services.tool_registry import ALL_TOOLS
    except Exception:  # noqa: BLE001 — the registry is optional here
        return []
    out = []
    for name, spec in list(ALL_TOOLS.items()):
        fn = (spec or {}).get("function") if isinstance(spec, dict) else None
        if isinstance(fn, dict) and isinstance(fn.get("parameters"), dict):
            out.append({"name": name, "parameters": fn["parameters"]})
    return out


def finalise_definition(definition) -> bool:
    """Apply :func:`finalise_input_schema` to a saved definition. True when it changed.

    Run on every save, so a workflow edited by hand, by a revision or by the
    builder keeps an accurate run form — and an older workflow gains one the
    next time it is saved.
    """
    before = list(getattr(definition, "input_schema", None) or [])
    after = finalise_input_schema(
        before, list(getattr(definition, "steps", None) or []),
        getattr(definition, "entry_step", None),
        variables=getattr(definition, "variables", None) or {},
        catalogue=registry_catalogue(),
    )
    if after == before:
        return False
    definition.input_schema = after
    return True
