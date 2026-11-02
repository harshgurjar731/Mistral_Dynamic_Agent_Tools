"""
Knowledge tables.

* ``knowledge_items`` — one short, self-contained item filed on a catalog node
  (or global when ``concept_id`` is null). ``kind`` separates the two uses:

    reference   what a domain involves — read by built agents at run time
    guidance    how to build — read by the build pipelines

  Guidance may carry ``strength``, ``conditions`` and ``effect``, which is what
  lets a layer apply it without a model call (see ``app.knowledge.retrieval``).

* ``knowledge_sources`` — where distilled items came from: an uploaded file, a
  URL, pasted text or a library document. Kept so every item can cite its
  source and a source can be re-distilled or retired as a unit.

Usage is recorded in the existing ``process_usage`` table with a
``source_type`` column, so "used by" covers process documents and knowledge
items in one place.

The old ``industry_knowledge`` table is left in place and copied across once
by ``app.knowledge.store.ensure_schema`` — never dropped.
"""

from sqlalchemy import Column, DateTime, Float, Index, Integer, String, Text
from sqlalchemy.sql import func

from app.database import Base


class KnowledgeItem(Base):
    __tablename__ = "knowledge_items"

    id = Column(Integer, primary_key=True)
    #: reference | guidance
    kind = Column(String, nullable=False, default="reference", index=True)
    #: reference: definition | regulation | process | metric | risk | glossary | best_practice
    #: guidance:  archetype | agent_design | instruction_style | workflow_pattern | tool_connector
    #:            | governance | model_choice | naming | data_handling | anti_pattern | best_practice
    category = Column(String, nullable=False, default="definition", index=True)
    #: Catalog node it is filed on. Null: applies everywhere.
    concept_id = Column(String, nullable=True, index=True)
    title = Column(String, nullable=False)
    body = Column(Text, nullable=False)
    #: JSON array of extra search terms.
    tags = Column(Text, nullable=True)
    #: builder | runtime | both
    audience = Column(String, nullable=False, default="runtime")
    #: agent | workflow | both
    subject = Column(String, nullable=False, default="both")
    #: must | should | may | avoid (guidance only)
    strength = Column(String, nullable=True)
    #: JSON array of {attr, op, value} — checked against the process facts.
    conditions = Column(Text, nullable=True)
    #: JSON object applied deterministically when the item applies.
    effect = Column(Text, nullable=True)
    #: JSON array of layer views this item is for; empty: chosen by category.
    layers = Column(Text, nullable=True)
    rationale = Column(Text, nullable=True)
    #: proposed | active | retired | conflicting
    status = Column(String, nullable=False, default="active", index=True)
    #: low | medium | high
    confidence = Column(String, nullable=True)
    #: seed | user | distilled | migrated | ai_drafted
    origin = Column(String, nullable=False, default="user")
    source_id = Column(Integer, nullable=True, index=True)
    #: JSON {page, quote, document_id, library_id} — the citation.
    source_ref = Column(Text, nullable=True)
    as_of = Column(String, nullable=True)
    #: JSON array of floats (mistral-embed), set at ingestion. Optional.
    embedding = Column(Text, nullable=True)
    content_hash = Column(String, nullable=True, index=True)
    #: The industry_knowledge row this was copied from, so the copy runs once.
    legacy_id = Column(Integer, nullable=True, unique=True)
    used = Column(Integer, nullable=False, default=0)
    accepted_builds = Column(Integer, nullable=False, default=0)
    rolled_back_builds = Column(Integer, nullable=False, default=0)
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())

    __table_args__ = (Index("ix_knowledge_kind_status", "kind", "status"),)


class KnowledgeSource(Base):
    __tablename__ = "knowledge_sources"

    id = Column(Integer, primary_key=True)
    title = Column(String, nullable=False, default="")
    #: file | url | text | library_document
    source_type = Column(String, nullable=False, default="text")
    filename = Column(String, nullable=True)
    url = Column(String, nullable=True)
    #: Mistral library holding the original, when it was stored there.
    library_id = Column(String, nullable=True)
    document_id = Column(String, nullable=True)
    #: Extracted markdown, with page markers.
    text = Column(Text, nullable=True)
    #: Catalog node the whole source is about, when known.
    concept_id = Column(String, nullable=True)
    #: pending | extracted | distilled | failed
    status = Column(String, nullable=False, default="pending")
    message = Column(Text, nullable=True)
    item_count = Column(Integer, nullable=False, default=0)
    version = Column(Integer, nullable=False, default=1)
    extraction_seconds = Column(Float, nullable=True)
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())
