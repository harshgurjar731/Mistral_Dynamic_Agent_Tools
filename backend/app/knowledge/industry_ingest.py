"""
Adding industry knowledge — from a document, or from a structured pack.

    document ─► extract (Mistral OCR) ─► check it is an industry reference document
             ─► distil into facts (JSON) ─► file each on the chosen node or one below it
             ─► dedupe (hash, then meaning) ─► embed ─► proposed items, waiting for review

    pack (JSON / YAML / CSV in the template's shape) ─► validated ─► active items

What to upload: reference documents about an industry — regulations and
regulatory summaries, industry standards and data-format specifications,
policy and credit manuals with their rules and thresholds, KPI handbooks,
risk and fraud registers, glossaries. A process document belongs on the
Processes page and build best practice under Guidance; a document that is
mostly one of those is reported as such and yields nothing.

Every source is filed under an industry node the person chooses (industry,
domain or subdomain). The model may place a fact on a narrower node below it,
picked from the list it is shown, never elsewhere.
"""

from __future__ import annotations

import asyncio
import csv
import io
import json
import logging
import time
from typing import Any, Optional

from app.knowledge import industry, store

logger = logging.getLogger(__name__)

#: Force as written in a document or pack → the stored ``strength``.
FORCES = {"mandatory": "must", "must": "must", "prohibited": "avoid", "avoid": "avoid",
          "recommended": "should", "should": "should", "informational": "may", "info": "may",
          "may": "may"}

DOCUMENT_TYPES = ("industry_reference", "process_document", "build_guidance", "data", "other")
_DUPLICATE_SIMILARITY = 0.95

SYSTEM_PROMPT = """\
You extract INDUSTRY KNOWLEDGE from a reference document, for a platform that plans AI agents,
multi-step workflows and the code they run. Industry knowledge is what is true of an industry,
domain or subdomain regardless of any one company's process: its regulations, standards, business
rules and thresholds, metrics and formulas, risks and failure modes, typical processes and terms.

First say what the excerpt is ("document_type"):
- industry_reference: regulation, regulatory guidance, standard, policy or credit manual, KPI
  handbook, risk register, glossary, industry primer — extract from it.
- process_document: one organisation's own process steps, roles and controls (belongs on the
  Processes page) — extract nothing.
- build_guidance: advice on how to build agents or software — extract nothing.
- data: records, transactions, a spreadsheet of values — extract nothing.
- other: marketing, news, anything else — extract nothing.

For industry_reference, extract SHORT, SELF-CONTAINED items. One item states one rule, formula,
threshold, obligation, risk, standard or definition, so a planner or a code generator can apply
it on its own. Keep every number, unit, limit, formula and code exactly as written. Never invent
content and never generalise beyond the text.

Fields per item:
- category: regulation | standard | business_rule | metric | risk | process | definition
  (regulation: a legal or regulatory obligation; standard: an industry standard, data format or
  code list; business_rule: a rule, limit or threshold the industry applies; metric: a KPI with
  its formula; risk: a failure mode, fraud pattern or hazard; process: how the work is typically
  done across the industry; definition: a term and its meaning).
- force: mandatory | prohibited | recommended | informational. mandatory/prohibited ONLY when the
  text is categorical ("must", "shall", "required", "prohibited", "may not").
- title: <= 12 words.  body: 1-4 sentences, or a compact list; self-contained.
- node: the id of the narrowest node below that the item is specifically about, chosen ONLY from
  the list given; "" when it applies to the whole of the chosen node.
- jurisdiction: "global", or the region or country it applies to as the text states it (EU, UK,
  US, IN, US-CA …). Use the document's jurisdiction when the item does not name one.
- as_of: the date or year the rule or figure is stated for (YYYY or YYYY-MM), or "".
- tags: up to 6 search words someone would type.
- page: the page number from the nearest "<!-- page N -->" marker before the passage, or null.
- quote: <= 25 words copied verbatim from the excerpt that supports the item.
- confidence: high | medium | low — how clearly the excerpt states it.

Return JSON: {{"document_type": "...", "reasoning": "<one sentence>", "items": [ ... ]}}.
Return "items": [] when the excerpt has nothing worth keeping.

The knowledge is being filed under: {node_path}
Nodes an item may be placed on instead (id — path):
{nodes}
"""

