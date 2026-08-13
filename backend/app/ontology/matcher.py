"""
Goal → concept matching.

Turns a free-text goal ("assess a residential mortgage application") into the
set of concept ids a planning request should be scoped to.

Deliberately lexical, not embedding-based. The vocabulary is small and its
labels and synonyms were written to be matched, so token overlap does the job
without a model call on the planning hot path. If this under-retrieves once the
vocabulary grows, that is the point to reach for embeddings — measured, not
pre-emptively.

Scoping never returns nothing. A goal that matches no domain falls back to the
full inventory rather than an empty candidate set: showing the planner too much
degrades quality, showing it nothing breaks the request outright.
"""

import logging
import re
from typing import Iterable

from app.ontology import store
from app.ontology.vocab import Scheme

logger = logging.getLogger(__name__)

_WORD = re.compile(r"[a-z0-9]+")

# Words that carry no discriminating signal in a workflow goal. Without this,
# "process" and "data" match half the vocabulary.
_STOPWORDS = frozenset(
    """
    a an the and or of for to in on with from by at is are be that this it as
    will can should must workflow agent step process run create build make
    handle system data new use using get set
    """.split()
)


def _tokens(text: str) -> set[str]:
    return {w for w in _WORD.findall((text or "").lower()) if w not in _STOPWORDS and len(w) > 2}


def _phrases(concept: dict) -> list[str]:
    """Everything about a concept worth matching against.

    A synonym beginning with ``!`` replaces the default phrase set instead of
    adding to it. That escape exists for concepts whose label is an ordinary
    English word — "Content" matched 21 of 40 agents purely because agent
    instructions routinely say "return the content", which is noise, not a
    domain signal.
    """
    synonyms = concept.get("synonyms") or []
    overrides = [s[1:].strip() for s in synonyms if s.startswith("!")]
    if overrides:
        return overrides

    out = [concept["label"], *synonyms]
    # The leaf of the dotted id is often the most precise term ("mortgage").
    out.append(concept["id"].rsplit(".", 1)[-1].replace("_", " "))
    return out


def score_concepts(goal: str, scheme_id: str) -> list[tuple[str, float]]:
    """Score every concept in a scheme against the goal, best first."""
    goal_tokens = _tokens(goal)
    if not goal_tokens:
        return []

    scored: list[tuple[str, float]] = []
    for concept in store.list_concepts(scheme_id):
        best = 0.0
        hits = 0
        for phrase in _phrases(concept):
            phrase_tokens = _tokens(phrase)
            if not phrase_tokens:
                continue

            # A multi-word phrase only counts when every word is present. A
            # partial hit is a different phrase, not a weak version of this one:
            # "car loan" shares "loan" with the mortgage synonym "home loan",
            # and treating that as evidence pulled mortgage agents into vehicle
            # finance requests.
            if not phrase_tokens.issubset(goal_tokens):
                continue

            hits += 1
            # Longer exact phrases are stronger evidence than a bare keyword.
            best = max(best, 1.0 + 0.3 * (len(phrase_tokens) - 1))

        if best > 0:
            # Several distinct terms pointing at the same concept is stronger
            # evidence than one. Without this, ties were everywhere — almost
            # every match scores exactly 1.0 — and the sort fell through to the
            # concept id, so "assess a residential mortgage application" scoped
            # to *education admissions* purely because "admissions" sorts
            # before "mortgage" and both matched one word.
            scored.append((concept["id"], best + 0.1 * (hits - 1)))

    scored.sort(key=lambda pair: (-pair[1], pair[0]))
    return scored


def match_domains(goal: str, threshold: float = 1.0, limit: int = 3) -> list[str]:
    """The domain concepts a goal is about. Empty when nothing matches well."""
    scored = score_concepts(goal, Scheme.DOMAIN.value)
    return [cid for cid, score in scored[:limit] if score >= threshold]


def scope_for_goal(goal: str) -> dict:
    """Work out which concepts a planning request should be narrowed to.

    Returns ``{"domains": [...], "concepts": {...}, "scoped": bool}``.
    ``scoped`` is False when the goal matched nothing — callers must then fall
    back to the unfiltered inventory.
    """
    if not store.is_seeded():
        return {"domains": [], "concepts": set(), "scoped": False}

    domains = match_domains(goal)
    if not domains:
        logger.info("Ontology: no domain matched goal, planning unscoped")
        return {"domains": [], "concepts": set(), "scoped": False}

    # Include descendants so matching "lending" also admits mortgage agents.
    concepts = store.expand(domains)
    logger.info(
        "Ontology: goal scoped to %s (%d concepts in subtree)", domains, len(concepts)
    )
    return {"domains": domains, "concepts": concepts, "scoped": True}


def describe_scope(scope: dict) -> str:
    """One human-readable line about how a request was narrowed."""
    if not scope.get("scoped"):
        return "unscoped (no domain matched)"
    labels = []
    for cid in scope["domains"]:
        concept = store.get_concept(cid)
        labels.append(concept["label"] if concept else cid)
    return ", ".join(labels)


def filter_subjects(
    subject_type: str,
    subject_ids: Iterable[str],
    scope: dict,
    predicate: str,
    always_include: Iterable[str] = (),
) -> set[str]:
    """Narrow a set of resources to those annotated within ``scope``.

    Anything unannotated is kept. Dropping untagged resources would make a
    half-finished backfill look like a broken planner, and the failure would be
    silent — the planner would simply stop proposing agents that exist.
    """
    ids = {s for s in subject_ids if s}
    keep = set(always_include) & ids

    if not scope.get("scoped"):
        return ids

    annotated = store.annotations_for_many(subject_type, ids)
    in_scope = store.subjects_with(subject_type, predicate, scope["concepts"])

    for subject_id in ids:
        if subject_id in keep:
            continue
        tagged = annotated.get(subject_id, {}).get(predicate)
        if not tagged:
            keep.add(subject_id)      # untagged → keep, see docstring
        elif subject_id in in_scope:
            keep.add(subject_id)

    return keep
