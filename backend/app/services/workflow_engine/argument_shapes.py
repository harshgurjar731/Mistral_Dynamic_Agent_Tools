"""
Plan-time check: is every activity step handed arguments of the shape it declares?

``contracts.check_output_references`` already rejects a reference to a field an
activity does not return. It did not look at the other side of the call: the
activity's *input* schema. So a step could pass ``annual_turnover`` where the
activity required ``annual_turnover_gbp``, hand a scalar where a nested record
was required, or leave out a required field of that record — and validation
passed. Each of those is certain to fail the run with a 422.

Here every argument of every activity step is compared with the parameter it
fills, at every depth:

* a literal object must contain the parameter's required fields;
* a single ``{{reference}}`` is typed from what produces it — an activity's
  output schema, or the workflow input's declared (nested) schema — and must be
  compatible with the parameter, including the required fields of a record;
* text with references inside it is a string, so it cannot fill a record or a list.

Only what is known is judged. A reference to an agent's answer, a transform, or
a value promoted from an output has no declared type and is never reported.
"""

from __future__ import annotations

import re
from typing import Any, Iterable, Optional

_WHOLE = re.compile(r"^\s*\{\{\s*([^{}]+?)\s*\}\}\s*$")
_ANY = re.compile(r"\{\{\s*[^{}]+?\s*\}\}")
_STEP_OUT = re.compile(r"^step_(.+)_output$")


class _Missing:
    """A path the producer's schema declares it does not have."""


MISSING = _Missing()

#: Types a number-like parameter accepts after the runner's coercion.
_NUMERIC = {"number", "integer"}


def _type(schema: Any) -> Optional[str]:
    if not isinstance(schema, dict):
        return None
    t = schema.get("type")
    if isinstance(t, list):
        t = next((x for x in t if x != "null"), None)
    if not t and isinstance(schema.get("properties"), dict):
        return "object"
    if t == "file":
        return "string"
    return t if isinstance(t, str) else None


def _schema_at(schema: Any, parts: list[str]) -> Any:
    """The sub-schema at ``parts``; MISSING when declared absent; None when unknown."""
    current = schema
    for part in parts:
        if not isinstance(current, dict):
            return None
        props = current.get("properties")
        if isinstance(props, dict) and props:
            if part in props:
                current = props[part]
                continue
            if current.get("additionalProperties") in (None, False):
                return MISSING
            return None
        items = current.get("items")
        if part.isdigit() and isinstance(items, dict):
            current = items
            continue
        return None
    return current if isinstance(current, dict) else None


def _input_schema(field: dict) -> dict:
    nested = field.get("schema")
    if isinstance(nested, dict):
        return nested
    kind = str(field.get("type") or "").lower()
    return {"type": kind} if kind else {}


class _Context:
    def __init__(self, definition: dict, activities: dict[str, dict]):
        steps = [s for s in (definition or {}).get("steps") or [] if isinstance(s, dict)]
        self.inputs = {
            str(f.get("name")): _input_schema(f)
            for f in (definition or {}).get("input_schema") or []
            if isinstance(f, dict) and f.get("name")
        }
        self.contracts = {s.get("id"): activity_contract(s, activities) for s in steps}

    def reference(self, ref: str) -> Any:
        parts = [p for p in ref.strip().split(".") if p]
        if not parts:
            return None
        m = _STEP_OUT.match(parts[0])
        if m:
            contract = self.contracts.get(m.group(1))
            out = (contract or {}).get("output")
            return _schema_at(out, parts[1:]) if isinstance(out, dict) else None
        if parts[0] in self.inputs:
            return _schema_at(self.inputs[parts[0]], parts[1:])
        return None


