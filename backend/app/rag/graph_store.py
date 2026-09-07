"""
The knowledge graph itself — Neo4j over Bolt.

Shape of the graph::

    (:Library {id, name})
    (:Document {id, library_id, filename})
    (:Entity   {id, library_id, name, normalized, type, description,
                aliases, aliases_text, confidence, source})

    (:Entity)-[:REL {predicate, evidence, doc_id, confidence, source}]->(:Entity)
    (:Entity)-[:MENTIONED_IN {quote, chunk_index}]->(:Document)
    (:Document)-[:IN_LIBRARY]->(:Library)

Two decisions worth stating, because both look wrong at first glance.

**One relationship type, with the verb as a property.** Neo4j idiom would be a
distinct type per predicate (``:SUPPLIES``, ``:REPORTS_TO``). But predicates here
come from an LLM reading arbitrary documents, so the set is open — and a
variable-length traversal over an open set of types needs either APOC string
procedures or a query rebuilt per call. ``[:REL*1..2]`` with a predicate property
traverses in one static query, and filtering by predicate stays a WHERE clause.

**Entity identity is (library, normalized name, type).** Not a global id: the
same string means different things in different libraries, and merging "Apollo"
the project with "Apollo" the supplier because two unrelated libraries mention
both would corrupt every answer drawn from either. Identity is scoped to the
library that produced it, and cross-library reach is a retrieval-time decision.

Every function degrades rather than raises. An unreachable graph must leave the
platform working — RAG falls back to the document library alone, which is the
behaviour the agent had before this feature existed.
"""

from __future__ import annotations

import logging
import threading
from typing import Any, Iterable, Optional

from app.config import settings

logger = logging.getLogger(__name__)

_driver = None
_driver_lock = threading.Lock()
_unavailable_reason: Optional[str] = None


def _get_driver():
    """The shared Bolt driver, or None when the graph cannot be reached.

    Built once and cached. Connection failure is cached too — as a reason
    string, not an exception — because the retrieval tool asks "is the graph
    available" on the hot path of every RAG query, and a five-second TCP timeout
    per query would be worse than no graph at all.
    """
    global _driver, _unavailable_reason

    if _driver is not None:
        return _driver

    with _driver_lock:
        if _driver is not None:
            return _driver
        try:
            from neo4j import GraphDatabase
        except ImportError:
            _unavailable_reason = (
                "the neo4j driver is not installed (pip install -r requirements.txt)"
            )
            return None
        try:
            driver = GraphDatabase.driver(
                settings.NEO4J_URI,
                auth=(settings.NEO4J_USER, settings.NEO4J_PASSWORD),
                connection_timeout=5.0,
                max_connection_lifetime=600,
            )
            driver.verify_connectivity()
        except Exception as e:
            _unavailable_reason = f"{settings.NEO4J_URI} is unreachable ({e})"
            logger.warning("Knowledge graph unavailable: %s", _unavailable_reason)
            return None

        _driver = driver
        _unavailable_reason = None
        logger.info("Knowledge graph connected: %s", settings.NEO4J_URI)
        return _driver


def reset_connection() -> None:
    """Forget a cached failure so the next call retries.

    Called after a user starts the container without restarting the backend,
    which is the common case during setup.
    """
    global _driver, _unavailable_reason
    with _driver_lock:
        if _driver is not None:
            try:
                _driver.close()
            except Exception:
                pass
        _driver = None
        _unavailable_reason = None


def close() -> None:
    """Release the driver on shutdown."""
    global _driver
    with _driver_lock:
        if _driver is not None:
            try:
                _driver.close()
            except Exception:
                pass
            _driver = None


def available() -> bool:
    return _get_driver() is not None


def status() -> dict:
    """Whether the graph is usable, and why not when it is not."""
    driver = _get_driver()
    return {
        "available": driver is not None,
        "uri": settings.NEO4J_URI,
        "database": settings.NEO4J_DATABASE,
        "reason": None if driver is not None else _unavailable_reason,
    }


def _run(query: str, **params) -> list[dict]:
    """Execute one Cypher statement. Returns [] when the graph is unavailable."""
    driver = _get_driver()
    if driver is None:
        return []
    try:
        with driver.session(database=settings.NEO4J_DATABASE) as session:
            return [record.data() for record in session.run(query, **params)]
    except Exception as e:
        logger.warning("Cypher failed (%.60s…): %s", query.strip().replace("\n", " "), e)
        raise


