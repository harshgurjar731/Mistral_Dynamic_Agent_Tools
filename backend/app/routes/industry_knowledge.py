"""
Industry knowledge routes — the Industry knowledge page.

    GET    /industry-knowledge/config                 what the page needs from Settings
    GET    /industry-knowledge/tree                   industry › domain › subdomain, with counts
    GET    /industry-knowledge/items                  list (?concept_id= &inherit= &below= &status= &category= &q=)
    POST   /industry-knowledge/items                  create one, filed on a domain-tree node
    PUT    /industry-knowledge/items/{id}             edit
    DELETE /industry-knowledge/items/{id}
    POST   /industry-knowledge/items/status           approve / retire many {ids, status}
    GET    /industry-knowledge/items/{id}/usage       the builds that used it
    GET    /industry-knowledge/sources                industry documents and packs
    POST   /industry-knowledge/sources                upload a document, URL, text or pack under a node
    POST   /industry-knowledge/sources/{id}/distill   read it again (replaces its proposed items)
    DELETE /industry-knowledge/sources/{id}           with its items (?items=false keeps them)
    POST   /industry-knowledge/preview                exactly what planning and code generation would get
    GET    /industry-knowledge/template               the structured pack (?format=json|yaml|csv)
"""

from __future__ import annotations

import json
import logging
from typing import Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile
from fastapi.responses import Response
from pydantic import BaseModel, Field

from app.config import settings
from app.dependencies import get_mistral_client
from app.knowledge import industry, store

logger = logging.getLogger(__name__)

router = APIRouter(tags=["Industry knowledge"])

#: What the upload dialog says can be uploaded.
WHAT_TO_UPLOAD = {
    "accepted": [
        {"kind": "Regulations and regulatory guidance",
         "examples": "A law, a regulator's rulebook chapter, a summary of obligations (KYC/AML, GDPR, HIPAA, MCOB)."},
        {"kind": "Industry standards and data formats",
         "examples": "ISO 20022 messages, ICD-10 or HL7 code lists, IBAN rules, GS1 identifiers."},
        {"kind": "Policy and credit manuals",
         "examples": "Underwriting rules, limits and thresholds, eligibility criteria, referral rules."},
        {"kind": "KPI and metric handbooks",
         "examples": "Definitions and formulas: LTV, DTI, OEE, claims ratio, churn."},
        {"kind": "Risk registers and typologies",
         "examples": "Fraud patterns, failure modes, known hazards and their mitigations."},
        {"kind": "Glossaries and industry primers",
         "examples": "Terms and what they mean in this industry."},
    ],
    "elsewhere": [
        {"kind": "Your organisation's own process (steps, roles, controls)", "page": "/processes"},
        {"kind": "Advice on how to build agents and workflows", "page": "/knowledge"},
        {"kind": "Data records, transactions or customer files", "page": None},
    ],
    "formats": ["PDF", "Word (.docx)", "PowerPoint (.pptx)", "Scans and images", "Text and Markdown",
                "HTML", "A web page URL", "Structured pack (.json, .yaml, .csv)"],
}


class ItemBody(BaseModel):
    concept_id: str
    category: str = "definition"
    title: str
    body: str
    strength: Optional[str] = None
    jurisdiction: Optional[str] = "global"
    as_of: Optional[str] = None
    tags: list[str] = Field(default_factory=list)
    status: str = "active"
    rationale: str = ""


class ItemPatch(BaseModel):
    concept_id: Optional[str] = None
    category: Optional[str] = None
    title: Optional[str] = None
    body: Optional[str] = None
    strength: Optional[str] = None
    jurisdiction: Optional[str] = None
    as_of: Optional[str] = None
    tags: Optional[list[str]] = None
    status: Optional[str] = None
    rationale: Optional[str] = None


class StatusBody(BaseModel):
    ids: list[int]
    status: str


class PreviewBody(BaseModel):
    goal: str
    #: The nodes to scope to; empty: matched from the goal, as planning does.
    concept_ids: list[str] = Field(default_factory=list)
    include_proposed: bool = False
    #: A tool or activity's purpose, to see what its code would be given.
    code_purpose: str = ""


