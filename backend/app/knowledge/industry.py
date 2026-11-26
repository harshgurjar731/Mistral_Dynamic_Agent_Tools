"""
Industry knowledge for planning — which facts about the industry a build follows.

Industry knowledge is filed on the domain tree, at one of its three levels:

    industry   →  domain    →  subdomain
    BFSI       →  Lending   →  Mortgage

and at the most general level it is true at, so a mortgage build reads what is
filed on Mortgage, on Lending and on BFSI. It is never global (that is build
guidance) and never on a process node (that is process knowledge).

Once per build, with no model call (one optional embedding call):

    scope       the run's domains — the goal's matched domains, the process
                document's domain, the agent's analysed domain — with their
                ancestors (inherited) and, optionally, their descendants
                (narrower, kept only when they match the request)
    filter      active items, in an allowed jurisdiction
    rank        force (mandatory first), how close the node is, word overlap
                and meaning against the goal and the process
    pack        the top items, sliced per planning decision by category

Layers read the pack through ``app.knowledge.industry_pipeline.block``; code
generation through ``code_items``. No pack means no industry knowledge: every
prompt is then exactly what it was without the feature.
"""

from __future__ import annotations

import logging
import math
from typing import Any, Iterable, Optional

from app.catalog.match import GOAL_STOPWORDS, tokens

logger = logging.getLogger(__name__)

#: How binding an item is. Stored in ``strength``; None reads as informational.
FORCE_LABEL = {"must": "MANDATORY", "avoid": "PROHIBITED", "should": "RECOMMENDED", "may": "INFO"}
FORCE_WEIGHT = {"must": 3.0, "avoid": 3.0, "should": 1.5, "may": 0.5}

CATEGORY_LABEL = {
    "regulation": "Regulation", "standard": "Standard", "business_rule": "Business rule",
    "metric": "Metric", "risk": "Risk", "process": "Typical process", "definition": "Definition",
}
#: A little weight for what most often has to change a plan.
CATEGORY_WEIGHT = {"regulation": 1.0, "business_rule": 0.75, "risk": 0.5, "standard": 0.5,
                   "metric": 0.4, "process": 0.2, "definition": 0.0}

#: Which planning decisions each category is shown to. The view names are the
#: ones process knowledge and guidance use; ``code`` is tool and activity code.
CATEGORY_VIEWS: dict[str, tuple[str, ...]] = {
    "regulation": ("decomposition", "execution_mode", "topology", "oversight", "agent_archetype",
                   "design", "agent_instructions", "guardrail", "agent_guardrail", "rules",
                   "agent_rules", "data_flow", "revision", "code"),
    "standard": ("data_flow", "design", "agent_tools", "agent_connectors", "agent_instructions",
                 "revision", "code"),
    "business_rule": ("decomposition", "design", "agent_instructions", "rules", "agent_rules",
                      "data_flow", "revision", "code"),
    "metric": ("decomposition", "design", "agent_instructions", "data_flow", "revision", "code"),
    "risk": ("decomposition", "topology", "oversight", "agent_archetype", "design",
             "agent_instructions", "guardrail", "agent_guardrail", "revision"),
    "process": ("decomposition", "execution_mode", "topology", "design", "revision"),
    "definition": ("design", "agent_instructions", "agent_identity", "agent_libraries",
                   "data_flow", "code"),
}

#: Categories code can follow literally, in the order code generation prefers them.
CODE_CATEGORIES = ("business_rule", "metric", "standard", "regulation", "definition")

#: How an item relates to the run's domains.
EXACT, INHERITED, NARROWER = "exact", "inherited", "narrower"


def setting(name: str, default: Any) -> Any:
    from app.config import settings

    value = getattr(settings, name, default)
    return default if value is None else value


# ── The tree ───────────────────────────────────────────────────────────────


class NodeError(ValueError):
    """An item filed somewhere industry knowledge may not go."""


