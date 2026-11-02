"""
Ontology graph views.

The taxonomy, tags and tagging moved to :mod:`app.catalog`, and industry
knowledge to :mod:`app.knowledge`. What stays here is the graph built over
them (``graph``); the other modules in this package alias their new homes so
old imports keep working.
"""

from app.catalog.vocab import (  # noqa: F401
    AGENT_TIERS,
    AgentTier,
    DataClass,
    Predicate,
    Scheme,
    SubjectType,
    tier_labels,
    tier_rules_block,
)
