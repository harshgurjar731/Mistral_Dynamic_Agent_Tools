"""
Concept store — reads and writes over the ontology tables.

Every function opens and closes its own session. Callers are request handlers,
pipeline layers and the validator, none of which share a transaction, and the
alternative (threading a session through five pipeline layers) would buy
nothing here.

Reads degrade rather than raise. An unseeded or unreachable store must leave
planning and validation working — the ontology narrows and checks, it is never
the thing that makes a workflow runnable.
"""

import json
import logging
from contextlib import contextmanager
from typing import Iterable

from sqlalchemy import text

from app.database import SessionLocal
from app.ontology.models import Annotation, Concept, ConceptScheme
from app.ontology.vocab import Predicate, Scheme, SubjectType

logger = logging.getLogger(__name__)


@contextmanager
def _session():
    """Yield a session, or None when the database is unavailable."""
    if SessionLocal is None:
        yield None
        return
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def _loads(raw: str | None) -> list[str]:
    if not raw:
        return []
    try:
        value = json.loads(raw)
        return [str(v) for v in value] if isinstance(value, list) else []
    except Exception:
        return []


def _concept_dict(concept: Concept) -> dict:
    return {
        "id": concept.id,
        "scheme_id": concept.scheme_id,
        "parent_id": concept.parent_id,
        "label": concept.label,
        "definition": concept.definition or "",
        "synonyms": _loads(concept.synonyms),
    }


# ── Schemes and concepts ───────────────────────────────────────────────────


def list_schemes() -> list[dict]:
    with _session() as db:
        if db is None:
            return []
        rows = db.query(ConceptScheme).order_by(ConceptScheme.id).all()
        return [
            {"id": r.id, "label": r.label, "description": r.description or ""}
            for r in rows
        ]


def list_concepts(scheme_id: str | None = None) -> list[dict]:
    with _session() as db:
        if db is None:
            return []
        q = db.query(Concept)
        if scheme_id:
            q = q.filter(Concept.scheme_id == scheme_id)
        return [_concept_dict(c) for c in q.order_by(Concept.id).all()]


def get_concept(concept_id: str) -> dict | None:
    with _session() as db:
        if db is None:
            return None
        c = db.query(Concept).filter(Concept.id == concept_id).first()
        return _concept_dict(c) if c else None


def descendants(concept_id: str, include_self: bool = True) -> set[str]:
    """Every concept at or below ``concept_id``.

    A recursive CTE rather than repeated queries, because this runs on the
    planning path where it gates which agents are even considered. Falls back to
    just the concept itself if the driver refuses the CTE, which keeps
    retrieval narrow-but-correct instead of empty.
    """
    with _session() as db:
        if db is None:
            return {concept_id} if include_self else set()
        try:
            rows = db.execute(
                text(
                    """
                    WITH RECURSIVE sub(id) AS (
                        SELECT id FROM ontology_concepts WHERE id = :root
                        UNION ALL
                        SELECT c.id FROM ontology_concepts c
                        JOIN sub ON c.parent_id = sub.id
                    )
                    SELECT id FROM sub
                    """
                ),
                {"root": concept_id},
            ).fetchall()
            found = {r[0] for r in rows}
        except Exception as e:
            logger.warning("Concept descendant walk failed for %s: %s", concept_id, e)
            found = {concept_id}

    if not include_self:
        found.discard(concept_id)
    return found


def ancestors(concept_id: str, include_self: bool = False) -> set[str]:
    """Every concept above ``concept_id``, walking parent links to the root."""
    with _session() as db:
        if db is None:
            return {concept_id} if include_self else set()
        try:
            rows = db.execute(
                text(
                    """
                    WITH RECURSIVE sup(id, parent_id) AS (
                        SELECT id, parent_id FROM ontology_concepts WHERE id = :leaf
                        UNION ALL
                        SELECT c.id, c.parent_id FROM ontology_concepts c
                        JOIN sup ON c.id = sup.parent_id
                    )
                    SELECT id FROM sup
                    """
                ),
                {"leaf": concept_id},
            ).fetchall()
            found = {r[0] for r in rows}
        except Exception as e:
            logger.warning("Concept ancestor walk failed for %s: %s", concept_id, e)
            found = {concept_id}

    if not include_self:
        found.discard(concept_id)
    return found


def expand(concept_ids: Iterable[str]) -> set[str]:
    """Concepts applicable to a goal matched at ``concept_ids``.

    Both directions of the hierarchy, and the distinction matters:

    * **Descendants** — a goal about "lending" is served by an agent tagged
      specifically for mortgages.
    * **Ancestors** — a goal about "mortgages" is equally served by an agent
      tagged for lending generally. Missing this is subtle and expensive: those
      agents simply stop being offered, and nothing reports it.

    Siblings are excluded, which is the entire point — a mortgage request must
    not pull in vehicle finance.
    """
    out: set[str] = set()
    for cid in concept_ids:
        out |= descendants(cid)
        out |= ancestors(cid)
    return out


# ── Annotations ────────────────────────────────────────────────────────────


def annotate(
    subject_type: str,
    subject_id: str,
    predicate: str,
    concept_id: str,
    source: str = "user",
) -> bool:
    """Attach a concept to a resource. Idempotent — re-running is a no-op."""
    if not (subject_id and concept_id):
        return False

    with _session() as db:
        if db is None:
            return False
        exists = (
            db.query(Annotation)
            .filter(
                Annotation.subject_type == subject_type,
                Annotation.subject_id == subject_id,
                Annotation.predicate == predicate,
                Annotation.concept_id == concept_id,
            )
            .first()
        )
        if exists:
            return False
        db.add(
            Annotation(
                subject_type=subject_type,
                subject_id=subject_id,
                predicate=predicate,
                concept_id=concept_id,
                source=source,
            )
        )
        db.commit()
        return True


