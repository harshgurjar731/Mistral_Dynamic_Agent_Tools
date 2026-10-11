"""
What changed between two workflow definitions.

A proposal is only reviewable if the user can see what it would do, so every
revision carries one of these. The diff is semantic — steps by id, edges as
pairs, config by key — not a text diff of the JSON, which would bury a moved
step under a hundred lines of reordered keys.
"""

from __future__ import annotations

from typing import Any

_STEP_FIELDS = ("type", "tier", "description", "parallel_group")


def _edges(definition: dict) -> set[tuple[str, str]]:
    out = set()
    for s in definition.get("steps") or []:
        for n in s.get("next_steps") or []:
            out.add((s["id"], n))
        if s.get("type") == "condition":
            cfg = s.get("config") or {}
            for key in ("true_step", "false_step"):
                if cfg.get(key):
                    out.add((s["id"], cfg[key]))
    return out


def _short(value: Any, limit: int = 240) -> Any:
    if isinstance(value, str) and len(value) > limit:
        return value[:limit] + "…"
    return value


def _step_changes(before: dict, after: dict) -> list[dict]:
    changes = []
    for key in _STEP_FIELDS:
        if (before.get(key) or None) != (after.get(key) or None):
            changes.append({"field": key, "before": _short(before.get(key)),
                            "after": _short(after.get(key))})
    if sorted(before.get("next_steps") or []) != sorted(after.get("next_steps") or []):
        changes.append({"field": "next_steps", "before": before.get("next_steps") or [],
                        "after": after.get("next_steps") or []})
    old_cfg, new_cfg = before.get("config") or {}, after.get("config") or {}
    for key in sorted(set(old_cfg) | set(new_cfg)):
        if old_cfg.get(key) != new_cfg.get(key):
            changes.append({"field": f"config.{key}", "before": _short(old_cfg.get(key)),
                            "after": _short(new_cfg.get(key))})
    return changes


def diff_definitions(before: dict, after: dict) -> dict:
    """Structured diff; ``changed`` is False when nothing that runs differs."""
    old_steps = {s["id"]: s for s in before.get("steps") or []}
    new_steps = {s["id"]: s for s in after.get("steps") or []}

    added = [i for i in new_steps if i not in old_steps]
    removed = [i for i in old_steps if i not in new_steps]
    modified = []
    for step_id in new_steps:
        if step_id in old_steps:
            changes = _step_changes(old_steps[step_id], new_steps[step_id])
            if changes:
                modified.append({"step_id": step_id, "changes": changes})

    old_edges, new_edges = _edges(before), _edges(after)

    old_inputs = {f.get("name"): f for f in before.get("input_schema") or []}
    new_inputs = {f.get("name"): f for f in after.get("input_schema") or []}
    inputs = {
        "added": [n for n in new_inputs if n not in old_inputs],
        "removed": [n for n in old_inputs if n not in new_inputs],
        "modified": [n for n in new_inputs if n in old_inputs and new_inputs[n] != old_inputs[n]],
    }

    entry = None
    if before.get("entry_step") != after.get("entry_step"):
        entry = {"before": before.get("entry_step"), "after": after.get("entry_step")}

    description = None
    if (before.get("description") or "") != (after.get("description") or ""):
        description = {"before": _short(before.get("description")),
                       "after": _short(after.get("description"))}

    diff = {
        "steps_added": added,
        "steps_removed": removed,
        "steps_modified": modified,
        "edges_added": sorted([list(e) for e in new_edges - old_edges]),
        "edges_removed": sorted([list(e) for e in old_edges - new_edges]),
        "entry_step": entry,
        "description": description,
        "inputs": inputs,
    }
    diff["changed"] = bool(
        added or removed or modified or diff["edges_added"] or diff["edges_removed"]
        or entry or description or any(inputs.values())
    )
    diff["stats"] = {
        "added": len(added),
        "removed": len(removed),
        "modified": len(modified),
        "edges": len(diff["edges_added"]) + len(diff["edges_removed"]),
        "inputs": sum(len(v) for v in inputs.values()),
    }
    return diff
