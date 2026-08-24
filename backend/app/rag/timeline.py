"""
The processing timeline — what ran, in what order, for how long.

Every stage of ingestion and of a RAG query records itself here. The point is
not logging; the server already logs. The point is that both pipelines are
*assembled* from steps whose individual behaviour is invisible in the final
result:

* Ingestion runs for minutes across upload, Mistral-side indexing, text
  retrieval, N chunk extractions and a merge. Between "uploaded" and "draft
  ready" the UI would otherwise show nothing, which users read as a hang.
* A RAG answer draws on the optimiser, entity matching, graph traversal and
  library search. When the answer is wrong, "which of the four was wrong" is
  the only question worth asking, and it cannot be answered from the output.

Usage is a context manager, and nesting is automatic::

    trace = timeline.start("ingest", subject=f"document:{doc.id}")
    with timeline.stage("fetch_text") as st:
        text = fetch()
        st.set(chars=len(text))

Inside a ``stage`` block, any further ``stage`` becomes its child, because the
current trace and the current stage both live in context variables. That matters
because ``asyncio.to_thread`` and task creation propagate context variables, so
a chunk extracted in a worker thread still lands under the extraction stage it
belongs to rather than at the root.

Recording is best-effort by design: a timeline write that fails must never fail
the work it was describing.
"""

from __future__ import annotations

import json
import logging
import threading
import uuid
from contextlib import contextmanager
from contextvars import ContextVar
from datetime import datetime, timezone
from typing import Any, Iterator, Optional

from app.database import SessionLocal
from app.rag.models import RagEvent

logger = logging.getLogger(__name__)

#: The trace the current task/thread is contributing to, and the stage it is
#: nested inside. Unset outside a pipeline, which is what stops unrelated work
#: from writing rows.
CURRENT_TRACE: ContextVar[Optional[str]] = ContextVar("rag_trace", default=None)
CURRENT_STAGE: ContextVar[Optional[int]] = ContextVar("rag_stage", default=None)
CURRENT_SCOPE: ContextVar[str] = ContextVar("rag_scope", default="ingest")
CURRENT_SUBJECT: ContextVar[str] = ContextVar("rag_subject", default="")

# Sequence numbers are assigned in memory rather than by querying MAX(seq).
# Stages finish out of order — a fast child completes before its parent — so
# ordering has to come from when a row was *opened*, and a per-trace counter is
# the only cheap way to get that without a write lock on the table.
_seq_lock = threading.Lock()
_seq_counters: dict[str, int] = {}


def _next_seq(trace_id: str) -> int:
    with _seq_lock:
        value = _seq_counters.get(trace_id, 0) + 1
        _seq_counters[trace_id] = value
        # Long-lived processes ingest many documents; drop the oldest counters
        # rather than growing this map for the life of the server.
        if len(_seq_counters) > 500:
            for key in list(_seq_counters)[:100]:
                if key != trace_id:
                    _seq_counters.pop(key, None)
        return value


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _dumps(meta: Optional[dict]) -> Optional[str]:
    if not meta:
        return None
    try:
        return json.dumps(meta, default=str)[:4000]
    except Exception:
        return None


def start(scope: str, subject: str) -> str:
    """Open a trace and make it current. Returns the trace id."""
    trace_id = uuid.uuid4().hex[:16]
    CURRENT_TRACE.set(trace_id)
    CURRENT_STAGE.set(None)
    CURRENT_SCOPE.set(scope)
    CURRENT_SUBJECT.set(subject)
    return trace_id


def adopt(trace_id: str, scope: str, subject: str) -> None:
    """Continue an existing trace in this context.

    Used when work resumes in a different task from the one that opened the
    trace — a user committing a draft that was extracted minutes earlier, for
    instance — so the timeline stays one story rather than several.
    """
    CURRENT_TRACE.set(trace_id)
    CURRENT_STAGE.set(None)
    CURRENT_SCOPE.set(scope)
    CURRENT_SUBJECT.set(subject)


def ensure(scope: str, subject: str) -> str:
    """Open a trace only if none is current, and return whichever applies.

    A RAG query can be the whole of a request or one tool call inside a longer
    agent turn. When something upstream already opened a trace, joining it keeps
    the retrieval stages attached to the work that asked for them instead of
    scattering one-stage traces across the table.
    """
    existing = CURRENT_TRACE.get()
    if existing:
        return existing
    return start(scope, subject)


