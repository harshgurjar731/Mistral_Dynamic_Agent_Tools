"""
Industry knowledge — retrieval over the domain tree.

The ontology already knows *which* industry a resource belongs to. This adds
what that industry actually involves, filed against the same concepts, so an
agent annotated ``domain.lending.mortgage`` can pull mortgage regulation, LTV
metrics and the usual failure modes without any of that being hard-coded into
its instructions.

Two properties make it worth having rather than stuffing the same text into
every agent prompt:

* **It is shared.** One entry about affordability rules serves every lending
  agent, and correcting it once corrects all of them.
* **It follows the hierarchy.** Knowledge on ``domain.lending`` is visible to a
  mortgage agent, and knowledge on ``domain.bfsi`` to both. Nothing has to be
  duplicated down the tree, and a general fact never has to be repeated per
  product.

Retrieval is lexical for the same reason the goal matcher is: the corpus is
small, the text was written to be matched, and a model call on the tool path
would double the latency of every agent turn that uses it.
"""

from __future__ import annotations

import logging
from typing import Iterable, Optional

from app.catalog import store
from app.catalog.match import QUESTION_STOPWORDS, tokens
from app.catalog.vocab import Scheme
from app.database import SessionLocal  # noqa: F401  (kept: tests patch it on this module)
from app.knowledge import store as knowledge_store

logger = logging.getLogger(__name__)

KINDS = (
    "definition", "regulation", "process", "metric",
    "risk", "best_practice", "glossary",
)


def _tokens(text: str) -> set[str]:
    return tokens(text, QUESTION_STOPWORDS)


def _to_dict(item: dict) -> dict:
    """A knowledge item in the shape this module has always returned.

    ``kind`` here is the item's category (regulation, metric, …) — what the
    routes, the runtime tool and the prompt renderer have always called kind.
    """
    return {
        "id": item["id"],
        "concept_id": item["concept_id"],
        "kind": item["category"],
        "title": item["title"],
        "body": item["body"],
        "tags": item["tags"],
        "as_of": item["as_of"],
        "source": item["origin"],
    }


def ensure_schema() -> None:
    """Additive migrations — see ``app.knowledge.store.ensure_schema``."""
    knowledge_store.ensure_schema()


# ── CRUD ───────────────────────────────────────────────────────────────────
#
# Reference knowledge is every active item a built agent may read at run time:
# kind ``reference``, plus guidance whose audience includes the runtime (the
# old ``best_practice`` entries, which agents always searched).

_RUNTIME_AUDIENCES = ("runtime", "both")


def list_entries(
    concept_id: Optional[str] = None,
    kind: Optional[str] = None,
    limit: int = 500,
) -> list[dict]:
    items = knowledge_store.list_items(
        concept_id=concept_id, category=kind, status="active",
        audiences=_RUNTIME_AUDIENCES, limit=limit,
    )
    return [_to_dict(i) for i in items]


def upsert_entry(
    concept_id: str,
    title: str,
    body: str,
    kind: str = "definition",
    tags: Optional[Iterable[str]] = None,
    source: str = "user",
    as_of: Optional[str] = None,
) -> dict:
    """Create or update one entry, keyed on (concept, title)."""
    if not concept_id or not title.strip() or not body.strip():
        raise ValueError("concept_id, title and body are all required.")
    if not store.get_concept(concept_id):
        raise ValueError(f"Concept '{concept_id}' does not exist.")
    guidance = kind == "best_practice"
    try:
        item = knowledge_store.upsert_item({
            "kind": "guidance" if guidance else "reference",
            "category": kind if kind in KINDS else "definition",
            "concept_id": concept_id, "title": title.strip(), "body": body.strip(),
            "tags": list(tags or []), "audience": "both" if guidance else "runtime",
            "origin": source, "as_of": as_of, "status": "active",
        }, key=("concept_id", "title"))
    except knowledge_store.KnowledgeError as e:
        raise ValueError(str(e)) from e
    return _to_dict(item)


def delete_entry(entry_id: int) -> bool:
    return knowledge_store.delete_item(entry_id)


def counts() -> dict:
    rows = list_entries(limit=100000)
    return {"entries": len(rows), "concepts": len({r["concept_id"] for r in rows})}


# ── Retrieval ──────────────────────────────────────────────────────────────


def _scope_concepts(domains: Optional[Iterable[str]]) -> Optional[set[str]]:
    """Which concepts a search may draw from.

    Expands both ways deliberately. Downward so a query scoped to *lending*
    finds mortgage specifics; upward so a mortgage agent still gets the general
    lending and BFSI knowledge above it — which is where most regulation lives,
    and duplicating it onto every leaf is exactly what this avoids.
    """
    ids = [d for d in (domains or []) if d]
    if not ids:
        return None

    scope: set[str] = set()
    for concept_id in ids:
        scope |= store.descendants(concept_id)
        scope |= store.ancestors(concept_id, include_self=True)
    return scope


