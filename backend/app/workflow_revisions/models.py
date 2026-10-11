"""
Tables for workflow revisions and versions.

``workflow_revisions`` holds one row per proposed change — what was asked, how
it was interpreted, what it would produce and what became of it.
``workflow_versions`` holds saved states of a workflow's definition, so any
change can be undone.

Additive tables, created by ``Base.metadata.create_all()`` at startup.
"""

from sqlalchemy import Column, DateTime, Index, Integer, String, Text
from sqlalchemy.sql import func

from app.database import Base

#: Revision lifecycle.
#:   proposed            — waiting for the user to apply or discard it
#:   needs_clarification — the instruction was ambiguous; the row carries the question
#:   applied             — saved onto the workflow
#:   discarded           — the user rejected it
#:   superseded          — another revision was applied first; this one's base is gone
#:   failed              — the pipeline could not produce a proposal
REVISION_STATUSES = (
    "proposed", "needs_clarification", "applied", "discarded", "superseded", "failed",
)
OPEN_STATUSES = frozenset({"proposed"})


class WorkflowRevisionRecord(Base):
    __tablename__ = "workflow_revisions"

    id = Column(String, primary_key=True)                     # uuid hex
    workflow_name = Column(String, nullable=False, index=True)
    status = Column(String, nullable=False, default="proposed", index=True)
    #: planner — made while the plan was under review; editor — on a saved workflow.
    origin = Column(String, nullable=False, default="editor")

    instruction = Column(Text, nullable=False, default="")
    focus_step_ids = Column(Text, nullable=False, default="[]")   # JSON list
    #: Semantic hash of the definition the proposal was computed against.
    base_hash = Column(String, nullable=True)

    summary = Column(Text, nullable=True)
    clarification = Column(Text, nullable=True)
    reasoning = Column(Text, nullable=True)
    operations = Column(Text, nullable=False, default="[]")       # JSON list
    notes = Column(Text, nullable=False, default="[]")            # JSON list — apply-time notes
    diff = Column(Text, nullable=True)                            # JSON object
    validation = Column(Text, nullable=True)                      # JSON object
    proposed_definition = Column(Text, nullable=True)             # JSON object
    trace = Column(Text, nullable=False, default="[]")            # JSON list — layer outcomes
    error = Column(Text, nullable=True)

    #: The version recorded when this revision was applied.
    applied_version = Column(Integer, nullable=True)

    created_at = Column(DateTime, server_default=func.now())
    resolved_at = Column(DateTime, nullable=True)


class WorkflowVersionRecord(Base):
    __tablename__ = "workflow_versions"

    id = Column(Integer, primary_key=True, autoincrement=True)
    workflow_name = Column(String, nullable=False)
    version_no = Column(Integer, nullable=False)
    definition_json = Column(Text, nullable=False)
    semantic_hash = Column(String, nullable=False)
    #: baseline | revision | builder | restore
    source = Column(String, nullable=False, default="revision")
    label = Column(Text, nullable=False, default="")
    revision_id = Column(String, nullable=True)
    step_count = Column(Integer, nullable=False, default=0)
    created_at = Column(DateTime, server_default=func.now())

    __table_args__ = (
        Index("ix_workflow_versions_name_no", "workflow_name", "version_no", unique=True),
    )
