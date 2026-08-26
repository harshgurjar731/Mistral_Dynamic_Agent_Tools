"""
Additive column migrations for the RAG tables.

``create_all()`` creates missing *tables*, never missing *columns*, and this
project has no migration tool — so a field added after a table first existed has
to be introduced explicitly or every read of it fails with "no such column".

The knowledge feature learned this the hard way with ``as_of``
(``app.ontology.knowledge.ensure_schema``). This is the same idea generalised:
declare what each table should have, add what is missing, and stay silent when
everything already matches. Additive and idempotent, so it is safe on every
boot; it never drops or retypes a column, because losing a user's drafts to an
automatic migration would be far worse than a stale schema.
"""

from __future__ import annotations

import logging

from app.database import SessionLocal

logger = logging.getLogger(__name__)

#: table -> {column: SQL type}. Columns must be nullable or carry a default —
#: SQLite cannot add a NOT NULL column to a table that already has rows.
_EXPECTED: dict[str, dict[str, str]] = {
    "rag_documents": {
        "mime_type": "VARCHAR",
        "error": "TEXT",
        "char_count": "INTEGER DEFAULT 0",
        "chunk_count": "INTEGER DEFAULT 0",
        "rules": "TEXT",
        "trace_id": "VARCHAR",
        "ontology_version": "INTEGER",
    },
    "rag_library_ontology": {
        "summary": "TEXT",
        "prompt": "TEXT",
        "source_document_ids": "TEXT",
        "model": "VARCHAR",
        "approved_at": "DATETIME",
    },
    "rag_extraction_drafts": {
        "entity_count": "INTEGER DEFAULT 0",
        "relation_count": "INTEGER DEFAULT 0",
        "model": "VARCHAR",
        "rules": "TEXT",
    },
    "rag_events": {
        "parent_id": "INTEGER",
        "meta": "TEXT",
        "seq": "INTEGER DEFAULT 0",
        "ended_at": "DATETIME",
        "duration_ms": "INTEGER",
    },
    "rag_system_agents": {
        "name": "VARCHAR",
        "model": "VARCHAR",
    },
}


def ensure_schema() -> None:
    """Add any column this package expects but an older table lacks."""
    if SessionLocal is None:
        return

    from sqlalchemy import text

    db = SessionLocal()
    added = 0
    try:
        for table, columns in _EXPECTED.items():
            existing = {
                row[1] for row in db.execute(text(f"PRAGMA table_info({table})"))
            }
            if not existing:
                # Table not created yet. create_all() will build it correctly
                # from the model, so there is nothing to patch.
                continue
            for column, ddl in columns.items():
                if column in existing:
                    continue
                db.execute(text(f"ALTER TABLE {table} ADD COLUMN {column} {ddl}"))
                added += 1
                logger.info("rag schema: added %s.%s", table, column)
        if added:
            db.commit()
    except Exception as e:
        # A schema patch failing must not stop the app booting. The feature that
        # needed the column will fail loudly on first use, which is a better
        # signal than a dead process.
        logger.warning("Could not migrate RAG schema: %s", e)
    finally:
        db.close()
