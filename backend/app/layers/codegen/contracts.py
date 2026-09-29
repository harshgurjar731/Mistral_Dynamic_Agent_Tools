"""
Data-flow contract checks — does every field reference exist?

A workflow step reads an earlier step's output as ``{{step_<id>_output.<field>}}``.
When the earlier step is an activity, its output schema says exactly which
fields exist, so a reference to any other field is known, at plan time, to
fail at run time ("Arguments reference ..., which no earlier step produced").
This module finds those references so validation can reject the plan instead.
"""

from __future__ import annotations

import re
from typing import Any, Iterable

_REF = re.compile(r"\{\{\s*step_([A-Za-z0-9_]+?)_output\.([A-Za-z0-9_]+)")


def _strings(value: Any) -> Iterable[str]:
    if isinstance(value, str):
        yield value
    elif isinstance(value, dict):
        for v in value.values():
            yield from _strings(v)
    elif isinstance(value, list):
        for v in value:
            yield from _strings(v)


def check_output_references(dag: dict, output_schemas: dict[str, dict]) -> list[dict]:
    """Issues for references to fields an activity's output does not have.

    ``output_schemas`` maps step id → that step's activity output schema; steps
    without one (agents, connectors, legacy activities) are not checked.
    """
    issues: list[dict] = []
    for step in (dag or {}).get("steps", []):
        for text in _strings(step.get("config") or {}):
            for step_ref, field in _REF.findall(text):
                schema = output_schemas.get(step_ref)
                props = (schema or {}).get("properties") if isinstance(schema, dict) else None
                if not isinstance(props, dict) or not props:
                    continue
                if field not in props:
                    issues.append({
                        "severity": "error",
                        "code": "dataflow.unknown_output_field",
                        "step_id": step.get("id"),
                        "field": field,
                        "message": (
                            f"Step '{step.get('id')}' reads '{field}' from step '{step_ref}', "
                            f"whose activity returns only: {', '.join(sorted(props))}."
                        ),
                    })
    return issues
