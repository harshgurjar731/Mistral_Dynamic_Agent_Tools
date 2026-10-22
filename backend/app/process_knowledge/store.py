"""
Process documents and usage — reads and writes.

A document is always validated before it is stored, and the report is stored
with it. Invalid documents are kept (so they can be fixed in place, by hand or
with AI) but are never active, and only active documents reach a pipeline.

Versioning is per concept: each new valid upload becomes version N+1 and the
active one; older versions stay for history and diffing.
"""

from __future__ import annotations

import json
import logging
from typing import Any, Iterable, Optional

from sqlalchemy import func as sa_func

from app.database import SessionLocal
from app.process_knowledge import templates, validation
from app.process_knowledge.models import ProcessDocument, ProcessUsage

logger = logging.getLogger(__name__)


def _loads(raw: Optional[str], default: Any = None) -> Any:
    if not raw:
        return default
    try:
        return json.loads(raw)
    except Exception:
        return default


def _title(doc: Optional[dict], fallback: str) -> str:
    process = (doc or {}).get("process") if isinstance((doc or {}).get("process"), dict) else {}
    return str(process.get("name") or process.get("id") or (doc or {}).get("title") or fallback)[:200]


def to_dict(row: ProcessDocument, *, content: bool = True) -> dict:
    report = _loads(row.report, {}) or {}
    out = {
        "id": row.id,
        "concept_id": row.concept_id,
        "version": row.version,
        "is_active": bool(row.is_active),
        "title": row.title,
        "status": row.status,
        "source": row.source,
        "filename": row.filename,
        "template_id": row.template_id,
        "template_version": row.template_version,
        "summary": report.get("summary"),
        "error_count": len(report.get("errors") or []),
        "warning_count": len(report.get("warnings") or []),
        "stats": report.get("stats") or {},
        "created_at": row.created_at.isoformat() if row.created_at else None,
        "updated_at": row.updated_at.isoformat() if row.updated_at else None,
    }
    if content:
        out["content"] = _loads(row.content)
        out["raw"] = row.raw
        out["report"] = report
    return out


def _session():
    if SessionLocal is None:
        raise RuntimeError("The process knowledge database is unavailable.")
    return SessionLocal()


# ── Documents ──────────────────────────────────────────────────────────────


def template_for_document(concept_id: Optional[str], classification: Optional[dict]) -> dict:
    """The template a document is checked against: its process's, or — for an
    unfiled one — that of where it was classified."""
    scope = concept_id or (classification or {}).get("concept_id")
    return templates.template_for(scope)


def save_document(raw: bytes | str | dict, *, concept_id: Optional[str], filename: str = "",
                  source: str = "upload", template_id: Optional[int] = None,
                  replace_id: Optional[int] = None,
                  classification: Optional[dict] = None) -> dict:
    """Validate and store one document. Returns ``{document, report}``.

    Checked against the template of ``concept_id`` (the process it is filed
    under), or for an unfiled upload, of ``classification["concept_id"]`` —
    each falling back up the classification to the global template.
    ``template_id`` forces one specific template instead.

    ``replace_id`` overwrites an existing *invalid* document in place (its
    re-upload or AI fix) instead of adding a version; a valid result is then
    promoted to the next version number and made active.
    """
    if replace_id and classification is None and not concept_id:
        # A re-upload or fix of an unfiled document keeps where it was classified.
        classification = _stored_classification(replace_id)
    template = (templates.get_template(template_id) if template_id
                else template_for_document(concept_id, classification))
    if template is None:
        raise LookupError(f"Template {template_id} not found.")
    report = validation.validate(raw, template, concept_id=concept_id,
                                 classification=classification)
    doc = report["document"]
    raw_text = raw if isinstance(raw, str) else (
        json.dumps(raw, indent=2) if isinstance(raw, dict)
        else raw.decode("utf-8-sig", errors="replace"))

    db = _session()
    try:
        row: Optional[ProcessDocument] = None
        if replace_id:
            row = db.query(ProcessDocument).filter(ProcessDocument.id == replace_id).first()
            if row is None:
                raise LookupError(f"Document {replace_id} not found.")
            if concept_id is None:
                concept_id = row.concept_id
        if row is None:
            row = ProcessDocument(concept_id=concept_id)
            db.add(row)

        row.concept_id = concept_id
        row.raw = raw_text
        row.content = json.dumps(doc) if doc is not None else None
        row.report = json.dumps(validation.public_report(report))
        row.status = "valid" if report["valid"] else "invalid"
        row.title = _title(doc, filename or "Process document")
        row.template_id = template.get("id")
        row.template_version = template.get("version")
        row.source = source
        row.filename = filename or row.filename

        if report["valid"] and concept_id:
            # Flushed first so the row has an id to exclude — otherwise the
            # query's autoflush counts this row as its own predecessor.
            db.flush()
            latest = db.query(sa_func.max(ProcessDocument.version)).filter(
                ProcessDocument.concept_id == concept_id,
                ProcessDocument.status != "invalid",
                ProcessDocument.id != row.id,
            ).scalar()
            row.version = (latest or 0) + 1
            db.query(ProcessDocument).filter(
                ProcessDocument.concept_id == concept_id, ProcessDocument.is_active.is_(True),
            ).update({ProcessDocument.is_active: False}, synchronize_session=False)
            row.is_active = True
        else:
            row.is_active = False
            if not row.version:
                row.version = 1

        db.commit()
        db.refresh(row)
        return {"document": to_dict(row), "report": validation.public_report(report)}
    finally:
        db.close()


