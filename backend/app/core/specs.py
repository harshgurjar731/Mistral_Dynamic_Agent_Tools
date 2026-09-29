"""
Specs — Typed carriers for the decisions each orchestration layer makes.

The orchestrators used to produce their whole output in one LLM call: a single
completion returned an agent's name, tier, model, temperature, tools,
connectors, libraries and instructions together, and a single completion
returned an entire workflow DAG. One call juggling nine concerns answers each
of them shallowly — the instructions in particular came back as a sentence
often short enough to trip the length fallback.

Each field group below is now decided by its own layer, in its own completion,
against a prompt that asks about nothing else. These dataclasses are how those
independent decisions accumulate into one object.

Every field a layer owns is Optional and defaults to ``None`` — meaning "no
layer has decided this yet". ``merge_from`` relies on that: it copies only what
the other spec actually set, so a ParallelGroup branch that decided one facet
cannot blank out a sibling's work when the branches are merged back together.
"""

from __future__ import annotations

import copy
import json
from dataclasses import dataclass, field, fields
from typing import Any, Optional


def _merge_optional(target: Any, other: Any) -> None:
    """Copy every field ``other`` actually set onto ``target``.

    A field is "set" when it is not ``None``. Empty list and empty dict are
    real decisions — "this agent needs no connectors" is an answer, not a
    silence — so they are copied like any other value.
    """
    for f in fields(target):
        value = getattr(other, f.name, None)
        if value is None:
            continue
        existing = getattr(target, f.name, None)
        # ``rationale`` accumulates across layers rather than being replaced;
        # every layer contributes the reasoning behind its own decision.
        if f.name == "rationale" and isinstance(existing, dict) and isinstance(value, dict):
            existing.update(value)
            continue
        setattr(target, f.name, value)


# ── Agent orchestration ─────────────────────────────────────────────────────


@dataclass
class RequirementSpec:
    """What the user actually needs — decided by RequirementAnalysisLayer.

    Every downstream agent layer reads this instead of re-reading the raw
    query, so each of them reasons about a structured problem statement rather
    than re-deriving the same understanding from scratch.
    """

    intent: str = ""
    task_type: str = ""             # lookup | analysis | generation | transformation | conversation
    domain: str = ""                # free-text domain label, e.g. "mortgage lending"
    deliverable: str = ""           # what the user should be holding at the end
    complexity: str = "moderate"    # simple | moderate | complex
    modality: str = "text"          # text | image | mixed

    # Capability signals. Each maps to a downstream layer's central question,
    # so that layer starts from a yes/no rather than an open-ended judgement.
    needs_realtime_data: bool = False
    needs_documents: bool = False
    needs_external_system: bool = False
    needs_relationship_reasoning: bool = False
    needs_computation: bool = False

    success_criteria: list[str] = field(default_factory=list)
    constraints: list[str] = field(default_factory=list)
    risk_factors: list[str] = field(default_factory=list)
    unknowns: list[str] = field(default_factory=list)

    def as_prompt_block(self) -> str:
        """Render for injection into a downstream layer's user prompt."""
        return json.dumps(
            {
                "intent": self.intent,
                "task_type": self.task_type,
                "domain": self.domain,
                "deliverable": self.deliverable,
                "complexity": self.complexity,
                "modality": self.modality,
                "needs_realtime_data": self.needs_realtime_data,
                "needs_documents": self.needs_documents,
                "needs_external_system": self.needs_external_system,
                "needs_relationship_reasoning": self.needs_relationship_reasoning,
                "needs_computation": self.needs_computation,
                "success_criteria": self.success_criteria,
                "constraints": self.constraints,
                "risk_factors": self.risk_factors,
                "unknowns": self.unknowns,
            },
            indent=2,
        )


#: Moderation categories, per Mistral moderation model version. These mirror
#: ``routes.agents.GuardrailCategoryThresholdsRequest`` — the platform's own
#: guardrail surface — so a decision made here is expressible verbatim as the
#: agent-creation payload it becomes.
V1_CATEGORIES = (
    "sexual", "hate_and_discrimination", "violence_and_threats",
    "dangerous_and_criminal_content", "selfharm", "health", "financial", "law", "pii",
)
V2_CATEGORIES = (
    "sexual", "hate_and_discrimination", "violence_and_threats", "dangerous",
    "criminal", "selfharm", "health", "financial", "law", "pii", "jailbreaking",
)


