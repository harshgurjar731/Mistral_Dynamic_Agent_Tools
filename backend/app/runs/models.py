"""
Tables for background runs.

``pipeline_runs`` holds one row per run — what was asked, where it has got to,
and how it ended. ``pipeline_run_events`` is the append-only event log the UI
replays to rebuild the timeline exactly as a live viewer saw it.

Additive tables, created by ``Base.metadata.create_all()`` at startup.
"""

from sqlalchemy import Column, DateTime, Index, Integer, String, Text
from sqlalchemy.sql import func

from app.database import Base

#: Run lifecycle. ``interrupted`` means the process stopped while the run was
#: in flight — the pipeline cannot resume mid-layer, so it is terminal.
RUN_STATUSES = ("running", "completed", "failed", "cancelled", "interrupted")
TERMINAL_STATUSES = frozenset(RUN_STATUSES) - {"running"}


class PipelineRunRecord(Base):
    __tablename__ = "pipeline_runs"

    id = Column(String, primary_key=True)                 # uuid hex
    kind = Column(String, nullable=False, index=True)     # workflow_plan | agent | tool_synthesis | activity_synthesis
    title = Column(String, nullable=False, default="")
    status = Column(String, nullable=False, default="running", index=True)

    request = Column(Text, nullable=False, default="{}")  # JSON — what started it
    result = Column(Text, nullable=True)                  # JSON — what it produced
    error = Column(Text, nullable=True)

    # Progress, denormalised from the event log so a list of runs never has to
    # read their events.
    layers_total = Column(Integer, nullable=False, default=0)
    layers_done = Column(Integer, nullable=False, default=0)
    current_label = Column(String, nullable=True)
    note = Column(Text, nullable=True)
    last_seq = Column(Integer, nullable=False, default=0)

    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())
    finished_at = Column(DateTime, nullable=True)


class PipelineRunEvent(Base):
    __tablename__ = "pipeline_run_events"

    id = Column(Integer, primary_key=True, autoincrement=True)
    run_id = Column(String, nullable=False)
    #: Position in the run's stream. Consecutive ``text_chunk`` events are
    #: stored merged under the seq of the last chunk they contain.
    seq = Column(Integer, nullable=False)
    event = Column(String, nullable=False)
    data = Column(Text, nullable=False, default="")       # the SSE ``data`` payload, as sent

    __table_args__ = (Index("ix_pipeline_run_events_run_seq", "run_id", "seq"),)
