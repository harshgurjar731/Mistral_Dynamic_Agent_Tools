"""
Edit operations — the vocabulary a revision is expressed in, applied without an LLM.

The interpretation layer turns "drop the weather check and send the report to
legal first" into a list of operations; this module carries them out. Keeping
the two apart is the point: a model is good at understanding what was meant
and unreliable at rewriting a graph consistently, so it is never asked to
return a whole definition. It names *what* to change; the rewiring — who now
points where once a step is gone, which steps a parallel group converges on,
what the entry step becomes — is done here, the same way every time.

Each operation is applied independently. One that cannot be carried out (an
unknown step, a duplicate id) is reported and skipped; the rest still apply,
and the user sees exactly which did not in the proposal they review.

Operations (every one may also carry a ``reason``):

    add_step          {step: {...}, after?: id, before?: id, branch?: "true"|"false"}
    remove_step       {step_id}
    update_step       {step_id, changes: {description?, tier?, type?, config?: {k: v|null}}}
    rename_step       {step_id, new_id}
    move_step         {step_id, after?: id, before?: id}
    set_next_steps    {step_id, next_steps: [id]}
    set_parallel_group{step_ids: [id], group: str|null}
    set_entry_step    {step_id}
    update_workflow   {description}
    upsert_input      {field: {name, type, description, required, ...}}
    remove_input      {name}
"""

from __future__ import annotations

import copy
import json
import re
from dataclasses import dataclass, field
from typing import Any, Optional

STEP_TYPES = ("agent", "tool", "connector", "condition", "transform")
_STEP_ID_RE = re.compile(r"^[a-zA-Z_][a-zA-Z0-9_]{0,63}$")
_BRANCH_KEYS = ("true_step", "false_step")

OPERATION_TYPES = (
    "add_step", "remove_step", "update_step", "rename_step", "move_step",
    "set_next_steps", "set_parallel_group", "set_entry_step",
    "update_workflow", "upsert_input", "remove_input",
)


class OperationError(ValueError):
    """An operation that cannot be carried out on this definition."""


@dataclass
class ApplyResult:
    definition: dict
    #: One row per operation: ``{"index", "op", "ok", "note"}``.
    outcomes: list[dict] = field(default_factory=list)
    #: Things the user should know that are not failures (dangling template refs…).
    warnings: list[str] = field(default_factory=list)

    @property
    def applied(self) -> int:
        return sum(1 for o in self.outcomes if o["ok"])

    @property
    def failed(self) -> list[dict]:
        return [o for o in self.outcomes if not o["ok"]]


def slug_step_id(raw: str) -> str:
    """A model-suggested id made into a valid step identifier."""
    text = re.sub(r"[^a-zA-Z0-9_]+", "_", str(raw or "").strip()).strip("_").lower()
    if not text:
        text = "step"
    if not re.match(r"[a-zA-Z_]", text[0]):
        text = f"step_{text}"
    return text[:64]


def output_variable(step_id: str) -> str:
    """The variable a step's output is stored as — what templates reference."""
    return f"step_{step_id}_output"


class _Graph:
    """A definition dict with the lookups every operation needs."""

    def __init__(self, definition: dict):
        self.d = definition
        self.d.setdefault("steps", [])
        self.d.setdefault("input_schema", [])
        self.d.setdefault("ui_layout", {})

    # ── lookups ────────────────────────────────────────────────────────

    @property
    def steps(self) -> list[dict]:
        return self.d["steps"]

    def ids(self) -> list[str]:
        return [s["id"] for s in self.steps]

    def get(self, step_id: Any) -> dict:
        for s in self.steps:
            if s["id"] == step_id:
                return s
        raise OperationError(f"There is no step '{step_id}'.")

    def has(self, step_id: Any) -> bool:
        return any(s["id"] == step_id for s in self.steps)

    def group(self, name: Optional[str]) -> list[dict]:
        return [s for s in self.steps if name and s.get("parallel_group") == name]

    def successors(self, step: dict) -> list[str]:
        """Where control goes after ``step`` — condition branches included."""
        out = list(step.get("next_steps") or [])
        if step.get("type") == "condition":
            cfg = step.get("config") or {}
            out += [cfg[k] for k in _BRANCH_KEYS if cfg.get(k)]
        return list(dict.fromkeys(out))

    def predecessors(self, step_id: str) -> list[dict]:
        return [s for s in self.steps if step_id in self.successors(s)]

    # ── edges ──────────────────────────────────────────────────────────

    def redirect(self, source: dict, old: str, new: list[str]) -> None:
        """Make ``source`` hand control to ``new`` wherever it handed it to ``old``."""
        nexts = source.get("next_steps") or []
        if old in nexts:
            replaced: list[str] = []
            for n in nexts:
                for t in (new if n == old else [n]):
                    if t != source["id"] and t not in replaced:
                        replaced.append(t)
            source["next_steps"] = replaced
        cfg = source.get("config") or {}
        for key in _BRANCH_KEYS:
            if cfg.get(key) == old:
                target = next((t for t in new if t != source["id"]), None)
                if target:
                    cfg[key] = target
                else:
                    cfg.pop(key, None)

    def set_next(self, step: dict, targets: list[str]) -> None:
        """Set a step's continuation; a parallel group's members move together.

        The engine advances a whole group from its first member's
        ``next_steps``, so members that disagree lose their successors.
        """
        members = self.group(step.get("parallel_group")) or [step]
        for m in members:
            m["next_steps"] = [t for t in targets if t != m["id"]]


