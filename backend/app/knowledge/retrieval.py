"""
Guidance retrieval — which build guidance a run should follow.

Runs once per build, with no model call (one optional embedding call):

    candidates  active guidance whose audience includes the builder
    scope       filed on a node in the request's scope, either direction, or global
    conditions  checked against the run's facts; an item whose conditions are
                false is dropped, an unknown condition keeps it (marked)
    rank        lexical overlap with the goal, strength, specificity, and cosine
                similarity when the items and the goal have embeddings
    pack        the top items, sliced per layer view by category

The pack is what layers read (``app.knowledge.pipeline.block``). An empty pack
means no guidance: nothing is set, and every prompt is unchanged.
"""

from __future__ import annotations

import logging
import math
from typing import Any, Iterable, Optional

from app.catalog.match import GOAL_STOPWORDS, tokens

logger = logging.getLogger(__name__)

STRENGTH_WEIGHT = {"must": 3.0, "avoid": 2.5, "should": 1.5, "may": 0.5}
STRENGTH_LABEL = {"must": "MUST", "avoid": "AVOID", "should": "SHOULD", "may": "MAY"}

#: Which layer views each guidance category is shown to, unless an item names
#: its own ``layers``. Views are the same names process knowledge uses.
CATEGORY_VIEWS: dict[str, tuple[str, ...]] = {
    "workflow_pattern": ("decomposition", "execution_mode", "topology", "revision"),
    "anti_pattern": ("decomposition", "execution_mode", "topology", "design", "agent_instructions",
                     "revision"),
    "archetype": ("agent_archetype", "design", "agent_instructions"),
    "agent_design": ("design", "agent_instructions", "agent_identity", "agent_archetype"),
    "instruction_style": ("agent_instructions", "design"),
    "naming": ("agent_identity", "design"),
    "tool_connector": ("execution_mode", "agent_tools", "agent_connectors", "design"),
    "data_handling": ("data_flow", "agent_libraries", "guardrail", "agent_guardrail", "rules",
                      "agent_rules"),
    "governance": ("agent_archetype", "topology", "guardrail", "agent_guardrail", "rules",
                   "agent_rules", "oversight"),
    "model_choice": ("agent_model", "design"),
    "best_practice": ("decomposition", "design", "agent_instructions", "revision"),
}


# ── Facts and conditions ───────────────────────────────────────────────────


def facts_from(process_content: Optional[dict] = None, requirements: Any = None,
               extra: Optional[dict] = None) -> dict:
    """The attributes conditions are checked against.

    The primary process document's content, as-is (``execution_profile.*``,
    ``governance.*``, ``intervention.*`` …), plus the request's requirement
    analysis under ``requirements.*`` when there is one.
    """
    facts: dict = dict(process_content or {})
    if requirements is not None:
        req = requirements if isinstance(requirements, dict) else {
            k: getattr(requirements, k) for k in getattr(requirements, "__dataclass_fields__", {})
        }
        facts["requirements"] = req
    if extra:
        facts.update(extra)
    return facts


_MISSING = object()


def get_attr(facts: dict, path: str) -> Any:
    """Dotted lookup; list segments match if any element has the value."""
    cursor: Any = facts
    for part in str(path).split("."):
        if isinstance(cursor, dict):
            cursor = cursor.get(part, _MISSING)
        elif isinstance(cursor, list):
            values = [c.get(part, _MISSING) for c in cursor if isinstance(c, dict)]
            values = [v for v in values if v is not _MISSING]
            cursor = values if values else _MISSING
        else:
            return _MISSING
        if cursor is _MISSING:
            return _MISSING
    return cursor


def _norm(value: Any) -> Any:
    if isinstance(value, str):
        return value.strip().lower()
    if isinstance(value, list):
        return [_norm(v) for v in value]
    return value


def _check(found: Any, op: str, value: Any) -> bool:
    found, value = _norm(found), _norm(value)
    found_list = found if isinstance(found, list) else [found]
    if op == "exists":
        return found not in (None, "", [], {})
    if op == "eq":
        return any(f == value for f in found_list)
    if op == "ne":
        return all(f != value for f in found_list)
    if op == "in":
        options = value if isinstance(value, list) else [value]
        return any(f in options for f in found_list)
    if op == "not_in":
        options = value if isinstance(value, list) else [value]
        return all(f not in options for f in found_list)
    if op == "contains":
        return any(isinstance(f, str) and isinstance(value, str) and value in f for f in found_list) \
            or value in found_list
    return False


def evaluate(conditions: Iterable[dict], facts: dict) -> str:
    """``true`` when every condition holds, ``false`` when any fails, else ``unknown``."""
    unknown = False
    for c in conditions or []:
        found = get_attr(facts, c.get("attr", ""))
        if found is _MISSING:
            unknown = True
            continue
        if not _check(found, c.get("op", "eq"), c.get("value")):
            return "false"
    return "unknown" if unknown else "true"


# ── Scope ──────────────────────────────────────────────────────────────────


def scope_concepts(concept_ids: Iterable[str]) -> Optional[set[str]]:
    """Nodes an item may be filed on to be in scope: down and up the one tree."""
    ids = [c for c in concept_ids or [] if c]
    if not ids:
        return None
    from app.catalog import store

    scope: set[str] = set()
    for cid in ids:
        try:
            scope |= store.tree_descendants(cid)
            scope |= store.tree_ancestors(cid, include_self=True)
        except Exception as e:
            logger.debug("Scope expansion failed for %s: %s", cid, e)
            scope.add(cid)
    return scope


