"""
Which process documents a build should use.

1. **Uploaded or picked** — documents sent with the request are used as given,
   once they pass validation.
2. **From the inventory** — otherwise the goal's ontology scope (the same one
   the planner narrows agents with) is walked to the processes linked under it,
   and each is scored against the goal. The best one above the threshold wins,
   with its subprocesses as related context.
3. **None** — nothing qualifies; the build continues without, and says so.

Lexical, like the goal matcher: the vocabulary is written to be matched, and a
model call here would add latency to every build to save a few synonyms.
"""

from __future__ import annotations

import logging
import re
from typing import Iterable, Optional

from app.ontology import store as ontology_store
from app.ontology.vocab import Scheme
from app.process_knowledge import store

logger = logging.getLogger(__name__)

_WORD = re.compile(r"[a-z0-9]+")
_STOPWORDS = frozenset(
    """
    a an the and or of for to in on with from by at is are be that this it as will can
    should must workflow agent step run create build make handle system data new use
    using get set process processes please want need
    """.split()
)

#: Related subprocess documents carried with the primary one.
_MAX_RELATED = 3


def _tokens(text: str) -> set[str]:
    return {w for w in _WORD.findall((text or "").lower()) if w not in _STOPWORDS and len(w) > 2}


def breadcrumb(concept_id: Optional[str]) -> str:
    """Industry › Domain › Subdomain › Process › Subprocess for a process concept."""
    if not concept_id:
        return ""
    chain = [concept_id, *ontology_store._ancestor_chain(concept_id)]
    root = chain[-1]
    domain = ontology_store.domain_of(root)
    if domain:
        chain += [domain, *ontology_store._ancestor_chain(domain)]
    labels = []
    for cid in reversed(chain):
        concept = ontology_store.get_concept(cid)
        labels.append(concept["label"] if concept else cid)
    return " › ".join(labels)


def _decorate(doc: dict) -> dict:
    concept = ontology_store.get_concept(doc["concept_id"]) if doc.get("concept_id") else None
    return {**doc, "label": concept["label"] if concept else doc.get("title"),
            "path": breadcrumb(doc.get("concept_id")) if concept else "Unfiled upload"}


def score(goal_tokens: set[str], concept: dict, doc: Optional[dict],
          scope_domains: Iterable[str]) -> tuple[float, list[str]]:
    """How well a process matches a goal, and why."""
    why: list[str] = []
    total = 0.0
    label_hits = goal_tokens & _tokens(concept.get("label", ""))
    if label_hits:
        total += 3.0 * len(label_hits)
        why.append(f"name: {', '.join(sorted(label_hits))}")
    syn_hits = goal_tokens & _tokens(" ".join(concept.get("synonyms") or []))
    if syn_hits:
        total += 2.0 * len(syn_hits - label_hits)
        why.append(f"synonyms: {', '.join(sorted(syn_hits))}")
    def_hits = goal_tokens & _tokens(concept.get("definition", ""))
    if def_hits:
        total += 1.0 * len(def_hits - label_hits - syn_hits)
    content = (doc or {}).get("content") or {}
    if content:
        doc_text = " ".join([
            str(content.get("objective") or ""),
            " ".join(map(str, content.get("triggers") or [])),
            " ".join(str((s or {}).get("name") or "") for s in content.get("stages") or []
                     if isinstance(s, dict)),
        ])
        doc_hits = goal_tokens & _tokens(doc_text)
        extra = doc_hits - label_hits - syn_hits - def_hits
        if extra:
            total += min(3.0, 0.75 * len(extra))
            why.append(f"document: {', '.join(sorted(extra)[:5])}")
    domain = ontology_store.domain_of(concept["id"])
    if domain and domain in set(scope_domains):
        total += 2.0
        why.append("filed under the matched domain")
    return round(total, 2), why


def candidates_for(goal: str, scope: Optional[dict], limit: int = 8) -> list[dict]:
    """Processes the goal could use, best first, each with its score and reason."""
    domains = list((scope or {}).get("domains") or [])
    if domains:
        pool = ontology_store.processes_under(domains)
    else:
        pool = {c["id"] for c in ontology_store.list_concepts(Scheme.PROCESS.value)}
    if not pool:
        return []
    concepts = {c["id"]: c for c in ontology_store.list_concepts(Scheme.PROCESS.value)
                if c["id"] in pool}
    active = store.active_for(concepts.keys())
    tokens = _tokens(goal)
    out = []
    for cid, concept in concepts.items():
        s, why = score(tokens, concept, active.get(cid), domains)
        out.append({
            "concept_id": cid, "label": concept["label"], "level": concept.get("level_name"),
            "score": s, "why": why, "has_document": cid in active,
            "document_id": (active.get(cid) or {}).get("id"),
            "document_version": (active.get(cid) or {}).get("version"),
            "path": breadcrumb(cid),
        })
    out.sort(key=lambda c: (-c["score"], not c["has_document"], c["label"]))
    return out[:limit]