def get_document(document_id: int, *, content: bool = True) -> Optional[dict]:
    db = _session()
    try:
        row = db.query(ProcessDocument).filter(ProcessDocument.id == document_id).first()
        return to_dict(row, content=content) if row else None
    finally:
        db.close()


def get_documents(ids: Iterable[int]) -> list[dict]:
    ids = [int(i) for i in ids if str(i).isdigit()]
    if not ids:
        return []
    db = _session()
    try:
        rows = db.query(ProcessDocument).filter(ProcessDocument.id.in_(ids)).all()
        by_id = {r.id: to_dict(r) for r in rows}
        return [by_id[i] for i in ids if i in by_id]
    finally:
        db.close()


def list_documents(concept_id: Optional[str] = None, *, concept_ids: Optional[list[str]] = None,
                   unfiled: bool = False, content: bool = False) -> list[dict]:
    db = _session()
    try:
        q = db.query(ProcessDocument)
        if concept_id:
            q = q.filter(ProcessDocument.concept_id == concept_id)
        elif concept_ids is not None:
            q = q.filter(ProcessDocument.concept_id.in_(concept_ids or ["__none__"]))
        elif unfiled:
            q = q.filter(ProcessDocument.concept_id.is_(None))
        rows = q.order_by(ProcessDocument.concept_id, ProcessDocument.version.desc(),
                          ProcessDocument.id.desc()).all()
        return [to_dict(r, content=content) for r in rows]
    finally:
        db.close()


def active_for(concept_ids: Iterable[str]) -> dict[str, dict]:
    """The active (valid) document of each concept that has one."""
    ids = [c for c in concept_ids if c]
    if not ids:
        return {}
    db = _session()
    try:
        rows = db.query(ProcessDocument).filter(
            ProcessDocument.concept_id.in_(ids), ProcessDocument.is_active.is_(True),
            ProcessDocument.status == "valid",
        ).all()
        return {r.concept_id: to_dict(r) for r in rows}
    finally:
        db.close()


def activate(document_id: int) -> dict:
    db = _session()
    try:
        row = db.query(ProcessDocument).filter(ProcessDocument.id == document_id).first()
        if not row:
            raise LookupError(f"Document {document_id} not found.")
        if row.status != "valid":
            raise ValueError("Only a valid document can be made active — fix it first.")
        if not row.concept_id:
            raise ValueError("File the document under a process before making it active.")
        db.query(ProcessDocument).filter(
            ProcessDocument.concept_id == row.concept_id, ProcessDocument.is_active.is_(True),
        ).update({ProcessDocument.is_active: False}, synchronize_session=False)
        row.is_active = True
        db.commit()
        db.refresh(row)
        return to_dict(row)
    finally:
        db.close()


def file_document(document_id: int, concept_id: str) -> dict:
    """Move an unfiled (orchestration) upload under a process, re-validating
    it there — placement checks only make sense once it has a place."""
    existing = get_document(document_id)
    if not existing:
        raise LookupError(f"Document {document_id} not found.")
    raw = existing["content"] if existing.get("content") is not None else existing["raw"]
    result = save_document(raw, concept_id=concept_id, filename=existing.get("filename") or "",
                           source=existing["source"], template_id=existing.get("template_id"),
                           replace_id=document_id)
    return result


