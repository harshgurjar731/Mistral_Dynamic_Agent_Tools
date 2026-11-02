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
    #: Business processes and their subprocesses. A separate hierarchy from
    #: ``domain`` on purpose: goal matching, agent scoping and inventory
    #: filtering all walk the domain tree, and processes must not change what
    #: they see. A process is tied to its domain by a ``part_of_domain`` link
    #: (``ontology_concept_links``), not by ``parent_id``.
    PROCESS = "process"
    #: What shape of agent a capability needs, and the patterns layered on it.
    #: Closed: the archetype layer and the runtime branch on them.
    AGENT_TYPE = "agent_type"
    AGENT_PATTERN = "agent_pattern"


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
    #: The archetype an agent was built as, and its patterns.
    HAS_AGENT_TYPE = "has_agent_type"
    HAS_PATTERN = "has_pattern"
    SERVES_DOMAIN = "serves_domain"
    HANDLES_DATA_CLASS = "handles_data_class"

    REQUIRES_CAPABILITY = "requires_capability"
    PROVIDES_CAPABILITY = "provides_capability"
    EGRESSES_TO = "egresses_to"

    #: An agent, workflow or library built for (or grounded in) a business
    #: process. Written by the process-knowledge layer when a build used one,
    #: and editable by hand. Points at a concept in the ``process`` scheme.
    IMPLEMENTS_PROCESS = "implements_process"


class ConceptLinkPredicate(str, Enum):
    """Relations between two concepts in *different* schemes.

    ``parent_id`` is the is-a hierarchy inside one scheme; these are the edges
    that cross schemes, which a recursive parent walk must never follow.
    """

    #: process → the domain or subdomain it belongs to.
    PART_OF_DOMAIN = "part_of_domain"


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

#: Where foundation-tier agents are filed in the domain tree.
#:
#: A root concept, sibling to the industries rather than under one, because a
#: jailbreak moderator is not "a bit of BFSI" — it is orthogonal to all of them.
#: Foundation agents used to carry an empty domain list, which was true but
#: unstorable: nothing could tell a deliberately domain-agnostic agent from one
#: the backfill had never reached. Tagging them here makes that distinction a
#: fact in the store, and makes the domain tree a complete partition of the
#: inventory rather than a cover with a hole in it.
#:
#: It is a *classification* node, not a knowledge domain. `knowledge` strips it
#: before scoping a search — see `knowledge.domains_for_agent`.
SYSTEM_DOMAIN = "domain.system"


def domains_for_tier(tier: str | None) -> list[str] | None:
    """The domains a tier fixes, or None when the tier does not constrain them.

    Foundation is the only tier whose domain is a function of the tier itself.
    Returning None rather than an empty list for the others keeps "this tier
    decides nothing, go and infer" distinct from "this tier decides: nothing",
    which is what let the old empty-list contract be read both ways.
    """
    if coerce_tier(tier) == AgentTier.FOUNDATION.value:
        return [SYSTEM_DOMAIN]
    return None


class DataClass(str, Enum):
    """Sensitivity of the data a step handles. Drives egress constraints."""

    PUBLIC = "public"
    INTERNAL = "internal"
    FINANCIAL = "financial"
    PII = "pii"


#: Data classes that must not reach a third-party connector.
RESTRICTED_DATA_CLASSES: frozenset[str] = frozenset({DataClass.PII.value, DataClass.FINANCIAL.value})


class Capability(str, Enum):
    """What a resource can do, or needs done. Closed: the rules engine reasons over it.

    The hierarchy is in the dotted name — ``integration`` is covered by
    ``integration.read`` — so coverage is a prefix test, not a tree walk.
    """

    REASONING = "capability.reasoning"
    ASSESSMENT = "capability.reasoning.assessment"
    EXTRACTION = "capability.reasoning.extraction"
    SUMMARISATION = "capability.reasoning.summarisation"
    GOVERNANCE = "capability.governance"
    RETRIEVAL = "capability.retrieval"
    INTEGRATION = "capability.integration"
    INTEGRATION_READ = "capability.integration.read"
    INTEGRATION_WRITE = "capability.integration.write"
    COMPUTATION = "capability.computation"


CAPABILITIES: frozenset[str] = frozenset(c.value for c in Capability)


def capability_covers(required: str, provided: str) -> bool:
    """True when ``provided`` satisfies ``required`` — itself or something more specific."""
    return provided == required or provided.startswith(required + ".")


