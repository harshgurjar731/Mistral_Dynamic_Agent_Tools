"""
Conform a step's arguments to the tool's input schema — at every depth.

A tool step's arguments are earlier steps' outputs, and those outputs are often
written by a language model. The model gets the content right and the shape
wrong in a handful of recurring ways:

    {"Aisha": {"high": ["Ship mockups"], "low": []}}   where a list was declared
    {"items": [...]}                                   a list behind one key
    "High"                                             for the enum value "high"
    "250,000"                                          for a number
    {"text": "..."}                                    for a plain string

Activities validate their inputs strictly, so each of these failed the run with
a 422 — and since the argument resolver only shaped *top-level* parameters, any
mismatch nested inside an object (``summary.action_items``) always got through
to the tool and failed there.

``conform`` walks the value and the JSON schema together and reshapes only what
does not already match: a value that is valid is returned untouched. Nothing is
invented — a grouped object becomes a list of its own items, and the group keys
are kept by writing them into the item field they name (an ``owner`` or a
``priority``) or, for plain-string items, as a label on the text.
"""

from __future__ import annotations

import json
from typing import Any, Optional

#: Item fields that hold an item's text, best first.
_TEXT_HINTS = ("description", "task", "text", "action", "item", "title", "content",
               "summary", "detail", "statement", "note", "value", "name")
#: Item fields a group key can name, best first.
_GROUP_HINTS = ("owner", "assignee", "assigned", "responsible", "person", "who", "member",
                "category", "group", "section", "type", "kind", "priority", "severity",
                "urgency", "status", "level", "label", "key")
_RANK_WORDS = {"critical", "urgent", "high", "medium", "moderate", "normal", "low", "minor",
               "major", "p0", "p1", "p2", "p3", "p4"}
_RANK_FIELDS = ("priority", "severity", "urgency", "importance", "level")
_TRUE = {"true", "yes", "y", "1", "on"}
_FALSE = {"false", "no", "n", "0", "off"}


def conform_arguments(arguments: dict, parameters: Optional[dict]) -> tuple[dict, list[str]]:
    """``arguments`` reshaped to the tool's ``parameters`` schema, and what changed."""
    props = (parameters or {}).get("properties")
    if not isinstance(props, dict) or not isinstance(arguments, dict):
        return arguments, []
    notes: list[str] = []
    out = {}
    for key, value in arguments.items():
        schema = props.get(key)
        out[key] = conform(value, schema, notes, key) if isinstance(schema, dict) else value
    return out, notes


def conform(value: Any, schema: Any, notes: Optional[list] = None, path: str = "") -> Any:
    """``value`` reshaped to ``schema`` where it does not already match it."""
    notes = notes if notes is not None else []
    if not isinstance(schema, dict) or value is None:
        return value

    branches = schema.get("anyOf") or schema.get("oneOf")
    if isinstance(branches, list) and "type" not in schema:
        for branch in branches:
            if isinstance(branch, dict) and _matches(value, _types(branch)):
                return conform(value, branch, notes, path)
        return value

    types = _types(schema)
    if not types:
        return value
    if not _matches(value, types):
        target = next((t for t in types if t != "null"), None)
        reshaped = _reshape(value, target, schema, notes, path)
        if not _matches(reshaped, types):
            return value  # nothing safe to do; the tool reports the mismatch
        value = reshaped
    return _descend(value, schema, notes, path)


# ── Matching ──────────────────────────────────────────────────────────────


def _types(schema: dict) -> list[str]:
    t = schema.get("type")
    if isinstance(t, str):
        return [t]
    if isinstance(t, list):
        return [x for x in t if isinstance(x, str)]
    if isinstance(schema.get("properties"), dict):
        return ["object"]
    if "items" in schema:
        return ["array"]
    return []


def _is(value: Any, t: str) -> bool:
    if t == "object":
        return isinstance(value, dict)
    if t == "array":
        return isinstance(value, list)
    if t == "string":
        return isinstance(value, str)
    if t == "boolean":
        return isinstance(value, bool)
    if t == "integer":
        return isinstance(value, int) and not isinstance(value, bool)
    if t == "number":
        return isinstance(value, (int, float)) and not isinstance(value, bool)
    if t == "null":
        return value is None
    return True


