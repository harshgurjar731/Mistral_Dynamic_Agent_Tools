"""
Embeddings for knowledge items — mistral-embed, best effort.

Items are embedded at ingestion (or by ``embed_missing``), the goal once per
build. Everything here returns None on failure: ranking then falls back to the
lexical score, which is how retrieval worked before embeddings existed.
"""

from __future__ import annotations

import asyncio
import hashlib
import logging
from typing import Any, Optional

logger = logging.getLogger(__name__)

_CACHE: dict[str, list[float]] = {}
_CACHE_MAX = 256


def _key(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


async def embed_texts(client: Any, texts: list[str]) -> Optional[list[list[float]]]:
    if client is None or not texts:
        return None
    from app.config import settings

    try:
        response = await asyncio.to_thread(
            client.embeddings.create, model=settings.KNOWLEDGE_EMBED_MODEL, inputs=texts)
        return [list(d.embedding) for d in response.data]
    except Exception as e:
        logger.info("Embedding unavailable (%s) — lexical ranking only", e)
        return None


async def embed_query(client: Any, text: str) -> Optional[list[float]]:
    """One query vector, cached by content so repeat builds and revisions reuse it."""
    text = (text or "").strip()[:4000]
    if not text:
        return None
    key = _key(text)
    if key in _CACHE:
        return _CACHE[key]
    vectors = await embed_texts(client, [text])
    if not vectors:
        return None
    if len(_CACHE) >= _CACHE_MAX:
        _CACHE.pop(next(iter(_CACHE)))
    _CACHE[key] = vectors[0]
    return vectors[0]


def item_text(item: dict) -> str:
    return f"{item.get('title', '')}\n{item.get('body', '')}\n{' '.join(item.get('tags') or [])}"


async def embed_missing(client: Any, item_ids: Optional[list[int]] = None, batch: int = 32) -> int:
    """Embed active and proposed items that have no vector yet. Returns how many were stored."""
    from app.knowledge import store

    items = [i for i in store.list_items(ids=item_ids, statuses=("active", "proposed"))
             if not i["has_embedding"]]
    done = 0
    for start in range(0, len(items), batch):
        chunk = items[start:start + batch]
        vectors = await embed_texts(client, [item_text(i) for i in chunk])
        if not vectors:
            break
        for item, vector in zip(chunk, vectors):
            store.set_embedding(item["id"], vector)
            done += 1
    return done
