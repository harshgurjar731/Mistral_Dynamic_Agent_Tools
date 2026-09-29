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

import json
import logging
import re
from typing import Iterable, Optional

from app.database import SessionLocal
from app.ontology import store
from app.ontology.models import KnowledgeEntry
from app.ontology.vocab import Scheme

logger = logging.getLogger(__name__)

KINDS = (
    "definition", "regulation", "process", "metric",
    "risk", "best_practice", "glossary",
)

_WORD = re.compile(r"[a-z0-9]+")

# Words that match everything and discriminate nothing. Shorter than the goal
# matcher's list: a knowledge query is a question, not a workflow goal, so
# "process" and "data" are legitimate search terms here.
_STOPWORDS = frozenset(
    """
    a an the and or of for to in on with from by at is are be that this it as
    what how why when which who does do can should must please tell me about
    """.split()
)


def _tokens(text: str) -> set[str]:
    return {w for w in _WORD.findall((text or "").lower()) if w not in _STOPWORDS and len(w) > 2}


def _loads(raw: Optional[str]) -> list[str]:
    if not raw:
        return []
    try:
        value = json.loads(raw)
        return [str(v) for v in value] if isinstance(value, list) else []
    except Exception:
        return []


def _to_dict(entry: KnowledgeEntry) -> dict:
    return {
        "id": entry.id,
        "concept_id": entry.concept_id,
        "kind": entry.kind,
        "title": entry.title,
        "body": entry.body,
        "tags": _loads(entry.tags),
        "as_of": entry.as_of,
        "source": entry.source,
    }


def ensure_schema() -> None:
    """Add columns this module expects but an older table lacks.

    ``create_all()`` creates missing *tables*, never missing *columns*, and this
    project has no migration tool — so a field added after the table first
    existed has to be introduced explicitly or every read of it fails with
    "no such column". Additive and idempotent, so it is safe on every boot.
    """
    if SessionLocal is None:
        return
    from sqlalchemy import text

    db = SessionLocal()
    try:
        existing = {
            row[1] for row in db.execute(text("PRAGMA table_info(industry_knowledge)"))
        }
        if not existing:
            return  # table not created yet; create_all will do it correctly
        if "as_of" not in existing:
            db.execute(text("ALTER TABLE industry_knowledge ADD COLUMN as_of VARCHAR"))
            db.commit()
            logger.info("industry_knowledge: added as_of column")
    except Exception as e:
        logger.warning("Could not migrate industry_knowledge schema: %s", e)
    finally:
        db.close()


# ── CRUD ───────────────────────────────────────────────────────────────────


def list_entries(
    concept_id: Optional[str] = None,
    kind: Optional[str] = None,
    limit: int = 500,
) -> list[dict]:
    if SessionLocal is None:
        return []
    db = SessionLocal()
    try:
        query = db.query(KnowledgeEntry)
        if concept_id:
            query = query.filter(KnowledgeEntry.concept_id == concept_id)
        if kind:
            query = query.filter(KnowledgeEntry.kind == kind)
        rows = query.order_by(KnowledgeEntry.concept_id, KnowledgeEntry.title).limit(limit).all()
        return [_to_dict(r) for r in rows]
    finally:
        db.close()


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
    if SessionLocal is None:
        raise RuntimeError("The knowledge database is unavailable.")
    if not concept_id or not title.strip() or not body.strip():
        raise ValueError("concept_id, title and body are all required.")
    if not store.get_concept(concept_id):
        raise ValueError(f"Concept '{concept_id}' does not exist.")

    db = SessionLocal()
    try:
        entry = (
            db.query(KnowledgeEntry)
            .filter(KnowledgeEntry.concept_id == concept_id, KnowledgeEntry.title == title)
            .first()
        )
        if entry:
            entry.body = body
            entry.kind = kind
            entry.tags = json.dumps(list(tags or []))
            entry.source = source
            entry.as_of = as_of
        else:
            entry = KnowledgeEntry(
                concept_id=concept_id, title=title, body=body, kind=kind,
                tags=json.dumps(list(tags or [])), source=source, as_of=as_of,
            )
            db.add(entry)
        db.commit()
        db.refresh(entry)
        return _to_dict(entry)
    finally:
        db.close()


def delete_entry(entry_id: int) -> bool:
    if SessionLocal is None:
        return False
    db = SessionLocal()
    try:
        entry = db.query(KnowledgeEntry).filter(KnowledgeEntry.id == entry_id).first()
        if not entry:
            return False
        db.delete(entry)
        db.commit()
        return True
    finally:
        db.close()


def counts() -> dict:
    if SessionLocal is None:
        return {"entries": 0, "concepts": 0}
    db = SessionLocal()
    try:
        rows = db.query(KnowledgeEntry.concept_id).all()
        return {"entries": len(rows), "concepts": len({r[0] for r in rows})}
    finally:
        db.close()


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
    from app.ontology.vocab import SYSTEM_DOMAIN, Predicate, SubjectType

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
