"""
Local workflow executions, kept beyond the process that ran them.

The local DAG engine keeps a live run in memory (``engine._execution_store``):
fast, and the step-by-step view reads it. On its own that means a restart
loses every run — finished ones vanish from history, and running ones are
never closed: their page spins forever and a human review they were waiting
on stays "pending" with nobody left to resume it.

So every execution is also written here when it starts and when it ends, and
at start-up ``interrupt_orphans`` closes out what a previous process left
running. Reads fall back to this table for anything no longer in memory.
"""

from __future__ import annotations

import asyncio
import json
import logging
from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import Column, DateTime, String, Text

from app.database import Base, SessionLocal
from app.services.workflow_engine.models import WorkflowRun, WorkflowStatus

logger = logging.getLogger(__name__)

#: A run's stored JSON beyond this is trimmed to its summary (no step outputs).
_MAX_PAYLOAD = 2_000_000
_OPEN = (WorkflowStatus.PENDING.value, WorkflowStatus.RUNNING.value)


class LocalExecution(Base):
    __tablename__ = "local_executions"
    #: The workspace that owns the row (app.auth.scoping).
    workspace_id = Column(String, nullable=True, index=True)

    execution_id = Column(String, primary_key=True)
    workflow_name = Column(String, nullable=False, index=True)
    status = Column(String, nullable=False, index=True)
    start_time = Column(DateTime, nullable=True, index=True)
    end_time = Column(DateTime, nullable=True)
    payload = Column(Text, nullable=False)
    updated_at = Column(DateTime, nullable=True)


def _naive(dt: Optional[datetime]) -> Optional[datetime]:
    if dt is None:
        return None
    return dt.astimezone(timezone.utc).replace(tzinfo=None) if dt.tzinfo else dt


def _status(run: WorkflowRun) -> str:
    return run.status.value if hasattr(run.status, "value") else str(run.status)


def _payload(run: WorkflowRun) -> str:
    text = run.model_dump_json()
    if len(text) <= _MAX_PAYLOAD:
        return text
    return run.model_copy(update={"step_results": []}).model_dump_json()


def save(run: WorkflowRun) -> None:
    """Upsert one run. Never raises: history must not break the run itself."""
    if SessionLocal is None:
        return
    try:
        with SessionLocal() as db:
            row = db.get(LocalExecution, run.execution_id)
            if row is None:
                row = LocalExecution(execution_id=run.execution_id)
                db.add(row)
            row.workflow_name = run.workflow_name
            row.status = _status(run)
            row.start_time = _naive(run.start_time)
            row.end_time = _naive(run.end_time)
            row.payload = _payload(run)
            row.updated_at = datetime.now(timezone.utc).replace(tzinfo=None)
            db.commit()
    except Exception as e:  # noqa: BLE001
        logger.warning("Could not record execution %s: %s", run.execution_id, e)


async def record(run: WorkflowRun) -> None:
    """``save`` off the event loop (it is a database write)."""
    await asyncio.to_thread(save, run.model_copy(deep=True))


def _from_row(row: LocalExecution) -> Optional[WorkflowRun]:
    try:
        return WorkflowRun(**json.loads(row.payload))
    except Exception as e:  # noqa: BLE001
        logger.debug("Unreadable execution %s: %s", row.execution_id, e)
        return None


def load(execution_id: str) -> Optional[WorkflowRun]:
    if SessionLocal is None:
        return None
    try:
        with SessionLocal() as db:
            row = db.get(LocalExecution, execution_id)
            return _from_row(row) if row else None
    except Exception:  # noqa: BLE001
        return None


def recent(workflow_name: Optional[str] = None, limit: int = 200) -> list[WorkflowRun]:
    if SessionLocal is None:
        return []
    try:
        with SessionLocal() as db:
            q = db.query(LocalExecution)
            if workflow_name:
                q = q.filter(LocalExecution.workflow_name == workflow_name)
            rows = q.order_by(LocalExecution.start_time.desc()).limit(limit).all()
            return [r for r in (_from_row(row) for row in rows) if r is not None]
    except Exception:  # noqa: BLE001
        return []


def _close(db, rows: list[LocalExecution], reason: str) -> list[str]:
    now = datetime.now(timezone.utc)
    ids = []
    for row in rows:
        run = _from_row(row)
        if run is not None:
            run.status = WorkflowStatus.TERMINATED
            run.end_time = run.end_time or now
            base = run.result if isinstance(run.result, dict) else {}
            run.result = {**base, "error": reason, "interrupted": True}
            row.payload = _payload(run)
        row.status = WorkflowStatus.TERMINATED.value
        row.end_time = row.end_time or now.replace(tzinfo=None)
        row.updated_at = now.replace(tzinfo=None)
        ids.append(row.execution_id)
    return ids


def _expire_reviews(db, execution_ids: list[str], reason: str) -> int:
    if not execution_ids:
        return 0
    from app.services.workflow_engine.reviews import HumanReview

    return db.query(HumanReview).filter(
        HumanReview.engine == "local", HumanReview.status == "pending",
        HumanReview.execution_id.in_(execution_ids),
    ).update({"status": "timed_out", "comment": reason}, synchronize_session=False)


def interrupt_orphans() -> dict:
    """At start-up: runs a previous process left open died with it."""
    from app.auth.context import unscoped

    reason = "The server restarted while this run was in progress. Start it again."
    if SessionLocal is None:
        return {}
    with unscoped(), SessionLocal() as db:
        rows = db.query(LocalExecution).filter(LocalExecution.status.in_(_OPEN)).all()
        ids = _close(db, rows, reason)
        reviews = _expire_reviews(db, ids, "The run waiting for this review was stopped by a "
                                           "server restart.")
        db.commit()
    return {"executions": len(ids), "reviews": reviews}


def interrupt_live(runs: list[WorkflowRun], reason: str) -> int:
    """At shutdown: the runs still going in this process are about to die."""
    from app.auth.context import unscoped

    open_ids = [r.execution_id for r in runs if _status(r) in _OPEN]
    if not open_ids or SessionLocal is None:
        return 0
    for run in runs:
        if run.execution_id in open_ids:
            save(run)
    with unscoped(), SessionLocal() as db:
        rows = db.query(LocalExecution).filter(LocalExecution.execution_id.in_(open_ids)).all()
        ids = _close(db, rows, reason)
        _expire_reviews(db, ids, "The run waiting for this review was stopped by a server "
                                 "shutdown.")
        db.commit()
    return len(ids)
