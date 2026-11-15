"""
Which planning layer is responsible for a validation issue — so the run can go back to it.

Validation runs near the end of the plan. An error it finds was usually made
much earlier: a dangling edge by the topology, an unwired argument by the data
flow, an untyped input by the input design. Each issue code is mapped to the
layer that owns it; ``WorkflowValidationLayer`` sends the run back to the
earliest of them with the problems listed (``app.core.stages``), and that layer
decides again knowing what went wrong. Only side-effect-free layers are owners:
nothing already created is created twice.
"""

from __future__ import annotations

from typing import Iterable, Optional

#: Issue-code prefix → owning layer. Longest prefix wins.
_OWNERS = {
    "dataflow.": "data_flow",
    "tool.": "data_flow",
    "connector.no_arguments": "data_flow",
    "connector.bad_arguments": "data_flow",
    "agent.empty_query": "data_flow",
    "condition.cannot_evaluate": "data_flow",
    "condition.missing_expression": "data_flow",
    "transform.": "data_flow",
    "input.": "input_schema",
    "step.": "step_topology",
    "parallel.": "step_topology",
    "condition.dangling_branch": "step_topology",
    "condition.no_branches": "step_topology",
    "workflow.cycle": "step_topology",
    "workflow.no_terminal": "step_topology",
    "workflow.bad_entry": "step_topology",
    "workflow.no_entry": "step_topology",
    "agent.missing_binding": "step_topology",
    "human_review.": "oversight_placement",
}


def owner_of(code: Optional[str]) -> Optional[str]:
    code = code or ""
    best = None
    for prefix, owner in _OWNERS.items():
        if code.startswith(prefix) and (best is None or len(prefix) > len(best[0])):
            best = (prefix, owner)
    return best[1] if best else None


def by_owner(issues: Iterable) -> dict[str, list[str]]:
    """Blocking issues grouped by the layer that should fix them."""
    out: dict[str, list[str]] = {}
    for issue in issues:
        get = issue.get if isinstance(issue, dict) else (lambda k, _i=issue: getattr(_i, k, None))
        owner = owner_of(get("code"))
        if not owner:
            continue
        step = get("step_id")
        out.setdefault(owner, []).append(
            f"[{get('code')}]" + (f" step '{step}'" if step else "") + f": {get('message')}")
    return out
