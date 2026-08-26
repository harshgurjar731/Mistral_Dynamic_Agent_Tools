"""
Normalising, merging and shaping what the extractor returned.

A document is extracted one chunk at a time, so the same entity comes back
several times with different spellings, different casing, a different one-line
description and a different confidence. Turning that into a graph is this
module's whole job, and it is where extraction quality is actually won:

* **Identity is the normalised name plus the type.** Case, punctuation and
  surrounding whitespace carry no meaning here, and "Northwind Trading Ltd."
  appearing on page 1 and "Northwind Trading Ltd" on page 9 is one company.
* **Relations are dropped when an endpoint is missing.** Models routinely
  reference an entity in a relation that they did not list in ``entities``.
  Inventing the missing node would put an unevidenced entity in the graph, so
  the relation goes instead — a lost edge is recoverable, a fabricated node is
  not.
* **Nothing here talks to a database.** Merging is pure, which is what lets the
  review UI re-run it over a user's edits before commit without a round trip.
"""

from __future__ import annotations

import re
from typing import Any, Iterable, Optional

from app.rag.prompts import ENTITY_TYPES

_TYPE_LOOKUP = {t.lower(): t for t in ENTITY_TYPES}
_WHITESPACE = re.compile(r"\s+")
# Kept out of the normalised form: trailing punctuation and the legal-form
# noise that differs between two mentions of one organisation.
_TRIM = re.compile(r"^[\s\"'(\[]+|[\s\"'.,;:)\]]+$")
_NON_WORD = re.compile(r"[^a-z0-9\s&/-]")
_PREDICATE_CLEAN = re.compile(r"[^a-z0-9]+")

MAX_EVIDENCE = 400
MAX_DESCRIPTION = 600
MAX_NAME = 200


def normalize_name(name: str) -> str:
    """The comparison form of an entity name.

    Lower-cased, punctuation-stripped and whitespace-collapsed. This is what
    entity identity is keyed on in Neo4j, so it has to be stable across the
    small differences between two mentions of the same thing — and must not be
    so aggressive that two genuinely different names collide.
    """
    text = _TRIM.sub("", (name or "").strip()).lower()
    text = _NON_WORD.sub(" ", text)
    return _WHITESPACE.sub(" ", text).strip()


class Schema:
    """A library's approved vocabulary, in the form coercion needs.

    Built from the stored ontology once per extraction rather than looked up per
    row: a forty-chunk document produces hundreds of entities, and re-reading
    the schema for each would dominate the merge.

    ``None`` anywhere a Schema is accepted means "no approved ontology" and
    restores the generic behaviour — libraries are not required to design a
    schema before they can extract anything.
    """

    __slots__ = ("types", "predicates", "_type_lookup", "_predicate_lookup")

    def __init__(self, types: Iterable[str] = (), predicates: Iterable[str] = ()):
        self.types = [t for t in types if t]
        self.predicates = [p for p in predicates if p]
        self._type_lookup = {t.lower(): t for t in self.types}
        self._predicate_lookup = {p.lower(): p for p in self.predicates}

    @classmethod
    def for_library(cls, library_id: str) -> Optional["Schema"]:
        """The approved schema for a library, or None if it has none."""
        try:
            from app.rag import library_ontology

            ontology = library_ontology.get_approved(library_id)
        except Exception:
            return None
        if not ontology or not ontology.get("entity_types"):
            return None
        return cls(
            [t["name"] for t in ontology["entity_types"]],
            [p["name"] for p in ontology.get("predicates") or []],
        )

    def match_type(self, value: str) -> Optional[str]:
        return self._type_lookup.get(value.lower())

    def match_predicate(self, value: str) -> Optional[str]:
        return self._predicate_lookup.get(value.lower())


def coerce_type(value: Any, schema: Optional[Schema] = None) -> str:
    """Map whatever the model said onto the closed type vocabulary.

    With a schema, an unrecognised type is returned **unchanged** so the caller
    can flag it. Quietly folding it into a schema type would be the worst
    outcome: the reviewer would never learn the schema is missing something,
    and the entity would sit in the graph under a type that misdescribes it.
    """
    candidate = str(value or "").strip()
    if schema is not None:
        matched = schema.match_type(candidate)
        if matched:
            return matched
        # A near-miss the generic aliases can resolve — "company" when the
        # schema has "Organization" — is still worth catching.
        generic = _generic_type(candidate)
        return schema.match_type(generic) or (candidate or "Concept")

    return _generic_type(candidate)


