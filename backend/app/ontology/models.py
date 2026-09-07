"""
Ontology tables — SKOS-lite.

Five tables are enough for everything the platform needs:

* ``ontology_schemes``     — one row per vocabulary (domain, capability, …)
* ``ontology_concepts``    — the terms, each optionally pointing at a parent
* ``ontology_annotations`` — (subject, predicate, concept) triples
* ``ontology_rules``       — the governance checks, as data instead of code
* ``ontology_rule_exceptions`` — approved, provenance-tracked derogations

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


class KnowledgeEntry(Base):
    """A fact about an industry, hung off a concept in the domain tree.

    This is what turns the taxonomy from a filing system into a knowledge base.
    The vocabulary says *that* an agent serves mortgage lending; these rows say
    what mortgage lending actually involves — the regulations, the metrics, the
    failure modes — so an agent can answer with domain substance rather than
    generic prose.

    ``concept_id`` is deliberately the only link. Retrieval walks the same
    hierarchy everything else does, so knowledge filed against ``domain.lending``
    is found by an agent scoped to ``domain.lending.mortgage`` without anyone
    having to duplicate it.
    """

    __tablename__ = "industry_knowledge"

    id = Column(Integer, primary_key=True)
    concept_id = Column(String, nullable=False, index=True)
    # definition | regulation | process | metric | risk | best_practice | glossary
    kind = Column(String, nullable=False, default="definition", index=True)
    title = Column(String, nullable=False)
    body = Column(Text, nullable=False)
    # JSON array of extra search terms — the same trick concept synonyms use.
    tags = Column(Text, nullable=True)
    # When the content was last known good. Required on anything with a figure
    # or a rule that moves — without it a model reads a stale number as current
    # fact, which is the failure this whole attribution effort exists to stop.
    as_of = Column(String, nullable=True)
    source = Column(String, nullable=False, default="seed")  # seed | user | llm
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())

    __table_args__ = (
        # The same title under the same concept twice is a duplicate import,
        # which is what makes the seed loader safe to run on every boot.
        UniqueConstraint("concept_id", "title", name="uq_knowledge_entry"),
        Index("ix_knowledge_concept_kind", "concept_id", "kind"),
    )


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
    # seed | user | inferred | llm | derived. "derived" is written by the rule
    # engine (ontology/rules.py) when a `derives_annotation` rule's conditions
    # hold — a fact produced by another fact, not asserted by anyone directly.
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


class OntologyRule(Base):
    """A governance check, as data instead of a Python function.

    ``kind`` selects a fixed evaluator in ``ontology/rules.py``; ``params`` (a
    JSON object) configures it. This is deliberately not a generic condition
    language — the reasoning patterns the evaluators need (reachability,
    accumulation over a DAG, tier lookup) are already written; a rule row picks
    one and tunes it, which is what lets a rule change without a deploy without
    also requiring a rule *language* to maintain.

    Follows the same draft → approved → superseded lifecycle as
    ``rag.models.LibraryOntology``: a draft has zero effect on validation,
    which is what makes editing a live governance rule safe to preview.
    """

    __tablename__ = "ontology_rules"

    id = Column(String, primary_key=True)              # e.g. "capability_gap.default"
    kind = Column(String, nullable=False, index=True)   # capability_gap | egress | guardrail |
                                                         # library_domain | cardinality | derives_annotation
    label = Column(String, nullable=False)
    # JSON object, shape depends on `kind` — see ontology/rules.py's evaluators.
    params = Column(Text, nullable=False, default="{}")
    # Default/fallback severity. capability_gap overrides this dynamically per
    # annotation provenance, same as it always has; other kinds use it as-is.
    severity = Column(String, nullable=False, default="warning")
    message_template = Column(Text, nullable=True)
    status = Column(String, nullable=False, default="draft", index=True)  # draft | approved | superseded
    source = Column(String, nullable=False, default="seed")               # seed | user
    created_at = Column(DateTime, server_default=func.now())
    approved_at = Column(DateTime, nullable=True)


class RuleException(Base):
    """An approved derogation: one rule does not apply to one subject.

    This is the exceptions/derogations gap a plain taxonomy cannot express —
    "restricted, except for this specific case, for this specific reason".
    ``reason`` and ``granted_by`` are required rather than optional because an
    exception without either is indistinguishable from the rule silently not
    firing, which is the one failure mode a governance layer cannot have.
    """

    __tablename__ = "ontology_rule_exceptions"

    id = Column(Integer, primary_key=True)
    rule_id = Column(String, ForeignKey("ontology_rules.id"), nullable=False, index=True)
    subject_type = Column(String, nullable=False)
    subject_id = Column(String, nullable=False)
    reason = Column(Text, nullable=False)
    granted_by = Column(String, nullable=False)
    expires_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, server_default=func.now())

    __table_args__ = (
        Index("ix_exception_lookup", "rule_id", "subject_type", "subject_id"),
    )
