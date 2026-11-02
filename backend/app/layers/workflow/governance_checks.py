"""
Governance and guidance checks on an assembled workflow — no model calls.

Run by WorkflowValidationLayer next to the structural and rule checks:

* every agent step that writes, or whose mistakes cost money, is reflective or
  reviewed by a person before the workflow goes on;
* human-in-the-loop oversight actually has a review step;
* guidance a build applied with strength must / avoid is satisfied by what was
  built — an error, unless the process document deliberately overrode it, in
  which case the disagreement was recorded and this is a warning.
"""

from __future__ import annotations

from typing import Any


def _issue(severity: str, code: str, message: str, step_id: Any = None, field: Any = None) -> dict:
    return {"severity": severity, "code": code, "message": message, "step_id": step_id, "field": field}


def _downstream(definition, start: str) -> set[str]:
    by_id = {s.id: s for s in definition.steps}
    seen, todo = set(), [start]
    while todo:
        sid = todo.pop()
        step = by_id.get(sid)
        if step is None or sid in seen:
            continue
        seen.add(sid)
        todo += list(step.next_steps or [])
        for key in ("true_step", "false_step", "fallback_step"):
            if (step.config or {}).get(key):
                todo.append(step.config[key])
    seen.discard(start)
    return seen


def governance_issues(spec: Any, definition: Any) -> list[dict]:
    from app.catalog.vocab import COSTLY_REVERSIBILITY, WRITING_AUTHORITIES
    from app.services.workflow_engine.models import StepType

    out: list[dict] = []
    caps = {c.id: c for c in spec.capabilities if c.archetype is not None}
    by_id = {s.id: s for s in definition.steps}
    reviewed_of = {(s.config or {}).get("review_of") for s in definition.steps if s.type == StepType.HUMAN_REVIEW}
    for step in definition.steps:
        if step.type != StepType.AGENT:
            continue
        runtime = (step.config or {}).get("archetype") or {}
        cap = caps.get(step.id)
        if cap is None or not runtime:
            continue
        arch = cap.archetype
        later = _downstream(definition, step.id)
        reviewed = step.id in reviewed_of or any(by_id[s].type == StepType.HUMAN_REVIEW for s in later if s in by_id)
        risky = arch.action_authority in WRITING_AUTHORITIES or arch.reversibility in COSTLY_REVERSIBILITY
        if risky and "reflective" not in (runtime.get("patterns") or []) and not reviewed:
            out.append(_issue(
                "error", "governance.unchecked_action",
                f"'{step.id}' writes or has costly mistakes, but neither checks its own output nor is "
                f"reviewed by a person before the workflow continues.", step.id, "config.archetype"))
        if arch.oversight.model == "human_in_the_loop" and not reviewed:
            out.append(_issue(
                "error", "governance.missing_review",
                f"'{step.id}' requires human-in-the-loop oversight, but no review step follows it.",
                step.id))
    return out


def guidance_compliance(spec: Any, applied_items: list[dict], conflicts: list[str]) -> list[dict]:
    """Must / avoid guidance with an effect, checked against the archetypes that were built."""
    out: list[dict] = []
    agent_caps = [c for c in spec.capabilities if c.archetype is not None]
    for item in applied_items:
        if item.get("strength") not in ("must", "avoid") or not item.get("effect"):
            continue
        if item.get("conditions") and item.get("applies") != "true":
            continue
        effect = item["effect"]
        for cap in agent_caps:
            arch = cap.archetype
            broken = []
            want = effect.get("archetype.primary_type")
            if want and arch.primary_type != want:
                broken.append(f"type is {arch.primary_type}, not {want}")
            for p in effect.get("archetype.patterns.add") or []:
                if p not in arch.patterns:
                    broken.append(f"lacks {p}")
            for p in effect.get("archetype.patterns.remove") or []:
                if p in arch.patterns:
                    broken.append(f"still has {p}")
            if not broken:
                continue
            overridden = arch.source == "document" or any(cap.name in c or cap.id in c for c in conflicts)
            out.append(_issue(
                "warning" if overridden else "error", "guidance.not_followed",
                f"Guidance {item['id']} ({item['strength']}: {item['title']}) is not followed by "
                f"'{cap.id}': {'; '.join(broken)}."
                + (" The process document overrode it deliberately." if overridden else ""),
                cap.id))
    return out