# ── Operations ──────────────────────────────────────────────────────────────


def _new_step(g: _Graph, raw: Any) -> dict:
    if not isinstance(raw, dict):
        raise OperationError("add_step needs a 'step' object.")
    step_id = slug_step_id(raw.get("id") or raw.get("description") or "step")
    if g.has(step_id):
        raise OperationError(f"A step named '{step_id}' already exists.")
    step_type = str(raw.get("type") or "agent").strip().lower()
    if step_type not in STEP_TYPES:
        raise OperationError(f"'{step_type}' is not a step type ({', '.join(STEP_TYPES)}).")
    config = raw.get("config") if isinstance(raw.get("config"), dict) else {}
    next_steps = raw.get("next_steps") if isinstance(raw.get("next_steps"), list) else None
    return {
        "id": step_id,
        "type": step_type,
        "tier": raw.get("tier") or None,
        "description": str(raw.get("description") or "")[:500] or None,
        "config": dict(config),
        "next_steps": [str(n) for n in next_steps] if next_steps is not None else [],
        "parallel_group": None,
        "_explicit_next": next_steps is not None,
    }


def _attach(g: _Graph, step: dict, *, after: Optional[str], before: Optional[str],
            branch: Optional[str], explicit_next: bool) -> str:
    """Wire an already-present ``step`` into the graph next to an anchor."""
    if after:
        anchor = g.get(after)
        if anchor.get("type") == "condition" and branch in ("true", "false"):
            cfg = anchor.setdefault("config", {})
            key = f"{branch}_step"
            old = cfg.get(key)
            cfg[key] = step["id"]
            if not explicit_next:
                step["next_steps"] = [old] if old and old != step["id"] else []
            return f"after '{after}' on its {branch} branch"
        old_next = [n for n in anchor.get("next_steps") or [] if n != step["id"]]
        if not explicit_next:
            step["next_steps"] = old_next
        g.set_next(anchor, [step["id"]])
        return f"after '{after}'"
    if before:
        target = g.get(before)
        for p in g.predecessors(before):
            if p["id"] != step["id"]:
                g.redirect(p, before, [step["id"]])
        # Entering a parallel group means entering the group, not one branch of it.
        members = g.group(target.get("parallel_group"))
        if not explicit_next:
            step["next_steps"] = [before]
        if g.d.get("entry_step") == before or (members and g.d.get("entry_step") in
                                                {m["id"] for m in members}):
            g.d["entry_step"] = step["id"]
        return f"before '{before}'"
    if not g.d.get("entry_step") or len(g.steps) == 1:
        g.d["entry_step"] = step["id"]
    return "unconnected"


def _detach(g: _Graph, step_id: str) -> list[str]:
    """Take a step out of the flow, joining its predecessors to its successors."""
    step = g.get(step_id)
    successors = [s for s in g.successors(step) if s != step_id]
    siblings = [m for m in g.group(step.get("parallel_group")) if m["id"] != step_id]

    for p in g.predecessors(step_id):
        if p["id"] == step_id:
            continue
        # A predecessor of one branch of a group really starts the group;
        # hand it to a remaining branch rather than skipping the group.
        g.redirect(p, step_id, [siblings[0]["id"]] if siblings else successors)

    if g.d.get("entry_step") == step_id:
        g.d["entry_step"] = (siblings[0]["id"] if siblings else
                             successors[0] if successors else
                             next((i for i in g.ids() if i != step_id), ""))
    step["next_steps"] = []
    if step.get("type") == "condition":
        for key in _BRANCH_KEYS:
            (step.get("config") or {}).pop(key, None)
    step["parallel_group"] = None
    return successors


