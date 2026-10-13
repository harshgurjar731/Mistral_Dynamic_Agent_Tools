"""
The workflow input schema, read strictly.

Pure functions over a workflow definition: which inputs it declares, what each
one accepts, and which steps read it. Shared by save-time validation, the run
input check and the document service, so the three can never disagree about
what an input is.

A document input is declared as::

    {"name": "claim_form", "type": "file", "label": "Claim form",
     "description": "...", "required": true,
     "accept": ["pdf", "image"], "multiple": false, "max_files": 1, "max_size_mb": 20}

On a run its value is one document reference, a list of them (``multiple``), or
pasted text — the same document typed out rather than uploaded::

    {"$document": {"library_id": "...", "document_id": "...", "name": "claim.pdf",
                   "mime": "application/pdf", "size": 182044}}
"""

from __future__ import annotations

import os
import re
from typing import Any, Iterable

#: Declared input types. ``file`` is a document handed over with the run.
INPUT_TYPES = ("string", "number", "integer", "boolean", "object", "array", "file")

#: Spellings the planner and older definitions use for the same types.
TYPE_ALIASES = {
    "str": "string", "text": "string",
    "int": "integer",
    "float": "number", "double": "number", "decimal": "number",
    "bool": "boolean",
    "dict": "object", "json": "object", "map": "object",
    "list": "array",
    "document": "file", "upload": "file", "attachment": "file",
}

#: What a document input may accept, by named group. Extensions decide —
#: browsers report a different MIME type for the same file often enough that
#: it cannot be the test — and the MIME types are what the file picker offers.
ACCEPT_GROUPS: dict[str, dict[str, tuple[str, ...]]] = {
    "pdf": {"ext": (".pdf",), "mime": ("application/pdf",)},
    "docx": {
        "ext": (".docx",),
        "mime": ("application/vnd.openxmlformats-officedocument.wordprocessingml.document",),
    },
    "pptx": {
        "ext": (".pptx",),
        "mime": ("application/vnd.openxmlformats-officedocument.presentationml.presentation",),
    },
    "xlsx": {
        "ext": (".xlsx",),
        "mime": ("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",),
    },
    "csv": {"ext": (".csv",), "mime": ("text/csv",)},
    "text": {"ext": (".txt", ".md"), "mime": ("text/plain", "text/markdown")},
    "image": {
        "ext": (".png", ".jpg", ".jpeg", ".webp"),
        "mime": ("image/png", "image/jpeg", "image/webp"),
    },
}

DEFAULT_ACCEPT = ["pdf", "docx", "text"]
DEFAULT_MAX_SIZE_MB = 20
MAX_SIZE_MB_CEILING = 50
MAX_FILES_CEILING = 10

_NAME_RE = re.compile(r"^[A-Za-z_][A-Za-z0-9_]{0,63}$")
_REF_RE = re.compile(r"\{{2,}\s*([^{}\s]+?)\s*\}{2,}")
_STEP_OUTPUT_RE = re.compile(r"^step_.+_output$")


# ── Fields ──────────────────────────────────────────────────────────────────


def normalise_type(raw: Any) -> str:
    t = str(raw or "string").strip().lower()
    return TYPE_ALIASES.get(t, t)


def declared_fields(definition) -> list[dict]:
    """The input schema's fields that have a name, in declared order."""
    schema = getattr(definition, "input_schema", None) or []
    return [f for f in schema if isinstance(f, dict) and str(f.get("name") or "").strip()]


def is_file_field(field: dict) -> bool:
    return normalise_type(field.get("type")) == "file"


def file_fields(definition) -> list[dict]:
    return [f for f in declared_fields(definition) if is_file_field(f)]


def field_by_name(definition, name: str) -> dict | None:
    return next((f for f in declared_fields(definition) if f.get("name") == name), None)


def accept_of(field: dict) -> list[str]:
    """The field's accepted groups; unknown names are dropped, none means the default."""
    raw = field.get("accept")
    if isinstance(raw, str):
        raw = [p.strip() for p in raw.split(",")]
    groups = [str(g).strip().lower() for g in (raw or []) if str(g).strip()]
    known = [g for g in groups if g in ACCEPT_GROUPS]
    return known or list(DEFAULT_ACCEPT)


def unknown_accept(field: dict) -> list[str]:
    raw = field.get("accept")
    if isinstance(raw, str):
        raw = [p.strip() for p in raw.split(",")]
    return [str(g) for g in (raw or []) if str(g).strip() and str(g).strip().lower() not in ACCEPT_GROUPS]


def max_size_mb(field: dict) -> int:
    try:
        value = int(field.get("max_size_mb") or DEFAULT_MAX_SIZE_MB)
    except (TypeError, ValueError):
        value = DEFAULT_MAX_SIZE_MB
    return max(1, min(value, MAX_SIZE_MB_CEILING))


def max_files(field: dict) -> int:
    if not field.get("multiple"):
        return 1
    try:
        value = int(field.get("max_files") or 5)
    except (TypeError, ValueError):
        value = 5
    return max(1, min(value, MAX_FILES_CEILING))