# ── Ad hoc queries (the Query tab) ──────────────────────────────────────────

import re as _re

# A fast, friendly pre-check. The actual boundary is `execute_read` below —
# Neo4j itself rejects a write clause inside a read transaction — this just
# turns the common case into a clear 400 instead of a driver stack trace.
_WRITE_KEYWORDS = _re.compile(
    r"\b(CREATE|MERGE|DELETE|DETACH|SET|REMOVE|DROP|LOAD\s+CSV|FOREACH)\b"
    r"|CALL\s*\{",
    _re.IGNORECASE,
)


def run_cypher(query: str, params: Optional[dict] = None, limit: int = 200) -> dict:
    """Run an arbitrary, read-only Cypher query and shape it as a graph.

    Built for the Query tab: paste a Cypher statement, get back whichever
    nodes and relationships it touched — the same ``{nodes, edges}`` shape the
    unified graph endpoint returns, so the existing Sigma canvas renders it
    with no adapter. A query that returns scalars instead of graph elements
    (``RETURN count(*)``, an aggregation, a property projection) still comes
    back as ``rows``/``columns`` for a plain table.

    Read-only is enforced twice: the keyword pre-check above, and — the real
    boundary — ``session.execute_read``, which Neo4j rejects a write clause
    inside regardless of what slipped past the regex.
    """
    query = (query or "").strip()
    if not query:
        raise ValueError("Empty query.")
    if _WRITE_KEYWORDS.search(query):
        raise ValueError(
            "Only read queries are allowed here — no CREATE, MERGE, DELETE, SET, "
            "REMOVE, DROP, CALL {…}, LOAD CSV or FOREACH."
        )

    driver = _get_driver()
    if driver is None:
        return {
            "available": False, "nodes": [], "edges": [], "rows": [], "columns": [],
            "counts": {}, "truncated": False, "reason": _unavailable_reason,
        }

    from neo4j.graph import Node as Neo4jNode, Path, Relationship

    nodes: dict[str, dict] = {}
    edges: dict[str, dict] = {}
    rows: list[dict] = []
    state: dict[str, Any] = {"columns": []}

    def node_key(n: Neo4jNode) -> str:
        return f"n{getattr(n, 'element_id', None) or n.id}"

    def add_node(n: Neo4jNode) -> str:
        key = node_key(n)
        if key not in nodes:
            props = dict(n)
            label_kind = ":".join(sorted(n.labels)) or "Node"
            display = props.get("name") or props.get("label") or props.get("title") or props.get("id")
            nodes[key] = {
                "id": key,
                "kind": "entity",
                "type": label_kind,
                "labels": sorted(n.labels),
                "label": str(display) if display is not None else label_kind,
                "degree": 0,
                # The real Neo4j element id, distinct from `id` above (which is
                # namespaced for this response) — what a follow-up "expand this
                # node" query addresses it by, via Cypher's elementId().
                "element_id": getattr(n, "element_id", None) or str(n.id),
                **{k: v for k, v in props.items() if k not in ("name", "label")},
            }
        return key

    def add_rel(r: Relationship) -> None:
        key = f"e{getattr(r, 'element_id', None) or r.id}"
        if key in edges or r.start_node is None or r.end_node is None:
            return
        source = add_node(r.start_node)
        target = add_node(r.end_node)
        edges[key] = {
            "source": source,
            "target": target,
            "predicate": r.type,
            **dict(r),
        }
        nodes[source]["degree"] += 1
        nodes[target]["degree"] += 1

    def walk(value: Any) -> Any:
        if isinstance(value, Neo4jNode):
            add_node(value)
            return dict(value)
        if isinstance(value, Relationship):
            add_rel(value)
            return dict(value)
        if isinstance(value, Path):
            for n in value.nodes:
                add_node(n)
            for r in value.relationships:
                add_rel(r)
            return {"path_length": len(value.relationships)}
        if isinstance(value, list):
            return [walk(v) for v in value]
        if isinstance(value, dict):
            return {k: walk(v) for k, v in value.items()}
        return value

    def work(tx):
        result = tx.run(query, **(params or {}))
        state["columns"] = list(result.keys())
        count = 0
        for record in result:
            if count >= limit:
                break
            rows.append({key: walk(record[key]) for key in state["columns"]})
            count += 1
        return count

    try:
        with driver.session(database=settings.NEO4J_DATABASE) as session:
            returned = session.execute_read(work)
    except Exception as e:
        logger.info("Ad hoc Cypher rejected or failed (%.80s…): %s", query.replace("\n", " "), e)
        raise

    counts: dict[str, int] = {}
    for node in nodes.values():
        counts[node["type"]] = counts.get(node["type"], 0) + 1

    return {
        "available": True,
        "nodes": list(nodes.values()),
        "edges": list(edges.values()),
        "rows": rows,
        "columns": state["columns"],
        "row_count": returned,
        "counts": counts,
        "truncated": returned >= limit,
    }


