"""
Transformation recommendations → process documents.

A recommendation file lists, per L3 process, a pain point and the intervention
proposed for it. Each recommendation becomes one process document (template
v2), filed on its L3 node in the catalog — so the resolver, the build layers
and the "used by" panels need nothing new to use it.

Two input shapes are accepted:

* **flat** — the original export: a JSON array of objects keyed
  ``"L0 Process"``, ``"Business Pain Point"``, ``"Human Oversight Required"`` …
* **structured** — ``{"engagement": {...}, "recommendations": [...]}`` with
  nested ``process`` / ``intervention`` / ``execution_profile`` /
  ``integrations`` / ``governance`` sections.

Where the flat shape cannot say something (whether the work needs an agent,
how it is triggered) the importer infers what it safely can and lists the
rest as missing, per recommendation, so a person can fill it in.
"""

from __future__ import annotations

import json
import logging
import re
from typing import Any, Optional

logger = logging.getLogger(__name__)

#: The attributes a build needs to choose an agent type without guessing.
REQUIRED_FOR_MAPPING: tuple[tuple[str, str], ...] = (
    ("intervention.implementation_type", "Whether the work needs an agent at all"),
    ("execution_profile.workflow_determinism", "Fixed steps vs open-ended — task vs goal"),
    ("execution_profile.interaction_mode", "Dialogue vs background — conversational or not"),
    ("execution_profile.trigger.type", "What starts the work"),
    ("execution_profile.input_variability", "Standard forms vs mixed formats"),
    ("integrations.systems", "Systems read or changed, with access"),
    ("governance.action_authority", "Recommend, draft, write or transact"),
    ("governance.reversibility", "What a wrong action costs"),
    ("governance.validation.criteria", "What a reflective check verifies"),
)

_CATEGORY = {
    "artificial intelligence": "artificial_intelligence", "ai": "artificial_intelligence",
    "intelligent document processing": "intelligent_document_processing", "idp": "intelligent_document_processing",
    "workflow automation": "workflow_automation", "process mining": "process_mining",
    "rpa": "rpa", "robotic process automation": "rpa", "integration": "integration",
    "analytics": "analytics", "policy change": "policy_change",
}
_IMPLEMENTATION_FOR_CATEGORY = {
    "artificial_intelligence": "agent", "intelligent_document_processing": "agent",
    "workflow_automation": "workflow_config", "process_mining": "analytics",
    "rpa": "integration", "integration": "integration", "analytics": "analytics",
    "policy_change": "manual_process_change",
}
_DATA_CLASS_V1 = {"public": "public", "internal": "internal", "confidential": "internal",
                  "financial": "financial", "pii": "pii", "special_category": "pii"}


class ImportError_(ValueError):
    """The file could not be read as recommendations."""


def slug(text: str, limit: int = 60) -> str:
    words = re.findall(r"[a-z0-9]+", (text or "").lower())
    return "_".join(words)[:limit].strip("_") or "item"


def _get(data: Any, path: str) -> Any:
    cursor = data
    for part in path.split("."):
        if not isinstance(cursor, dict):
            return None
        cursor = cursor.get(part)
    return cursor


def _missing(value: Any) -> bool:
    return value is None or value == "" or value == [] or value == {}


def missing_attributes(doc: dict) -> list[dict]:
    """Which mapping attributes a process document lacks. Shared by the importer and the UI."""
    return [{"path": path, "why": why} for path, why in REQUIRED_FOR_MAPPING if _missing(_get(doc, path))]


# ── Reading the two shapes ─────────────────────────────────────────────────


def parse(raw: Any) -> dict:
    """Normalise either shape to ``{"engagement": {...}, "recommendations": [...], "shape": ...}``."""
    data = raw
    if isinstance(raw, (bytes, str)):
        try:
            data = json.loads(raw.decode("utf-8-sig") if isinstance(raw, bytes) else raw)
        except Exception as e:
            raise ImportError_(f"Not valid JSON: {e}") from e
    if isinstance(data, dict) and isinstance(data.get("recommendations"), list):
        return {"engagement": data.get("engagement") or {}, "recommendations": data["recommendations"],
                "shape": "structured"}
    if isinstance(data, list) and data and all(isinstance(r, dict) for r in data):
        if any("L3 Process" in r for r in data):
            return {"engagement": {}, "recommendations": [from_flat(r, i) for i, r in enumerate(data, 1)],
                    "shape": "flat"}
        if all("process" in r for r in data):
            return {"engagement": {}, "recommendations": data, "shape": "structured"}
    raise ImportError_("Expected a list of recommendations (with \"L3 Process\") or "
                       "{\"engagement\": …, \"recommendations\": […]}.")


