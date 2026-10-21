"""
SQLite persistence for workflow revisions and versions.

Synchronous on purpose — callers on the event loop go through
``asyncio.to_thread``. Rows are returned as plain dicts so nothing outside this
module holds a live ORM object past its session.
"""

from __future__ import annotations

import json
import logging
import uuid
from datetime import datetime, timezone
from typing import Any, Optional

from sqlalchemy import func

from app.config import settings
from app.database import SessionLocal
from app.workflow_revisions.models import (
    OPEN_STATUSES,
    WorkflowRevisionRecord,
    WorkflowVersionRecord,
)

logger = logging.getLogger(__name__)

#: JSON columns on a revision, with the value an empty one reads as.
_REVISION_JSON = {
    "focus_step_ids": [],
    "operations": [],
    "notes": [],
    "diff": None,
    "validation": None,
    "proposed_definition": None,
    "trace": [],
}

# Versions kept per workflow: WORKFLOW_MAX_VERSIONS (Settings page). Older ones
# are pruned, oldest first.


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


def _dumps(value: Any) -> str:
    return json.dumps(value, default=str)


# ── Revisions ───────────────────────────────────────────────────────────────


def revision_to_dict(row: WorkflowRevisionRecord, *, with_definition: bool = True) -> dict:
    out = {
        "id": row.id,
        "workflow_name": row.workflow_name,
        "status": row.status,
        "origin": row.origin,
        "instruction": row.instruction,
        "base_hash": row.base_hash,
        "summary": row.summary,
        "clarification": row.clarification,
        "reasoning": row.reasoning,
        "error": row.error,
        "applied_version": row.applied_version,
        "created_at": _iso(row.created_at),
        "resolved_at": _iso(row.resolved_at),
    }
    for key, default in _REVISION_JSON.items():
        if key == "proposed_definition" and not with_definition:
            continue
        out[key] = _loads(getattr(row, key), default)
    return out


def create_revision(workflow_name: str, *, instruction: str, origin: str = "editor",
                    focus_step_ids: Optional[list[str]] = None, **fields: Any) -> dict:
    row = WorkflowRevisionRecord(
        id=uuid.uuid4().hex,
        workflow_name=workflow_name,
        instruction=instruction,
        origin=origin,
        focus_step_ids=_dumps(focus_step_ids or []),
        created_at=_now(),
    )
    _assign(row, fields)
    with SessionLocal() as db:
        db.add(row)
        db.commit()
        db.refresh(row)
        return revision_to_dict(row)


def update_revision(revision_id: str, **fields: Any) -> Optional[dict]:
    with SessionLocal() as db:
        row = db.get(WorkflowRevisionRecord, revision_id)
        if row is None:
            return None
        _assign(row, fields)
        db.commit()
        db.refresh(row)
        return revision_to_dict(row)


def _assign(row: WorkflowRevisionRecord, fields: dict) -> None:
    for key, value in fields.items():
        if key in _REVISION_JSON:
            value = None if value is None else _dumps(value)
        setattr(row, key, value)
    if fields.get("status") in ("applied", "discarded", "superseded") and row.resolved_at is None:
        row.resolved_at = _now()


def get_revision(revision_id: str) -> Optional[dict]:
    with SessionLocal() as db:
        row = db.get(WorkflowRevisionRecord, revision_id)
        return revision_to_dict(row) if row else None


def list_revisions(workflow_name: str, *, limit: int = 50,
                   with_definition: bool = False) -> list[dict]:
    """The most recent ``limit`` revisions, oldest first — conversation order."""
    with SessionLocal() as db:
        rows = (
            db.query(WorkflowRevisionRecord)
            .filter(WorkflowRevisionRecord.workflow_name == workflow_name)
            .order_by(WorkflowRevisionRecord.created_at.desc(), WorkflowRevisionRecord.id.desc())
            .limit(limit)
            .all()
        )
        return [revision_to_dict(r, with_definition=with_definition) for r in reversed(rows)]


def supersede_open(workflow_name: str, *, except_id: Optional[str] = None) -> int:
    """Close every open proposal for a workflow whose definition just changed.

    Their diffs were computed against a definition that no longer exists, so
    applying one would silently undo whatever changed it.
    """
    with SessionLocal() as db:
        rows = (
            db.query(WorkflowRevisionRecord)
            .filter(WorkflowRevisionRecord.workflow_name == workflow_name,
                    WorkflowRevisionRecord.status.in_(OPEN_STATUSES))
            .all()
        )
        count = 0
        for row in rows:
            if row.id == except_id:
                continue
            row.status = "superseded"
            row.resolved_at = _now()
            count += 1
        db.commit()
        return count