def check_node(concept_id: Optional[str]) -> dict:
    """The domain-tree node an item is filed on. Raises NodeError when it is not one."""
    from app.catalog import store
    from app.catalog.vocab import SYSTEM_DOMAIN, Scheme

    if not concept_id:
        raise NodeError("Choose the industry, domain or subdomain this knowledge is about.")
    concept = store.get_concept(concept_id)
    if not concept:
        raise NodeError(f"Concept '{concept_id}' does not exist.")
    if concept.get("scheme_id") != Scheme.DOMAIN.value:
        raise NodeError(f"'{concept.get('label') or concept_id}' is not an industry, domain or subdomain "
                        "— process knowledge belongs on the Processes page.")
    if concept_id == SYSTEM_DOMAIN or concept_id.startswith(SYSTEM_DOMAIN + "."):
        raise NodeError("System is not an industry; it holds no industry knowledge.")
    return concept


def level_name(concept_id: Optional[str]) -> str:
    """industry | domain | subdomain — from depth, as the tree defines it."""
    from app.catalog import store

    depth = len(store.tree_path(concept_id)) if concept_id else 0
    return {1: "industry", 2: "domain"}.get(depth, "subdomain" if depth >= 3 else "")


def path_label(concept_id: Optional[str], cache: Optional[dict] = None) -> str:
    """``BFSI › Lending › Mortgage`` for a node."""
    if not concept_id:
        return ""
    if cache is not None and concept_id in cache:
        return cache[concept_id]
    from app.catalog import store

    try:
        label = " › ".join(c.get("label") or c["id"] for c in store.tree_path(concept_id))
    except Exception:
        label = concept_id
    if cache is not None:
        cache[concept_id] = label
    return label or concept_id


def run_domains(concept_ids: Iterable[str]) -> list[str]:
    """The domain-tree nodes a run is about. Process nodes are replaced by their domain."""
    from app.catalog import store
    from app.catalog.vocab import SYSTEM_DOMAIN, Scheme

    out: list[str] = []
    for cid in concept_ids or []:
        if not cid or cid == SYSTEM_DOMAIN:
            continue
        concept = store.get_concept(cid)
        if not concept:
            continue
        if concept.get("scheme_id") == Scheme.PROCESS.value:
            cid = store.domain_of(cid) or ""
            if not cid:
                continue
        elif concept.get("scheme_id") != Scheme.DOMAIN.value:
            continue
        if cid not in out:
            out.append(cid)
    return out


def scope(concept_ids: Iterable[str], *, narrower: bool = True) -> dict[str, str]:
    """``{concept_id: exact | inherited | narrower}`` for the run's domains."""
    from app.catalog import store

    relation: dict[str, str] = {}
    for cid in run_domains(concept_ids):
        try:
            if narrower:
                for d in store.descendants(cid, include_self=False):
                    relation.setdefault(d, NARROWER)
            for a in store.tree_ancestors(cid):
                if relation.get(a) != EXACT:
                    relation[a] = INHERITED
        except Exception as e:
            logger.debug("Industry scope expansion failed for %s: %s", cid, e)
        relation[cid] = EXACT
    return relation


def allowed_jurisdictions() -> Optional[set[str]]:
    """The jurisdictions planning may use (Settings), or None for all. ``global`` always counts."""
    from app.knowledge.store import normalise_jurisdiction

    raw = str(setting("INDUSTRY_JURISDICTIONS", "") or "")
    wanted = {normalise_jurisdiction(j) for j in raw.replace(";", ",").split(",") if j.strip()}
    return (wanted | {"global"}) if wanted else None


def jurisdiction_ok(item: dict, allowed: Optional[set[str]]) -> bool:
    if allowed is None:
        return True
    value = str(item.get("jurisdiction") or "global")
    # "US-CA" is in scope when "US" is allowed.
    return value in allowed or value.split("-", 1)[0] in allowed


# ── Ranking ────────────────────────────────────────────────────────────────


def _cosine(a: list[float], b: list[float]) -> float:
    if not a or not b or len(a) != len(b):
        return 0.0
    dot = sum(x * y for x, y in zip(a, b))
    na = math.sqrt(sum(x * x for x in a))
    nb = math.sqrt(sum(y * y for y in b))
    return dot / (na * nb) if na and nb else 0.0


def _item_tokens(item: dict) -> set[str]:
    return tokens(" ".join([item.get("title", ""), item.get("body", ""),
                            " ".join(item.get("tags") or [])]), GOAL_STOPWORDS)


#: A narrower item is kept only with at least this much evidence it is about the request.
_NARROWER_MIN_OVERLAP = 2
_NARROWER_MIN_COSINE = 0.55


