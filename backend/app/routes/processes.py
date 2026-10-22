"""
Process knowledge routes — the Processes page, the Settings template section and
the orchestration pages' upload/picker all go through these.

    GET    /processes/config                       toggle default and limits
    GET    /processes/industries                   industry cards with counts
    GET    /processes/tree                         industry › … › subprocess, with documents
    POST   /processes/concepts                     create at any level
    GET    /processes/concepts/{id}                one node: path, children, documents, usage
    PATCH  /processes/concepts/{id}                rename / redefine / re-link
    DELETE /processes/concepts/{id}                delete (refused while in use, unless cascade)
    POST   /processes/concepts/{id}/documents      upload a JSON file under a process
    POST   /processes/concepts/{id}/documents/json store parsed content (accepting an AI fix)
    POST   /processes/documents                    upload without filing (orchestration pages)
    POST   /processes/documents/json               same, from content
    POST   /processes/validate                     check a file without saving it
    POST   /processes/classify                     where an upload belongs, and its template
    GET    /processes/documents                    list (?concept_id= | ?unfiled=true)
    GET    /processes/documents/{id}               one, with content and report
    GET    /processes/documents/{id}/download      the stored JSON as a file
    PUT    /processes/documents/{id}               re-upload in place (a file)
    POST   /processes/documents/{id}/activate      make this version the active one
    POST   /processes/documents/{id}/file          file an unfiled upload under a process
    DELETE /processes/documents/{id}               delete (refused while used, unless force)
    POST   /processes/fix                          AI fix of an upload or a stored document
    POST   /processes/draft                        AI draft from prose
    GET    /processes/templates                    versions at a scope (?concept_id= | ?all=true)
    GET    /processes/templates/scopes             every node with a template of its own
    GET    /processes/templates/for/{id|global}    the template that applies at a node
    GET    /processes/templates/for/{id}/download  ?kind=blank|example|schema
    POST   /processes/templates/scope/{id}/clear   stop overriding: inherit again
    GET    /processes/templates/{id|default}       one template with its schema
    GET    /processes/templates/{id|default}/download   ?kind=blank|example|schema
    POST   /processes/templates/preview            read an upload: schema or inferred from example
    POST   /processes/templates                    save a version at a scope (concept_id)
    POST   /processes/templates/{id}/default       make active at its scope; re-check documents
    DELETE /processes/templates/{id}

Templates are scoped: a document is checked against the nearest active
template above it — subprocess › process › subdomain › domain › industry ›
global. An unfiled upload is classified first (``process_knowledge.classifier``).
    GET    /processes/usage                        where documents were used
    GET    /processes/resolve?goal=                which process a goal would use
"""

from __future__ import annotations

import asyncio
import json
import logging
import re
from typing import Any, Optional

from fastapi import APIRouter, File, Form, HTTPException, Query, UploadFile
from fastapi.responses import Response
from pydantic import BaseModel, Field

from app.config import settings
from app.ontology import store as ontology_store
from app.ontology.store import VocabularyError
from app.ontology.vocab import SYSTEM_DOMAIN, Scheme
from app.process_knowledge import resolver, store, templates, validation

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/processes", tags=["Process knowledge"])

LEVELS = ("industry", "domain", "subdomain", "process", "subprocess")


