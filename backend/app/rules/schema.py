"""
Additive column migrations for the rules tables.

``create_all()`` adds missing tables, never missing columns, and this project
has no migration tool. Same approach as ``app.rag.schema``: add what is
missing, never drop or retype, stay silent when everything matches.
"""

from __future__ import annotations

import logging

from app.database import SessionLocal

logger = logging.getLogger(__name__)

_EXPECTED: dict[str, dict[str, str]] = {
    "rules": {
        "category": "VARCHAR",
        "targets": "TEXT",
    },
    "rule_categories": {
        "scope": "VARCHAR",
        "rule_types": "TEXT",
        "default_enforcement": "VARCHAR",
        "default_applies": "VARCHAR",
    },
}


def ensure_schema() -> None:
    if SessionLocal is None:
        return

    from sqlalchemy import text

    db = SessionLocal()
    added = 0
    try:
        for table, columns in _EXPECTED.items():
            existing = {row[1] for row in db.execute(text(f"PRAGMA table_info({table})"))}
            if not existing:
                continue
            for column, ddl in columns.items():
                if column not in existing:
                    db.execute(text(f"ALTER TABLE {table} ADD COLUMN {column} {ddl}"))
                    added += 1
                    logger.info("rules schema: added %s.%s", table, column)
        if added:
            db.commit()
    except Exception as e:
        logger.warning("Could not migrate rules schema: %s", e)
    finally:
        db.close()
