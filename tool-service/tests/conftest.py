"""
Test configuration.

The database and the dynamic-tools directory are pointed at a temp directory
*before* ``app`` is imported, because ``app.config.settings`` and the SQLAlchemy
engine are created at import time.

No test here calls a model. ``fake_llm`` replaces the model client with a
script of canned answers; tests that need the real API live in ``evals/``.
"""

import os
import sys
import tempfile

_TMP = tempfile.mkdtemp(prefix="toolsvc_tests_")
os.environ["DATABASE_URL"] = f"sqlite:///{os.path.join(_TMP, 'test.db')}".replace("\\", "/")
os.environ["DYNAMIC_TOOLS_DIR"] = os.path.join(_TMP, "dynamic_tools")
os.environ["AUTO_APPROVE_DYNAMIC_TOOLS"] = "true"
os.environ["MISTRAL_API_KEY"] = "test-key"
os.environ["TOOL_MODEL_MAX_ATTEMPTS"] = "1"
os.environ["STRICT_ACTIVITY_SPEC"] = "true"

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import pytest  # noqa: E402

from app.database import SessionLocal, init_db  # noqa: E402

init_db()


@pytest.fixture
def db():
    session = SessionLocal()
    try:
        yield session
    finally:
        session.close()


@pytest.fixture
def clean_db():
    """Empty the tool and job tables around a test."""
    from app.models import SynthesisJob, ToolRecord
    from app.synthesis import registry

    session = SessionLocal()
    session.query(ToolRecord).delete()
    session.query(SynthesisJob).delete()
    session.commit()
    registry._cache.clear()
    yield session
    session.close()


class FakeLLM:
    """Scripted model: ``codes`` answers codegen/repair calls in order;
    ``json_answers`` maps role → answer for complete_json."""

    def __init__(self, codes=None, json_answers=None):
        self.codes = list(codes or [])
        self.json_answers = dict(json_answers or {})
        self.calls: list[tuple[str, list]] = []

    def complete(self, role, messages, json_mode=False):
        self.calls.append((role, messages))
        if not self.codes:
            raise AssertionError(f"FakeLLM ran out of scripted code for role {role}")
        return self.codes.pop(0), "fake-model"

    def complete_json(self, role, messages):
        self.calls.append((role, messages))
        answer = self.json_answers.get(role)
        if isinstance(answer, Exception):
            raise answer
        if answer is None:
            raise RuntimeError(f"no scripted JSON for {role}")
        return answer, "fake-model"

    def roles(self):
        return [r for r, _ in self.calls]


@pytest.fixture
def fake_llm(monkeypatch):
    def install(codes=None, json_answers=None):
        fake = FakeLLM(codes, json_answers)
        import app.llm as llm_pkg

        monkeypatch.setattr(llm_pkg, "complete", fake.complete)
        monkeypatch.setattr(llm_pkg, "complete_json", fake.complete_json)
        return fake

    return install
