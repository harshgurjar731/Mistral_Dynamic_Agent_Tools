"""
Cleanup — Settings → Cleanup.

Deletes what the platform has accumulated, one area at a time or all of it,
and puts the project back where a fresh install starts: the built-in rules,
vocabulary, process template and safety rules seeded again, the predefined
native tools kept, and the platform's own agents (query optimiser, ontology
architect) left alone, as a fresh install would create them on boot anyway.

Each area is a ``Target`` in ``targets.py`` with a preview (what it would
remove) and a purge (remove it). See routes/cleanup.py for the API.
"""

from app.cleanup.targets import TARGETS, preview, run

__all__ = ["TARGETS", "preview", "run"]
