"""
Deploy knowledge — carry an agent's knowledge graph into a deployment package.

``search_domain_knowledge`` reads two stores:

* the Neo4j graph built from the agent's document libraries, keyed by
  library id (``:Library``, ``:Document``, ``:Entity`` and their relations);
* the ontology and curated industry knowledge, rows in the backend database,
  with the agent's domains stored as annotations keyed by agent id.

``export_knowledge`` runs on the platform when the package is built: the
libraries' subgraph and those tables, as JSON. ``import_knowledge`` runs in
the deployed worker's bootstrap: it loads the graph into the package's own
Neo4j and the rows into the worker's database, re-keying agent annotations
from the source agent ids to the ids the agents have on the target workspace.
The library ids stay as they are — the deployed agents are created with the
same ``document_library`` tool definitions, so the graph scope lines up.

Both are idempotent: the graph import is skipped when the same export was
already loaded, and rows are upserted by primary key.
"""

from __future__ import annotations

import hashlib
import json
import logging
import time
from collections.abc import Iterable

from sqlalchemy import text

logger = logging.getLogger(__name__)

#: Reference tables the domain search reads, copied whole (small, no secrets).
_TABLES = ("ontology_schemes", "ontology_concepts", "ontology_annotations", "industry_knowledge")
#: Tables copied only for the exported libraries.
_LIBRARY_TABLES = ("rag_library_ontology", "rag_documents")

_BATCH = 500


class KnowledgeExportError(RuntimeError):
    pass


def _jsonable(value):
    if isinstance(value, (str, int, float, bool)) or value is None:
        return value
    if isinstance(value, (list, tuple)):
        return [_jsonable(v) for v in value]
    if isinstance(value, dict):
        return {k: _jsonable(v) for k, v in value.items()}
    return str(value)  # neo4j temporal and spatial values


# ── Export (platform) ─────────────────────────────────────────────────────


def _export_graph(library_ids: list[str]) -> dict:
    from app.rag import graph_store

    if not graph_store.available():
        raise KnowledgeExportError(
            f"The knowledge graph is unreachable ({graph_store.status().get('reason')}), so the "
            "agent's graph cannot be packaged. Start Neo4j and try again.")
    q = graph_store._run
    ids = list(library_ids)
    return {
        "libraries": [_jsonable(r["p"]) for r in q(
            "MATCH (l:Library) WHERE l.id IN $ids RETURN properties(l) AS p", ids=ids)],
        "documents": [_jsonable(r["p"]) for r in q(
            "MATCH (d:Document) WHERE d.library_id IN $ids RETURN properties(d) AS p", ids=ids)],
        "entities": [_jsonable(r["p"]) for r in q(
            "MATCH (e:Entity) WHERE e.library_id IN $ids RETURN properties(e) AS p", ids=ids)],
        "relations": [_jsonable(r) for r in q(
            "MATCH (s:Entity)-[r:REL]->(t:Entity) WHERE s.library_id IN $ids "
            "RETURN s.library_id AS sl, s.normalized AS sn, s.type AS st, "
            "t.library_id AS tl, t.normalized AS tn, t.type AS tt, properties(r) AS p", ids=ids)],
        "mentions": [_jsonable(r) for r in q(
            "MATCH (e:Entity)-[m:MENTIONED_IN]->(d:Document) WHERE e.library_id IN $ids "
            "RETURN e.library_id AS el, e.normalized AS en, e.type AS et, d.id AS doc, "
            "properties(m) AS p", ids=ids)],
    }


def _export_rows(library_ids: list[str]) -> dict:
    from app.database import SessionLocal

    db = SessionLocal()
    try:
        rows: dict[str, list[dict]] = {}
        existing = {r[0] for r in db.execute(text(
            "SELECT name FROM sqlite_master WHERE type='table'")).fetchall()} \
            if db.bind.dialect.name == "sqlite" else set(_TABLES + _LIBRARY_TABLES)
        for table in _TABLES:
            if table in existing:
                rows[table] = [dict(r) for r in db.execute(text(f"SELECT * FROM {table}")).mappings()]
        for table in _LIBRARY_TABLES:
            if table in existing and library_ids:
                params = {f"l{i}": lid for i, lid in enumerate(library_ids)}
                marks = ", ".join(f":{k}" for k in params)
                rows[table] = [dict(r) for r in db.execute(
                    text(f"SELECT * FROM {table} WHERE library_id IN ({marks})"), params).mappings()]
        return {t: [_jsonable(r) for r in rs] for t, rs in rows.items()}
    finally:
        db.close()


def export_knowledge(library_ids: Iterable[str]) -> dict:
    """The graph of these libraries plus the reference tables, as one JSON document."""
    ids = sorted({i for i in library_ids if i})
    graph = _export_graph(ids) if ids else {}
    data = {"library_ids": ids, "graph": graph, "tables": _export_rows(ids)}
    data["hash"] = hashlib.sha256(json.dumps(data, sort_keys=True).encode()).hexdigest()
    return data


def export_rules(agent_ids: Iterable[str]) -> dict:
    """The platform's rules and categories, and these agents' rule selections —
    so a deployed agent is held to the same rules as on the platform."""
    from app.database import SessionLocal

    ids = sorted({i for i in agent_ids if i})
    db = SessionLocal()
    try:
        tables = {t: [dict(r) for r in db.execute(text(f"SELECT * FROM {t}")).mappings()]
                  for t in ("rule_categories", "rules")}
        if ids:
            params = {f"a{i}": aid for i, aid in enumerate(ids)}
            marks = ", ".join(f":{k}" for k in params)
            tables["rule_assignments"] = [dict(r) for r in db.execute(
                text(f"SELECT * FROM rule_assignments WHERE agent_id IN ({marks})"), params).mappings()]
        return {"tables": {t: [_jsonable(r) for r in rs] for t, rs in tables.items()}}
    finally:
        db.close()