# ── Schema ─────────────────────────────────────────────────────────────────

_CONSTRAINTS = (
    "CREATE CONSTRAINT rag_library_id IF NOT EXISTS "
    "FOR (l:Library) REQUIRE l.id IS UNIQUE",
    "CREATE CONSTRAINT rag_document_id IF NOT EXISTS "
    "FOR (d:Document) REQUIRE d.id IS UNIQUE",
    # Composite identity — see the module docstring for why it is scoped to the
    # library rather than global.
    "CREATE CONSTRAINT rag_entity_key IF NOT EXISTS "
    "FOR (e:Entity) REQUIRE (e.library_id, e.normalized, e.type) IS UNIQUE",
)

#: The index retrieval actually runs on. Entity matching is the entry point to
#: every graph query, so it is a full-text index rather than a property lookup:
#: a user asking about "the Northwind contract" must reach the entity stored as
#: "Northwind Trading Ltd", and exact matching never would.
_FULLTEXT = (
    "CREATE FULLTEXT INDEX entitySearch IF NOT EXISTS "
    "FOR (e:Entity) ON EACH [e.name, e.aliases_text, e.description]"
)


def ensure_constraints() -> bool:
    """Create constraints and the entity full-text index. Idempotent."""
    if not available():
        return False
    try:
        for statement in _CONSTRAINTS:
            _run(statement)
        _run(_FULLTEXT)
        logger.info("Knowledge graph schema verified")
        return True
    except Exception as e:
        logger.warning("Could not verify knowledge graph schema: %s", e)
        return False


# ── Writes ─────────────────────────────────────────────────────────────────