def _bad(e: Exception) -> HTTPException:
    return HTTPException(status_code=400, detail=str(e))


def _reference(item_id: int) -> dict:
    item = store.get_item(item_id)
    if not item or item["kind"] != "reference":
        raise HTTPException(status_code=404, detail=f"Industry knowledge item {item_id} not found.")
    return item


def _decorate(items: list[dict], relation: Optional[dict] = None) -> list[dict]:
    cache: dict[str, str] = {}
    return [{**i, "path": industry.path_label(i.get("concept_id"), cache),
             "level": industry.level_name(i.get("concept_id")),
             **({"relation": relation.get(i.get("concept_id") or "")} if relation is not None else {})}
            for i in items]


# ── Config and tree ────────────────────────────────────────────────────────


@router.get("/industry-knowledge/config")
async def config():
    """The Settings values the page shows and acts on (edited on the Settings page)."""
    return {
        "mode": settings.INDUSTRY_KNOWLEDGE_MODE,
        "pack_size": settings.INDUSTRY_PACK_SIZE,
        "view_size": settings.INDUSTRY_VIEW_SIZE,
        "include_narrower": settings.INDUSTRY_INCLUDE_NARROWER,
        "jurisdictions": [j.strip() for j in (settings.INDUSTRY_JURISDICTIONS or "").split(",") if j.strip()],
        "in_codegen": settings.INDUSTRY_IN_CODEGEN,
        "code_items": settings.INDUSTRY_CODE_ITEMS,
        "auto_approve": settings.INDUSTRY_AUTO_APPROVE,
        "source_max_mb": settings.INDUSTRY_SOURCE_MAX_MB,
        "max_excerpts": settings.INDUSTRY_MAX_EXCERPTS,
        "categories": [{"id": c, "label": industry.CATEGORY_LABEL[c], "views": list(industry.CATEGORY_VIEWS[c])}
                       for c in store.INDUSTRY_CATEGORIES],
        "forces": [{"id": k, "label": v} for k, v in industry.FORCE_LABEL.items()],
        "statuses": list(store.STATUSES),
        "what_to_upload": WHAT_TO_UPLOAD,
    }


@router.get("/industry-knowledge/tree")
async def tree():
    """Every industry, domain and subdomain, with the items filed on each."""
    from app.catalog import store as catalog_store
    from app.catalog.vocab import SYSTEM_DOMAIN, Scheme

    concepts = [c for c in catalog_store.list_concepts(Scheme.DOMAIN.value)
                if c["id"] != SYSTEM_DOMAIN and not c["id"].startswith(SYSTEM_DOMAIN + ".")]
    counts = store.industry_counts_by_concept()
    by_parent: dict[Optional[str], list[str]] = {}
    for c in concepts:
        by_parent.setdefault(c.get("parent_id"), []).append(c["id"])

    def depth(cid: str, guard: int = 0) -> int:
        parent = next((c.get("parent_id") for c in concepts if c["id"] == cid), None)
        return 1 if not parent or guard > 8 else 1 + depth(parent, guard + 1)

    def below(cid: str) -> int:
        return sum(counts.get(k, {}).get("active", 0) + below(k) for k in by_parent.get(cid, []))

    nodes = []
    for c in concepts:
        own = counts.get(c["id"], {})
        nodes.append({
            "id": c["id"], "label": c.get("label") or c["id"], "parent_id": c.get("parent_id"),
            "definition": c.get("definition") or "",
            "level": {1: "industry", 2: "domain"}.get(depth(c["id"]), "subdomain"),
            "counts": {"active": own.get("active", 0), "proposed": own.get("proposed", 0),
                       "conflicting": own.get("conflicting", 0), "retired": own.get("retired", 0),
                       "below": below(c["id"])},
        })
    nodes.sort(key=lambda n: n["label"].lower())
    totals = {status: sum(v.get(status, 0) for v in counts.values()) for status in store.STATUSES}
    return {"nodes": nodes, "totals": totals, "sources": len(store.list_sources("industry"))}


