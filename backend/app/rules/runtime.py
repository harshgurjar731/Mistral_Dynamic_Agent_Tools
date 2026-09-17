"""
Rules runtime — which rules are in force for the code running right now.

The tool router (``tool_registry.execute_tool``) is shared by the chat
pipeline and by workflow agent steps, and it is called several frames below
anything that knows which agent is running. A ``ContextVar`` carries the
active rules down to it, the same way ``tool_registry.CURRENT_AGENT`` carries
the agent id for domain scoping.

The context object is mutable and shared by reference, so outcomes recorded
inside ``asyncio.gather`` branches (which run on copied contexts) still land in
the list the caller reads at the end of the turn.
"""

from __future__ import annotations

import logging
from contextvars import ContextVar, Token
from dataclasses import dataclass, field
from typing import Optional

logger = logging.getLogger(__name__)


@dataclass
class RuleContext:
    rules: list[dict]
    scope: str                          # agent | workflow
    subject_id: str                     # agent id | workflow name
    conversation_id: Optional[str] = None
    outcomes: list[dict] = field(default_factory=list)


#: The agent rules of the agent currently taking a turn — read by the tool gate.
ACTIVE_RULES: ContextVar[Optional[RuleContext]] = ContextVar("active_rules", default=None)

#: The workflow rules of the workflow currently running — read by the step
#: runners. Separate from ACTIVE_RULES because an agent step inside a workflow
#: is governed by both: its own agent rules and the workflow's step rules.
WORKFLOW_RULES: ContextVar[Optional[RuleContext]] = ContextVar("workflow_rules", default=None)


def _reset(var: ContextVar, token: Optional[Token]) -> None:
    if token is not None:
        try:
            var.reset(token)
        except ValueError:
            # Reset from a different context (e.g. a generator finalised on
            # another task). The var falls out of scope with that context.
            pass


def activate(rules: list[dict], scope: str, subject_id: str,
             conversation_id: Optional[str] = None) -> tuple[RuleContext, Token]:
    ctx = RuleContext(rules=list(rules or []), scope=scope, subject_id=subject_id or "unknown",
                      conversation_id=conversation_id)
    return ctx, ACTIVE_RULES.set(ctx)


def reset(token: Optional[Token]) -> None:
    _reset(ACTIVE_RULES, token)


def current() -> Optional[RuleContext]:
    return ACTIVE_RULES.get()


def activate_workflow(rules: list[dict], workflow_name: str) -> tuple[RuleContext, Token]:
    ctx = RuleContext(rules=list(rules or []), scope="workflow", subject_id=workflow_name)
    return ctx, WORKFLOW_RULES.set(ctx)


def reset_workflow(token: Optional[Token]) -> None:
    _reset(WORKFLOW_RULES, token)


def current_workflow() -> Optional[RuleContext]:
    return WORKFLOW_RULES.get()


def record(outcomes: list[dict], *, scope: str, subject_id: str,
           conversation_id: Optional[str] = None, ctx: Optional[RuleContext] = None) -> list[dict]:
    """Attach subject and run identifiers to outcomes, then persist them."""
    if not outcomes:
        return []
    from app.rules import store

    execution_id = step_id = None
    try:
        from app.services.workflow_engine import execution_logs

        execution_id = execution_logs.CURRENT_EXECUTION.get()
        step_id = execution_logs.CURRENT_STEP.get()
    except Exception:
        pass

    events = [
        {
            **o,
            "scope": scope,
            "subject_id": subject_id,
            "conversation_id": conversation_id,
            "execution_id": execution_id,
            "step_id": step_id,
        }
        for o in outcomes
    ]
    if ctx is not None:
        ctx.outcomes.extend(outcomes)
    store.record_events(events)
    return events


def record_current(outcomes: list[dict]) -> None:
    """Record outcomes against whatever subject is active."""
    ctx = current()
    if ctx is None or not outcomes:
        return
    record(outcomes, scope=ctx.scope, subject_id=ctx.subject_id,
           conversation_id=ctx.conversation_id, ctx=ctx)


def guard_tool_call(tool_name: str, arguments: dict) -> Optional[str]:
    """Check a tool call against the active rules. Returns a refusal or None.

    The refusal is handed back to the model as the tool's result, so a blocked
    write becomes something the agent can explain rather than a crash.
    """
    ctx = current()
    if ctx is None or not ctx.rules:
        return None
    try:
        from app.rules import engine

        outcomes, refusal = engine.check_tool_call(tool_name, arguments or {}, ctx.rules)
        record_current(outcomes)
        if refusal:
            logger.info("Tool call '%s' refused: %s", tool_name, refusal)
        return refusal
    except Exception as e:
        logger.warning("Tool rule check skipped for '%s': %s", tool_name, e)
        return None


def summarise(outcomes: list[dict]) -> list[dict]:
    """Collapse a turn's outcomes to one entry per rule, worst outcome first.

    A rule checked on three tool calls produces three outcomes; the chat shows
    one line per rule, carrying the most significant result.
    """
    rank = {"blocked": 0, "fixed": 1, "warned": 2, "applied": 3, "passed": 4}
    best: dict[str, dict] = {}
    for o in outcomes or []:
        current_best = best.get(o["rule_id"])
        if current_best is None or rank.get(o["outcome"], 9) < rank.get(current_best["outcome"], 9):
            best[o["rule_id"]] = o
    return sorted(
        ({"rule_id": o["rule_id"], "name": o["rule_name"], "outcome": o["outcome"],
          "message": o.get("message", ""), "checkpoint": o.get("checkpoint", "")}
         for o in best.values()),
        key=lambda o: (rank.get(o["outcome"], 9), o["name"]),
    )