@dataclass
class GuardrailSpec:
    """Mistral guardrail configuration for one agent.

    Decided by GuardrailConfigLayer from the *assembled* configuration rather
    than from the raw query: an agent holding a database tool and a write-
    capable connector warrants different moderation from one that summarises
    text, and that is only knowable once the capability layers have reported.

    This is the platform's own guardrail mechanism — a moderation model that
    scores every turn against named categories and blocks above a threshold —
    not prose appended to the agent's instructions. Instructions are advice the
    model may disregard; this is enforced outside it. ``as_request`` produces
    exactly the dict ``agent_service.build_guardrails`` consumes, so the
    decision reaches agent creation without a translation step that could drift.
    """

    #: False leaves the agent with no guardrail config at all, which is correct
    #: for an agent whose subject matter carries no moderation risk.
    enabled: bool = False
    version: str = "v2"                 # v1 | v2 — v2 adds jailbreaking, splits dangerous/criminal
    action: str = "block"               # block | none  (none scores but does not stop the turn)
    #: Category -> score at which that category trips. Lower is stricter.
    #: Categories left out use the moderation model's own default.
    thresholds: dict[str, float] = field(default_factory=dict)
    #: True scores only the categories named above, ignoring the rest.
    ignore_other_categories: bool = False
    #: Fail closed when moderation itself errors.
    block_on_error: bool = True

    #: Not part of the Mistral config — a bound on the agent's tool-call loop,
    #: enforced by the execution layer. Kept here because it is decided by the
    #: same layer for the same reason.
    max_tool_rounds: int = 5

    rationale: str = ""

    def categories(self) -> tuple[str, ...]:
        return V1_CATEGORIES if self.version == "v1" else V2_CATEGORIES

    def as_request(self) -> Optional[dict]:
        """The guardrail dict for agent creation, or None when not configured."""
        if not self.enabled:
            return None
        moderation: dict[str, Any] = {"action": self.action}
        if self.ignore_other_categories:
            moderation["ignore_other_categories"] = True
        valid = self.categories()
        thresholds = {
            k: v for k, v in self.thresholds.items()
            if k in valid and isinstance(v, (int, float))
        }
        if thresholds:
            moderation["custom_category_thresholds"] = thresholds
        key = "moderation_llm_v1" if self.version == "v1" else "moderation_llm_v2"
        return {"block_on_error": self.block_on_error, key: moderation}

    def describe(self) -> dict:
        """Flat view for the timeline, ordered strictest category first."""
        return {
            "enabled": self.enabled,
            "version": self.version,
            "action": self.action,
            "block_on_error": self.block_on_error,
            "ignore_other_categories": self.ignore_other_categories,
            "max_tool_rounds": self.max_tool_rounds,
            # Strictest first, but a disabled category (1.0) sorts last: it is
            # an exemption, not the most permissive setting on a scale.
            "thresholds": [
                {"category": k, "threshold": v, "disabled": v >= 1.0}
                for k, v in sorted(
                    self.thresholds.items(), key=lambda kv: (kv[1] >= 1.0, kv[1])
                )
            ],
            "rationale": self.rationale,
        }


