"""
Persistence for documents, drafts and rules.

Same shape as ``app.ontology.store``: every function opens and closes its own
session and returns plain dicts, never ORM instances. Callers are request
handlers and background tasks that share no transaction, and a detached
instance whose attributes raise on access is a worse bug than the extra query.

Reads degrade rather than raise, for the same reason they do in the ontology
store: an unavailable database must leave the rest of the platform working.
"""

from __future__ import annotations

import json
import logging
from contextlib import contextmanager
from typing import Any, Optional

from app.database import SessionLocal
from app.rag.models import ExtractionDraft, ExtractionRule, RagDocument, SystemAgent

logger = logging.getLogger(__name__)


@contextmanager
def _session():
    if SessionLocal is None:
        yield None
        return
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def _document_dict(row: RagDocument) -> dict:
    return {
        "id": row.id,
        "library_id": row.library_id,
        "mistral_doc_id": row.mistral_doc_id,
        "filename": row.filename,
        "mime_type": row.mime_type or "",
        "status": row.status,
        "error": row.error,
        "char_count": row.char_count or 0,
        "chunk_count": row.chunk_count or 0,
        "rules": row.rules or "",
        "trace_id": row.trace_id,
        "created_at": row.created_at.isoformat() if row.created_at else None,
        "updated_at": row.updated_at.isoformat() if row.updated_at else None,
    }


def _draft_dict(row: ExtractionDraft) -> dict:
    try:
        payload = json.loads(row.payload or "{}")
    except Exception:
        payload = {}
    return {
        "id": row.id,
        "document_id": row.document_id,
        "status": row.status,
        "model": row.model,
        "rules": row.rules or "",
        "entity_count": row.entity_count or 0,
        "relation_count": row.relation_count or 0,
        "entities": payload.get("entities") or [],
        "relations": payload.get("relations") or [],
        "created_at": row.created_at.isoformat() if row.created_at else None,
        "updated_at": row.updated_at.isoformat() if row.updated_at else None,
    }


# ── Documents ──────────────────────────────────────────────────────────────


def upsert_document(
    *,
    library_id: str,
    mistral_doc_id: str,
    filename: str,
    mime_type: str = "",
    rules: Optional[str] = None,
) -> dict:
    """Record an uploaded document, or refresh the row if it already exists.

    Re-uploading the same file to the same library resets it to ``uploaded``:
    the bytes changed, so whatever was extracted from the old ones is no longer
    a description of what is in the library.
    """
    with _session() as db:
        if db is None:
            raise RuntimeError("The database is unavailable.")
        row = (
            db.query(RagDocument)
            .filter(
                RagDocument.library_id == library_id,
                RagDocument.mistral_doc_id == mistral_doc_id,
            )
            .first()
        )
        if row:
            row.filename = filename or row.filename
            row.mime_type = mime_type or row.mime_type
            row.status = "uploaded"
            row.error = None
            if rules is not None:
                row.rules = rules
        else:
            row = RagDocument(
                library_id=library_id,
                mistral_doc_id=mistral_doc_id,
                filename=filename or mistral_doc_id,
                mime_type=mime_type,
                status="uploaded",
                rules=rules,
            )
            db.add(row)
        db.commit()
        db.refresh(row)
        return _document_dict(row)


def get_document(document_id: int) -> Optional[dict]:
    with _session() as db:
        if db is None:
            return None
        row = db.query(RagDocument).filter(RagDocument.id == document_id).first()
        return _document_dict(row) if row else None


def list_documents(
    library_id: Optional[str] = None,
    status: Optional[str] = None,
    limit: int = 500,
) -> list[dict]:
    with _session() as db:
        if db is None:
            return []
        query = db.query(RagDocument)
        if library_id:
            query = query.filter(RagDocument.library_id == library_id)
        if status:
            query = query.filter(RagDocument.status == status)
        rows = query.order_by(RagDocument.id.desc()).limit(limit).all()
        return [_document_dict(r) for r in rows]


def update_document(document_id: int, **fields: Any) -> Optional[dict]:
    """Patch a document row. Unknown keys are ignored rather than raising."""
    allowed = {
        "status", "error", "char_count", "chunk_count",
        "rules", "trace_id", "filename", "mime_type",
    }
    with _session() as db:
        if db is None:
            return None
        row = db.query(RagDocument).filter(RagDocument.id == document_id).first()
        if not row:
            return None
        for key, value in fields.items():
            if key in allowed:
                setattr(row, key, value)
        db.commit()
        db.refresh(row)
        return _document_dict(row)


def delete_document(document_id: int) -> Optional[dict]:
    """Remove a document row and its draft. The graph slice is the caller's job."""
    with _session() as db:
        if db is None:
            return None
        row = db.query(RagDocument).filter(RagDocument.id == document_id).first()
        if not row:
            return None
        payload = _document_dict(row)
        db.query(ExtractionDraft).filter(
            ExtractionDraft.document_id == document_id
        ).delete(synchronize_session=False)
        db.delete(row)
        db.commit()
        return payload


