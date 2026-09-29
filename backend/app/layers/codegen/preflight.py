"""
R6 pre-flight — deterministic checks and repairs on an authored requirement.

Everything here is decidable without a model: JSON Schema validity, examples
consistent with the schemas, names that are legal and unique. Fixing what can
be fixed locally, and catching the rest before a synthesis job is queued,
saves a round trip through the tool service for a spec it would reject.
"""

from __future__ import annotations

import re
from typing import Any

from app.core.specs import CodeRequirement

PURE = "No external API. This is a pure computation using the standard library."
NAME_RE = re.compile(r"^[a-z][a-z0-9_]{2,63}$")

_TYPE_FIXES = {
    "float": "number", "double": "number", "decimal": "number", "int": "integer",
    "str": "string", "text": "string", "bool": "boolean", "dict": "object",
    "map": "object", "list": "array", "tuple": "array",
}


def fix_types(schema: Any) -> Any:
    if isinstance(schema, dict):
        out = {}
        for key, value in schema.items():
            if key == "type" and isinstance(value, str):
                out[key] = _TYPE_FIXES.get(value.lower(), value.lower())
            else:
                out[key] = fix_types(value)
        return out
    if isinstance(schema, list):
        return [fix_types(v) for v in schema]
    return schema


def _without_required(schema: Any) -> Any:
    if isinstance(schema, dict):
        return {k: _without_required(v) for k, v in schema.items() if k != "required"}
    if isinstance(schema, list):
        return [_without_required(v) for v in schema]
    return schema


def _validate(schema: dict, value: Any) -> str | None:
    try:
        import jsonschema
    except ImportError:  # pragma: no cover
        return None
    try:
        jsonschema.validate(value, schema)
        return None
    except jsonschema.ValidationError as e:
        where = "/".join(str(p) for p in e.absolute_path)
        return f"{where or '(root)'}: {e.message}"
    except jsonschema.SchemaError as e:
        return f"invalid schema: {e.message}"


def _schema_problem(schema: dict) -> str | None:
    try:
        import jsonschema

        jsonschema.Draft202012Validator.check_schema(schema)
        return None
    except ImportError:  # pragma: no cover
        return None
    except Exception as e:  # SchemaError
        return getattr(e, "message", str(e))


def normalise(req: CodeRequirement, taken_names: set[str], *, keep_name: bool = False) -> CodeRequirement:
    """Local repairs: types, schema shape, name legality and uniqueness."""
    from app.layers.codegen.profiles import snake

    req.input_schema = fix_types(req.input_schema if isinstance(req.input_schema, dict) else {})
    req.input_schema.setdefault("type", "object")
    props = req.input_schema.get("properties")
    if not isinstance(props, dict):
        props = {}
    req.input_schema["properties"] = props
    req.input_schema["required"] = [r for r in (req.input_schema.get("required") or []) if r in props]

    if isinstance(req.output_schema, dict) and req.output_schema:
        req.output_schema = fix_types(req.output_schema)
        req.output_schema.setdefault("type", "object")
    else:
        req.output_schema = None

    req.examples = [e for e in (req.examples or []) if isinstance(e, dict) and isinstance(e.get("input"), dict)]
    req.kind = req.kind if req.kind in ("pure", "http") else "pure"
    req.api_details = str(req.api_details or "").strip() or PURE
    req.side_effects = req.side_effects if req.side_effects in ("none", "read-only", "write", "delete") else "none"
    req.http_fixtures = [f for f in (req.http_fixtures or []) if isinstance(f, dict)]
    req.secrets = [str(s) for s in (req.secrets or []) if str(s).strip()]

    if not keep_name:
        name = snake(req.name) or "generated_function"
        if len(name) < 3:
            name = f"{name}_fn"
        base, n = name, 2
        # A new build must not take an existing name: that would silently make
        # it the next version of an unrelated tool, and every caller of that
        # tool would start running this code.
        while name in taken_names:
            name = f"{base[:60]}_{n}"
            n += 1
        req.name = name
    return req


def check(req: CodeRequirement) -> list[str]:
    """Problems only the author can fix."""
    issues = []
    if not NAME_RE.match(req.name or ""):
        issues.append(f"name '{req.name}' is not snake_case")
    if len((req.description or "").strip()) < 10:
        issues.append("description is missing or too short to implement from")

    problem = _schema_problem(req.input_schema)
    if problem:
        issues.append(f"input_schema is invalid: {problem}")
    if req.output_schema:
        problem = _schema_problem(req.output_schema)
        if problem:
            issues.append(f"output_schema is invalid: {problem}")

    for i, example in enumerate(req.examples, 1):
        problem = _validate(req.input_schema, example["input"])
        if problem:
            issues.append(f"example {i} input breaks input_schema — {problem}")
        if example.get("output") is not None and req.output_schema:
            problem = _validate(_without_required(req.output_schema), example["output"])
            if problem:
                issues.append(f"example {i} output breaks output_schema — {problem}")

    if req.kind == "http" and req.api_details.strip() == PURE:
        issues.append("kind is 'http' but api_details does not name the API")
    return issues
