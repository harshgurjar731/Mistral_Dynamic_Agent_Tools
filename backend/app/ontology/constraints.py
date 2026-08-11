"""
Ontology constraints — the checks a plain taxonomy cannot express.

Structural validation (``workflow_engine.validation``) asks "is this graph
well-formed". These rules ask "does this graph make sense given what we know
about the resources in it" — questions that need typed relations, not just a
hierarchy:

* an agent **requires** a capability nothing attached **provides**
* a step handling personal data flows into a connector that **egresses to** a
  third party
* the entry step is not **governed by** a foundation guardrail

Kept in a separate module, and separate from the structural validator, because
these depend on live inventory (which agent has which connector attached) while
the structural rules depend only on the definition. Mixing them would make the
structural validator need network access.

Every rule fails open. An unannotated resource produces no finding — silence
here means "nothing known", never "nothing wrong". Reporting a missing
capability on an agent nobody has annotated yet would train people to ignore
the validator.
"""

import logging
from typing import Iterable

from app.ontology import store
from app.ontology.vocab import (
    RESTRICTED_DATA_CLASSES,
    AgentTier,
    Predicate,
    SubjectType,
)
from app.services.workflow_engine.models import (
    StepType,
    ValidationIssue,
    WorkflowDefinition,
)

logger = logging.getLogger(__name__)


def _issue(severity: str, code: str, message: str, step_id: str | None = None,
           field: str | None = None) -> ValidationIssue:
    return ValidationIssue(
        severity=severity, code=code, message=message, step_id=step_id, field=field
    )


def _labels(concept_ids: Iterable[str]) -> str:
    """Human labels for concept ids, for messages people have to act on."""
    out = []
    for cid in concept_ids:
        concept = store.get_concept(cid)
        out.append(concept["label"] if concept else cid)
    return ", ".join(sorted(out))


def check(
    definition: WorkflowDefinition,
    agents_by_id: dict[str, dict] | None = None,
    connectors_by_id: dict[str, dict] | None = None,
) -> list[ValidationIssue]:
    """Run every ontology rule over a definition.

    ``agents_by_id`` and ``connectors_by_id`` are live inventory keyed by id.
    Without them the capability rules cannot run and are skipped rather than
    guessed at.
    """
    if not store.is_seeded():
        return []

    agents_by_id = agents_by_id or {}
    connectors_by_id = connectors_by_id or {}
    issues: list[ValidationIssue] = []

    try:
        issues += _check_capabilities(definition, agents_by_id, connectors_by_id)
        issues += _check_egress(definition, agents_by_id, connectors_by_id)
        issues += _check_guardrails(definition, agents_by_id)
    except Exception as e:
        # A broken rule must not block saving a workflow.
        logger.warning("Ontology constraint check failed: %s", e)

    return issues


# ── Capability coverage ────────────────────────────────────────────────────


def _check_capabilities(
    definition: WorkflowDefinition,
    agents_by_id: dict[str, dict],
    connectors_by_id: dict[str, dict],
) -> list[ValidationIssue]:
    """An agent must be able to reach what it says it needs.

    This is the rule that earns the ontology its keep: it turns "this agent was
    supposed to read GitHub but nobody attached the connector" from a runtime
    failure, paid for after the upstream steps have run, into an edit-time one.
    """
    issues: list[ValidationIssue] = []

    for step in definition.steps:
        if step.type != StepType.AGENT:
            continue
        agent_id = (step.config or {}).get("agent_id")
        if not agent_id or agent_id not in agents_by_id:
            continue

        required = set(
            store.annotations_for(SubjectType.AGENT.value, agent_id)
            .get(Predicate.REQUIRES_CAPABILITY.value, [])
        )
        if not required:
            continue

        agent = agents_by_id[agent_id]

        # Everything the agent can reach: its own tools, plus every capability
        # its attached connectors provide.
        provided: set[str] = set()
        for ref in agent.get("connectors") or []:
            connector_id = ref.get("connector_id") if isinstance(ref, dict) else ref
            if not connector_id:
                continue
            provided |= set(
                store.annotations_for(SubjectType.CONNECTOR.value, connector_id)
                .get(Predicate.PROVIDES_CAPABILITY.value, [])
            )
        for tool_name in agent.get("tools") or []:
            name = tool_name if isinstance(tool_name, str) else (
                tool_name.get("function", {}).get("name") or tool_name.get("type") or ""
            )
            if name:
                provided |= set(
                    store.annotations_for(SubjectType.TOOL.value, name)
                    .get(Predicate.PROVIDES_CAPABILITY.value, [])
                )

        # A capability is satisfied by anything at or below it: an agent
        # needing "integration" is served by a connector providing
        # "integration.read".
        satisfied = set()
        for capability in required:
            if store.descendants(capability) & provided:
                satisfied.add(capability)

        missing = required - satisfied
        # Reasoning capabilities need nothing attached — the model itself is
        # the provider — so they are never reported as gaps.
        missing = {c for c in missing if not c.startswith("capability.reasoning")}

        if missing:
            # Severity follows provenance. A requirement a person stated is
            # worth blocking a publish over; one the backfill guessed is worth
            # mentioning, because guessed annotations are wrong often enough
            # that erroring on them would train people to ignore the validator.
            sources = store.annotation_sources(
                SubjectType.AGENT.value, agent_id, Predicate.REQUIRES_CAPABILITY.value
            )
            confirmed = any(sources.get(c) != "inferred" for c in missing)
            severity = "error" if confirmed else "warning"
            hint = (
                "Attach a tool or connector, or drop the requirement from the agent's "
                "annotations."
                if confirmed else
                "This requirement was inferred automatically and may be wrong — confirm or "
                "remove it on the agent."
            )
            issues.append(_issue(
                severity, "ontology.capability_gap",
                f"Agent '{agent.get('name', agent_id)}' needs {_labels(missing)}, but nothing "
                f"attached to it provides that. {hint}",
                step.id, "agent_id",
            ))

    return issues


