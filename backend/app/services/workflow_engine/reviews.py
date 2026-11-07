"""
Human review — where a workflow waits for a person.

A ``human_review`` step opens a review and waits for its decision:

* **local engine** — the step awaits an in-process event, set when the decision
  arrives through the API.
* **Mistral Workflows** — the compiled workflow waits at workflow level with
  ``workflow.wait_condition`` (durable, no activity held open); the API
  delivers the decision as a ``review_decision`` signal.

Either way the review is a row here, so the inbox lists what is waiting, who
should decide it, and what was decided — and survives a restart.

Decisions: ``approve`` (continue), ``edit`` (continue with corrected values),
``reject`` (the workflow stops). A review left past its SLA times out and
follows the step's ``on_timeout``: ``fail`` (default), ``approve`` or ``escalate``.
"""

from __future__ import annotations

import asyncio
import json
import logging
from datetime import datetime, timezone
from typing import Any, Optional

from sqlalchemy import Column, DateTime, Integer, String, Text
from sqlalchemy.sql import func

from app.database import Base, SessionLocal

logger = logging.getLogger(__name__)

DECISIONS = ("approve", "edit", "reject")


class HumanReview(Base):
    __tablename__ = "human_reviews"
    #: The workspace that owns the row (app.auth.scoping).
    workspace_id = Column(String, nullable=True, index=True)

    id = Column(Integer, primary_key=True)
    execution_id = Column(String, nullable=False, index=True)
    workflow_name = Column(String, nullable=True, index=True)
    step_id = Column(String, nullable=False)
    #: local | mistral
    engine = Column(String, nullable=False, default="local")
    #: pending | approved | edited | rejected | timed_out | escalated
    status = Column(String, nullable=False, default="pending", index=True)
    title = Column(String, nullable=True)
    instructions = Column(Text, nullable=True)
    reviewer_role = Column(String, nullable=True)
    #: JSON: what the reviewer is shown (the reviewed step's output).
    payload = Column(Text, nullable=True)
    #: JSON list of fields the reviewer may correct.
    editable = Column(Text, nullable=True)
    comment = Column(Text, nullable=True)
    edits = Column(Text, nullable=True)
    decided_by = Column(String, nullable=True)
    sla_seconds = Column(Integer, nullable=True)
    created_at = Column(DateTime, server_default=func.now())
    decided_at = Column(DateTime, nullable=True)


#: (execution_id, step_id) → event set when a decision lands, for local runs.
_waiters: dict[tuple[str, str], asyncio.Event] = {}


def _dict(row: HumanReview) -> dict:
    def loads(raw, default):
        try:
            return json.loads(raw) if raw else default
        except Exception:
            return default

    return {
        "id": row.id, "execution_id": row.execution_id, "workflow_name": row.workflow_name,
        "step_id": row.step_id, "engine": row.engine, "status": row.status, "title": row.title,
        "instructions": row.instructions or "", "reviewer_role": row.reviewer_role,
        "payload": loads(row.payload, None), "editable": loads(row.editable, []),
        "comment": row.comment or "", "edits": loads(row.edits, {}), "decided_by": row.decided_by,
        "sla_seconds": row.sla_seconds,
        "created_at": row.created_at.isoformat() if row.created_at else None,
        "decided_at": row.decided_at.isoformat() if row.decided_at else None,
    }


def open_review(*, execution_id: str, step_id: str, workflow_name: Optional[str] = None,
                engine: str = "local", title: str = "", instructions: str = "",
                reviewer_role: str = "", payload: Any = None, editable: Optional[list] = None,
                sla_seconds: Optional[int] = None) -> dict:
    """Open (or return the already-open) review for this step of this execution."""
    db = SessionLocal()
    try:
        row = db.query(HumanReview).filter(HumanReview.execution_id == execution_id,
                                           HumanReview.step_id == step_id,
                                           HumanReview.status == "pending").first()
        if row is None:
            row = HumanReview(execution_id=execution_id, step_id=step_id, workflow_name=workflow_name,
                              engine=engine, title=title[:300] or f"Review: {step_id}",
                              instructions=instructions, reviewer_role=reviewer_role or None,
                              payload=json.dumps(payload, default=str)[:200000] if payload is not None else None,
                              editable=json.dumps(editable or []), sla_seconds=sla_seconds)
            db.add(row)
            db.commit()
            db.refresh(row)
        return _dict(row)
    finally:
        db.close()


