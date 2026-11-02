"""
Knowledge store — items, sources and usage.

Every function opens its own session and degrades rather than raises on reads,
like the catalog store: knowledge improves a build, it never makes one possible.
"""

from __future__ import annotations

import hashlib
import json
import logging
from contextlib import contextmanager
from typing import Any, Iterable, Optional

from app.database import SessionLocal
from app.knowledge.models import KnowledgeItem, KnowledgeSource

logger = logging.getLogger(__name__)

KINDS = ("reference", "guidance")
REFERENCE_CATEGORIES = ("definition", "regulation", "process", "metric", "risk",
                        "best_practice", "glossary")
GUIDANCE_CATEGORIES = ("archetype", "agent_design", "instruction_style", "workflow_pattern",
                       "tool_connector", "governance", "model_choice", "naming", "data_handling",
                       "anti_pattern", "best_practice")
STRENGTHS = ("must", "should", "may", "avoid")
AUDIENCES = ("builder", "runtime", "both")
SUBJECTS = ("agent", "workflow", "both")
STATUSES = ("proposed", "active", "retired", "conflicting")
CONDITION_OPS = ("eq", "ne", "in", "not_in", "exists", "contains")


class KnowledgeError(ValueError):
    """A request the store refuses, with a message worth showing."""


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


def _loads(raw: Optional[str], default: Any) -> Any:
    if not raw:
        return default
    try:
        value = json.loads(raw)
        return value if isinstance(value, type(default)) else default
    except Exception:
        return default


def _dumps(value: Any) -> Optional[str]:
    if value is None or value == [] or value == {}:
        return None
    return json.dumps(value)


def content_hash(title: str, body: str) -> str:
    text = " ".join((title + " " + body).lower().split())
    return hashlib.sha256(text.encode("utf-8")).hexdigest()[:32]


def to_dict(item: KnowledgeItem, *, embedding: bool = False) -> dict:
    out = {
        "id": item.id,
        "kind": item.kind,
        "category": item.category,
        "concept_id": item.concept_id,
        "title": item.title,
        "body": item.body,
        "tags": _loads(item.tags, []),
        "audience": item.audience,
        "subject": item.subject,
        "strength": item.strength,
        "conditions": _loads(item.conditions, []),
        "effect": _loads(item.effect, {}),
        "layers": _loads(item.layers, []),
        "rationale": item.rationale or "",
        "status": item.status,
        "confidence": item.confidence,
        "origin": item.origin,
        "source_id": item.source_id,
        "source_ref": _loads(item.source_ref, {}),
        "as_of": item.as_of,
        "stats": {"used": item.used or 0, "accepted_builds": item.accepted_builds or 0,
                  "rolled_back_builds": item.rolled_back_builds or 0},
        "has_embedding": bool(item.embedding),
    }
    if embedding:
        out["embedding"] = _loads(item.embedding, [])
    return out


# ── Validation ─────────────────────────────────────────────────────────────


def normalise(data: dict) -> dict:
    """Check and coerce one item's fields. Raises KnowledgeError with the reason."""
    kind = str(data.get("kind") or "reference").strip().lower()
    if kind not in KINDS:
        raise KnowledgeError(f"kind must be one of {', '.join(KINDS)}.")
    category = str(data.get("category") or ("definition" if kind == "reference" else "best_practice")).strip().lower()
    allowed = REFERENCE_CATEGORIES if kind == "reference" else GUIDANCE_CATEGORIES
    if category not in allowed:
        raise KnowledgeError(f"category '{category}' is not valid for {kind}; use one of {', '.join(allowed)}.")
    title = str(data.get("title") or "").strip()
    body = str(data.get("body") or "").strip()
    if not title or not body:
        raise KnowledgeError("title and body are both required.")
    audience = str(data.get("audience") or ("runtime" if kind == "reference" else "builder")).strip().lower()
    if audience not in AUDIENCES:
        raise KnowledgeError(f"audience must be one of {', '.join(AUDIENCES)}.")
    subject = str(data.get("subject") or "both").strip().lower()
    if subject not in SUBJECTS:
        raise KnowledgeError(f"subject must be one of {', '.join(SUBJECTS)}.")
    strength = data.get("strength")
    if strength is not None:
        strength = str(strength).strip().lower() or None
        if strength and strength not in STRENGTHS:
            raise KnowledgeError(f"strength must be one of {', '.join(STRENGTHS)}.")
    if kind == "guidance" and not strength:
        strength = "should"
    status = str(data.get("status") or "active").strip().lower()
    if status not in STATUSES:
        raise KnowledgeError(f"status must be one of {', '.join(STATUSES)}.")

    conditions = data.get("conditions") or []
    if not isinstance(conditions, list):
        raise KnowledgeError("conditions must be a list of {attr, op, value}.")
    for c in conditions:
        if not isinstance(c, dict) or not c.get("attr") or c.get("op", "eq") not in CONDITION_OPS:
            raise KnowledgeError(f"Invalid condition {c!r}: needs attr and an op in {', '.join(CONDITION_OPS)}.")
    effect = data.get("effect") or {}
    if not isinstance(effect, dict):
        raise KnowledgeError("effect must be an object.")
    tags = data.get("tags") or []
    if isinstance(tags, str):
        tags = [t.strip() for t in tags.split(",") if t.strip()]
    layers = data.get("layers") or []
    if isinstance(layers, str):
        layers = [layers]

    concept_id = data.get("concept_id") or None
    if concept_id:
        from app.catalog import store as catalog_store

        if not catalog_store.get_concept(concept_id):
            raise KnowledgeError(f"Concept '{concept_id}' does not exist.")

    return {
        "kind": kind, "category": category, "concept_id": concept_id, "title": title, "body": body,
        "tags": [str(t) for t in tags], "audience": audience, "subject": subject, "strength": strength,
        "conditions": conditions, "effect": effect, "layers": [str(v) for v in layers],
        "rationale": str(data.get("rationale") or "").strip(), "status": status,
        "confidence": data.get("confidence"), "origin": str(data.get("origin") or "user"),
        "source_id": data.get("source_id"), "source_ref": data.get("source_ref") or {},
        "as_of": data.get("as_of"),
    }


