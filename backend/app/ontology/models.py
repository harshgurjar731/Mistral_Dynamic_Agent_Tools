"""
Ontology tables — SKOS-lite.

Three tables are enough for everything the platform needs:

* ``ontology_schemes``     — one row per vocabulary (domain, capability, …)
* ``ontology_concepts``    — the terms, each optionally pointing at a parent
* ``ontology_annotations`` — (subject, predicate, concept) triples

Concept ids are readable dotted paths (``domain.lending.mortgage``) rather than
surrogate keys. They end up in prompts and log lines, and a human reading
"requires capability integration.vcs.read" learns something a UUID cannot tell
them. The parent link is still what hierarchy queries walk — the dots are for
people, not for the query planner.

These tables are additive, so ``Base.metadata.create_all()`` at startup is
sufficient; this project has no migration tool.
"""

from sqlalchemy import (
    Column,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.sql import func

from app.database import Base


class ConceptScheme(Base):
    """A named vocabulary. One hierarchy of concepts lives inside each."""

    __tablename__ = "ontology_schemes"

    id = Column(String, primary_key=True)          # e.g. "domain"
    label = Column(String, nullable=False)
    description = Column(Text, nullable=True)
    created_at = Column(DateTime, server_default=func.now())


class Concept(Base):
    """One term. ``parent_id`` builds the is-a hierarchy inside a scheme."""

    __tablename__ = "ontology_concepts"

    id = Column(String, primary_key=True)          # e.g. "domain.lending.mortgage"
    scheme_id = Column(String, ForeignKey("ontology_schemes.id"), nullable=False, index=True)
    parent_id = Column(String, nullable=True, index=True)
    label = Column(String, nullable=False)
    definition = Column(Text, nullable=True)
    # JSON array. Used for matching a free-text goal against the vocabulary,
    # which is why it is worth carrying even though nothing branches on it.
    synonyms = Column(Text, nullable=True)
    created_at = Column(DateTime, server_default=func.now())


class Annotation(Base):
    """A typed link from a resource to a concept.

    ``subject_id`` is intentionally a bare string: agents and connectors are
    identified by Mistral UUIDs that this database does not own, so a foreign
    key is impossible. An annotation whose subject has been deleted upstream is
    harmless — reads join against live inventory and simply miss.
    """

    __tablename__ = "ontology_annotations"

    id = Column(Integer, primary_key=True)
    subject_type = Column(String, nullable=False, index=True)   # agent | tool | connector | …
    subject_id = Column(String, nullable=False, index=True)
    predicate = Column(String, nullable=False, index=True)      # has_tier | requires_capability | …
    concept_id = Column(String, nullable=False, index=True)
    # seed | user | inferred — inferred annotations are the ones to re-review.
    source = Column(String, nullable=False, default="user")
    created_at = Column(DateTime, server_default=func.now())

    __table_args__ = (
        # The same triple twice is meaningless, and letting it happen would make
        # the backfill script non-idempotent.
        UniqueConstraint(
            "subject_type", "subject_id", "predicate", "concept_id",
            name="uq_annotation_triple",
        ),
        # Covers the two hot reads: "everything about this subject" and
        # "every subject with this concept".
        Index("ix_annotation_subject", "subject_type", "subject_id"),
        Index("ix_annotation_lookup", "predicate", "concept_id"),
    )
