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
from datetime import datetime, timezone
from typing import Iterable

from sqlalchemy import text

from app.database import SessionLocal
from app.ontology.models import Annotation, Concept, ConceptScheme, OntologyRule, RuleException
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


#: What each depth of the domain tree is called, for display.
#:
#: Level is derived from the tree rather than stored, so it cannot disagree
#: with `parent_id`. Only `domain` reads as industry/domain/subdomain; other
#: schemes are shallow and just report their depth.
DOMAIN_LEVEL_NAMES = ("industry", "domain", "subdomain")


def level_name(scheme_id: str, level: int) -> str:
    if scheme_id != Scheme.DOMAIN.value:
        return "concept"
    return DOMAIN_LEVEL_NAMES[level] if level < len(DOMAIN_LEVEL_NAMES) else "subdomain"


def list_concepts(scheme_id: str | None = None) -> list[dict]:
    """Concepts, each carrying its depth in the hierarchy.

    ``level`` is computed here from the loaded rows rather than walked per
    concept — the callers that need it (the browser, the graph) always want the
    whole set, so one pass beats N recursive queries.
    """
    with _session() as db:
        if db is None:
            return []
        q = db.query(Concept)
        if scheme_id:
            q = q.filter(Concept.scheme_id == scheme_id)
        concepts = [_concept_dict(c) for c in q.order_by(Concept.id).all()]

    by_id = {c["id"]: c for c in concepts}
    for concept in concepts:
        level, cursor, guard = 0, concept["parent_id"], 0
        # The guard is belt-and-braces: create/update reject cycles, but a
        # hand-edited database should degrade rather than hang a request.
        while cursor and cursor in by_id and guard < 16:
            level += 1
            cursor = by_id[cursor]["parent_id"]
            guard += 1
        concept["level"] = level
        concept["level_name"] = level_name(concept["scheme_id"], level)

    return concepts


def get_concept(concept_id: str) -> dict | None:
    """One concept, carrying the same ``level`` fields as ``list_concepts``.

    Depth is walked here rather than computed in bulk — a single read is one
    short parent chain, and callers would otherwise get a shape that silently
    differs from the list endpoint.
    """
    with _session() as db:
        if db is None:
            return None
        concept = db.query(Concept).filter(Concept.id == concept_id).first()
        if not concept:
            return None
        payload = _concept_dict(concept)

        level, cursor, guard = 0, concept.parent_id, 0
        while cursor and guard < 16:
            parent = db.query(Concept.parent_id).filter(Concept.id == cursor).first()
            if not parent:
                break
            level += 1
            cursor = parent[0]
            guard += 1

    payload["level"] = level
    payload["level_name"] = level_name(payload["scheme_id"], level)
    return payload


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


# ── Vocabulary CRUD ────────────────────────────────────────────────────────
#
# The seed file is the *shipped* vocabulary; these are for terms a user adds at
# runtime. Both write the same tables, so a concept created here behaves
# identically to a seeded one everywhere else — matching, scoping, validation.
#
# Deletes are the only genuinely dangerous operation in this module. A concept
# id is what annotations point at, so removing one can orphan review work that
# nothing will report as missing; every delete path below therefore reports what
# it would break before it does anything.


class VocabularyError(Exception):
    """A vocabulary edit was rejected. The message is meant for a user."""


def create_scheme(scheme_id: str, label: str, description: str | None = None) -> dict:
    """Add a concept scheme."""
    scheme_id = (scheme_id or "").strip()
    if not scheme_id:
        raise VocabularyError("A scheme id is required.")

    with _session() as db:
        if db is None:
            raise VocabularyError("The ontology database is unavailable.")
        if db.query(ConceptScheme).filter(ConceptScheme.id == scheme_id).first():
            raise VocabularyError(f"Scheme '{scheme_id}' already exists.")
        db.add(ConceptScheme(id=scheme_id, label=label or scheme_id, description=description))
        db.commit()
    logger.info("Created concept scheme '%s'", scheme_id)
    return {"id": scheme_id, "label": label or scheme_id, "description": description}


def update_scheme(scheme_id: str, label: str | None = None, description: str | None = None) -> dict:
    with _session() as db:
        if db is None:
            raise VocabularyError("The ontology database is unavailable.")
        scheme = db.query(ConceptScheme).filter(ConceptScheme.id == scheme_id).first()
        if not scheme:
            raise VocabularyError(f"Scheme '{scheme_id}' not found.")
        if label is not None:
            scheme.label = label
        if description is not None:
            scheme.description = description
        db.commit()
        return {"id": scheme.id, "label": scheme.label, "description": scheme.description}