USER_PROMPT = """\
SOURCE: {title}
DEFAULT JURISDICTION: {jurisdiction}
EXCERPT {index} of {total}:

{text}
"""


def _subtree(concept_id: str) -> list[tuple[str, str]]:
    """``[(id, path)]`` of the chosen node and every node below it."""
    from app.catalog import store as catalog_store

    ids = sorted(catalog_store.descendants(concept_id, include_self=True))
    cache: dict[str, str] = {}
    return [(cid, industry.path_label(cid, cache)) for cid in ids]


def _clean(raw: Any, *, allowed_nodes: set[str], default_node: str, jurisdiction: str) -> Optional[dict]:
    if not isinstance(raw, dict):
        return None
    title = str(raw.get("title") or "").strip()[:200]
    body = str(raw.get("body") or raw.get("statement") or "").strip()[:3000]
    if not title or not body:
        return None
    category = str(raw.get("category") or "definition").strip().lower()
    category = store.LEGACY_REFERENCE_CATEGORIES.get(category, category)
    if category not in store.INDUSTRY_CATEGORIES:
        category = "definition"
    force = FORCES.get(str(raw.get("force") or raw.get("strength") or "").strip().lower(), "may")
    node = str(raw.get("node") or raw.get("concept_id") or "").strip()
    page = raw.get("page")
    try:
        page = int(page) if page not in (None, "") else None
    except (TypeError, ValueError):
        page = None
    confidence = str(raw.get("confidence") or "medium").lower()
    tags = raw.get("tags") or []
    if isinstance(tags, str):
        tags = [t.strip() for t in tags.split(",")]
    return {
        "kind": "reference", "category": category, "title": title, "body": body,
        "strength": force,
        "concept_id": node if node in allowed_nodes else default_node,
        "jurisdiction": str(raw.get("jurisdiction") or jurisdiction or "global"),
        "as_of": str(raw.get("as_of") or "").strip()[:20] or None,
        "tags": [str(t).strip()[:40] for t in tags if str(t).strip()][:6],
        "page": page, "quote": str(raw.get("quote") or "").strip()[:300],
        "confidence": confidence if confidence in ("high", "medium", "low") else "medium",
    }


async def distil(client: Any, text: str, *, title: str, concept_id: str,
                 jurisdiction: str = "global") -> tuple[list[dict], list[str], dict[str, int]]:
    """Every industry item in a document. Returns ``(items, notes, document_types)``."""
    from app.config import settings
    from app.core.decision import LONG_TIMEOUT_MS, decide, parse_json
    from app.knowledge.distill import chunks

    nodes = _subtree(concept_id)
    allowed = {cid for cid, _ in nodes}
    system = SYSTEM_PROMPT.format(
        node_path=industry.path_label(concept_id),
        nodes="\n".join(f"  {cid} — {path}" for cid, path in nodes[:120]) or "  (none)")
    every = chunks(text)
    limit = max(1, int(industry.setting("INDUSTRY_MAX_EXCERPTS", 40)))
    pieces = every[:limit]
    model = str(industry.setting("INDUSTRY_DISTILL_MODEL", "") or settings.KNOWLEDGE_DISTILL_MODEL)

    async def one(index: int, piece: str):
        raw = await decide(
            client, model=model, system=system,
            user=USER_PROMPT.format(title=title or "untitled", jurisdiction=jurisdiction or "global",
                                    index=index, total=len(pieces), text=piece),
            phase=f"industry knowledge extraction ({index}/{len(pieces)})",
            timeout_ms=LONG_TIMEOUT_MS, temperature=0.1)
        data = parse_json(raw, {}) or {}
        kind = str(data.get("document_type") or "industry_reference").lower()
        if kind not in DOCUMENT_TYPES:
            kind = "other"
        found = [] if kind != "industry_reference" else [
            i for i in (_clean(r, allowed_nodes=allowed, default_node=concept_id,
                               jurisdiction=jurisdiction) for r in data.get("items") or []) if i]
        return kind, found

    results = await asyncio.gather(*[one(i, p) for i, p in enumerate(pieces, 1)], return_exceptions=True)
    items: list[dict] = []
    notes: list[str] = []
    types: dict[str, int] = {}
    for i, result in enumerate(results, 1):
        if isinstance(result, Exception):
            notes.append(f"Excerpt {i} could not be read: {str(result)[:200]}")
            continue
        kind, found = result
        types[kind] = types.get(kind, 0) + 1
        items.extend(found)
    if len(every) > limit:
        notes.append(f"Only the first {limit} of {len(every)} excerpts were read "
                     "(Settings → Industry knowledge → Excerpts read per document).")
    return items, notes, types