def counts_by_library() -> dict[str, dict]:
    """Per-library document counts by status, for the overview cards."""
    with _session() as db:
        if db is None:
            return {}
        rows = db.query(RagDocument.library_id, RagDocument.status).all()
        summary: dict[str, dict] = {}
        for library_id, status in rows:
            entry = summary.setdefault(library_id, {"documents": 0, "graphed": 0, "failed": 0, "pending": 0})
            entry["documents"] += 1
            if status == "graphed":
                entry["graphed"] += 1
            elif status in ("failed", "unsupported"):
                entry["failed"] += 1
            else:
                entry["pending"] += 1
        return summary


# ── Drafts ─────────────────────────────────────────────────────────────────


def save_draft(
    *,
    document_id: int,
    payload: dict,
    model: Optional[str] = None,
    rules: Optional[str] = None,
    status: str = "pending",
) -> dict:
    """Write the one draft for a document, replacing any previous proposal."""
    entities = payload.get("entities") or []
    relations = payload.get("relations") or []
    blob = json.dumps({"entities": entities, "relations": relations})

    with _session() as db:
        if db is None:
            raise RuntimeError("The database is unavailable.")
        row = (
            db.query(ExtractionDraft)
            .filter(ExtractionDraft.document_id == document_id)
            .first()
        )
        if not row:
            row = ExtractionDraft(document_id=document_id)
            db.add(row)
        row.payload = blob
        row.entity_count = len(entities)
        row.relation_count = len(relations)
        row.status = status
        if model is not None:
            row.model = model
        if rules is not None:
            row.rules = rules
        db.commit()
        db.refresh(row)
        return _draft_dict(row)


def get_draft(document_id: int) -> Optional[dict]:
    with _session() as db:
        if db is None:
            return None
        row = (
            db.query(ExtractionDraft)
            .filter(ExtractionDraft.document_id == document_id)
            .first()
        )
        return _draft_dict(row) if row else None


def set_draft_status(document_id: int, status: str) -> None:
    with _session() as db:
        if db is None:
            return
        row = (
            db.query(ExtractionDraft)
            .filter(ExtractionDraft.document_id == document_id)
            .first()
        )
        if row:
            row.status = status
            db.commit()


# ── Rules ──────────────────────────────────────────────────────────────────


def get_rules(library_id: str) -> str:
    with _session() as db:
        if db is None:
            return ""
        row = (
            db.query(ExtractionRule)
            .filter(ExtractionRule.library_id == library_id)
            .first()
        )
        return (row.rules if row else "") or ""


def get_system_agent(key: str) -> Optional[dict]:
    """The platform-owned agent registered under ``key``, if there is one."""
    with _session() as db:
        if db is None:
            return None
        row = db.query(SystemAgent).filter(SystemAgent.key == key).first()
        if not row:
            return None
        return {
            "key": row.key,
            "agent_id": row.agent_id,
            "name": row.name,
            "model": row.model,
        }


def set_system_agent(key: str, agent_id: str, name: str = "", model: str = "") -> dict:
    """Register a platform-owned agent, replacing any previous registration.

    Registration is what makes an agent non-deletable and what stops a second
    one being created on the next boot, so it is written before the agent is
    used rather than after.
    """
    with _session() as db:
        if db is None:
            raise RuntimeError("The database is unavailable.")
        row = db.query(SystemAgent).filter(SystemAgent.key == key).first()
        if not row:
            row = SystemAgent(key=key)
            db.add(row)
        row.agent_id = agent_id
        row.name = name or row.name
        row.model = model or row.model
        db.commit()
        return {"key": key, "agent_id": agent_id, "name": row.name, "model": row.model}


def system_agent_ids() -> set[str]:
    """Every protected agent id, for the delete guard."""
    with _session() as db:
        if db is None:
            return set()
        return {row[0] for row in db.query(SystemAgent.agent_id).all() if row[0]}


def clear_system_agent(key: str) -> None:
    """Forget a registration whose agent no longer exists upstream."""
    with _session() as db:
        if db is None:
            return
        db.query(SystemAgent).filter(SystemAgent.key == key).delete(
            synchronize_session=False
        )
        db.commit()


def set_rules(library_id: str, rules: str) -> dict:
    with _session() as db:
        if db is None:
            raise RuntimeError("The database is unavailable.")
        row = (
            db.query(ExtractionRule)
            .filter(ExtractionRule.library_id == library_id)
            .first()
        )
        if not row:
            row = ExtractionRule(library_id=library_id)
            db.add(row)
        row.rules = (rules or "").strip()[:4000]
        db.commit()
        return {"library_id": library_id, "rules": row.rules}