def import_rules(data: dict, agent_ids: dict[str, str] | None = None) -> str:
    """Load an ``export_rules`` document, re-keyed to the deployed agents."""
    tables = data.get("tables") or {}
    loaded = _import_rows(data, agent_ids or {})
    return (f"{len(tables.get('rules', []))} rules, "
            f"{len(tables.get('rule_assignments', []))} agent selections ({loaded} rows)")


def summary(data: dict) -> str:
    g = data.get("graph") or {}
    return (f"{len(g.get('entities', []))} entities, {len(g.get('relations', []))} relations, "
            f"{len(g.get('documents', []))} documents in {len(data.get('library_ids', []))} "
            f"librar{'y' if len(data.get('library_ids', [])) == 1 else 'ies'}")


# ── Import (deployed worker) ──────────────────────────────────────────────


def _wait_for_graph(timeout: float) -> None:
    from app.rag import graph_store

    deadline = time.monotonic() + timeout
    while True:
        graph_store.reset_connection()
        if graph_store.available():
            return
        if time.monotonic() > deadline:
            raise RuntimeError(f"Neo4j did not become reachable: {graph_store.status().get('reason')}")
        time.sleep(3)


def _batched(rows: list, size: int = _BATCH):
    for i in range(0, len(rows), size):
        yield rows[i:i + size]


def _import_graph(data: dict, timeout: float) -> str:
    from app.rag import graph_store

    graph = data.get("graph") or {}
    if not graph:
        return "no libraries to load"
    _wait_for_graph(timeout)
    graph_store.ensure_constraints()
    q = graph_store._run
    done = q("MATCH (m:DeploySeed {id: 'knowledge'}) RETURN m.hash AS hash")
    if done and done[0].get("hash") == data.get("hash"):
        return "graph already loaded"

    for rows in _batched(graph.get("libraries", [])):
        q("UNWIND $rows AS p MERGE (l:Library {id: p.id}) SET l += p", rows=rows)
    for rows in _batched(graph.get("documents", [])):
        q("UNWIND $rows AS p MERGE (d:Document {id: p.id}) SET d += p "
          "WITH d MATCH (l:Library {id: d.library_id}) MERGE (d)-[:IN_LIBRARY]->(l)", rows=rows)
    for rows in _batched(graph.get("entities", [])):
        q("UNWIND $rows AS p MERGE (e:Entity {library_id: p.library_id, normalized: p.normalized, "
          "type: p.type}) SET e += p", rows=rows)
    for rows in _batched(graph.get("relations", [])):
        q("UNWIND $rows AS r "
          "MATCH (s:Entity {library_id: r.sl, normalized: r.sn, type: r.st}) "
          "MATCH (t:Entity {library_id: r.tl, normalized: r.tn, type: r.tt}) "
          "MERGE (s)-[x:REL {predicate: coalesce(r.p.predicate, ''), doc_id: coalesce(r.p.doc_id, '')}]->(t) "
          "SET x += r.p", rows=rows)
    for rows in _batched(graph.get("mentions", [])):
        q("UNWIND $rows AS r "
          "MATCH (e:Entity {library_id: r.el, normalized: r.en, type: r.et}) "
          "MATCH (d:Document {id: r.doc}) "
          "MERGE (e)-[m:MENTIONED_IN {chunk_index: coalesce(r.p.chunk_index, 0)}]->(d) SET m += r.p",
          rows=rows)
    q("MERGE (m:DeploySeed {id: 'knowledge'}) SET m.hash = $hash", hash=data.get("hash"))
    return summary(data)


def _rekey(table: str, row: dict, agent_ids: dict[str, str]) -> dict:
    """The deployed agents can have new ids; what is attached to them follows."""
    from app.ontology.vocab import SubjectType

    if (table == "ontology_annotations" and row.get("subject_type") == SubjectType.AGENT.value
            and row.get("subject_id") in agent_ids):
        row["subject_id"] = agent_ids[row["subject_id"]]
    elif table == "rule_assignments" and row.get("agent_id") in agent_ids:
        row["agent_id"] = agent_ids[row["agent_id"]]
    elif table == "rules" and row.get("targets"):
        try:
            targets = json.loads(row["targets"])
            if isinstance(targets, list):
                row["targets"] = json.dumps([agent_ids.get(t, t) for t in targets])
        except (TypeError, ValueError):
            pass
    return row


def _import_rows(data: dict, agent_ids: dict[str, str]) -> int:
    from app.database import SessionLocal
    from app.db_setup import prepare_database

    prepare_database(seed_rules=False)
    db = SessionLocal()
    loaded = 0
    try:
        for table, rows in (data.get("tables") or {}).items():
            for row in rows:
                row = _rekey(table, dict(row), agent_ids)
                cols = list(row)
                db.execute(text(
                    f"INSERT OR REPLACE INTO {table} ({', '.join(cols)}) "
                    f"VALUES ({', '.join(':' + c for c in cols)})"), row)
                loaded += 1
        db.commit()
    finally:
        db.close()
    return loaded


def import_knowledge(data: dict, agent_ids: dict[str, str] | None = None,
                     graph_timeout: float = 180.0) -> str:
    """Load an export into this deployment. Returns a one-line summary."""
    rows = _import_rows(data, agent_ids or {})
    graph = _import_graph(data, graph_timeout)
    return f"{rows} knowledge rows; {graph}"
