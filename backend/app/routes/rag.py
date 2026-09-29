"""
Graph RAG routes — /api/rag

Upload a document, extract a graph from it, review what was extracted, commit
it. The document itself goes to a Mistral library through the existing
``library_service``, so everything here is additive: a library that is never
graphed behaves exactly as it did before this feature existed.

The one piece of reconciliation worth knowing about is in ``list_documents``.
Libraries predate this feature, so a library can hold documents with no local
row. Listing adopts them rather than ignoring them — otherwise the only way to
graph an existing document would be to delete and re-upload it.
"""

from __future__ import annotations

import asyncio
import json
import logging
from typing import Any, Optional

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile, Form
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from app.dependencies import get_mistral_client
from app.rag import entities as entity_tools
from app.rag import (
    graph_store, ingest, library_domain, library_ontology, ontology_agent,
    optimizer, prompts, retrieval, store, timeline, unified_graph,
)
from app.services import library_service

logger = logging.getLogger(__name__)

router = APIRouter(tags=["Graph RAG"])


class RulesRequest(BaseModel):
    rules: str = ""


class ExtractRequest(BaseModel):
    rules: Optional[str] = None


class OntologyRequest(BaseModel):
    entity_types: list[dict[str, Any]] = []
    predicates: list[dict[str, Any]] = []
    prompt: str = ""
    summary: str = ""


class DomainRequest(BaseModel):
    domains: list[str] = []


class DraftRequest(BaseModel):
    entities: list[dict[str, Any]] = []
    relations: list[dict[str, Any]] = []


async def _library_name(library_id: str) -> str:
    """Best-effort display name. Never fatal — the id is a usable fallback."""
    try:
        for library in await library_service.list_libraries():
            if library.get("id") == library_id:
                return library.get("name") or library_id
    except Exception:
        pass
    return library_id


# ── Status and overview ────────────────────────────────────────────────────


@router.get("/rag/status")
async def rag_status():
    """Whether the graph is reachable, and what it holds."""
    return {"graph": graph_store.status(), **graph_store.stats()}


@router.get("/rag/overview")
async def overview():
    """Every library with its document counts and graph size — the card grid."""
    try:
        libraries = await library_service.list_libraries()
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Could not list libraries: {e}")

    documents = store.counts_by_library()
    library_ids = [lib.get("id") for lib in libraries]
    library_domains = library_domain.domains_for_many(library_ids)
    ontologies = {
        lid: library_ontology.get_approved(lid) for lid in library_ids if lid
    }
    graph = graph_store.stats(library_ids)
    graph_by_library = graph.get("libraries", {})

    cards = []
    for library in libraries:
        library_id = library.get("id")
        counts = documents.get(library_id, {"documents": 0, "graphed": 0, "failed": 0, "pending": 0})
        stats = graph_by_library.get(library_id, {"entities": 0, "relations": 0, "documents": 0})
        cards.append({
            **library,
            "tracked_documents": counts["documents"],
            "graphed_documents": counts["graphed"],
            "pending_documents": counts["pending"],
            "failed_documents": counts["failed"],
            "entities": stats["entities"],
            "relations": stats["relations"],
            "has_rules": bool(store.get_rules(library_id)),
            "serves_domain": library_domains.get(library_id, []),
            "ontology_version": (ontologies.get(library_id) or {}).get("version"),
            "content_types": [
                t["name"] for t in (ontologies.get(library_id) or {}).get("entity_types", [])
            ],
        })

    return {
        "libraries": cards,
        "graph": graph_store.status(),
        "totals": graph.get("totals", {}),
        "entity_types": list(prompts.ENTITY_TYPES),
    }


# ── Documents ──────────────────────────────────────────────────────────────