def select(goal: str, *, concept_ids: Iterable[str] = (), items: Optional[list[dict]] = None,
           query_vector: Optional[list[float]] = None, process_text: str = "",
           process_vector: Optional[list[float]] = None, limit: Optional[int] = None,
           narrower: Optional[bool] = None) -> list[dict]:
    """Rank the industry knowledge for a run. Each result carries ``score`` and ``relation``.

    Without any domain in scope the run gets nothing: industry facts from an
    industry the request is not about are noise, not grounding.
    """
    from app.knowledge import store as knowledge_store

    narrower = bool(setting("INDUSTRY_INCLUDE_NARROWER", True)) if narrower is None else narrower
    relation = scope(concept_ids, narrower=narrower)
    if not relation:
        return []
    if items is None:
        items = knowledge_store.list_items(kind="reference", status="active",
                                           embedding=query_vector is not None)
    allowed = allowed_jurisdictions()
    goal_tokens = tokens(goal, GOAL_STOPWORDS)
    process_tokens = tokens(process_text, GOAL_STOPWORDS) - goal_tokens if process_text else set()
    depth: dict[str, int] = {}

    def depth_of(cid: str) -> int:
        if cid not in depth:
            from app.catalog import store

            try:
                depth[cid] = len(store.tree_path(cid))
            except Exception:
                depth[cid] = 1
        return depth[cid]

    scored: list[tuple[float, dict]] = []
    for item in items:
        cid = item.get("concept_id")
        rel = relation.get(cid or "")
        if not rel or not jurisdiction_ok(item, allowed):
            continue
        text_tokens = _item_tokens(item)
        overlap = len(goal_tokens & text_tokens)
        vector = item.get("embedding") or None
        goal_cos = max(0.0, _cosine(query_vector, vector)) if query_vector is not None and vector else 0.0
        if rel == NARROWER and overlap < _NARROWER_MIN_OVERLAP and goal_cos < _NARROWER_MIN_COSINE:
            continue
        score = FORCE_WEIGHT.get(item.get("strength") or "may", 0.5)
        score += CATEGORY_WEIGHT.get(item.get("category") or "", 0.0)
        score += overlap * 1.0 + 6.0 * goal_cos
        score += {EXACT: 3.0, INHERITED: 0.5 * depth_of(cid), NARROWER: -1.0}[rel]
        if process_tokens:
            score += 0.4 * min(len(process_tokens & text_tokens), 6)
        if process_vector is not None and vector:
            score += 3.0 * max(0.0, _cosine(process_vector, vector))
        out = {k: v for k, v in item.items() if k != "embedding"}
        out["score"] = round(score, 3)
        out["relation"] = rel
        scored.append((score, out))

    scored.sort(key=lambda pair: (-pair[0], pair[1]["id"]))
    size = int(limit if limit is not None else setting("INDUSTRY_PACK_SIZE", 20))
    return [entry for _, entry in scored[: max(1, size)]]


# ── Pack and views ─────────────────────────────────────────────────────────


def ref(item: dict) -> str:
    return f"industry:{item['id']}"


def views_for(item: dict) -> tuple[str, ...]:
    return tuple(item.get("layers") or ()) or CATEGORY_VIEWS.get(item.get("category") or "", ("design",))


def build_pack(items: list[dict], *, domains: Iterable[str] = (), mode: str = "auto",
               message: str = "") -> dict:
    """The run's industry knowledge, indexed for the layers that read it."""
    cache: dict[str, str] = {}
    shaped = []
    for item in items:
        shaped.append({**item, "path": path_label(item.get("concept_id"), cache),
                       "level": level_name(item.get("concept_id"))})
    views: dict[str, list[int]] = {}
    for item in shaped:
        for view in views_for(item):
            views.setdefault(view, []).append(item["id"])
    domain_list = list(domains)
    return {
        "enabled": True,
        "mode": mode,
        "message": message,
        "domains": [{"id": d, "path": path_label(d, cache)} for d in domain_list],
        "items": shaped,
        "refs": {ref(i): {"id": i["id"], "title": i["title"], "category": i.get("category"),
                          "strength": i.get("strength"), "concept_id": i.get("concept_id"),
                          "source_id": i.get("source_id")} for i in shaped},
        "views": views,
    }


