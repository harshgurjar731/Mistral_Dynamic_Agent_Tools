"""
Graph retrieval — match entities, then walk out from them.

    query → optimiser → entity match → traversal → passages → ranked context

The shape is the argument for having a graph at all. Library search answers
"what does the document say about X" by similarity; this answers "what is X
connected to, and how" by structure. A question like "which suppliers does the
agreement bind" is a traversal, and no amount of chunk similarity turns it into
one.

**Everything hangs off a matched entity.** Nothing is retrieved until the query
has been matched to a node, which is why the optimiser's entity hints run first
and why the full-text index is fuzzy. An unmatched query returns nothing and
says so — inventing a starting point would produce a confident tour of an
unrelated part of the graph.

**What comes back is two kinds of thing.** The triples say how entities relate;
the passages are the verbatim sentences those entities were extracted from. A
triple without its sentence is an assertion the reader cannot check, and
checkability is the reason evidence is mandatory at extraction.
"""

from __future__ import annotations

import logging
from typing import Iterable, Optional

from app.rag import graph_store, optimizer, timeline

logger = logging.getLogger(__name__)

#: How much a relation touching a matched entity outranks one found two hops
#: out. Set high: the question was about the seed, and a second-hop fact is
#: context rather than an answer.
_SEED_BONUS = 2.0
_HOP_PENALTY = 0.8


def _seed_key(entity: dict) -> tuple[str, str, str]:
    return (entity.get("library_id"), entity.get("normalized"), entity.get("type"))


def _rank_entities(matches: list[dict], limit: int) -> list[dict]:
    """Best match per entity, highest score first.

    The same entity is matched by several search terms — the rewrite, the
    original and each sub-query — and each returns its own Lucene score.
    Keeping the maximum rather than the sum stops an entity that happens to
    appear in every phrasing from crowding out a better match found once.
    """
    best: dict[tuple, dict] = {}
    for match in matches:
        key = _seed_key(match)
        if not all(key):
            continue
        current = best.get(key)
        if not current or match.get("score", 0) > current.get("score", 0):
            best[key] = match
    ranked = sorted(best.values(), key=lambda m: -(m.get("score") or 0))
    return ranked[:limit]


def _rank_relations(
    relations: list[dict],
    seeds: list[dict],
    limit: int,
) -> list[dict]:
    """Deduplicate triples and order them by how close they are to the question.

    The same triple can be stated by several documents. That is corroboration,
    not duplication, so the sources are merged onto one row rather than
    repeated — a prompt that says the same thing three times has spent its
    budget saying it three times.
    """
    seed_names = {
        (s.get("normalized") or "").lower() for s in seeds
    }

    merged: dict[tuple[str, str, str], dict] = {}
    for relation in relations:
        key = (
            (relation.get("source_normalized") or "").lower(),
            relation.get("predicate") or "",
            (relation.get("target_normalized") or "").lower(),
        )
        confidence = relation.get("confidence") or 0.7
        hops = relation.get("hops") or 1

        touches_seed = key[0] in seed_names or key[2] in seed_names
        score = confidence + (_SEED_BONUS if touches_seed else 0.0) - _HOP_PENALTY * (hops - 1)

        existing = merged.get(key)
        if not existing:
            merged[key] = {
                **relation,
                "score": round(score, 3),
                "sources": [relation.get("filename") or relation.get("doc_id") or "unknown"],
            }
            continue

        source_name = relation.get("filename") or relation.get("doc_id")
        if source_name and source_name not in existing["sources"]:
            existing["sources"].append(source_name)
        if score > existing["score"]:
            existing.update(
                {k: v for k, v in relation.items() if k != "filename"},
                score=round(score, 3),
            )
        # Corroboration is worth something, but not enough to outrank a direct
        # hit — a small bump keeps the ordering stable and still rewards it.
        existing["score"] = round(existing["score"] + 0.1, 3)

    return sorted(merged.values(), key=lambda r: -r["score"])[:limit]


