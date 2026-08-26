"""
One tool for everything an agent knows that is not the document text itself.

Before this, an agent could carry three retrieval tools — ``document_library``,
``query_industry_knowledge`` and ``query_knowledge_graph`` — and had to choose
between them on every question. That is a tool-selection problem the model
solves badly and pays for either way: three descriptions competing for
attention, three attribution contracts, and a wrong choice returning nothing
useful while looking like an answer.

Two tools, split on a line a model can actually apply:

* ``document_library`` — **what a passage says**. Verbatim wording, quotations,
  the text of a specific clause.
* ``search_domain_knowledge`` — **what we know**. This one. Entities and how
  they connect, from the graph built out of those same documents, plus the
  curated industry knowledge for the agent's domain.

Both sources are searched together and scoped the same way, so an answer built
from them is about one subject rather than two. The graph narrows by the
agent's libraries; the corpus narrows by the agent's domain annotations; and
after Stage 2 those are the same subject, because a library is annotated to the
domain its agent serves.

They are rendered as separate sections under **one** attribution contract.
Merging their scores into a single ranking was the alternative and it is false
precision: a Lucene score over entity names and a token overlap over
hand-written prose are not comparable numbers, and pretending they are would
bury a directly relevant triple under a vaguely matching paragraph.
"""

from __future__ import annotations

import asyncio
import logging
from typing import Iterable, Optional

from app.rag import retrieval, timeline

logger = logging.getLogger(__name__)


