"""
Catalog — where everything belongs.

One tree of business concepts (industry › domain › process › subprocess) and
the tags that file agents, tools, connectors, workflows and libraries under it.
Its job is scoping: narrowing an inventory to what a request should consider,
and giving the rules engine typed facts to check.

    vocab        closed enums code branches on (tier, data class, capability, …)
    models       the concept and tag tables
    store        reads and writes over them
    seed_loader  the shipped tree, upserted on boot
    match        free text → concept ids
    tagging      one entry point for tagging a resource (fast | accurate | bulk)

The graph views over the catalog stay in ``app.ontology.graph`` and
``app.rag.unified_graph``.
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