def activity_contract(step: dict, activities: dict[str, dict]) -> Optional[dict]:
    """``{"input": schema, "output": schema}`` for a tool step, from the best source known.

    The listed activity when its version is the one the step runs; otherwise the
    requirement the step was planned with (``config.code_requirement``).
    """
    kind = getattr(step.get("type"), "value", step.get("type"))
    if kind != "tool":
        return None
    config = step.get("config") or {}
    name = config.get("tool_name")
    listed = activities.get(name) if name else None
    pinned = config.get("tool_version")
    if listed and (pinned is None or listed.get("version") in (None, pinned)):
        return {"input": listed.get("input"), "output": listed.get("output")}
    req = config.get("code_requirement")
    if isinstance(req, dict) and (req.get("input_schema") or req.get("output_schema")):
        return {"input": req.get("input_schema"), "output": req.get("output_schema")}
    if listed:
        return {"input": listed.get("input"), "output": listed.get("output")}
    return None


def _compatible(expected: Optional[str], got: Optional[str], got_schema: dict) -> bool:
    if not expected or not got or expected == got:
        return True
    if expected in _NUMERIC and got in _NUMERIC:
        return True
    if expected == "string":
        return True  # the runner hands records and lists over as JSON text
    if expected in (*_NUMERIC, "boolean") and got == "string":
        return True  # "250,000" and "true" are coerced
    props = got_schema.get("properties") if isinstance(got_schema, dict) else None
    if expected in (*_NUMERIC, "boolean", "array") and got == "object":
        # A one-field record carrying the value is unwrapped by the runner.
        return isinstance(props, dict) and len(props) == 1
    if expected == "array" and got == "string":
        return True  # JSON text of a list is parsed
    return False


def _describe(schema: Any) -> str:
    t = _type(schema) or "value"
    props = schema.get("properties") if isinstance(schema, dict) else None
    if t == "object" and isinstance(props, dict) and props:
        return "a record with " + ", ".join(sorted(props)[:12])
    return {"object": "a record", "array": "a list"}.get(t, f"a {t}")


class _Checker:
    def __init__(self, ctx: _Context, step_id: str, tool_name: str):
        self.ctx, self.step_id, self.tool = ctx, step_id, tool_name
        self.issues: list[dict] = []

    def report(self, path: str, message: str) -> None:
        self.issues.append({
            "severity": "error",
            "code": "dataflow.argument_shape",
            "step_id": self.step_id,
            "field": f"arguments.{path}" if path else "arguments",
            "message": f"Step '{self.step_id}' calls '{self.tool}': {path or 'arguments'} {message}",
        })

    # A value written in the step's arguments.
    def value(self, value: Any, schema: Any, path: str) -> None:
        if not isinstance(schema, dict):
            return
        expected = _type(schema)
        if isinstance(value, dict):
            if expected and expected not in ("object", "string"):
                self.report(path, f"is given a record, but the activity expects {_describe(schema)}.")
                return
            props = schema.get("properties") if isinstance(schema.get("properties"), dict) else {}
            missing = [r for r in schema.get("required") or [] if r not in value]
            if missing:
                self.report(path, f"is missing required field(s) {', '.join(missing)} "
                                  f"(the activity expects {_describe(schema)}).")
            for key, sub in value.items():
                if key in props:
                    self.value(sub, props[key], f"{path}.{key}" if path else key)
                elif props and schema.get("additionalProperties") is False:
                    self.report(f"{path}.{key}" if path else key,
                                f"is not a field the activity accepts (it expects {_describe(schema)}).")
            return
        if isinstance(value, list):
            if expected and expected not in ("array", "string"):
                self.report(path, f"is given a list, but the activity expects {_describe(schema)}.")
                return
            items = schema.get("items")
            for i, item in enumerate(value):
                self.value(item, items, f"{path}.{i}")
            return
        if isinstance(value, str):
            whole = _WHOLE.match(value)
            if whole:
                self.reference(whole.group(1), schema, path)
            elif _ANY.search(value) and expected in ("object", "array"):
                self.report(path, f"is text with references inside it, but the activity expects "
                                  f"{_describe(schema)}. Pass one reference to the whole value instead.")
            return
        if isinstance(value, bool) or isinstance(value, (int, float)):
            if expected in ("object", "array"):
                self.report(path, f"is a literal {type(value).__name__}, but the activity expects "
                                  f"{_describe(schema)}.")

    # A value produced by a reference, whose schema is known.
    def reference(self, ref: str, schema: dict, path: str) -> None:
        got = self.ctx.reference(ref)
        if got is MISSING or got is None:
            return  # absent fields are reported by the output-reference check; unknown is not judged
        self.schemas(got, schema, path, f"{{{{{ref}}}}}")

    def schemas(self, got: dict, expected_schema: dict, path: str, source: str) -> None:
        expected, kind = _type(expected_schema), _type(got)
        if not _compatible(expected, kind, got):
            self.report(path, f"receives {source}, which is {_describe(got)}, but the activity "
                              f"expects {_describe(expected_schema)}.")
            return
        if expected != "object" or kind != "object":
            return
        got_props = got.get("properties")
        if not isinstance(got_props, dict) or not got_props:
            return  # an undeclared record: its fields are unknown
        exp_props = expected_schema.get("properties") if isinstance(expected_schema.get("properties"), dict) else {}
        missing = [r for r in expected_schema.get("required") or [] if r not in got_props]
        if missing:
            self.report(path, f"receives {source}, which has no {', '.join(missing)} — "
                              f"required by the activity (it has {', '.join(sorted(got_props)[:12])}).")
        for key, sub in exp_props.items():
            if key in got_props and isinstance(sub, dict) and isinstance(got_props[key], dict):
                self.schemas(got_props[key], sub, f"{path}.{key}" if path else key, f"{source}.{key}")