def commit_document(
    *,
    library_id: str,
    library_name: str,
    document_id: str,
    filename: str,
    entities: list[dict],
    relations: list[dict],
) -> dict:
    """Replace this document's slice of the graph with an approved draft.

    Replace, not append: committing twice must produce the same graph as
    committing once, and a re-extraction that dropped a wrong entity has to
    actually remove it. The previous slice is identified by ``doc_id`` on the
    relations and by this document's ``MENTIONED_IN`` edges.

    Entities shared with other documents survive the delete — only entities left
    with no mentions and no relations are removed, which is exactly the set that
    this document was the sole source of.
    """
    if not available():
        raise RuntimeError("The knowledge graph is unavailable.")

    _run(
        """
        MERGE (l:Library {id: $library_id})
          ON CREATE SET l.created_at = datetime()
        SET l.name = $library_name
        MERGE (d:Document {id: $document_id})
          ON CREATE SET d.created_at = datetime()
        SET d.library_id = $library_id, d.filename = $filename,
            d.updated_at = datetime()
        MERGE (d)-[:IN_LIBRARY]->(l)
        """,
        library_id=library_id,
        library_name=library_name or library_id,
        document_id=document_id,
        filename=filename,
    )

    # Clear the old slice first so a shrinking draft actually shrinks the graph.
    _run(
        """
        MATCH (:Entity)-[m:MENTIONED_IN]->(d:Document {id: $document_id})
        DELETE m
        """,
        document_id=document_id,
    )
    _run(
        """
        MATCH (:Entity)-[r:REL {doc_id: $document_id}]->(:Entity)
        DELETE r
        """,
        document_id=document_id,
    )

    if entities:
        # An entity is shared between documents, so its properties are *merged*
        # rather than overwritten. Assigning them outright meant the second
        # document to mention a company silently wiped the aliases and the
        # fuller name the first one had contributed — and with the aliases went
        # the full-text index entry that made the entity findable by them.
        #
        # Per property:
        #   name        — the longest wins. Later mentions abbreviate ("NTL"),
        #                 and the fullest form is the one worth displaying.
        #   description — this commit wins when it says anything, so a reviewer's
        #                 edit takes effect rather than being outranked by an
        #                 older, longer sentence.
        #   aliases     — the union. Known limitation: removing an alias in
        #                 review does not delete it from the node, because
        #                 nothing records which document contributed it. Deleting
        #                 the entity and re-committing is the way to reset one.
        #   confidence  — the maximum; one document being unsure does not make
        #                 the graph less sure of what another stated plainly.
        _run(
            """
            UNWIND $rows AS row
            MERGE (e:Entity {library_id: $library_id,
                             normalized: row.normalized,
                             type: row.type})
              ON CREATE SET e.created_at = datetime()
            WITH e, row,
                 [a IN coalesce(e.aliases, []) WHERE NOT a IN row.aliases]
                   + row.aliases AS merged_aliases
            SET e.name = CASE
                    WHEN size(coalesce(e.name, '')) >= size(row.name)
                    THEN e.name ELSE row.name END,
                e.description = CASE
                    WHEN row.description IS NULL OR row.description = ''
                    THEN e.description ELSE row.description END,
                e.aliases      = merged_aliases,
                e.aliases_text = trim(reduce(s = '', a IN merged_aliases | s + ' ' + a)),
                e.confidence = CASE
                    WHEN coalesce(e.confidence, 0.0) >= row.confidence
                    THEN e.confidence ELSE row.confidence END,
                e.source     = row.source,
                e.updated_at = datetime()
            WITH e, row
            MATCH (d:Document {id: $document_id})
            FOREACH (mention IN row.mentions |
                MERGE (e)-[m:MENTIONED_IN {chunk_index: mention.chunk_index}]->(d)
                SET m.quote = mention.quote)
            """,
            rows=entities,
            library_id=library_id,
            document_id=document_id,
        )

    if relations:
        _run(
            """
            UNWIND $rows AS row
            MATCH (s:Entity {library_id: $library_id,
                             normalized: row.source_normalized,
                             type: row.source_type})
            MATCH (t:Entity {library_id: $library_id,
                             normalized: row.target_normalized,
                             type: row.target_type})
            MERGE (s)-[r:REL {predicate: row.predicate, doc_id: $document_id}]->(t)
            SET r.evidence   = row.evidence,
                r.confidence = row.confidence,
                r.source     = row.source,
                r.updated_at = datetime()
            """,
            rows=relations,
            library_id=library_id,
            document_id=document_id,
        )

    # Entities this document was the only source of, now that its slice is gone.
    orphans = _run(
        """
        MATCH (e:Entity {library_id: $library_id})
        WHERE NOT (e)-[:MENTIONED_IN]->(:Document) AND NOT (e)-[:REL]-()
        DELETE e
        RETURN count(e) AS removed
        """,
        library_id=library_id,
    )

    # Relations are counted from the graph because MERGE collapses duplicates
    # the draft may still contain; entities are counted from the draft because
    # one added during review has no mention edge to be counted by.
    written = _run(
        """
        MATCH ()-[r:REL {doc_id: $document_id}]->()
        RETURN count(r) AS relations
        """,
        document_id=document_id,
    )

    return {
        "entities": len(entities),
        "relations": written[0]["relations"] if written else len(relations),
        "orphans_removed": orphans[0]["removed"] if orphans else 0,
    }


def delete_document_graph(document_id: str, library_id: str) -> dict:
    """Remove one document and everything it alone contributed."""
    if not available():
        return {"deleted": False, "reason": "graph unavailable"}
    _run(
        "MATCH ()-[r:REL {doc_id: $document_id}]->() DELETE r",
        document_id=document_id,
    )
    _run(
        """
        MATCH (d:Document {id: $document_id})
        DETACH DELETE d
        """,
        document_id=document_id,
    )
    orphans = _run(
        """
        MATCH (e:Entity {library_id: $library_id})
        WHERE NOT (e)-[:MENTIONED_IN]->(:Document) AND NOT (e)-[:REL]-()
        DELETE e
        RETURN count(e) AS removed
        """,
        library_id=library_id,
    )
    return {"deleted": True, "orphans_removed": orphans[0]["removed"] if orphans else 0}


