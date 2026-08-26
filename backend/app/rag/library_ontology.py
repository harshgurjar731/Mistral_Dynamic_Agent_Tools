"""
The library's content schema — reads, writes and the approval lifecycle.

One library has at most one *approved* ontology and at most one *draft*. That
constraint is the whole design:

* extraction always knows which schema governs it (the approved one), so two
  documents in a library cannot be typed differently;
* a proposal can be reviewed and edited without disturbing what is already in
  the graph, because nothing changes until approval;
* approving supersedes rather than overwrites, so documents stamped with an
  older version stay explicable instead of becoming silently wrong.

A library with no ontology falls back to the built-in generic types and free
predicates — exactly the behaviour before this existed. Nothing forces a user
to design a schema before they can extract anything.
"""

from __future__ import annotations

import json
import logging
from contextlib import contextmanager
from datetime import datetime, timezone
from typing import Any, Optional

from app.database import SessionLocal
from app.rag.models import LibraryOntology, RagDocument

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


def _loads(raw: Optional[str], default: Any) -> Any:
    if not raw:
        return default
    try:
        return json.loads(raw)
    except Exception:
        return default


def _to_dict(row: LibraryOntology) -> dict:
    return {
        "id": row.id,
        "library_id": row.library_id,
        "version": row.version,
        "status": row.status,
        "summary": row.summary or "",
        "entity_types": _loads(row.entity_types, []),
        "predicates": _loads(row.predicates, []),
        "prompt": row.prompt or "",
        "source_document_ids": _loads(row.source_document_ids, []),
        "model": row.model,
        "created_at": row.created_at.isoformat() if row.created_at else None,
        "updated_at": row.updated_at.isoformat() if row.updated_at else None,
        "approved_at": row.approved_at.isoformat() if row.approved_at else None,
    }


def _clean_name(value: Any, limit: int = 60) -> str:
    """A type or predicate name, normalised the way the extractor will see it."""
    return " ".join(str(value or "").strip().split())[:limit]


def _clean_types(raw: Any) -> list[dict]:
    """Entity types in canonical form, deduplicated, order preserved."""
    out: list[dict] = []
    seen: set[str] = set()
    for item in raw or []:
        if isinstance(item, str):
            item = {"name": item}
        if not isinstance(item, dict):
            continue
        # TitleCase: types appear in the prompt, in Neo4j and in the UI legend,
        # and one casing everywhere is what stops "supplier"/"Supplier" becoming
        # two node identities.
        name = _clean_name(item.get("name")).replace(" ", "")
        if not name:
            continue
        name = name[0].upper() + name[1:]
        if name.lower() in seen:
            continue
        seen.add(name.lower())
        out.append({
            "name": name,
            "description": str(item.get("description") or "")[:400],
            "examples": [str(e)[:120] for e in (item.get("examples") or [])][:5],
        })
    return out[:40]


def _clean_predicates(raw: Any) -> list[dict]:
    """Predicates in canonical lower_snake_case form."""
    import re

    out: list[dict] = []
    seen: set[str] = set()
    for item in raw or []:
        if isinstance(item, str):
            item = {"name": item}
        if not isinstance(item, dict):
            continue
        name = re.sub(r"[^a-z0-9]+", "_", _clean_name(item.get("name")).lower()).strip("_")
        if not name or name in seen:
            continue
        seen.add(name)
        out.append({
            "name": name,
            "description": str(item.get("description") or "")[:400],
            # Advisory only. Enforcing domain/range at extraction would drop
            # true relations the schema author did not anticipate; showing them
            # in the prompt steers the model without silently losing data.
            "source_types": _clean_names(item.get("source_types")),
            "target_types": _clean_names(item.get("target_types")),
        })
    return out[:60]


def _clean_names(raw: Any) -> list[str]:
    return [t["name"] for t in _clean_types(raw)]


# ── Reads ──────────────────────────────────────────────────────────────────


def get_approved(library_id: str) -> Optional[dict]:
    """The schema governing extraction in this library, if one is approved."""
    with _session() as db:
        if db is None:
            return None
        row = (
            db.query(LibraryOntology)
            .filter(
                LibraryOntology.library_id == library_id,
                LibraryOntology.status == "approved",
            )
            .order_by(LibraryOntology.version.desc())
            .first()
        )
        return _to_dict(row) if row else None


def get_draft(library_id: str) -> Optional[dict]:
    with _session() as db:
        if db is None:
            return None
        row = (
            db.query(LibraryOntology)
            .filter(
                LibraryOntology.library_id == library_id,
                LibraryOntology.status == "draft",
            )
            .order_by(LibraryOntology.version.desc())
            .first()
        )
        return _to_dict(row) if row else None