def _focus_rank(items: list[dict], focus: str) -> list[dict]:
    """Re-order for one part of the plan (a workflow agent, an activity): its words count too."""
    focus_tokens = tokens(focus or "", GOAL_STOPWORDS)
    if not focus_tokens:
        return list(items)
    return sorted(items, key=lambda i: (-(float(i.get("score") or 0.0)
                                          + 1.5 * len(focus_tokens & _item_tokens(i))), i["id"]))


def _line(item: dict, body_chars: int) -> str:
    force = FORCE_LABEL.get(item.get("strength") or "may", "INFO")
    meta = [force, CATEGORY_LABEL.get(item.get("category") or "", item.get("category") or "")]
    if item.get("jurisdiction") and item["jurisdiction"] != "global":
        meta.append(item["jurisdiction"])
    if item.get("as_of"):
        meta.append(f"as of {item['as_of']}")
    if item.get("path"):
        meta.append(item["path"])
    body = " ".join((item.get("body") or "").split())
    if len(body) > body_chars:
        body = body[: body_chars - 1] + "…"
    return f"- [{ref(item)}] {' · '.join(meta)} — {item['title']}: {body}"


def view_items(pack: dict, view: str, *, limit: Optional[int] = None, focus: str = "") -> list[dict]:
    ids = (pack.get("views") or {}).get(view) or []
    if not ids:
        return []
    by_id = {i["id"]: i for i in pack.get("items") or []}
    chosen = _focus_rank([by_id[i] for i in ids if i in by_id], focus)
    size = int(limit if limit is not None else setting("INDUSTRY_VIEW_SIZE", 6))
    return chosen[: max(1, size)]


REFS_INSTRUCTION = (
    'In your JSON answer add "industry_refs": [{"ref": "industry:N", "how": "<one sentence: what '
    'you did because of it>"}] — only items that actually changed your decision; [] if none.'
)


def render(pack: dict, view: str, *, limit: Optional[int] = None, focus: str = "",
           refs: bool = True) -> str:
    """The industry-knowledge block for one planning decision; "" when it has none."""
    chosen = view_items(pack, view, limit=limit, focus=focus)
    if not chosen:
        return ""
    body_chars = max(200, int(setting("INDUSTRY_BODY_CHARS", 700)))
    where = "; ".join(d["path"] for d in pack.get("domains") or [] if d.get("path"))
    lines = [
        "── INDUSTRY KNOWLEDGE" + (f": {where}" if where else "") + " ──",
        "Reviewed facts about the industry this request belongs to. MANDATORY and PROHIBITED items are "
        "obligations: the plan must meet them — as a step, a control, a rule, a check or an "
        "instruction. RECOMMENDED items are the industry's normal practice; follow them unless the "
        "request says otherwise. The user's request and the process knowledge win on any conflict "
        "about this build; an obligation is never dropped silently. Ids in [brackets] are reference ids.",
    ]
    lines += [_line(i, body_chars) for i in chosen]
    if refs:
        lines += ["", REFS_INSTRUCTION]
    return "\n".join(lines)


# ── Code generation ────────────────────────────────────────────────────────


def code_items(pack: Optional[dict], text: str, *, limit: Optional[int] = None) -> list[dict]:
    """The items a tool or activity's code should follow, compact, best first.

    Ranked for the code's own purpose (``text``); definitions only when they
    share words with it, since a glossary entry rarely changes code.
    """
    if not pack:
        return []
    candidates = view_items(pack, "code", limit=200, focus=text)
    focus_tokens = tokens(text or "", GOAL_STOPWORDS)
    out = []
    for item in candidates:
        if item.get("category") == "definition" and not (focus_tokens & _item_tokens(item)):
            continue
        out.append(item)
    size = int(limit if limit is not None else setting("INDUSTRY_CODE_ITEMS", 6))
    body_chars = max(200, int(setting("INDUSTRY_BODY_CHARS", 700)))
    return [{
        "ref": ref(i), "title": i["title"], "category": i.get("category"),
        "force": FORCE_LABEL.get(i.get("strength") or "may", "INFO"),
        "jurisdiction": i.get("jurisdiction") or "global", "as_of": i.get("as_of"),
        "path": i.get("path") or "",
        "body": " ".join((i.get("body") or "").split())[:body_chars],
    } for i in out[: max(0, size)]]