def delete_library_graph(library_id: str) -> dict:
    """Remove a whole library's graph, for when the library itself is deleted."""
    if not available():
        return {"deleted": False, "reason": "graph unavailable"}
    _run(
        """
        MATCH (d:Document {library_id: $library_id}) DETACH DELETE d
        """,
        library_id=library_id,
    )
    _run(
        """
        MATCH (e:Entity {library_id: $library_id}) DETACH DELETE e
        """,
        library_id=library_id,
    )
    _run("MATCH (l:Library {id: $library_id}) DETACH DELETE l", library_id=library_id)
    return {"deleted": True}


# ── Reads ──────────────────────────────────────────────────────────────────


def stats(library_ids: Optional[Iterable[str]] = None) -> dict:
    """Entity, relation and document counts, per library and in total."""
    if not available():
        return {"available": False, "libraries": {}, "totals": {}}

    ids = [lid for lid in (library_ids or []) if lid] or None
    try:
        rows = _run(
            """
            MATCH (e:Entity)
            WHERE $ids IS NULL OR e.library_id IN $ids
            WITH e.library_id AS library_id, count(e) AS entities
            OPTIONAL MATCH (s:Entity {library_id: library_id})-[r:REL]->(:Entity)
            WITH library_id, entities, count(r) AS relations
            OPTIONAL MATCH (d:Document {library_id: library_id})
            RETURN library_id, entities, relations, count(d) AS documents
            """,
            ids=ids,
        )
    except Exception:
        return {"available": False, "libraries": {}, "totals": {}}

    libraries = {
        row["library_id"]: {
            "entities": row["entities"],
            "relations": row["relations"],
            "documents": row["documents"],
        }
        for row in rows
        if row.get("library_id")
    }
    totals = {
        "entities": sum(v["entities"] for v in libraries.values()),
        "relations": sum(v["relations"] for v in libraries.values()),
        "documents": sum(v["documents"] for v in libraries.values()),
        "libraries": len(libraries),
    }
    return {"available": True, "libraries": libraries, "totals": totals}


def has_coverage(library_ids: Iterable[str]) -> bool:
    """Whether these libraries hold any graph at all.

    The same question the knowledge tool asks before attaching itself: an agent
    whose libraries are ungraphed gains only a wasted tool round trip from
    carrying the graph tool.
    """
    ids = [lid for lid in (library_ids or []) if lid]
    if not ids or not available():
        return False
    try:
        rows = _run(
            """
            MATCH (e:Entity) WHERE e.library_id IN $ids
            RETURN count(e) AS entities LIMIT 1
            """,
            ids=ids,
        )
    except Exception:
        return False
    return bool(rows and rows[0]["entities"])


# ── Retrieval ──────────────────────────────────────────────────────────────

# Characters Lucene treats as syntax. A user question is prose, not a query
# language, and an unescaped "?" or ":" makes the whole full-text call throw
# rather than return nothing — which would take the graph out of an answer for
# the most ordinary possible reason.
_LUCENE_SPECIAL = str.maketrans(
    {c: " " for c in '+-&|!(){}[]^"~*?:\\/'}
)

# Words that match everything and rank nothing. Same idea as the knowledge
# matcher's list, trimmed to what actually shows up in questions.
_QUERY_STOPWORDS = frozenset(
    """
    a an the and or of for to in on with from by at is are was were be been
    what how why when which who whom does do did can could should would will
    tell me about show give find list explain any some all this that these
    those it its their there here more most between related relationship
    """.split()
)


def _lucene_query(text: str, extra_terms: Optional[Iterable[str]] = None) -> str:
    """Turn a question into a full-text query the index will accept.

    Terms are OR-ed, and anything long enough gets a fuzzy suffix. Fuzziness is
    the point of using a full-text index at all here: a question mentioning
    "Northwinds" has to reach the entity stored as "Northwind", and an exact
    match never would.
    """
    words: list[str] = []
    for source in (text or "", " ".join(extra_terms or [])):
        for word in source.translate(_LUCENE_SPECIAL).lower().split():
            cleaned = word.strip("'`,.;")
            if len(cleaned) > 2 and cleaned not in _QUERY_STOPWORDS:
                words.append(cleaned)

    seen: list[str] = []
    for word in words:
        if word not in seen:
            seen.append(word)
    if not seen:
        return ""

    # Fuzzy on longer words only — an edit distance of one on a four-letter
    # word matches most of the dictionary.
    return " OR ".join(f"{w}~1" if len(w) >= 6 else w for w in seen[:24])


