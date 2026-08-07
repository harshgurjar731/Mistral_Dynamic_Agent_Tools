"""
Workflow Validation — structural checks on a WorkflowDefinition.

The visual builder lets a user assemble any graph they like, so this module is
the gate that stops a malformed DAG from reaching the compiler, the local
engine, or the Mistral server. It runs in three places:

- ``POST /api/workflows/validate``  — live feedback while editing (non-blocking)
- ``POST/PUT /api/workflows``       — on save (errors block, warnings don't)
- ``POST /api/workflows/{n}/publish`` — on publish (errors block)

Severity contract
-----------------
``error``   the workflow cannot execute correctly; save/publish is refused.
``warning`` the workflow will run, but something is probably not intended
            (an unreachable step, an agent step with no query, …).

Every issue carries a stable ``code`` so the frontend can attach a fix-it
affordance without string-matching on the message.
"""

from __future__ import annotations

import re
from typing import Iterable

from app.services.workflow_engine.models import (
    StepType,
    ValidationIssue,
    ValidationResponse,
    WorkflowDefinition,
    WorkflowStep,
)

# Workflow names become Python identifiers in the compiled module
# (``run_{workflow_name}_{step_id}`` and a generated class name), so they are
# restricted to what is safe to interpolate into source code.
_NAME_RE = re.compile(r"^[a-z][a-z0-9_]{2,63}$")
_STEP_ID_RE = re.compile(r"^[a-zA-Z_][a-zA-Z0-9_]{0,63}$")

MAX_STEPS = 50  # matches the engine's safety cap in execute_workflow()


def _issue(
    severity: str,
    code: str,
    message: str,
    step_id: str | None = None,
    field: str | None = None,
) -> ValidationIssue:
    return ValidationIssue(
        severity=severity, code=code, message=message, step_id=step_id, field=field
    )


# ── Per-step checks ────────────────────────────────────────────────────────


def _validate_agent_step(step: WorkflowStep) -> Iterable[ValidationIssue]:
    cfg = step.config or {}
    agent_id = cfg.get("agent_id")
    has_inline = cfg.get("model") or cfg.get("instructions")

    if not agent_id and not has_inline:
        yield _issue(
            "error", "agent.missing_binding",
            "Agent step must reference an existing agent, or define a model and instructions inline.",
            step.id, "agent_id",
        )

    query = cfg.get("query_template") or cfg.get("query")
    if not query or not str(query).strip():
        yield _issue(
            "warning", "agent.empty_query",
            "Agent step has no query template — the agent will receive an empty prompt.",
            step.id, "query_template",
        )


def _validate_tool_step(step: WorkflowStep) -> Iterable[ValidationIssue]:
    cfg = step.config or {}

    # Tools are meant to be invoked *by* an agent: the model decides when to
    # call them and with what arguments. A bare tool step calls the function
    # directly with a hand-written argument template, so there is no reasoning
    # step and no tool-result round trip. Legacy definitions still execute, but
    # the visual builder no longer creates these.
    yield _issue(
        "warning", "tool.standalone_step",
        "This tool runs directly, bypassing any agent — arguments come from the template "
        "rather than from a model deciding how to call it. Prefer attaching the tool to an "
        "agent and letting the agent invoke it.",
        step.id, "tool_name",
    )

    if not cfg.get("tool_name"):
        yield _issue(
            "error", "tool.missing_name",
            "Tool step must specify which tool to call.",
            step.id, "tool_name",
        )

    args = cfg.get("arguments_template", cfg.get("arguments"))
    if args is not None and not isinstance(args, dict):
        yield _issue(
            "error", "tool.bad_arguments",
            "Tool arguments must be an object mapping parameter names to values or {{variables}}.",
            step.id, "arguments_template",
        )


def _validate_condition_step(
    step: WorkflowStep, step_ids: set[str]
) -> Iterable[ValidationIssue]:
    cfg = step.config or {}
    if not cfg.get("expression"):
        yield _issue(
            "error", "condition.missing_expression",
            "Condition step must define an expression to evaluate.",
            step.id, "expression",
        )

    # A condition routes via true_step/false_step rather than next_steps.
    branches = [("true_step", cfg.get("true_step")), ("false_step", cfg.get("false_step"))]
    if not any(target for _, target in branches):
        yield _issue(
            "error", "condition.no_branches",
            "Condition step must route to at least one branch (true or false).",
            step.id, "true_step",
        )

    for field, target in branches:
        if target and target not in step_ids:
            yield _issue(
                "error", "condition.dangling_branch",
                f"Condition branch '{field}' points at '{target}', which is not a step in this workflow.",
                step.id, field,
            )


def _validate_transform_step(step: WorkflowStep) -> Iterable[ValidationIssue]:
    cfg = step.config or {}
    if not cfg.get("transform_code") and not cfg.get("mappings"):
        yield _issue(
            "error", "transform.empty",
            "Transform step must define either transform code or field mappings.",
            step.id, "transform_code",
        )


