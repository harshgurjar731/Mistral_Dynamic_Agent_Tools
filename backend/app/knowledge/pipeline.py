"""
The contract build layers go through to read guidance — a no-op when there is none.

Mirrors ``app.process.pipeline``: ``block`` returns "" when the run has no
guidance pack, so a prompt is byte-for-byte what it was before this feature;
``record_refs`` keeps only refs that were actually in the pack; ``persist``
writes what the build used once it has produced its agent or workflow.
"""

from __future__ import annotations

import logging
from typing import Any, Optional

from app.knowledge import retrieval

logger = logging.getLogger(__name__)

CONTEXT_KEY = "guidance_context"
USAGE_KEY = "_guidance_usage"


def active(ctx) -> Optional[dict]:
    pack = (getattr(ctx, "metadata", None) or {}).get(CONTEXT_KEY)
    return pack if isinstance(pack, dict) and pack.get("enabled") and pack.get("items") else None


def items(ctx) -> list[dict]:
    pack = active(ctx)
    return list(pack["items"]) if pack else []


def block(ctx, view: Optional[str], *, focus: Optional[str] = None) -> str:
    """The guidance text for ``view``; "" when inactive or the view has none.

    ``focus``: the process stage the decision is for (a workflow agent's
    ``process_stage``); the view is then ranked for that stage.
    """
    pack = active(ctx)
    if not pack or not view:
        return ""
    from app.config import settings

    try:
        text = retrieval.render(pack, view, limit=max(1, int(settings.GUIDANCE_VIEW_SIZE)),
                                focus=focus)
    except Exception as e:
        logger.warning("Guidance view '%s' could not be rendered: %s", view, e)
        return ""
    return "\n\n" + text if text else ""


def record_refs(ctx, layer: str, data: Any, *, target: Optional[str] = None) -> list[dict]:
    """Record a decision's ``guidance_refs`` answer. Unknown refs are dropped."""
    pack = active(ctx)
    refs = (data or {}).get("guidance_refs") if isinstance(data, dict) else None
    if not pack or not isinstance(refs, list):
        return []
    index = pack.get("refs") or {}
    usage = ctx.metadata.setdefault(USAGE_KEY, {})
    kept = []
    for r in refs:
        ref = str(r.get("ref") if isinstance(r, dict) else r or "").strip().strip("[]")
        meta = index.get(ref)
        if not meta:
            continue
        entry = {"ref": ref, "item_id": meta["id"], "title": meta["title"],
                 "strength": meta.get("strength"), "concept_id": meta.get("concept_id"),
                 "target": target}
        bucket = usage.setdefault(layer, [])
        if not any(e["ref"] == ref and e.get("target") == target for e in bucket):
            bucket.append(entry)
            kept.append(entry)
    return kept


def record_applied(ctx, layer: str, item_ids: list[int], *, how: str = "",
                   target: Optional[str] = None) -> None:
    """Record items a layer applied deterministically (no model answer to read)."""
    pack = active(ctx)
    if not pack:
        return
    index = {v["id"]: (k, v) for k, v in (pack.get("refs") or {}).items()}
    usage = ctx.metadata.setdefault(USAGE_KEY, {})
    for item_id in item_ids:
        if item_id not in index:
            continue
        ref, meta = index[item_id]
        bucket = usage.setdefault(layer, [])
        if not any(e["ref"] == ref and e.get("target") == target for e in bucket):
            bucket.append({"ref": ref, "item_id": item_id, "title": meta["title"],
                           "strength": meta.get("strength"), "concept_id": meta.get("concept_id"),
                           "target": target, "how": how})


def all_usage(ctx) -> dict[str, list[dict]]:
    return dict(((getattr(ctx, "metadata", None) or {}).get(USAGE_KEY)) or {})


def used_item_ids(ctx) -> list[int]:
    return sorted({e["item_id"] for entries in all_usage(ctx).values() for e in entries})


def persist(ctx, subject_type: str, subject_id: str, subject_name: str = "",
            *, target: Optional[str] = None) -> int:
    """Write the run's guidance usage to the shared usage table. Never raises."""
    if not active(ctx) or not subject_id:
        return 0
    from app.knowledge import store

    rows = []
    for layer, entries in all_usage(ctx).items():
        for e in entries:
            if target is not None and e.get("target") != target:
                continue
            rows.append({
                "item_id": e["item_id"], "concept_id": e.get("concept_id"),
                "subject_type": subject_type, "subject_id": subject_id,
                "subject_name": subject_name, "layer": layer, "element": e["ref"],
                "how": (f"[{e['target']}] " if e.get("target") else "") + (e.get("how") or e["title"]),
            })
    try:
        written = store.record_usage(rows, "guidance")
        if target is None:
            store.bump_stats(used_item_ids(ctx), "used")
        return written
    except Exception as e:
        logger.warning("Guidance usage could not be recorded: %s", e)
        return 0
