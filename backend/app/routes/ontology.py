"""
Ontology Routes — /api/ontology

Read endpoints feed the frontend selects and the concept browser. Write
endpoints exist so annotations can be corrected in the UI rather than by
editing YAML and restarting — which matters, because the backfill is
LLM-assisted and its output needs human review.
"""

import logging

from fastapi import APIRouter, Query
from pydantic import BaseModel, Field
from typing import Optional

from app.ontology import matcher, store
from app.ontology.vocab import Predicate, Scheme, SubjectType, tier_labels

logger = logging.getLogger(__name__)
router = APIRouter(tags=["Ontology"])


class AnnotateRequest(BaseModel):
    subject_type: str = Field(..., description="agent | tool | connector | workflow | library")
    subject_id: str
    predicate: str
    concept_ids: list[str] = Field(default_factory=list)
    source: str = "user"


@router.get("/ontology")
async def overview():
    """Vocabulary sizes and whether the store has been seeded."""
    return {
        "seeded": store.is_seeded(),
        "counts": store.counts(),
        "schemes": store.list_schemes(),
        "predicates": [p.value for p in Predicate],
        "subject_types": [s.value for s in SubjectType],
    }


@router.get("/ontology/tiers")
async def get_tiers():
    """The agent tier vocabulary — the single source for the UI selects."""
    return {"tiers": tier_labels()}


@router.get("/ontology/schemes")
async def get_schemes():
    return {"schemes": store.list_schemes()}


@router.get("/ontology/concepts")
async def get_concepts(scheme: Optional[str] = Query(default=None)):
    """Concepts, optionally within one scheme. Flat — the UI nests by parent_id."""
    concepts = store.list_concepts(scheme)
    return {"concepts": concepts, "count": len(concepts)}


@router.get("/ontology/concepts/{concept_id}/descendants")
async def get_descendants(concept_id: str):
    ids = sorted(store.descendants(concept_id))
    return {"concept_id": concept_id, "descendants": ids, "count": len(ids)}


@router.get("/ontology/annotations/{subject_type}/{subject_id}")
async def get_annotations(subject_type: str, subject_id: str):
    return {
        "subject_type": subject_type,
        "subject_id": subject_id,
        "annotations": store.annotations_for(subject_type, subject_id),
    }


@router.put("/ontology/annotations")
async def put_annotations(request: AnnotateRequest):
    """Replace the concepts for one (subject, predicate) pair.

    Replace rather than append — the editor sends the full current set, so an
    omitted concept means the user removed it.
    """
    store.set_annotations(
        request.subject_type,
        request.subject_id,
        request.predicate,
        request.concept_ids,
        source=request.source,
    )
    return {
        "status": "saved",
        "annotations": store.annotations_for(request.subject_type, request.subject_id),
    }


@router.get("/ontology/scope")
async def preview_scope(goal: str = Query(..., min_length=3)):
    """What a goal would be narrowed to. Useful for debugging retrieval."""
    scope = matcher.scope_for_goal(goal)
    return {
        "goal": goal,
        "scoped": scope["scoped"],
        "domains": scope["domains"],
        "label": matcher.describe_scope(scope),
        "concepts": sorted(scope["concepts"]),
        "scores": matcher.score_concepts(goal, Scheme.DOMAIN.value)[:8],
    }