# ── Items ──────────────────────────────────────────────────────────────────


@router.get("/industry-knowledge/items")
async def list_items(concept_id: Optional[str] = None, inherit: bool = True, below: bool = False,
                     status: Optional[str] = None, category: Optional[str] = None,
                     source_id: Optional[int] = None, q: str = "", limit: int = Query(2000, le=10000)):
    """Items on a node — with what it inherits from above (``inherit``) and what is filed below (``below``)."""
    from app.catalog import store as catalog_store

    relation: Optional[dict[str, str]] = None
    if concept_id:
        relation = {concept_id: industry.EXACT}
        if inherit:
            for a in catalog_store.tree_ancestors(concept_id):
                relation[a] = industry.INHERITED
        if below:
            for d in catalog_store.descendants(concept_id, include_self=False):
                relation[d] = industry.NARROWER
    items = store.list_items(kind="reference", status=status, category=category, source_id=source_id,
                             limit=limit)
    if relation is not None:
        items = [i for i in items if (i.get("concept_id") or "") in relation]
    text = q.strip().lower()
    if text:
        items = [i for i in items if text in i["title"].lower() or text in i["body"].lower()
                 or any(text in t.lower() for t in i.get("tags") or [])]
    return {"items": _decorate(items, relation), "count": len(items)}


@router.post("/industry-knowledge/items")
async def create_item(body: ItemBody, client=Depends(get_mistral_client)):
    try:
        industry.check_node(body.concept_id)
        item = store.create_item({**body.model_dump(), "kind": "reference", "origin": "user"})
    except (store.KnowledgeError, industry.NodeError) as e:
        raise _bad(e)
    from app.knowledge import embed

    await embed.embed_missing(client, [item["id"]])
    return _decorate([store.get_item(item["id"]) or item])[0]


@router.put("/industry-knowledge/items/{item_id}")
async def update_item(item_id: int, body: ItemPatch, client=Depends(get_mistral_client)):
    _reference(item_id)
    patch = {k: v for k, v in body.model_dump().items() if v is not None}
    try:
        if "concept_id" in patch:
            industry.check_node(patch["concept_id"])
        item = store.update_item(item_id, {**patch, "kind": "reference"})
    except (store.KnowledgeError, industry.NodeError) as e:
        raise _bad(e)
    if not item.get("has_embedding"):
        from app.knowledge import embed

        await embed.embed_missing(client, [item_id])
    return _decorate([store.get_item(item_id) or item])[0]


@router.delete("/industry-knowledge/items/{item_id}")
async def delete_item(item_id: int):
    _reference(item_id)
    return {"deleted": int(store.delete_item(item_id))}


@router.post("/industry-knowledge/items/status")
async def set_status(body: StatusBody):
    ids = [i["id"] for i in store.list_items(kind="reference", ids=body.ids)]
    try:
        return {"updated": store.set_status(ids, body.status)}
    except store.KnowledgeError as e:
        raise _bad(e)


@router.get("/industry-knowledge/items/{item_id}/usage")
async def item_usage(item_id: int):
    from app.knowledge.industry_pipeline import SOURCE_TYPE
    from app.process import store as process_store

    item = _reference(item_id)
    rows = [r for r in process_store.usage(source_type=SOURCE_TYPE, limit=5000)
            if r.get("document_id") == item_id]
    return {"item": _decorate([item])[0], "usage": rows, "count": len(rows)}


# ── Sources ────────────────────────────────────────────────────────────────


@router.get("/industry-knowledge/sources")
async def list_sources():
    sources = store.list_sources("industry")
    cache: dict[str, str] = {}
    return {"sources": [{**s, "path": industry.path_label(s.get("concept_id"), cache)} for s in sources]}


