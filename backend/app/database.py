"""
Database setup — SQLAlchemy + SQLite.
"""

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, declarative_base
from app.config import settings
import logging

logger = logging.getLogger(__name__)

Base = declarative_base()

from app.db_tuning import engine_kwargs, tune  # noqa: E402

try:
    # WAL, a 30 s lock wait and a pool sized for the I/O threads (app.db_tuning).
    engine = create_engine(settings.DATABASE_URL, **engine_kwargs(settings.DATABASE_URL))
    tune(engine)
    SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    logger.info(f"Database engine initialized for {settings.DATABASE_URL.split('://')[0]}")
except Exception as e:
    logger.error(f"Failed to initialize database engine: {e}")
    engine = None
    SessionLocal = None


def create_tables():
    """Create all ORM-defined tables (safe to call multiple times)."""
    if engine:
        Base.metadata.create_all(bind=engine)
        logger.info("Database tables created/verified")


def get_db():
    """Dependency to get a database session."""
    if not SessionLocal:
        yield None
        return

    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
