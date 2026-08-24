"""
The library inventory the planners see.

A planner can only attach a library it knows exists. This renders the same
inventory for both planning paths — the orchestrator building one dynamic agent
and the workflow architect designing a pipeline — so a generated agent binds to
a real library id rather than inventing one that fails at agent creation. It is
the same shape the connector inventory already takes, for the same reason.

The entity count is the part that matters and the part a bare library list
cannot express: a library with a graph supports relationship questions, and one
without supports text search only. A planner told that difference can choose the
library that will actually answer the goal.

Never fatal. A planner that cannot reach the inventory should plan without
libraries, not fail.
"""

from __future__ import annotations

import json
import logging

logger = logging.getLogger(__name__)

#: Rendered when there is nothing to offer. Phrased as an instruction because
#: an empty list invites a model to invent one anyway.
_EMPTY = (
    "(no document libraries exist yet — do not attach one, and do not invent "
    "a library id)"
)


async def describe_for_prompt(limit: int = 25) -> tuple[str, list[str]]:
    """Return ``(description_block, valid_library_ids)`` for a planner prompt."""
    from app.services import library_service

    try:
        libraries = await library_service.list_libraries()
    except Exception as e:
        logger.debug("Library inventory unavailable for planning: %s", e)
        return _EMPTY, []

    if not libraries:
        return _EMPTY, []

    from app.rag import graph_store, store

    ids = [lib.get("id") for lib in libraries if lib.get("id")][:limit]
    tracked = store.counts_by_library()
    graph = graph_store.stats(ids).get("libraries", {})

    entries = []
    for library in libraries[:limit]:
        library_id = library.get("id")
        if not library_id:
            continue
        counts = tracked.get(library_id, {})
        stats = graph.get(library_id, {})
        entries.append({
            "id": library_id,
            "name": library.get("name") or library_id,
            "description": (library.get("description") or "")[:200],
            "documents": library.get("document_count") or counts.get("documents", 0),
            "graphed_documents": counts.get("graphed", 0),
            "entities": stats.get("entities", 0),
            "relations": stats.get("relations", 0),
        })

    if not entries:
        return _EMPTY, []

    return json.dumps(entries, indent=2), [entry["id"] for entry in entries]