def search(
    query: str,
    domains: Optional[Iterable[str]] = None,
    kind: Optional[str] = None,
    limit: int = 5,
) -> list[dict]:
    """Knowledge relevant to ``query``, optionally narrowed to a domain subtree.

    Scoring is token overlap against title, tags and body, weighted so a hit in
    the title counts for more than one buried in a paragraph. Entries filed
    closer to the requested domain rank above general ones, which is what stops
    a broad BFSI note outranking the mortgage-specific answer.
    """
    entries = list_entries(limit=5000)
    if not entries:
        return []

    scope = _scope_concepts(domains)
    query_tokens = _tokens(query)

    # Depth is the specificity signal: a subdomain entry beats an industry one
    # when both match equally well.
    depth_of = {
        concept["id"]: concept.get("level", 0)
        for concept in store.list_concepts(Scheme.DOMAIN.value)
    }
    requested = {d for d in (domains or []) if d}

    scored: list[tuple[float, dict]] = []
    for entry in entries:
        if kind and entry["kind"] != kind:
            continue
        if scope is not None and entry["concept_id"] not in scope:
            continue

        score = 0.0
        if query_tokens:
            title_hits = len(query_tokens & _tokens(entry["title"]))
            tag_hits = len(query_tokens & _tokens(" ".join(entry["tags"])))
            body_hits = len(query_tokens & _tokens(entry["body"]))
            score = title_hits * 3.0 + tag_hits * 2.0 + body_hits * 1.0
            if score == 0:
                continue
        else:
            # No query terms: the domain scope is the whole request, so return
            # the most specific entries rather than nothing.
            score = 0.5

        # Exactly the requested concept outranks an inherited ancestor.
        if entry["concept_id"] in requested:
            score += 4.0
        score += depth_of.get(entry["concept_id"], 0) * 0.75

        scored.append((score, entry))

    scored.sort(key=lambda pair: (-pair[0], pair[1]["title"]))
    return [
        {**entry, "score": round(score, 2)}
        for score, entry in scored[: max(1, limit)]
    ]


def has_coverage(domains: Optional[Iterable[str]]) -> bool:
    """Whether these domains can reach any knowledge at all.

    Uses the same both-ways expansion retrieval does, so this answers the
    question that actually matters: would a lookup return anything. An agent in
    a domain with nothing beneath or above it gains only a wasted tool round
    trip from carrying the knowledge tool.
    """
    scope = _scope_concepts(domains)
    if scope is None:
        # No domains at all — the tool would search everything, so coverage
        # depends only on the corpus being non-empty.
        return counts()["entries"] > 0
    return any(entry["concept_id"] in scope for entry in list_entries(limit=5000))


def agent_has_coverage(agent_id: str) -> bool:
    """Whether attaching the knowledge tool to this agent would pay for itself.

    Deliberately False for an agent with no domain. Those are almost always
    foundation-tier gates — moderators, guardrails, routers — which are
    domain-agnostic by design, and an unscoped search across every industry is
    noise to them rather than grounding.
    """
    domains = domains_for_agent(agent_id)
    return bool(domains) and has_coverage(domains)


def domains_for_agent(agent_id: str) -> list[str]:
    """The domains an agent is annotated against, for automatic scoping.

    ``domain.system`` is stripped. It is where foundation agents are filed in
    the tree, but it is a classification node, not a body of knowledge: there
    are no industry facts under it and there never will be. Returning it would
    scope a knowledge search to an empty subtree, which reads as "searched and
    found nothing" rather than "has no knowledge domain" — and would flip
    `agent_has_coverage` to True for exactly the guardrails it is meant to
    exclude.
    """
    from app.catalog.vocab import SYSTEM_DOMAIN, Predicate, SubjectType

    if not agent_id:
        return []
    try:
        annotations = store.annotations_for(SubjectType.AGENT.value, agent_id)
        domains = annotations.get(Predicate.SERVES_DOMAIN.value, []) or []
        return [d for d in domains if d != SYSTEM_DOMAIN]
    except Exception as e:
        logger.debug("Could not read domains for agent %s: %s", agent_id, e)
        return []


#: Prepended to every retrieval, and short and imperative on purpose.
#:
#: This exists because of an observed failure, not a theoretical one. Asked
#: about mortgage stress testing, an agent returned the retrieved "+1-3% above
#: pay rate" *and* a confident, invented "BoE base rate is 5.25%, so 8.25%" —
#: in one seamless paragraph, with nothing marking which half was sourced. A
#: tool that makes unsourced claims look sourced is worse than no tool at all
#: where the answer gets recorded.
#:
#: Terseness is deliberate. The first version was four paragraphs explaining
#: the principle and the model skimmed it. Tool results read as *data*, not
#: instruction, so anything long competes with the content it wraps. A literal
#: token to emit works where an explanation did not.
_ATTRIBUTION_CONTRACT = """\
RULES FOR THIS ANSWER — follow exactly:
1. The material below is SOURCED. Prefer it over your own knowledge.
2. Any figure, rate, threshold, date or named regulation you state that is NOT
   in the material below is UNSOURCED. Write "(unverified)" immediately after
   it, every time. This is not optional.
3. If an entry carries an "As of" date, cite that date whenever you use its
   figures. Never present dated material as current.
4. If the material does not answer the question, say so. Do not fill the gap.

──────────────────────── SOURCED MATERIAL ────────────────────────
"""


def render_for_prompt(entries: list[dict]) -> str:
    """Format results for a model to read back.

    Carries three things beyond the text: the concept id, so a wrong answer is
    traceable to a term in the vocabulary and correctable at source; the "as of"
    date, so stale figures cannot pass as current; and the attribution contract
    above, so the model separates what it was handed from what it already
    believed.
    """
    if not entries:
        return (
            "No industry knowledge matched that query.\n\n"
            "Say plainly that no domain-specific source was found, then answer "
            "from general knowledge — and mark every specific figure, threshold "
            "or named regulation you give with \"(unverified)\"."
        )

    blocks = []
    for entry in entries:
        concept = store.get_concept(entry["concept_id"])
        label = concept["label"] if concept else entry["concept_id"]
        dated = f"\n- As of: {entry['as_of']}" if entry.get("as_of") else ""
        blocks.append(
            f"### {entry['title']}\n"
            f"- Domain: {label} ({entry['concept_id']})\n"
            f"- Type: {entry['kind']}{dated}\n\n"
            f"{entry['body']}"
        )
    return _ATTRIBUTION_CONTRACT + "\n" + "\n\n".join(blocks)