_STEP_VALIDATORS = {
    StepType.AGENT: lambda s, ids: _validate_agent_step(s),
    StepType.TOOL: lambda s, ids: _validate_tool_step(s),
    StepType.CONDITION: _validate_condition_step,
    StepType.TRANSFORM: lambda s, ids: _validate_transform_step(s),
}


# ── Graph-level checks ─────────────────────────────────────────────────────


def _outgoing(step: WorkflowStep) -> list[str]:
    """All step IDs this step can hand control to, including condition branches."""
    targets = list(step.next_steps or [])
    if step.type == StepType.CONDITION:
        for key in ("true_step", "false_step"):
            target = (step.config or {}).get(key)
            if target:
                targets.append(target)
    return targets


def _find_cycle(steps: list[WorkflowStep], entry: str) -> list[str] | None:
    """Return one cycle as a path, or None. Iterative DFS with a colour map."""
    adjacency = {s.id: _outgoing(s) for s in steps}
    WHITE, GREY, BLACK = 0, 1, 2
    colour = {sid: WHITE for sid in adjacency}
    parent: dict[str, str | None] = {}

    def walk(root: str) -> list[str] | None:
        stack: list[tuple[str, int]] = [(root, 0)]
        parent[root] = None
        colour[root] = GREY
        while stack:
            node, index = stack.pop()
            neighbours = adjacency.get(node, [])
            if index < len(neighbours):
                stack.append((node, index + 1))
                nxt = neighbours[index]
                if nxt not in colour:
                    continue  # dangling edge — reported separately
                if colour[nxt] == GREY:
                    # Reconstruct the cycle from nxt back up through parents.
                    path = [nxt, node]
                    cursor = parent.get(node)
                    while cursor is not None and cursor != nxt:
                        path.append(cursor)
                        cursor = parent.get(cursor)
                    if cursor == nxt:
                        path.append(nxt)
                    return list(reversed(path))
                if colour[nxt] == WHITE:
                    colour[nxt] = GREY
                    parent[nxt] = node
                    stack.append((nxt, 0))
            else:
                colour[node] = BLACK
        return None

    for root in [entry] + [s.id for s in steps]:
        if colour.get(root) == WHITE:
            found = walk(root)
            if found:
                return found
    return None


def _reachable_from(steps: list[WorkflowStep], entry: str) -> set[str]:
    """Steps the engine can actually execute, starting from the entry step.

    Parallel-group members are mutually reachable: ``execute_workflow`` runs the
    *whole* group as soon as it lands on any one member, so a sibling with no
    inbound edge of its own still runs. Following explicit edges alone would
    flag every fan-out branch as unreachable.
    """
    adjacency = {s.id: _outgoing(s) for s in steps}

    group_members: dict[str, list[str]] = {}
    for step in steps:
        if step.parallel_group:
            group_members.setdefault(step.parallel_group, []).append(step.id)

    group_of = {s.id: s.parallel_group for s in steps if s.parallel_group}

    seen: set[str] = set()
    frontier = [entry]
    while frontier:
        node = frontier.pop()
        if node in seen or node not in adjacency:
            continue
        seen.add(node)
        frontier.extend(adjacency[node])
        group = group_of.get(node)
        if group:
            frontier.extend(group_members.get(group, []))
    return seen


def _validate_parallel_groups(steps: list[WorkflowStep]) -> Iterable[ValidationIssue]:
    """Parallel branches must fan back into a single shared join step.

    The engine advances past a group using ``group_steps[0].next_steps[0]``, so
    members that disagree about where to go would silently drop branches.
    """
    groups: dict[str, list[WorkflowStep]] = {}
    for step in steps:
        if step.parallel_group:
            groups.setdefault(step.parallel_group, []).append(step)

    for group_id, members in groups.items():
        if len(members) < 2:
            yield _issue(
                "warning", "parallel.single_member",
                f"Parallel group '{group_id}' has only one step — it will run sequentially.",
                members[0].id, "parallel_group",
            )
            continue

        joins = {tuple(m.next_steps or []) for m in members}
        if len(joins) > 1:
            yield _issue(
                "error", "parallel.divergent_join",
                f"All steps in parallel group '{group_id}' must continue to the same next step. "
                f"Found {len(joins)} different continuations.",
                members[0].id, "next_steps",
            )

        for member in members:
            if member.type == StepType.CONDITION:
                yield _issue(
                    "error", "parallel.condition_member",
                    f"Condition steps cannot be part of parallel group '{group_id}' — "
                    "branching inside a concurrent group has no defined join.",
                    member.id, "parallel_group",
                )


# ── Entry point ────────────────────────────────────────────────────────────


