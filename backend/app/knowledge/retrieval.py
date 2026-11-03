"""
Guidance retrieval — which build guidance a run should follow.

Runs once per build, with no model call (one optional embedding call):

    candidates  active guidance whose audience includes the builder
    scope       filed on a node in the request's scope, either direction, or global
    conditions  checked against the run's facts; an item whose conditions are
                false is dropped, an unknown condition keeps it (marked)
    rank        lexical overlap with the goal, strength, specificity, and cosine
                similarity when the items and the goal have embeddings — plus,
                when the run has a process document, the same two signals
                against the process (weighted below the goal, so the request
                still leads)
    pack        the top items, with a few places kept for every layer view,
                sliced per view by category; a view asked for one process
                stage is re-ranked for that stage

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

#: Ranking weights: Settings → Process knowledge → Guidance ranking. The goal is
#: what was asked; the process and a stage say what the work involves. Process
#: and stage signals are capped and weighted below the goal by default so a
#: long document cannot drown the request. Read on every call (live).
_WEIGHT_DEFAULTS = {
    "GUIDANCE_GOAL_WEIGHT": 6.0, "GUIDANCE_PROCESS_WEIGHT": 3.5,
    "GUIDANCE_PROCESS_WORD_WEIGHT": 0.4, "GUIDANCE_PROCESS_WORDS_MAX": 6,
    "GUIDANCE_STAGE_WEIGHT": 5.0, "GUIDANCE_STAGE_WORD_WEIGHT": 0.6,
    "GUIDANCE_STAGE_WORDS_MAX": 8, "GUIDANCE_CONDITION_BOOST": 3.0,
}


def weight(name: str) -> float:
    from app.config import settings

    try:
        return float(getattr(settings, name))
    except (AttributeError, TypeError, ValueError):
        return float(_WEIGHT_DEFAULTS[name])
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
           items: Optional[list[dict]] = None, process_text: str = "",
           process_vector: Optional[list[float]] = None, view_min: int = 0,
           keep_vectors: bool = False) -> list[dict]:
    """Rank the guidance for a run. Each result carries ``score`` and ``applies``.

    ``process_text`` / ``process_vector``: the run's process, as extra ranking
    signals. ``view_min``: after the top ``limit``, add the next-best items of
    any layer view left with fewer than this many, so one category cannot
    crowd another out. ``keep_vectors``: keep each item's embedding (as
    ``_vector``) for per-stage re-ranking.
    """
    from app.knowledge import store as knowledge_store

    if items is None:
        items = knowledge_store.list_items(
            kind="guidance", status="active", audiences=("builder", "both"),
            ids=item_ids, embedding=query_vector is not None)
    facts = facts or {}
    scope = scope_concepts(concept_ids)
    goal_tokens = tokens(goal, GOAL_STOPWORDS)
    process_tokens = tokens(process_text, GOAL_STOPWORDS) - goal_tokens if process_text else set()
    w_goal, w_process = weight("GUIDANCE_GOAL_WEIGHT"), weight("GUIDANCE_PROCESS_WEIGHT")
    w_word, words_max = weight("GUIDANCE_PROCESS_WORD_WEIGHT"), int(weight("GUIDANCE_PROCESS_WORDS_MAX"))
    w_condition = weight("GUIDANCE_CONDITION_BOOST")
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
            score += w_condition  # its conditions were checked and hold: it is about this run
        score += depth(cid) * 0.5
        if process_tokens:
            score += w_word * min(len(process_tokens & text_tokens), words_max)
        if query_vector is not None and item.get("embedding"):
            score += w_goal * max(0.0, _cosine(query_vector, item["embedding"]))
        if process_vector is not None and item.get("embedding"):
            score += w_process * max(0.0, _cosine(process_vector, item["embedding"]))
        out = {k: v for k, v in item.items() if k != "embedding"}
        if keep_vectors and item.get("embedding"):
            out["_vector"] = item["embedding"]
        out["score"] = round(score, 3)
        out["applies"] = applies
        scored.append((score, out))

    scored.sort(key=lambda pair: (-pair[0], pair[1]["id"]))
    ranked = [entry for _, entry in scored]
    chosen = ranked[: max(1, limit)]
    if view_min > 0 and len(ranked) > len(chosen):
        chosen = _fill_views(chosen, ranked[len(chosen):], view_min, extra=max(1, limit // 2))
    return chosen


def _fill_views(chosen: list[dict], rest: list[dict], view_min: int, *, extra: int) -> list[dict]:
    """Give every view at least ``view_min`` items, taking the best of the rest."""
    counts: dict[str, int] = {}
    for item in chosen:
        for view in views_for(item):
            counts[view] = counts.get(view, 0) + 1
    added = 0
    for item in rest:
        if added >= extra:
            break
        if not any(counts.get(v, 0) < view_min for v in views_for(item)):
            continue
        chosen.append(item)
        added += 1
        for view in views_for(item):
            counts[view] = counts.get(view, 0) + 1
    return chosen


# ── Pack and views ─────────────────────────────────────────────────────────


def ref(item: dict) -> str:
    return f"guidance:{item['id']}"


def views_for(item: dict) -> tuple[str, ...]:
    return tuple(item.get("layers") or ()) or CATEGORY_VIEWS.get(item.get("category") or "", ("design",))


def build_pack(items: list[dict], *, mode: str, message: str = "",
               stages: Optional[dict[str, dict]] = None) -> dict:
    """The run's guidance. ``stages``: ``{stage ref: {"text", "vector"?}}`` for
    re-ranking a view for one process stage (``render(..., focus=)``)."""
    views: dict[str, list[int]] = {}
    for item in items:
        for view in views_for(item):
            views.setdefault(view, []).append(item["id"])
    return {
        "stages": stages or {},
        "enabled": True,
        "mode": mode,
        "message": message,
        "items": items,
        "refs": {ref(i): {"id": i["id"], "title": i["title"], "strength": i.get("strength"),
                          "category": i.get("category"), "concept_id": i.get("concept_id"),
                          "source_id": i.get("source_id")} for i in items},
        "views": views,
    }


def _stage_key(focus: Optional[str]) -> str:
    focus = str(focus or "").strip()
    if not focus:
        return ""
    return focus if focus.startswith("stage:") else f"stage:{focus.split(':', 1)[-1]}"


def rank_for_stage(items: list[dict], stage: Optional[dict]) -> list[dict]:
    """``items`` re-ordered for one process stage: its words and meaning added
    to each item's run score. Unchanged without the stage."""
    if not stage or not (stage.get("text") or stage.get("vector")):
        return list(items)
    stage_tokens = tokens(stage.get("text") or "", GOAL_STOPWORDS)
    vector = stage.get("vector")
    w_stage, w_word = weight("GUIDANCE_STAGE_WEIGHT"), weight("GUIDANCE_STAGE_WORD_WEIGHT")
    words_max = int(weight("GUIDANCE_STAGE_WORDS_MAX"))

    def score(item: dict) -> float:
        text_tokens = tokens(" ".join([item.get("title", ""), item.get("body", ""),
                                       " ".join(item.get("tags") or [])]), GOAL_STOPWORDS)
        value = float(item.get("score") or 0.0)
        value += w_word * min(len(stage_tokens & text_tokens), words_max)
        if vector is not None and item.get("_vector"):
            value += w_stage * max(0.0, _cosine(vector, item["_vector"]))
        return value

    return sorted(items, key=lambda i: (-score(i), i["id"]))


def render(pack: dict, view: str, *, limit: int = 6, focus: Optional[str] = None) -> str:
    """The guidance block for one view; "" when the view has none.

    ``focus``: a process stage (``stage:intake``). The view's items are then
    re-ranked for that stage, so each agent of a workflow gets the guidance
    for its own part of the process.
    """
    ids = (pack.get("views") or {}).get(view) or []
    if not ids:
        return ""
    by_id = {i["id"]: i for i in pack.get("items") or []}
    candidates = [by_id[i] for i in ids if i in by_id]
    stage = (pack.get("stages") or {}).get(_stage_key(focus))
    chosen = rank_for_stage(candidates, stage)[:limit]
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
