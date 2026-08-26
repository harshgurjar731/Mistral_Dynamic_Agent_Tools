"""
Relational tables for graph RAG.

Neo4j holds the graph; SQLite holds everything *around* it — which documents
exist and how far through processing they are, what a model proposed before a
human approved it, the rules used to get there, and the timeline of every stage
that ran. That division is deliberate:

* A draft is not a graph. It is a mutable proposal that gets edited, rejected
  and regenerated, which is a row-and-column problem, not a traversal one.
* Processing state must survive Neo4j being down. A document that finished
  extracting while the graph container was stopped should still be committable
  later rather than silently lost.
* The timeline is append-only, high-volume and never traversed. It belongs
  where the rest of the operational state already lives.

These tables are additive, so ``Base.metadata.create_all()`` covers creation;
``app.rag.schema.ensure_schema`` handles columns added after a table first
existed, since this project has no migration tool.
"""

from sqlalchemy import (
    Column,
    DateTime,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.sql import func

from app.database import Base

#: The document lifecycle, in order.
#:
#: uploaded     — in the Mistral library, nothing done here yet
#: indexing     — Mistral is still extracting text on its side
#: extracted    — text pulled back, ready for entity extraction
#: extracting   — entity/relation extraction in flight
#: proposed     — a draft exists and is waiting for review
#: graphed      — the draft was committed to Neo4j
#: unsupported  — the library returned no text; no OCR fallback by design
#: failed       — something broke; the error column says what
DOCUMENT_STATUSES = (
    "uploaded", "indexing", "extracted", "extracting",
    "proposed", "graphed", "unsupported", "failed",
)

#: Statuses that mean "the graph does not contain this document".
UNGRAPHED_STATUSES = tuple(s for s in DOCUMENT_STATUSES if s != "graphed")


class RagDocument(Base):
    """One uploaded document, tracked from upload through to committed graph.

    ``mistral_doc_id`` is the same id the ``document_library`` tool searches, so
    a row here and a library hit there refer to the same file. That is what lets
    one answer cite the same document across both retrieval paths.
    """

    __tablename__ = "rag_documents"

    id = Column(Integer, primary_key=True)
    library_id = Column(String, nullable=False, index=True)
    mistral_doc_id = Column(String, nullable=False)
    filename = Column(String, nullable=False)
    mime_type = Column(String, nullable=True)

    status = Column(String, nullable=False, default="uploaded", index=True)
    error = Column(Text, nullable=True)

    char_count = Column(Integer, nullable=False, default=0)
    chunk_count = Column(Integer, nullable=False, default=0)

    # The extraction rules last used on this document. Kept per document rather
    # than only per library because re-extracting one file with a tighter rule
    # is the normal way a user fixes a bad draft.
    rules = Column(Text, nullable=True)

    # The most recent processing trace, so the UI can open the timeline for
    # this document without searching the event table by subject.
    trace_id = Column(String, nullable=True)

    # Which version of the library's ontology this document was extracted
    # under. Approving a new version does not silently invalidate what is
    # already in the graph — it makes this number stale, which is what the UI
    # reports and what a re-extract clears.
    ontology_version = Column(Integer, nullable=True)

    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())

    __table_args__ = (
        # One row per library document. Re-uploading the same file to the same
        # library updates the row rather than forking its history.
        UniqueConstraint("library_id", "mistral_doc_id", name="uq_rag_document"),
        Index("ix_rag_documents_library_status", "library_id", "status"),
    )


class ExtractionDraft(Base):
    """What a model proposed for one document, before anyone approved it.

    Exactly one draft per document — re-extraction replaces it. Keeping a
    history was tempting and wrong: the interesting artefact is the committed
    graph, and a stack of superseded proposals is state nobody reads and every
    query has to filter past.

    ``payload`` is the whole proposal as JSON (entities and relations) rather
    than normalised rows. It is written once, read whole, edited whole and then
    thrown away at commit; normalising it would buy queries nothing and cost an
    upsert-diff on every keystroke in the review UI.
    """

    __tablename__ = "rag_extraction_drafts"

    id = Column(Integer, primary_key=True)
    document_id = Column(Integer, nullable=False, index=True)

    payload = Column(Text, nullable=False, default="{}")
    entity_count = Column(Integer, nullable=False, default=0)
    relation_count = Column(Integer, nullable=False, default=0)

    # pending   — straight from the model, unreviewed
    # edited    — a human has changed it
    # committed — written to Neo4j; kept so the UI can show what was approved
    status = Column(String, nullable=False, default="pending", index=True)

    model = Column(String, nullable=True)
    rules = Column(Text, nullable=True)

    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())

    __table_args__ = (
        UniqueConstraint("document_id", name="uq_rag_draft_document"),
    )