@router.get("/rag/libraries/{library_id}/documents")
async def list_documents(library_id: str):
    """Documents in a library, with their processing state.

    Adopts anything present in the library but unknown locally, so documents
    uploaded before this feature — or through the library manager — can be
    graphed without being re-uploaded.
    """
    try:
        remote = await library_service.list_documents(library_id)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Could not list documents: {e}")

    known = {d["mistral_doc_id"]: d for d in store.list_documents(library_id)}
    for document in remote:
        doc_id = document.get("id")
        if not doc_id or doc_id in known:
            continue
        try:
            adopted = store.upsert_document(
                library_id=library_id,
                mistral_doc_id=doc_id,
                filename=document.get("filename") or doc_id,
                mime_type=document.get("mime_type") or "",
            )
            known[doc_id] = adopted
        except Exception as e:
            logger.debug("Could not adopt document %s: %s", doc_id, e)

    remote_by_id = {d.get("id"): d for d in remote}
    items = []
    for doc_id, document in known.items():
        source = remote_by_id.get(doc_id) or {}
        items.append({
            **document,
            "size": source.get("size", 0),
            "in_library": doc_id in remote_by_id,
        })
    items.sort(key=lambda d: d.get("created_at") or "", reverse=True)

    return {
        "library_id": library_id,
        "documents": items,
        "rules": store.get_rules(library_id),
        "count": len(items),
    }


@router.post("/rag/libraries/{library_id}/documents", status_code=201)
async def upload_document(
    library_id: str,
    file: UploadFile = File(...),
    rules: str = Form(""),
    auto_extract: bool = Form(True),
    client=Depends(get_mistral_client),
):
    """Upload a document and, by default, start building its graph.

    The upload itself is the existing library upload — the document is a
    first-class library document and ``document_library`` search picks it up
    regardless of what happens to the graph afterwards.
    """
    try:
        content = await file.read()
        uploaded = await library_service.upload_document(
            library_id=library_id,
            filename=file.filename or "untitled",
            file_content=content,
            content_type=file.content_type or "application/octet-stream",
        )
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Upload failed: {e}")

    document = store.upsert_document(
        library_id=library_id,
        mistral_doc_id=uploaded["id"],
        filename=uploaded.get("filename") or file.filename or "untitled",
        mime_type=file.content_type or "",
        rules=(rules or "").strip() or store.get_rules(library_id),
    )

    if auto_extract:
        ingest.schedule(client, document["id"], document.get("rules"))
        document["status"] = "indexing"

    return document


@router.post("/rag/documents/{document_id}/extract")
async def extract_document(
    document_id: int,
    request: ExtractRequest,
    client=Depends(get_mistral_client),
):
    """(Re-)extract a document, optionally under new rules.

    Returns immediately. The graph is untouched until the resulting draft is
    committed, so re-extracting a document that is already graphed is safe —
    the old graph stands until the new draft replaces it.
    """
    document = store.get_document(document_id)
    if not document:
        raise HTTPException(status_code=404, detail=f"Document {document_id} not found")

    ingest.schedule(client, document_id, request.rules)
    return {
        "document_id": document_id,
        "status": "scheduled",
        "rules": request.rules if request.rules is not None else document.get("rules", ""),
    }


@router.delete("/rag/documents/{document_id}")
async def delete_document(document_id: int, drop_from_library: bool = Query(True)):
    """Remove a document, its draft and everything it alone contributed."""
    document = store.get_document(document_id)
    if not document:
        raise HTTPException(status_code=404, detail=f"Document {document_id} not found")

    graph_result = graph_store.delete_document_graph(
        document["mistral_doc_id"], document["library_id"]
    )

    if drop_from_library:
        try:
            await library_service.delete_document(
                document["library_id"], document["mistral_doc_id"]
            )
        except Exception as e:
            # The local row and the graph slice are already gone; refusing to
            # finish because the library call failed would leave the three
            # stores disagreeing.
            logger.warning("Could not delete library document: %s", e)

    store.delete_document(document_id)
    return {"deleted": True, "document_id": document_id, "graph": graph_result}


# ── Rules ──────────────────────────────────────────────────────────────────


@router.get("/rag/libraries/{library_id}/rules")
async def get_rules(library_id: str):
    """The library's default extraction rules, plus the built-in contract."""
    return {
        "library_id": library_id,
        "rules": store.get_rules(library_id),
        "default_instructions": prompts.DEFAULT_EXTRACTION_INSTRUCTIONS,
        "entity_types": list(prompts.ENTITY_TYPES),
    }


@router.put("/rag/libraries/{library_id}/rules")
async def set_rules(library_id: str, request: RulesRequest):
    """Set the default rules new uploads in this library inherit."""
    return store.set_rules(library_id, request.rules)