def normalise_file_field(field: dict) -> dict:
    """A document input with every setting filled in — what the run form reads."""
    out = dict(field)
    out["type"] = "file"
    out["accept"] = accept_of(field)
    out["multiple"] = bool(field.get("multiple"))
    out["max_files"] = max_files(out)
    out["max_size_mb"] = max_size_mb(field)
    # A document is never typed in a format or picked from a list.
    for key in ("format", "enum", "items", "min", "max"):
        out.pop(key, None)
    return out


def accepts_file(field: dict, filename: str, mime: str | None) -> bool:
    ext = os.path.splitext(filename or "")[1].lower()
    mime = (mime or "").split(";")[0].strip().lower()
    for group in accept_of(field):
        spec = ACCEPT_GROUPS[group]
        if ext and ext in spec["ext"]:
            return True
        if not ext and mime and mime in spec["mime"]:
            return True
    return False


def describe_accept(field: dict) -> str:
    exts = [e for g in accept_of(field) for e in ACCEPT_GROUPS[g]["ext"]]
    return ", ".join(exts)


# ── References in step configs ──────────────────────────────────────────────


def _collect(value: Any, into: set[str]) -> None:
    if isinstance(value, str):
        for m in _REF_RE.finditer(value):
            root = m.group(1).split(".")[0]
            if root:
                into.add(root)
    elif isinstance(value, dict):
        for v in value.values():
            _collect(v, into)
    elif isinstance(value, (list, tuple)):
        for v in value:
            _collect(v, into)


def refs_of(step) -> set[str]:
    """Root names of every ``{{ref}}`` in a step's configuration."""
    refs: set[str] = set()
    _collect(getattr(step, "config", None) or {}, refs)
    return refs


def readers_of(definition, field_name: str) -> list:
    """The steps that read ``field_name``."""
    return [s for s in (getattr(definition, "steps", None) or []) if field_name in refs_of(s)]


def consumer_agent_ids(definition, field_name: str) -> list[str]:
    """Agent ids of the agent steps that read the input, in step order, once each."""
    out: list[str] = []
    for step in readers_of(definition, field_name):
        step_type = getattr(step.type, "value", step.type)
        agent_id = str((step.config or {}).get("agent_id") or "").strip()
        if step_type == "agent" and agent_id and agent_id not in out:
            out.append(agent_id)
    return out


def implicit_inputs(definition) -> list[str]:
    """Names the entry step reads that the schema does not declare.

    The entry step runs first, so anything it reads can only come from the run's
    input. Older definitions rely on this; the run check accepts these names as
    text so those workflows keep running, and validation asks for them to be
    declared.
    """
    steps = getattr(definition, "steps", None) or []
    entry = next((s for s in steps if s.id == getattr(definition, "entry_step", None)), None)
    if entry is None:
        return []
    declared = {f["name"] for f in declared_fields(definition)}
    seeded = set((getattr(definition, "variables", None) or {}).keys())
    return sorted(
        r for r in refs_of(entry)
        if r not in declared and r not in seeded and not _STEP_OUTPUT_RE.match(r)
    )


def valid_name(name: str) -> bool:
    return bool(_NAME_RE.match(name or ""))


def normalise_input_schema(input_schema: list, steps: list[dict], entry_step: str | None) -> list[dict]:
    """The planner's input schema made strict, for a definition still held as dicts.

    Types are spelled one way, document inputs carry every setting the run form
    and the upload check read, and anything the entry step reads without
    declaring it is declared — so the run form never has to invent a field.
    """
    out: list[dict] = []
    seen: set[str] = set()
    for raw in input_schema or []:
        if not isinstance(raw, dict):
            continue
        name = str(raw.get("name") or "").strip()
        if not name or name in seen:
            continue
        seen.add(name)
        field = {**raw, "name": name, "type": normalise_type(raw.get("type"))}
        if field["type"] not in INPUT_TYPES:
            field["type"] = "string"
        out.append(normalise_file_field(field) if field["type"] == "file" else field)

    entry = next((s for s in steps or [] if s.get("id") == entry_step), None)
    if entry is not None:
        refs: set[str] = set()
        _collect(entry.get("config") or {}, refs)
        for name in sorted(refs - seen):
            if _STEP_OUTPUT_RE.match(name) or not valid_name(name):
                continue
            out.append({
                "name": name, "type": "string", "required": True,
                "description": "Read by the first step.",
            })
    return out


# ── Document references ─────────────────────────────────────────────────────


def is_document_ref(value: Any) -> bool:
    return (
        isinstance(value, dict)
        and isinstance(value.get("$document"), dict)
        and bool(value["$document"].get("document_id"))
    )


def document_refs(value: Any) -> list[dict]:
    """The ``$document`` payloads in a document input's value (one or a list)."""
    items: Iterable[Any] = value if isinstance(value, list) else [value]
    return [v["$document"] for v in items if is_document_ref(v)]


def holds_documents(value: Any) -> bool:
    if is_document_ref(value):
        return True
    return isinstance(value, list) and bool(value) and all(is_document_ref(v) for v in value)


def make_ref(library_id: str, document_id: str, name: str, mime: str | None, size: int | None) -> dict:
    return {"$document": {
        "library_id": library_id, "document_id": document_id,
        "name": name, "mime": mime or "", "size": size or 0,
    }}