def get(review_id: int) -> Optional[dict]:
    db = SessionLocal()
    try:
        row = db.query(HumanReview).filter(HumanReview.id == review_id).first()
        return _dict(row) if row else None
    finally:
        db.close()


def list_reviews(*, status: Optional[str] = "pending", execution_id: Optional[str] = None,
                 limit: int = 200) -> list[dict]:
    db = SessionLocal()
    try:
        q = db.query(HumanReview)
        if status:
            q = q.filter(HumanReview.status == status)
        if execution_id:
            q = q.filter(HumanReview.execution_id == execution_id)
        return [_dict(r) for r in q.order_by(HumanReview.id.desc()).limit(limit).all()]
    finally:
        db.close()


def _settle(review_id: int, status: str, *, comment: str = "", edits: Optional[dict] = None,
            decided_by: str = "") -> dict:
    db = SessionLocal()
    try:
        row = db.query(HumanReview).filter(HumanReview.id == review_id).first()
        if row is None:
            raise LookupError(f"Review {review_id} not found.")
        if row.status != "pending":
            raise PermissionError(f"Review {review_id} is already {row.status}.")
        row.status = status
        row.comment = comment or None
        row.edits = json.dumps(edits or {})
        row.decided_by = decided_by or None
        row.decided_at = datetime.now(timezone.utc)
        db.commit()
        db.refresh(row)
        return _dict(row)
    finally:
        db.close()


async def decide(review_id: int, decision: str, *, comment: str = "", edits: Optional[dict] = None,
                 decided_by: str = "") -> dict:
    """Record a decision and release whatever is waiting on it."""
    if decision not in DECISIONS:
        raise ValueError(f"decision must be one of {', '.join(DECISIONS)}.")
    review = get(review_id)
    if review is None:
        raise LookupError(f"Review {review_id} not found.")
    if decision == "edit":
        allowed = set(review["editable"] or [])
        unknown = [k for k in (edits or {}) if allowed and k not in allowed]
        if unknown:
            raise ValueError(f"These fields may not be edited: {', '.join(unknown)}.")
    status = {"approve": "approved", "edit": "edited", "reject": "rejected"}[decision]
    settled = _settle(review_id, status, comment=comment, edits=edits, decided_by=decided_by)

    if settled["engine"] == "monitor":
        return settled
    if settled["engine"] == "mistral":
        from app.services.workflow_engine.executions import send_signal

        delivered = await send_signal(settled["execution_id"], "review_decision", {
            "step_id": settled["step_id"], "decision": decision, "comment": comment,
            "edits": edits or {}, "decided_by": decided_by})
        settled["signal"] = delivered
    else:
        event = _waiters.get((settled["execution_id"], settled["step_id"]))
        if event is not None:
            event.set()
    return settled


async def wait(execution_id: str, step_id: str, review_id: int, timeout_seconds: float) -> dict:
    """Wait for this review's decision (local engine). Returns the settled review."""
    key = (execution_id, step_id)
    event = _waiters.setdefault(key, asyncio.Event())
    try:
        current = get(review_id)
        if current and current["status"] == "pending":
            try:
                await asyncio.wait_for(event.wait(), timeout=max(1.0, timeout_seconds))
            except asyncio.TimeoutError:
                try:
                    return _settle(review_id, "timed_out", comment="No decision within the SLA.")
                except PermissionError:
                    pass  # decided at the last moment
        return get(review_id) or {}
    finally:
        _waiters.pop(key, None)


def mark_escalated(review_id: int) -> None:
    db = SessionLocal()
    try:
        row = db.query(HumanReview).filter(HumanReview.id == review_id).first()
        if row is not None:
            row.status = "escalated"
            db.commit()
    finally:
        db.close()
