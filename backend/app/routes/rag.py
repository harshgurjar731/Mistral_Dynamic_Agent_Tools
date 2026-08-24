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
from app.rag import graph_store, ingest, optimizer, prompts, retrieval, store, timeline
from app.services import library_service

logger = logging.getLogger(__name__)

router = APIRouter(tags=["Graph RAG"])


class RulesRequest(BaseModel):
    rules: str = ""


class ExtractRequest(BaseModel):
    rules: Optional[str] = None


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
    graph = graph_store.stats([lib.get("id") for lib in libraries])
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


# ── Drafts ─────────────────────────────────────────────────────────────────


@router.get("/rag/documents/{document_id}/draft")
async def get_draft(document_id: int):
    """What extraction proposed, for review."""
    document = store.get_document(document_id)
    if not document:
        raise HTTPException(status_code=404, detail=f"Document {document_id} not found")
    draft = store.get_draft(document_id)
    if not draft:
        return {"document": document, "draft": None}
    return {"document": document, "draft": draft}


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

    payload = entity_tools.sanitize_draft(
        {"entities": request.entities, "relations": request.relations}
    )
    draft = store.save_draft(
        document_id=document_id,
        payload=payload,
        rules=document.get("rules"),
        status="edited",
    )
    return {"draft": draft, "dropped_relations": payload.get("dropped_relations", 0)}


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
    hops: int = 2
    limit: int = 12
    optimize: bool = True


@router.post("/rag/search")
async def search(request: SearchRequest, client=Depends(get_mistral_client)):
    """Run a graph retrieval and return every stage of it.

    The same path the agent tool takes, with the intermediate results exposed:
    what the optimiser did to the query, which entities matched, what the
    traversal found, and the prompt block the model would actually receive.
    That last one matters — when an answer is wrong, the question is almost
    always what the model was handed, and this is the only place to see it.
    """
    result = await retrieval.retrieve(
        client,
        request.query,
        library_ids=request.library_ids or None,
        hops=request.hops,
        limit=request.limit,
        optimize=request.optimize,
    )
    return {
        **result,
        "rendered": retrieval.render_for_prompt(result),
    }


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