def _op_add_step(g: _Graph, op: dict) -> str:
    step = _new_step(g, op.get("step"))
    explicit = step.pop("_explicit_next")
    for anchor in (op.get("after"), op.get("before")):
        if anchor and not g.has(anchor):
            raise OperationError(f"There is no step '{anchor}' to place the new step next to.")
    g.steps.append(step)
    where = _attach(g, step, after=op.get("after"), before=op.get("before"),
                    branch=op.get("branch"), explicit_next=explicit)
    return f"Added {step['type']} step '{step['id']}' {where}."


def _op_remove_step(g: _Graph, op: dict) -> str:
    step_id = op.get("step_id")
    step = g.get(step_id)
    if len(g.steps) == 1:
        raise OperationError("A workflow must keep at least one step.")
    group = step.get("parallel_group")
    _detach(g, step_id)
    g.steps.remove(step)
    g.d["ui_layout"].pop(step_id, None)
    remaining = g.group(group)
    if len(remaining) == 1:
        remaining[0]["parallel_group"] = None
    return f"Removed step '{step_id}' and reconnected the steps around it."


def _merge_config(config: dict, changes: dict) -> dict:
    out = dict(config)
    for key, value in changes.items():
        if value is None:
            out.pop(key, None)
        else:
            out[key] = value
    return out


def _op_update_step(g: _Graph, op: dict) -> str:
    step = g.get(op.get("step_id"))
    changes = op.get("changes")
    if not isinstance(changes, dict) or not changes:
        raise OperationError("update_step needs a non-empty 'changes' object.")
    touched = []
    if "description" in changes:
        step["description"] = (str(changes["description"] or "")[:500]) or None
        touched.append("description")
    if "tier" in changes:
        step["tier"] = changes["tier"] or None
        touched.append("tier")
    if changes.get("type"):
        new_type = str(changes["type"]).strip().lower()
        if new_type not in STEP_TYPES:
            raise OperationError(f"'{new_type}' is not a step type.")
        if new_type != step["type"]:
            step["type"] = new_type
            touched.append("type")
    if "config" in changes:
        cfg = changes["config"]
        if not isinstance(cfg, dict):
            raise OperationError("'config' changes must be an object.")
        if changes.get("replace_config"):
            step["config"] = {k: v for k, v in cfg.items() if v is not None}
        else:
            step["config"] = _merge_config(step.get("config") or {}, cfg)
        touched.append("config (" + ", ".join(sorted(cfg)) + ")" if cfg else "config")
    if not touched:
        raise OperationError("Nothing in 'changes' applies to a step.")
    return f"Updated '{step['id']}': {'; '.join(touched)}."


def _replace_in(value: Any, old: str, new: str) -> Any:
    if isinstance(value, str):
        return value.replace(old, new)
    if isinstance(value, list):
        return [_replace_in(v, old, new) for v in value]
    if isinstance(value, dict):
        return {k: _replace_in(v, old, new) for k, v in value.items()}
    return value


def _op_rename_step(g: _Graph, op: dict) -> str:
    old = op.get("step_id")
    step = g.get(old)
    new = slug_step_id(op.get("new_id") or "")
    if new == old:
        raise OperationError("The new id is the same as the old one.")
    if g.has(new):
        raise OperationError(f"A step named '{new}' already exists.")
    step["id"] = new
    for s in g.steps:
        s["next_steps"] = [new if n == old else n for n in s.get("next_steps") or []]
        cfg = s.get("config") or {}
        for key in _BRANCH_KEYS:
            if cfg.get(key) == old:
                cfg[key] = new
        # Downstream templates read this step's output by its variable name.
        s["config"] = _replace_in(cfg, output_variable(old), output_variable(new))
    if g.d.get("entry_step") == old:
        g.d["entry_step"] = new
    layout = g.d["ui_layout"]
    if old in layout:
        layout[new] = layout.pop(old)
    return f"Renamed '{old}' to '{new}' and updated every reference to its output."


def _op_move_step(g: _Graph, op: dict) -> str:
    step_id = op.get("step_id")
    step = g.get(step_id)
    after, before = op.get("after"), op.get("before")
    if not (after or before):
        raise OperationError("move_step needs 'after' or 'before'.")
    anchor = after or before
    if anchor == step_id:
        raise OperationError("A step cannot be moved next to itself.")
    g.get(anchor)
    _detach(g, step_id)
    where = _attach(g, step, after=after, before=before, branch=op.get("branch"),
                    explicit_next=False)
    return f"Moved '{step_id}' {where}."