def set_annotations(
    subject_type: str,
    subject_id: str,
    predicate: str,
    concept_ids: Iterable[str],
    source: str = "user",
) -> None:
    """Replace every annotation for one (subject, predicate) pair.

    Replace rather than merge: the caller is an editor showing the full current
    set, so an omitted concept means "removed", not "unchanged".
    """
    wanted = {c for c in concept_ids if c}

    with _session() as db:
        if db is None:
            return
        db.query(Annotation).filter(
            Annotation.subject_type == subject_type,
            Annotation.subject_id == subject_id,
            Annotation.predicate == predicate,
        ).delete(synchronize_session=False)

        for concept_id in sorted(wanted):
            db.add(
                Annotation(
                    subject_type=subject_type,
                    subject_id=subject_id,
                    predicate=predicate,
                    concept_id=concept_id,
                    source=source,
                )
            )
        db.commit()


def annotations_for(subject_type: str, subject_id: str) -> dict[str, list[str]]:
    """Everything known about one resource, grouped by predicate."""
    with _session() as db:
        if db is None:
            return {}
        rows = (
            db.query(Annotation)
            .filter(
                Annotation.subject_type == subject_type,
                Annotation.subject_id == subject_id,
            )
            .all()
        )

    grouped: dict[str, list[str]] = {}
    for row in rows:
        grouped.setdefault(row.predicate, []).append(row.concept_id)
    return grouped


def annotation_sources(subject_type: str, subject_id: str, predicate: str) -> dict[str, str]:
    """Where each annotation came from: ``user``, ``seed`` or ``inferred``.

    Callers use this to decide how much to trust a finding. A requirement a
    person stated is worth blocking a publish over; one the backfill guessed is
    worth mentioning.
    """
    with _session() as db:
        if db is None:
            return {}
        rows = (
            db.query(Annotation.concept_id, Annotation.source)
            .filter(
                Annotation.subject_type == subject_type,
                Annotation.subject_id == subject_id,
                Annotation.predicate == predicate,
            )
            .all()
        )
    return {concept_id: source for concept_id, source in rows}


def annotations_for_many(subject_type: str, subject_ids: Iterable[str]) -> dict[str, dict[str, list[str]]]:
    """Bulk form of :func:`annotations_for`, keyed by subject id.

    The planner annotates 40 agents at once; doing that one query at a time is
    the difference between one round trip and forty.
    """
    ids = [s for s in subject_ids if s]
    if not ids:
        return {}

    with _session() as db:
        if db is None:
            return {}
        rows = (
            db.query(Annotation)
            .filter(
                Annotation.subject_type == subject_type,
                Annotation.subject_id.in_(ids),
            )
            .all()
        )

    out: dict[str, dict[str, list[str]]] = {}
    for row in rows:
        out.setdefault(row.subject_id, {}).setdefault(row.predicate, []).append(row.concept_id)
    return out


def subjects_with(
    subject_type: str,
    predicate: str,
    concept_ids: Iterable[str],
) -> set[str]:
    """Every subject annotated with any of ``concept_ids`` under ``predicate``."""
    wanted = list({c for c in concept_ids if c})
    if not wanted:
        return set()

    with _session() as db:
        if db is None:
            return set()
        rows = (
            db.query(Annotation.subject_id)
            .filter(
                Annotation.subject_type == subject_type,
                Annotation.predicate == predicate,
                Annotation.concept_id.in_(wanted),
            )
            .all()
        )
    return {r[0] for r in rows}


def tier_for_agent(agent_id: str) -> str | None:
    """The annotated tier of one agent, or None when it has never been tagged."""
    with _session() as db:
        if db is None:
            return None
        row = (
            db.query(Annotation.concept_id)
            .filter(
                Annotation.subject_type == SubjectType.AGENT.value,
                Annotation.subject_id == agent_id,
                Annotation.predicate == Predicate.HAS_TIER.value,
            )
            .first()
        )
    if not row:
        return None
    # Stored as "agent_tier.foundation"; callers want the bare value.
    return row[0].rsplit(".", 1)[-1]


def tiers_for_agents(agent_ids: Iterable[str]) -> dict[str, str]:
    """Bulk tier lookup, for list endpoints that would otherwise fan out."""
    ids = [a for a in agent_ids if a]
    if not ids:
        return {}

    with _session() as db:
        if db is None:
            return {}
        rows = (
            db.query(Annotation.subject_id, Annotation.concept_id)
            .filter(
                Annotation.subject_type == SubjectType.AGENT.value,
                Annotation.subject_id.in_(ids),
                Annotation.predicate == Predicate.HAS_TIER.value,
            )
            .all()
        )
    return {subject: concept.rsplit(".", 1)[-1] for subject, concept in rows}


def is_seeded() -> bool:
    """Whether any vocabulary exists. Guards features that need one."""
    with _session() as db:
        if db is None:
            return False
        return db.query(Concept).first() is not None


def counts() -> dict[str, int]:
    """Row counts, for the ontology overview panel."""
    with _session() as db:
        if db is None:
            return {"schemes": 0, "concepts": 0, "annotations": 0}
        return {
            "schemes": db.query(ConceptScheme).count(),
            "concepts": db.query(Concept).count(),
            "annotations": db.query(Annotation).count(),
        }


__all__ = [
    "Predicate",
    "Scheme",
    "SubjectType",
    "annotate",
    "annotations_for",
    "annotations_for_many",
    "counts",
    "descendants",
    "expand",
    "get_concept",
    "is_seeded",
    "list_concepts",
    "list_schemes",
    "set_annotations",
    "subjects_with",
    "tier_for_agent",
    "tiers_for_agents",
]
