"""
One tool for what an agent knows that is not the document text itself.

Before this, an agent could carry three retrieval tools — ``document_library``,
``query_industry_knowledge`` and ``query_knowledge_graph`` — and had to choose
between them on every question. That is a tool-selection problem the model
solves badly and pays for either way.

Two tools, split on a line a model can actually apply:

* ``document_library`` — **what a passage says**. Verbatim wording, quotations,
  the text of a specific clause.
* ``search_domain_knowledge`` — **how things connect**. This one. Entities and
  their relations, from the graph built out of those same documents, scoped by
  the agent's libraries.

Curated industry knowledge is no longer searched here. It is read while the
agent or workflow is planned — by the industry-knowledge layer, next to process
knowledge — and by tool and activity code generation, so its regulations,
rules and metrics are built into the design instead of looked up on every
turn (``app.knowledge.industry``). The tool keeps its name, so agents created
with it keep working; the ``domains`` argument is accepted and ignored.
"""

from __future__ import annotations

import logging
from typing import Iterable, Optional

from app.rag import retrieval

logger = logging.getLogger(__name__)


async def search(
    client,
    query: str,
    *,
    library_ids: Optional[Iterable[str]] = None,
    domains: Optional[Iterable[str]] = None,  # noqa: ARG001 — kept for callers; unused
    hops: int = 2,
    limit: int = 12,
    optimize: bool = True,
) -> dict:
    """Search the document graph of these libraries.

    ``knowledge`` stays in the result, always empty, so callers that read it
    keep working; industry knowledge is used in planning, not here.
    """
    libraries = [lid for lid in (library_ids or []) if lid]

    if not libraries:
        graph_result = {"available": False, "reason": "this agent has no document library"}
    else:
        try:
            graph_result = await retrieval.retrieve(
                client, query, library_ids=libraries,
                hops=hops, limit=limit, optimize=optimize,
            )
        except Exception as e:
            logger.warning("Graph retrieval failed: %s", e)
            graph_result = {"available": False, "reason": str(e)[:200]}

    return {
        "query": query,
        "graph": graph_result,
        "knowledge": {"available": False, "entries": [],
                      "reason": "Industry knowledge is used while planning, not at run time."},
        "libraries": libraries,
        "domains": [],
        "found": bool(graph_result.get("entities") or graph_result.get("relations")),
    }


# ── Rendering ──────────────────────────────────────────────────────────────

#: The contract the graph's results are read under.
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
   document filename.
3. Anything you state that is NOT below — a figure, rate, threshold, date or
   named regulation — is UNSOURCED. Write "(unverified)" immediately after it,
   every time. This is not optional.
4. A relation is a summary, not a quotation. Do not elaborate one beyond what
   its evidence sentence supports.
5. If the material does not answer the question, say so and say what it does
   cover. Do not fill the gap.

──────────────────────────── SOURCED MATERIAL ────────────────────────────
"""


def render(result: dict, *, scope_note: str = "") -> str:
    """Format the graph's results for a model to read back, under one contract."""
    graph = result.get("graph") or {}
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

    if not blocks:
        return (
            "Nothing matched that query in this agent's documents.\n\n"
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


def has_coverage(library_ids: Iterable[str], domains: Iterable[str] = ()) -> bool:  # noqa: ARG001
    """Whether this tool would return anything for an agent: a graphed library."""
    from app.rag import graph_store

    libraries = [lid for lid in (library_ids or []) if lid]
    try:
        return bool(libraries) and graph_store.has_coverage(libraries)
    except Exception:
        return False
