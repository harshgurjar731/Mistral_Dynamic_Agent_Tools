"""
Upload to draft: the ingestion pipeline.

    upload → Mistral indexes it → fetch text → chunk → extract per chunk
           → merge → draft awaiting review

Three things about this are deliberate and worth stating.

**Text comes from the library, and only from the library.** Mistral already
extracts text from every document uploaded to a library — the same extraction
that makes ``document_library`` search work. Fetching it back means the graph is
built from exactly the text the library tool searches, so the two retrieval
paths can never disagree about what the document says. There is no OCR fallback:
if the library returns no text the document is marked ``unsupported`` and stays
searchable but ungraphed, which is honest, rather than quietly graphing a
second, different extraction of the same file.

**Extraction is per chunk, and chunks are capped.** A long document cannot fit
in one call, and one call per chunk is the cost. ``RAG_MAX_CHUNKS_PER_DOC`` is a
hard ceiling so a 400-page PDF cannot silently spend a hundred model calls on a
single upload.

**Nothing here writes to the graph.** The pipeline ends at a draft. Committing
is a separate, explicit act — see ``commit``.
"""

from __future__ import annotations

import asyncio
import json
import logging
import re
from functools import partial
from typing import Optional

from app.config import settings
from app.rag import entities as entity_tools
from app.rag import graph_store, prompts, store, timeline

logger = logging.getLogger(__name__)

# Background ingests, held so the garbage collector cannot cancel a running
# task — the same pattern agent classification uses.
_tasks: set[asyncio.Task] = set()

#: Library-side processing states that will never become "done".
_TERMINAL_FAILURES = {"error", "missing_content"}
#: States meaning the text is (or should be) available now.
_READY = {"done", "noop", "self_managed"}

_FENCE = re.compile(r"^\s*```(?:json)?\s*|\s*```\s*$")


def _parse_json(raw: str) -> dict:
    """Parse a model's JSON reply, tolerating a code fence around it.

    ``response_format=json_object`` makes this rare rather than impossible, and
    one malformed chunk should cost that chunk, not the whole document.
    """
    text = _FENCE.sub("", (raw or "").strip())
    try:
        value = json.loads(text)
    except Exception:
        return {}
    return value if isinstance(value, dict) else {}


