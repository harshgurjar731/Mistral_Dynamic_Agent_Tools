"""
SQLite persistence for background runs.

Synchronous on purpose — the manager calls these through ``asyncio.to_thread``
so a slow write never stalls the event loop the pipelines run on. Every
function degrades to a no-op when the database is unavailable: persistence is
what makes a run replayable later, not what makes it run.
"""

from __future__ import annotations

import json
import logging
from datetime import datetime, timezone
from typing import Any, Optional

from app.database import SessionLocal
from app.runs.models import PipelineRunEvent, PipelineRunRecord

logger = logging.getLogger(__name__)


def _now() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def _iso(value: Optional[datetime]) -> Optional[str]:
    # SQLite hands back naive datetimes; every one written here is UTC.
    return f"{value.isoformat()}Z" if value else None


def _loads(text: Optional[str], default: Any) -> Any:
    if not text:
        return default
    try:
        return json.loads(text)
    except (TypeError, ValueError):
        return default


def to_dict(row: PipelineRunRecord) -> dict:
    return {
        "id": row.id,
        "kind": row.kind,
        "title": row.title,
        "status": row.status,
        "request": _loads(row.request, {}),
        "result": _loads(row.result, None),
        "error": row.error,
        "progress": {
            "total": row.layers_total or 0,
            "done": row.layers_done or 0,
            "label": row.current_label,
            "note": row.note,
        },
        "last_seq": row.last_seq or 0,
        "created_at": _iso(row.created_at),
        "updated_at": _iso(row.updated_at),
        "finished_at": _iso(row.finished_at),
    }


def create_run(run_id: str, kind: str, title: str, request: dict) -> None:
    if SessionLocal is None:
        return
    db = SessionLocal()
    try:
        now = _now()
        db.add(PipelineRunRecord(
            id=run_id, kind=kind, title=title[:500], status="running",
            request=json.dumps(request, default=str), created_at=now, updated_at=now,
        ))
        db.commit()
    except Exception as e:
        db.rollback()
        logger.warning("Could not record run %s: %s", run_id, e)
    finally:
        db.close()


def write_batch(run_id: str, events: list[tuple[int, str, str]], fields: dict) -> None:
    """Append events and update the run row in one transaction."""
    if SessionLocal is None:
        return
    db = SessionLocal()
    try:
        for seq, event, data in events:
            db.add(PipelineRunEvent(run_id=run_id, seq=seq, event=event, data=data))
        if fields:
            row = db.get(PipelineRunRecord, run_id)
            if row is not None:
                for key, value in fields.items():
                    setattr(row, key, value)
                row.updated_at = _now()
        db.commit()
    except Exception as e:
        db.rollback()
        logger.warning("Could not persist %d event(s) for run %s: %s", len(events), run_id, e)
    finally:
        db.close()


def get_run(run_id: str) -> Optional[dict]:
    if SessionLocal is None:
        return None
    db = SessionLocal()
    try:
        row = db.get(PipelineRunRecord, run_id)
        return to_dict(row) if row else None
    finally:
        db.close()


def list_runs(
    *, status: Optional[str] = None, kind: Optional[str] = None, limit: int = 30,
) -> list[dict]:
    if SessionLocal is None:
        return []
    db = SessionLocal()
    try:
        q = db.query(PipelineRunRecord)
        if status:
            q = q.filter(PipelineRunRecord.status.in_([s.strip() for s in status.split(",")]))
        if kind:
            q = q.filter(PipelineRunRecord.kind.in_([k.strip() for k in kind.split(",")]))
        rows = q.order_by(PipelineRunRecord.created_at.desc()).limit(max(1, min(limit, 200))).all()
        return [to_dict(r) for r in rows]
    finally:
        db.close()


def events_after(run_id: str, after: int = 0) -> list[tuple[int, str, str]]:
    if SessionLocal is None:
        return []
    db = SessionLocal()
    try:
        rows = (
            db.query(PipelineRunEvent.seq, PipelineRunEvent.event, PipelineRunEvent.data)
            .filter(PipelineRunEvent.run_id == run_id, PipelineRunEvent.seq > after)
            .order_by(PipelineRunEvent.seq.asc(), PipelineRunEvent.id.asc())
            .all()
        )
        return [(r[0], r[1], r[2]) for r in rows]
    finally:
        db.close()


def mark_interrupted() -> int:
    """Close out runs a previous process left ``running``.

    Their tasks died with that process. Left as ``running`` they would spin in
    the UI forever; ``interrupted`` tells the user to start them again.
    """
    if SessionLocal is None:
        return 0
    db = SessionLocal()
    try:
        now = _now()
        count = (
            db.query(PipelineRunRecord)
            .filter(PipelineRunRecord.status == "running")
            .update(
                {
                    "status": "interrupted",
                    "error": "The server restarted while this was running.",
                    "finished_at": now,
                    "updated_at": now,
                },
                synchronize_session=False,
            )
        )
        db.commit()
        return count
    except Exception as e:
        db.rollback()
        logger.warning("Could not close out interrupted runs: %s", e)
        return 0
    finally:
        db.close()


def prune(keep_runs: int = 200) -> int:
    """Keep the most recent runs; event logs are diagnostic, not an archive."""
    if SessionLocal is None:
        return 0
    db = SessionLocal()
    try:
        stale = [
            r[0]
            for r in db.query(PipelineRunRecord.id)
            .order_by(PipelineRunRecord.created_at.desc())
            .offset(keep_runs)
            .all()
        ]
        if not stale:
            return 0
        db.query(PipelineRunEvent).filter(PipelineRunEvent.run_id.in_(stale)).delete(
            synchronize_session=False
        )
        db.query(PipelineRunRecord).filter(PipelineRunRecord.id.in_(stale)).delete(
            synchronize_session=False
        )
        db.commit()
        return len(stale)
    except Exception as e:
        db.rollback()
        logger.warning("Could not prune runs: %s", e)
        return 0
    finally:
        db.close()