# ── Data egress ────────────────────────────────────────────────────────────


def _check_egress(
    definition: WorkflowDefinition,
    agents_by_id: dict[str, dict],
    connectors_by_id: dict[str, dict],
) -> list[ValidationIssue]:
    """Restricted data must not reach a third-party connector.

    Reachability is computed over the graph rather than per step: the risk is
    an upstream step that *produces* personal data flowing into a downstream
    connector call, which a step-local check would never see.
    """
    issues: list[ValidationIssue] = []
    steps_by_id = {s.id: s for s in definition.steps}

    def data_classes_of(step) -> set[str]:
        if step.type == StepType.AGENT:
            agent_id = (step.config or {}).get("agent_id")
            if agent_id:
                return set(
                    store.annotations_for(SubjectType.AGENT.value, agent_id)
                    .get(Predicate.HANDLES_DATA_CLASS.value, [])
                )
        return set()

    # Everything each step could have received from upstream.
    inherited: dict[str, set[str]] = {s.id: set() for s in definition.steps}

    def walk(step_id: str, carried: set[str], seen: frozenset[str]) -> None:
        step = steps_by_id.get(step_id)
        if step is None or step_id in seen:
            return
        carried = carried | data_classes_of(step)
        inherited[step_id] |= carried

        targets = list(step.next_steps or [])
        if step.type == StepType.CONDITION:
            for key in ("true_step", "false_step"):
                target = (step.config or {}).get(key)
                if isinstance(target, str) and target:
                    targets.append(target)

        for target in targets:
            walk(target, carried, seen | {step_id})

    if definition.entry_step:
        walk(definition.entry_step, set(), frozenset())

    for step in definition.steps:
        if step.type != StepType.CONNECTOR:
            continue
        connector_id = (step.config or {}).get("connector_id")
        if not connector_id:
            continue

        egress = store.annotations_for(SubjectType.CONNECTOR.value, connector_id).get(
            Predicate.EGRESSES_TO.value, []
        )
        if not egress:
            continue

        restricted = {
            cid for cid in inherited.get(step.id, set())
            if cid.rsplit(".", 1)[-1] in RESTRICTED_DATA_CLASSES
        }
        if restricted:
            name = connectors_by_id.get(connector_id, {}).get("name", connector_id)
            issues.append(_issue(
                "error", "ontology.restricted_egress",
                f"{_labels(restricted)} reaches '{name}', which sends data to a third party. "
                f"Remove the upstream step that introduces it, or drop the egress annotation "
                f"if this connector is in fact internal.",
                step.id, "connector_id",
            ))

    return issues


# ── Guardrail coverage ─────────────────────────────────────────────────────


def _check_guardrails(
    definition: WorkflowDefinition,
    agents_by_id: dict[str, dict],
) -> list[ValidationIssue]:
    """A workflow taking user input should open with a foundation agent.

    Advisory, not an error. Plenty of legitimate workflows are triggered by
    trusted upstream systems rather than a person, and the validator has no way
    to tell which — so this informs rather than blocks.
    """
    if not definition.entry_step or not definition.steps:
        return []

    entry = next((s for s in definition.steps if s.id == definition.entry_step), None)
    if entry is None or entry.type != StepType.AGENT:
        return []

    agent_id = (entry.config or {}).get("agent_id")
    if not agent_id:
        return []

    tier = store.tier_for_agent(agent_id)
    if tier is None:
        return []          # unannotated — say nothing

    if tier != AgentTier.FOUNDATION.value:
        name = agents_by_id.get(agent_id, {}).get("name", agent_id)
        return [_issue(
            "warning", "ontology.no_entry_guardrail",
            f"The workflow opens on '{name}', which is a {tier.replace('_', ' ')} agent. "
            f"Workflows that take untrusted input usually open with a foundation guardrail "
            f"(moderation or topic control) before any business logic runs.",
            entry.id, "agent_id",
        )]

    return []