# ── Library domain ─────────────────────────────────────────────────────────


@router.get("/rag/libraries/{library_id}/domains")
async def get_library_domains(library_id: str):
    """Which domains this library serves, and the vocabulary to choose from.

    The annotation is what lets a planner pick this library for a goal, and what
    lets industry knowledge, document search and the graph all narrow to the
    same subject.
    """
    from app.ontology import store as ontology_store
    from app.ontology.vocab import Scheme

    return {
        "library_id": library_id,
        "domains": library_domain.domains_for(library_id),
        "available": ontology_store.list_concepts(Scheme.DOMAIN.value),
    }


@router.put("/rag/libraries/{library_id}/domains")
async def set_library_domains(library_id: str, request: DomainRequest):
    """Assign the domains this library serves, by hand."""
    domains = library_domain.set_domains(library_id, request.domains, source="user")
    # Keep the Neo4j mirror in step, so the unified graph reflects the change
    # immediately rather than at the next boot.
    unified_graph.link_library(library_id, domains)
    return {"library_id": library_id, "domains": domains}


@router.post("/rag/libraries/{library_id}/domains/classify")
async def classify_library_domain(library_id: str, client=Depends(get_mistral_client)):
    """Have a model work out the domain from the library and its ontology."""
    domains = await library_domain.classify(
        client, library_id, name=await _library_name(library_id)
    )
    unified_graph.link_library(library_id, domains)
    return {"library_id": library_id, "domains": domains}


# ── Library ontology ───────────────────────────────────────────────────────


@router.get("/rag/libraries/{library_id}/ontology")
async def get_ontology(library_id: str):
    """The schema governing this library, the pending draft, and what is stale.

    Returns both versions because the review screen needs to show them side by
    side: what extraction runs under now, and what it would run under if the
    draft were approved.
    """
    approved = library_ontology.get_approved(library_id)
    return {
        "library_id": library_id,
        "approved": approved,
        "draft": library_ontology.get_draft(library_id),
        "history": library_ontology.history(library_id),
        "stale_documents": library_ontology.stale_documents(library_id),
        "architect": ontology_agent.status(),
        # What extraction would use with no ontology at all, so the UI can show
        # the fallback honestly rather than implying a schema is required.
        "fallback_types": list(prompts.ENTITY_TYPES),
        "effective_prompt": prompts.build_system_prompt(None, approved),
    }


