"""
Where an unfiled process document belongs — so it can be checked against the
template of that part of the classification.

A document uploaded on an orchestration page is not filed under a process, but
it still has to match the template its industry, domain or process uses. In
order of trust:

1. **chosen** — the user picked the process (or domain) it belongs to;
2. **document** — its own ``process`` / ``classification`` fields name a process,
   subprocess, subdomain, domain or industry in the ontology;
3. **request** — the request's goal is scoped by the ontology matcher and the
   best-scoring process (or, failing that, the matched domain) is used;
4. **none** — nothing matched; the global template applies.

Lexical, like the goal matcher — the labels and synonyms are written to be
matched, and a model call here would sit on every upload.
"""

from __future__ import annotations

import json
import logging
import re
from typing import Any, Optional

from app.ontology import store as ontology_store
from app.ontology.vocab import SYSTEM_DOMAIN, Scheme

logger = logging.getLogger(__name__)


def _norm(text: Any) -> str:
    return re.sub(r"[^a-z0-9]+", " ", str(text or "").lower()).strip()


def _names(concept: dict) -> set[str]:
    out = {_norm(concept["label"]), _norm(concept["id"].rsplit(".", 1)[-1])}
    out |= {_norm(s.lstrip("!")) for s in concept.get("synonyms") or []}
    return {n for n in out if n}


def _parse(raw: Any) -> Optional[dict]:
    if isinstance(raw, dict):
        return raw
    if isinstance(raw, (bytes, bytearray)):
        raw = raw.decode("utf-8-sig", errors="ignore")
    if isinstance(raw, str):
        try:
            value = json.loads(raw)
            return value if isinstance(value, dict) else None
        except Exception:
            return None
    return None


def _result(concept_id: str, method: str, detail: str) -> dict:
    from app.process_knowledge.templates import scope_path

    concept = ontology_store.get_concept(concept_id) or {}
    return {"concept_id": concept_id, "label": concept.get("label", concept_id),
            "level": concept.get("level_name"), "path": scope_path(concept_id),
            "method": method, "detail": detail}


def _match(scheme: str, wanted: list[Any], within: Optional[set[str]] = None) -> Optional[dict]:
    names = [_norm(w) for w in wanted if _norm(w)]
    if not names:
        return None
    for concept in ontology_store.list_concepts(scheme):
        if within is not None and concept["id"] not in within:
            continue
        if concept["id"] == SYSTEM_DOMAIN:
            continue
        if any(n in _names(concept) or n == _norm(concept["id"]) for n in names):
            return concept
    return None


def from_document(doc: dict) -> Optional[dict]:
    """The deepest concept the document's own fields name."""
    process = doc.get("process") if isinstance(doc.get("process"), dict) else {}
    cls = doc.get("classification") if isinstance(doc.get("classification"), dict) else {}

    # Domain first, so a process name shared by two industries resolves to the
    # one the document says it is in.
    domain = None
    for key in ("industry", "domain", "subdomain"):
        if cls.get(key):
            within = (ontology_store.descendants(domain["id"]) if domain else None)
            found = _match(Scheme.DOMAIN.value, [cls[key]], within)
            if found:
                domain = found
    within_processes = ontology_store.processes_under([domain["id"]], include_ancestors=False) \
        if domain else None

    sub = _match(Scheme.PROCESS.value, [cls.get("subprocess"),
                                        process.get("name") if process.get("level") == "subprocess" else None,
                                        process.get("id") if process.get("level") == "subprocess" else None],
                 within_processes)
    if sub:
        return _result(sub["id"], "document", "named in the document's classification")
    proc = _match(Scheme.PROCESS.value, [cls.get("process"), process.get("name"), process.get("id"),
                                         process.get("parent_process")], within_processes)
    if proc:
        return _result(proc["id"], "document", "named in the document's process fields")
    if domain:
        return _result(domain["id"], "document", "the domain named in the document's classification")
    return None


def from_goal(goal: str) -> Optional[dict]:
    """The process (or domain) the request itself is about."""
    if not goal or not goal.strip():
        return None
    from app.config import settings
    from app.ontology import matcher
    from app.process_knowledge import resolver

    try:
        scope = matcher.scope_for_goal(goal)
    except Exception as e:
        logger.debug("Goal scoping failed during classification: %s", e)
        return None
    if not scope.get("scoped"):
        return None
    candidates = resolver.candidates_for(goal, scope)
    if candidates and candidates[0]["score"] >= float(settings.PROCESS_MATCH_MIN_SCORE):
        best = candidates[0]
        return _result(best["concept_id"], "request",
                       f"the request matched this process (score {best['score']})")
    return _result(scope["domains"][0], "request", "the domain the request was scoped to")


def classify(raw: Any, *, goal: str = "", chosen: Optional[str] = None) -> dict:
    """Where the document belongs, and how that was decided. Never raises."""
    if chosen:
        if ontology_store.get_concept(chosen):
            return _result(chosen, "chosen", "chosen when uploading")
        logger.info("Chosen classification %r does not exist — classifying instead", chosen)
    doc = _parse(raw)
    try:
        found = (from_document(doc) if doc else None) or from_goal(goal)
    except Exception as e:
        logger.warning("Process document classification failed: %s", e)
        found = None
    if found:
        return found
    from app.process_knowledge.templates import scope_path

    return {"concept_id": None, "label": None, "level": None, "path": scope_path(None),
            "method": "none",
            "detail": "nothing in the document or the request matched the classification"}
