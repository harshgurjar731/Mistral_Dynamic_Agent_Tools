"""
Industry knowledge — the seed-and-CRUD surface kept from the old runtime feature.

Industry knowledge used to be searched by built agents at run time, through
the ``search_domain_knowledge`` tool. It is now read while planning — by the
industry-knowledge layer, next to process knowledge — and by tool and activity
code generation (``app.knowledge.industry``). Nothing reads it at run time.

What stays here is what the seed loader, the boot migration and older imports
(``app.ontology.knowledge``) use: create-or-update by (concept, title), list,
delete and count, in the shape those callers have always had.
"""

from __future__ import annotations

import logging
from typing import Iterable, Optional

from app.catalog import store
from app.database import SessionLocal  # noqa: F401  (kept: tests patch it on this module)
from app.knowledge import store as knowledge_store

logger = logging.getLogger(__name__)

#: Categories accepted on write: the industry categories, plus the older
#: names the seed files still use (mapped by ``knowledge.store.normalise``).
KINDS = knowledge_store.INDUSTRY_CATEGORIES + tuple(knowledge_store.LEGACY_REFERENCE_CATEGORIES)


def _to_dict(item: dict) -> dict:
    """A knowledge item in the shape this module has always returned.

    ``kind`` here is the item's category (regulation, metric, …).
    """
    return {
        "id": item["id"],
        "concept_id": item["concept_id"],
        "kind": item["category"],
        "title": item["title"],
        "body": item["body"],
        "tags": item["tags"],
        "as_of": item["as_of"],
        "source": item["origin"],
    }


def ensure_schema() -> None:
    """Additive migrations — see ``app.knowledge.store.ensure_schema``."""
    knowledge_store.ensure_schema()


def list_entries(
    concept_id: Optional[str] = None,
    kind: Optional[str] = None,
    limit: int = 500,
) -> list[dict]:
    """Active industry knowledge, optionally on one concept or of one category."""
    items = knowledge_store.list_items(
        kind="reference", concept_id=concept_id, category=kind, status="active", limit=limit,
    )
    return [_to_dict(i) for i in items]


def upsert_entry(
    concept_id: str,
    title: str,
    body: str,
    kind: str = "definition",
    tags: Optional[Iterable[str]] = None,
    source: str = "user",
    as_of: Optional[str] = None,
) -> dict:
    """Create or update one entry, keyed on (concept, title).

    ``best_practice`` entries are build guidance, not industry facts, and are
    filed as guidance — as they always were.
    """
    if not concept_id or not title.strip() or not body.strip():
        raise ValueError("concept_id, title and body are all required.")
    if not store.get_concept(concept_id):
        raise ValueError(f"Concept '{concept_id}' does not exist.")
    guidance = kind == "best_practice"
    try:
        item = knowledge_store.upsert_item({
            "kind": "guidance" if guidance else "reference",
            "category": kind if kind in KINDS else "definition",
            "concept_id": concept_id, "title": title.strip(), "body": body.strip(),
            "tags": list(tags or []), "audience": "both" if guidance else "builder",
            "origin": source, "as_of": as_of, "status": "active",
        }, key=("concept_id", "title"))
    except knowledge_store.KnowledgeError as e:
        raise ValueError(str(e)) from e
    return _to_dict(item)


def delete_entry(entry_id: int) -> bool:
    return knowledge_store.delete_item(entry_id)


def counts() -> dict:
    rows = list_entries(limit=100000)
    return {"entries": len(rows), "concepts": len({r["concept_id"] for r in rows})}