async def retrieve(
    client,
    query: str,
    *,
    library_ids: Optional[Iterable[str]] = None,
    hops: int = 2,
    limit: int = 12,
    entity_limit: int = 8,
    optimize: bool = True,
) -> dict:
    """Run one graph retrieval, start to finish.

    Returns everything each stage produced, not just the final ranking: the
    plan, the matched entities, the triples and the passages. The tool renders
    a subset of it, the debug endpoint shows all of it, and the timeline records
    how long each part took.
    """
    ids = [lid for lid in (library_ids or []) if lid]

    plan = (
        await optimizer.optimize(client, query)
        if optimize
        else optimizer.passthrough(query, "optimisation disabled by caller")
    )

    if not graph_store.available():
        return {
            "plan": plan,
            "entities": [],
            "relations": [],
            "passages": [],
            "available": False,
            "reason": graph_store.status().get("reason") or "the knowledge graph is unavailable",
        }

    with timeline.stage("entity_match", meta={"libraries": ids or "all"}) as st:
        hints = plan.get("entity_hints") or []
        matches: list[dict] = []
        for term in optimizer.search_terms(plan):
            matches.extend(
                graph_store.match_entities(
                    term, library_ids=ids or None, hints=hints, limit=entity_limit
                )
            )
        seeds = _rank_entities(matches, entity_limit)
        st.set(
            candidates=len(matches),
            matched=[e["name"] for e in seeds],
            hints=hints,
        )

    if not seeds:
        return {
            "plan": plan,
            "entities": [],
            "relations": [],
            "passages": [],
            "available": True,
            "reason": "no entity in the graph matched this query",
        }

    seed_keys = [
        {"library_id": s["library_id"], "normalized": s["normalized"], "type": s["type"]}
        for s in seeds
    ]

    with timeline.stage("graph_traverse", meta={"hops": hops, "seeds": len(seed_keys)}) as st:
        raw = graph_store.neighborhood(seed_keys, hops=hops, limit=max(limit * 4, 40))
        relations = _rank_relations(raw, seeds, limit)
        st.set(traversed=len(raw), kept=len(relations))

    with timeline.stage("entity_passages") as st:
        passages = graph_store.entity_context(seed_keys, limit=max(limit, 12))
        st.set(passages=len(passages))

    return {
        "plan": plan,
        "entities": seeds,
        "relations": relations,
        "passages": passages,
        "available": True,
        "reason": "",
    }


# ── Rendering ──────────────────────────────────────────────────────────────

#: Prepended to every graph retrieval, and terse for the same reason the
#: industry-knowledge contract is: a tool result reads as *data*, and anything
#: long competes with the content it wraps.
#:
#: The specific failure it guards against is worse here than for hand-written
#: knowledge. Graph triples are compressed to the point of looking like
#: database rows, and a model handed "Northwind supplies_to Contoso" will
#: happily elaborate it into terms, volumes and dates that no document
#: contained. The evidence line under each triple is what it must quote instead.
_ATTRIBUTION_CONTRACT = """\
RULES FOR THIS ANSWER — follow exactly:
1. The material below came from documents in this agent's libraries. It is
   SOURCED. Prefer it over your own knowledge.
2. Each relation carries the sentence it was extracted from. Ground your answer
   in those sentences, and name the source document when you use one.
3. Anything you add that is NOT below — a figure, a date, a name, a term of an
   agreement — is UNSOURCED. Write "(unverified)" immediately after it, every
   time. This is not optional.
4. A relation is a summary, not a quotation. Do not elaborate one beyond what
   its evidence sentence supports.
5. If the material does not answer the question, say so, and say what it does
   cover. Do not fill the gap.

──────────────────── KNOWLEDGE GRAPH — SOURCED MATERIAL ────────────────────
"""


def render_for_prompt(result: dict, *, scope_note: str = "") -> str:
    """Format a retrieval for a model to read back."""
    if not result.get("available"):
        return (
            "The knowledge graph is unavailable right now "
            f"({result.get('reason') or 'unknown reason'}).\n\n"
            "Use the document library tool instead, and mark every specific "
            'figure, date or name you state with "(unverified)".'
        )

    entities = result.get("entities") or []
    relations = result.get("relations") or []
    passages = result.get("passages") or []

    if not entities:
        return (
            "No entity in the knowledge graph matched that query.\n\n"
            "Say plainly that the graph held nothing on this, then try the "
            "document library tool. Mark every specific figure, date or name "
            'you state from your own knowledge with "(unverified)".'
        )

    blocks: list[str] = []

    matched = ", ".join(f"{e['name']} ({e['type']})" for e in entities[:8])
    blocks.append(f"### Matched entities\n{matched}")

    if relations:
        lines = []
        for relation in relations:
            sources = ", ".join(relation.get("sources") or []) or "unknown source"
            hops = relation.get("hops") or 1
            distance = "" if hops <= 1 else f" [{hops} hops from the match]"
            lines.append(
                f"- **{relation['source_name']}** —{relation['predicate']}→ "
                f"**{relation['target_name']}**{distance}\n"
                f"  - Evidence: \"{relation.get('evidence') or 'none recorded'}\"\n"
                f"  - Source: {sources}"
            )
        blocks.append("### Relations\n" + "\n".join(lines))

    if passages:
        lines = []
        for passage in passages[:10]:
            lines.append(
                f"- **{passage['name']}** — {passage.get('filename') or passage.get('doc_id')}\n"
                f"  \"{passage.get('quote')}\""
            )
        blocks.append("### Passages the entities were extracted from\n" + "\n".join(lines))

    if not relations and not passages:
        blocks.append(
            "### Relations\nThe matched entities have no recorded relations or "
            "passages. Say that the graph knows of them but holds nothing "
            "further, rather than inferring a connection."
        )

    header = f"Scope: {scope_note}\n\n" if scope_note else ""
    plan = result.get("plan") or {}
    if plan.get("rewritten") and plan["rewritten"] != plan.get("query"):
        header += f'Query as optimised: "{plan["rewritten"]}"\n\n'

    return header + _ATTRIBUTION_CONTRACT + "\n" + "\n\n".join(blocks)
