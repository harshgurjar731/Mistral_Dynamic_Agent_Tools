"""
Knowledge routes — the Knowledge page (guidance, reference, sources) and the
recommendation import on the Processes page.

    GET    /knowledge/items                       list (?kind= &status= &category= &concept_id= &source_id=)
    POST   /knowledge/items                       create one
    GET    /knowledge/items/{id}                  one
    PUT    /knowledge/items/{id}                  edit
    DELETE /knowledge/items/{id}
    POST   /knowledge/items/status                approve / retire many {ids, status}
    GET    /knowledge/counts                      per kind and status
    GET    /knowledge/vocabulary                  categories, strengths, condition attributes, effects
    GET    /knowledge/sources                     every source
    POST   /knowledge/sources                     add a file, URL or text — extracted and distilled
    POST   /knowledge/sources/{id}/distill        distil again (replaces its proposed items)
    DELETE /knowledge/sources/{id}                with its items (?items=false keeps them)
    POST   /knowledge/retrieve                    what a build would receive {goal, concept_ids, facts, subject}
    POST   /knowledge/embed                       embed items that have no vector yet
    POST   /processes/recommendations/import      import a recommendation file (?save=false previews)
    POST   /processes/recommendations/missing     which mapping attributes a document lacks
"""

from __future__ import annotations

import logging
from typing import Any, Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile
from pydantic import BaseModel, Field

from app.config import settings
from app.dependencies import get_mistral_client
from app.knowledge import store

logger = logging.getLogger(__name__)

router = APIRouter(tags=["Knowledge"])


class ItemBody(BaseModel):
    kind: str = "guidance"
    category: Optional[str] = None
    concept_id: Optional[str] = None
    title: str
    body: str
    tags: list[str] = Field(default_factory=list)
    audience: Optional[str] = None
    subject: str = "both"
    strength: Optional[str] = None
    conditions: list[dict] = Field(default_factory=list)
    effect: dict = Field(default_factory=dict)
    layers: list[str] = Field(default_factory=list)
    rationale: str = ""
    status: str = "active"
    confidence: Optional[str] = None
    as_of: Optional[str] = None


class StatusBody(BaseModel):
    ids: list[int]
    status: str


class RetrieveBody(BaseModel):
    goal: str
    concept_ids: list[str] = Field(default_factory=list)
    facts: dict = Field(default_factory=dict)
    subject: str = "both"
    include_proposed: bool = False


def _bad(e: Exception) -> HTTPException:
    return HTTPException(status_code=400, detail=str(e))


# ── Items ──────────────────────────────────────────────────────────────────


@router.get("/knowledge/items")
async def list_items(kind: Optional[str] = None, status: Optional[str] = None,
                     category: Optional[str] = None, concept_id: Optional[str] = None,
                     source_id: Optional[int] = None, limit: int = Query(2000, le=10000)):
    items = store.list_items(kind=kind, status=status, category=category, concept_id=concept_id,
                             source_id=source_id, limit=limit)
    return {"items": items, "count": len(items)}


@router.post("/knowledge/items")
async def create_item(body: ItemBody):
    try:
        return store.create_item({**body.model_dump(), "origin": "user"})
    except store.KnowledgeError as e:
        raise _bad(e)


@router.get("/knowledge/items/{item_id}")
async def get_item(item_id: int):
    item = store.get_item(item_id)
    if not item:
        raise HTTPException(status_code=404, detail="Knowledge item not found.")
    return item


@router.put("/knowledge/items/{item_id}")
async def update_item(item_id: int, body: dict):
    try:
        return store.update_item(item_id, body)
    except store.KnowledgeError as e:
        raise _bad(e)


@router.delete("/knowledge/items/{item_id}")
async def delete_item(item_id: int):
    if not store.delete_item(item_id):
        raise HTTPException(status_code=404, detail="Knowledge item not found.")
    return {"deleted": item_id}


@router.post("/knowledge/items/status")
async def set_status(body: StatusBody):
    try:
        return {"updated": store.set_status(body.ids, body.status)}
    except store.KnowledgeError as e:
        raise _bad(e)


@router.get("/knowledge/counts")
async def counts():
    return {"counts": store.counts(), "sources": len(store.list_sources())}


@router.get("/knowledge/vocabulary")
async def vocabulary():
    from app.knowledge import distill, retrieval

    return {
        "kinds": list(store.KINDS), "reference_categories": list(store.REFERENCE_CATEGORIES),
        "guidance_categories": list(store.GUIDANCE_CATEGORIES), "strengths": list(store.STRENGTHS),
        "audiences": list(store.AUDIENCES), "subjects": list(store.SUBJECTS),
        "statuses": list(store.STATUSES), "category_views": {k: list(v) for k, v in retrieval.CATEGORY_VIEWS.items()},
        "default_mode": settings.GUIDANCE_DEFAULT_MODE, "auto_approve": settings.GUIDANCE_AUTO_APPROVE,
        **distill.describe_vocabulary(),
    }