def resolve(goal: str, scope: Optional[dict], document_ids: Optional[list] = None) -> dict:
    """Pick the documents for one build. Never raises.

    Returns ``{mode, documents, candidates, message, rejected}`` with documents
    primary-first; ``mode`` is uploaded | inventory | none.
    """
    from app.config import settings

    scope_label = ""
    try:
        from app.ontology import matcher

        scope_label = matcher.describe_scope(scope) if scope else ""
    except Exception:
        pass

    if document_ids:
        found = store.get_documents(document_ids)
        valid = [d for d in found if d["status"] == "valid" and d.get("content")]
        rejected = [
            {"id": d["id"], "title": d["title"], "status": d["status"], "summary": d.get("summary")}
            for d in found if d not in valid
        ]
        missing = [i for i in document_ids if int(i) not in {d["id"] for d in found}]
        if valid:
            return {"mode": "uploaded", "documents": [_decorate(d) for d in valid],
                    "candidates": [], "rejected": rejected, "scope_label": scope_label,
                    "message": ""}
        reasons = []
        if rejected:
            reasons.append(f"{len(rejected)} attached document(s) are not valid")
        if missing:
            reasons.append(f"{len(missing)} attached document(s) no longer exist")
        note = "; ".join(reasons) or "the attached documents could not be read"
        logger.info("Process knowledge: %s — falling back to inventory", note)
        fallback = _from_inventory(goal, scope, scope_label, float(settings.PROCESS_MATCH_MIN_SCORE))
        fallback["rejected"] = rejected
        fallback["message"] = f"Not using the attached documents: {note}. " + fallback["message"]
        return fallback

    return _from_inventory(goal, scope, scope_label, float(settings.PROCESS_MATCH_MIN_SCORE))


def _from_inventory(goal: str, scope: Optional[dict], scope_label: str, threshold: float) -> dict:
    try:
        candidates = candidates_for(goal, scope)
    except Exception as e:
        logger.warning("Process candidate lookup failed: %s", e)
        candidates = []
    with_doc = [c for c in candidates if c["has_document"]]
    best = with_doc[0] if with_doc else None
    where = scope_label if scope and scope.get("scoped") else "this request"

    if not candidates:
        return {"mode": "none", "documents": [], "candidates": [], "rejected": [],
                "scope_label": scope_label,
                "message": f"No process is defined for {where} — continuing without process knowledge."}
    if not best:
        return {"mode": "none", "documents": [], "candidates": candidates, "rejected": [],
                "scope_label": scope_label,
                "message": f"{len(candidates)} process(es) exist for {where}, but none has a valid "
                           f"document — continuing without process knowledge."}
    if best["score"] < threshold:
        return {"mode": "none", "documents": [], "candidates": candidates, "rejected": [],
                "scope_label": scope_label,
                "message": f"No process matched the request closely enough (best: "
                           f"{best['label']}, score {best['score']} < {threshold}) — continuing "
                           f"without process knowledge."}

    primary = store.get_document(best["document_id"])
    if not primary:
        return {"mode": "none", "documents": [], "candidates": candidates, "rejected": [],
                "scope_label": scope_label, "message": "The matched process document could not be read."}
    docs = [primary]
    children = ontology_store.descendants(best["concept_id"], include_self=False)
    related = store.active_for(children)
    docs += [store.get_document(d["id"]) for d in list(related.values())[:_MAX_RELATED]]
    docs = [_decorate(d) for d in docs if d]
    return {"mode": "inventory", "documents": docs, "candidates": candidates, "rejected": [],
            "scope_label": scope_label,
            "message": f"Matched {best['label']} from the process inventory "
                       f"(score {best['score']}: {'; '.join(best['why']) or 'scope'})."}


def documents_for_subject(subject_type: str, subject_id: str) -> list[dict]:
    """Active documents of the processes a built agent or workflow implements."""
    from app.ontology.vocab import Predicate

    try:
        annotations = ontology_store.annotations_for(subject_type, subject_id)
    except Exception:
        return []
    concept_ids = annotations.get(Predicate.IMPLEMENTS_PROCESS.value) or []
    active = store.active_for(concept_ids)
    docs = [store.get_document(active[c]["id"]) for c in concept_ids if c in active]
    return [_decorate(d) for d in docs if d]