async def search(
    client,
    query: str,
    *,
    library_ids: Optional[Iterable[str]] = None,
    domains: Optional[Iterable[str]] = None,
    hops: int = 2,
    limit: int = 12,
    optimize: bool = True,
) -> dict:
    """Search the document graph and the industry corpus together.

    Both run concurrently: they share nothing, one is a Bolt round trip and the
    other a SQLite scan, and running them in series would add the slower one's
    latency to every RAG turn for no reason.

    Neither failing takes the other down. A graph outage still yields industry
    knowledge; an empty corpus still yields the graph.
    """
    libraries = [lid for lid in (library_ids or []) if lid]
    domain_ids = [d for d in (domains or []) if d]

    async def _graph() -> dict:
        if not libraries:
            return {"available": False, "reason": "this agent has no document library"}
        try:
            return await retrieval.retrieve(
                client, query, library_ids=libraries,
                hops=hops, limit=limit, optimize=optimize,
            )
        except Exception as e:
            logger.warning("Graph retrieval failed: %s", e)
            return {"available": False, "reason": str(e)[:200]}

    async def _corpus() -> dict:
        from app.ontology import knowledge

        try:
            with timeline.stage(
                "industry_knowledge", meta={"domains": domain_ids or "all"}
            ) as st:
                entries = await asyncio.to_thread(
                    knowledge.search, query, domain_ids or None, None, max(3, limit // 2)
                )
                st.set(entries=len(entries))
            return {"available": True, "entries": entries}
        except Exception as e:
            logger.warning("Industry knowledge lookup failed: %s", e)
            return {"available": False, "entries": [], "reason": str(e)[:200]}

    graph_result, corpus_result = await asyncio.gather(_graph(), _corpus())

    return {
        "query": query,
        "graph": graph_result,
        "knowledge": corpus_result,
        "libraries": libraries,
        "domains": domain_ids,
        "found": bool(
            (graph_result.get("entities") or graph_result.get("relations"))
            or corpus_result.get("entries")
        ),
    }


# ── Rendering ──────────────────────────────────────────────────────────────

#: One contract for both sources.
#:
#: Terse for the reason the two it replaces were terse: a tool result reads as
#: *data*, and anything long competes with the content it wraps. The specific
#: failures it guards against were both observed. An agent handed a retrieved
#: "+1-3% above pay rate" invented "BoE base rate is 5.25%, so 8.25%" in the
#: same paragraph with nothing marking which half was sourced. And graph triples
#: compress to something that looks like database rows, which a model will
#: happily elaborate into terms and dates no document contained.
_CONTRACT = """\
RULES FOR THIS ANSWER — follow exactly:
1. Everything below is SOURCED. Prefer it over your own knowledge.
2. Ground your answer in the evidence quotes, and name the source — the
   document filename, or the domain the industry note belongs to.
3. Anything you state that is NOT below — a figure, rate, threshold, date or
   named regulation — is UNSOURCED. Write "(unverified)" immediately after it,
   every time. This is not optional.
4. A relation is a summary, not a quotation. Do not elaborate one beyond what
   its evidence sentence supports.
5. Where an industry note carries an "As of" date, cite that date whenever you
   use its figures. Never present dated material as current.
6. If the material does not answer the question, say so and say what it does
   cover. Do not fill the gap.

──────────────────────────── SOURCED MATERIAL ────────────────────────────
"""


def render(result: dict, *, scope_note: str = "") -> str:
    """Format both sources for a model to read back, under one contract."""
    graph = result.get("graph") or {}
    corpus = result.get("knowledge") or {}
    blocks: list[str] = []

    # ── The document graph ──────────────────────────────────────────────
    entities = graph.get("entities") or []
    relations = graph.get("relations") or []
    passages = graph.get("passages") or []

    if entities:
        lines = [
            "### From your documents — matched entities",
            ", ".join(f"{e['name']} ({e['type']})" for e in entities[:8]),
        ]
        if relations:
            lines.append("\n### From your documents — how they connect")
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
        if passages:
            lines.append("\n### From your documents — the passages these came from")
            for passage in passages[:8]:
                lines.append(
                    f"- **{passage['name']}** — "
                    f"{passage.get('filename') or passage.get('doc_id')}\n"
                    f"  \"{passage.get('quote')}\""
                )
        blocks.append("\n".join(lines))
    elif graph.get("available") is False and graph.get("reason"):
        blocks.append(
            f"### From your documents\nUnavailable ({graph['reason']}). "
            "Try the document library tool for the wording of a passage."
        )

    # ── The industry corpus ─────────────────────────────────────────────
    entries = corpus.get("entries") or []
    if entries:
        from app.ontology import store as ontology_store

        lines = ["### Industry knowledge"]
        for entry in entries:
            concept = ontology_store.get_concept(entry["concept_id"])
            label = concept["label"] if concept else entry["concept_id"]
            dated = f" · As of {entry['as_of']}" if entry.get("as_of") else ""
            lines.append(
                f"\n**{entry['title']}** — {label} ({entry['kind']}){dated}\n"
                f"{entry['body']}"
            )
        blocks.append("\n".join(lines))

    if not blocks:
        return (
            "Nothing matched that query in this agent's documents or in the "
            "industry knowledge for its domain.\n\n"
            "Say plainly that no sourced material was found, then try the "
            "document library tool for the document text. Mark every specific "
            'figure, date or name you give from your own knowledge with '
            '"(unverified)".'
        )

    header = f"Scope: {scope_note}\n\n" if scope_note else ""
    plan = graph.get("plan") or {}
    if plan.get("rewritten") and plan["rewritten"] != plan.get("query"):
        header += f'Query as optimised: "{plan["rewritten"]}"\n\n'

    return header + _CONTRACT + "\n" + "\n\n".join(blocks)


def has_coverage(library_ids: Iterable[str], domains: Iterable[str]) -> bool:
    """Whether this tool would return anything for an agent.

    A union, unlike the two tools it replaces: one source having material is
    enough to make the tool worth carrying, and an agent with documents but no
    industry knowledge is the common case.
    """
    from app.ontology import knowledge
    from app.rag import graph_store

    libraries = [lid for lid in (library_ids or []) if lid]
    domain_ids = [d for d in (domains or []) if d]

    if libraries and graph_store.has_coverage(libraries):
        return True
    try:
        return bool(domain_ids) and knowledge.has_coverage(domain_ids)
    except Exception:
        return False