# ── Sources ────────────────────────────────────────────────────────────────


@router.get("/knowledge/sources")
async def list_sources():
    return {"sources": store.list_sources()}


@router.post("/knowledge/sources")
async def add_source(
    file: Optional[UploadFile] = File(None),
    url: str = Form(""),
    text: str = Form(""),
    title: str = Form(""),
    concept_id: Optional[str] = Form(None),
    library_id: Optional[str] = Form(None),
    auto_approve: Optional[bool] = Form(None),
    client=Depends(get_mistral_client),
):
    from app.knowledge import ingest

    data = None
    filename, content_type = "", ""
    if file is not None:
        data = await file.read()
        if len(data) > settings.KNOWLEDGE_SOURCE_MAX_MB * 1024 * 1024:
            raise HTTPException(status_code=413, detail=f"Files are limited to {settings.KNOWLEDGE_SOURCE_MAX_MB} MB.")
        filename, content_type = file.filename or "upload", file.content_type or ""
    try:
        return await ingest.add_source(client, data=data, filename=filename, content_type=content_type,
                                       url=url.strip(), text=text, title=title.strip(),
                                       concept_id=concept_id or None, library_id=library_id or None,
                                       auto_approve=auto_approve)
    except store.KnowledgeError as e:
        raise _bad(e)


@router.post("/knowledge/sources/{source_id}/distill")
async def redistill(source_id: int, client=Depends(get_mistral_client)):
    from app.knowledge import ingest

    try:
        return await ingest.distill_source(client, source_id)
    except store.KnowledgeError as e:
        raise _bad(e)


@router.delete("/knowledge/sources/{source_id}")
async def delete_source(source_id: int, items: bool = True):
    try:
        return store.delete_source(source_id, items=items)
    except store.KnowledgeError as e:
        raise _bad(e)


# ── Retrieval ──────────────────────────────────────────────────────────────


@router.post("/knowledge/retrieve")
async def retrieve(body: RetrieveBody, client=Depends(get_mistral_client)):
    """Exactly what a build with this goal, scope and facts would be given."""
    from app.knowledge import embed, retrieval

    statuses = ("active", "proposed") if body.include_proposed else ("active",)
    candidates = store.list_items(kind="guidance", statuses=statuses, audiences=("builder", "both"),
                                  embedding=True)
    vector = await embed.embed_query(client, body.goal) if any(c.get("embedding") for c in candidates) else None
    if vector is None:
        for c in candidates:
            c.pop("embedding", None)
    ranked = retrieval.select(body.goal, concept_ids=body.concept_ids, facts=body.facts,
                              subject=body.subject, query_vector=vector,
                              limit=settings.GUIDANCE_PACK_SIZE, items=candidates)
    pack = retrieval.build_pack(ranked, mode="preview")
    return {"items": ranked, "views": pack["views"],
            "rendered": {view: retrieval.render(pack, view, limit=settings.GUIDANCE_VIEW_SIZE)
                         for view in pack["views"]},
            "embedding_used": vector is not None}


@router.get("/knowledge/feedback")
async def feedback():
    """Guidance by how builds that used it ended: used, accepted, rolled back."""
    items = [i for i in store.list_items(kind="guidance") if i["stats"]["used"]]
    items.sort(key=lambda i: (-i["stats"]["rolled_back_builds"], -i["stats"]["used"]))
    return {"items": [{k: i[k] for k in ("id", "title", "strength", "status", "stats", "rationale")}
                      for i in items], "rollback_threshold": store.UNHELPFUL_ROLLBACKS}


@router.post("/knowledge/embed")
async def embed_missing(client=Depends(get_mistral_client)):
    from app.knowledge import embed

    return {"embedded": await embed.embed_missing(client)}


# ── Recommendation import ──────────────────────────────────────────────────


@router.post("/processes/recommendations/import")
async def import_recommendations(
    file: Optional[UploadFile] = File(None),
    content: Optional[str] = Form(None),
    domain_id: Optional[str] = Form(None),
    save: bool = Form(True),
):
    from app.process import recommendations

    if file is None and not content:
        raise HTTPException(status_code=400, detail="Send a file or the JSON content.")
    raw: Any = await file.read() if file is not None else content
    try:
        report = recommendations.import_recommendations(
            raw, domain_id=domain_id or None, filename=(file.filename if file else "recommendations.json"),
            save=save)
    except recommendations.ImportError_ as e:
        raise _bad(e)
    for entry in report["imported"] + report["needs_domain"]:
        if save:
            entry.pop("document", None)
    return report


@router.post("/processes/recommendations/missing")
async def missing_attributes(document: dict):
    from app.process import recommendations

    return {"missing": recommendations.missing_attributes(document),
            "required": [{"path": p, "why": w} for p, w in recommendations.REQUIRED_FOR_MAPPING]}