# ── Versions ────────────────────────────────────────────────────────────────


def _version_to_dict(row: WorkflowVersionRecord, *, with_definition: bool) -> dict:
    out = {
        "version_no": row.version_no,
        "workflow_name": row.workflow_name,
        "semantic_hash": row.semantic_hash,
        "source": row.source,
        "label": row.label,
        "revision_id": row.revision_id,
        "step_count": row.step_count,
        "created_at": _iso(row.created_at),
    }
    if with_definition:
        out["definition"] = _loads(row.definition_json, None)
    return out


def _definition_payload(definition: Any) -> dict:
    """A definition as stored in a version — without the record's own columns."""
    return definition.model_dump(mode="json", exclude={"created_at", "updated_at"})


def record_version(workflow_name: str, definition: Any, *, source: str, label: str,
                   revision_id: Optional[str] = None) -> Optional[int]:
    """Record ``definition`` as the workflow's newest version.

    Returns the new version number, or the latest one unchanged when the
    definition is semantically identical to it — moving a node on the canvas
    is not a version.
    """
    digest = definition.semantic_hash()
    with SessionLocal() as db:
        latest = (
            db.query(WorkflowVersionRecord)
            .filter(WorkflowVersionRecord.workflow_name == workflow_name)
            .order_by(WorkflowVersionRecord.version_no.desc())
            .first()
        )
        if latest is not None and latest.semantic_hash == digest:
            return latest.version_no

        number = (latest.version_no if latest else 0) + 1
        db.add(WorkflowVersionRecord(
            workflow_name=workflow_name,
            version_no=number,
            definition_json=_dumps(_definition_payload(definition)),
            semantic_hash=digest,
            source=source,
            label=label[:500],
            revision_id=revision_id,
            step_count=len(definition.steps),
            created_at=_now(),
        ))
        db.flush()
        _prune(db, workflow_name)
        db.commit()
        return number


def _prune(db, workflow_name: str) -> None:
    rows = (
        db.query(WorkflowVersionRecord.id)
        .filter(WorkflowVersionRecord.workflow_name == workflow_name)
        .order_by(WorkflowVersionRecord.version_no.desc())
        .offset(max(1, settings.WORKFLOW_MAX_VERSIONS))
        .all()
    )
    if rows:
        db.query(WorkflowVersionRecord).filter(
            WorkflowVersionRecord.id.in_([r.id for r in rows])
        ).delete(synchronize_session=False)


def ensure_baseline(workflow_name: str, definition: Any) -> None:
    """Record the definition as it stands before its first tracked change.

    Workflows created before versions existed — and every freshly planned one
    — have no history; without a baseline, the first change could not be undone.
    """
    with SessionLocal() as db:
        exists = db.query(func.count(WorkflowVersionRecord.id)).filter(
            WorkflowVersionRecord.workflow_name == workflow_name
        ).scalar()
    if not exists:
        label = "Planned" if str(getattr(definition.source, "value", definition.source)) == "planner" \
            else "Original"
        record_version(workflow_name, definition, source="baseline", label=label)


def list_versions(workflow_name: str) -> list[dict]:
    """Newest first, without definitions."""
    with SessionLocal() as db:
        rows = (
            db.query(WorkflowVersionRecord)
            .filter(WorkflowVersionRecord.workflow_name == workflow_name)
            .order_by(WorkflowVersionRecord.version_no.desc())
            .all()
        )
        return [_version_to_dict(r, with_definition=False) for r in rows]


def get_version(workflow_name: str, version_no: int) -> Optional[dict]:
    with SessionLocal() as db:
        row = (
            db.query(WorkflowVersionRecord)
            .filter(WorkflowVersionRecord.workflow_name == workflow_name,
                    WorkflowVersionRecord.version_no == version_no)
            .first()
        )
        return _version_to_dict(row, with_definition=True) if row else None


def forget_workflow(workflow_name: str) -> None:
    """Drop a deleted workflow's revisions and versions.

    A workflow planned again under the same name must not inherit them.
    """
    try:
        with SessionLocal() as db:
            db.query(WorkflowRevisionRecord).filter(
                WorkflowRevisionRecord.workflow_name == workflow_name).delete()
            db.query(WorkflowVersionRecord).filter(
                WorkflowVersionRecord.workflow_name == workflow_name).delete()
            db.commit()
    except Exception as e:  # noqa: BLE001 — history cleanup never blocks a delete
        logger.warning("Could not clear revision history for '%s': %s", workflow_name, e)
