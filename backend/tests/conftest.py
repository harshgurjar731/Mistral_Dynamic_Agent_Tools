"""Backend tests. No test here calls a model or the tool service."""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
os.environ.setdefault("MISTRAL_API_KEY", "test-key")
# Never read or write the developer's saved Settings-page values or model catalog.
import tempfile  # noqa: E402

_SETTINGS_TMP = tempfile.mkdtemp(prefix="backend_settings_")
os.environ["RUNTIME_SETTINGS_PATH"] = os.path.join(_SETTINGS_TMP, "runtime_settings.json")
os.environ["MODEL_CATALOG_PATH"] = os.path.join(_SETTINGS_TMP, "model_catalog.json")


import pytest  # noqa: E402


@pytest.fixture(scope="session")
def _empty_knowledge_db():
    """An empty database for the knowledge store, created once per session."""
    from sqlalchemy import create_engine
    from sqlalchemy.orm import sessionmaker

    import app.catalog.models  # noqa: F401
    import app.knowledge.models  # noqa: F401
    import app.process.models  # noqa: F401
    from app.database import Base

    engine = create_engine(f"sqlite:///{os.path.join(_SETTINGS_TMP, 'knowledge.db')}",
                           connect_args={"check_same_thread": False})
    Base.metadata.create_all(engine)
    return sessionmaker(bind=engine)


@pytest.fixture(autouse=True)
def _isolated_knowledge(monkeypatch, _empty_knowledge_db):
    """Every pipeline run reads the knowledge store (guidance is on by default).
    Point it at an empty database so no test sees the developer's real one.
    Tests that need knowledge patch ``SessionLocal`` again with their own."""
    from app.knowledge import store as knowledge_store

    monkeypatch.setattr(knowledge_store, "SessionLocal", _empty_knowledge_db)