def delete_document(document_id: int, *, force: bool = False) -> dict:
    """Delete one document. Refused while builds recorded using it, unless forced."""
    db = _session()
    try:
        row = db.query(ProcessDocument).filter(ProcessDocument.id == document_id).first()
        if not row:
            raise LookupError(f"Document {document_id} not found.")
        users = db.query(ProcessUsage.subject_type, ProcessUsage.subject_id,
                         ProcessUsage.subject_name).filter(
            ProcessUsage.document_id == document_id).distinct().all()
        if users and not force:
            names = ", ".join(sorted({f"{t} {n or s}" for t, s, n in users}))[:400]
            raise PermissionError(
                f"Used by {len(users)} build(s): {names}. Delete with force=true to remove it and "
                f"its usage history.")
        was_active, concept_id = row.is_active, row.concept_id
        db.query(ProcessUsage).filter(ProcessUsage.document_id == document_id).delete(
            synchronize_session=False)
        db.delete(row)
        db.flush()
        # Keep a process usable: promote the newest remaining valid version.
        if was_active and concept_id:
            nxt = db.query(ProcessDocument).filter(
                ProcessDocument.concept_id == concept_id, ProcessDocument.status == "valid",
            ).order_by(ProcessDocument.version.desc()).first()
            if nxt:
                nxt.is_active = True
        db.commit()
        return {"deleted": document_id, "usage_removed": len(users)}
    finally:
        db.close()


def count_for_concepts(concept_ids: list[str]) -> int:
    if SessionLocal is None or not concept_ids:
        return 0
    db = SessionLocal()
    try:
        return db.query(ProcessDocument).filter(ProcessDocument.concept_id.in_(concept_ids)).count()
    finally:
        db.close()


def delete_for_concepts(concept_ids: list[str]) -> int:
    if SessionLocal is None or not concept_ids:
        return 0
    db = SessionLocal()
    try:
        doc_ids = [r[0] for r in db.query(ProcessDocument.id).filter(
            ProcessDocument.concept_id.in_(concept_ids)).all()]
        if doc_ids:
            db.query(ProcessUsage).filter(ProcessUsage.document_id.in_(doc_ids)).delete(
                synchronize_session=False)
        removed = db.query(ProcessDocument).filter(
            ProcessDocument.concept_id.in_(concept_ids)).delete(synchronize_session=False)
        db.commit()
        return removed
    finally:
        db.close()


def _stored_classification(document_id: int) -> Optional[dict]:
    db = _session()
    try:
        row = db.query(ProcessDocument.report).filter(ProcessDocument.id == document_id).first()
        return ((_loads(row[0], {}) or {}).get("classification")) if row else None
    finally:
        db.close()


def revalidate_all() -> dict:
    """Re-check every stored document against the template that now applies to it.

    Run after any template change: templates are scoped and inherited, so one
    change at an industry can move every process under it. A previously valid
    document that now fails becomes ``stale`` and stops being active — it is
    never deleted, and a stale one that passes again is restored, and made
    active again when its process has no active version.
    """
    db = _session()
    counts = {"checked": 0, "valid": 0, "stale": 0, "invalid": 0}
    cache: dict[Optional[str], dict] = {}
    try:
        for row in db.query(ProcessDocument).all():
            counts["checked"] += 1
            classification = (_loads(row.report, {}) or {}).get("classification")
            scope = row.concept_id or (classification or {}).get("concept_id")
            if scope not in cache:
                cache[scope] = templates.template_for(scope)
            template = cache[scope]
            source = _loads(row.content) if row.content else row.raw
            report = validation.validate(source, template, concept_id=row.concept_id,
                                         classification=classification)
            row.report = json.dumps(validation.public_report(report))
            row.template_id = template.get("id")
            row.template_version = template.get("version")
            if report["valid"]:
                if row.status == "stale":
                    row.status = "valid"
                elif row.status == "invalid":
                    row.status = "valid"
                    if report["document"] is not None:
                        row.content = json.dumps(report["document"])
            else:
                row.status = "stale" if row.status == "valid" else row.status
                if row.status == "stale":
                    row.is_active = False
            counts[row.status if row.status in counts else "invalid"] += 1
        db.flush()

        # A process left with no active version gets its newest valid one back.
        concepts = {r[0] for r in db.query(ProcessDocument.concept_id)
                    .filter(ProcessDocument.concept_id.isnot(None)).distinct().all()}
        for concept_id in concepts:
            q = db.query(ProcessDocument).filter(ProcessDocument.concept_id == concept_id)
            if q.filter(ProcessDocument.is_active.is_(True)).first():
                continue
            newest = q.filter(ProcessDocument.status == "valid").order_by(
                ProcessDocument.version.desc()).first()
            if newest:
                newest.is_active = True
        db.commit()
        return counts
    finally:
        db.close()