def _apply(item: KnowledgeItem, clean: dict) -> None:
    item.kind = clean["kind"]
    item.category = clean["category"]
    item.concept_id = clean["concept_id"]
    item.title = clean["title"]
    item.body = clean["body"]
    item.tags = _dumps(clean["tags"])
    item.audience = clean["audience"]
    item.subject = clean["subject"]
    item.strength = clean["strength"]
    item.conditions = _dumps(clean["conditions"])
    item.effect = _dumps(clean["effect"])
    item.layers = _dumps(clean["layers"])
    item.rationale = clean["rationale"] or None
    item.status = clean["status"]
    item.confidence = clean["confidence"]
    item.origin = clean["origin"]
    item.source_id = clean["source_id"]
    item.source_ref = _dumps(clean["source_ref"])
    item.as_of = clean["as_of"]
    item.content_hash = content_hash(clean["title"], clean["body"])


# ── Items ──────────────────────────────────────────────────────────────────


def create_item(data: dict) -> dict:
    clean = normalise(data)
    with _session() as db:
        if db is None:
            raise KnowledgeError("The knowledge database is unavailable.")
        item = KnowledgeItem()
        _apply(item, clean)
        db.add(item)
        db.commit()
        db.refresh(item)
        return to_dict(item)


def update_item(item_id: int, data: dict) -> dict:
    with _session() as db:
        if db is None:
            raise KnowledgeError("The knowledge database is unavailable.")
        item = db.query(KnowledgeItem).filter(KnowledgeItem.id == item_id).first()
        if not item:
            raise KnowledgeError(f"Knowledge item {item_id} not found.")
        merged = {**to_dict(item), **{k: v for k, v in data.items() if v is not None or k == "concept_id"}}
        clean = normalise(merged)
        changed = item.content_hash != content_hash(clean["title"], clean["body"])
        _apply(item, clean)
        if changed:
            item.embedding = None  # stale; re-embedded on the next pass
        db.commit()
        db.refresh(item)
        return to_dict(item)


def upsert_item(data: dict, *, key: tuple[str, ...] = ("concept_id", "title", "kind")) -> dict:
    """Create or update the item matching ``key`` fields."""
    clean = normalise(data)
    with _session() as db:
        if db is None:
            raise KnowledgeError("The knowledge database is unavailable.")
        q = db.query(KnowledgeItem)
        for field in key:
            value = clean.get(field)
            column = getattr(KnowledgeItem, field)
            q = q.filter(column.is_(None) if value is None else column == value)
        item = q.first()
        if item is None:
            item = KnowledgeItem()
            db.add(item)
        elif item.content_hash != content_hash(clean["title"], clean["body"]):
            item.embedding = None
        _apply(item, clean)
        db.commit()
        db.refresh(item)
        return to_dict(item)


def get_item(item_id: int, *, embedding: bool = False) -> Optional[dict]:
    with _session() as db:
        if db is None:
            return None
        item = db.query(KnowledgeItem).filter(KnowledgeItem.id == item_id).first()
        return to_dict(item, embedding=embedding) if item else None


