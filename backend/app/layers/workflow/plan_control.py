"""
User control over a workflow plan — what it created, asking, and rolling back.

Planning creates real things as it goes: activities on the tool service, agents
and libraries on Mistral, and finally the saved workflow. Every one is recorded
in ``ctx.metadata["created"]`` so that, when the user chooses to, all of it can
be removed again.

Where planning cannot finish something on its own — an activity or agent that
still fails after every automatic attempt — or when the workflow is built and
ready to be tested, it stops and asks (:func:`ask_user`). Asking needs a
background run (``POST /runs/workflow-plan``) to deliver the question and its
answer; the plain streaming endpoint has nobody to ask and takes the default.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
from typing import Optional

from app.core.context import PipelineContext

logger = logging.getLogger(__name__)

CREATED_KEY = "created"
#: Set when the user rolled the plan back; the runner reports it.
ROLLED_BACK_KEY = "plan_rolled_back"

#: Choices offered when something could not be built.
BUILD_FAILED_OPTIONS = ["retry", "rollback", "manual"]


def record_created(ctx: PipelineContext, kind: str, ref: str, name: str, **extra) -> None:
    """Note something this plan created, for a later rollback."""
    ctx.metadata.setdefault(CREATED_KEY, []).append(
        {"kind": kind, "id": ref, "name": name, **extra})


def created(ctx: PipelineContext) -> list[dict]:
    return list(ctx.metadata.get(CREATED_KEY) or [])


def can_ask(ctx: PipelineContext) -> bool:
    return callable(getattr(ctx.event_queue, "ask", None))


async def ask_user(ctx: PipelineContext, kind: str, question: dict, *,
                   options: list[str], default: str) -> str:
    """The user's choice, or ``default`` when there is no one to ask."""
    if not can_ask(ctx):
        logger.info("No interactive run — taking '%s' for %s", default, kind)
        return default
    answer = await ctx.event_queue.ask(kind, {**question, "created": created(ctx)},
                                       options=options, default=default)
    return str(answer.get("choice") or default)


async def ask_build_failed(ctx: PipelineContext, entity: str, failures: list[dict],
                           *, attempts: int) -> str:
    """Ask what to do about ``failures`` (rows with ``name`` and ``error``).

    retry    — try building the failed entities again
    rollback — remove everything this plan created and stop
    manual   — finish the workflow without them; build or write them later
    """
    noun = {"activity": "activity(ies)", "agent": "agent(s)"}.get(entity, entity)
    return await ask_user(ctx, "build_failed", {
        "entity": entity,
        "title": f"{len(failures)} {noun} could not be built after {attempts} attempt(s)",
        "failures": failures,
        "attempts": attempts,
    }, options=BUILD_FAILED_OPTIONS, default="manual")


# ── Rollback ────────────────────────────────────────────────────────────────


async def roll_back_plan(ctx: PipelineContext, reason: str) -> list[dict]:
    """Remove everything recorded as created, newest first, and stop planning.

    Each removal is attempted independently; the report says which failed, so
    nothing is silently left behind.
    """
    report = []
    for item in reversed(created(ctx)):
        try:
            outcome = await _remove(ctx, item)
            report.append({**item, "removed": True, "detail": outcome})
        except Exception as e:  # noqa: BLE001 — report it and keep removing the rest
            logger.warning("Rollback of %s '%s' failed: %s", item["kind"], item["name"], e)
            report.append({**item, "removed": False, "detail": f"{type(e).__name__}: {e}"})
    ctx.metadata[CREATED_KEY] = [r for r in report if not r["removed"]]
    ctx.metadata[ROLLED_BACK_KEY] = True
    ctx.emit("plan_rolled_back", json.dumps({"reason": reason, "items": report}, default=str))
    left = [r for r in report if not r["removed"]]
    message = (f"Rolled back at your request ({reason}). "
               + (f"{len(left)} item(s) could not be removed — see the rollback report."
                  if left else "Everything this plan created was removed."))
    # Not ctx.set_error: that announces a failure. Setting the error still
    # stops every later layer; the runner reports the run as rolled back.
    ctx.error = message
    return report


async def _remove(ctx: PipelineContext, item: dict) -> str:
    kind, ref = item["kind"], item["id"]
    if kind == "activity":
        from app.services.tool_resolver import tool_resolver

        result = await tool_resolver.delete_tool(int(ref))
        if result.get("status") != "deleted":
            raise RuntimeError(result.get("message") or result.get("error") or str(result))
        return str(result.get("message") or "deleted")
    if kind == "agent":
        await asyncio.to_thread(ctx.client.beta.agents.delete, agent_id=ref)
        return "deleted"
    if kind == "library":
        from app.services import library_service

        await library_service.delete_library(ref)
        return "deleted"
    if kind == "workflow":
        from app.config import settings
        from app.services.workflow_engine.engine import delete_workflow, save_workflow
        from app.services.workflow_engine.models import WorkflowDefinition

        if item.get("previous"):
            # The plan overwrote an existing workflow: put that one back.
            await asyncio.to_thread(save_workflow, WorkflowDefinition(**item["previous"]))
            return "restored the previous definition"
        await asyncio.to_thread(delete_workflow, ref)
        compiled = os.path.join(settings.MISTRAL_WORKFLOWS_DIR, f"workflow_{ref}.py")
        if os.path.exists(compiled):
            os.remove(compiled)
        return "deleted"
    raise ValueError(f"unknown kind '{kind}'")


def failure_rows(rows: list[dict]) -> list[dict]:
    """The compact shape a ``build_failed`` question lists."""
    return [{"id": r.get("id"), "name": r.get("name"), "step": r.get("step"),
             "error": str(r.get("error") or "")[:600],
             "rolled_back": bool(r.get("rolled_back"))} for r in rows]