def _guard(fn, *args, **kwargs):
    try:
        return fn(*args, **kwargs)
    except VocabularyError as e:
        raise HTTPException(status_code=409, detail=str(e))
    except LookupError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except PermissionError as e:
        raise HTTPException(status_code=409, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    except RuntimeError as e:
        raise HTTPException(status_code=503, detail=str(e))


async def _read(file: UploadFile) -> bytes:
    """Read an upload, refusing early rather than buffering a huge file."""
    # One byte over the limit is enough for the validator to report "too large".
    return await file.read(int(settings.PROCESS_DOC_MAX_KB) * 1024 + 1)


def _slug(text: str) -> str:
    cleaned = re.sub(r"[^a-z0-9]+", "_", (text or "").lower()).strip("_")
    return cleaned[:48] or "item"


def _unique_id(base: str) -> str:
    candidate, n = base, 2
    while ontology_store.get_concept(candidate):
        candidate = f"{base}_{n}"
        n += 1
    return candidate


def _level_of(concept: dict) -> str:
    return concept.get("level_name") or "concept"


# ── Config ─────────────────────────────────────────────────────────────────


@router.get("/config")
async def config():
    tpl = templates.default_template()
    return {
        "default_enabled": bool(settings.PROCESS_KNOWLEDGE_DEFAULT),
        "max_kb": int(settings.PROCESS_DOC_MAX_KB),
        "min_score": float(settings.PROCESS_MATCH_MIN_SCORE),
        "template": {"id": tpl.get("id"), "name": tpl.get("name"), "version": tpl.get("version")},
        "levels": list(LEVELS),
    }


# ── Tree ───────────────────────────────────────────────────────────────────


def _tree() -> dict:
    domains = [c for c in ontology_store.list_concepts(Scheme.DOMAIN.value)
               if c["id"] != SYSTEM_DOMAIN and not c["id"].startswith(SYSTEM_DOMAIN + ".")]
    processes = ontology_store.list_concepts(Scheme.PROCESS.value)
    links = {l["source"]: l["target"]
             for l in ontology_store.all_links("part_of_domain")}
    docs = store.documents_by_concept_counts()
    usage = store.usage_summary()
    for p in processes:
        p["domain_id"] = links.get(p["id"])
        p["documents"] = docs.get(p["id"]) or {"total": 0, "valid": 0, "invalid": 0, "stale": 0,
                                               "active_id": None, "active_version": None}
        p["usage"] = usage.get(p["id"]) or {"agents": 0, "workflows": 0, "last_used": None}
    return {"domains": domains, "processes": processes}


@router.get("/tree")
async def tree():
    return await asyncio.to_thread(_tree)


def _industries() -> list[dict]:
    data = _tree()
    domains, processes = data["domains"], data["processes"]
    by_parent: dict[str, list[dict]] = {}
    for d in domains:
        by_parent.setdefault(d.get("parent_id") or "", []).append(d)
    proc_by_parent: dict[str, list[dict]] = {}
    for p in processes:
        proc_by_parent.setdefault(p.get("parent_id") or "", []).append(p)

    def subtree(cid: str) -> list[dict]:
        out = []
        for child in by_parent.get(cid, []):
            out.append(child)
            out += subtree(child["id"])
        return out

    def proc_subtree(pid: str) -> list[dict]:
        out = []
        for child in proc_by_parent.get(pid, []):
            out.append(child)
            out += proc_subtree(child["id"])
        return out

    cards = []
    for root in by_parent.get("", []):
        under = [root, *subtree(root["id"])]
        ids = {c["id"] for c in under}
        roots = [p for p in processes if p.get("domain_id") in ids and not p.get("parent_id")]
        all_procs = roots + [s for r in roots for s in proc_subtree(r["id"])]
        last = [p["usage"]["last_used"] for p in all_procs if p["usage"]["last_used"]]
        cards.append({
            **root,
            "counts": {
                "domains": sum(1 for c in under if c.get("level_name") == "domain"),
                "subdomains": sum(1 for c in under if c.get("level_name") == "subdomain"),
                "processes": sum(1 for p in all_procs if p.get("level_name") == "process"),
                "subprocesses": sum(1 for p in all_procs if p.get("level_name") == "subprocess"),
                "documents": sum(p["documents"]["total"] for p in all_procs),
                "valid_documents": sum(1 for p in all_procs if p["documents"]["active_id"]),
                "needs_attention": sum(p["documents"].get("invalid", 0) + p["documents"].get("stale", 0)
                                       for p in all_procs),
                "agents": sum(p["usage"]["agents"] for p in all_procs),
                "workflows": sum(p["usage"]["workflows"] for p in all_procs),
            },
            "last_used": max(last) if last else None,
        })
    cards.sort(key=lambda c: c["label"].lower())
    return cards


@router.get("/industries")
async def industries():
    return {"industries": await asyncio.to_thread(_industries)}


# ── Concepts ───────────────────────────────────────────────────────────────


class NodeCreate(BaseModel):
    level: str = Field(..., description="industry | domain | subdomain | process | subprocess")
    label: str = Field(..., min_length=1, max_length=120)
    #: domain/subdomain: the parent domain concept. process: the domain or
    #: subdomain it belongs to. subprocess: the parent process.
    parent_id: Optional[str] = None
    definition: str = ""
    synonyms: list[str] = Field(default_factory=list)
    #: Use an existing id rather than generating one (adopting a concept).
    id: Optional[str] = None


class NodeUpdate(BaseModel):
    label: Optional[str] = None
    definition: Optional[str] = None
    synonyms: Optional[list[str]] = None
    #: process only: move it to another domain or subdomain.
    domain_id: Optional[str] = None


def _create(body: NodeCreate) -> dict:
    level = body.level.strip().lower()
    if level not in LEVELS:
        raise ValueError(f"level must be one of {', '.join(LEVELS)}")
    parent = ontology_store.get_concept(body.parent_id) if body.parent_id else None
    slug = _slug(body.label)

    if level == "industry":
        concept_id = body.id or _unique_id(f"domain.{slug}")
        created = ontology_store.create_concept(concept_id, Scheme.DOMAIN.value, body.label, None,
                                                body.definition, body.synonyms)
    elif level in ("domain", "subdomain"):
        want_parent = "industry" if level == "domain" else "domain"
        if not parent or parent["scheme_id"] != Scheme.DOMAIN.value or _level_of(parent) != want_parent:
            raise ValueError(f"A {level} needs a parent {want_parent}.")
        concept_id = body.id or _unique_id(f"{parent['id']}.{slug}")
        created = ontology_store.create_concept(concept_id, Scheme.DOMAIN.value, body.label,
                                                parent["id"], body.definition, body.synonyms)
    elif level == "process":
        if not parent or parent["scheme_id"] != Scheme.DOMAIN.value:
            raise ValueError("A process needs the domain or subdomain it belongs to.")
        if _level_of(parent) == "industry":
            raise ValueError("File a process under a domain or subdomain, not directly under an industry.")
        stem = parent["id"].removeprefix("domain.")
        concept_id = body.id or _unique_id(f"process.{stem}.{slug}")
        created = ontology_store.create_concept(concept_id, Scheme.PROCESS.value, body.label, None,
                                                body.definition, body.synonyms)
        try:
            ontology_store.link_concepts(concept_id, parent["id"])
        except Exception:
            ontology_store.delete_concept(concept_id)
            raise
    else:  # subprocess
        if not parent or parent["scheme_id"] != Scheme.PROCESS.value:
            raise ValueError("A subprocess needs a parent process.")
        concept_id = body.id or _unique_id(f"{parent['id']}.{slug}")
        created = ontology_store.create_concept(concept_id, Scheme.PROCESS.value, body.label,
                                                parent["id"], body.definition, body.synonyms)
    return created


@router.post("/concepts", status_code=201)
async def create_node(body: NodeCreate):
    return _guard(_create, body)


def _node(concept_id: str) -> dict:
    concept = ontology_store.get_concept(concept_id)
    if not concept:
        raise LookupError(f"'{concept_id}' not found.")
    children = [c for c in ontology_store.list_concepts(concept["scheme_id"])
                if c.get("parent_id") == concept_id]
    out = {**concept, "children": children,
           "path": resolver.breadcrumb(concept_id) if concept["scheme_id"] == Scheme.PROCESS.value
           else " › ".join(
               (ontology_store.get_concept(c) or {}).get("label", c)
               for c in reversed([concept_id, *ontology_store._ancestor_chain(concept_id)]))}
    if concept["scheme_id"] == Scheme.PROCESS.value:
        out["domain_id"] = ontology_store.domain_of(concept_id)
        out["documents"] = store.list_documents(concept_id)
        out["usage"] = store.usage(concept_ids=[concept_id], limit=200)
    else:
        out["processes"] = sorted(ontology_store.processes_under([concept_id], include_ancestors=False))
    out["usage_counts"] = ontology_store.concept_usage(concept_id)
    # The template documents here are checked against, and where it is set.
    out["template"] = _template_summary(templates.template_for(concept_id))
    return out


@router.get("/concepts/{concept_id}")
async def get_node(concept_id: str):
    return await asyncio.to_thread(_guard, _node, concept_id)


def _update(concept_id: str, body: NodeUpdate) -> dict:
    concept = ontology_store.get_concept(concept_id)
    if not concept:
        raise LookupError(f"'{concept_id}' not found.")
    updated = ontology_store.update_concept(concept_id, body.label, None, body.definition,
                                            body.synonyms)
    if body.domain_id:
        if concept["scheme_id"] != Scheme.PROCESS.value or concept.get("parent_id"):
            raise ValueError("Only a top-level process can be moved to another domain.")
        ontology_store.unlink_concepts(concept_id)
        ontology_store.link_concepts(concept_id, body.domain_id)
    return updated


@router.patch("/concepts/{concept_id}")
async def update_node(concept_id: str, body: NodeUpdate):
    return _guard(_update, concept_id, body)


@router.delete("/concepts/{concept_id}")
async def delete_node(concept_id: str, cascade: bool = Query(False)):
    from app.services import delete_rules

    result = _guard(ontology_store.delete_concept, concept_id, cascade)
    result["neo4j"] = delete_rules.forget_concepts_in_neo4j(result.get("concept_ids", []))
    return result


# ── Documents ──────────────────────────────────────────────────────────────


class DocumentJson(BaseModel):
    content: Any
    filename: str = ""
    source: str = "upload"
    replace_id: Optional[int] = None
    template_id: Optional[int] = None


def _process_concept(concept_id: str) -> dict:
    concept = ontology_store.get_concept(concept_id)
    if not concept or concept["scheme_id"] != Scheme.PROCESS.value:
        raise LookupError(f"'{concept_id}' is not a process or subprocess.")
    return concept


def _content_arg(content: Any) -> Any:
    """Parsed content as-is; a string is validated as file text."""
    return content if isinstance(content, (dict, str)) else json.dumps(content)


_SOURCES = {"upload", "ai_fixed", "ai_drafted", "orchestration"}


@router.post("/concepts/{concept_id}/documents", status_code=201)
async def upload_document(concept_id: str, file: UploadFile = File(...),
                          template_id: Optional[int] = Form(None),
                          replace_id: Optional[int] = Form(None)):
    _guard(_process_concept, concept_id)
    data = await _read(file)
    return await asyncio.to_thread(
        _guard, store.save_document, data, concept_id=concept_id,
        filename=file.filename or "", source="upload", template_id=template_id,
        replace_id=replace_id)


@router.post("/concepts/{concept_id}/documents/json", status_code=201)
async def save_document_json(concept_id: str, body: DocumentJson):
    _guard(_process_concept, concept_id)
    return await asyncio.to_thread(
        _guard, store.save_document, _content_arg(body.content), concept_id=concept_id,
        filename=body.filename, source=body.source if body.source in _SOURCES else "upload",
        template_id=body.template_id, replace_id=body.replace_id)


def _save_unfiled(data: Any, *, filename: str, source: str, goal: str = "",
                  classify_as: Optional[str] = None, replace_id: Optional[int] = None,
                  template_id: Optional[int] = None) -> dict:
    """Store an orchestration-page upload, checked against the template of
    where it is classified — the chosen node, what the document names, or what
    the request is about (see ``classifier``)."""
    from app.process_knowledge import classifier

    classification = None
    if not template_id and not (replace_id and not classify_as and not goal):
        classification = classifier.classify(data, goal=goal, chosen=classify_as)
    return store.save_document(data, concept_id=None, filename=filename, source=source,
                               template_id=template_id, replace_id=replace_id,
                               classification=classification)


@router.post("/documents", status_code=201)
async def upload_unfiled(file: UploadFile = File(...), concept_id: Optional[str] = Form(None),
                         template_id: Optional[int] = Form(None),
                         goal: str = Form(""), classify_as: Optional[str] = Form(None)):
    """An upload from an orchestration page.

    ``concept_id`` files it under that process. Otherwise it stays unfiled and
    is checked against the template of where it is classified: ``classify_as``
    when chosen, else what the document itself names, else the request ``goal``.
    """
    data = await _read(file)
    if concept_id:
        _guard(_process_concept, concept_id)
        return await asyncio.to_thread(
            _guard, store.save_document, data, concept_id=concept_id,
            filename=file.filename or "", source="upload", template_id=template_id)
    return await asyncio.to_thread(
        _guard, _save_unfiled, data, filename=file.filename or "", source="orchestration",
        goal=goal, classify_as=classify_as or None, template_id=template_id)


class UnfiledJson(DocumentJson):
    goal: str = ""
    classify_as: Optional[str] = None


@router.post("/documents/json", status_code=201)
async def save_unfiled_json(body: UnfiledJson, concept_id: Optional[str] = Query(None)):
    if concept_id:
        _guard(_process_concept, concept_id)
        return await asyncio.to_thread(
            _guard, store.save_document, _content_arg(body.content), concept_id=concept_id,
            filename=body.filename, source=body.source if body.source in _SOURCES else "upload",
            template_id=body.template_id, replace_id=body.replace_id)
    return await asyncio.to_thread(
        _guard, _save_unfiled, _content_arg(body.content), filename=body.filename,
        source=body.source if body.source in _SOURCES else "orchestration", goal=body.goal,
        classify_as=body.classify_as, replace_id=body.replace_id, template_id=body.template_id)


@router.post("/validate")
async def validate_upload(file: UploadFile = File(...), concept_id: Optional[str] = Form(None),
                          template_id: Optional[int] = Form(None), goal: str = Form(""),
                          classify_as: Optional[str] = Form(None)):
    """Check a file without storing it — against its process's template, or
    for an unfiled one, that of where it is classified."""
    from app.process_knowledge import classifier

    data = await _read(file)
    classification = None
    if template_id:
        template = templates.get_template(template_id)
    elif concept_id:
        template = templates.template_for(concept_id)
    else:
        classification = await asyncio.to_thread(
            classifier.classify, data, goal=goal, chosen=classify_as)
        template = templates.template_for(classification.get("concept_id"))
    if not template:
        raise HTTPException(status_code=404, detail="Template not found.")
    return await asyncio.to_thread(validation.validate, data, template, concept_id=concept_id,
                                   classification=classification)


@router.post("/classify")
async def classify_upload(file: UploadFile = File(...), goal: str = Form(""),
                          classify_as: Optional[str] = Form(None)):
    """Where an upload would be classified, and the template that would check it."""
    from app.process_knowledge import classifier

    data = await _read(file)
    classification = await asyncio.to_thread(classifier.classify, data, goal=goal,
                                             chosen=classify_as)
    template = templates.template_for(classification.get("concept_id"))
    return {"classification": classification, "template": _template_summary(template)}


@router.get("/documents")
async def list_documents(concept_id: Optional[str] = None, unfiled: bool = False):
    docs = await asyncio.to_thread(store.list_documents, concept_id, unfiled=unfiled)
    return {"documents": docs}


@router.get("/documents/{document_id}")
async def get_document(document_id: int):
    doc = await asyncio.to_thread(store.get_document, document_id)
    if not doc:
        raise HTTPException(status_code=404, detail=f"Document {document_id} not found.")
    doc["path"] = resolver.breadcrumb(doc.get("concept_id")) if doc.get("concept_id") else "Unfiled upload"
    return doc


@router.get("/documents/{document_id}/download")
async def download_document(document_id: int):
    doc = await asyncio.to_thread(store.get_document, document_id)
    if not doc:
        raise HTTPException(status_code=404, detail=f"Document {document_id} not found.")
    body = json.dumps(doc["content"], indent=2) if doc.get("content") is not None else doc["raw"]
    name = f"{_slug(doc['title'])}_v{doc['version']}.json"
    return Response(content=body, media_type="application/json",
                    headers={"Content-Disposition": f'attachment; filename="{name}"'})


@router.put("/documents/{document_id}")
async def reupload_document(document_id: int, file: UploadFile = File(...)):
    existing = await asyncio.to_thread(store.get_document, document_id, content=False)
    if not existing:
        raise HTTPException(status_code=404, detail=f"Document {document_id} not found.")
    data = await _read(file)
    # A valid document is never overwritten: its re-upload is a new version.
    replace = document_id if existing["status"] != "valid" else None
    # An unfiled one keeps where it was classified, and so its template.
    classification = None if existing["concept_id"] else store._stored_classification(document_id)
    return await asyncio.to_thread(
        _guard, store.save_document, data, concept_id=existing["concept_id"],
        filename=file.filename or "", source=existing["source"], replace_id=replace,
        classification=classification)


@router.post("/documents/{document_id}/activate")
async def activate_document(document_id: int):
    return _guard(store.activate, document_id)


class FileRequest(BaseModel):
    concept_id: str


@router.post("/documents/{document_id}/file")
async def file_document(document_id: int, body: FileRequest):
    _guard(_process_concept, body.concept_id)
    return await asyncio.to_thread(_guard, store.file_document, document_id, body.concept_id)


@router.delete("/documents/{document_id}")
async def delete_document(document_id: int, force: bool = Query(False)):
    return _guard(store.delete_document, document_id, force=force)


# ── AI ─────────────────────────────────────────────────────────────────────


class FixRequest(BaseModel):
    #: A stored document to fix, or raw text / parsed content of an upload.
    document_id: Optional[int] = None
    raw: Optional[Any] = None
    concept_id: Optional[str] = None
    template_id: Optional[int] = None
    #: For an unfiled upload: where to classify it (see /documents).
    goal: str = ""
    classify_as: Optional[str] = None


class DraftRequest(BaseModel):
    text: str = Field(..., min_length=20, max_length=60_000)
    #: The process it will be filed under (also checks it describes it).
    concept_id: Optional[str] = None
    template_id: Optional[int] = None
    #: For an unfiled draft: the node whose template it should follow.
    classify_as: Optional[str] = None


def _template_or_404(template_id: Optional[int], scope: Optional[str] = None) -> dict:
    """A specific template, or the one that applies at ``scope``."""
    template = templates.get_template(template_id) if template_id else templates.template_for(scope)
    if not template:
        raise HTTPException(status_code=404, detail="Template not found.")
    return template


@router.post("/fix")
async def fix_document(body: FixRequest):
    from app.dependencies import get_mistral_client
    from app.process_knowledge import ai

    from app.process_knowledge import classifier

    raw, concept_id, scope = body.raw, body.concept_id, None
    if body.document_id:
        doc = await asyncio.to_thread(store.get_document, body.document_id)
        if not doc:
            raise HTTPException(status_code=404, detail=f"Document {body.document_id} not found.")
        raw = doc["raw"] or (json.dumps(doc["content"]) if doc.get("content") is not None else "")
        concept_id = concept_id or doc.get("concept_id")
        # An unfiled upload is fixed towards the template it was checked against.
        scope = ((doc.get("report") or {}).get("classification") or {}).get("concept_id")
    if raw in (None, ""):
        raise HTTPException(status_code=422, detail="Nothing to fix — give document_id or raw.")
    if not concept_id and not scope and (body.goal or body.classify_as):
        scope = classifier.classify(raw, goal=body.goal, chosen=body.classify_as).get("concept_id")
    try:
        return await ai.fix(get_mistral_client(), raw,
                            _template_or_404(body.template_id, concept_id or scope),
                            concept_id=concept_id)
    except Exception as e:
        logger.warning("AI fix failed: %s", e, exc_info=True)
        raise HTTPException(status_code=502, detail=f"The AI fix could not be completed: {e}")


@router.post("/draft")
async def draft_document(body: DraftRequest):
    from app.dependencies import get_mistral_client
    from app.process_knowledge import ai

    try:
        return await ai.draft(get_mistral_client(), body.text,
                              _template_or_404(body.template_id,
                                               body.concept_id or body.classify_as),
                              concept_id=body.concept_id)
    except Exception as e:
        logger.warning("AI draft failed: %s", e, exc_info=True)
        raise HTTPException(status_code=502, detail=f"The AI draft could not be completed: {e}")


# ── Templates ──────────────────────────────────────────────────────────────


def _template_ref(ref: str) -> dict:
    template = templates.default_template() if ref == "default" else (
        templates.get_template(int(ref)) if ref.isdigit() else None)
    if not template:
        raise HTTPException(status_code=404, detail=f"Template '{ref}' not found.")
    return template


def _scope_arg(concept_id: str) -> Optional[str]:
    """"global" in a path means the global scope."""
    if concept_id in ("global", "default", ""):
        return None
    if not ontology_store.get_concept(concept_id):
        raise HTTPException(status_code=404, detail=f"'{concept_id}' is not in the ontology.")
    return concept_id


def _template_summary(template: dict) -> dict:
    return {k: template.get(k) for k in ("id", "name", "version", "kind", "concept_id",
                                          "scope_path", "inherited", "applies_to", "builtin")}


def _download(template: dict, kind: str) -> Response:
    payload = templates.download_payload(template, kind)
    suffix = {"blank": "template", "example": "example", "schema": "schema"}[kind]
    name = f"{_slug(template['name'])}_v{template['version']}_{suffix}.json"
    return Response(content=json.dumps(payload, indent=2), media_type="application/json",
                    headers={"Content-Disposition": f'attachment; filename="{name}"'})


@router.get("/templates")
async def list_templates(concept_id: Optional[str] = None, all: bool = False):
    """Templates set at one scope (``concept_id``; none: the global scope), or at all."""
    scope = _scope_arg(concept_id) if concept_id else None
    rows = await asyncio.to_thread(templates.list_templates, scope, every_scope=all)
    return {"templates": rows}


@router.get("/templates/scopes")
async def template_scopes():
    """Every node with an active template of its own, and how many documents
    each template now checks."""
    def _build():
        rows = templates.scopes()
        docs = store.list_documents()
        for row in rows:
            row["documents"] = sum(
                1 for d in docs
                if d.get("template_id") == row["template"]["id"])
        return rows
    return {"scopes": await asyncio.to_thread(_build)}


@router.get("/templates/for/{concept_id}")
async def get_template_for(concept_id: str):
    """The template that applies at a node, and where it is set."""
    scope = _scope_arg(concept_id)
    template = await asyncio.to_thread(templates.template_for, scope)
    own = await asyncio.to_thread(templates.list_templates, scope)
    return {**template, "applies_to_path": templates.scope_path(scope), "own_versions": own}


@router.get("/templates/for/{concept_id}/download")
async def download_template_for(concept_id: str,
                                kind: str = Query("blank", pattern="^(blank|example|schema)$")):
    return _download(templates.template_for(_scope_arg(concept_id)), kind)


@router.post("/templates/scope/{concept_id}/clear")
async def clear_template_scope(concept_id: str):
    """Stop a node overriding: its documents use the inherited template again."""
    scope = _scope_arg(concept_id)
    cleared = _guard(templates.clear_scope, scope)
    revalidated = await asyncio.to_thread(store.revalidate_all)
    return {"cleared": cleared, "revalidated": revalidated,
            "now": _template_summary(templates.template_for(scope))}


@router.get("/templates/{ref}")
async def get_template(ref: str):
    return _template_ref(ref)


@router.get("/templates/{ref}/download")
async def download_template(ref: str, kind: str = Query("blank", pattern="^(blank|example|schema)$")):
    return _download(_template_ref(ref), kind)


@router.post("/templates/preview")
async def preview_template(file: UploadFile = File(...)):
    """Read an uploaded template: use it as a schema, or infer one from an example."""
    data = await file.read(10 * 1024 * 1024)
    try:
        parsed = json.loads(data.decode("utf-8-sig"))
    except Exception as e:
        raise HTTPException(status_code=422, detail=f"The template is not valid JSON: {e}")
    if templates.looks_like_schema(parsed):
        kind, schema, example = "schema", parsed, None
    else:
        if not isinstance(parsed, dict):
            raise HTTPException(status_code=422, detail="A template must be a JSON object.")
        kind, schema, example = "inferred", templates.infer_schema(parsed), parsed
    return {"kind": kind, "schema": schema, "example": example,
            "problems": templates.check_schema(schema),
            "suggested_name": (parsed.get("title") if isinstance(parsed, dict) else None)
                              or (file.filename or "Process template").rsplit(".", 1)[0]}


class TemplateCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=120)
    schema_: dict = Field(..., alias="schema")
    example: Optional[Any] = None
    kind: str = "schema"
    description: str = ""
    make_default: bool = False
    #: The industry, domain, subdomain, process or subprocess it applies to.
    #: None: the global default.
    concept_id: Optional[str] = None

    model_config = {"populate_by_name": True}