def list_items(*, kind: Optional[str] = None, category: Optional[str] = None,
               concept_id: Optional[str] = None, status: Optional[str] = None,
               statuses: Optional[Iterable[str]] = None, audiences: Optional[Iterable[str]] = None,
               source_id: Optional[int] = None, ids: Optional[Iterable[int]] = None,
               embedding: bool = False, limit: int = 5000) -> list[dict]:
    with _session() as db:
        if db is None:
            return []
        q = db.query(KnowledgeItem)
        if kind:
            q = q.filter(KnowledgeItem.kind == kind)
        if category:
            q = q.filter(KnowledgeItem.category == category)
        if concept_id:
            q = q.filter(KnowledgeItem.concept_id == concept_id)
        if status:
            q = q.filter(KnowledgeItem.status == status)
        if statuses:
            q = q.filter(KnowledgeItem.status.in_(list(statuses)))
        if audiences:
            q = q.filter(KnowledgeItem.audience.in_(list(audiences)))
        if source_id is not None:
            q = q.filter(KnowledgeItem.source_id == source_id)
        if ids is not None:
            q = q.filter(KnowledgeItem.id.in_(list(ids) or [-1]))
        rows = q.order_by(KnowledgeItem.concept_id, KnowledgeItem.title).limit(limit).all()
        return [to_dict(r, embedding=embedding) for r in rows]


def delete_item(item_id: int) -> bool:
    with _session() as db:
        if db is None:
            return False
        item = db.query(KnowledgeItem).filter(KnowledgeItem.id == item_id).first()
        if not item:
            return False
        db.delete(item)
        db.commit()
        return True


def set_status(item_ids: Iterable[int], status: str) -> int:
    if status not in STATUSES:
        raise KnowledgeError(f"status must be one of {', '.join(STATUSES)}.")
    with _session() as db:
        if db is None:
            return 0
        n = db.query(KnowledgeItem).filter(KnowledgeItem.id.in_(list(item_ids) or [-1])).update(
            {KnowledgeItem.status: status}, synchronize_session=False)
        db.commit()
        return n


def set_embedding(item_id: int, vector: list[float]) -> None:
    with _session() as db:
        if db is None:
            return
        db.query(KnowledgeItem).filter(KnowledgeItem.id == item_id).update(
            {KnowledgeItem.embedding: json.dumps([round(float(v), 6) for v in vector])},
            synchronize_session=False)
        db.commit()


def bump_stats(item_ids: Iterable[int], field: str, by: int = 1) -> None:
    if field not in ("used", "accepted_builds", "rolled_back_builds"):
        return
    ids = [int(i) for i in item_ids]
    if not ids:
        return
    with _session() as db:
        if db is None:
            return
        column = getattr(KnowledgeItem, field)
        db.query(KnowledgeItem).filter(KnowledgeItem.id.in_(ids)).update(
            {column: column + by}, synchronize_session=False)
        db.commit()


#: Rolled back at least this often, and more often than accepted: back to review.
UNHELPFUL_ROLLBACKS = 3


def record_outcome(item_ids, accepted: bool) -> list[int]:
    """Count a build's outcome against the guidance it used. Returns items sent back to review."""
    ids = [int(i) for i in item_ids]
    if not ids:
        return []
    bump_stats(ids, "accepted_builds" if accepted else "rolled_back_builds")
    if accepted:
        return []
    flagged = []
    with _session() as db:
        if db is None:
            return []
        for item in db.query(KnowledgeItem).filter(KnowledgeItem.id.in_(ids), KnowledgeItem.status == "active"):
            if (item.rolled_back_builds or 0) >= UNHELPFUL_ROLLBACKS and \
                    (item.rolled_back_builds or 0) > (item.accepted_builds or 0):
                item.status = "proposed"
                item.rationale = ((item.rationale or "") + f" Flagged for review: {item.rolled_back_builds} "
                                  f"builds that used it were rolled back.").strip()
                flagged.append(item.id)
        db.commit()
    return flagged


def counts() -> dict:
    with _session() as db:
        if db is None:
            return {}
        out: dict[str, dict] = {}
        for kind, status in db.query(KnowledgeItem.kind, KnowledgeItem.status).all():
            bucket = out.setdefault(kind, {})
            bucket[status] = bucket.get(status, 0) + 1
        return out


def has_active_guidance() -> bool:
    with _session() as db:
        if db is None:
            return False
        return db.query(KnowledgeItem.id).filter(
            KnowledgeItem.kind == "guidance", KnowledgeItem.status == "active",
            KnowledgeItem.audience.in_(["builder", "both"])).first() is not None


# ── Sources ────────────────────────────────────────────────────────────────


def _source_dict(row: KnowledgeSource, *, text: bool = False) -> dict:
    out = {
        "id": row.id, "title": row.title, "source_type": row.source_type, "filename": row.filename,
        "url": row.url, "library_id": row.library_id, "document_id": row.document_id,
        "concept_id": row.concept_id, "status": row.status, "message": row.message or "",
        "item_count": row.item_count or 0, "version": row.version or 1,
        "text_chars": len(row.text or ""),
        "created_at": row.created_at.isoformat() if row.created_at else None,
    }
    if text:
        out["text"] = row.text or ""
    return out