#: Schemes whose members are fixed in code. The seed writes them so tags can
#: point at them and the graph can draw them; the API refuses to edit them.
CLOSED_SCHEMES: frozenset[str] = frozenset({
    Scheme.AGENT_TIER.value, Scheme.CAPABILITY.value, Scheme.DATA_CLASS.value,
    Scheme.AGENT_TYPE.value, Scheme.AGENT_PATTERN.value,
})


# ── Agent archetypes and governance ────────────────────────────────────────


class AgentType(str, Enum):
    """The primary shape of an agent. ``none`` means the work needs no agent."""

    TASK = "task"
    GOAL = "goal"
    CONVERSATIONAL = "conversational"
    NONE = "none"


class AgentPattern(str, Enum):
    """Patterns layered on a task or goal agent."""

    TOOL_USING_REACT = "tool_using_react"
    PLANNER_EXECUTOR = "planner_executor"
    REFLECTIVE = "reflective"
    MULTI_AGENT = "multi_agent"


AGENT_TYPES: tuple[str, ...] = tuple(t.value for t in AgentType)
AGENT_PATTERNS: tuple[str, ...] = tuple(p.value for p in AgentPattern)


def agent_type_concept(value: str) -> str:
    return f"{Scheme.AGENT_TYPE.value}.{value}"


def agent_pattern_concept(value: str) -> str:
    return f"{Scheme.AGENT_PATTERN.value}.{value}"


class OversightModel(str, Enum):
    HUMAN_IN_THE_LOOP = "human_in_the_loop"
    HUMAN_ON_THE_LOOP = "human_on_the_loop"
    HUMAN_OUT_OF_THE_LOOP = "human_out_of_the_loop"
    NOT_APPLICABLE = "not_applicable"


OVERSIGHT_APPLIES_TO: tuple[str, ...] = ("every_transaction", "exceptions_only", "sample", "threshold_based")
ACTION_AUTHORITIES: tuple[str, ...] = ("read_only", "recommend", "draft", "write", "transact")
REVERSIBILITY: tuple[str, ...] = ("none", "reversible", "financial_impact", "irreversible")

#: Authority at or above which an action changes something outside the platform.
WRITING_AUTHORITIES: frozenset[str] = frozenset({"write", "transact"})
#: Reversibility at or above which a wrong action costs money or cannot be undone.
COSTLY_REVERSIBILITY: frozenset[str] = frozenset({"financial_impact", "irreversible"})


# ── The catalog tree ───────────────────────────────────────────────────────

#: Level names of the one tree, top down. Domains read industry › domain ›
#: subdomain by depth; processes hang under a domain node and read process ›
#: subprocess. Storage keeps processes in their own scheme joined by a
#: ``part_of_domain`` link, which ``store.tree_parent`` reads as the parent.
TREE_LEVELS: tuple[str, ...] = ("industry", "domain", "subdomain", "process", "subprocess")


# ── Presentation + prompt generation ───────────────────────────────────────

_TIER_META: dict[AgentTier, dict[str, str]] = {
    AgentTier.FOUNDATION: {
        "label": "Foundation",
        "short": "Domain-agnostic safety, routing and quality gates.",
        "reuse": "ALWAYS reuse as-is. NEVER recreate, and never rewrite the instructions "
                 "for a new use case — a tier-1 agent handles every domain by design.",
        "naming": "Names must NOT include a domain or product word. "
                  "Good: 'Jailbreak Moderation Agent'. Bad: 'Mortgage Input Safety Agent'.",
        "domain": f"Always `{SYSTEM_DOMAIN}` (System), never an industry. System sits "
                  "beside BFSI and Healthcare in the tree, so these agents are in scope "
                  "for every goal no matter what it is about.",
    },
    AgentTier.DOMAIN: {
        "label": "Domain",
        "short": "Business logic shared across the products of one domain.",
        "reuse": "Reuse from inventory when one covers the capability semantically. "
                 "Create only when nothing does.",
        "naming": "Names reflect the business domain, not a product. "
                  "Good: 'Financial Risk Assessor'. Bad: 'Mortgage Risk Assessor'.",
        "domain": "An industry or domain node (`domain.lending`), never System.",
    },
    AgentTier.USE_CASE: {
        "label": "Use case",
        "short": "Product-specific logic for one product type.",
        "reuse": "Reuse the agent matching the product type. Create only when no agent "
                 "for that product type exists.",
        "naming": "Names MUST include the product type. "
                  "Good: 'Mortgage Eligibility Assessor'. Bad: 'Eligibility Assessor'.",
        "domain": "A subdomain node (`domain.lending.mortgage`), never System.",
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
            f"- Classified under: {meta['domain']}",
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