def render_for_code(items: list[dict], *, refs: bool = True) -> str:
    """The specification author's block: rules, formulas and formats the code must follow."""
    if not items:
        return ""
    lines = ["## Industry knowledge the code must follow",
             "Reviewed facts about this industry. Apply them in the logic: use the formulas and "
             "definitions for computed values, enforce MANDATORY rules and thresholds as checks "
             "(with a clear error or flag, not a silent pass), use the standards for field formats "
             "and codes, and add worked examples that exercise them. Never hard-code a value an "
             "input should provide."]
    for i in items:
        meta = [i["force"], CATEGORY_LABEL.get(i.get("category") or "", i.get("category") or "")]
        if i.get("jurisdiction") and i["jurisdiction"] != "global":
            meta.append(i["jurisdiction"])
        if i.get("as_of"):
            meta.append(f"as of {i['as_of']}")
        lines.append(f"- [{i['ref']}] {' · '.join(meta)} — {i['title']}: {i['body']}")
    if refs:
        lines += ["", 'Also return "industry_refs": the [industry:N] refs the specification applies '
                      '(empty if none).']
    return "\n".join(lines)


def summary_line(pack: Optional[dict]) -> str:
    if not pack or not pack.get("items"):
        return (pack or {}).get("message") or "No industry knowledge in scope."
    items = pack["items"]
    mandatory = sum(1 for i in items if i.get("strength") in ("must", "avoid"))
    where = ", ".join(d["path"] for d in pack.get("domains") or [] if d.get("path"))
    return (f"{len(items)} industry item(s)" + (f" for {where}" if where else "")
            + f" ({mandatory} mandatory).")


def to_event(pack: Optional[dict], *, mode: str, message: str = "") -> dict:
    """The ``industry_knowledge`` SSE payload."""
    if not pack:
        return {"enabled": mode != "off", "mode": mode, "items": [], "domains": [],
                "message": message or ("Off." if mode == "off" else "No industry knowledge in scope.")}
    return {
        "enabled": True, "mode": pack["mode"], "message": summary_line(pack),
        "domains": pack.get("domains") or [],
        "items": [{"id": i["id"], "title": i["title"], "category": i.get("category"),
                   "strength": i.get("strength"), "jurisdiction": i.get("jurisdiction"),
                   "concept_id": i.get("concept_id"), "path": i.get("path"),
                   "relation": i.get("relation"), "score": i.get("score")} for i in pack["items"]],
    }


# ── Resolution ─────────────────────────────────────────────────────────────


async def resolve(client: Any, *, goal: str, concept_ids: Iterable[str],
                  process: Optional[dict] = None, mode: Optional[str] = None) -> Optional[dict]:
    """The run's pack, or None. Never raises: industry knowledge improves a plan, it never stops one."""
    import asyncio

    from app.knowledge import store as knowledge_store

    mode = str(mode or setting("INDUSTRY_KNOWLEDGE_MODE", "auto") or "auto").lower()
    if mode == "off":
        return None
    domains = run_domains(concept_ids)
    if not domains:
        return None
    try:
        if not await asyncio.to_thread(knowledge_store.has_active_industry):
            return None
        candidates = await asyncio.to_thread(knowledge_store.list_items, kind="reference",
                                             status="active", embedding=True)
        if not candidates:
            return None
        process_text = ""
        if process:
            from app.process import context as pk_context

            process_text = pk_context.query_text(process)
        query_vector = process_vector = None
        if any(c.get("embedding") for c in candidates):
            from app.knowledge import embed

            query_vector = await embed.embed_query(client, goal)
            if query_vector is not None and process_text:
                process_vector = await embed.embed_query(client, process_text)
        if query_vector is None:
            for c in candidates:
                c.pop("embedding", None)
        ranked = await asyncio.to_thread(
            select, goal, concept_ids=domains, items=candidates, query_vector=query_vector,
            process_text=process_text, process_vector=process_vector)
    except Exception as e:
        logger.warning("Industry knowledge resolution failed: %s", e, exc_info=True)
        return None
    if not ranked:
        return None
    return build_pack(ranked, domains=domains, mode=mode)