def create_source(**fields) -> dict:
    with _session() as db:
        if db is None:
            raise KnowledgeError("The knowledge database is unavailable.")
        row = KnowledgeSource(**{k: v for k, v in fields.items() if hasattr(KnowledgeSource, k)})
        db.add(row)
        db.commit()
        db.refresh(row)
        return _source_dict(row)


def update_source(source_id: int, **fields) -> Optional[dict]:
    with _session() as db:
        if db is None:
            return None
        row = db.query(KnowledgeSource).filter(KnowledgeSource.id == source_id).first()
        if not row:
            return None
        for k, v in fields.items():
            if hasattr(KnowledgeSource, k):
                setattr(row, k, v)
        db.commit()
        db.refresh(row)
        return _source_dict(row)


def get_source(source_id: int, *, text: bool = False) -> Optional[dict]:
    with _session() as db:
        if db is None:
            return None
        row = db.query(KnowledgeSource).filter(KnowledgeSource.id == source_id).first()
        return _source_dict(row, text=text) if row else None


def list_sources() -> list[dict]:
    with _session() as db:
        if db is None:
            return []
        return [_source_dict(r) for r in db.query(KnowledgeSource).order_by(KnowledgeSource.id.desc()).all()]


def delete_source(source_id: int, *, items: bool = True) -> dict:
    with _session() as db:
        if db is None:
            raise KnowledgeError("The knowledge database is unavailable.")
        removed = 0
        if items:
            removed = db.query(KnowledgeItem).filter(KnowledgeItem.source_id == source_id).delete(
                synchronize_session=False)
        n = db.query(KnowledgeSource).filter(KnowledgeSource.id == source_id).delete(
            synchronize_session=False)
        db.commit()
        return {"deleted": bool(n), "items_removed": removed}


# ── Usage ──────────────────────────────────────────────────────────────────


def record_usage(rows: list[dict], source_type: str) -> int:
    """Write knowledge-item usage into the shared usage table.

    ``rows`` carry ``item_id`` in place of ``document_id``; everything else is
    the process usage shape.
    """
    if not rows:
        return 0
    from app.process import store as process_store

    shaped = [{**r, "document_id": r.get("item_id", r.get("document_id")), "source_type": source_type}
              for r in rows]
    return process_store.record_usage(shaped)


# ── Schema ─────────────────────────────────────────────────────────────────


def ensure_schema() -> None:
    """Additive, idempotent migrations run on boot.

    * ``process_usage.source_type`` — so the one usage table can hold knowledge
      items as well as process documents.
    * ``industry_knowledge`` rows are copied into ``knowledge_items`` once each
      (keyed on ``legacy_id``). The old table is left as it was.
    """
    if SessionLocal is None:
        return
    from sqlalchemy import text

    db = SessionLocal()
    try:
        usage_cols = {row[1] for row in db.execute(text("PRAGMA table_info(process_usage)"))}
        if usage_cols and "source_type" not in usage_cols:
            db.execute(text("ALTER TABLE process_usage ADD COLUMN source_type VARCHAR NOT NULL DEFAULT 'process'"))
            db.commit()
            logger.info("process_usage: added source_type column")

        legacy_cols = {row[1] for row in db.execute(text("PRAGMA table_info(industry_knowledge)"))}
        item_cols = {row[1] for row in db.execute(text("PRAGMA table_info(knowledge_items)"))}
        if not legacy_cols or not item_cols:
            return
        done = {r[0] for r in db.query(KnowledgeItem.legacy_id).filter(KnowledgeItem.legacy_id.isnot(None))}
        as_of = "as_of" if "as_of" in legacy_cols else "NULL"
        rows = db.execute(text(
            f"SELECT id, concept_id, kind, title, body, tags, source, {as_of} FROM industry_knowledge"
        )).fetchall()
        copied = 0
        for rid, concept_id, kind, title, body, tags, source, dated in rows:
            if rid in done or not title or not body:
                continue
            guidance = (kind == "best_practice")
            item = KnowledgeItem(
                kind="guidance" if guidance else "reference",
                category=kind if kind in REFERENCE_CATEGORIES else "definition",
                concept_id=concept_id, title=title, body=body, tags=tags,
                audience="both" if guidance else "runtime",
                strength="should" if guidance else None,
                status="active", origin="seed" if source == "seed" else "migrated",
                as_of=dated, legacy_id=rid, content_hash=content_hash(title, body),
            )
            db.add(item)
            copied += 1
        if copied:
            db.commit()
            logger.info("knowledge_items: copied %d industry_knowledge rows", copied)
    except Exception as e:
        logger.warning("Knowledge schema migration failed: %s", e)
    finally:
        db.close()
