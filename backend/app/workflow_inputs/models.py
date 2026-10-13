"""
Workflow document-input tables.

A workflow input of ``type: "file"`` is a document the user hands over when
starting a run. The document itself lives in a Mistral library; these two
tables are the local record of where:

* ``workflow_input_libraries`` — the one library holding a document input's
  uploads, and the agents it is attached to (the agent steps that read it).
* ``workflow_input_documents`` — every document uploaded through a run form,
  so a run can only reference a document that was uploaded for that input,
  and so deleting the workflow, an agent or the library can clean up after it.

Additive tables, created by ``Base.metadata.create_all()`` at startup.
"""

from sqlalchemy import Column, DateTime, Integer, String, Text, UniqueConstraint
from sqlalchemy.sql import func

from app.database import Base


class WorkflowInputLibrary(Base):
    __tablename__ = "workflow_input_libraries"

    id = Column(Integer, primary_key=True)
    workflow_name = Column(String, nullable=False, index=True)
    field = Column(String, nullable=False)
    library_id = Column(String, nullable=False, index=True)
    agent_ids = Column(Text, nullable=True)  # JSON list — the agents it is attached to
    created_at = Column(DateTime, server_default=func.now())

    __table_args__ = (
        UniqueConstraint("workflow_name", "field", name="uq_workflow_input_library"),
    )


class WorkflowInputDocument(Base):
    __tablename__ = "workflow_input_documents"

    id = Column(Integer, primary_key=True)
    workflow_name = Column(String, nullable=False, index=True)
    field = Column(String, nullable=False)
    library_id = Column(String, nullable=False, index=True)
    document_id = Column(String, nullable=False, unique=True)
    filename = Column(String, nullable=False)
    mime = Column(String, nullable=True)
    size = Column(Integer, nullable=True)
    chars = Column(Integer, nullable=True)
    created_at = Column(DateTime, server_default=func.now())
