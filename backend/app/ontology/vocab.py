"""
Closed vocabularies — the enums application code branches on.

Anything in this module is a *closed* set: adding a member changes behaviour
somewhere, so it needs a code change and a review. Open-ended vocabularies
(domains, capabilities) live in the concept store instead, where they can grow
without a deploy.

Before this module existed the agent tier was spelled out as string literals in
eleven files and inferred by substring match, which mis-filed
`foundation_final_response_generator` as a domain agent because the keyword list
said "final_response_generation" and the name said "generator". One definition,
imported everywhere, is what stops that recurring.
"""

from enum import Enum


class Scheme(str, Enum):
    """Concept schemes. Each is a separate hierarchy in the store."""

    AGENT_TIER = "agent_tier"
    DOMAIN = "domain"
    CAPABILITY = "capability"
    DATA_CLASS = "data_class"


class SubjectType(str, Enum):
    """Things an annotation can be attached to."""

    AGENT = "agent"
    TOOL = "tool"
    CONNECTOR = "connector"
    WORKFLOW = "workflow"
    LIBRARY = "library"


class Predicate(str, Enum):
    """Typed relations between a subject and a concept.

    The first three are taxonomy (classification). The last three are ontology
    proper — they carry enough meaning for the validator to reason with.
    """

    HAS_TIER = "has_tier"
    SERVES_DOMAIN = "serves_domain"
    HANDLES_DATA_CLASS = "handles_data_class"

    REQUIRES_CAPABILITY = "requires_capability"
    PROVIDES_CAPABILITY = "provides_capability"
    EGRESSES_TO = "egresses_to"


class AgentTier(str, Enum):
    """The three-tier agent hierarchy.

    Ordered broad → narrow. Reuse policy differs per tier and the planner
    prompt is generated from the descriptions below, so editing one of these
    strings changes what the model is told.
    """

    FOUNDATION = "foundation"
    DOMAIN = "domain"
    USE_CASE = "use_case"


AGENT_TIERS: tuple[str, ...] = tuple(t.value for t in AgentTier)

DEFAULT_TIER = AgentTier.DOMAIN


class DataClass(str, Enum):
    """Sensitivity of the data a step handles. Drives egress constraints."""

    PUBLIC = "public"
    INTERNAL = "internal"
    FINANCIAL = "financial"
    PII = "pii"


#: Data classes that must not reach a third-party connector.
RESTRICTED_DATA_CLASSES: frozenset[str] = frozenset({DataClass.PII.value, DataClass.FINANCIAL.value})


# ── Presentation + prompt generation ───────────────────────────────────────

_TIER_META: dict[AgentTier, dict[str, str]] = {
    AgentTier.FOUNDATION: {
        "label": "Foundation",
        "short": "Domain-agnostic safety, routing and quality gates.",
        "reuse": "ALWAYS reuse as-is. NEVER recreate, and never rewrite the instructions "
                 "for a new use case — a tier-1 agent handles every domain by design.",
        "naming": "Names must NOT include a domain or product word. "
                  "Good: 'Jailbreak Moderation Agent'. Bad: 'Mortgage Input Safety Agent'.",
    },
    AgentTier.DOMAIN: {
        "label": "Domain",
        "short": "Business logic shared across the products of one domain.",
        "reuse": "Reuse from inventory when one covers the capability semantically. "
                 "Create only when nothing does.",
        "naming": "Names reflect the business domain, not a product. "
                  "Good: 'Financial Risk Assessor'. Bad: 'Mortgage Risk Assessor'.",
    },
    AgentTier.USE_CASE: {
        "label": "Use case",
        "short": "Product-specific logic for one product type.",
        "reuse": "Reuse the agent matching the product type. Create only when no agent "
                 "for that product type exists.",
        "naming": "Names MUST include the product type. "
                  "Good: 'Mortgage Eligibility Assessor'. Bad: 'Eligibility Assessor'.",
    },
}


def tier_labels() -> list[dict[str, str]]:
    """Tier vocabulary for the API and the frontend selects."""
    return [
        {
            "value": tier.value,
            "label": _TIER_META[tier]["label"],
            "description": _TIER_META[tier]["short"],
        }
        for tier in AgentTier
    ]


def tier_rules_block() -> str:
    """Render the tier classification rules for the planner prompts.

    Generated rather than hand-written so a change to the vocabulary cannot
    drift out of step with the prose the model is shown.
    """
    lines = [
        "## Agent tier classification — complete before any create/reuse decision",
        "",
        "Every agent belongs to exactly one tier. Classify the required capability",
        "into a tier before deciding whether to reuse or create.",
        "",
    ]
    for index, tier in enumerate(AgentTier, start=1):
        meta = _TIER_META[tier]
        lines += [
            f"### Tier {index} — {meta['label'].upper()} (`{tier.value}`)",
            meta["short"],
            f"- Reuse rule: {meta['reuse']}",
            f"- Naming: {meta['naming']}",
            "",
        ]
    lines += [
        "### Pre-creation checklist",
        "Before setting is_reused=false on any agent, confirm all of:",
        "1. No inventory agent in the same tier covers the capability semantically.",
        "2. The capability genuinely belongs to this tier, not a broader one.",
        "3. The new agent's name follows that tier's naming convention.",
        "",
    ]
    return "\n".join(lines)


def coerce_tier(value: str | None) -> str:
    """Normalise anything tier-shaped to a valid tier value."""
    if not value:
        return DEFAULT_TIER.value
    candidate = str(value).strip().lower().replace("-", "_").replace(" ", "_")
    return candidate if candidate in AGENT_TIERS else DEFAULT_TIER.value