@router.post("/templates", status_code=201)
async def create_template(body: TemplateCreate):
    scope = _scope_arg(body.concept_id) if body.concept_id else None
    created = _guard(templates.create_template, body.name, body.schema_, example=body.example,
                     kind=body.kind if body.kind in ("schema", "inferred") else "schema",
                     description=body.description, make_default=body.make_default,
                     concept_id=scope)
    revalidated = None
    if body.make_default:
        revalidated = await asyncio.to_thread(store.revalidate_all)
    return {**created, "revalidated": revalidated}


@router.post("/templates/{template_id}/default")
async def make_default(template_id: int):
    """Make a template the active one at its own scope."""
    template = _guard(templates.set_default, template_id)
    revalidated = await asyncio.to_thread(store.revalidate_all)
    return {**template, "revalidated": revalidated}


@router.delete("/templates/{template_id}")
async def delete_template(template_id: int):
    _guard(templates.delete_template, template_id)
    return {"deleted": template_id}


# ── Usage and resolution ───────────────────────────────────────────────────


@router.get("/usage")
async def usage(document_id: Optional[int] = None, concept_id: Optional[str] = None,
                subject_type: Optional[str] = None, subject_id: Optional[str] = None,
                limit: int = Query(300, ge=1, le=2000)):
    concept_ids = None
    if concept_id:
        concept_ids = sorted(ontology_store.descendants(concept_id))
    rows = await asyncio.to_thread(store.usage, document_id=document_id, concept_ids=concept_ids,
                                   subject_type=subject_type, subject_id=subject_id, limit=limit)
    return {"usage": rows}


@router.get("/resolve")
async def resolve(goal: str = Query(..., min_length=1)):
    """What the process-knowledge layer would pick for this goal, without building."""
    from app.ontology import matcher

    scope = matcher.scope_for_goal(goal)
    result = await asyncio.to_thread(resolver.resolve, goal, scope, None)
    return {
        "goal": goal,
        "scope": {"scoped": scope["scoped"], "domains": scope["domains"],
                  "label": matcher.describe_scope(scope)},
        "mode": result["mode"],
        "message": result["message"],
        "candidates": result["candidates"],
        "documents": [{k: d.get(k) for k in ("id", "title", "version", "concept_id", "path",
                                             "label", "stats")} for d in result["documents"]],
        "threshold": float(settings.PROCESS_MATCH_MIN_SCORE),
    }
