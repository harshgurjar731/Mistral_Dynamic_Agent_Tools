"""
Ontology — the platform's controlled vocabulary and the relations over it.

Two things live here, and the distinction matters:

* **Taxonomy** — hierarchical `is-a` classification. Agent tiers, business
  domains, capability families. Its job is retrieval: narrowing a 40-agent
  inventory to the handful a planning request should actually consider.
* **Ontology** — typed relations between resources (`requires`, `provides`,
  `egresses-to`). Its job is inference and constraint checking: proving an
  agent can reach the service it needs, before a workflow runs.

`vocab` holds the closed enums that code branches on. Everything open-ended —
domains, capabilities — lives in the database so it can grow without a deploy.
"""

from app.ontology.vocab import (  # noqa: F401
    AGENT_TIERS,
    AgentTier,
    DataClass,
    Predicate,
    Scheme,
    SubjectType,
    tier_labels,
    tier_rules_block,
)
