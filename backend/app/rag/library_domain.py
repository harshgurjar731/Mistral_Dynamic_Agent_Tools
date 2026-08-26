"""
Which domain a library serves — the join between the two ontologies.

The platform has a taxonomy that classifies *resources*: an agent serves
``domain.lending.mortgage``, a workflow serves ``domain.bfsi``. Libraries were
always missing from it — ``SubjectType.LIBRARY`` existed in the vocabulary and
nothing ever wrote one. This module writes them.

That one annotation is what connects the two halves of the feature:

    domain.lending.mortgage
       ↑ serves_domain          ↑ serves_domain
    Library "Mortgage Policy"   RAG Agent

Once both sides carry the same concept, three things that were guesswork become
lookups. The planner can pick the library whose domain matches the goal instead
of choosing from a flat list of names. The validator can tell that an agent has
been given a library from the wrong domain. And industry knowledge, document
search and the graph all narrow to the same subtree, so an answer assembled from
all three is about one subject rather than three.

Classification is best-effort and never blocking, exactly like agent
classification: a library with no domain still works, it is just invisible to
scoping.
"""

from __future__ import annotations

import asyncio
import logging
from typing import Iterable, Optional

from app.ontology import store as ontology_store
from app.ontology.vocab import Predicate, SubjectType

logger = logging.getLogger(__name__)

_tasks: set[asyncio.Task] = set()


def domains_for(library_id: str) -> list[str]:
    """The domains this library is annotated against."""
    if not library_id:
        return []
    try:
        annotations = ontology_store.annotations_for(
            SubjectType.LIBRARY.value, library_id
        )
        return annotations.get(Predicate.SERVES_DOMAIN.value, []) or []
    except Exception as e:
        logger.debug("Could not read domains for library %s: %s", library_id, e)
        return []


def domains_for_many(library_ids: Iterable[str]) -> dict[str, list[str]]:
    """One query for a whole page of libraries."""
    ids = [lid for lid in library_ids if lid]
    if not ids:
        return {}
    try:
        annotated = ontology_store.annotations_for_many(SubjectType.LIBRARY.value, ids)
    except Exception as e:
        logger.debug("Could not read library domains: %s", e)
        return {}
    return {
        library_id: (values.get(Predicate.SERVES_DOMAIN.value) or [])
        for library_id, values in annotated.items()
    }


def set_domains(library_id: str, domains: Iterable[str], source: str = "user") -> list[str]:
    """Record which domains a library serves, replacing whatever was there."""
    values = [d for d in domains if d]
    ontology_store.set_annotations(
        SubjectType.LIBRARY.value,
        library_id,
        Predicate.SERVES_DOMAIN.value,
        values,
        source=source,
    )
    return values


def clear_domains(library_id: str) -> None:
    """Forget a deleted library's annotations."""
    try:
        ontology_store.set_annotations(
            SubjectType.LIBRARY.value,
            library_id,
            Predicate.SERVES_DOMAIN.value,
            [],
            source="system",
        )
    except Exception as e:
        logger.debug("Could not clear domains for library %s: %s", library_id, e)


async def classify(
    client,
    library_id: str,
    *,
    name: str,
    description: str = "",
) -> list[str]:
    """Ask a model which domain this library serves, and record the answer.

    The library's ontology summary is passed as the strongest signal available.
    A name like "Policies 2026" says nothing; the summary the architect wrote —
    "supply agreements between manufacturers and their carriers" — places the
    library precisely. Falling back to name and description alone still works
    for a library that has no ontology yet.
    """
    from app.ontology.classifier import apply_classification
    from app.ontology.classifier import classify as classify_resource
    from app.rag import library_ontology

    ontology = library_ontology.get_approved(library_id) or library_ontology.get_draft(
        library_id
    )
    context = (ontology or {}).get("summary") or ""
    if ontology and ontology.get("entity_types"):
        context += "\nContent types: " + ", ".join(
            t["name"] for t in ontology["entity_types"]
        )

    try:
        result = await classify_resource(
            client,
            name=name,
            description=description,
            instructions=context,
            subject_kind="document library",
        )
    except Exception as e:
        logger.warning("Library classification failed for %s: %s", library_id, e)
        return []

    if not result:
        return []

    try:
        # A library has no tier — that vocabulary describes agents.
        apply_classification(
            SubjectType.LIBRARY.value, library_id, result, include_tier=False
        )
    except Exception as e:
        logger.warning("Could not apply library classification: %s", e)
        return []

    domains = result.get("domains") or []
    if domains:
        logger.info("Library %s classified as %s", library_id, domains)
    return domains


def schedule_classification(client, library_id: str, *, name: str, description: str = "") -> None:
    """Classify in the background. Never blocks, never raises.

    Same reasoning as agent classification: the library already exists and is
    usable, and an annotation arriving two seconds later costs the user nothing.
    """
    async def _run() -> None:
        try:
            await classify(client, library_id, name=name, description=description)
        except Exception as e:
            logger.debug("Background library classification failed: %s", e)

    try:
        task = asyncio.create_task(_run())
        _tasks.add(task)
        task.add_done_callback(_tasks.discard)
    except RuntimeError:
        logger.debug("No event loop to classify library %s", library_id)


async def backfill(client, limit: int = 100) -> dict:
    """Classify every library that has no domain yet. Idempotent.

    Runs on boot. Libraries predate this annotation entirely, so without a
    backfill the planner's domain scoping would apply to an empty set and
    quietly change nothing.
    """
    from app.services import library_service

    summary = {"checked": 0, "classified": 0, "skipped": 0, "failed": 0}
    try:
        libraries = await library_service.list_libraries()
    except Exception as e:
        logger.warning("Library classification backfill skipped: %s", e)
        return summary

    known = domains_for_many([lib.get("id") for lib in libraries])

    for library in libraries[:limit]:
        library_id = library.get("id")
        if not library_id:
            continue
        summary["checked"] += 1
        if known.get(library_id):
            summary["skipped"] += 1
            continue
        try:
            domains = await classify(
                client,
                library_id,
                name=library.get("name") or "",
                description=library.get("description") or "",
            )
            if domains:
                summary["classified"] += 1
            else:
                summary["skipped"] += 1
        except Exception as e:
            summary["failed"] += 1
            logger.debug("Could not classify library %s: %s", library_id, e)

    if summary["classified"] or summary["failed"]:
        logger.info("Library domain backfill: %s", summary)
    return summary


def in_scope(library_ids: Iterable[str], scope: Optional[dict]) -> set[str]:
    """Narrow libraries to those serving the goal's domain.

    Unannotated libraries are kept, matching how the planner already treats
    unannotated agents: dropping them would make a half-finished backfill look
    like a broken planner, and the failure would be silent.
    """
    from app.ontology import matcher

    ids = {lid for lid in library_ids if lid}
    if not scope or not scope.get("scoped"):
        return ids
    return matcher.filter_subjects(
        SubjectType.LIBRARY.value, ids, scope, Predicate.SERVES_DOMAIN.value
    )
