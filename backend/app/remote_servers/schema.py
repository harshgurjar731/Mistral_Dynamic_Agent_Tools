"""
Additive column migrations for remote_servers.

Same approach as ``app.rules.schema``: ``create_all()`` never adds columns to
an existing table, so add what is missing and backfill legacy rows (which
were all tool-code endpoints).
"""

from __future__ import annotations

import logging

from app.database import SessionLocal

logger = logging.getLogger(__name__)

_EXPECTED: dict[str, str] = {
    "purpose": "VARCHAR",
    "provider": "VARCHAR",
    "config": "TEXT",
    "secrets": "TEXT",
    "last_status": "VARCHAR",
    "last_check": "TEXT",
    "last_checked_at": "DATETIME",
    "updated_at": "DATETIME",
}


def ensure_schema() -> None:
    if SessionLocal is None:
        return

    from sqlalchemy import text

    db = SessionLocal()
    try:
        existing = {row[1] for row in db.execute(text("PRAGMA table_info(remote_servers)"))}
        if not existing:
            return
        added = [c for c in _EXPECTED if c not in existing]
        for column in added:
            db.execute(text(f"ALTER TABLE remote_servers ADD COLUMN {column} {_EXPECTED[column]}"))
            logger.info("remote_servers schema: added %s", column)
        db.execute(text("UPDATE remote_servers SET purpose = 'tool' WHERE purpose IS NULL"))
        db.execute(text("UPDATE remote_servers SET provider = 'mcp_code_endpoint' WHERE provider IS NULL"))
        db.commit()
    except Exception as e:
        logger.warning("Could not migrate remote_servers schema: %s", e)
    finally:
        db.close()