def _generic_type(value: str) -> str:
    """Map onto the built-in vocabulary. The pre-ontology behaviour."""
    candidate = value.strip().lower()
    if candidate in _TYPE_LOOKUP:
        return _TYPE_LOOKUP[candidate]
    # Common near-misses. Cheaper than another model call and it fires often
    # enough to matter: "company" and "org" are what models reach for first.
    aliases = {
        "company": "Organization", "org": "Organization", "corporation": "Organization",
        "business": "Organization", "institution": "Organization", "agency": "Organization",
        "individual": "Person", "people": "Person", "role": "Person",
        "service": "Product", "software": "System", "application": "System",
        "platform": "System", "tool": "System", "technology": "System",
        "procedure": "Process", "workflow": "Process", "activity": "Process",
        "measure": "Metric", "kpi": "Metric", "indicator": "Metric",
        "law": "Regulation", "policy": "Regulation", "standard": "Regulation",
        "rule": "Regulation", "requirement": "Regulation", "clause": "Regulation",
        "place": "Location", "country": "Location", "region": "Location",
        "date": "Event", "milestone": "Event", "incident": "Event",
        "topic": "Concept", "term": "Concept", "definition": "Concept",
    }
    return aliases.get(candidate, "Concept")


def coerce_predicate(value: Any, schema: Optional[Schema] = None) -> str:
    """A lower_snake_case verb phrase, mapped onto the schema where there is one.

    Like ``coerce_type``, an unrecognised predicate is returned unchanged rather
    than rewritten, so the caller can report it. This is the field the closed
    vocabulary exists for: uncontrolled predicates produced "pays" and
    "pays_invoice_to" for the same fact on two runs of one document.
    """
    text = _PREDICATE_CLEAN.sub("_", str(value or "").strip().lower()).strip("_")[:60]
    if not text:
        return "related_to"
    if schema is not None and schema.predicates:
        return schema.match_predicate(text) or text
    return text


def _clean_text(value: Any, limit: int) -> str:
    text = _WHITESPACE.sub(" ", str(value or "").strip())
    return text[:limit]


def _confidence(value: Any, default: float = 0.7) -> float:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return default
    return round(min(1.0, max(0.0, number)), 2)


def normalize_entity(
    raw: dict,
    *,
    chunk_index: int = 0,
    source: str = "llm",
    schema: Optional[Schema] = None,
) -> Optional[dict]:
    """One extracted entity in canonical form, or None if unusable.

    When a schema is in force, an entity whose type is not in it is kept and
    marked ``unmapped``. It reaches the reviewer, who either retypes it or
    decides the schema needs it — which is the signal that a new ontology
    version is warranted. Commit skips anything still unmapped, and reports
    how many.
    """
    name = _clean_text(raw.get("name"), MAX_NAME)
    normalized = normalize_name(name)
    if not normalized:
        return None

    aliases = []
    for alias in raw.get("aliases") or []:
        cleaned = _clean_text(alias, MAX_NAME)
        if cleaned and normalize_name(cleaned) != normalized:
            aliases.append(cleaned)

    evidence = _clean_text(raw.get("evidence"), MAX_EVIDENCE)
    entity_type = coerce_type(raw.get("type"), schema)
    unmapped = bool(schema is not None and schema.match_type(entity_type) is None)

    return {
        "name": name,
        "normalized": normalized,
        "type": entity_type,
        "unmapped": unmapped,
        "description": _clean_text(raw.get("description"), MAX_DESCRIPTION),
        "aliases": aliases[:8],
        "confidence": _confidence(raw.get("confidence")),
        "source": source,
        "mentions": (
            [{"chunk_index": int(chunk_index), "quote": evidence}] if evidence else []
        ),
    }