_WRONG_PLACE = {
    "process_document": "This reads as one organisation's process document — add it on the Processes page.",
    "build_guidance": "This reads as advice on building agents — add it under Knowledge → Guidance.",
    "data": "This reads as data records, not knowledge about the industry.",
    "other": "This does not read as an industry reference document.",
}


async def _dedupe_by_meaning(created: list[int]) -> int:
    """Retire new items that say what an approved item already says. Needs embeddings."""
    from app.knowledge.retrieval import _cosine

    new = [i for i in store.list_items(ids=created, embedding=True) if i.get("embedding")]
    if not new:
        return 0
    existing = [i for i in store.list_items(kind="reference", status="active", embedding=True)
                if i["id"] not in set(created) and i.get("embedding")]
    retired = 0
    for item in new:
        for other in existing:
            if _cosine(item["embedding"], other["embedding"]) >= _DUPLICATE_SIMILARITY:
                store.update_item(item["id"], {"status": "retired",
                                               "rationale": f"Duplicate of industry:{other['id']} "
                                                            f"(\"{other['title']}\")."})
                retired += 1
                break
    return retired


def _save(items: list[dict], *, source: dict, status_for, origin: str) -> tuple[list[int], int, list[str]]:
    existing = {store.content_hash(i["title"], i["body"])
                for i in store.list_items(kind="reference", limit=100000)}
    created: list[int] = []
    skipped = 0
    notes: list[str] = []
    for item in items:
        digest = store.content_hash(item["title"], item["body"])
        if digest in existing:
            skipped += 1
            continue
        existing.add(digest)
        try:
            saved = store.create_item({
                **{k: item.get(k) for k in ("kind", "category", "title", "body", "strength", "concept_id",
                                            "jurisdiction", "as_of", "tags", "confidence")},
                "kind": "reference", "audience": "builder", "status": status_for(item),
                "origin": origin, "source_id": source["id"],
                "source_ref": {"page": item.get("page"), "quote": item.get("quote"),
                               "document_id": source.get("document_id"),
                               "library_id": source.get("library_id")},
            })
            created.append(saved["id"])
        except store.KnowledgeError as e:
            notes.append(f"\"{item['title']}\" skipped: {e}")
    return created, skipped, notes


