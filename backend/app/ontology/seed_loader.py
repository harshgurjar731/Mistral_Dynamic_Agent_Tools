"""
Seed loader — reads the YAML vocabulary into the concept store.

Runs on every boot, so it has to be idempotent: this project creates tables
with ``create_all()`` and has no migration tool, which means the loader is the
only thing keeping the shipped vocabulary and the database in step.

Upsert, never delete. A concept removed from the YAML stays in the database,
because annotations may already point at it and silently dropping those would
lose human review work. Removing a concept is a deliberate act — do it through
the API, which can report what it would orphan.
"""

import json
import logging
from pathlib import Path

import yaml

from app.database import SessionLocal
from app.ontology.models import Concept, ConceptScheme

logger = logging.getLogger(__name__)

SEED_DIR = Path(__file__).parent / "seed"


def _read_seed_files(path: Path | None) -> dict:
    """Merge every seed file into one payload.

    The vocabulary outgrew a single file once the industry taxonomy landed, so
    the loader reads every ``*.yaml`` in the seed directory in name order. Later
    files win on conflict, which is what lets ``industries.yaml`` re-parent a
    domain that ``schemes.yaml`` introduced without either file having to know
    about the other.
    """
    files = [path] if path else sorted(SEED_DIR.glob("*.yaml"))
    merged: dict = {"schemes": [], "concepts": []}

    for seed_file in files:
        if not seed_file.exists():
            logger.warning("Ontology seed file missing: %s", seed_file)
            continue
        try:
            data = yaml.safe_load(seed_file.read_text(encoding="utf-8")) or {}
        except Exception as e:
            logger.error("Could not parse ontology seed %s: %s", seed_file.name, e)
            continue
        merged["schemes"].extend(data.get("schemes") or [])
        merged["concepts"].extend(data.get("concepts") or [])
        logger.debug(
            "Read %s: %d schemes, %d concepts",
            seed_file.name, len(data.get("schemes") or []), len(data.get("concepts") or []),
        )

    return merged


def load_seed(path: Path | None = None) -> dict:
    """Upsert the YAML vocabulary. Returns a summary of what changed."""
    summary = {"schemes_added": 0, "concepts_added": 0, "concepts_updated": 0, "skipped": 0}

    if SessionLocal is None:
        logger.warning("No database — skipping ontology seed")
        return summary

    data = _read_seed_files(path)
    if not data["schemes"] and not data["concepts"]:
        return summary

    db = SessionLocal()
    try:
        for raw in data.get("schemes", []):
            scheme_id = raw.get("id")
            if not scheme_id:
                continue
            existing = db.query(ConceptScheme).filter(ConceptScheme.id == scheme_id).first()
            if existing:
                existing.label = raw.get("label", existing.label)
                existing.description = raw.get("description", existing.description)
            else:
                db.add(
                    ConceptScheme(
                        id=scheme_id,
                        label=raw.get("label", scheme_id),
                        description=raw.get("description"),
                    )
                )
                summary["schemes_added"] += 1

        # Flush so concepts can reference schemes added in this same pass.
        db.flush()
        known_schemes = {s.id for s in db.query(ConceptScheme).all()}

        for raw in data.get("concepts", []):
            concept_id = raw.get("id")
            scheme_id = raw.get("scheme")
            if not concept_id or scheme_id not in known_schemes:
                logger.warning("Skipping concept %r — unknown scheme %r", concept_id, scheme_id)
                summary["skipped"] += 1
                continue

            synonyms = json.dumps(raw.get("synonyms") or [])
            existing = db.query(Concept).filter(Concept.id == concept_id).first()
            if existing:
                existing.label = raw.get("label", existing.label)
                existing.definition = raw.get("definition", existing.definition)
                # Absent means "no opinion", not "clear it". These are upserts
                # spread across several files, and one file omitting `parent`
                # must not undo the re-parenting another file declared —
                # otherwise the result depends on which file loaded last.
                if "parent" in raw:
                    existing.parent_id = raw["parent"]
                existing.synonyms = synonyms
                summary["concepts_updated"] += 1
            else:
                db.add(
                    Concept(
                        id=concept_id,
                        scheme_id=scheme_id,
                        parent_id=raw.get("parent"),
                        label=raw.get("label", concept_id),
                        definition=raw.get("definition"),
                        synonyms=synonyms,
                    )
                )
                summary["concepts_added"] += 1

        db.commit()
        logger.info(
            "Ontology seed: +%d schemes, +%d concepts, ~%d updated, %d skipped",
            summary["schemes_added"], summary["concepts_added"],
            summary["concepts_updated"], summary["skipped"],
        )
    except Exception as e:
        db.rollback()
        logger.error("Ontology seed failed: %s", e)
    finally:
        db.close()

    return summary