def _matches(value: Any, types: list[str]) -> bool:
    return not types or any(_is(value, t) for t in types)


def _descend(value: Any, schema: dict, notes: list, path: str) -> Any:
    if isinstance(value, dict):
        props = schema.get("properties")
        if isinstance(props, dict):
            return {k: conform(v, props[k], notes, f"{path}.{k}") if isinstance(props.get(k), dict) else v
                    for k, v in value.items()}
        return value
    if isinstance(value, list):
        items = schema.get("items")
        if isinstance(items, dict):
            return [conform(v, items, notes, f"{path}[{i}]") for i, v in enumerate(value)]
        return value
    if isinstance(value, str):
        enum = schema.get("enum")
        if isinstance(enum, list) and value not in enum:
            match = next((e for e in enum if isinstance(e, str)
                          and e.strip().lower() == value.strip().lower()), None)
            if match is not None:
                notes.append(f"{path}: '{value}' read as the allowed value '{match}'")
                return match
    return value


# ── Reshaping ─────────────────────────────────────────────────────────────


def _parse(text: str) -> Any:
    t = text.strip()
    if t[:1] in ("{", "["):
        try:
            return json.loads(t)
        except ValueError:
            pass
    return text


def _reshape(value: Any, target: Optional[str], schema: dict, notes: list, path: str) -> Any:
    if isinstance(value, str) and target in ("object", "array"):
        parsed = _parse(value)
        if _is(parsed, target):
            return parsed
        value = parsed

    if target == "array":
        items = schema.get("items") if isinstance(schema.get("items"), dict) else {}
        if isinstance(value, dict):
            return _to_array(value, items, notes, path)
        if value is not None and _matches(value, _types(items)):
            notes.append(f"{path}: single value wrapped in a list")
            return [value]
        return value

    if target == "object":
        if isinstance(value, list) and len(value) == 1 and isinstance(value[0], dict):
            notes.append(f"{path}: one-item list unwrapped to its object")
            return value[0]
        return value

    if target == "string":
        if isinstance(value, dict) and len(value) == 1 and isinstance(next(iter(value.values())), str):
            return next(iter(value.values()))
        if isinstance(value, (dict, list, bool)):
            return json.dumps(value)
        if isinstance(value, (int, float)):
            return str(value)
        return value

    if target in ("number", "integer"):
        v = value
        if isinstance(v, dict) and len(v) == 1:
            v = next(iter(v.values()))
        if isinstance(v, str):
            cleaned = v.strip().replace(",", "").lstrip("$£€¥₹").strip()
            try:
                v = float(cleaned)
            except ValueError:
                return value
        if isinstance(v, (int, float)) and not isinstance(v, bool):
            if target == "integer":
                return int(v) if float(v).is_integer() else value
            return v
        return value

    if target == "boolean":
        v = value
        if isinstance(v, dict) and len(v) == 1:
            v = next(iter(v.values()))
        if isinstance(v, bool):
            return v
        if isinstance(v, str) and v.strip().lower() in _TRUE | _FALSE:
            return v.strip().lower() in _TRUE
        if isinstance(v, (int, float)) and v in (0, 1):
            return bool(v)
        return value

    return value


def _to_array(value: dict, items: dict, notes: list, path: str) -> Any:
    """A list built from an object that stands where a list was declared."""
    # {"action_items": [...]} — the list behind one key.
    if len(value) == 1 and isinstance(next(iter(value.values())), list):
        notes.append(f"{path}: list taken from its single key '{next(iter(value))}'")
        return next(iter(value.values()))

    if not _is_group(value):
        # One record where a list of records was declared.
        if _matches(value, _types(items)):
            notes.append(f"{path}: single object wrapped in a list")
            return [value]
        return value

    # A grouped object: {"Aisha": {"high": [...], "low": []}, ...}.
    item_props = items.get("properties") if isinstance(items.get("properties"), dict) else {}
    item_is_object = "object" in _types(items) or bool(item_props)
    keys_by_depth: list[set] = []
    _collect_keys(value, 0, keys_by_depth)

    fields: list[tuple[Optional[str], dict]] = []  # per depth: (field, canonical spellings)
    taken: set = set()
    for keys in keys_by_depth:
        field, canon = _group_field(keys, item_props, taken) if item_is_object else (None, {})
        if field:
            taken.add(field)
        fields.append((field, canon))
    text_field = _text_field(item_props, items.get("required") or [], taken) if item_is_object else None

    out: list = []
    _flatten(value, [], fields, text_field, item_is_object, out)

    kept = [f for f, _ in fields if f]
    how = f"group keys kept as {', '.join(kept)}" if kept else (
        "group keys kept as labels" if not item_is_object else "group keys had no field to go in")
    notes.append(f"{path}: grouped object flattened into a list of {len(out)} ({how})")
    return out