def delete_scheme(scheme_id: str, cascade: bool = False) -> dict:
    """Remove a scheme. Refuses to strand its concepts unless ``cascade``."""
    with _session() as db:
        if db is None:
            raise VocabularyError("The ontology database is unavailable.")
        scheme = db.query(ConceptScheme).filter(ConceptScheme.id == scheme_id).first()
        if not scheme:
            raise VocabularyError(f"Scheme '{scheme_id}' not found.")

        concept_ids = [c.id for c in db.query(Concept).filter(Concept.scheme_id == scheme_id).all()]
        if concept_ids and not cascade:
            raise VocabularyError(
                f"Scheme '{scheme_id}' still has {len(concept_ids)} concepts. "
                "Delete them first, or pass cascade=true."
            )

        removed_annotations = 0
        if concept_ids:
            removed_annotations = (
                db.query(Annotation)
                .filter(Annotation.concept_id.in_(concept_ids))
                .delete(synchronize_session=False)
            )
            db.query(Concept).filter(Concept.scheme_id == scheme_id).delete(
                synchronize_session=False
            )
        db.delete(scheme)
        db.commit()

    logger.info(
        "Deleted scheme '%s' (%d concepts, %d annotations)",
        scheme_id, len(concept_ids), removed_annotations,
    )
    return {
        "deleted": scheme_id,
        "concepts_removed": len(concept_ids),
        "annotations_removed": removed_annotations,
    }


def create_concept(
    concept_id: str,
    scheme_id: str,
    label: str,
    parent_id: str | None = None,
    definition: str | None = None,
    synonyms: Iterable[str] | None = None,
) -> dict:
    """Add a concept to a scheme."""
    concept_id = (concept_id or "").strip()
    if not concept_id:
        raise VocabularyError("A concept id is required.")

    with _session() as db:
        if db is None:
            raise VocabularyError("The ontology database is unavailable.")
        if db.query(Concept).filter(Concept.id == concept_id).first():
            raise VocabularyError(f"Concept '{concept_id}' already exists.")
        if not db.query(ConceptScheme).filter(ConceptScheme.id == scheme_id).first():
            raise VocabularyError(f"Scheme '{scheme_id}' does not exist.")

        if parent_id:
            parent = db.query(Concept).filter(Concept.id == parent_id).first()
            if not parent:
                raise VocabularyError(f"Parent concept '{parent_id}' does not exist.")
            # Hierarchy queries are a recursive walk within one scheme; a
            # cross-scheme parent would produce a tree no traversal can follow.
            if parent.scheme_id != scheme_id:
                raise VocabularyError(
                    f"Parent '{parent_id}' is in scheme '{parent.scheme_id}', "
                    f"not '{scheme_id}'."
                )

        db.add(Concept(
            id=concept_id,
            scheme_id=scheme_id,
            parent_id=parent_id or None,
            label=label or concept_id,
            definition=definition,
            synonyms=json.dumps(list(synonyms or [])),
        ))
        db.commit()

    logger.info("Created concept '%s' in scheme '%s'", concept_id, scheme_id)
    return get_concept(concept_id) or {}


def update_concept(
    concept_id: str,
    label: str | None = None,
    parent_id: str | None = None,
    definition: str | None = None,
    synonyms: Iterable[str] | None = None,
    clear_parent: bool = False,
) -> dict:
    """Edit a concept. ``clear_parent`` promotes it to a root."""
    with _session() as db:
        if db is None:
            raise VocabularyError("The ontology database is unavailable.")
        concept = db.query(Concept).filter(Concept.id == concept_id).first()
        if not concept:
            raise VocabularyError(f"Concept '{concept_id}' not found.")

        if label is not None:
            concept.label = label
        if definition is not None:
            concept.definition = definition
        if synonyms is not None:
            concept.synonyms = json.dumps(list(synonyms))

        if clear_parent:
            concept.parent_id = None
        elif parent_id is not None:
            if parent_id == concept_id:
                raise VocabularyError("A concept cannot be its own parent.")
            parent = db.query(Concept).filter(Concept.id == parent_id).first()
            if not parent:
                raise VocabularyError(f"Parent concept '{parent_id}' does not exist.")
            if parent.scheme_id != concept.scheme_id:
                raise VocabularyError(
                    f"Parent '{parent_id}' is in a different scheme."
                )
            # Re-parenting under one's own descendant would build a cycle, and
            # the recursive descendant walk would then never terminate.
            if parent_id in descendants(concept_id):
                raise VocabularyError(
                    f"'{parent_id}' is below '{concept_id}' — that would make a cycle."
                )
            concept.parent_id = parent_id

        db.commit()

    return get_concept(concept_id) or {}