def match_entities(
    query: str,
    *,
    library_ids: Optional[Iterable[str]] = None,
    hints: Optional[Iterable[str]] = None,
    limit: int = 8,
) -> list[dict]:
    """Entities whose name, aliases or description match the query.

    This is the entry point to every graph retrieval: nothing is traversed
    until something has been *matched*, so retrieval quality is bounded by how
    well a question's wording reaches an entity. ``hints`` are the optimiser's
    extracted entity names, which is why it runs first — they match far more
    reliably than the raw sentence around them.
    """
    if not available():
        return []

    lucene = _lucene_query(query, hints)
    if not lucene:
        return []

    ids = [lid for lid in (library_ids or []) if lid] or None
    try:
        rows = _run(
            """
            CALL db.index.fulltext.queryNodes('entitySearch', $q, {limit: $probe})
            YIELD node, score
            WHERE $ids IS NULL OR node.library_id IN $ids
            RETURN node.name        AS name,
                   node.normalized  AS normalized,
                   node.type        AS type,
                   node.description AS description,
                   node.aliases     AS aliases,
                   node.library_id  AS library_id,
                   node.confidence  AS confidence,
                   score            AS score
            ORDER BY score DESC
            LIMIT $limit
            """,
            q=lucene,
            ids=ids,
            # Over-fetch before the library filter: the index does not know
            # about scoping, so filtering after a tight limit would drop the
            # right entity because unrelated libraries out-scored it.
            probe=max(limit * 10, 50),
            limit=limit,
        )
    except Exception as e:
        logger.warning("Entity match failed: %s", e)
        return []
    return rows


def neighborhood(
    seeds: list[dict],
    *,
    hops: int = 2,
    limit: int = 40,
    min_confidence: float = 0.0,
) -> list[dict]:
    """Every relation within ``hops`` of the matched entities.

    ``hops`` is interpolated into the query rather than passed as a parameter
    because Cypher requires a literal bound on a variable-length pattern. It is
    clamped to 1-3 first: the value never comes from a user, and three hops on a
    dense graph already returns more than a prompt can carry.

    Direction is ignored during traversal (``-[:REL*]-`` rather than ``->``) and
    restored in the result. A supplier reached from its customer is exactly as
    relevant as the other way round, and half the graph is unreachable if the
    arrow has to point the right way.
    """
    if not available() or not seeds:
        return []

    depth = max(1, min(3, int(hops)))
    query = f"""
        UNWIND $seeds AS seed
        MATCH (s:Entity {{library_id: seed.library_id,
                          normalized: seed.normalized,
                          type: seed.type}})
        MATCH path = (s)-[:REL*1..{depth}]-(:Entity)
        WITH path, length(path) AS hops
        UNWIND relationships(path) AS r
        WITH r, min(hops) AS hops
        WHERE coalesce(r.confidence, 1.0) >= $min_confidence
        OPTIONAL MATCH (doc:Document {{id: r.doc_id}})
        RETURN startNode(r).name       AS source_name,
               startNode(r).type       AS source_type,
               startNode(r).normalized AS source_normalized,
               endNode(r).name         AS target_name,
               endNode(r).type         AS target_type,
               endNode(r).normalized   AS target_normalized,
               r.predicate             AS predicate,
               r.evidence              AS evidence,
               r.confidence            AS confidence,
               r.doc_id                AS doc_id,
               doc.filename            AS filename,
               hops                    AS hops
        ORDER BY hops ASC, coalesce(r.confidence, 0.0) DESC
        LIMIT $limit
    """
    try:
        return _run(query, seeds=seeds, limit=limit, min_confidence=min_confidence)
    except Exception as e:
        logger.warning("Graph traversal failed: %s", e)
        return []


def entity_context(seeds: list[dict], *, limit: int = 24) -> list[dict]:
    """The document passages the matched entities were extracted from.

    The traversal answers "what is this connected to"; this answers "what did
    the document actually say about it". Both are needed: a triple without its
    sentence is an assertion the reader cannot check, and checkability is the
    whole reason evidence is mandatory at extraction.
    """
    if not available() or not seeds:
        return []
    try:
        return _run(
            """
            UNWIND $seeds AS seed
            MATCH (e:Entity {library_id: seed.library_id,
                             normalized: seed.normalized,
                             type: seed.type})-[m:MENTIONED_IN]->(d:Document)
            RETURN e.name        AS name,
                   e.type        AS type,
                   e.description AS description,
                   d.id          AS doc_id,
                   d.filename    AS filename,
                   m.quote       AS quote,
                   m.chunk_index AS chunk_index
            ORDER BY e.name, m.chunk_index
            LIMIT $limit
            """,
            seeds=seeds,
            limit=limit,
        )
    except Exception as e:
        logger.warning("Entity context lookup failed: %s", e)
        return []