def _oversight(text: str) -> tuple[Optional[str], Optional[str]]:
    t = (text or "").lower()
    rating = next((r for r in ("low", "medium", "high") if t.startswith(r) or f"{r} risk" in t), None)
    if "in-the-loop" in t or "in the loop" in t:
        model = "human_in_the_loop"
    elif "on-the-loop" in t or "on the loop" in t:
        model = "human_on_the_loop"
    elif "automation allowed" in t or "out-of-the-loop" in t or "out of the loop" in t:
        model = "human_out_of_the_loop"
    else:
        model = None
    return rating, model


def _split(text: Any) -> list[str]:
    if isinstance(text, list):
        return [str(t).strip() for t in text if str(t).strip()]
    parts = re.split(r",|;|\band\b", str(text or ""))
    return [p.strip() for p in parts if p.strip()]


def from_flat(row: dict, index: int) -> dict:
    """One flat-export row in the structured shape. Inferred fields are listed in ``_inferred``."""
    inferred: list[str] = []
    category_text = str(row.get("Transformation Intervention Category") or "").strip()
    key = re.sub(r"\s*\(.*?\)\s*", " ", category_text).strip().lower()
    category = _CATEGORY.get(key) or _CATEGORY.get(category_text.lower())
    implementation = _IMPLEMENTATION_FOR_CATEGORY.get(category or "")
    if implementation:
        inferred.append("intervention.implementation_type")
    source = str(row.get("Evidence Source") or "")
    origin = ("client_sop" if re.search(r"\bsop\b", source, re.I)
              else "market_research" if re.search(r"market research", source, re.I) else None)
    if origin:
        inferred.append("evidence.origin")
    rating, model = _oversight(str(row.get("Human Oversight Required") or ""))
    level = lambda v: (str(v).strip().lower() or None) if v else None  # noqa: E731
    mode = level(row.get("Intervention Mode"))
    return {
        "id": f"REC-{index:03d}",
        "title": row.get("Intervention Type") or f"{row.get('L3 Process', '')} — {category_text}".strip(" —"),
        "process": {"l0": row.get("L0 Process"), "l1": row.get("L1 Process"),
                    "l2": row.get("L2 Process"), "l3": row.get("L3 Process")},
        "problem": {"pain_point": row.get("Business Pain Point")},
        "intervention": {k: v for k, v in {
            "category": category, "implementation_type": implementation, "mode": mode,
            "type": row.get("Intervention Type"), "description": row.get("Intervention Description"),
        }.items() if v},
        "evidence": {k: v for k, v in {
            "source": source or None, "origin": origin, "type": level(row.get("Evidence Type")),
            "confidence": level(row.get("Confidence Score")),
        }.items() if v},
        "value": {k: v for k, v in {
            "metrics_impacted": [slug(m) for m in _split(row.get("Metrics Impacted"))],
            "expected_benefits": row.get("Expected Benefits"),
        }.items() if v},
        "feasibility": {k: v for k, v in {
            "rating": level(row.get("Feasibility")),
            "assumptions": [str(row["Assumptions"]).strip()] if str(row.get("Assumptions") or "").strip() else None,
        }.items() if v},
        "governance": {k: v for k, v in {
            "risk": {"rating": rating} if rating else None,
            "human_oversight": {"model": model} if model else None,
            "governance_controls": [slug(c) for c in _split(row.get("Responsible AI Controls"))],
        }.items() if v},
        "_inferred": inferred,
    }


# ── To a process document ──────────────────────────────────────────────────