@router.post("/rag/libraries/{library_id}/ontology/propose")
async def propose_ontology(library_id: str, client=Depends(get_mistral_client)):
    """Have the architect read the library and propose a schema, as a draft.

    Nothing is applied. The proposal is reviewed and approved separately —
    correcting a schema costs one edit, correcting what a bad schema extracted
    costs a re-run per document.
    """
    try:
        return await ontology_agent.propose(
            client, library_id, await _library_name(library_id)
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except RuntimeError as e:
        raise HTTPException(status_code=502, detail=str(e))
    except Exception as e:
        logger.exception("Ontology proposal failed for %s", library_id)
        raise HTTPException(status_code=500, detail=f"Proposal failed: {e}")


@router.put("/rag/libraries/{library_id}/ontology")
async def save_ontology(library_id: str, request: OntologyRequest):
    """Save a hand-written or hand-edited draft schema."""
    try:
        return library_ontology.save_draft(
            library_id=library_id,
            entity_types=request.entity_types,
            predicates=request.predicates,
            prompt=request.prompt,
            summary=request.summary,
        )
    except RuntimeError as e:
        raise HTTPException(status_code=503, detail=str(e))


@router.post("/rag/libraries/{library_id}/ontology/approve")
async def approve_ontology(library_id: str):
    """Promote the draft. Documents extracted under an older version go stale.

    Stale documents are reported, not re-extracted: that costs a model call per
    chunk, and whether an older schema is *wrong* or merely *older* is a
    judgement for whoever approved the new one.
    """
    try:
        approved = library_ontology.approve(library_id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except RuntimeError as e:
        raise HTTPException(status_code=503, detail=str(e))
    return {
        "ontology": approved,
        "stale_documents": library_ontology.stale_documents(library_id),
    }


@router.delete("/rag/libraries/{library_id}/ontology/draft")
async def discard_ontology_draft(library_id: str):
    """Throw away the pending draft, leaving the approved schema untouched."""
    return {"discarded": library_ontology.discard_draft(library_id)}


# ── Drafts ─────────────────────────────────────────────────────────────────


@router.get("/rag/documents/{document_id}/draft")
async def get_draft(document_id: int):
    """What extraction proposed, for review."""
    document = store.get_document(document_id)
    if not document:
        raise HTTPException(status_code=404, detail=f"Document {document_id} not found")
    draft = store.get_draft(document_id)
    ontology = library_ontology.get_approved(document["library_id"])
    return {
        "document": document,
        "draft": draft,
        # The review screen needs the vocabulary to offer as choices, and the
        # version, so a reviewer can see the draft is older than the schema.
        "ontology": ontology,
        "entity_types": (
            [t["name"] for t in ontology["entity_types"]] if ontology
            else list(prompts.ENTITY_TYPES)
        ),
        "predicates": [p["name"] for p in (ontology or {}).get("predicates", [])],
    }


@router.put("/rag/documents/{document_id}/draft")
async def update_draft(document_id: int, request: DraftRequest):
    """Save a reviewer's edits.

    Everything is re-normalised on the way in: renaming an entity changes what
    it merges with, deleting one has to take its relations with it. The response
    carries the sanitised draft, so the UI shows what was actually stored rather
    than what it sent.
    """
    document = store.get_document(document_id)
    if not document:
        raise HTTPException(status_code=404, detail=f"Document {document_id} not found")

    schema = entity_tools.Schema.for_library(document["library_id"])
    payload = entity_tools.sanitize_draft(
        {"entities": request.entities, "relations": request.relations}, schema
    )
    draft = store.save_draft(
        document_id=document_id,
        payload=payload,
        rules=document.get("rules"),
        status="edited",
    )
    return {
        "draft": draft,
        "dropped_relations": payload.get("dropped_relations", 0),
        # Anything still outside the library ontology. Commit will skip these,
        # so the reviewer needs to see them now rather than discover the gap in
        # the committed graph.
        "unmapped_entities": payload.get("unmapped_entities", []),
        "unmapped_predicates": payload.get("unmapped_predicates", []),
    }


@router.post("/rag/documents/{document_id}/commit")
async def commit_draft(document_id: int):
    """Write the approved draft into the knowledge graph."""
    document = store.get_document(document_id)
    if not document:
        raise HTTPException(status_code=404, detail=f"Document {document_id} not found")
    try:
        return await ingest.commit(
            document_id, library_name=await _library_name(document["library_id"])
        )
    except RuntimeError as e:
        raise HTTPException(status_code=503, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.exception("Commit failed for document %s", document_id)
        raise HTTPException(status_code=500, detail=f"Commit failed: {e}")


# ── Graph ──────────────────────────────────────────────────────────────────


@router.get("/rag/graph/unified")
async def unified_graph_view(
    library_id: Optional[str] = Query(None),
    document_id: Optional[int] = Query(None),
    entity_limit: Optional[int] = Query(None, ge=1),
    include_documents: bool = Query(True),
):
    """Concepts, libraries, documents and entities as one interconnected graph.

    The view that shows what the restructure was for: a domain concept, the
    libraries that serve it, the documents inside them, and the entities those
    documents produced — all in one picture, rather than a taxonomy tree and a
    separate entity graph that never meet.
    """
    mistral_doc_id = None
    if document_id:
        document = store.get_document(document_id)
        if not document:
            raise HTTPException(status_code=404, detail=f"Document {document_id} not found")
        mistral_doc_id = document["mistral_doc_id"]
        library_id = library_id or document["library_id"]

    return unified_graph.snapshot(
        library_id=library_id,
        document_id=mistral_doc_id,
        entity_limit=entity_limit,
        include_documents=include_documents,
    )


@router.post("/rag/graph/sync-taxonomy")
async def sync_taxonomy():
    """Rebuild the taxonomy mirror in Neo4j from SQLite.

    Runs on boot; exposed so an ontology edit can be reflected without a
    restart. A full rebuild, because a diff eventually leaves a deleted concept
    behind.
    """
    return unified_graph.sync_taxonomy()


class CypherQueryRequest(BaseModel):
    query: str
    params: dict[str, Any] = {}
    limit: int = 200


@router.post("/rag/graph/query")
async def query_graph(body: CypherQueryRequest):
    """Run a read-only Cypher query against the knowledge graph directly.

    For the Query tab: whatever nodes and relationships the query touches come
    back in the same shape as the unified graph, so they render on the same
    canvas. A query that returns scalars instead (counts, aggregations,
    property projections) comes back as rows/columns for a table.

    Write clauses are rejected — this is a read surface onto the graph, not an
    admin console.
    """
    query = (body.query or "").strip()
    if not query:
        raise HTTPException(status_code=400, detail="Query is empty.")
    if not graph_store.available():
        raise HTTPException(status_code=503, detail="The knowledge graph is unavailable.")
    try:
        return graph_store.run_cypher(query, params=body.params, limit=max(1, min(body.limit, 2000)))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Query failed: {e}")


@router.get("/rag/graph")
async def graph(
    library_id: Optional[str] = Query(None),
    document_id: Optional[int] = Query(None),
    limit: int = Query(400, ge=10, le=2000),
):
    """Nodes and edges for a graph view: one document, one library, or all."""
    mistral_doc_id = None
    if document_id:
        document = store.get_document(document_id)
        if not document:
            raise HTTPException(status_code=404, detail=f"Document {document_id} not found")
        mistral_doc_id = document["mistral_doc_id"]
        library_id = library_id or document["library_id"]

    result = graph_store.snapshot(
        library_id=library_id if not mistral_doc_id else None,
        document_id=mistral_doc_id,
        limit=limit,
    )
    return {
        **result,
        "scope": "document" if mistral_doc_id else ("library" if library_id else "all"),
        "library_id": library_id,
        "document_id": document_id,
    }


# ── Retrieval ──────────────────────────────────────────────────────────────


class SearchRequest(BaseModel):
    query: str
    library_ids: list[str] = []
    domains: list[str] = []
    hops: int = 2
    limit: int = 12
    optimize: bool = True


@router.post("/rag/search")
async def search(request: SearchRequest, client=Depends(get_mistral_client)):
    """Run the agent's own retrieval and return every stage of it.

    Both sources, exactly as ``search_domain_knowledge`` runs them: what the
    optimiser did to the query, which entities matched, what the traversal
    found, which industry notes came back, and the prompt block the model would
    actually receive.
    """
    from app.rag import domain_search

    result = await domain_search.search(
        client,
        request.query,
        library_ids=request.library_ids or None,
        domains=request.domains or None,
        hops=request.hops,
        limit=request.limit,
        optimize=request.optimize,
    )
    return {
        **result,
        # Exactly the block the agent's tool would hand the model — the whole
        # point of the bench. When an answer is wrong, what the model was given
        # is nearly always the explanation.
        "rendered": domain_search.render(result),
    }


@router.post("/rag/agents/sync")
async def sync_agent_tools(client=Depends(get_mistral_client)):
    """Move agents off the two retired retrieval tools. Idempotent.

    The grounded-knowledge tool is an explicit choice per agent, so this never
    adds it to or removes it from anyone who chose. It only replaces
    ``query_industry_knowledge`` / ``query_knowledge_graph`` on agents created
    before the consolidation. Runs on boot; exposed for the Knowledge tab.
    """
    from app.rag import rag_tools

    return await rag_tools.backfill_rag_tool(client)


@router.get("/rag/optimizer")
async def optimizer_status():
    """What the query optimiser is, where it runs, and whether it exists yet."""
    return optimizer.status()


@router.post("/rag/optimizer/ensure")
async def optimizer_ensure(
    reset: bool = Query(
        False,
        description="Restore the shipped instructions, discarding any edits.",
    ),
    client=Depends(get_mistral_client),
):
    """Create the optimiser agent if it is missing. Idempotent.

    Boot never overwrites an existing agent's instructions — editing them is how
    retrieval behaviour is tuned. ``reset=true`` is the deliberate way back to
    the shipped prompt.
    """
    agent_id = await optimizer.ensure_system_agent(client, reset=reset)
    if not agent_id:
        raise HTTPException(
            status_code=502,
            detail="Could not create the query optimiser agent — check the Mistral API key.",
        )
    return optimizer.status()


@router.post("/rag/optimizer/preview")
async def optimizer_preview(request: SearchRequest, client=Depends(get_mistral_client)):
    """Show what the optimiser does to a query, without retrieving anything."""
    return await optimizer.optimize(client, request.query)


# ── Timeline ───────────────────────────────────────────────────────────────


@router.get("/rag/timeline")
async def list_traces(
    subject: Optional[str] = Query(None, description="e.g. document:12"),
    scope: Optional[str] = Query(None, description="ingest | query"),
    limit: int = Query(25, ge=1, le=100),
):
    """Recent processing runs, newest first."""
    return {"traces": timeline.traces(subject=subject, scope=scope, limit=limit)}


@router.get("/rag/timeline/{trace_id}")
async def get_trace(trace_id: str):
    """Every stage of one run, in order, with timings."""
    events = timeline.events_for(trace_id)
    if not events:
        raise HTTPException(status_code=404, detail=f"Trace {trace_id} not found")
    return {"trace_id": trace_id, "events": events}


def _sse(event: str, data: Any) -> str:
    """Frame a payload as an SSE message.

    Newlines inside the JSON have to become separate ``data:`` lines or the
    frame terminates early and the client sees truncated JSON. Same helper the
    execution stream uses, kept local rather than shared because the two
    routers have no other reason to depend on each other.
    """
    payload = data if isinstance(data, str) else json.dumps(data, default=str)
    payload = payload.replace("\n", "\ndata: ")
    return f"event: {event}\ndata: {payload}\n\n"


@router.get("/rag/timeline/{trace_id}/stream")
async def stream_trace(trace_id: str):
    """Live SSE stream of one run's stages.

    Ingestion takes tens of seconds to minutes, so the interesting question is
    what is happening *now*. Polling answers that too, but re-sends the whole
    trace each time; this sends each stage once, as it changes.

    Stages are identified by ``(id, status, duration)`` rather than by id alone:
    a stage is written when it opens and rewritten when it closes, and a client
    that saw only the open would show it spinning forever.

    Event names: ``stage``, ``ping``, ``done``. ``done`` is the close signal —
    emitted once no stage is running, which is what makes an ingest stream end
    on its own rather than idling until the client disconnects.
    """
    async def _generate():
        seen: dict[int, tuple[str, Optional[int]]] = {}
        idle_ticks = 0

        try:
            for tick in range(600):  # ~20 minutes at 2s, then give up
                events = await asyncio.to_thread(timeline.events_for, trace_id)
                if not events and tick == 0:
                    yield _sse("error", {"detail": f"Trace {trace_id} not found"})
                    yield _sse("done", {"trace_id": trace_id})
                    return

                changed = 0
                for event in events:
                    fingerprint = (event["status"], event["duration_ms"])
                    if seen.get(event["id"]) != fingerprint:
                        seen[event["id"]] = fingerprint
                        yield _sse("stage", event)
                        changed += 1

                running = any(e["status"] == "running" for e in events)
                if not running:
                    # Give a just-finished trace one more pass so the closing
                    # update of the final stage is never the frame after `done`.
                    idle_ticks += 1
                    if idle_ticks >= 2 and changed == 0:
                        yield _sse("done", {"trace_id": trace_id, "stages": len(events)})
                        return
                else:
                    idle_ticks = 0

                if changed == 0:
                    # Keeps proxies from closing an idle connection.
                    yield _sse("ping", {"trace_id": trace_id})
                await asyncio.sleep(2)

            yield _sse("done", {"trace_id": trace_id, "detail": "stream timed out"})
        except asyncio.CancelledError:
            raise
        except Exception as e:
            logger.error("Timeline stream for %s failed: %s", trace_id, e, exc_info=True)
            yield _sse("error", {"trace_id": trace_id, "detail": str(e)})
            yield _sse("done", {"trace_id": trace_id})

    return StreamingResponse(
        _generate(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
            "Connection": "keep-alive",
        },
    )
