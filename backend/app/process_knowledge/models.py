"""
Process knowledge tables.

* ``process_templates`` — the JSON Schema every process document is checked
  against. One is the default; a built-in one is seeded so the feature works
  before anyone uploads their own.
* ``process_documents`` — the uploaded JSON, versioned per process concept.
  ``concept_id`` is empty for a document uploaded straight onto an
  orchestration page and never filed.
* ``process_usage`` — which element of which document a build used, in which
  layer, and for which agent or workflow. What the "used by" panels and the
  per-layer timeline chips read back.

Content is stored as JSON text in the database rather than as files, so it
lives on the same volume as everything else and needs nothing new on a VM.
"""

from sqlalchemy import Boolean, Column, DateTime, Index, Integer, String, Text
from sqlalchemy.sql import func

from app.database import Base


class ProcessTemplate(Base):
    __tablename__ = "process_templates"

    id = Column(Integer, primary_key=True)
    name = Column(String, nullable=False)
    version = Column(Integer, nullable=False, default=1)
    description = Column(Text, nullable=True)
    #: The JSON Schema documents are validated against.
    schema = Column(Text, nullable=False)
    #: A filled example, offered for download. Null: generated from the schema.
    example = Column(Text, nullable=True)
    #: schema — uploaded as a JSON Schema | inferred — derived from an example.
    kind = Column(String, nullable=False, default="schema")
    is_default = Column(Boolean, nullable=False, default=False)
    builtin = Column(Boolean, nullable=False, default=False)
    created_at = Column(DateTime, server_default=func.now())


class ProcessDocument(Base):
    __tablename__ = "process_documents"

    id = Column(Integer, primary_key=True)
    #: A concept in the ``process`` scheme. Null for an unfiled upload.
    concept_id = Column(String, nullable=True, index=True)
    version = Column(Integer, nullable=False, default=1)
    #: The version a build uses when nothing more specific is asked for. At
    #: most one per concept, and only ever a valid one.
    is_active = Column(Boolean, nullable=False, default=False)
    title = Column(String, nullable=False, default="")
    #: Parsed JSON when the upload parsed; null when it did not.
    content = Column(Text, nullable=True)
    #: Exactly what was uploaded, so an invalid file can still be fixed.
    raw = Column(Text, nullable=False, default="")
    #: valid | invalid | stale (valid once, fails the current template)
    status = Column(String, nullable=False, default="invalid", index=True)
    report = Column(Text, nullable=True)
    template_id = Column(Integer, nullable=True)
    template_version = Column(Integer, nullable=True)
    #: upload | ai_fixed | ai_drafted | orchestration
    source = Column(String, nullable=False, default="upload")
    filename = Column(String, nullable=True)
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())

    __table_args__ = (Index("ix_process_document_concept_active", "concept_id", "is_active"),)


class ProcessUsage(Base):
    __tablename__ = "process_usage"

    id = Column(Integer, primary_key=True)
    document_id = Column(Integer, nullable=False, index=True)
    document_version = Column(Integer, nullable=True)
    concept_id = Column(String, nullable=True, index=True)
    #: agent | workflow
    subject_type = Column(String, nullable=False)
    subject_id = Column(String, nullable=False, index=True)
    subject_name = Column(String, nullable=True)
    layer = Column(String, nullable=False)
    #: stage:affordability, control:C3, …
    element = Column(String, nullable=False)
    how = Column(Text, nullable=True)
    created_at = Column(DateTime, server_default=func.now())