def _default_stages(rec: dict, implementation: Optional[str], oversight: Optional[str]) -> list[dict]:
    intervention = rec.get("intervention") or {}
    purpose = str(intervention.get("description") or rec.get("title") or "Carry out the intervention.")
    agentic = implementation in ("agent", "hybrid")
    stages = [{
        "id": "execute", "name": str(rec.get("title") or "Execute")[:80], "purpose": purpose[:600],
        "actor_type": "agent" if agentic else "system",
        "execution": "agent" if agentic else "activity",
    }]
    if oversight in ("human_in_the_loop", "human_on_the_loop"):
        stages.append({
            "id": "review", "name": "Human review", "actor_type": "human", "execution": "human_task",
            "purpose": "A person reviews the result before it takes effect." if oversight == "human_in_the_loop"
            else "A person monitors results and handles exceptions.",
            "depends_on": ["execute"], "is_oversight_point": oversight == "human_in_the_loop",
        })
    return stages


def to_process_document(rec: dict, engagement: Optional[dict] = None) -> dict:
    """One recommendation as a template-v2 process document."""
    engagement = engagement or {}
    proc = rec.get("process") or {}
    l3 = str(proc.get("l3") or rec.get("title") or "Process").strip()
    intervention = dict(rec.get("intervention") or {})
    gov_in = dict(rec.get("governance") or {})
    oversight = (gov_in.get("human_oversight") or {}).get("model")

    doc: dict[str, Any] = {
        "template_version": "2.0",
        "process": {"id": slug(f"{rec.get('id', '')}_{l3}"), "name": l3, "level": "subprocess",
                    "parent_process": slug(str(proc.get("l2") or proc.get("l1") or "process"))},
        "classification": {k: v for k, v in {
            "industry": engagement.get("industry") or rec.get("industry") or "General",
            "domain": proc.get("l0") or engagement.get("process_scope") or "General",
            "process": proc.get("l2") or proc.get("l1"), "subprocess": l3,
        }.items() if v},
        "objective": str(intervention.get("description") or (rec.get("problem") or {}).get("pain_point")
                         or f"Improve {l3}.")[:2000],
        "recommendation": {k: v for k, v in {
            "id": rec.get("id"), "title": rec.get("title"), "phase": rec.get("phase"),
            "priority": rec.get("priority"), "depends_on": rec.get("depends_on"),
            "related_to": rec.get("related_to"), "pain_point": (rec.get("problem") or {}).get("pain_point"),
        }.items() if v},
        "intervention": {k: v for k, v in intervention.items()
                         if k in ("category", "implementation_type", "mode", "type", "description") and v},
    }
    for section in ("evidence", "feasibility", "execution_profile", "integrations", "knowledge",
                    "agent_design", "operations", "actors", "data"):
        if rec.get(section):
            doc[section] = rec[section]
    value = dict(rec.get("value") or {})
    if value:
        doc["value"] = {k: value[k] for k in ("metrics_impacted", "expected_benefits", "benefit_basis") if k in value}
        kpis = [{"name": k["name"], **({"target": k["target"]} if k.get("target") else {}),
                 **({"description": f"Baseline: {k['baseline']}"} if k.get("baseline") else {})}
                for k in value.get("kpis") or [] if isinstance(k, dict) and k.get("name")]
        if kpis:
            doc["kpis"] = kpis

    # Governance: the v2 section keeps what is governance proper; controls,
    # exceptions and regulations go to the top-level sections v1 already has.
    gov = {k: v for k, v in gov_in.items()
           if k in ("risk", "action_authority", "reversibility", "human_oversight", "validation",
                    "segregation_of_duties", "governance_controls")}
    if gov:
        doc["governance"] = gov
    if gov_in.get("controls"):
        doc["controls"] = [{k: c[k] for k in ("id", "description", "mandatory", "applies_to", "regulation") if k in c}
                           for c in gov_in["controls"] if isinstance(c, dict)]
    if gov_in.get("exceptions"):
        doc["exceptions"] = [{k: e[k] for k in ("id", "condition", "handling", "applies_to", "escalate_to") if k in e}
                             for e in gov_in["exceptions"] if isinstance(e, dict)]
    if gov_in.get("regulations"):
        doc["regulations"] = [{"id": slug(r), "name": str(r)} for r in gov_in["regulations"] if r]
    entities = (rec.get("data") or {}).get("entities") or []
    if entities:
        doc["data_entities"] = [{"name": e["name"], "fields": e.get("fields") or [],
                                 "classification": _DATA_CLASS_V1.get(e.get("classification"), "internal")}
                                for e in entities if isinstance(e, dict) and e.get("name")]
        doc["data"] = {k: v for k, v in (rec.get("data") or {}).items() if k != "entities"}
        if not doc["data"]:
            doc.pop("data")

    stages = rec.get("stages") or _default_stages(rec, intervention.get("implementation_type"), oversight)
    doc["stages"] = [{k: v for k, v in s.items() if k != "is_oversight_point" or v is not None}
                     for s in stages if isinstance(s, dict)]
    return doc