class Stage:
    """Handle for one open stage. Returned by :func:`stage`."""

    __slots__ = ("id", "trace_id", "_meta", "_message", "_status")

    def __init__(self, event_id: Optional[int], trace_id: str):
        self.id = event_id
        self.trace_id = trace_id
        self._meta: dict[str, Any] = {}
        self._message: Optional[str] = None
        self._status: Optional[str] = None

    def set(self, **meta: Any) -> None:
        """Attach metadata that explains what this stage actually did."""
        self._meta.update(meta)

    def note(self, message: str) -> None:
        """One line the timeline shows next to the stage name."""
        self._message = message

    def skip(self, message: str) -> None:
        """Mark the stage as deliberately not done, with the reason."""
        self._status = "skipped"
        self._message = message


@contextmanager
def stage(
    name: str,
    *,
    trace_id: Optional[str] = None,
    parent_id: Optional[int] = None,
    meta: Optional[dict] = None,
) -> Iterator[Stage]:
    """Record one stage, nesting under whatever stage is currently open.

    Failures are recorded and re-raised. Swallowing them here would turn a
    broken pipeline into a timeline full of green rows, which is the one thing
    this must never do.
    """
    resolved_trace = trace_id or CURRENT_TRACE.get()
    if not resolved_trace:
        # No trace open. The work still has to run, so hand back an inert
        # handle rather than forcing every call site to branch.
        yield Stage(None, "")
        return

    resolved_parent = parent_id if parent_id is not None else CURRENT_STAGE.get()
    event_id = _open(resolved_trace, name, resolved_parent, meta)
    handle = Stage(event_id, resolved_trace)

    token = CURRENT_STAGE.set(event_id) if event_id is not None else None
    started = _now()
    try:
        yield handle
    except Exception as e:
        _close(
            event_id,
            status="failed",
            message=f"{type(e).__name__}: {e}"[:1000],
            meta=handle._meta,
            started=started,
        )
        raise
    else:
        _close(
            event_id,
            status=handle._status or "ok",
            message=handle._message,
            meta=handle._meta,
            started=started,
        )
    finally:
        if token is not None:
            CURRENT_STAGE.reset(token)


def event(
    name: str,
    *,
    status: str = "ok",
    message: Optional[str] = None,
    meta: Optional[dict] = None,
    trace_id: Optional[str] = None,
) -> None:
    """Record a stage that has no duration — a decision, not a step."""
    resolved_trace = trace_id or CURRENT_TRACE.get()
    if not resolved_trace:
        return
    event_id = _open(resolved_trace, name, CURRENT_STAGE.get(), meta)
    _close(event_id, status=status, message=message, meta=meta, started=_now())


# ── Persistence ────────────────────────────────────────────────────────────


def _open(
    trace_id: str,
    name: str,
    parent_id: Optional[int],
    meta: Optional[dict],
) -> Optional[int]:
    """Write the row for a stage that has just begun. Returns its id."""
    if SessionLocal is None:
        return None
    db = SessionLocal()
    try:
        row = RagEvent(
            trace_id=trace_id,
            parent_id=parent_id,
            scope=CURRENT_SCOPE.get(),
            subject=CURRENT_SUBJECT.get() or "unknown",
            stage=name,
            status="running",
            meta=_dumps(meta),
            seq=_next_seq(trace_id),
            started_at=_now(),
        )
        db.add(row)
        db.commit()
        db.refresh(row)
        return row.id
    except Exception as e:
        logger.debug("Timeline: could not open stage %r: %s", name, e)
        return None
    finally:
        db.close()


def _close(
    event_id: Optional[int],
    *,
    status: str,
    message: Optional[str],
    meta: Optional[dict],
    started: datetime,
) -> None:
    """Stamp a stage with its outcome and how long it took."""
    if event_id is None or SessionLocal is None:
        return
    db = SessionLocal()
    try:
        row = db.query(RagEvent).filter(RagEvent.id == event_id).first()
        if not row:
            return
        ended = _now()
        row.status = status
        row.ended_at = ended
        row.duration_ms = max(0, int((ended - started).total_seconds() * 1000))
        if message:
            row.message = message[:2000]
        if meta:
            # Metadata is merged, not replaced: `stage(meta=...)` describes the
            # inputs and `handle.set(...)` describes the results, and the
            # timeline is far more useful showing both.
            existing = {}
            if row.meta:
                try:
                    existing = json.loads(row.meta) or {}
                except Exception:
                    existing = {}
            existing.update(meta)
            row.meta = _dumps(existing)
        db.commit()
    except Exception as e:
        logger.debug("Timeline: could not close stage %s: %s", event_id, e)
    finally:
        db.close()