@dataclass
class AgentSpec:
    """One agent's full configuration, assembled facet by facet.

    Each field group is commented with the layer that owns it. No layer writes
    outside its own group, which is what makes the ParallelGroup merge safe.
    """

    # IdentityLayer — tier drives the naming convention, so the two are one
    # decision rather than two.
    agent_name: Optional[str] = None
    description: Optional[str] = None
    tier: Optional[str] = None

    # ToolSelectionLayer
    tools: Optional[list[str]] = None

    # ConnectorSelectionLayer
    connectors: Optional[list[str]] = None

    # LibrarySelectionLayer
    document_library_ids: Optional[list[str]] = None
    knowledge_graph: Optional[bool] = None
    #: Set when the agent needs its own documents but no existing library fits.
    #: LibraryProvisioningLayer creates it empty so the user can fill it later —
    #: an agent wired to a library that does not exist yet is more useful than
    #: one silently left without documents it was designed around.
    requested_library: Optional[dict] = None

    # ModelSelectionLayer
    model: Optional[str] = None
    temperature: Optional[float] = None

    # GuardrailConfigLayer
    guardrails: Optional[GuardrailSpec] = None

    # AgentRuleSelectionLayer — optional agent rules chosen for this agent,
    # as ``[{rule_id, name, reason, source}]``. Always-on rules are not listed;
    # they apply to every agent regardless.
    rules: Optional[list[dict]] = None

    # InstructionAuthoringLayer
    agent_instructions: Optional[str] = None

    # AgentAssemblyLayer
    agent_id: Optional[str] = None

    # Per-facet reasoning, keyed by layer name. Surfaced to the UI so a user
    # can see why each decision went the way it did.
    rationale: dict[str, str] = field(default_factory=dict)

    def merge_from(self, other: "AgentSpec") -> None:
        _merge_optional(self, other)

    def copy(self) -> "AgentSpec":
        return copy.deepcopy(self)

    def to_config(self) -> dict:
        """Flatten to the dict shape the rest of the codebase already expects.

        Agent creation, the ontology autotagger and the SSE payloads were all
        written against the flat config the single-call orchestrator returned.
        Keeping that shape here means the decomposition stops at the pipeline
        boundary instead of rippling through every consumer.
        """
        return {
            "agent_name": self.agent_name or "Dynamic Agent",
            "description": self.description or "Dynamically created agent",
            "tier": self.tier or "foundation",
            "model": self.model or "mistral-large-latest",
            "temperature": self.temperature if self.temperature is not None else 0.5,
            "tools": list(self.tools or []),
            "connectors": list(self.connectors or []),
            "document_library_ids": list(self.document_library_ids or []),
            "knowledge_graph": bool(self.knowledge_graph),
            "agent_instructions": self.agent_instructions or "",
            # The Mistral guardrail payload, or None. Never rendered into the
            # instructions — the platform enforces this outside the model.
            "guardrails": self.guardrails.as_request() if self.guardrails else None,
            "guardrail_spec": self.guardrails,
            "rules": list(self.rules or []),
            "rationale": dict(self.rationale),
        }


# ── Workflow orchestration ──────────────────────────────────────────────────


@dataclass
class CapabilitySpec:
    """One capability a goal requires — produced by GoalDecompositionLayer.

    Deliberately not an agent: decomposition decides *what work must happen*,
    and the reuse layer decides separately whether an agent for it already
    exists. Collapsing those two questions is what previously let the planner
    invent agents that were already in the inventory.
    """

    id: str = ""
    name: str = ""
    purpose: str = ""
    tier: str = "domain"                # foundation | domain | use_case
    inputs: list[str] = field(default_factory=list)
    outputs: list[str] = field(default_factory=list)
    depends_on: list[str] = field(default_factory=list)
    parallelisable: bool = False

    # Filled by ExecutionModeLayer. Decomposition states the work; this says
    # how it runs, judged against the platform's inventory and against cost.
    kind: str = "agent"                 # agent | activity | connector
    mode_rationale: str = ""
    agent_needs_tools: bool = False
    #: For kind "connector": the attachable connector chosen for it.
    connector_id: Optional[str] = None

    # Filled by CapabilityReuseLayer.
    reuse_agent_id: Optional[str] = None
    reuse_reason: Optional[str] = None
    #: Whether a reused agent's safety posture actually fits this workflow.
    #: "insufficient" forces a create — see the reuse layer.
    guardrail_fit: Optional[str] = None
    guardrail_gap: Optional[str] = None

    # Filled by AgentDesignLayer.
    spec: Optional[AgentSpec] = None