def history(library_id: str, limit: int = 20) -> list[dict]:
    with _session() as db:
        if db is None:
            return []
        rows = (
            db.query(LibraryOntology)
            .filter(LibraryOntology.library_id == library_id)
            .order_by(LibraryOntology.version.desc())
            .limit(limit)
            .all()
        )
        return [_to_dict(r) for r in rows]


def type_names(library_id: str) -> list[str]:
    ontology = get_approved(library_id)
    return [t["name"] for t in (ontology or {}).get("entity_types", [])]


def predicate_names(library_id: str) -> list[str]:
    ontology = get_approved(library_id)
    return [p["name"] for p in (ontology or {}).get("predicates", [])]


def stale_documents(library_id: str) -> list[dict]:
    """Documents in the graph that were extracted under an older schema.

    Reported rather than fixed automatically. Re-extraction costs a model call
    per chunk, and whether an older schema is *wrong* or merely *older* is a
    judgement the person who approved the new one is in a position to make.
    """
    ontology = get_approved(library_id)
    if not ontology:
        return []
    current = ontology["version"]

    with _session() as db:
        if db is None:
            return []
        rows = (
            db.query(RagDocument)
            .filter(
                RagDocument.library_id == library_id,
                RagDocument.status == "graphed",
            )
            .all()
        )
        return [
            {
                "id": r.id,
                "filename": r.filename,
                "ontology_version": r.ontology_version,
                "current_version": current,
            }
            for r in rows
            if (r.ontology_version or 0) != current
        ]


# ── Writes ─────────────────────────────────────────────────────────────────


def save_draft(
    *,
    library_id: str,
    entity_types: Any,
    predicates: Any,
    prompt: str = "",
    summary: str = "",
    source_document_ids: Optional[list] = None,
    model: Optional[str] = None,
) -> dict:
    """Create or replace this library's draft schema.

    The draft takes the next version number, so approving it never collides
    with a superseded version that documents still reference.
    """
    types = _clean_types(entity_types)
    preds = _clean_predicates(predicates)

    with _session() as db:
        if db is None:
            raise RuntimeError("The database is unavailable.")

        row = (
            db.query(LibraryOntology)
            .filter(
                LibraryOntology.library_id == library_id,
                LibraryOntology.status == "draft",
            )
            .first()
        )
        if not row:
            highest = (
                db.query(LibraryOntology)
                .filter(LibraryOntology.library_id == library_id)
                .order_by(LibraryOntology.version.desc())
                .first()
            )
            row = LibraryOntology(
                library_id=library_id,
                version=(highest.version + 1) if highest else 1,
                status="draft",
            )
            db.add(row)

        row.entity_types = json.dumps(types)
        row.predicates = json.dumps(preds)
        if prompt:
            row.prompt = prompt
        if summary:
            row.summary = summary
        if source_document_ids is not None:
            row.source_document_ids = json.dumps(source_document_ids)
        if model:
            row.model = model

        db.commit()
        db.refresh(row)
        return _to_dict(row)


def approve(library_id: str) -> dict:
    """Promote the draft, superseding whatever governed extraction before."""
    with _session() as db:
        if db is None:
            raise RuntimeError("The database is unavailable.")

        draft = (
            db.query(LibraryOntology)
            .filter(
                LibraryOntology.library_id == library_id,
                LibraryOntology.status == "draft",
            )
            .order_by(LibraryOntology.version.desc())
            .first()
        )
        if not draft:
            raise ValueError("This library has no draft ontology to approve.")
        if not _loads(draft.entity_types, []):
            raise ValueError("An ontology needs at least one entity type.")

        db.query(LibraryOntology).filter(
            LibraryOntology.library_id == library_id,
            LibraryOntology.status == "approved",
        ).update({"status": "superseded"}, synchronize_session=False)

        draft.status = "approved"
        draft.approved_at = datetime.now(timezone.utc)
        db.commit()
        db.refresh(draft)
        logger.info(
            "Library %s ontology v%d approved (%d types, %d predicates)",
            library_id, draft.version,
            len(_loads(draft.entity_types, [])), len(_loads(draft.predicates, [])),
        )
        return _to_dict(draft)


def discard_draft(library_id: str) -> bool:
    with _session() as db:
        if db is None:
            return False
        deleted = (
            db.query(LibraryOntology)
            .filter(
                LibraryOntology.library_id == library_id,
                LibraryOntology.status == "draft",
            )
            .delete(synchronize_session=False)
        )
        db.commit()
        return bool(deleted)


def delete_for_library(library_id: str) -> int:
    """Drop every version, for when the library itself is deleted."""
    with _session() as db:
        if db is None:
            return 0
        deleted = (
            db.query(LibraryOntology)
            .filter(LibraryOntology.library_id == library_id)
            .delete(synchronize_session=False)
        )
        db.commit()
        return deleted
