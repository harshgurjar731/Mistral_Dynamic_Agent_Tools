"""
Seed the recommended rules. Insert-if-missing, so edits survive restarts.
"""

from __future__ import annotations

import logging
from pathlib import Path
from typing import Optional

import yaml

logger = logging.getLogger(__name__)

SEED_FILE = Path(__file__).parent / "seed.yaml"


def _entries() -> list[dict]:
    try:
        data = yaml.safe_load(SEED_FILE.read_text(encoding="utf-8")) or {}
    except Exception as e:
        logger.error("Could not read rules seed: %s", e)
        return []
    return [r for r in data.get("rules") or [] if r.get("id") and r.get("type")]


def defaults_for(rule_id: str) -> Optional[dict]:
    """The shipped configuration of a recommended rule, for "Restore default"."""
    return next((r for r in _entries() if r["id"] == rule_id), None)


def load_seed() -> int:
    from app.rules import store

    added = 0
    for entry in _entries():
        try:
            if store.insert_if_missing(entry):
                added += 1
        except Exception as e:
            logger.warning("Could not seed rule %r: %s", entry.get("id"), e)
    return added
