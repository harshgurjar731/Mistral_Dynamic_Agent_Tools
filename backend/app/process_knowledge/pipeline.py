"""
The process-knowledge contract every pipeline layer goes through.

Layers never read the context directly. They ask :func:`block` for their view
and report what they used with :func:`record` / :func:`record_refs`. Both are
no-ops when the feature is off for the run, which is what keeps a build with the
toggle off byte-for-byte identical to one from before this feature existed.

Usage is kept in ``ctx.metadata[USAGE_KEY]`` as ``{layer_name: [entry, …]}``.
The dict is created once by the process-knowledge layer, before any concurrent
group runs, so every branch snapshot writes into the same object — and
``PipelineContext.emit_layer`` attaches a layer's entries to its ``completed``
event, which is how the timeline shows them under the right row.
"""

from __future__ import annotations

import logging
from typing import Any, Optional

from app.process_knowledge import context as pk_context

logger = logging.getLogger(__name__)

CONTEXT_KEY = "process_context"
USAGE_KEY = "_process_usage"


def active(ctx) -> Optional[dict]:
    """The run's process context, or None when the feature is off or found nothing."""
    pc = (ctx.metadata or {}).get(CONTEXT_KEY)
    return pc if isinstance(pc, dict) and pc.get("enabled") and pc.get("documents") else None


def block(ctx, view: str, *, focus: Optional[str] = None, refs: bool = True,
          extra_instruction: str = "") -> str:
    """The prompt text for ``view``; "" when inactive (the prompt is then unchanged)."""
    pc = active(ctx)
    if not pc:
        return ""
    try:
        text = pk_context.render(pc, view, focus=focus)
    except Exception as e:
        logger.warning("Process knowledge view '%s' could not be rendered: %s", view, e)
        return ""
    if not text:
        return ""
    return "\n\n" + text + (pk_context.refs_instruction(extra_instruction) if refs else "")


def record(ctx, layer: str, items: list[dict]) -> list[dict]:
    """Record what ``layer`` used. Unknown refs are dropped, so only real
    elements of the selected documents are ever reported."""
    pc = active(ctx)
    if not pc or not items:
        return []
    index = pc.get("refs") or {}
    usage = ctx.metadata.setdefault(USAGE_KEY, {})
    kept = []
    for item in items:
        if not isinstance(item, dict):
            continue
        ref = str(item.get("ref") or "").strip().strip("[]")
        meta = index.get(ref)
        if not meta:
            continue
        entry = {
            "ref": ref, "type": meta["type"], "label": meta["label"],
            "how": str(item.get("how") or "").strip()[:400],
            "target": item.get("target"),
            "document_id": meta["document_id"], "document_version": meta.get("document_version"),
            "concept_id": meta.get("concept_id"),
        }
        bucket = usage.setdefault(layer, [])
        if not any(e["ref"] == ref and e.get("target") == entry["target"] and e["how"] == entry["how"]
                   for e in bucket):
            bucket.append(entry)
            kept.append(entry)
    return kept


def record_refs(ctx, layer: str, data: Any, *, target: Optional[str] = None) -> list[dict]:
    """Record a decision's ``process_refs`` answer."""
    refs = (data or {}).get("process_refs") if isinstance(data, dict) else None
    if not isinstance(refs, list):
        return []
    items = []
    for r in refs:
        if isinstance(r, str):
            r = {"ref": r}
        if isinstance(r, dict):
            items.append({**r, "target": r.get("target") or target})
    return record(ctx, layer, items)


def usage_for(ctx, layer: str) -> list[dict]:
    return list(((ctx.metadata or {}).get(USAGE_KEY) or {}).get(layer) or [])


def all_usage(ctx) -> dict[str, list[dict]]:
    return dict((ctx.metadata or {}).get(USAGE_KEY) or {})


def persist(ctx, subject_type: str, subject_id: str, subject_name: str = "",
            *, target: Optional[str] = None) -> int:
    """Write the run's usage to the database and annotate the subject with
    the processes it implements. Called once the build has produced its agent
    or workflow. Never raises.

    ``target`` limits the recorded entries to those made for one capability —
    an agent a workflow created is credited with its own design, not the
    whole plan's.
    """
    pc = active(ctx)
    if not pc or not subject_id:
        return 0
    from app.ontology import store as ontology_store
    from app.ontology.vocab import Predicate
    from app.process_knowledge import store

    rows = []
    for layer, entries in all_usage(ctx).items():
        for e in entries:
            if target is not None and e.get("target") != target:
                continue
            rows.append({
                "document_id": e["document_id"], "document_version": e.get("document_version"),
                "concept_id": e.get("concept_id"), "subject_type": subject_type,
                "subject_id": subject_id, "subject_name": subject_name, "layer": layer,
                "element": e["ref"],
                "how": (f"[{e['target']}] " if e.get("target") else "") + (e.get("how") or ""),
            })
    # Every build that used a document is recorded even if no layer named an
    # element, so "used by" never under-reports.
    for doc in pc["documents"]:
        rows.append({
            "document_id": doc["id"], "document_version": doc.get("version"),
            "concept_id": doc.get("concept_id"), "subject_type": subject_type,
            "subject_id": subject_id, "subject_name": subject_name, "layer": "process_knowledge",
            "element": f"document:{doc['id']}",
            "how": f"{doc.get('role', 'primary')} document ({pc['mode']})",
        })
        if doc.get("concept_id"):
            try:
                ontology_store.annotate(subject_type, subject_id,
                                        Predicate.IMPLEMENTS_PROCESS.value, doc["concept_id"],
                                        source="pipeline")
            except Exception as e:
                logger.debug("Could not annotate %s %s with its process: %s",
                             subject_type, subject_id, e)
    return store.record_usage(rows)
