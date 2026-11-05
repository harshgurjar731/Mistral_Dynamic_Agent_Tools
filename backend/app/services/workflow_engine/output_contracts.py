"""
Output contracts — make a step produce the fields later steps read from it.

A later step reads ``{{step_<id>_output.<field>}}``. When step ``<id>`` is an
activity, its output schema fixes the field names and plan validation checks
the reference. When it is an *agent*, nothing told the agent which names were
expected: it answered with ``moderation_results`` or wrapped everything in
``{"result": {...}}``, and the reader failed with "Arguments reference ...,
which no earlier step produced".

Three parts, used by the step runners:

* ``attach_output_contracts`` records on each agent step the fields read from
  it (``config["output_fields"]``), computed from the whole graph, so the step
  carries them into both the local engine and a compiled worker.
* ``contract_instruction`` is the line appended to that agent's prompt.
* ``find_field`` resolves a reference against an output whose key is spelled
  differently, or that sits one wrapper deeper than the reference assumes.
"""

from __future__ import annotations

import json
import re
from typing import Any, Iterable, Optional

_REF = re.compile(r"\{\{\s*step_([A-Za-z0-9_]+?)_output\.([A-Za-z0-9_]+)")
_MISSING = object()


def _strings(value: Any) -> Iterable[str]:
    if isinstance(value, str):
        yield value
    elif isinstance(value, dict):
        for v in value.values():
            yield from _strings(v)
    elif isinstance(value, list):
        for v in value:
            yield from _strings(v)


def referenced_fields(steps: list) -> dict[str, list[str]]:
    """``{step_id: [fields other steps read from its output]}``."""
    found: dict[str, set] = {}
    for step in steps or []:
        for text in _strings(getattr(step, "config", None) or {}):
            for step_id, field in _REF.findall(text):
                found.setdefault(step_id, set()).add(field)
    return {k: sorted(v) for k, v in found.items()}


def attach_output_contracts(steps: list) -> None:
    """Record on every agent step the output fields later steps read from it."""
    fields = referenced_fields(steps)
    for step in steps or []:
        kind = getattr(getattr(step, "type", None), "value", getattr(step, "type", None))
        wanted = fields.get(step.id)
        if kind == "agent" and wanted:
            step.config = {**(step.config or {}), "output_fields": wanted}


def contract_instruction(fields: list[str]) -> str:
    keys = ", ".join(f'"{f}"' for f in fields)
    return (
        "\n\nOUTPUT FORMAT (required): later steps read your result by field name. "
        f"End your answer with one JSON object in a ```json block whose top-level keys "
        f"are exactly: {keys}. Put the complete value for each key directly under it "
        "(no wrapper object, no renamed keys)."
    )


# ── Reading an agent's answer ─────────────────────────────────────────────


def _objects(text: str) -> list[dict]:
    """Every JSON object in ``text``: fenced blocks first, then bare ones."""
    found: list[dict] = []
    for block in re.findall(r"```(?:json)?\s*(.*?)```", text, re.S):
        try:
            parsed = json.loads(block.strip())
        except ValueError:
            continue
        if isinstance(parsed, dict):
            found.append(parsed)
    decoder = json.JSONDecoder()
    i = text.find("{")
    while 0 <= i < len(text):
        try:
            parsed, end = decoder.raw_decode(text, i)
        except ValueError:
            i = text.find("{", i + 1)
            continue
        if isinstance(parsed, dict):
            found.append(parsed)
        i = text.find("{", end)
    return found


def extract_json_object(text: str, wanted: Optional[list[str]] = None) -> Optional[dict]:
    """The JSON object an agent's answer carries, or None.

    With ``wanted`` fields, the object holding most of them wins; otherwise the
    largest one. A bare-``{`` scan handles nested objects, which a non-greedy
    regex cut off at the first ``}``.
    """
    if not isinstance(text, str):
        return None
    candidates = _objects(text)
    if not candidates:
        return None
    if wanted:
        def score(obj: dict) -> tuple:
            return (sum(find_field(obj, f) is not _MISSING for f in wanted), len(json.dumps(obj)))
        return max(candidates, key=score)
    return max(candidates, key=lambda o: len(json.dumps(o)))


# ── Resolving a field reference ───────────────────────────────────────────


def _norm(key: Any) -> str:
    return re.sub(r"[^a-z0-9]", "", str(key).lower())


def _nested(value: Any, target: str, depth: int, hits: list) -> None:
    if depth > 4 or len(hits) > 1:
        return
    if isinstance(value, dict):
        for k, v in value.items():
            if _norm(k) == target:
                hits.append(v)
            else:
                _nested(v, target, depth + 1, hits)
    elif isinstance(value, list):
        for v in value[:50]:
            _nested(v, target, depth + 1, hits)


def find_field(value: dict, field: str) -> Any:
    """``value[field]``, tolerating spelling and one wrapper; ``MISSING`` if absent.

    Only unambiguous matches count: the same name in another case or separator
    style (``moderatedStudentResults``), or the one place in the output where
    that name occurs. Never a merely similar name.
    """
    if not isinstance(value, dict):
        return _MISSING
    if field in value:
        return value[field]
    target = _norm(field)
    same = [v for k, v in value.items() if _norm(k) == target]
    if len(same) == 1:
        return same[0]
    hits: list = []
    _nested(value, target, 0, hits)
    return hits[0] if len(hits) == 1 else _MISSING


MISSING = _MISSING
