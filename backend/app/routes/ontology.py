"""
Ontology Routes — /api/ontology

Four groups:

* **Read** — schemes, concepts, annotations. Feeds the browser and the selects.
* **Vocabulary CRUD** — create, edit and delete schemes and concepts at runtime.
  The YAML seed is the *shipped* vocabulary; this is how it grows in place.
* **Annotation CRUD** — the typed links. Writes from here are ``source="user"``,
  which is what promotes a capability gap from advisory to publish-blocking.
* **Graph and classification** — the connected view, and the LLM classifier
  used when a resource is created by hand rather than by the planner.

Deletes report what they would break before doing it: a concept id is what
annotations point at, and orphaning one fails silently.
"""

import logging
from typing import Optional

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from app.dependencies import get_mistral_client
from app.ontology import classifier, graph as ontology_graph, matcher, store
from app.ontology.store import VocabularyError
from app.ontology.vocab import Predicate, Scheme, SubjectType, tier_labels

logger = logging.getLogger(__name__)
router = APIRouter(tags=["Ontology"])


def _vocab_guard(fn):
    """Map a VocabularyError onto a 4xx with its message intact."""
    def wrapper(*args, **kwargs):
        try:
            return fn(*args, **kwargs)
        except VocabularyError as e:
            raise HTTPException(status_code=409, detail=str(e))
    return wrapper


# ── Request bodies ─────────────────────────────────────────────────────────

class AnnotateRequest(BaseModel):
    subject_type: str = Field(..., description="agent | tool | connector | workflow | library")
    subject_id: str
    predicate: str
    concept_ids: list[str] = Field(default_factory=list)
    source: str = "user"


class BulkAnnotationsRequest(BaseModel):
    subject_type: str
    subject_ids: list[str] = Field(default_factory=list)


class SchemeRequest(BaseModel):
    id: str
    label: str
    description: Optional[str] = None


class SchemeUpdate(BaseModel):
    label: Optional[str] = None
    description: Optional[str] = None


class ConceptRequest(BaseModel):
    id: str
    scheme_id: str
    label: str
    parent_id: Optional[str] = None
    definition: Optional[str] = None
    synonyms: list[str] = Field(default_factory=list)


class ConceptUpdate(BaseModel):
    label: Optional[str] = None
    parent_id: Optional[str] = None
    definition: Optional[str] = None
    synonyms: Optional[list[str]] = None
    # Distinguishes "promote to root" from "leave the parent alone", which a
    # nullable field alone cannot express.
    clear_parent: bool = False


class AnnotationTriple(BaseModel):
    subject_type: str
    subject_id: str
    predicate: str
    concept_id: str
    source: str = "user"


class ClassifyRequest(BaseModel):
    name: str
    description: str = ""
    instructions: str = ""
    subject_kind: str = "agent"
    # When both are given the result is written straight to the store.
    subject_type: Optional[str] = None
    subject_id: Optional[str] = None


# ── Read ───────────────────────────────────────────────────────────────────

