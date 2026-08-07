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
    from app.models import ToolRecord  # noqa: F401
    Base.metadata.create_all(bind=engine)

    # Lightweight column migrations for SQLite
    _migrate_add_column("tools", "mcp_published", "BOOLEAN DEFAULT 0 NOT NULL")
    _migrate_add_column("tools", "mcp_server_name", "VARCHAR")

    logger.info("Database tables initialized")


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
