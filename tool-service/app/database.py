"""
Database setup for Tool Service — SQLAlchemy + SQLite.
Auto-creates the tools table on startup.
"""

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, declarative_base
from app.config import settings
import logging

logger = logging.getLogger(__name__)

connect_args = {}
if settings.DATABASE_URL.startswith("sqlite"):
    connect_args = {"check_same_thread": False}

engine = create_engine(settings.DATABASE_URL, connect_args=connect_args)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()


def init_db():
    """Create all tables on startup and run lightweight migrations."""
    from app.models import SynthesisJob, ToolRecord  # noqa: F401
    Base.metadata.create_all(bind=engine)

    # Lightweight column migrations for SQLite
    _migrate_add_column("tools", "mcp_published", "BOOLEAN DEFAULT 0 NOT NULL")
    _migrate_add_column("tools", "mcp_server_name", "VARCHAR")
    _migrate_add_column("tools", "purpose", "VARCHAR DEFAULT 'tool' NOT NULL")
    _normalize_purpose_values()

    # Versioning and SynthesisSpec v2.
    _migrate_add_column("tools", "version_no", "INTEGER DEFAULT 1 NOT NULL")
    _migrate_add_column("tools", "is_active", "BOOLEAN DEFAULT 0 NOT NULL")
    _migrate_add_column("tools", "kind", "VARCHAR DEFAULT 'pure' NOT NULL")
    _migrate_add_column("tools", "side_effects", "VARCHAR DEFAULT 'none' NOT NULL")
    _migrate_add_column("tools", "output_schema_json", "TEXT")
    _migrate_add_column("tools", "spec_json", "TEXT")
    _migrate_add_column("tools", "test_plan_json", "TEXT")
    _migrate_add_column("tools", "report_json", "TEXT")
    _migrate_add_column("tools", "review_required", "BOOLEAN DEFAULT 0 NOT NULL")
    _backfill_versions()

    logger.info("Database tables initialized")


def _backfill_versions():
    """Number versions per name and activate one approved version per name.

    Rows from before versioning all read ``version_no = 1, is_active = 0``.
    Several rows could share a name — a respecified tool got a new row — and
    which one ran was whichever the query happened to return first. Here the
    rows of each name are numbered oldest-first, and the newest approved one
    becomes active. Idempotent: names that already have an active version and
    distinct version numbers are left alone.
    """
    from sqlalchemy import text
    with engine.connect() as conn:
        try:
            rows = conn.execute(text(
                "SELECT id, name, status, version_no, is_active FROM tools "
                "ORDER BY name, created_at, id"
            )).fetchall()
        except Exception as e:
            logger.warning("Version backfill skipped: %s", e)
            return

        by_name: dict[str, list] = {}
        for row in rows:
            by_name.setdefault(row.name, []).append(row)

        changed = 0
        for name, versions in by_name.items():
            numbers = [v.version_no for v in versions]
            if len(set(numbers)) != len(numbers):
                for index, v in enumerate(versions, 1):
                    conn.execute(text("UPDATE tools SET version_no = :n WHERE id = :id"),
                                 {"n": index, "id": v.id})
                changed += 1
            active = [v for v in versions if v.is_active and v.status == "approved"]
            if not active:
                approved = [v for v in versions if v.status == "approved"]
                if approved:
                    conn.execute(text("UPDATE tools SET is_active = 1 WHERE id = :id"),
                                 {"id": approved[-1].id})
                    changed += 1
            elif len(active) > 1:
                for v in active[:-1]:
                    conn.execute(text("UPDATE tools SET is_active = 0 WHERE id = :id"), {"id": v.id})
                changed += 1
        conn.commit()
        if changed:
            logger.info("Version backfill updated %d tool name(s)", changed)


def _normalize_purpose_values():
    """Collapse retired "agent"/"both" purpose values down to "tool".

    "purpose" briefly had three values (agent/activity/both); it now has two
    (tool/activity), with every existing tool classified as "tool" unless it
    was explicitly synthesised as an activity. Safe to re-run — a no-op once
    every row already reads "tool" or "activity".
    """
    from sqlalchemy import text
    with engine.connect() as conn:
        try:
            result = conn.execute(
                text("UPDATE tools SET purpose = 'tool' WHERE purpose IS NULL OR purpose NOT IN ('tool', 'activity')")
            )
            conn.commit()
            if result.rowcount:
                logger.info("Normalized purpose on %d tool row(s) to 'tool'", result.rowcount)
        except Exception as e:
            logger.warning("Purpose normalization skipped: %s", e)


def _migrate_add_column(table: str, column: str, col_type: str):
    """Add a column to an existing table if it doesn't exist (SQLite safe)."""
    from sqlalchemy import text
    with engine.connect() as conn:
        try:
            conn.execute(text(f"SELECT {column} FROM {table} LIMIT 1"))
        except Exception:
            conn.execute(text(f"ALTER TABLE {table} ADD COLUMN {column} {col_type}"))
            conn.commit()
            logger.info("Migrated: added column '%s' to '%s'", column, table)


def get_db():
    """Dependency to get a database session."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
