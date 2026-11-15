"""
What surrounds a step in a workflow being edited by hand — for code written to fit it.

The planner authors each activity knowing what the steps before it return and
what the steps after it read (``ActivityGapLayer``). An activity created from
the visual builder used to be written from its description alone, so its
inputs renamed fields the previous step returns (``equipment_cost`` became
``equipment_cost_gbp``) and every call needed a hand-written mapping.

``step_neighbours`` gives the code-requirement pipeline the same view for a
step placed on the canvas: the steps that run before it (closest first, with
the output schema each returns and the variable that holds it), the workflow's
own inputs, and the steps that will read its result. The definition may be an
unsaved, half-built draft, so it is read as plain JSON and nothing is required.
"""

from __future__ import annotations

import json
import re
from collections import deque
from typing import Any, Iterable, Optional

from app.services.workflow_engine.argument_shapes import activity_contract

#: Upstream steps described to the author; the closest ones matter most.
MAX_UPSTREAM = 6


def _kind(step: dict) -> str:
    t = step.get("type")
    return str(getattr(t, "value", t) or "")


def _targets(step: dict) -> list[str]:
    cfg = step.get("config") or {}
    out = [*(step.get("next_steps") or []), cfg.get("true_step"), cfg.get("false_step")]
    return [t for t in out if isinstance(t, str) and t]


def _parents(steps: dict[str, dict]) -> dict[str, list[str]]:
    parents: dict[str, list[str]] = {sid: [] for sid in steps}
    for sid, step in steps.items():
        for nxt in _targets(step):
            if nxt not in parents:
                continue
            group = steps[nxt].get("parallel_group")
            members = [m for m, s in steps.items() if group and s.get("parallel_group") == group] or [nxt]
            for m in members:
                if sid not in parents[m]:
                    parents[m].append(sid)
    return parents


def _ancestors(start: Iterable[str], parents: dict[str, list[str]]) -> list[str]:
    """``start`` and every step before it, nearest first (breadth-first)."""
    seen: list[str] = []
    queue = deque(s for s in start if s in parents)
    while queue:
        cur = queue.popleft()
        if cur in seen:
            continue
        seen.append(cur)
        queue.extend(parents.get(cur, ()))
    return seen


def _fields(schema: Any) -> list[str]:
    props = (schema or {}).get("properties") if isinstance(schema, dict) else None
    return sorted(props) if isinstance(props, dict) else []


def _describe_upstream(step: dict, catalog: dict[str, dict]) -> dict:
    kind = _kind(step)
    cfg = step.get("config") or {}
    entry: dict = {"id": step.get("id"), "kind": kind,
                   "name": step.get("description") or step.get("id"),
                   "variable": f"step_{step.get('id')}_output"}
    if kind == "tool" and cfg.get("tool_name"):
        entry["activity"] = cfg["tool_name"]
    contract = activity_contract(step, catalog) or {}
    output = contract.get("output")
    if isinstance(output, dict) and output:
        entry["output_schema"] = output
        entry["outputs"] = _fields(output)
    elif kind == "agent":
        entry["returns"] = "the agent's answer as text (no declared schema)"
    elif kind == "transform":
        entry["returns"] = "whatever its transform code returns (no declared schema)"
    return entry


def _describe_downstream(step: dict, catalog: dict[str, dict]) -> dict:
    kind = _kind(step)
    cfg = step.get("config") or {}
    entry: dict = {"id": step.get("id"), "kind": kind, "name": step.get("description") or step.get("id")}
    if kind == "tool":
        contract = activity_contract(step, catalog) or {}
        if cfg.get("tool_name"):
            entry["activity"] = cfg["tool_name"]
        if isinstance(contract.get("input"), dict):
            entry["input_schema"] = contract["input"]
            entry["inputs"] = _fields(contract["input"])
    elif kind == "agent" and cfg.get("query_template"):
        entry["reads"] = str(cfg["query_template"])[:600]
    elif kind == "condition" and cfg.get("expression"):
        entry["reads"] = str(cfg["expression"])[:300]
    return entry


def _workflow_inputs(definition: dict) -> Optional[dict]:
    fields = [f for f in definition.get("input_schema") or [] if isinstance(f, dict) and f.get("name")]
    if not fields:
        return None
    props, required = {}, []
    for f in fields:
        schema = f.get("schema") if isinstance(f.get("schema"), dict) else {}
        props[f["name"]] = {**({"type": f["type"]} if f.get("type") else {}), **schema,
                            **({"description": f["description"]} if f.get("description") else {})}
        if f.get("required"):
            required.append(f["name"])
    return {"id": "workflow_input", "kind": "workflow_input",
            "name": "What the workflow is started with",
            "variable": "(top level — referenced as {{field}})",
            "output_schema": {"type": "object", "properties": props, "required": required},
            "outputs": sorted(props)}


def step_neighbours(definition: dict, *, after: Optional[str] = None,
                    before: Iterable[str] = (), step_id: Optional[str] = None,
                    catalog: Optional[dict[str, dict]] = None) -> tuple[list[dict], list[dict]]:
    """``(upstream, downstream)`` for a step at this place in ``definition``.

    ``step_id``: an existing step — its parents and children are used.
    ``after`` / ``before``: where a new step will go (it does not exist yet).
    """
    catalog = catalog or {}
    steps = {s["id"]: s for s in definition.get("steps") or [] if isinstance(s, dict) and s.get("id")}
    parents = _parents(steps)
    if step_id and step_id in steps:
        start = list(parents.get(step_id, ()))
        before = _targets(steps[step_id])
    else:
        start = [after] if after else []
    upstream = [_describe_upstream(steps[s], catalog) for s in _ancestors(start, parents)[:MAX_UPSTREAM]]
    inputs = _workflow_inputs(definition)
    if inputs:
        upstream.append(inputs)
    downstream = [_describe_downstream(steps[s], catalog) for s in dict.fromkeys(before) if s in steps]
    return upstream, downstream


_STEP_REF = re.compile(r"step_([A-Za-z0-9_\-]+?)_output")


def reference_dependencies(definition: dict) -> dict[str, list[str]]:
    """Step id → the steps whose output it reads (any ``step_<id>_output`` in its config)."""
    steps = [s for s in definition.get("steps") or [] if isinstance(s, dict) and s.get("id")]
    ids = {s["id"] for s in steps}
    out: dict[str, list[str]] = {}
    for s in steps:
        text = json.dumps(s.get("config") or {}, default=str)
        out[s["id"]] = sorted({m for m in _STEP_REF.findall(text) if m in ids and m != s["id"]})
    return out


def fix_fan_outs(definition: dict) -> tuple[dict, list[str]]:
    """The planner's fan-out repair for a hand-built graph. Returns ``(definition, changes)``.

    A step (not a condition) that lists several continuations runs only the
    first. Independent targets become one parallel group; targets that read
    each other's output are chained in that order. Groups whose members
    continue differently are converged. Nothing else is touched.
    """
    import copy

    from app.layers.workflow.topology_layer import normalise_graph

    fixed = copy.deepcopy(definition)
    steps = [s for s in fixed.get("steps") or [] if isinstance(s, dict) and s.get("id")]
    for s in steps:
        s["type"] = _kind(s)
    changes = normalise_graph(steps, reference_dependencies(fixed))
    return fixed, changes