@router.post("/industry-knowledge/sources")
async def add_source(
    concept_id: str = Form(...),
    file: Optional[UploadFile] = File(None),
    url: str = Form(""),
    text: str = Form(""),
    title: str = Form(""),
    jurisdiction: str = Form("global"),
    auto_approve: Optional[bool] = Form(None),
    client=Depends(get_mistral_client),
):
    from app.knowledge import industry_ingest

    data = None
    filename, content_type = "", ""
    if file is not None:
        data = await file.read()
        if len(data) > settings.INDUSTRY_SOURCE_MAX_MB * 1024 * 1024:
            raise HTTPException(status_code=413,
                                detail=f"Files are limited to {settings.INDUSTRY_SOURCE_MAX_MB} MB "
                                       "(Settings → Industry knowledge).")
        filename, content_type = file.filename or "upload", file.content_type or ""
    try:
        return await industry_ingest.add_source(
            client, concept_id=concept_id, data=data, filename=filename, content_type=content_type,
            url=url.strip(), text=text, title=title.strip(), jurisdiction=jurisdiction or "global",
            auto_approve=auto_approve)
    except (store.KnowledgeError, industry.NodeError) as e:
        raise _bad(e)


@router.post("/industry-knowledge/sources/{source_id}/distill")
async def redistill(source_id: int, jurisdiction: str = "global", client=Depends(get_mistral_client)):
    from app.knowledge import industry_ingest

    try:
        return await industry_ingest.distil_source(client, source_id, jurisdiction=jurisdiction)
    except (store.KnowledgeError, industry.NodeError) as e:
        raise _bad(e)


@router.delete("/industry-knowledge/sources/{source_id}")
async def delete_source(source_id: int, items: bool = True):
    source = store.get_source(source_id)
    if not source or source.get("purpose") != "industry":
        raise HTTPException(status_code=404, detail=f"Industry source {source_id} not found.")
    try:
        return store.delete_source(source_id, items=items)
    except store.KnowledgeError as e:
        raise _bad(e)


# ── Preview and template ───────────────────────────────────────────────────


@router.post("/industry-knowledge/preview")
async def preview(body: PreviewBody, client=Depends(get_mistral_client)):
    """Exactly what a plan with this goal would be given — per decision, and for code."""
    from app.catalog import match
    from app.knowledge import embed

    scope_source = "given"
    concept_ids = [c for c in body.concept_ids if c]
    if not concept_ids:
        concept_ids = list(match.scope_for_goal(body.goal).get("domains") or [])
        scope_source = "matched from the goal"
    domains = industry.run_domains(concept_ids)
    statuses = ("active", "proposed") if body.include_proposed else ("active",)
    candidates = store.list_items(kind="reference", statuses=statuses, embedding=True)
    vector = await embed.embed_query(client, body.goal) if any(c.get("embedding") for c in candidates) else None
    if vector is None:
        for c in candidates:
            c.pop("embedding", None)
    ranked = industry.select(body.goal, concept_ids=domains, items=candidates, query_vector=vector)
    pack = industry.build_pack(ranked, domains=domains, mode="preview")
    code = industry.code_items(pack, body.code_purpose or body.goal)
    return {
        "domains": pack["domains"], "scope_source": scope_source,
        "items": pack["items"], "views": pack["views"],
        "rendered": {view: industry.render(pack, view, refs=False) for view in sorted(pack["views"])},
        "code_items": code, "code_rendered": industry.render_for_code(code, refs=False),
        "embedding_used": vector is not None, "mode": settings.INDUSTRY_KNOWLEDGE_MODE,
    }


@router.get("/industry-knowledge/template")
async def template(format: str = Query("json", pattern="^(json|yaml|csv)$")):
    from app.knowledge import industry_ingest

    if format == "csv":
        return Response(industry_ingest.pack_template_csv(), media_type="text/csv",
                        headers={"Content-Disposition": "attachment; filename=industry-knowledge-pack.csv"})
    data = industry_ingest.pack_template()
    if format == "yaml":
        import yaml

        return Response(yaml.safe_dump(data, sort_keys=False, allow_unicode=True), media_type="application/x-yaml",
                        headers={"Content-Disposition": "attachment; filename=industry-knowledge-pack.yaml"})
    return Response(json.dumps(data, indent=2), media_type="application/json",
                    headers={"Content-Disposition": "attachment; filename=industry-knowledge-pack.json"})