def normalize_relation(
    raw: dict, *, source: str = "llm", schema: Optional[Schema] = None
) -> Optional[dict]:
    """One extracted relation in canonical form, or None if unusable."""
    source_name = _clean_text(raw.get("source"), MAX_NAME)
    target_name = _clean_text(raw.get("target"), MAX_NAME)
    source_normalized = normalize_name(source_name)
    target_normalized = normalize_name(target_name)
    if not source_normalized or not target_normalized:
        return None
    if source_normalized == target_normalized:
        # Self-edges are almost always a restatement of the entity's own
        # description rather than a fact about a connection.
        return None

    predicate = coerce_predicate(raw.get("predicate"), schema)
    unmapped = bool(
        schema is not None
        and schema.predicates
        and schema.match_predicate(predicate) is None
    )

    return {
        "source": source_name,
        "source_normalized": source_normalized,
        "source_type": coerce_type(raw.get("source_type"), schema),
        "predicate": predicate,
        "unmapped": unmapped,
        "target": target_name,
        "target_normalized": target_normalized,
        "target_type": coerce_type(raw.get("target_type"), schema),
        "evidence": _clean_text(raw.get("evidence"), MAX_EVIDENCE),
        "confidence": _confidence(raw.get("confidence")),
        "source_kind": source,
    }


def merge(
    chunk_results: Iterable[tuple[int, dict]],
    *,
    source: str = "llm",
    schema: Optional[Schema] = None,
) -> dict:
    """Fold per-chunk extractions into one draft.

    Takes ``(chunk_index, payload)`` pairs so mentions keep their position in
    the document — which is what lets the review UI show *where* an entity was
    found, and what a retrieved triple quotes as evidence.
    """
    entities: dict[tuple[str, str], dict] = {}
    relations: dict[tuple[str, str, str, str, str], dict] = {}

    for chunk_index, payload in chunk_results:
        if not isinstance(payload, dict):
            continue

        for raw in payload.get("entities") or []:
            if not isinstance(raw, dict):
                continue
            entity = normalize_entity(
                raw, chunk_index=chunk_index, source=source, schema=schema
            )
            if not entity:
                continue
            key = (entity["normalized"], entity["type"])
            existing = entities.get(key)
            if not existing:
                entities[key] = entity
                continue
            # Keep the longest name — models abbreviate on later mentions, and
            # the fullest form is the one worth showing in the graph.
            if len(entity["name"]) > len(existing["name"]):
                existing["name"] = entity["name"]
            if len(entity["description"]) > len(existing["description"]):
                existing["description"] = entity["description"]
            for alias in entity["aliases"]:
                if alias not in existing["aliases"]:
                    existing["aliases"].append(alias)
            existing["aliases"] = existing["aliases"][:8]
            existing["confidence"] = max(existing["confidence"], entity["confidence"])
            existing["mentions"].extend(entity["mentions"])
            existing["mentions"] = existing["mentions"][:10]

        for raw in payload.get("relations") or []:
            if not isinstance(raw, dict):
                continue
            relation = normalize_relation(raw, source=source, schema=schema)
            if not relation:
                continue
            key = (
                relation["source_normalized"], relation["source_type"],
                relation["predicate"],
                relation["target_normalized"], relation["target_type"],
            )
            existing = relations.get(key)
            if not existing:
                relations[key] = relation
            else:
                existing["confidence"] = max(existing["confidence"], relation["confidence"])
                if len(relation["evidence"]) > len(existing["evidence"]):
                    existing["evidence"] = relation["evidence"]

    return resolve(
        {"entities": list(entities.values()), "relations": list(relations.values())}
    )


def resolve(payload: dict) -> dict:
    """Drop relations whose endpoints are not in the entity list.

    Run after merging and again after a user edits a draft — deleting an entity
    in the review UI has to take its edges with it, or commit would fail on a
    MATCH that finds nothing.

    Endpoint matching is by normalised name only, not by name *and* type: a
    model that types an entity as ``Organization`` in the list and refers to it
    as a ``Concept`` in a relation is describing one thing, and the entity list
    is the more considered of the two answers.
    """
    entities = [e for e in payload.get("entities") or [] if e.get("normalized")]
    by_normalized = {e["normalized"]: e for e in entities}

    kept: list[dict] = []
    dropped = 0
    for relation in payload.get("relations") or []:
        source = by_normalized.get(relation.get("source_normalized"))
        target = by_normalized.get(relation.get("target_normalized"))
        if not source or not target:
            dropped += 1
            continue
        # Realign the endpoint types onto the entity list so commit's MATCH
        # finds the nodes that were actually created.
        relation["source_type"] = source["type"]
        relation["target_type"] = target["type"]
        relation["source"] = source["name"]
        relation["target"] = target["name"]
        kept.append(relation)

    return {
        "entities": entities,
        "relations": kept,
        "dropped_relations": dropped,
        # What the schema did not recognise. Surfaced rather than silently
        # absorbed: this is the only signal that a library ontology is
        # missing something the documents actually contain.
        "unmapped_entities": sorted({e["type"] for e in entities if e.get("unmapped")}),
        "unmapped_predicates": sorted(
            {r["predicate"] for r in kept if r.get("unmapped")}
        ),
    }


