"""
Revision prompts derived from what is wrong with a workflow — no LLM.

Validation already knows exactly what is broken and where; turning each issue
into an instruction the user can send with one click is the shortest path from
"this workflow has 3 errors" to a fixed workflow. Issue codes are stable (see
``workflow_engine.validation``), so they are matched here rather than messages.

When nothing is wrong, a few general improvements are offered instead, so the
composer never opens empty-handed.
"""

from __future__ import annotations

from typing import Optional

_BY_CODE = {
    "agent.missing_binding": "Bind step '{step}' to an existing agent that can do its job, "
                             "or give it a model and instructions of its own.",
    "agent.empty_query": "Write a query template for '{step}' that says what the agent is "
                         "given and exactly what it must return.",
    "tool.missing_name": "Choose the activity that step '{step}' should call.",
    "tool.bad_arguments": "Fix the arguments of '{step}' so each parameter maps to a value "
                          "or an upstream variable.",
    "connector.missing_connector": "Pick the connector that step '{step}' should use.",
    "connector.missing_tool": "Pick which connector tool step '{step}' should call.",
    "connector.no_arguments": "Give '{step}' the arguments its connector call needs.",
    "condition.missing_expression": "Add the expression step '{step}' should branch on.",
    "condition.no_branches": "Route the true and false branches of '{step}' to the right steps.",
    "condition.dangling_branch": "Point the branches of '{step}' at steps that exist.",
    "transform.empty": "Write the transform for '{step}', or remove the step if it is not needed.",
    "step.unreachable": "Connect '{step}' into the flow so it actually runs, or remove it.",
    "step.multiple_next": "Make the steps after '{step}' run in parallel, or put them in order.",
    "step.dangling_edge": "Remove the link from '{step}' to a step that no longer exists.",
    "step.self_loop": "Remove the loop from '{step}' back to itself.",
    "parallel.divergent_join": "Make the parallel steps in this group continue to the same step.",
    "parallel.single_member": "Take '{step}' out of its parallel group — it is alone in it.",
    "parallel.condition_member": "Move condition '{step}' out of its parallel group.",
    "workflow.cycle": "Break the loop in the workflow so it always reaches an end.",
    "workflow.no_terminal": "Make sure the workflow has a final step that ends it.",
    "workflow.no_entry": "Choose the step the workflow should start at.",
    "workflow.bad_entry": "Choose a step that exists as the workflow's starting point.",
}

_IMPROVEMENTS = [
    ("Add a human review step before the final output is produced.", "improve"),
    ("Run the steps that do not depend on each other in parallel.", "improve"),
    ("Validate the inputs at the very start and stop early if they are incomplete.", "improve"),
    ("Remove any step that does not contribute to the final outcome.", "simplify"),
]


def suggestions_for(issues: list[dict], *, limit: int = 6) -> list[dict]:
    """``issues`` are ValidationIssue dicts. Errors first, then warnings."""
    ranked = sorted(issues, key=lambda i: 0 if i.get("severity") == "error" else 1)
    out: list[dict] = []
    seen: set[str] = set()
    for issue in ranked:
        prompt = _prompt(issue.get("code"), issue.get("step_id"), issue.get("message") or "")
        if not prompt or prompt in seen:
            continue
        seen.add(prompt)
        out.append({
            "kind": "fix",
            "severity": issue.get("severity"),
            "code": issue.get("code"),
            "step_id": issue.get("step_id"),
            "title": issue.get("message"),
            "prompt": prompt,
        })
        if len(out) >= limit:
            return out
    if not out:
        out = [{"kind": kind, "severity": None, "code": None, "step_id": None,
                "title": None, "prompt": prompt} for prompt, kind in _IMPROVEMENTS]
    return out[:limit]


def _prompt(code: Optional[str], step_id: Optional[str], message: str) -> Optional[str]:
    template = _BY_CODE.get(code or "")
    if template and ("{step}" not in template or step_id):
        return template.format(step=step_id)
    if message:
        return f"Fix this{f' in {step_id!r}' if step_id else ''}: {message}"
    return None