def chunk_text(text: str) -> list[str]:
    """Split a document into overlapping excerpts.

    Split on paragraph boundaries rather than at a fixed offset: a relation cut
    mid-sentence is a relation neither chunk can evidence, and the evidence
    requirement means it is then dropped entirely. The overlap exists for the
    same reason — a fact stated across a paragraph break survives in whichever
    chunk holds both halves.
    """
    size = max(1000, settings.RAG_CHUNK_CHARS)
    overlap = max(0, min(settings.RAG_CHUNK_OVERLAP, size // 2))

    cleaned = (text or "").strip()
    if not cleaned:
        return []
    if len(cleaned) <= size:
        return [cleaned]

    paragraphs = re.split(r"\n\s*\n", cleaned)
    chunks: list[str] = []
    current = ""

    for paragraph in paragraphs:
        candidate = f"{current}\n\n{paragraph}" if current else paragraph
        if len(candidate) <= size:
            current = candidate
            continue
        if current:
            chunks.append(current)
            # Carry the tail of the finished chunk into the next one.
            current = (current[-overlap:] + "\n\n" + paragraph) if overlap else paragraph
        else:
            # One paragraph longer than a whole chunk — a table or a wall of
            # text. Hard-split it; there is no boundary to respect.
            for start in range(0, len(paragraph), size - overlap):
                piece = paragraph[start:start + size]
                if piece.strip():
                    chunks.append(piece)
            current = ""

    if current.strip():
        chunks.append(current)

    ceiling = max(1, settings.RAG_MAX_CHUNKS_PER_DOC)
    if len(chunks) > ceiling:
        logger.warning(
            "Document truncated for extraction: %d chunks, ceiling %d",
            len(chunks), ceiling,
        )
        chunks = chunks[:ceiling]
    return chunks


# ── Steps ──────────────────────────────────────────────────────────────────


async def fetch_text(
    client, library_id: str, mistral_doc_id: str
) -> tuple[str, str, str]:
    """Wait for Mistral to finish indexing, then pull the extracted text.

    Returns ``(text, reason, status)``. The status is the document state the
    caller should record — ``unsupported`` when there is genuinely no text to
    graph, ``failed`` when something went wrong and retrying may help. It is
    returned rather than inferred from the message because a status derived by
    matching words in prose breaks the moment the prose is reworded.
    """
    attempts = max(1, settings.RAG_TEXT_POLL_ATTEMPTS)
    delay = max(1, settings.RAG_TEXT_POLL_SECONDS)
    state = "unknown"

    with timeline.stage("library_indexing", meta={"document": mistral_doc_id}) as st:
        for attempt in range(attempts):
            try:
                status = await asyncio.to_thread(
                    partial(
                        client.beta.libraries.documents.status,
                        library_id=library_id,
                        document_id=mistral_doc_id,
                    )
                )
                state = str(getattr(status, "process_status", "") or "").lower()
            except Exception as e:
                # A transient API error mid-poll should not fail the ingest;
                # the next attempt usually succeeds.
                logger.debug("Status poll failed for %s: %s", mistral_doc_id, e)
                state = "unknown"

            if state in _READY:
                st.set(state=state, polls=attempt + 1)
                break
            if state in _TERMINAL_FAILURES:
                st.set(state=state, polls=attempt + 1)
                st.note(f"Mistral reported '{state}'")
                return "", f"Mistral could not process this document ({state}).", "failed"
            await asyncio.sleep(delay)
        else:
            st.set(state=state, polls=attempts)
            st.note("still indexing after the poll ceiling")
            return "", (
                "Mistral is still indexing this document. Try extracting again "
                "in a few minutes."
            ), "failed"

    with timeline.stage("fetch_text") as st:
        try:
            content = await asyncio.to_thread(
                partial(
                    client.beta.libraries.documents.text_content,
                    library_id=library_id,
                    document_id=mistral_doc_id,
                )
            )
            text = str(getattr(content, "text", "") or "")
        except Exception as e:
            st.note(str(e)[:200])
            return "", f"Could not retrieve the document text ({e}).", "failed"

        st.set(chars=len(text))
        if not text.strip():
            st.note("library returned no text")
            return "", (
                "The library holds no extracted text for this document, so there "
                "is nothing to build a graph from. It remains searchable through "
                "the document library tool."
            ), "unsupported"
        return text, "", ""


async def extract_chunks(
    client,
    *,
    filename: str,
    chunks: list[str],
    rules: str,
    model: str,
) -> list[tuple[int, dict]]:
    """Run entity extraction over every chunk, bounded in parallel.

    One failed chunk yields an empty result rather than failing the document:
    losing a page of a fifty-page contract is recoverable by re-extracting,
    losing the whole run is forty-nine wasted calls.
    """
    system_prompt = prompts.build_system_prompt(rules)
    semaphore = asyncio.Semaphore(max(1, settings.RAG_EXTRACTION_CONCURRENCY))
    results: list[tuple[int, dict]] = []

    async def _one(index: int, text: str) -> None:
        async with semaphore:
            with timeline.stage(
                "extract_chunk", meta={"chunk": index + 1, "chars": len(text)}
            ) as st:
                try:
                    response = await asyncio.to_thread(
                        partial(
                            client.chat.complete,
                            model=model,
                            messages=[
                                {"role": "system", "content": system_prompt},
                                {
                                    "role": "user",
                                    "content": prompts.build_user_prompt(
                                        filename=filename,
                                        chunk_index=index,
                                        chunk_count=len(chunks),
                                        text=text,
                                    ),
                                },
                            ],
                            temperature=0.0,
                            response_format={"type": "json_object"},
                            timeout_ms=120_000,
                        )
                    )
                    payload = _parse_json(response.choices[0].message.content)
                except Exception as e:
                    logger.warning("Extraction failed on chunk %d: %s", index + 1, e)
                    st.note(str(e)[:200])
                    st.set(entities=0, relations=0, failed=True)
                    results.append((index, {}))
                    return

                st.set(
                    entities=len(payload.get("entities") or []),
                    relations=len(payload.get("relations") or []),
                )
                results.append((index, payload))

    await asyncio.gather(*(_one(i, text) for i, text in enumerate(chunks)))
    results.sort(key=lambda pair: pair[0])
    return results


# ── Pipeline ───────────────────────────────────────────────────────────────


async def ingest(client, document_id: int, rules: Optional[str] = None) -> dict:
    """Take one document from uploaded to a reviewable draft."""
    document = store.get_document(document_id)
    if not document:
        raise ValueError(f"Document {document_id} not found.")

    # Rules resolve most-specific-first: what the caller passed, else what was
    # used last time on this document, else the library default.
    effective_rules = (
        rules
        if rules is not None
        else (document.get("rules") or store.get_rules(document["library_id"]))
    )
    model = settings.RAG_EXTRACTION_MODEL

    trace_id = timeline.start("ingest", f"document:{document_id}")
    store.update_document(
        document_id, status="indexing", trace_id=trace_id,
        rules=effective_rules, error=None,
    )

    with timeline.stage(
        "ingest",
        meta={"filename": document["filename"], "model": model,
              "rules": bool((effective_rules or "").strip())},
    ) as root:
        text, reason, failure_status = await fetch_text(
            client, document["library_id"], document["mistral_doc_id"]
        )
        if not text:
            root.skip(reason)
            store.update_document(document_id, status=failure_status, error=reason)
            return {"status": failure_status, "reason": reason, "trace_id": trace_id}

        store.update_document(document_id, status="extracted", char_count=len(text))

        with timeline.stage("chunk") as st:
            chunks = chunk_text(text)
            st.set(chunks=len(chunks), chars=len(text))
        if not chunks:
            reason = "The document text is empty after cleaning."
            root.skip(reason)
            store.update_document(document_id, status="unsupported", error=reason)
            return {"status": "unsupported", "reason": reason, "trace_id": trace_id}

        store.update_document(
            document_id, status="extracting", chunk_count=len(chunks)
        )

        with timeline.stage("extract", meta={"chunks": len(chunks), "model": model}) as st:
            results = await extract_chunks(
                client,
                filename=document["filename"],
                chunks=chunks,
                rules=effective_rules,
                model=model,
            )
            st.set(
                raw_entities=sum(len(p.get("entities") or []) for _, p in results),
                raw_relations=sum(len(p.get("relations") or []) for _, p in results),
            )

        with timeline.stage("merge") as st:
            merged = entity_tools.merge(results)
            st.set(
                entities=len(merged["entities"]),
                relations=len(merged["relations"]),
                dropped_relations=merged.get("dropped_relations", 0),
            )
            if merged.get("dropped_relations"):
                st.note(
                    f"{merged['dropped_relations']} relation(s) dropped — "
                    "an endpoint was not among the extracted entities"
                )

        draft = store.save_draft(
            document_id=document_id,
            payload=merged,
            model=model,
            rules=effective_rules,
            status="pending",
        )
        store.update_document(document_id, status="proposed", error=None)
        root.set(entities=draft["entity_count"], relations=draft["relation_count"])

    return {
        "status": "proposed",
        "trace_id": trace_id,
        "entities": draft["entity_count"],
        "relations": draft["relation_count"],
    }


def schedule(client, document_id: int, rules: Optional[str] = None) -> Optional[str]:
    """Run an ingest in the background. Never blocks, never raises.

    Extraction takes anywhere from seconds to minutes, which is far too long to
    hold an HTTP request open. The document row and the timeline are how the UI
    follows the work — that is what they are for.
    """
    async def _run() -> None:
        try:
            await ingest(client, document_id, rules)
        except Exception as e:
            logger.exception("Ingest failed for document %s", document_id)
            store.update_document(document_id, status="failed", error=str(e)[:1000])

    try:
        task = asyncio.create_task(_run())
        _tasks.add(task)
        task.add_done_callback(_tasks.discard)
        return "scheduled"
    except RuntimeError:
        logger.debug("No event loop to schedule ingest for %s", document_id)
        return None


# ── Commit ─────────────────────────────────────────────────────────────────


async def commit(document_id: int, library_name: str = "") -> dict:
    """Write an approved draft into the graph.

    Re-sanitises the draft first even though the review endpoint already did.
    The draft may have been edited by one request and committed by another, and
    a relation whose entity was deleted in between would fail the Cypher MATCH
    rather than being dropped — the cheap re-check is what keeps commit total.
    """
    document = store.get_document(document_id)
    if not document:
        raise ValueError(f"Document {document_id} not found.")
    draft = store.get_draft(document_id)
    if not draft:
        raise ValueError("This document has no draft to commit. Extract it first.")
    if not graph_store.available():
        raise RuntimeError(
            "The knowledge graph is unavailable — start it with "
            "'docker compose up -d neo4j'."
        )

    # Continue the ingest's own trace where there is one, so extraction and the
    # commit that approved it read as one story rather than two unrelated runs.
    subject = f"document:{document_id}"
    trace_id = document.get("trace_id")
    if trace_id:
        timeline.adopt(trace_id, "ingest", subject)
    else:
        trace_id = timeline.start("ingest", subject)
        store.update_document(document_id, trace_id=trace_id)

    with timeline.stage("commit", meta={"filename": document["filename"]}) as root:
        with timeline.stage("sanitize") as st:
            payload = entity_tools.sanitize_draft(draft)
            entity_rows, relation_rows = entity_tools.to_graph_rows(payload)
            st.set(
                entities=len(entity_rows),
                relations=len(relation_rows),
                dropped_relations=payload.get("dropped_relations", 0),
            )

        with timeline.stage("graph_write") as st:
            written = await asyncio.to_thread(
                partial(
                    graph_store.commit_document,
                    library_id=document["library_id"],
                    library_name=library_name or document["library_id"],
                    document_id=document["mistral_doc_id"],
                    filename=document["filename"],
                    entities=entity_rows,
                    relations=relation_rows,
                )
            )
            st.set(**{k: v for k, v in written.items() if isinstance(v, int)})

        store.set_draft_status(document_id, "committed")
        store.update_document(document_id, status="graphed", error=None)
        root.set(**{k: v for k, v in written.items() if isinstance(v, int)})

    return {
        "status": "graphed",
        "document_id": document_id,
        "trace_id": trace_id,
        **written,
    }