class LibraryOntology(Base):
    """The content schema for one library: what may be extracted from it.

    A library is one industry, domain or use case — all contracts, all incident
    reports — so the *kinds* of thing worth extracting are a property of the
    library, not of each document. Storing the schema here rather than deriving
    it per document is what keeps a graph connected: two documents typing the
    same company differently produce two nodes, because entity identity in Neo4j
    is ``(library_id, normalized, type)``.

    Versioned and append-only. Approving a new version supersedes the old one
    but never rewrites it: documents already in the graph were extracted under
    the version stamped on them, and knowing which is the only way to tell a
    stale document from a current one.

    ``prompt`` is the generated, use-case-specific part of the extraction
    instruction — what to look for in *this* library. It is spliced into the
    fixed contract rather than replacing it; the evidence requirement and the
    JSON output shape are not negotiable and are not stored here.
    """

    __tablename__ = "rag_library_ontology"

    id = Column(Integer, primary_key=True)
    library_id = Column(String, nullable=False, index=True)
    version = Column(Integer, nullable=False, default=1)

    # draft      — proposed or hand-edited, not yet governing extraction
    # approved   — the one version new extractions run under
    # superseded — kept for the documents still stamped with it
    status = Column(String, nullable=False, default="draft", index=True)

    # What the architect understood the library to be about. Shown to the
    # reviewer as the justification for the schema it proposed.
    summary = Column(Text, nullable=True)

    # JSON [{name, description, examples[]}]
    entity_types = Column(Text, nullable=False, default="[]")
    # JSON [{name, description, source_types[], target_types[]}]
    #
    # The half that matters most. Predicates are uncontrolled today, and the
    # same fact extracted twice came back as "pays" and "pays_invoice_to" —
    # two edges in Neo4j, so a traversal filtering on one misses the other.
    predicates = Column(Text, nullable=False, default="[]")

    prompt = Column(Text, nullable=True)
    # JSON list of the documents sampled to propose this schema.
    source_document_ids = Column(Text, nullable=True)
    model = Column(String, nullable=True)

    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())
    approved_at = Column(DateTime, nullable=True)

    __table_args__ = (
        UniqueConstraint("library_id", "version", name="uq_library_ontology_version"),
        Index("ix_library_ontology_status", "library_id", "status"),
    )


class ExtractionRule(Base):
    """Per-library default extraction rules.

    A library is usually one kind of document — all contracts, all incident
    reports — so the rule that makes extraction useful is the same for every
    file in it. Storing it per library means the user writes it once and each
    upload inherits it, while still being free to override for one document.
    """

    __tablename__ = "rag_extraction_rules"

    library_id = Column(String, primary_key=True)
    rules = Column(Text, nullable=False, default="")
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())


class SystemAgent(Base):
    """Agents the platform owns rather than the user.

    Currently one: the query optimiser every RAG query passes through. It is
    created on boot and must not be deletable, so its id has to survive a
    restart — otherwise each boot would create another one and the workspace
    would fill with orphaned optimisers.
    """

    __tablename__ = "rag_system_agents"

    key = Column(String, primary_key=True)      # e.g. "query_optimizer"
    agent_id = Column(String, nullable=False)
    name = Column(String, nullable=True)
    model = Column(String, nullable=True)
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())


class RagEvent(Base):
    """One stage of one processing run — the timeline.

    Every stage of ingestion and of a RAG query writes a row here: when it
    started, how long it took, whether it worked, and enough metadata to explain
    itself. Two reasons this is a table rather than log lines:

    * Ingestion is asynchronous and can take minutes. Without a record the UI
      has nothing to show between "upload" and "draft ready", which reads as a
      hang rather than as work in progress.
    * A RAG answer is assembled from four sources (optimiser, entity match,
      traversal, library search). When it is wrong, the only way to find out
      *which* stage was wrong is to see them separately, with their timings.

    ``parent_id`` makes the timeline a tree, so per-chunk extraction nests under
    the extraction stage instead of flattening into forty sibling rows.
    """

    __tablename__ = "rag_events"

    id = Column(Integer, primary_key=True)
    trace_id = Column(String, nullable=False, index=True)
    parent_id = Column(Integer, nullable=True)

    # ingest | query — which pipeline this trace belongs to.
    scope = Column(String, nullable=False, default="ingest", index=True)
    # A stable handle for what is being processed: "document:12", "library:abc",
    # "agent:ag_1". Indexed so the UI can list every trace for one document.
    subject = Column(String, nullable=False, index=True)

    stage = Column(String, nullable=False)
    # running | ok | failed | skipped
    status = Column(String, nullable=False, default="running", index=True)
    message = Column(Text, nullable=True)
    # JSON object. Counts, model names, chunk indices — whatever makes the row
    # explain itself without opening the source.
    meta = Column(Text, nullable=True)

    # Ordering within a trace. Wall-clock timestamps collide at SQLite's
    # resolution when stages are fast, and a timeline that renders out of order
    # is worse than no timeline.
    seq = Column(Integer, nullable=False, default=0)

    started_at = Column(DateTime, server_default=func.now())
    ended_at = Column(DateTime, nullable=True)
    duration_ms = Column(Integer, nullable=True)

    __table_args__ = (
        Index("ix_rag_events_trace_seq", "trace_id", "seq"),
        Index("ix_rag_events_subject_started", "subject", "started_at"),
    )
