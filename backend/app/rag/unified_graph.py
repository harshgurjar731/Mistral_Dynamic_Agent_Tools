"""
One graph, four levels.

Until now the platform drew two unrelated pictures: the taxonomy (a SKOS tree in
SQLite, rendered by ``ontology/graph.py``) and the document graph (entities in
Neo4j). Neither could show the thing that actually matters — that *this* library
serves *that* domain, and *these* entities came from documents inside it.

Mirroring the taxonomy into Neo4j makes it one picture:

    (:Concept)-[:BROADER]->(:Concept)          the domain tree
    (:Library)-[:SERVES_DOMAIN]->(:Concept)    what a library is about
    (:Document)-[:IN_LIBRARY]->(:Library)      what is in it
    (:Entity)-[:MENTIONED_IN]->(:Document)     what the documents say
    (:Entity)-[:REL]->(:Entity)                how those things connect

**SQLite stays the source of truth for the taxonomy.** Planning, validation and
scoping must keep working with Neo4j stopped, and they read SQLite. This mirror
is derived state, rebuilt from scratch on demand — so it can never drift into
being a second, disagreeing copy that something starts trusting.

The mirror carries only what a graph view or a cross-level traversal needs:
concept identity and hierarchy, library identity, and the link between them.
Definitions, synonyms and annotations on agents and workflows stay in SQLite,
where the things that read them already live.
"""

from __future__ import annotations

import logging
from typing import Iterable, Optional

from app.rag import graph_store

logger = logging.getLogger(__name__)


def sync_taxonomy(limit_concepts: int = 2000) -> dict:
    """Rebuild the taxonomy mirror in Neo4j from SQLite.

    A full rebuild rather than a diff. The taxonomy is small — a few hundred
    concepts — and a rebuild cannot leave a deleted concept behind, which a
    diff eventually would. Idempotent, so it runs on every boot.
    """
    if not graph_store.available():
        return {"synced": False, "reason": "knowledge graph unavailable"}

    from app.ontology import store as ontology_store
    from app.rag import library_domain

    try:
        concepts = ontology_store.list_concepts()[:limit_concepts]
    except Exception as e:
        logger.warning("Could not read the taxonomy to mirror: %s", e)
        return {"synced": False, "reason": str(e)[:200]}

    if not concepts:
        return {"synced": False, "reason": "taxonomy not seeded"}

    try:
        # Drop the previous mirror. Only Concept nodes and the library links
        # are touched — documents and entities are not derived state.
        graph_store._run("MATCH (c:Concept) DETACH DELETE c")

        graph_store._run(
            """
            UNWIND $rows AS row
            MERGE (c:Concept {id: row.id})
            SET c.label     = row.label,
                c.scheme_id = row.scheme_id,
                c.level     = row.level,
                c.definition= row.definition
            """,
            rows=[
                {
                    "id": c["id"],
                    "label": c.get("label") or c["id"],
                    "scheme_id": c.get("scheme_id") or "",
                    "level": c.get("level") or 0,
                    "definition": (c.get("definition") or "")[:300],
                }
                for c in concepts
            ],
        )

        graph_store._run(
            """
            UNWIND $rows AS row
            MATCH (child:Concept {id: row.id})
            MATCH (parent:Concept {id: row.parent_id})
            MERGE (child)-[:BROADER]->(parent)
            """,
            rows=[
                {"id": c["id"], "parent_id": c["parent_id"]}
                for c in concepts
                if c.get("parent_id")
            ],
        )
    except Exception as e:
        logger.warning("Taxonomy mirror failed: %s", e)
        return {"synced": False, "reason": str(e)[:200]}

    # Libraries already exist as nodes wherever a document was committed. Link
    # whichever of them carry a domain annotation.
    linked = 0
    try:
        library_ids = [
            row["id"]
            for row in graph_store._run("MATCH (l:Library) RETURN l.id AS id")
            if row.get("id")
        ]
        domains = library_domain.domains_for_many(library_ids)
        rows = [
            {"library_id": library_id, "concept_id": concept_id}
            for library_id, concept_ids in domains.items()
            for concept_id in concept_ids
        ]
        graph_store._run(
            "MATCH (:Library)-[r:SERVES_DOMAIN]->(:Concept) DELETE r"
        )
        if rows:
            graph_store._run(
                """
                UNWIND $rows AS row
                MATCH (l:Library {id: row.library_id})
                MATCH (c:Concept {id: row.concept_id})
                MERGE (l)-[:SERVES_DOMAIN]->(c)
                """,
                rows=rows,
            )
            linked = len(rows)
    except Exception as e:
        logger.debug("Could not link libraries to concepts: %s", e)

    logger.info(
        "Taxonomy mirrored: %d concepts, %d library links", len(concepts), linked
    )
    return {"synced": True, "concepts": len(concepts), "library_links": linked}