@dataclass
class WorkflowSpec:
    """A workflow under construction, accumulated across the planning layers."""

    goal: str = ""
    workflow_name: Optional[str] = None
    description: Optional[str] = None

    # ResourceInventoryLayer
    inventory: dict = field(default_factory=dict)

    # GoalDecompositionLayer / CapabilityReuseLayer / AgentDesignLayer
    capabilities: list[CapabilitySpec] = field(default_factory=list)

    # AgentProvisioningLayer — the flat dicts the DAG prompts consume.
    provisioned_agents: list[dict] = field(default_factory=list)

    # StepTopologyLayer — steps without data flow wired in yet.
    topology: Optional[dict] = None

    # DataFlowLayer — the same steps with templates, arguments and variables.
    dag: Optional[dict] = None

    # WorkflowGuardrailLayer
    guardrails: Optional[dict] = None

    # PersistenceLayer / RegistrationLayer
    definition: Any = None
    mistral_workflow_id: Optional[str] = None

    rationale: dict[str, str] = field(default_factory=dict)


# ── Code requirements (tools and activities) ────────────────────────────────


@dataclass
class CodeNeed:
    """Something the platform must be able to execute, before anyone has
    decided whether it already exists or what exactly it is.

    Every entry point that can cause code to be built — the chat pipeline's
    capability gap, the workflow planner's activity gap, an explicit request,
    and a workflow step whose activity has gone missing at run time — produces
    one of these and hands it to the code-requirement pipeline
    (``app.layers.codegen``). They used to each build their own specification,
    differently.
    """

    purpose: str = "tool"               # tool | activity
    origin: str = "explicit"            # chat | workflow | explicit | runtime
    intent: str = ""                    # what is needed, in words
    name_hint: str = ""
    goal: str = ""                      # the wider goal, for context
    #: Workflow capability this need serves: {"id", "name", "purpose", "inputs", "outputs"}.
    capability: dict = field(default_factory=dict)
    #: Neighbouring capabilities — what feeds this step and what reads its output.
    upstream: list[dict] = field(default_factory=list)
    downstream: list[dict] = field(default_factory=list)
    #: A partial specification a caller already has (e.g. the chat gap
    #: decision's parameters). Refined, not trusted.
    draft: dict = field(default_factory=dict)
    #: A complete stored requirement (runtime recovery) — skips authoring.
    requirement: Optional[dict] = None


@dataclass
class CodeRequirement:
    """SynthesisSpec v2 as the backend authors it — the tool service's contract."""

    name: str = ""
    description: str = ""
    purpose: str = "tool"
    kind: str = "pure"
    input_schema: dict = field(default_factory=lambda: {"type": "object", "properties": {}, "required": []})
    output_schema: Optional[dict] = None
    examples: list[dict] = field(default_factory=list)
    api_details: str = "No external API. This is a pure computation using the standard library."
    secrets: list[str] = field(default_factory=list)
    side_effects: str = "none"
    http_fixtures: list[dict] = field(default_factory=list)
    origin: str = "explicit"

    def as_request(self) -> dict:
        return {
            "name": self.name, "description": self.description, "purpose": self.purpose,
            "kind": self.kind, "input_schema": self.input_schema,
            "output_schema": self.output_schema, "examples": self.examples,
            "api_details": self.api_details, "secrets": self.secrets,
            "side_effects": self.side_effects, "http_fixtures": self.http_fixtures,
            "origin": self.origin,
        }

    @classmethod
    def from_dict(cls, data: dict) -> "CodeRequirement":
        known = {f.name for f in fields(cls)}
        return cls(**{k: copy.deepcopy(v) for k, v in (data or {}).items() if k in known})


@dataclass
class CodeResolution:
    """What the code-requirement pipeline concluded for one need."""

    status: str = "failed"              # reused | built | pending_approval | blocked | failed
    name: str = ""
    version: Optional[int] = None
    tool_id: Optional[int] = None
    purpose: str = "tool"
    reason: str = ""
    message: str = ""
    issues: list[str] = field(default_factory=list)
    requirement: Optional[CodeRequirement] = None
    output_schema: Optional[dict] = None
    review_required: bool = False

    @property
    def usable(self) -> bool:
        """True when the code exists and runs now."""
        return self.status in ("reused", "built")

    def as_dict(self) -> dict:
        return {
            "status": self.status, "tool_name": self.name, "version": self.version,
            "tool_id": self.tool_id, "purpose": self.purpose, "reason": self.reason,
            "message": self.message, "issues": list(self.issues),
            "requirement": self.requirement.as_request() if self.requirement else None,
            "output_schema": self.output_schema, "review_required": self.review_required,
        }
