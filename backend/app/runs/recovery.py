"""
After a restart: clean up what interrupted workflow plans left behind.

A workflow plan creates agents (on Mistral), activities (on the Tool Service)
and libraries before it saves the workflow that uses them. A plan that dies
mid-way — the process crashed, the container was replaced — leaves those with
nothing using them. Each item is written to the run's event log the moment it
is created (``plan_item_created``), so here, at start-up, every plan run that
was interrupted gets its unused items removed, in its own workspace (with its
own Mistral key), exactly as a cancelled plan does.

The outcome is stored on the run (``result.reclaimed``), so it is done once and
anyone who opens the run sees what was removed and anything that could not be.
"""

from __future__ import annotations

import json
import logging
from datetime import datetime, timedelta, timezone

logger = logging.getLogger(__name__)

#: Only runs interrupted this recently are looked at.
_LOOKBACK = timedelta(days=7)


def _pending_runs() -> list[dict]:
    from app.auth.context import unscoped
    from app.database import SessionLocal
    from app.runs.models import PipelineRunRecord

    if SessionLocal is None:
        return []
    since = datetime.now(timezone.utc).replace(tzinfo=None) - _LOOKBACK
    out = []
    with unscoped(), SessionLocal() as db:
        rows = (db.query(PipelineRunRecord)
                .filter(PipelineRunRecord.kind == "workflow_plan",
                        PipelineRunRecord.status == "interrupted",
                        PipelineRunRecord.updated_at >= since).all())
        for r in rows:
            try:
                result = json.loads(r.result) if r.result else {}
            except ValueError:
                result = {}
            if isinstance(result, dict) and "reclaimed" in result:
                continue
            out.append({"id": r.id, "workspace_id": r.workspace_id,
                        "result": result if isinstance(result, dict) else {}})
    return out


def _items_of(run_id: str) -> list[dict]:
    """What the plan created and had not already removed, from its event log."""
    from app.runs import store

    created: dict[str, dict] = {}
    for _seq, event, data in store.events_after(run_id, 0):
        try:
            payload = json.loads(data)
        except (TypeError, ValueError):
            continue
        if event == "plan_item_created" and isinstance(payload, dict):
            created[f"{payload.get('kind')}:{payload.get('id')}"] = payload
        elif event == "plan_rolled_back" and isinstance(payload, dict):
            for item in payload.get("items") or []:
                if item.get("removed"):
                    created.pop(f"{item.get('kind')}:{item.get('id')}", None)
    return list(created.values())


def _store_outcome(run_id: str, result: dict) -> None:
    from app.auth.context import unscoped
    from app.database import SessionLocal
    from app.runs.models import PipelineRunRecord

    with unscoped(), SessionLocal() as db:
        row = db.get(PipelineRunRecord, run_id)
        if row is not None:
            row.result = json.dumps(result, default=str)
            db.commit()


async def reclaim_interrupted_plans() -> dict:
    """Best effort; anything that fails is reported on the run and retried never."""
    import asyncio

    from app.auth.context import use_workspace
    from app.core.context import PipelineContext
    from app.layers.workflow import plan_control

    runs = await asyncio.to_thread(_pending_runs)
    removed = kept = 0
    for run in runs:
        items = await asyncio.to_thread(_items_of, run["id"])
        report: list[dict] = []
        if items:
            with use_workspace(run["workspace_id"]):
                try:
                    from app.dependencies import get_mistral_client

                    ctx = PipelineContext(query="", client=get_mistral_client())
                    ctx.metadata[plan_control.CREATED_KEY] = items
                    report = await plan_control.reclaim_unused(
                        ctx, "the plan was interrupted by a server restart")
                except Exception as e:  # noqa: BLE001
                    logger.warning("Could not reclaim plan run %s: %s", run["id"], e)
                    report = [{"removed": False, "detail": f"{type(e).__name__}: {e}"}]
        removed += sum(1 for r in report if r.get("removed"))
        kept += sum(1 for r in report if not r.get("removed"))
        await asyncio.to_thread(_store_outcome, run["id"], {**run["result"], "reclaimed": report})
    if runs:
        logger.info("Interrupted plans: %d run(s) checked, %d item(s) removed, %d left",
                    len(runs), removed, kept)
    return {"runs": len(runs), "removed": removed, "left": kept}


def close_stuck_work() -> dict:
    """At start-up: ingests a previous process was in the middle of.

    They ran inside that process, so nothing will ever finish them; left as
    they are, their rows say "indexing" or "pending" forever. Marked failed with
    a reason, each can simply be run again from its page.
    """
    from sqlalchemy import inspect, text

    from app.database import engine

    if engine is None:
        return {}
    out: dict[str, int] = {}
    jobs = [
        ("rag_documents", "error",
         "status IN ('indexing', 'extracting')",
         "Interrupted by a server restart. Extract it again."),
        ("knowledge_sources", "message",
         "status = 'pending'",
         "Interrupted by a server restart while it was being read. Add it again."),
    ]
    tables = set(inspect(engine).get_table_names())
    with engine.begin() as conn:
        for table, column, where, reason in jobs:
            if table not in tables:
                continue
            n = conn.execute(text(f"UPDATE {table} SET status = 'failed', {column} = :reason "
                                  f"WHERE {where}"), {"reason": reason}).rowcount
            if n:
                out[table] = n
    return out