@router.get("/ontology")
async def overview():
    """Vocabulary sizes and whether the store has been seeded."""
    return {
        "seeded": store.is_seeded(),
        "counts": store.counts(),
        "schemes": store.list_schemes(),
        "predicates": [p.value for p in Predicate],
        "subject_types": [s.value for s in SubjectType],
        "level_names": list(store.DOMAIN_LEVEL_NAMES),
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
    """Concepts, optionally within one scheme.

    Flat, with ``level`` and ``level_name`` on each row — the UI nests by
    ``parent_id`` and labels the depth (industry / domain / subdomain).
    """
    concepts = store.list_concepts(scheme)
    return {"concepts": concepts, "count": len(concepts)}


@router.get("/ontology/concepts/{concept_id}/descendants")
async def get_descendants(concept_id: str):
    ids = sorted(store.descendants(concept_id))
    return {"concept_id": concept_id, "descendants": ids, "count": len(ids)}


@router.get("/ontology/concepts/{concept_id}/usage")
async def get_concept_usage(concept_id: str):
    """What deleting this concept would take with it."""
    if not store.get_concept(concept_id):
        raise HTTPException(status_code=404, detail=f"Concept '{concept_id}' not found")
    return {"concept_id": concept_id, **store.concept_usage(concept_id)}


# ── Vocabulary CRUD ────────────────────────────────────────────────────────

@router.post("/ontology/schemes", status_code=201)
async def create_scheme(request: SchemeRequest):
    return _vocab_guard(store.create_scheme)(
        request.id, request.label, request.description
    )


@router.patch("/ontology/schemes/{scheme_id}")
async def update_scheme(scheme_id: str, request: SchemeUpdate):
    return _vocab_guard(store.update_scheme)(
        scheme_id, request.label, request.description
    )


@router.delete("/ontology/schemes/{scheme_id}")
async def delete_scheme(
    scheme_id: str,
    cascade: bool = Query(False, description="Also delete its concepts and their annotations"),
):
    return _vocab_guard(store.delete_scheme)(scheme_id, cascade)


@router.post("/ontology/concepts", status_code=201)
async def create_concept(request: ConceptRequest):
    return _vocab_guard(store.create_concept)(
        request.id, request.scheme_id, request.label,
        request.parent_id, request.definition, request.synonyms,
    )


@router.patch("/ontology/concepts/{concept_id}")
async def update_concept(concept_id: str, request: ConceptUpdate):
    return _vocab_guard(store.update_concept)(
        concept_id, request.label, request.parent_id,
        request.definition, request.synonyms, request.clear_parent,
    )


@router.delete("/ontology/concepts/{concept_id}")
async def delete_concept(
    concept_id: str,
    cascade: bool = Query(False, description="Also delete descendants and their annotations"),
):
    return _vocab_guard(store.delete_concept)(concept_id, cascade)


# ── Annotations ────────────────────────────────────────────────────────────

@router.get("/ontology/annotations")
async def search_annotations(
    subject_type: Optional[str] = Query(None),
    predicate: Optional[str] = Query(None),
    concept_id: Optional[str] = Query(None),
    source: Optional[str] = Query(None),
    limit: int = Query(500, ge=1, le=5000),
):
    """Browse the annotation table directly."""
    rows = store.search_annotations(subject_type, predicate, concept_id, source, limit)
    return {"annotations": rows, "count": len(rows)}


@router.post("/ontology/annotations/bulk")
async def get_annotations_bulk(request: BulkAnnotationsRequest):
    """Annotations for many subjects at once, keyed by subject id.

    POST rather than GET because the id list is unbounded. Subjects with
    nothing recorded come back as empty maps rather than omitted, so a caller
    can tell "no annotations" apart from "not asked for".
    """
    if not request.subject_ids:
        return {"subject_type": request.subject_type, "annotations": {}}

    found = store.annotations_for_many(request.subject_type, request.subject_ids)
    return {
        "subject_type": request.subject_type,
        "annotations": {sid: found.get(sid, {}) for sid in request.subject_ids},
    }


@router.get("/ontology/annotations/{subject_type}/{subject_id}")
async def get_annotations(subject_type: str, subject_id: str):
    return {
        "subject_type": subject_type,
        "subject_id": subject_id,
        "annotations": store.annotations_for(subject_type, subject_id),
        "sources": {
            predicate: store.annotation_sources(subject_type, subject_id, predicate)
            for predicate in store.annotations_for(subject_type, subject_id)
        },
    }


@router.put("/ontology/annotations")
async def put_annotations(request: AnnotateRequest):
    """Replace the concepts for one (subject, predicate) pair.

    Replace rather than append — the editor sends the full current set, so an
    omitted concept means the user removed it.
    """
    store.set_annotations(
        request.subject_type, request.subject_id, request.predicate,
        request.concept_ids, source=request.source,
    )
    return {
        "status": "saved",
        "annotations": store.annotations_for(request.subject_type, request.subject_id),
    }


@router.post("/ontology/annotations/one", status_code=201)
async def add_annotation(request: AnnotationTriple):
    """Add a single triple without disturbing the subject's others."""
    return _vocab_guard(store.add_annotation)(
        request.subject_type, request.subject_id,
        request.predicate, request.concept_id, request.source,
    )


@router.delete("/ontology/annotations/one")
async def remove_annotation(
    subject_type: str = Query(...),
    subject_id: str = Query(...),
    predicate: str = Query(...),
    concept_id: str = Query(...),
):
    return _vocab_guard(store.remove_annotation)(
        subject_type, subject_id, predicate, concept_id
    )


@router.delete("/ontology/annotations/{subject_type}/{subject_id}")
async def clear_subject(subject_type: str, subject_id: str):
    """Forget everything recorded about one subject."""
    return store.delete_subject_annotations(subject_type, subject_id)


# ── Graph ──────────────────────────────────────────────────────────────────

@router.get("/ontology/graph")
async def get_graph(
    kinds: Optional[str] = Query(None, description="Comma-separated node kinds to keep"),
    scheme: Optional[str] = Query(None),
    root_concept: Optional[str] = Query(None, description="Restrict to one subtree"),
    subject_type: Optional[str] = Query(None),
    search: Optional[str] = Query(None),
    include_orphans: bool = Query(True, description="Keep nodes with no edges"),
    hops: int = Query(1, ge=1, le=3, description="How far to expand around a filter match"),
):
    """The whole knowledge graph: vocabulary plus everything annotated against it."""
    kind_list = [k.strip() for k in kinds.split(",") if k.strip()] if kinds else None
    return await ontology_graph.build_graph(
        get_mistral_client(),
        kinds=kind_list,
        scheme=scheme,
        root_concept=root_concept,
        subject_type=subject_type,
        search=search,
        include_orphans=include_orphans,
        hops=hops,
    )


@router.get("/ontology/scope")
async def preview_scope(goal: str = Query(..., min_length=3)):
    """What a goal would be narrowed to. Useful for debugging retrieval."""
    scope = matcher.scope_for_goal(goal)
    concepts = sorted(scope["concepts"])

    # The matched subtree, with enough shape for the client to draw it rather
    # than re-query each concept.
    detail = [store.get_concept(cid) for cid in concepts]
    return {
        "goal": goal,
        "scoped": scope["scoped"],
        "domains": scope["domains"],
        "label": matcher.describe_scope(scope),
        "concepts": concepts,
        "concept_detail": [c for c in detail if c],
        "scores": matcher.score_concepts(goal, Scheme.DOMAIN.value)[:8],
    }


@router.get("/ontology/scope/graph")
async def preview_scope_graph(goal: str = Query(..., min_length=3)):
    """The scope preview as a graph — matched subtree plus what it admits."""
    scope = matcher.scope_for_goal(goal)
    if not scope["scoped"]:
        # Unscoped means the planner sees everything; drawing "everything" here
        # would misrepresent a *failure to match* as a rich result.
        return {
            "goal": goal, "scoped": False,
            "label": matcher.describe_scope(scope),
            "nodes": [], "edges": [], "counts": {}, "totals": {"nodes": 0, "edges": 0},
        }

    result = await ontology_graph.build_graph(
        get_mistral_client(), root_concept=",".join(scope["domains"]),
    )
    result.update({
        "goal": goal,
        "scoped": True,
        "label": matcher.describe_scope(scope),
        "matched_domains": scope["domains"],
    })
    return result


# ── Classification ─────────────────────────────────────────────────────────

@router.post("/ontology/classify")
async def classify_resource(request: ClassifyRequest):
    """Classify a resource against the vocabulary with an LLM.

    Used when an agent or workflow is created by hand — there is no planner
    goal to infer a domain from, and the lexical heuristics only fire on words
    that literally appear.

    Pass ``subject_type`` and ``subject_id`` to persist the result; omit them
    to preview it.
    """
    client = get_mistral_client()
    result = await classifier.classify(
        client,
        name=request.name,
        description=request.description,
        instructions=request.instructions,
        subject_kind=request.subject_kind,
    )
    if not result:
        return {"classified": False, "detail": "The classifier returned nothing usable."}

    written = {}
    if request.subject_type and request.subject_id:
        written = classifier.apply_classification(
            request.subject_type, request.subject_id, result,
            include_tier=(request.subject_type == SubjectType.AGENT.value),
        )

    return {"classified": True, "result": result, "written": written}