def link_library(library_id: str, concept_ids: Iterable[str]) -> bool:
    """Refresh one library's domain edges after its annotation changes."""
    if not graph_store.available() or not library_id:
        return False
    try:
        graph_store._run(
            "MATCH (l:Library {id: $library_id})-[r:SERVES_DOMAIN]->(:Concept) DELETE r",
            library_id=library_id,
        )
        ids = [c for c in concept_ids if c]
        if ids:
            graph_store._run(
                """
                MATCH (l:Library {id: $library_id})
                UNWIND $concepts AS concept_id
                MATCH (c:Concept {id: concept_id})
                MERGE (l)-[:SERVES_DOMAIN]->(c)
                """,
                library_id=library_id,
                concepts=ids,
            )
        return True
    except Exception as e:
        logger.debug("Could not link library %s: %s", library_id, e)
        return False


def snapshot(
    *,
    library_id: Optional[str] = None,
    document_id: Optional[str] = None,
    entity_limit: int = 300,
    include_documents: bool = True,
) -> dict:
    """One graph at one of three scopes: a document, a library, or everything.

    Assembled from small queries per level rather than one large union — each
    level has a different shape, and a union that flattened them would need
    unpacking in Python anyway, with worse Cypher.

    **Scoping narrows the taxonomy too.** A library view that carried all 103
    concepts would bury the two that matter under the whole vocabulary, so a
    scoped view keeps only the concepts its library actually serves and their
    ancestors — which is the path from the entity up to the domain, and the
    reason this is one graph rather than two.

    Entities are the only unbounded level, so they are capped by degree: a
    truncated view should still show the hubs, which are what makes the shape
    readable at a glance.
    """
    if not graph_store.available():
        return {
            "available": False, "nodes": [], "edges": [],
            "truncated": False, "counts": {},
        }

    # A document scope implies its library; everything else follows from that.
    if document_id and not library_id:
        owner = graph_store._run(
            "MATCH (d:Document {id: $id}) RETURN d.library_id AS library_id",
            id=document_id,
        )
        if owner:
            library_id = owner[0].get("library_id")

    # Which concepts belong in this view. Unscoped shows the whole taxonomy;
    # scoped shows only what the library serves, plus the ancestors that connect
    # it to the top of the tree.
    concept_scope: Optional[set[str]] = None
    if library_id:
        from app.ontology import store as ontology_store
        from app.rag import library_domain

        concept_scope = set()
        for concept_id in library_domain.domains_for(library_id):
            concept_scope.add(concept_id)
            concept_scope |= ontology_store.ancestors(concept_id, include_self=True)

    nodes: dict[str, dict] = {}
    edges: list[dict] = []

    def add(node_id: str, **fields) -> str:
        if node_id not in nodes:
            nodes[node_id] = {"id": node_id, "degree": 0, **fields}
        return node_id

    def connect(source: str, target: str, predicate: str, **fields) -> None:
        edges.append({"source": source, "target": target, "predicate": predicate, **fields})
        for end in (source, target):
            if end in nodes:
                nodes[end]["degree"] += 1

    try:
        # ── Taxonomy ────────────────────────────────────────────────────
        for row in graph_store._run(
            "MATCH (c:Concept) RETURN c.id AS id, c.label AS label, "
            "c.scheme_id AS scheme, c.level AS level"
        ):
            if concept_scope is not None and row["id"] not in concept_scope:
                continue
            add(
                f"concept::{row['id']}",
                kind="concept",
                label=row.get("label") or row["id"],
                type=row.get("scheme") or "domain",
                level=row.get("level") or 0,
                concept_id=row["id"],
            )

        for row in graph_store._run(
            "MATCH (c:Concept)-[:BROADER]->(p:Concept) "
            "RETURN c.id AS child, p.id AS parent"
        ):
            child, parent = f"concept::{row['child']}", f"concept::{row['parent']}"
            if child in nodes and parent in nodes:
                connect(parent, child, "broader")

        # ── Libraries ───────────────────────────────────────────────────
        for row in graph_store._run(
            "MATCH (l:Library) RETURN l.id AS id, l.name AS name"
        ):
            if library_id and row["id"] != library_id:
                continue
            add(
                f"library::{row['id']}",
                kind="library",
                label=row.get("name") or row["id"],
                type="Library",
                library_id=row["id"],
            )

        for row in graph_store._run(
            "MATCH (l:Library)-[:SERVES_DOMAIN]->(c:Concept) "
            "RETURN l.id AS library, c.id AS concept"
        ):
            library_key, concept_key = f"library::{row['library']}", f"concept::{row['concept']}"
            if library_key in nodes and concept_key in nodes:
                connect(library_key, concept_key, "serves_domain")

        # ── Documents ───────────────────────────────────────────────────
        if include_documents:
            for row in graph_store._run(
                "MATCH (d:Document)-[:IN_LIBRARY]->(l:Library) "
                "RETURN d.id AS id, d.filename AS filename, l.id AS library"
            ):
                if library_id and row["library"] != library_id:
                    continue
                if document_id and row["id"] != document_id:
                    continue
                document_key = add(
                    f"document::{row['id']}",
                    kind="document",
                    label=row.get("filename") or row["id"],
                    type="Document",
                    library_id=row["library"],
                )
                library_key = f"library::{row['library']}"
                if library_key in nodes:
                    connect(document_key, library_key, "in_library")

        # ── Entities, capped by how connected they are ──────────────────
        entity_rows = graph_store._run(
            """
            MATCH (e:Entity)
            WHERE ($library IS NULL OR e.library_id = $library)
              AND ($document IS NULL OR (e)-[:MENTIONED_IN]->(:Document {id: $document}))
            OPTIONAL MATCH (e)-[r:REL]-(:Entity)
            WITH e, count(r) AS degree
            ORDER BY degree DESC
            LIMIT $limit
            RETURN e.library_id  AS library_id,
                   e.normalized  AS normalized,
                   e.type        AS type,
                   e.name        AS name,
                   e.description AS description,
                   degree        AS degree
            """,
            library=library_id,
            document=document_id,
            limit=entity_limit,
        )
        for row in entity_rows:
            key = f"entity::{row['library_id']}::{row['normalized']}::{row['type']}"
            add(
                key,
                kind="entity",
                label=row.get("name") or row["normalized"],
                type=row.get("type") or "Concept",
                description=row.get("description") or "",
                library_id=row.get("library_id"),
            )

        present = set(nodes)

        for row in graph_store._run(
            """
            MATCH (s:Entity)-[r:REL]->(t:Entity)
            WHERE ($library IS NULL OR s.library_id = $library)
              AND ($document IS NULL OR r.doc_id = $document)
            RETURN s.library_id AS s_lib, s.normalized AS s_norm, s.type AS s_type,
                   t.library_id AS t_lib, t.normalized AS t_norm, t.type AS t_type,
                   r.predicate  AS predicate, r.evidence AS evidence,
                   r.confidence AS confidence
            LIMIT $limit
            """,
            library=library_id,
            document=document_id,
            limit=entity_limit * 6,
        ):
            source = f"entity::{row['s_lib']}::{row['s_norm']}::{row['s_type']}"
            target = f"entity::{row['t_lib']}::{row['t_norm']}::{row['t_type']}"
            if source in present and target in present:
                connect(
                    source, target, row.get("predicate") or "related_to",
                    evidence=row.get("evidence") or "",
                    confidence=row.get("confidence"),
                )

        # Entity → document is what ties the content level to everything above
        # it. Without these the graph renders as two disconnected islands.
        if include_documents:
            for row in graph_store._run(
                """
                MATCH (e:Entity)-[:MENTIONED_IN]->(d:Document)
                WHERE ($library IS NULL OR e.library_id = $library)
                  AND ($document IS NULL OR d.id = $document)
                RETURN DISTINCT e.library_id AS lib, e.normalized AS norm,
                       e.type AS type, d.id AS document
                LIMIT $limit
                """,
                library=library_id,
                document=document_id,
                limit=entity_limit * 4,
            ):
                entity_key = f"entity::{row['lib']}::{row['norm']}::{row['type']}"
                document_key = f"document::{row['document']}"
                if entity_key in present and document_key in present:
                    connect(entity_key, document_key, "mentioned_in")

    except Exception as e:
        logger.warning("Unified graph snapshot failed: %s", e)
        return {
            "available": False, "nodes": [], "edges": [],
            "truncated": False, "counts": {}, "reason": str(e)[:200],
        }

    counts: dict[str, int] = {}
    for node in nodes.values():
        counts[node["kind"]] = counts.get(node["kind"], 0) + 1

    return {
        "available": True,
        "nodes": list(nodes.values()),
        "edges": edges,
        "truncated": counts.get("entity", 0) >= entity_limit,
        "counts": counts,
        "library_id": library_id,
        "document_id": document_id,
        "scope": "document" if document_id else ("library" if library_id else "all"),
    }
