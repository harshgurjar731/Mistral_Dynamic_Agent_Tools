"""
The run input, checked against the workflow's declared inputs.

The run form is built from ``input_schema``; this is the same schema enforced
on the way in, so a payload from the API, the JSON editor or a remote server
is held to exactly what the form would have sent. A wrong payload is refused
before anything starts, with every problem listed at once — rather than
failing on whichever step first reads it, inside the worker, after retries.
"""

from __future__ import annotations

import re
from datetime import date, datetime
from typing import Any

from app.workflow_inputs import schema

_EMAIL = re.compile(r"^[^\s@]+@[^\s@]+\.[^\s@]+$")
_NUMERIC_FORMATS = {"integer", "currency", "money", "percent", "percentage"}


def _empty(value: Any) -> bool:
    return value is None or (isinstance(value, (str, list, dict)) and len(value) == 0) or (
        isinstance(value, str) and not value.strip())


def _is_number(value: Any) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool)


def _check_format(label: str, fmt: str, value: str) -> str | None:
    fmt = (fmt or "").lower()
    if fmt == "email" and not _EMAIL.match(value.strip()):
        return f"{label} must be an email address"
    if fmt in ("url", "uri") and not re.match(r"^https?://\S+$", value.strip()):
        return f"{label} must be a full http(s) URL"
    if fmt == "date":
        try:
            date.fromisoformat(value.strip())
        except ValueError:
            return f"{label} must be a date (YYYY-MM-DD)"
    if fmt in ("datetime", "date-time"):
        try:
            datetime.fromisoformat(value.strip().replace("Z", "+00:00"))
        except ValueError:
            return f"{label} must be a date and time (ISO 8601)"
    return None


def _check_field(definition, field: dict, value: Any) -> list[str]:
    name = field["name"]
    label = f"'{name}'"
    kind = schema.normalise_type(field.get("type"))

    if kind == "file":
        if isinstance(value, str):
            return []  # the document's text, pasted instead of uploaded
        if not schema.holds_documents(value):
            return [f"{label} must be an uploaded document (or its text pasted in)"]
        refs = schema.document_refs(value)
        problems = []
        limit = schema.max_files(field)
        if len(refs) > limit:
            problems.append(f"{label} accepts at most {limit} document{'s' if limit > 1 else ''}")
        problems += [f"{label}: {p}" for p in _documents_ok(definition.name, name, refs)]
        return problems

    enum = field.get("enum")
    if isinstance(enum, list) and enum:
        if str(value) not in {str(o) for o in enum}:
            return [f"{label} must be one of: {', '.join(str(o) for o in enum)}"]
        return []

    if kind == "string":
        # A string collected as an amount, a percent or a whole number arrives
        # as the number the form parsed it to.
        if _is_number(value) and str(field.get("format") or "").lower() in _NUMERIC_FORMATS:
            return []
        if not isinstance(value, str):
            return [f"{label} must be text"]
        if str(field.get("format") or "").lower() in _NUMERIC_FORMATS:
            try:
                float(value.strip().replace(",", "").lstrip("£$€").rstrip("%"))
            except ValueError:
                return [f"{label} must be a number"]
            return []
        problem = _check_format(label, str(field.get("format") or ""), value)
        return [problem] if problem else []

    if kind in ("number", "integer"):
        if not _is_number(value):
            return [f"{label} must be a number"]
        if kind == "integer" and not float(value).is_integer():
            return [f"{label} must be a whole number"]
        lo, hi = field.get("min"), field.get("max")
        if _is_number(lo) and value < lo:
            return [f"{label} must be at least {lo}"]
        if _is_number(hi) and value > hi:
            return [f"{label} must be at most {hi}"]
        return []

    if kind == "boolean":
        return [] if isinstance(value, bool) else [f"{label} must be true or false"]

    if kind == "object":
        return [] if isinstance(value, dict) else [f"{label} must be a JSON object"]

    if kind == "array":
        if not isinstance(value, list):
            return [f"{label} must be a list"]
        items = str(field.get("items") or "").lower()
        if items in ("number", "integer") and not all(_is_number(v) for v in value):
            return [f"every entry of {label} must be a number"]
        if items == "string" and not all(isinstance(v, str) for v in value):
            return [f"every entry of {label} must be text"]
        return []

    return []


def _documents_ok(workflow_name: str, field_name: str, refs: list[dict]) -> list[str]:
    from app.workflow_inputs import documents

    return documents.check_refs(workflow_name, field_name, refs)


def check(definition, payload: Any) -> list[str]:
    """Every problem with ``payload`` as input to ``definition``; empty when it is fine."""
    if not isinstance(payload, dict):
        return ["The run input must be a JSON object"]

    fields = schema.declared_fields(definition)
    implicit = schema.implicit_inputs(definition)
    if not fields and not implicit:
        # Nothing declared: the object is passed through as the run's variables.
        return []

    problems: list[str] = []
    allowed = {f["name"] for f in fields} | set(implicit)
    unknown = sorted(k for k in payload if k not in allowed)
    if unknown:
        problems.append(
            f"Not inputs of this workflow: {', '.join(unknown)}. "
            f"It accepts: {', '.join(sorted(allowed))}")

    missing = []
    for field in fields:
        name = field["name"]
        value = payload.get(name)
        if _empty(value):
            if field.get("required", True) is not False:
                missing.append(name)
            continue
        problems += _check_field(definition, field, value)
    # Read by the entry step without being declared: text, like the form sends.
    for name in implicit:
        if _empty(payload.get(name)):
            missing.append(name)
    if missing:
        problems.insert(0, f"Missing required input{'s' if len(missing) > 1 else ''}: "
                           f"{', '.join(missing)}")
    return problems