def _op_set_next_steps(g: _Graph, op: dict) -> str:
    step = g.get(op.get("step_id"))
    targets = op.get("next_steps")
    if not isinstance(targets, list):
        raise OperationError("set_next_steps needs a 'next_steps' list.")
    targets = [str(t) for t in targets]
    for t in targets:
        g.get(t)
    g.set_next(step, targets)
    return f"'{step['id']}' now continues to {', '.join(targets) or 'nothing (it ends the workflow)'}."


def _op_set_parallel_group(g: _Graph, op: dict) -> str:
    ids = op.get("step_ids")
    if not isinstance(ids, list) or not ids:
        raise OperationError("set_parallel_group needs 'step_ids'.")
    members = [g.get(i) for i in ids]
    group = op.get("group")
    if not group:
        for m in members:
            m["parallel_group"] = None
        return f"{', '.join(ids)} no longer run in parallel."
    if len(members) < 2:
        raise OperationError("A parallel group needs at least two steps.")
    if any(m["type"] == "condition" for m in members):
        raise OperationError("A condition step cannot run inside a parallel group.")
    group = slug_step_id(group)
    member_ids = {m["id"] for m in members}
    # Converge on the continuation that leaves the group.
    join = next((list(n for n in m.get("next_steps") or [] if n not in member_ids)
                 for m in members if any(n not in member_ids for n in m.get("next_steps") or [])),
                [])
    for m in members:
        m["parallel_group"] = group
        m["next_steps"] = list(join)
    # Whoever started one branch now starts the group via its first member.
    first = members[0]["id"]
    for s in g.steps:
        if s["id"] in member_ids:
            continue
        nexts = s.get("next_steps") or []
        if any(n in member_ids for n in nexts):
            s["next_steps"] = list(dict.fromkeys(first if n in member_ids else n for n in nexts))
    if g.d.get("entry_step") in member_ids:
        g.d["entry_step"] = first
    return f"{', '.join(ids)} now run in parallel as '{group}'" + (
        f", then continue to {', '.join(join)}." if join else ".")


def _op_set_entry_step(g: _Graph, op: dict) -> str:
    step = g.get(op.get("step_id"))
    g.d["entry_step"] = step["id"]
    return f"The workflow now starts at '{step['id']}'."


def _op_update_workflow(g: _Graph, op: dict) -> str:
    if "description" not in op:
        raise OperationError("update_workflow needs a 'description'.")
    g.d["description"] = str(op.get("description") or "")[:2000] or None
    return "Updated the workflow description."


def _op_upsert_input(g: _Graph, op: dict) -> str:
    raw = op.get("field")
    if not isinstance(raw, dict) or not raw.get("name"):
        raise OperationError("upsert_input needs a 'field' with a 'name'.")
    name = slug_step_id(raw["name"])
    fields = g.d["input_schema"]
    current = next((f for f in fields if f.get("name") == name), None)
    clean = {k: v for k, v in {**raw, "name": name}.items() if v is not None}
    clean.setdefault("type", "string")
    if current is not None:
        current.update(clean)
        return f"Updated input '{name}'."
    fields.append(clean)
    return f"Added input '{name}'."


def _op_remove_input(g: _Graph, op: dict) -> str:
    name = op.get("name")
    before = len(g.d["input_schema"])
    g.d["input_schema"] = [f for f in g.d["input_schema"] if f.get("name") != name]
    if len(g.d["input_schema"]) == before:
        raise OperationError(f"There is no input '{name}'.")
    return f"Removed input '{name}'."


_HANDLERS = {
    "add_step": _op_add_step,
    "remove_step": _op_remove_step,
    "update_step": _op_update_step,
    "rename_step": _op_rename_step,
    "move_step": _op_move_step,
    "set_next_steps": _op_set_next_steps,
    "set_parallel_group": _op_set_parallel_group,
    "set_entry_step": _op_set_entry_step,
    "update_workflow": _op_update_workflow,
    "upsert_input": _op_upsert_input,
    "remove_input": _op_remove_input,
}


# ── Normalisation ───────────────────────────────────────────────────────────