def documents_by_concept_counts() -> dict[str, dict]:
    """``{concept_id: {total, valid, invalid, stale, active_id, active_version}}``."""
    if SessionLocal is None:
        return {}
    db = SessionLocal()
    try:
        out: dict[str, dict] = {}
        for row in db.query(ProcessDocument).filter(ProcessDocument.concept_id.isnot(None)).all():
            entry = out.setdefault(row.concept_id, {"total": 0, "valid": 0, "invalid": 0,
                                                    "stale": 0, "active_id": None,
                                                    "active_version": None, "active_title": None})
            entry["total"] += 1
            entry[row.status] = entry.get(row.status, 0) + 1
            if row.is_active:
                entry["active_id"] = row.id
                entry["active_version"] = row.version
                entry["active_title"] = row.title
        return out
    finally:
        db.close()


# ── Usage ──────────────────────────────────────────────────────────────────


def record_usage(rows: list[dict]) -> int:
    if SessionLocal is None or not rows:
        return 0
    db = SessionLocal()
    try:
        for r in rows:
            db.add(ProcessUsage(
                document_id=int(r["document_id"]), document_version=r.get("document_version"),
                concept_id=r.get("concept_id"), subject_type=r["subject_type"],
                subject_id=str(r["subject_id"]), subject_name=r.get("subject_name"),
                layer=r["layer"], element=r["element"], how=(r.get("how") or "")[:1000],
            ))
        db.commit()
        return len(rows)
    except Exception as e:
        db.rollback()
        logger.warning("Could not record process usage: %s", e)
        return 0
    finally:
        db.close()


def _usage_dict(row: ProcessUsage) -> dict:
    return {
        "document_id": row.document_id, "document_version": row.document_version,
        "concept_id": row.concept_id, "subject_type": row.subject_type,
        "subject_id": row.subject_id, "subject_name": row.subject_name, "layer": row.layer,
        "element": row.element, "how": row.how,
        "created_at": row.created_at.isoformat() if row.created_at else None,
    }


def usage(*, document_id: Optional[int] = None, concept_ids: Optional[list[str]] = None,
          subject_type: Optional[str] = None, subject_id: Optional[str] = None,
          limit: int = 500) -> list[dict]:
    if SessionLocal is None:
        return []
    db = SessionLocal()
    try:
        q = db.query(ProcessUsage)
        if document_id:
            q = q.filter(ProcessUsage.document_id == document_id)
        if concept_ids is not None:
            q = q.filter(ProcessUsage.concept_id.in_(concept_ids or ["__none__"]))
        if subject_type:
            q = q.filter(ProcessUsage.subject_type == subject_type)
        if subject_id:
            q = q.filter(ProcessUsage.subject_id == subject_id)
        return [_usage_dict(r) for r in q.order_by(ProcessUsage.id.desc()).limit(limit).all()]
    finally:
        db.close()


def usage_summary(concept_ids: Optional[list[str]] = None) -> dict[str, dict]:
    """Per concept: distinct agents and workflows built with it, and when last."""
    out: dict[str, dict] = {}
    for row in usage(concept_ids=concept_ids, limit=5000):
        cid = row["concept_id"]
        if not cid:
            continue
        entry = out.setdefault(cid, {"agents": set(), "workflows": set(), "last_used": None})
        entry["agents" if row["subject_type"] == "agent" else "workflows"].add(row["subject_id"])
        if row["created_at"] and (not entry["last_used"] or row["created_at"] > entry["last_used"]):
            entry["last_used"] = row["created_at"]
    return {
        cid: {"agents": len(v["agents"]), "workflows": len(v["workflows"]),
              "last_used": v["last_used"]}
        for cid, v in out.items()
    }