def validate_workflow(definition: WorkflowDefinition) -> ValidationResponse:
    """Run every structural check and return the collected issues."""
    issues: list[ValidationIssue] = []
    steps = definition.steps or []
    step_ids = {s.id for s in steps}

    # ── Identity ───────────────────────────────────────────────────────
    if not _NAME_RE.match(definition.name or ""):
        issues.append(_issue(
            "error", "workflow.bad_name",
            "Workflow name must be 3–64 characters, lowercase, starting with a letter, "
            "using only letters, digits and underscores.",
            None, "name",
        ))

    if not steps:
        issues.append(_issue(
            "error", "workflow.no_steps",
            "Workflow must contain at least one step.",
            None, "steps",
        ))
        return _finalise(issues)

    if len(steps) > MAX_STEPS:
        issues.append(_issue(
            "error", "workflow.too_many_steps",
            f"Workflow has {len(steps)} steps; the execution engine caps traversal at {MAX_STEPS}.",
            None, "steps",
        ))

    # ── Step IDs ───────────────────────────────────────────────────────
    seen: set[str] = set()
    for step in steps:
        if not _STEP_ID_RE.match(step.id or ""):
            issues.append(_issue(
                "error", "step.bad_id",
                f"Step id '{step.id}' is not a valid identifier — it is interpolated into "
                "generated Python function names.",
                step.id, "id",
            ))
        if step.id in seen:
            issues.append(_issue(
                "error", "step.duplicate_id",
                f"Duplicate step id '{step.id}'.",
                step.id, "id",
            ))
        seen.add(step.id)

    # ── Entry step ─────────────────────────────────────────────────────
    if not definition.entry_step:
        issues.append(_issue(
            "error", "workflow.no_entry",
            "Workflow must declare an entry step.",
            None, "entry_step",
        ))
    elif definition.entry_step not in step_ids:
        issues.append(_issue(
            "error", "workflow.bad_entry",
            f"Entry step '{definition.entry_step}' is not one of the workflow's steps.",
            None, "entry_step",
        ))

    # ── Edges ──────────────────────────────────────────────────────────
    for step in steps:
        for target in step.next_steps or []:
            if target not in step_ids:
                issues.append(_issue(
                    "error", "step.dangling_edge",
                    f"Step '{step.id}' continues to '{target}', which does not exist.",
                    step.id, "next_steps",
                ))
            elif target == step.id:
                issues.append(_issue(
                    "error", "step.self_loop",
                    f"Step '{step.id}' connects to itself.",
                    step.id, "next_steps",
                ))
        if len(step.next_steps or []) > 1 and step.type != StepType.CONDITION:
            issues.append(_issue(
                "warning", "step.multiple_next",
                f"Step '{step.id}' lists {len(step.next_steps)} continuations, but the engine "
                "follows only the first. Use a parallel group to fan out.",
                step.id, "next_steps",
            ))

    # ── Per-step config ────────────────────────────────────────────────
    for step in steps:
        validator = _STEP_VALIDATORS.get(step.type)
        if validator:
            issues.extend(validator(step, step_ids))

    # ── Parallel groups ────────────────────────────────────────────────
    issues.extend(_validate_parallel_groups(steps))

    # ── Reachability and cycles ────────────────────────────────────────
    if definition.entry_step in step_ids:
        reachable = _reachable_from(steps, definition.entry_step)
        for step in steps:
            if step.id not in reachable:
                issues.append(_issue(
                    "warning", "step.unreachable",
                    f"Step '{step.id}' cannot be reached from the entry step and will never run.",
                    step.id,
                ))

        cycle = _find_cycle(steps, definition.entry_step)
        if cycle:
            issues.append(_issue(
                "error", "workflow.cycle",
                # ASCII arrow on purpose: this string reaches Windows consoles
                # via logging, where cp1252 cannot encode U+2192.
                "Workflow contains a cycle: " + " -> ".join(cycle),
                cycle[0],
            ))

    # ── Terminal steps ─────────────────────────────────────────────────
    terminals = [s for s in steps if not _outgoing(s)]
    if not terminals:
        issues.append(_issue(
            "error", "workflow.no_terminal",
            "Workflow has no terminal step — every step continues to another.",
        ))

    return _finalise(issues)


def _finalise(issues: list[ValidationIssue]) -> ValidationResponse:
    errors = sum(1 for i in issues if i.severity == "error")
    warnings = sum(1 for i in issues if i.severity == "warning")
    return ValidationResponse(
        valid=errors == 0,
        issues=issues,
        error_count=errors,
        warning_count=warnings,
    )


def format_errors(response: ValidationResponse) -> str:
    """Render error-severity issues as a single line for HTTP error details."""
    return "; ".join(
        f"[{i.code}]{f' {i.step_id}:' if i.step_id else ''} {i.message}"
        for i in response.issues
        if i.severity == "error"
    )