# ── Import ─────────────────────────────────────────────────────────────────


def _match_domain(text: str) -> tuple[Optional[str], list[dict]]:
    from app.catalog import match, store
    from app.catalog.vocab import Scheme

    scored = match.score_concepts(text, Scheme.DOMAIN.value)
    candidates = [{"concept_id": cid, "score": round(score, 2),
                   "label": (store.get_concept(cid) or {}).get("label", cid)} for cid, score in scored[:5]]
    best = scored[0][0] if scored and scored[0][1] >= 1.0 else None
    return best, candidates


def import_recommendations(raw: Any, *, domain_id: Optional[str] = None, filename: str = "",
                           save: bool = True) -> dict:
    """Import a recommendation file. Returns a per-recommendation report.

    ``domain_id`` files every recommendation under that domain; otherwise each
    one's L0 (and the engagement industry) is matched against the domain tree,
    and a recommendation with no match is reported under ``needs_domain``.
    ``save=False`` builds and validates the documents without storing anything.
    """
    from app.catalog import store as catalog_store
    from app.process import store as process_store, templates, validation

    parsed = parse(raw)
    engagement = parsed["engagement"]
    report: dict[str, Any] = {"shape": parsed["shape"], "imported": [], "needs_domain": [], "errors": []}
    if domain_id and not catalog_store.get_concept(domain_id):
        raise ImportError_(f"Domain '{domain_id}' does not exist.")

    for rec in parsed["recommendations"]:
        try:
            doc = to_process_document(rec, engagement)
            proc = rec.get("process") or {}
            entry = {
                "recommendation_id": rec.get("id"), "title": rec.get("title"),
                "l3": proc.get("l3"), "missing": missing_attributes(doc),
                "inferred": rec.get("_inferred") or [], "document": doc,
            }
            target_domain = domain_id
            if not target_domain:
                target_domain, candidates = _match_domain(
                    " ".join(filter(None, [str(proc.get("l0") or ""), str(engagement.get("industry") or "")])))
                if not target_domain:
                    report["needs_domain"].append({**entry, "candidates": candidates})
                    continue
            names = [n for n in (proc.get("l1"), proc.get("l2"), proc.get("l3")) if n]
            if not save:
                result = validation.validate(doc, templates.template_for(None))
                report["imported"].append({**entry, "domain_id": target_domain, "path": names,
                                           "status": "valid" if result.get("valid") else "invalid",
                                           "issues": result.get("issues", [])[:20]})
                continue
            path_ids = catalog_store.ensure_tree_path(target_domain, names) if names else []
            concept_id = path_ids[-1] if path_ids else None
            saved = process_store.save_document(
                doc, concept_id=concept_id, filename=filename or "recommendations.json", source="import")
            stored = saved.get("document") or {}
            report["imported"].append({
                **entry, "domain_id": target_domain, "path": names, "concept_id": concept_id,
                "document_id": stored.get("id"), "status": stored.get("status"),
                "issues": (saved.get("report") or {}).get("issues", [])[:20],
            })
        except Exception as e:
            logger.warning("Recommendation %s could not be imported: %s", rec.get("id"), e, exc_info=True)
            report["errors"].append({"recommendation_id": rec.get("id"), "error": str(e)[:400]})
    report["summary"] = (f"{len(report['imported'])} imported, {len(report['needs_domain'])} need a domain, "
                         f"{len(report['errors'])} failed.")
    return report