def snapshot(
    *,
    library_id: Optional[str] = None,
    document_id: Optional[str] = None,
    limit: int = 500,
) -> dict:
    """Nodes and edges for a graph view.

    Three scopes, one query shape: a document (what this file contributed), a
    library (everything in it, merged across its documents) and everything.
    ``limit`` bounds the node count — a browser renders a few hundred nodes
    usefully and a few thousand not at all.
    """
    if not available():
        return {"available": False, "nodes": [], "edges": [], "truncated": False}

    # Relationship properties are returned one by one rather than as the
    # relationship itself: driver records render a relationship as a
    # (start, type, end) tuple, not as its property map, so `r AS rel` would
    # arrive in a shape nothing here can read.
    _EDGE_FIELDS = """
               r.predicate  AS predicate,
               r.evidence   AS evidence,
               r.doc_id     AS doc_id,
               r.confidence AS confidence
    """

    if document_id:
        rows = _run(
            f"""
            MATCH (e:Entity)-[:MENTIONED_IN]->(d:Document {{id: $document_id}})
            WITH collect(DISTINCT e) AS ents
            UNWIND ents AS e
            OPTIONAL MATCH (e)-[r:REL {{doc_id: $document_id}}]->(t:Entity)
            RETURN e AS source, t AS target, {_EDGE_FIELDS}
            LIMIT $limit
            """,
            document_id=document_id,
            limit=limit * 4,
        )
    elif library_id:
        rows = _run(
            f"""
            MATCH (e:Entity {{library_id: $library_id}})
            OPTIONAL MATCH (e)-[r:REL]->(t:Entity)
            RETURN e AS source, t AS target, {_EDGE_FIELDS}
            LIMIT $limit
            """,
            library_id=library_id,
            limit=limit * 4,
        )
    else:
        rows = _run(
            f"""
            MATCH (e:Entity)
            OPTIONAL MATCH (e)-[r:REL]->(t:Entity)
            RETURN e AS source, t AS target, {_EDGE_FIELDS}
            LIMIT $limit
            """,
            limit=limit * 4,
        )

    nodes: dict[str, dict] = {}
    edges: list[dict] = []

    def _node(raw: Optional[dict]) -> Optional[str]:
        if not raw:
            return None
        key = f"{raw.get('library_id')}::{raw.get('normalized')}::{raw.get('type')}"
        if key not in nodes:
            nodes[key] = {
                "id": key,
                "label": raw.get("name") or raw.get("normalized") or "?",
                "type": raw.get("type") or "Concept",
                "description": raw.get("description") or "",
                "library_id": raw.get("library_id"),
                "confidence": raw.get("confidence"),
                "degree": 0,
            }
        return key

    for row in rows:
        source_key = _node(row.get("source"))
        target_key = _node(row.get("target"))
        # An OPTIONAL MATCH that found no edge still yields the node row, which
        # is what puts isolated entities on the canvas rather than hiding them.
        if source_key and target_key and row.get("predicate"):
            edges.append(
                {
                    "source": source_key,
                    "target": target_key,
                    "predicate": row.get("predicate") or "related_to",
                    "evidence": row.get("evidence") or "",
                    "doc_id": row.get("doc_id"),
                    "confidence": row.get("confidence"),
                }
            )
            nodes[source_key]["degree"] += 1
            nodes[target_key]["degree"] += 1

    truncated = len(nodes) > limit
    if truncated:
        # Keep the best-connected nodes: a truncated graph should still show the
        # hubs, which are what makes the shape readable at a glance.
        keep = sorted(nodes.values(), key=lambda n: -n["degree"])[:limit]
        keep_ids = {n["id"] for n in keep}
        nodes = {n["id"]: n for n in keep}
        edges = [e for e in edges if e["source"] in keep_ids and e["target"] in keep_ids]

    return {
        "available": True,
        "nodes": list(nodes.values()),
        "edges": edges,
        "truncated": truncated,
    }