def normalise(definition: dict) -> list[str]:
    """Repair what any sequence of edits can leave inconsistent. Returns notes.

    Every rule here mirrors one the planner's topology layer applies to a
    fresh graph, so a revised workflow obeys the same invariants as a planned one.
    """
    g = _Graph(definition)
    notes: list[str] = []
    ids = set(g.ids())

    for s in g.steps:
        nexts = s.get("next_steps") or []
        kept = [n for n in dict.fromkeys(nexts) if n in ids and n != s["id"]]
        if len(kept) != len(nexts):
            dropped = sorted(set(nexts) - set(kept))
            if dropped:
                notes.append(f"Dropped links from '{s['id']}' to missing step(s) {', '.join(dropped)}.")
        s["next_steps"] = kept
        cfg = s.get("config") or {}
        for key in _BRANCH_KEYS:
            if cfg.get(key) and cfg[key] not in ids:
                notes.append(f"Cleared the {key.split('_')[0]} branch of '{s['id']}' — "
                             f"'{cfg[key]}' no longer exists.")
                cfg.pop(key)

    groups: dict[str, list[dict]] = {}
    for s in g.steps:
        if s.get("parallel_group"):
            groups.setdefault(s["parallel_group"], []).append(s)
    for name, members in groups.items():
        if len(members) == 1:
            members[0]["parallel_group"] = None
            continue
        targets = {tuple(m["next_steps"]) for m in members}
        if len(targets) > 1:
            canonical = max((m["next_steps"] for m in members), key=len)
            for m in members:
                m["next_steps"] = [t for t in canonical if t != m["id"]]
            notes.append(f"Parallel group '{name}' now converges on "
                         f"{', '.join(canonical) or 'the end of the workflow'}.")

    if g.d.get("entry_step") not in ids and g.steps:
        # The step nobody points at is the natural start.
        pointed = {t for s in g.steps for t in g.successors(s)}
        g.d["entry_step"] = next((i for i in g.ids() if i not in pointed), g.steps[0]["id"])
        notes.append(f"The workflow now starts at '{g.d['entry_step']}'.")

    for key in list(g.d["ui_layout"]):
        if key not in ids:
            g.d["ui_layout"].pop(key)
    return notes


def dangling_references(definition: dict) -> list[str]:
    """Templates that read the output of a step that no longer exists."""
    ids = {s["id"] for s in definition.get("steps") or []}
    warnings = []
    for s in definition.get("steps") or []:
        text = json.dumps(s.get("config") or {})
        for ref in sorted(set(re.findall(r"step_([A-Za-z0-9_]+?)_output", text))):
            if ref not in ids:
                warnings.append(
                    f"'{s['id']}' still reads {output_variable(ref)}, which no step produces any more."
                )
    return warnings


# ── Entry point ─────────────────────────────────────────────────────────────


def apply_operations(definition: dict, operations: list[dict], *,
                     repair: bool = True) -> ApplyResult:
    """Apply ``operations`` to a copy of ``definition``.

    The input is never mutated, so the caller's base stays a valid thing to
    diff against. ``repair=False`` leaves :func:`normalise` to the caller —
    the revision pipeline runs it as a layer of its own.
    """
    working = copy.deepcopy(definition)
    g = _Graph(working)
    result = ApplyResult(definition=working)

    for index, op in enumerate(operations or []):
        kind = str((op or {}).get("op") or "") if isinstance(op, dict) else ""
        handler = _HANDLERS.get(kind)
        if handler is None:
            result.outcomes.append({"index": index, "op": kind or "?", "ok": False,
                                    "note": f"'{kind or op}' is not a known operation."})
            continue
        snapshot = copy.deepcopy(working)
        try:
            note = handler(g, op)
            result.outcomes.append({"index": index, "op": kind, "ok": True, "note": note})
        except OperationError as e:
            # Undo any partial work so a failed operation leaves no trace.
            working.clear()
            working.update(snapshot)
            result.outcomes.append({"index": index, "op": kind, "ok": False, "note": str(e)})

    if repair:
        result.warnings.extend(normalise(working))
        result.warnings.extend(dangling_references(working))
    return result


def validate_operation_shape(op: Any) -> Optional[str]:
    """A reason ``op`` is not even well-formed, or None."""
    if not isinstance(op, dict):
        return "Each operation must be an object."
    if op.get("op") not in OPERATION_TYPES:
        return f"Unknown operation '{op.get('op')}'."
    return None


def is_valid_step_id(step_id: str) -> bool:
    return bool(_STEP_ID_RE.match(step_id or ""))