def _is_group(value: Any) -> bool:
    """An object whose every value is a list or, recursively, another group."""
    return (isinstance(value, dict) and bool(value)
            and all(isinstance(v, list) or _is_group(v) for v in value.values()))


def _collect_keys(value: dict, depth: int, out: list) -> None:
    while len(out) <= depth:
        out.append(set())
    for k, v in value.items():
        out[depth].add(str(k))
        if isinstance(v, dict):
            _collect_keys(v, depth + 1, out)


def _string_props(props: dict) -> list[str]:
    return [k for k, d in props.items()
            if isinstance(d, dict) and ("string" in _types(d) or not _types(d))]


def _rank(name: str, hints: tuple) -> int:
    lowered = name.lower()
    return next((i for i, h in enumerate(hints) if h in lowered), len(hints))


def _group_field(keys: set, props: dict, taken: set) -> tuple[Optional[str], dict]:
    lowered = {k.strip().lower() for k in keys}
    # A field whose enum lists every key: unambiguous.
    for name, d in props.items():
        enum = d.get("enum") if isinstance(d, dict) else None
        if name in taken or not isinstance(enum, list):
            continue
        spelled = {str(e).strip().lower(): e for e in enum}
        if lowered <= set(spelled):
            return name, {k: spelled[k.strip().lower()] for k in keys}
    candidates = [n for n in _string_props(props)
                  if n not in taken and not (isinstance(props[n], dict) and props[n].get("enum"))]
    if lowered <= _RANK_WORDS:
        ranked = [n for n in candidates if _rank(n, _RANK_FIELDS) < len(_RANK_FIELDS)]
        if ranked:
            return min(ranked, key=lambda n: _rank(n, _RANK_FIELDS)), {}
    candidates = [n for n in candidates if _rank(n, _RANK_FIELDS) == len(_RANK_FIELDS)
                  and _rank(n, _GROUP_HINTS) < len(_GROUP_HINTS)]
    if candidates:
        return min(candidates, key=lambda n: _rank(n, _GROUP_HINTS)), {}
    return None, {}


def _text_field(props: dict, required: list, taken: set) -> Optional[str]:
    names = [n for n in _string_props(props) if n not in taken
             and not (isinstance(props[n], dict) and props[n].get("enum"))]
    if not names:
        return None
    return min(names, key=lambda n: (_rank(n, _TEXT_HINTS), n not in required))


def _flatten(value: dict, labels: list, fields: list, text_field: Optional[str],
             item_is_object: bool, out: list) -> None:
    for key, child in value.items():
        trail = [*labels, str(key)]
        if isinstance(child, dict):
            _flatten(child, trail, fields, text_field, item_is_object, out)
            continue
        for leaf in child:
            out.append(_item(leaf, trail, fields, text_field, item_is_object))


def _item(leaf: Any, trail: list, fields: list, text_field: Optional[str], item_is_object: bool) -> Any:
    if not item_is_object:
        if isinstance(leaf, str) and trail:
            return f"[{' / '.join(trail)}] {leaf}"
        return leaf
    if isinstance(leaf, dict):
        record = dict(leaf)
    elif text_field:
        record = {text_field: leaf}
    else:
        return leaf
    for depth, key in enumerate(trail):
        field, canon = fields[depth] if depth < len(fields) else (None, {})
        if field:
            record.setdefault(field, canon.get(key, key))
    return record