def concept_usage(concept_id: str) -> dict:
    """What a delete would take with it: children and annotations."""
    with _session() as db:
        if db is None:
            return {"children": [], "annotations": 0, "subjects": []}
        children = [c.id for c in db.query(Concept).filter(Concept.parent_id == concept_id).all()]
        rows = (
            db.query(Annotation.subject_type, Annotation.subject_id)
            .filter(Annotation.concept_id == concept_id)
            .all()
        )
    return {
        "children": children,
        "annotations": len(rows),
        "subjects": [{"subject_type": t, "subject_id": s} for t, s in rows[:50]],
    }


def delete_concept(concept_id: str, cascade: bool = False) -> dict:
    """Remove a concept.

    Refuses while it has children or annotations unless ``cascade``, because
    both failures are silent: an orphaned annotation matches nothing and a
    stranded child drops out of every hierarchy walk.
    """
    usage = concept_usage(concept_id)
    if (usage["children"] or usage["annotations"]) and not cascade:
        raise VocabularyError(
            f"'{concept_id}' has {len(usage['children'])} child concepts and "
            f"{usage['annotations']} annotations. Pass cascade=true to remove them too."
        )

    with _session() as db:
        if db is None:
            raise VocabularyError("The ontology database is unavailable.")
        concept = db.query(Concept).filter(Concept.id == concept_id).first()
        if not concept:
            raise VocabularyError(f"Concept '{concept_id}' not found.")

        doomed = descendants(concept_id) if cascade else {concept_id}
        removed_annotations = (
            db.query(Annotation)
            .filter(Annotation.concept_id.in_(list(doomed)))
            .delete(synchronize_session=False)
        )
        db.query(Concept).filter(Concept.id.in_(list(doomed))).delete(synchronize_session=False)
        db.commit()

    logger.info(
        "Deleted concept '%s' (%d concepts, %d annotations)",
        concept_id, len(doomed), removed_annotations,
    )
    return {
        "deleted": concept_id,
        "concepts_removed": len(doomed),
        "annotations_removed": removed_annotations,
    }


# ── Annotation CRUD ────────────────────────────────────────────────────────


def add_annotation(
    subject_type: str, subject_id: str, predicate: str, concept_id: str, source: str = "user"
) -> dict:
    """Add one triple, leaving the subject's other annotations alone.

    ``set_annotations`` replaces a whole predicate; this is the additive form
    the editor needs when a user ticks one more concept.
    """
    with _session() as db:
        if db is None:
            raise VocabularyError("The ontology database is unavailable.")
        if not db.query(Concept).filter(Concept.id == concept_id).first():
            raise VocabularyError(f"Concept '{concept_id}' does not exist.")

        existing = db.query(Annotation).filter(
            Annotation.subject_type == subject_type,
            Annotation.subject_id == subject_id,
            Annotation.predicate == predicate,
            Annotation.concept_id == concept_id,
        ).first()
        if existing:
            # Re-asserting a guess by hand is how it gets confirmed, so the
            # source is upgraded rather than the write being a no-op.
            existing.source = source
        else:
            db.add(Annotation(
                subject_type=subject_type, subject_id=subject_id,
                predicate=predicate, concept_id=concept_id, source=source,
            ))
        db.commit()

    return {"subject_type": subject_type, "subject_id": subject_id,
            "predicate": predicate, "concept_id": concept_id, "source": source}


def remove_annotation(
    subject_type: str, subject_id: str, predicate: str, concept_id: str
) -> dict:
    with _session() as db:
        if db is None:
            raise VocabularyError("The ontology database is unavailable.")
        removed = db.query(Annotation).filter(
            Annotation.subject_type == subject_type,
            Annotation.subject_id == subject_id,
            Annotation.predicate == predicate,
            Annotation.concept_id == concept_id,
        ).delete(synchronize_session=False)
        db.commit()
    return {"removed": removed}


def delete_subject_annotations(subject_type: str, subject_id: str) -> dict:
    """Forget everything about one subject — used when it is deleted upstream."""
    with _session() as db:
        if db is None:
            return {"removed": 0}
        removed = db.query(Annotation).filter(
            Annotation.subject_type == subject_type,
            Annotation.subject_id == subject_id,
        ).delete(synchronize_session=False)
        db.commit()
    return {"removed": removed}


