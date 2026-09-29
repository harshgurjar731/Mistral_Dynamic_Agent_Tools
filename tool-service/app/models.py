"""
SQLAlchemy models for Tool Service.

Versioning
----------
Each ``tools`` row is one *version* of a named tool. ``name`` is not unique;
``(name, version_no)`` is, and at most one approved row per name has
``is_active`` set — that is the version ``/execute/{name}`` runs. A workflow can
pin ``name@version_no`` and keep running that exact code after a newer version
ships.

The row id stays the handle the backend and UI already use for approve,
reject, update and delete, which is why versions live in this table rather than
in a separate one keyed by a new id.
"""

from sqlalchemy import Boolean, Column, DateTime, Integer, String, Text
from sqlalchemy.sql import func

from app.database import Base


class ToolRecord(Base):
    """One version of a synthesized tool or activity."""
    __tablename__ = "tools"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False, index=True)
    hash = Column(String, nullable=False, unique=True, index=True)
    version = Column(String, nullable=False, default="1.0.0")
    schema_json = Column(Text, nullable=False)
    source_code = Column(Text, nullable=False)
    module_path = Column(String, nullable=True)
    # pending_approval | approved | rejected
    status = Column(String, nullable=False, default="pending_approval")
    sandbox_output = Column(Text, nullable=True)
    created_at = Column(DateTime, server_default=func.now())
    mcp_published = Column(Boolean, nullable=False, default=False)
    mcp_server_name = Column(String, nullable=True)
    # "tool" — an agent capability; "activity" — a standalone workflow step.
    purpose = Column(String, nullable=False, default="tool")

    # ── Versioning and contract (SynthesisSpec v2) ─────────────────────
    version_no = Column(Integer, nullable=False, default=1)
    is_active = Column(Boolean, nullable=False, default=False)
    kind = Column(String, nullable=False, default="pure")
    side_effects = Column(String, nullable=False, default="none")
    output_schema_json = Column(Text, nullable=True)
    #: The full SynthesisSpec this version was built from.
    spec_json = Column(Text, nullable=True)
    #: The TestPlan it was verified against — reused to re-verify edits.
    test_plan_json = Column(Text, nullable=True)
    #: Per-case results, attempt history, model used, review decision.
    report_json = Column(Text, nullable=True)
    review_required = Column(Boolean, nullable=False, default=False)


class SynthesisJob(Base):
    """One asynchronous synthesis request."""
    __tablename__ = "synthesis_jobs"

    id = Column(String, primary_key=True)
    spec_hash = Column(String, nullable=False, index=True)
    name = Column(String, nullable=False)
    purpose = Column(String, nullable=False, default="tool")
    # queued | running | approved | pending_approval | failed | spec_invalid | interrupted
    status = Column(String, nullable=False, default="queued")
    spec_json = Column(Text, nullable=False)
    result_json = Column(Text, nullable=True)
    events_json = Column(Text, nullable=True)
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())
