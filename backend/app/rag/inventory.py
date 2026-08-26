"""
The library inventory the planners see.

A planner can only attach a library it knows exists, so this renders the same
inventory for both planning paths — the orchestrator building one dynamic agent
and the workflow architect designing a pipeline. It is the same shape the
connector inventory takes, for the same reason.

Two things it carries beyond the names, both of which change what a planner can
decide:

* **The domain each library serves.** Scoping to the goal's domain is what turns
  "pick one of eleven libraries" into "pick the mortgage one". Unannotated
  libraries are kept rather than hidden, matching how the planner already treats
  unannotated agents.

* **What each library can actually answer.** A library with entity types and a
  populated graph can answer relationship questions; one with documents but no
  graph can only answer from text. A planner told the difference stops attaching
  a library to a step whose question it cannot serve.

Never fatal. A planner that cannot reach this should plan without libraries,
not fail.
"""

from __future__ import annotations

import json
import logging
from typing import Optional

logger = logging.getLogger(__name__)

#: Rendered when there is nothing to offer. Phrased as an instruction because
#: an empty list invites a model to invent one anyway.
_EMPTY = (
    "(no document libraries exist yet — do not attach one, and do not invent "
    "a library id)"
)


async def describe_for_prompt(
    scope: Optional[dict] = None,
    limit: int = 25,
) -> tuple[str, list[str]]:
    """Return ``(description_block, valid_library_ids)`` for a planner prompt.

    ``scope`` is the goal's matched domain subtree, from
    ``ontology.matcher.scope_for_goal``. Passing None returns everything, which
    is what an unscoped goal should see.
    """
    from app.services import library_service

    try:
        libraries = await library_service.list_libraries()
    except Exception as e:
        logger.debug("Library inventory unavailable for planning: %s", e)
        return _EMPTY, []

    if not libraries:
        return _EMPTY, []

    from app.rag import graph_store, library_domain, library_ontology, store

    all_ids = [lib.get("id") for lib in libraries if lib.get("id")]
    keep = library_domain.in_scope(all_ids, scope)
    domains = library_domain.domains_for_many(all_ids)
    tracked = store.counts_by_library()
    graph = graph_store.stats(all_ids).get("libraries", {})

    entries = []
    for library in libraries:
        library_id = library.get("id")
        if not library_id or library_id not in keep:
            continue
        if len(entries) >= limit:
            break

        counts = tracked.get(library_id, {})
        stats = graph.get(library_id, {})
        ontology = library_ontology.get_approved(library_id)

        entries.append({
            "id": library_id,
            "name": library.get("name") or library_id,
            "description": (library.get("description") or "")[:200],
            "serves_domain": domains.get(library_id, []),
            "documents": library.get("document_count") or counts.get("documents", 0),
            "graphed_documents": counts.get("graphed", 0),
            "entities": stats.get("entities", 0),
            "relations": stats.get("relations", 0),
            # The vocabulary is the most useful single field: it says what
            # questions this library is able to answer at all.
            "content_types": (
                [t["name"] for t in ontology["entity_types"]] if ontology else []
            ),
        })

    if not entries:
        return _EMPTY, []

    return json.dumps(entries, indent=2), [entry["id"] for entry in entries]