async def distil_source(client: Any, source_id: int, *, jurisdiction: str = "global",
                        auto_approve: Optional[bool] = None) -> dict:
    """Distil an industry source's text into proposed items. Re-running replaces what was only proposed."""
    from app.knowledge import embed

    source = store.get_source(source_id, text=True)
    if not source or source.get("purpose") != "industry":
        raise store.KnowledgeError(f"Industry source {source_id} not found.")
    if not source.get("text"):
        raise store.KnowledgeError("The source has no extracted text.")
    industry.check_node(source.get("concept_id"))
    auto = bool(industry.setting("INDUSTRY_AUTO_APPROVE", False)) if auto_approve is None else auto_approve

    for old in store.list_items(source_id=source_id, statuses=("proposed", "conflicting")):
        store.delete_item(old["id"])

    items, notes, types = await distil(client, source["text"], title=source["title"],
                                       concept_id=source["concept_id"], jurisdiction=jurisdiction)
    document_type = max(types, key=types.get) if types else "other"
    if not items and document_type in _WRONG_PLACE:
        notes.insert(0, _WRONG_PLACE[document_type])
    created, skipped, save_notes = _save(
        items, source=source, origin="distilled",
        status_for=lambda i: "active" if (auto and i["confidence"] == "high") else "proposed")
    notes += save_notes
    embedded = await embed.embed_missing(client, created) if created else 0
    duplicates = await _dedupe_by_meaning(created) if embedded else 0
    if created and not embedded:
        notes.append("Embeddings unavailable — ranked by words only, and not checked for duplicates by meaning.")
    store.update_source(source_id, status="distilled", item_count=len(created) - duplicates,
                        message=" ".join(notes)[:2000] or None)
    return {"source_id": source_id, "document_type": document_type, "created": len(created),
            "skipped_duplicates": skipped, "duplicates": duplicates, "embedded": embedded,
            "conflicts": 0, "notes": notes, "item_ids": created}


# ── Structured packs ───────────────────────────────────────────────────────

PACK_FIELDS = ("node", "category", "force", "title", "body", "jurisdiction", "as_of", "tags", "source_page")


def pack_template() -> dict:
    """The structured pack: the exact shape a reviewed import takes."""
    return {
        "format": "industry-knowledge-pack/v1",
        "node": "domain.lending.mortgage",
        "jurisdiction": "UK",
        "source": "FCA MCOB 11 — Responsible lending (summary)",
        "entries": [
            {"category": "regulation", "force": "mandatory",
             "title": "Affordability must be assessed before a mortgage is offered",
             "body": "A lender must assess whether the customer can afford the mortgage, using "
                     "verified income and committed expenditure, before entering into the contract.",
             "jurisdiction": "UK", "as_of": "2026-01", "tags": ["affordability", "mcob"],
             "source_page": 3},
            {"category": "metric", "force": "informational", "node": "domain.lending.mortgage",
             "title": "Loan-to-value (LTV)",
             "body": "LTV = loan amount / property value x 100, rounded to one decimal place.",
             "tags": ["ltv"]},
            {"category": "business_rule", "force": "recommended",
             "title": "LTV above 90% needs senior underwriter sign-off",
             "body": "Applications with LTV above 90% are referred to a senior underwriter.",
             "tags": ["ltv", "referral"]},
        ],
    }


def pack_template_csv() -> str:
    out = io.StringIO()
    writer = csv.DictWriter(out, fieldnames=PACK_FIELDS)
    writer.writeheader()
    template = pack_template()
    for e in template["entries"]:
        writer.writerow({"node": e.get("node") or template["node"], "category": e["category"],
                         "force": e["force"], "title": e["title"], "body": e["body"],
                         "jurisdiction": e.get("jurisdiction") or template["jurisdiction"],
                         "as_of": e.get("as_of") or "", "tags": ", ".join(e.get("tags") or []),
                         "source_page": e.get("source_page") or ""})
    return out.getvalue()


def parse_pack(data: bytes, filename: str) -> Optional[dict]:
    """A structured pack, or None when the file is not one (it is then read as a document)."""
    name = (filename or "").lower()
    text = data.decode("utf-8-sig", errors="replace")
    if name.endswith(".csv"):
        rows = list(csv.DictReader(io.StringIO(text)))
        if not rows or not {"title", "body"} <= set(rows[0]):
            return None
        return {"entries": [{**r, "page": r.get("source_page")} for r in rows]}
    if name.endswith((".json", ".yaml", ".yml")):
        try:
            if name.endswith(".json"):
                parsed = json.loads(text)
            else:
                import yaml

                parsed = yaml.safe_load(text)
        except Exception:
            return None
        if isinstance(parsed, dict) and isinstance(parsed.get("entries"), list):
            return parsed
    return None