def search_annotations(
    subject_type: str | None = None,
    predicate: str | None = None,
    concept_id: str | None = None,
    source: str | None = None,
    limit: int = 500,
) -> list[dict]:
    """Browse the annotation table. Powers the admin list and the graph."""
    with _session() as db:
        if db is None:
            return []
        query = db.query(Annotation)
        if subject_type:
            query = query.filter(Annotation.subject_type == subject_type)
        if predicate:
            query = query.filter(Annotation.predicate == predicate)
        if concept_id:
            query = query.filter(Annotation.concept_id == concept_id)
        if source:
            query = query.filter(Annotation.source == source)
        rows = query.order_by(Annotation.subject_type, Annotation.subject_id).limit(limit).all()

    return [
        {
            "id": r.id,
            "subject_type": r.subject_type,
            "subject_id": r.subject_id,
            "predicate": r.predicate,
            "concept_id": r.concept_id,
            "source": r.source,
        }
        for r in rows
    ]


def all_annotations() -> list[dict]:
    """Every triple, unpaginated. Only for building the graph."""
    return search_annotations(limit=100_000)


# ── Rules ──────────────────────────────────────────────────────────────────
#
# Same shape as the vocabulary CRUD above: read functions degrade to empty,
# write functions raise VocabularyError with a message meant for a user. Rules
# follow the LibraryOntology draft/approved/superseded lifecycle (see
# rag/models.py) — a draft has zero effect until approved, which is what makes
# editing a live governance rule safe to preview.


def _rule_dict(rule: OntologyRule) -> dict:
    return {
        "id": rule.id,
        "kind": rule.kind,
        "label": rule.label,
        "params": json.loads(rule.params) if rule.params else {},
        "severity": rule.severity,
        "message_template": rule.message_template or "",
        "status": rule.status,
        "source": rule.source,
    }


def list_rules(status: str | None = None) -> list[dict]:
    with _session() as db:
        if db is None:
            return []
        q = db.query(OntologyRule)
        if status:
            q = q.filter(OntologyRule.status == status)
        return [_rule_dict(r) for r in q.order_by(OntologyRule.id).all()]


def get_rule(rule_id: str) -> dict | None:
    with _session() as db:
        if db is None:
            return None
        rule = db.query(OntologyRule).filter(OntologyRule.id == rule_id).first()
        return _rule_dict(rule) if rule else None


def upsert_rule(
    rule_id: str,
    kind: str,
    label: str,
    params: dict | None = None,
    severity: str = "warning",
    message_template: str | None = None,
    status: str = "draft",
    source: str = "user",
) -> dict:
    """Create a rule, or overwrite one with the same id.

    Overwrite rather than reject-on-exists: the seed loader re-runs this on
    every boot for the shipped rules, and a hand-edited row with the same id
    is how a user intentionally replaces a seed rule.
    """
    rule_id = (rule_id or "").strip()
    if not rule_id:
        raise VocabularyError("A rule id is required.")
    if not kind:
        raise VocabularyError("A rule kind is required.")

    with _session() as db:
        if db is None:
            raise VocabularyError("The ontology database is unavailable.")
        rule = db.query(OntologyRule).filter(OntologyRule.id == rule_id).first()
        payload = dict(
            kind=kind,
            label=label or rule_id,
            params=json.dumps(params or {}),
            severity=severity,
            message_template=message_template,
            status=status,
            source=source,
        )
        if rule:
            for key, value in payload.items():
                setattr(rule, key, value)
        else:
            db.add(OntologyRule(id=rule_id, **payload))
        if status == "approved":
            db.query(OntologyRule).filter(OntologyRule.id == rule_id).update(
                {"approved_at": datetime.now(timezone.utc)}
            )
        db.commit()

    return get_rule(rule_id) or {}


def update_rule(
    rule_id: str,
    label: str | None = None,
    params: dict | None = None,
    severity: str | None = None,
    message_template: str | None = None,
) -> dict:
    with _session() as db:
        if db is None:
            raise VocabularyError("The ontology database is unavailable.")
        rule = db.query(OntologyRule).filter(OntologyRule.id == rule_id).first()
        if not rule:
            raise VocabularyError(f"Rule '{rule_id}' not found.")
        if label is not None:
            rule.label = label
        if params is not None:
            rule.params = json.dumps(params)
        if severity is not None:
            rule.severity = severity
        if message_template is not None:
            rule.message_template = message_template
        db.commit()
    return get_rule(rule_id) or {}