def check_argument_shapes(definition: dict, activities: Optional[dict[str, dict]] = None) -> list[dict]:
    """Issues for activity arguments that cannot match the activity's input schema.

    ``activities`` maps an activity name to ``{"input": schema, "output": schema,
    "version": n}``; steps also contribute the requirement they were planned with.
    """
    activities = activities or {}
    ctx = _Context(definition, activities)
    issues: list[dict] = []
    for step in (definition or {}).get("steps") or []:
        if not isinstance(step, dict):
            continue
        contract = ctx.contracts.get(step.get("id"))
        params = (contract or {}).get("input")
        if not isinstance(params, dict) or not isinstance(params.get("properties"), dict):
            continue
        config = step.get("config") or {}
        arguments = config.get("arguments", config.get("arguments_template"))
        if not isinstance(arguments, dict):
            continue
        checker = _Checker(ctx, str(step.get("id")), str(config.get("tool_name")))
        checker.value(arguments, {"type": "object", **params}, "")
        issues.extend(checker.issues)
    return issues


def catalog_from_listing(tools: Iterable[dict]) -> dict[str, dict]:
    """The activities of a tool-service listing, as ``check_argument_shapes`` takes them."""
    out: dict[str, dict] = {}
    for t in tools or []:
        if not isinstance(t, dict):
            continue
        fn = (t.get("schema") or {}).get("function") or {}
        name = fn.get("name") or t.get("name")
        if not name or not (t.get("is_active", True) and t.get("status", "approved") == "approved"):
            continue
        params = fn.get("parameters")
        out[name] = {"input": params if isinstance(params, dict) else None,
                     "output": t.get("output_schema"), "version": t.get("version_no")}
    return out


def catalog_from_inventory(activities: Iterable[dict]) -> dict[str, dict]:
    """The planner's inventory activities (``parameters`` as properties), as above."""
    out: dict[str, dict] = {}
    for a in activities or []:
        if not isinstance(a, dict) or not a.get("name"):
            continue
        params = a.get("parameters")
        if isinstance(params, dict) and "properties" not in params:
            params = {"type": "object", "properties": params, "required": list(a.get("required") or [])}
        out[a["name"]] = {"input": params if isinstance(params, dict) else None,
                          "output": a.get("output_schema"), "version": a.get("version")}
    return out
