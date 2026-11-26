"""
The contract planning layers and code generation go through to read industry knowledge.

Mirrors ``app.process.pipeline`` and ``app.knowledge.pipeline``: ``block``
returns "" when the run has no industry pack, so a prompt is byte-for-byte
what it was without the feature; ``record_refs`` keeps only refs that were in
the pack; ``persist`` writes what the build used once it has produced its
agent or workflow.

Usage is kept in ``ctx.metadata[USAGE_KEY]`` as ``{layer: [entry, …]}``,
created by the industry-knowledge layer before any concurrent group runs, so
every branch snapshot writes into the same dict.
"""

from __future__ import annotations

import logging
from typing import Any, Optional

from app.knowledge import industry

logger = logging.getLogger(__name__)

CONTEXT_KEY = "industry_context"
USAGE_KEY = "_industry_usage"
#: The usage table's source_type for industry knowledge.
SOURCE_TYPE = "industry"


def active(ctx) -> Optional[dict]:
    pack = (getattr(ctx, "metadata", None) or {}).get(CONTEXT_KEY)
    return pack if isinstance(pack, dict) and pack.get("enabled") and pack.get("items") else None


def attach(ctx, pack: Optional[dict]) -> None:
    """Set the run's pack (None clears it), keeping usage already recorded."""
    if pack:
        ctx.metadata[CONTEXT_KEY] = pack
        ctx.metadata.setdefault(USAGE_KEY, {})
    else:
        ctx.metadata.pop(CONTEXT_KEY, None)


def block(ctx, view: Optional[str], *, focus: str = "") -> str:
    """The industry text for ``view``; "" when inactive or the view has none."""
    pack = active(ctx)
    if not pack or not view:
        return ""
    try:
        text = industry.render(pack, view, focus=focus)
    except Exception as e:
        logger.warning("Industry knowledge view '%s' could not be rendered: %s", view, e)
        return ""
    return "\n\n" + text if text else ""


def _ref_of(r: Any) -> tuple[str, str]:
    if isinstance(r, dict):
        return str(r.get("ref") or "").strip().strip("[]"), str(r.get("how") or "").strip()[:400]
    return str(r or "").strip().strip("[]"), ""


def record_refs(ctx, layer: str, data: Any, *, target: Optional[str] = None) -> list[dict]:
    """Record a decision's ``industry_refs`` answer. Unknown refs are dropped."""
    pack = active(ctx)
    refs = (data or {}).get("industry_refs") if isinstance(data, dict) else None
    if not pack or not isinstance(refs, list):
        return []
    index = pack.get("refs") or {}
    usage = ctx.metadata.setdefault(USAGE_KEY, {})
    kept = []
    for r in refs:
        ref, how = _ref_of(r)
        meta = index.get(ref)
        if not meta:
            continue
        entry = {"ref": ref, "item_id": meta["id"], "title": meta["title"],
                 "category": meta.get("category"), "strength": meta.get("strength"),
                 "concept_id": meta.get("concept_id"), "target": target, "how": how}
        bucket = usage.setdefault(layer, [])
        if not any(e["ref"] == ref and e.get("target") == target for e in bucket):
            bucket.append(entry)
            kept.append(entry)
    return kept


def record_items(ctx, layer: str, refs: list[str], *, target: Optional[str] = None,
                 how: str = "") -> list[dict]:
    """Record items a step used without a model answer naming them (e.g. code generation)."""
    return record_refs(ctx, layer, {"industry_refs": [{"ref": r, "how": how} for r in refs]},
                       target=target)


def all_usage(ctx) -> dict[str, list[dict]]:
    return dict(((getattr(ctx, "metadata", None) or {}).get(USAGE_KEY)) or {})


def used_item_ids(ctx) -> list[int]:
    return sorted({e["item_id"] for entries in all_usage(ctx).values() for e in entries})


def persist(ctx, subject_type: str, subject_id: str, subject_name: str = "",
            *, target: Optional[str] = None) -> int:
    """Write the run's industry usage to the shared usage table. Never raises."""
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
        written = store.record_usage(rows, SOURCE_TYPE)
        if target is None:
            store.bump_stats(used_item_ids(ctx), "used")
        return written
    except Exception as e:
        logger.warning("Industry knowledge usage could not be recorded: %s", e)
        return 0


def code_items(ctx, text: str) -> list[dict]:
    """The items a tool or activity built in this run should follow; [] when off."""
    if not bool(industry.setting("INDUSTRY_IN_CODEGEN", True)):
        return []
    return industry.code_items(active(ctx), text)


async def ensure(ctx, *, goal: str, concept_ids) -> Optional[dict]:
    """The run's pack, resolving it now when no layer has yet (a tool built before planning)."""
    pack = active(ctx)
    if pack:
        return pack
    pack = await industry.resolve(ctx.client, goal=goal, concept_ids=concept_ids,
                                  mode=industry_request(ctx).get("mode"))
    attach(ctx, pack)
    return pack


def industry_request(ctx) -> dict:
    """The run's industry request (``process_knowledge.industry``), e.g. ``{"mode": "off"}``."""
    request = (getattr(ctx, "process_request", None) or {}).get("industry")
    return request if isinstance(request, dict) else {}