def import_pack(pack: dict, *, source: dict, default_node: str, default_jurisdiction: str = "global",
                status: str = "active") -> dict:
    """Write a structured pack's entries. Each is checked; a bad one is reported, not fatal."""
    node = str(pack.get("node") or default_node or "")
    industry.check_node(node)
    allowed = {cid for cid, _ in _subtree(node)}
    jurisdiction = str(pack.get("jurisdiction") or default_jurisdiction or "global")
    items, notes = [], []
    for i, raw in enumerate(pack.get("entries") or [], 1):
        entry_node = str((raw or {}).get("node") or "").strip() if isinstance(raw, dict) else ""
        if entry_node and entry_node not in allowed:
            notes.append(f"Entry {i}: node '{entry_node}' is not under {node} — filed on {node}.")
        item = _clean(raw, allowed_nodes=allowed, default_node=node, jurisdiction=jurisdiction)
        if item is None:
            notes.append(f"Entry {i} skipped: it needs a title and a body.")
            continue
        item["confidence"] = "high"
        items.append(item)
    created, skipped, save_notes = _save(items, source=source, origin="user",
                                         status_for=lambda _i: status)
    notes += save_notes
    return {"created": created, "skipped": skipped, "notes": notes}


# ── Entry point ────────────────────────────────────────────────────────────


async def add_source(client: Any, *, concept_id: str, data: Optional[bytes] = None, filename: str = "",
                     content_type: str = "", url: str = "", text: str = "", title: str = "",
                     jurisdiction: str = "global", auto_approve: Optional[bool] = None) -> dict:
    """Add an industry document or pack under ``concept_id``. Returns the source and the result."""
    from app.knowledge import embed, extract

    industry.check_node(concept_id)
    source_type = "file" if data is not None else "url" if url else "text"
    if source_type == "text" and not text.strip():
        raise store.KnowledgeError("Provide a file, a URL or some text.")
    source = store.create_source(title=title or filename or url or "Pasted text", source_type=source_type,
                                 filename=filename or None, url=url or None, concept_id=concept_id,
                                 status="pending", purpose="industry")
    if data is not None:
        pack = parse_pack(data, filename)
        if pack is not None:
            result = import_pack(pack, source=source, default_node=concept_id,
                                 default_jurisdiction=jurisdiction)
            embedded = await embed.embed_missing(client, result["created"]) if result["created"] else 0
            store.update_source(source["id"], status="distilled", item_count=len(result["created"]),
                                text=data.decode("utf-8-sig", errors="replace")[:500000],
                                message=("Imported as a structured pack. " + " ".join(result["notes"]))[:2000])
            return {"source": store.get_source(source["id"]),
                    "result": {"source_id": source["id"], "document_type": "industry_pack",
                               "created": len(result["created"]), "skipped_duplicates": result["skipped"],
                               "duplicates": 0, "embedded": embedded, "conflicts": 0,
                               "notes": result["notes"], "item_ids": result["created"]}}

    started = time.monotonic()
    try:
        if data is not None:
            extracted, method = await extract.from_bytes(client, data, filename, content_type)
        elif url:
            extracted, method, page_title = await extract.from_url(client, url)
            if not title and page_title:
                store.update_source(source["id"], title=page_title[:300])
        else:
            extracted, method = text, "text"
    except Exception as e:
        store.update_source(source["id"], status="failed", message=str(e)[:1000])
        raise store.KnowledgeError(f"Could not read the source: {e}") from e
    store.update_source(source["id"], text=extracted, status="extracted",
                        extraction_seconds=time.monotonic() - started, message=f"Extracted with {method}.")
    result = await distil_source(client, source["id"], jurisdiction=jurisdiction, auto_approve=auto_approve)
    return {"source": store.get_source(source["id"]), "result": result}