def approve_rule(rule_id: str) -> dict:
    with _session() as db:
        if db is None:
            raise VocabularyError("The ontology database is unavailable.")
        rule = db.query(OntologyRule).filter(OntologyRule.id == rule_id).first()
        if not rule:
            raise VocabularyError(f"Rule '{rule_id}' not found.")
        rule.status = "approved"
        rule.approved_at = datetime.now(timezone.utc)
        db.commit()
    logger.info("Approved ontology rule '%s'", rule_id)
    return get_rule(rule_id) or {}


def delete_rule(rule_id: str) -> dict:
    with _session() as db:
        if db is None:
            raise VocabularyError("The ontology database is unavailable.")
        rule = db.query(OntologyRule).filter(OntologyRule.id == rule_id).first()
        if not rule:
            raise VocabularyError(f"Rule '{rule_id}' not found.")
        removed_exceptions = (
            db.query(RuleException)
            .filter(RuleException.rule_id == rule_id)
            .delete(synchronize_session=False)
        )
        db.delete(rule)
        db.commit()
    return {"deleted": rule_id, "exceptions_removed": removed_exceptions}


# ── Rule exceptions ────────────────────────────────────────────────────────


def _exception_dict(exc: RuleException) -> dict:
    return {
        "id": exc.id,
        "rule_id": exc.rule_id,
        "subject_type": exc.subject_type,
        "subject_id": exc.subject_id,
        "reason": exc.reason,
        "granted_by": exc.granted_by,
        "expires_at": exc.expires_at.isoformat() if exc.expires_at else None,
    }


def list_exceptions(rule_id: str | None = None) -> list[dict]:
    with _session() as db:
        if db is None:
            return []
        q = db.query(RuleException)
        if rule_id:
            q = q.filter(RuleException.rule_id == rule_id)
        return [_exception_dict(e) for e in q.order_by(RuleException.id.desc()).all()]


def add_exception(
    rule_id: str,
    subject_type: str,
    subject_id: str,
    reason: str,
    granted_by: str,
    expires_at: datetime | None = None,
) -> dict:
    if not (reason or "").strip():
        raise VocabularyError("An exception needs a reason — it is the derogation's justification.")
    if not (granted_by or "").strip():
        raise VocabularyError("An exception needs who granted it, for the audit trail.")

    with _session() as db:
        if db is None:
            raise VocabularyError("The ontology database is unavailable.")
        if not db.query(OntologyRule).filter(OntologyRule.id == rule_id).first():
            raise VocabularyError(f"Rule '{rule_id}' does not exist.")
        exc = RuleException(
            rule_id=rule_id, subject_type=subject_type, subject_id=subject_id,
            reason=reason.strip(), granted_by=granted_by.strip(), expires_at=expires_at,
        )
        db.add(exc)
        db.commit()
        db.refresh(exc)
        return _exception_dict(exc)


def remove_exception(exception_id: int) -> dict:
    with _session() as db:
        if db is None:
            raise VocabularyError("The ontology database is unavailable.")
        removed = (
            db.query(RuleException)
            .filter(RuleException.id == exception_id)
            .delete(synchronize_session=False)
        )
        db.commit()
    return {"removed": removed}


def live_exceptions() -> set[tuple[str, str, str]]:
    """``(rule_id, subject_type, subject_id)`` for every exception in force.

    Loaded as one set rather than queried per-finding — validation checks a
    handful of resources per workflow, and one query beats N.
    """
    now = datetime.now(timezone.utc)
    with _session() as db:
        if db is None:
            return set()
        rows = (
            db.query(RuleException.rule_id, RuleException.subject_type, RuleException.subject_id)
            .filter((RuleException.expires_at.is_(None)) | (RuleException.expires_at > now))
            .all()
        )
    return {(r[0], r[1], r[2]) for r in rows}


__all__ = [
    "Predicate",
    "Scheme",
    "SubjectType",
    "VocabularyError",
    "add_annotation",
    "add_exception",
    "all_annotations",
    "annotate",
    "approve_rule",
    "concept_usage",
    "create_concept",
    "create_scheme",
    "delete_concept",
    "delete_rule",
    "delete_scheme",
    "delete_subject_annotations",
    "get_rule",
    "list_exceptions",
    "list_rules",
    "live_exceptions",
    "remove_annotation",
    "remove_exception",
    "search_annotations",
    "update_concept",
    "update_rule",
    "update_scheme",
    "upsert_rule",
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