# ── Reads ──────────────────────────────────────────────────────────────────


def _to_dict(row: RagEvent) -> dict:
    meta: dict = {}
    if row.meta:
        try:
            meta = json.loads(row.meta) or {}
        except Exception:
            meta = {}
    return {
        "id": row.id,
        "trace_id": row.trace_id,
        "parent_id": row.parent_id,
        "scope": row.scope,
        "subject": row.subject,
        "stage": row.stage,
        "status": row.status,
        "message": row.message,
        "meta": meta,
        "seq": row.seq,
        "started_at": row.started_at.isoformat() if row.started_at else None,
        "ended_at": row.ended_at.isoformat() if row.ended_at else None,
        "duration_ms": row.duration_ms,
    }


def events_for(trace_id: str) -> list[dict]:
    """Every stage in one trace, in the order the stages were opened."""
    if SessionLocal is None:
        return []
    db = SessionLocal()
    try:
        rows = (
            db.query(RagEvent)
            .filter(RagEvent.trace_id == trace_id)
            .order_by(RagEvent.seq)
            .all()
        )
        return [_to_dict(r) for r in rows]
    finally:
        db.close()


def traces(
    subject: Optional[str] = None,
    scope: Optional[str] = None,
    limit: int = 25,
) -> list[dict]:
    """Recent traces, newest first, summarised for a list view.

    A summary is derived from the rows rather than stored on a trace table:
    there is no trace entity, only its events, and inventing one would create a
    second thing to keep in step with the first.
    """
    if SessionLocal is None:
        return []
    db = SessionLocal()
    try:
        query = db.query(RagEvent)
        if subject:
            query = query.filter(RagEvent.subject == subject)
        if scope:
            query = query.filter(RagEvent.scope == scope)
        rows = query.order_by(RagEvent.id.desc()).limit(limit * 40).all()

        summaries: dict[str, dict] = {}
        for row in rows:
            entry = summaries.setdefault(
                row.trace_id,
                {
                    "trace_id": row.trace_id,
                    "scope": row.scope,
                    "subject": row.subject,
                    "stages": 0,
                    "failed": 0,
                    "running": 0,
                    "duration_ms": 0,
                    "started_at": None,
                    "ended_at": None,
                    "root_stage": None,
                },
            )
            entry["stages"] += 1
            if row.status == "failed":
                entry["failed"] += 1
            elif row.status == "running":
                entry["running"] += 1
            if row.parent_id is None:
                entry["root_stage"] = row.stage
                entry["duration_ms"] = row.duration_ms or entry["duration_ms"]
            started = row.started_at.isoformat() if row.started_at else None
            ended = row.ended_at.isoformat() if row.ended_at else None
            if started and (entry["started_at"] is None or started < entry["started_at"]):
                entry["started_at"] = started
            if ended and (entry["ended_at"] is None or ended > entry["ended_at"]):
                entry["ended_at"] = ended

        ordered = sorted(
            summaries.values(),
            key=lambda s: s["started_at"] or "",
            reverse=True,
        )
        for entry in ordered:
            entry["status"] = (
                "failed" if entry["failed"]
                else "running" if entry["running"]
                else "ok"
            )
        return ordered[:limit]
    finally:
        db.close()


def prune(keep_traces: int = 200) -> int:
    """Drop the oldest traces once the table grows past a useful size.

    Timelines are diagnostic, not a record of account: the last few hundred runs
    answer every question anyone actually asks, and an unbounded event table
    would eventually dominate a SQLite file that also holds the ontology.
    """
    if SessionLocal is None:
        return 0
    db = SessionLocal()
    try:
        from sqlalchemy import text

        trace_ids = [
            row[0]
            for row in db.execute(
                text(
                    "SELECT trace_id FROM rag_events "
                    "GROUP BY trace_id ORDER BY MAX(id) DESC"
                )
            )
        ]
        stale = trace_ids[keep_traces:]
        if not stale:
            return 0
        deleted = (
            db.query(RagEvent)
            .filter(RagEvent.trace_id.in_(stale))
            .delete(synchronize_session=False)
        )
        db.commit()
        logger.info("Timeline: pruned %d event(s) from %d trace(s)", deleted, len(stale))
        return deleted
    except Exception as e:
        logger.debug("Timeline prune failed: %s", e)
        return 0
    finally:
        db.close()