def scope_ids(scope: Optional[dict], process_concepts: Iterable[str] = ()) -> list[str]:
    """The concept ids a run is about: its matched domains plus its process nodes."""
    out = list((scope or {}).get("domains") or []) if (scope or {}).get("scoped", True) else []
    out += [c for c in process_concepts if c]
    return list(dict.fromkeys(out))


# ── Ranking ────────────────────────────────────────────────────────────────


def _cosine(a: list[float], b: list[float]) -> float:
    if not a or not b or len(a) != len(b):
        return 0.0
    dot = sum(x * y for x, y in zip(a, b))
    na = math.sqrt(sum(x * x for x in a))
    nb = math.sqrt(sum(y * y for y in b))
    return dot / (na * nb) if na and nb else 0.0


def select(goal: str, *, concept_ids: Iterable[str] = (), facts: Optional[dict] = None,
           subject: str = "both", item_ids: Optional[Iterable[int]] = None,
           query_vector: Optional[list[float]] = None, limit: int = 24,
           items: Optional[list[dict]] = None) -> list[dict]:
    """Rank the guidance for a run. Each result carries ``score`` and ``applies``."""
    from app.knowledge import store as knowledge_store

    if items is None:
        items = knowledge_store.list_items(
            kind="guidance", status="active", audiences=("builder", "both"),
            ids=item_ids, embedding=query_vector is not None)
    facts = facts or {}
    scope = scope_concepts(concept_ids)
    goal_tokens = tokens(goal, GOAL_STOPWORDS)
    depth_cache: dict[str, int] = {}

    def depth(cid: Optional[str]) -> int:
        if not cid:
            return 0
        if cid not in depth_cache:
            from app.catalog import store

            try:
                depth_cache[cid] = len(store.tree_path(cid))
            except Exception:
                depth_cache[cid] = 1
        return depth_cache[cid]

    scored: list[tuple[float, dict]] = []
    for item in items:
        if subject != "both" and item.get("subject") not in (subject, "both"):
            continue
        cid = item.get("concept_id")
        # Global items are always in scope; an unscoped run sees everything and
        # relies on ranking.
        if scope is not None and cid and cid not in scope:
            continue
        applies = evaluate(item.get("conditions") or [], facts)
        if applies == "false":
            continue
        text_tokens = tokens(" ".join([item.get("title", ""), item.get("body", ""),
                                       " ".join(item.get("tags") or [])]), GOAL_STOPWORDS)
        overlap = len(goal_tokens & text_tokens)
        score = STRENGTH_WEIGHT.get(item.get("strength") or "should", 1.0)
        score += overlap * 1.0
        if applies == "true" and item.get("conditions"):
            score += 3.0  # its conditions were checked and hold: it is about this run
        score += depth(cid) * 0.5
        if query_vector is not None and item.get("embedding"):
            score += 6.0 * max(0.0, _cosine(query_vector, item["embedding"]))
        out = {k: v for k, v in item.items() if k != "embedding"}
        out["score"] = round(score, 3)
        out["applies"] = applies
        scored.append((score, out))

    scored.sort(key=lambda pair: (-pair[0], pair[1]["id"]))
    return [entry for _, entry in scored[: max(1, limit)]]


# ── Pack and views ─────────────────────────────────────────────────────────


def ref(item: dict) -> str:
    return f"guidance:{item['id']}"


def views_for(item: dict) -> tuple[str, ...]:
    return tuple(item.get("layers") or ()) or CATEGORY_VIEWS.get(item.get("category") or "", ("design",))


def build_pack(items: list[dict], *, mode: str, message: str = "") -> dict:
    views: dict[str, list[int]] = {}
    for item in items:
        for view in views_for(item):
            views.setdefault(view, []).append(item["id"])
    return {
        "enabled": True,
        "mode": mode,
        "message": message,
        "items": items,
        "refs": {ref(i): {"id": i["id"], "title": i["title"], "strength": i.get("strength"),
                          "category": i.get("category"), "concept_id": i.get("concept_id"),
                          "source_id": i.get("source_id")} for i in items},
        "views": views,
    }


def render(pack: dict, view: str, *, limit: int = 6) -> str:
    """The guidance block for one view; "" when the view has none."""
    ids = (pack.get("views") or {}).get(view) or []
    if not ids:
        return ""
    by_id = {i["id"]: i for i in pack.get("items") or []}
    chosen = [by_id[i] for i in ids if i in by_id][:limit]
    if not chosen:
        return ""
    lines = ["## Build guidance — best practices for this decision"]
    for item in chosen:
        label = STRENGTH_LABEL.get(item.get("strength") or "should", "SHOULD")
        body = " ".join((item.get("body") or "").split())
        if len(body) > 360:
            body = body[:357] + "…"
        cond = " (conditions not all known for this run)" if item.get("applies") == "unknown" else ""
        lines.append(f"- [{ref(item)}] {label} — {item['title']}: {body}{cond}")
    lines += [
        "",
        "Follow MUST items and never do what an AVOID item rules out. Prefer SHOULD items "
        "unless the request or the process knowledge says otherwise. In your JSON answer add "
        '"guidance_refs": a list of the [guidance:N] refs you actually applied (empty if none).',
    ]
    return "\n".join(lines)


def summary_line(pack: dict) -> str:
    items = pack.get("items") or []
    musts = sum(1 for i in items if i.get("strength") in ("must", "avoid"))
    return (f"{len(items)} guidance item(s) in scope ({musts} must/avoid)."
            if items else (pack.get("message") or "No build guidance in scope."))
