"""
Adding a knowledge source — once, with review.

    source ─► extract (Mistral OCR) ─► distill (mistral-large, JSON) ─► scope (catalog match)
           ─► dedupe (content hash) ─► embed (mistral-embed) ─► conflict check ─► proposed items

Items land as ``proposed`` and reach builds only when a person approves them
(``GUIDANCE_AUTO_APPROVE`` lets high-confidence items through). When the source
should also be readable by built agents at run time, the original is stored in
a Mistral library, where the ``document_library`` tool searches it.
"""

from __future__ import annotations

import logging
import time
from typing import Any, Optional

from app.knowledge import store

logger = logging.getLogger(__name__)

DUPLICATE_SIMILARITY = 0.95
CONFLICT_SIMILARITY = 0.82


def scope_for(hint: str, default: Optional[str] = None) -> Optional[str]:
    """The catalog node an item's scope hint names, or ``default``."""
    if not hint:
        return default
    from app.catalog import match
    from app.catalog.vocab import Scheme

    best: tuple[float, Optional[str]] = (0.0, None)
    for scheme in (Scheme.PROCESS.value, Scheme.DOMAIN.value):
        try:
            scored = match.score_concepts(hint, scheme)
        except Exception:
            scored = []
        if scored and scored[0][1] > best[0]:
            best = (scored[0][1], scored[0][0])
    return best[1] if best[0] >= 1.0 else default


def _cosine(a: list[float], b: list[float]) -> float:
    from app.knowledge.retrieval import _cosine as cos

    return cos(a, b)


def _polarity(item: dict) -> int:
    return -1 if item.get("strength") == "avoid" else 1


async def check_conflicts(new_ids: list[int]) -> dict:
    """Mark near-duplicates retired and contradictions ``conflicting``. Needs embeddings."""
    new = store.list_items(ids=new_ids, embedding=True)
    existing = [i for i in store.list_items(kind="guidance", statuses=("active",), embedding=True)
                if i["id"] not in set(new_ids) and i.get("embedding")]
    duplicates = conflicts = 0
    for item in new:
        if not item.get("embedding") or item["kind"] != "guidance":
            continue
        for other in existing:
            similarity = _cosine(item["embedding"], other["embedding"])
            if similarity >= DUPLICATE_SIMILARITY and _polarity(item) == _polarity(other):
                store.update_item(item["id"], {"status": "retired",
                                               "rationale": f"Duplicate of guidance:{other['id']}."})
                duplicates += 1
                break
            if similarity >= CONFLICT_SIMILARITY and _polarity(item) != _polarity(other):
                store.update_item(item["id"], {"status": "conflicting",
                                               "rationale": f"May contradict guidance:{other['id']} "
                                                            f"(\"{other['title']}\"). Review both."})
                conflicts += 1
                break
    return {"duplicates": duplicates, "conflicts": conflicts}


async def distill_source(client: Any, source_id: int, *, auto_approve: Optional[bool] = None) -> dict:
    """Distil a source's extracted text into items. Re-running replaces its proposed items."""
    from app.config import settings
    from app.knowledge import distill, embed

    source = store.get_source(source_id, text=True)
    if not source:
        raise store.KnowledgeError(f"Source {source_id} not found.")
    if not source.get("text"):
        raise store.KnowledgeError("The source has no extracted text.")
    auto = settings.GUIDANCE_AUTO_APPROVE if auto_approve is None else auto_approve

    # A re-distillation replaces what was only proposed; reviewed items stay.
    for old in store.list_items(source_id=source_id, statuses=("proposed", "conflicting")):
        store.delete_item(old["id"])

    items, notes = await distill.distill(client, source["text"], title=source["title"])
    existing_hashes = {store.content_hash(i["title"], i["body"]) for i in store.list_items()}
    created: list[int] = []
    skipped = 0
    for item in items:
        digest = store.content_hash(item["title"], item["body"])
        if digest in existing_hashes:
            skipped += 1
            continue
        existing_hashes.add(digest)
        status = "active" if (auto and item["confidence"] == "high") else "proposed"
        try:
            saved = store.create_item({
                **{k: item[k] for k in ("kind", "category", "title", "body", "rationale", "strength",
                                        "subject", "audience", "conditions", "effect", "confidence")},
                "concept_id": scope_for(item["scope_hint"], source.get("concept_id")),
                "status": status, "origin": "distilled", "source_id": source_id,
                "source_ref": {"page": item["page"], "quote": item["quote"],
                               "document_id": source.get("document_id"), "library_id": source.get("library_id")},
            })
            created.append(saved["id"])
        except store.KnowledgeError as e:
            notes.append(f"Item \"{item['title']}\" skipped: {e}")

    embedded = await embed.embed_missing(client, created) if created else 0
    checked = await check_conflicts(created) if embedded else {"duplicates": 0, "conflicts": 0}
    if created and not embedded:
        notes.append("Embeddings unavailable — ranked by keywords only, and not checked for conflicts.")
    store.update_source(source_id, status="distilled", item_count=len(created),
                        message=" ".join(notes)[:2000] or None)
    return {"source_id": source_id, "created": len(created), "skipped_duplicates": skipped,
            "embedded": embedded, **checked, "notes": notes, "item_ids": created}


async def add_source(client: Any, *, data: Optional[bytes] = None, filename: str = "",
                     content_type: str = "", url: str = "", text: str = "", title: str = "",
                     concept_id: Optional[str] = None, library_id: Optional[str] = None,
                     auto_approve: Optional[bool] = None) -> dict:
    """Add a file, URL or pasted text, extract it and distil it. Returns the source and the result."""
    from app.knowledge import extract

    if concept_id:
        from app.catalog import store as catalog_store

        if not catalog_store.get_concept(concept_id):
            raise store.KnowledgeError(f"Concept '{concept_id}' does not exist.")
    source_type = "file" if data is not None else "url" if url else "text"
    if source_type == "text" and not text.strip():
        raise store.KnowledgeError("Provide a file, a URL or some text.")
    source = store.create_source(title=title or filename or url or "Pasted text", source_type=source_type,
                                 filename=filename or None, url=url or None, concept_id=concept_id,
                                 status="pending")
    started = time.monotonic()
    try:
        if data is not None:
            extracted, method = await extract.from_bytes(client, data, filename, content_type)
        elif url:
            extracted, method, page_title = await extract.from_url(client, url)
            if not title and page_title:
                store.update_source(source["id"], title=page_title[:300])
        else:
            extracted, method = text, "text"
    except Exception as e:
        store.update_source(source["id"], status="failed", message=str(e)[:1000])
        raise store.KnowledgeError(f"Could not read the source: {e}") from e

    library_doc = None
    if library_id and data is not None:
        try:
            from app.services import library_service

            library_doc = await library_service.upload_document(
                library_id, filename, data, content_type or "application/octet-stream")
        except Exception as e:
            logger.warning("Source %s not stored in library %s: %s", source["id"], library_id, e)

    store.update_source(
        source["id"], text=extracted, status="extracted", extraction_seconds=time.monotonic() - started,
        message=f"Extracted with {method}.", library_id=library_id if library_doc else None,
        document_id=str((library_doc or {}).get("id") or "") or None)
    result = await distill_source(client, source["id"], auto_approve=auto_approve)
    return {"source": store.get_source(source["id"]), "result": result}