def to_graph_rows(payload: dict) -> tuple[list[dict], list[dict]]:
    """Shape a resolved draft into the rows ``graph_store.commit_document`` unwinds.

    Entities and relations still marked ``unmapped`` are excluded. Writing them
    would put types and predicates in the graph that the library schema does
    not define — which is how a graph fragments, and the reason the schema is
    closed in the first place. The caller reports the count; the reviewer
    fixes them by retyping, or by extending the ontology.
    """
    skipped = {
        entity["normalized"]
        for entity in payload.get("entities") or []
        if entity.get("unmapped")
    }

    entity_rows = [
        {
            "name": entity["name"],
            "normalized": entity["normalized"],
            "type": entity["type"],
            "description": entity.get("description") or "",
            "aliases": entity.get("aliases") or [],
            # Neo4j full-text indexes a string, not a list, so aliases are
            # carried twice: as a list for display and as one blob for search.
            "aliases_text": " ".join(entity.get("aliases") or []),
            "confidence": entity.get("confidence", 0.7),
            "source": entity.get("source", "llm"),
            "mentions": [
                {
                    "chunk_index": int(m.get("chunk_index", 0)),
                    "quote": _clean_text(m.get("quote"), MAX_EVIDENCE),
                }
                for m in (entity.get("mentions") or [])
                if m.get("quote")
            ],
        }
        for entity in payload.get("entities") or []
        if not entity.get("unmapped")
    ]

    relation_rows = [
        {
            "source_normalized": relation["source_normalized"],
            "source_type": relation["source_type"],
            "target_normalized": relation["target_normalized"],
            "target_type": relation["target_type"],
            "predicate": relation["predicate"],
            "evidence": relation.get("evidence") or "",
            "confidence": relation.get("confidence", 0.7),
            "source": relation.get("source_kind", "llm"),
        }
        for relation in payload.get("relations") or []
        if not relation.get("unmapped")
        and relation["source_normalized"] not in skipped
        and relation["target_normalized"] not in skipped
    ]
    return entity_rows, relation_rows


def sanitize_draft(payload: Any, schema: Optional[Schema] = None) -> dict:
    """Re-normalise a draft that came back from the review UI.

    The UI sends whatever the user typed. Everything is re-derived here rather
    than trusted — a renamed entity needs a new normalised form, a retyped one
    needs its relations realigned — so an edited draft is exactly as
    well-formed as a freshly extracted one.
    """
    if not isinstance(payload, dict):
        return {
            "entities": [], "relations": [], "dropped_relations": 0,
            "unmapped_entities": [], "unmapped_predicates": [],
        }

    entities = []
    for raw in payload.get("entities") or []:
        if not isinstance(raw, dict):
            continue
        entity = normalize_entity(
            raw, source=raw.get("source") or "user", schema=schema
        )
        if not entity:
            continue
        # Mentions are evidence, not user input: preserve what extraction found
        # rather than the empty list a renormalised row would otherwise get.
        entity["mentions"] = [
            {
                "chunk_index": int(m.get("chunk_index", 0)),
                "quote": _clean_text(m.get("quote"), MAX_EVIDENCE),
            }
            for m in (raw.get("mentions") or [])
            if isinstance(m, dict) and m.get("quote")
        ][:10]
        entities.append(entity)

    relations = []
    for raw in payload.get("relations") or []:
        if not isinstance(raw, dict):
            continue
        relation = normalize_relation(
            raw, source=raw.get("source_kind") or "user", schema=schema
        )
        if relation:
            relations.append(relation)

    return resolve({"entities": entities, "relations": relations})
