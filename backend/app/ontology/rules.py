"""
Ontology rule engine — the declarative layer over ``ontology_rules``.

``constraints.py`` used to be four fixed Python functions. This module keeps
the same four reasoning patterns (reachability, DAG accumulation, tier lookup,
domain overlap) but runs them from data: an ``OntologyRule`` row picks a
``kind`` and supplies ``params``, so a rule can be added, disabled, or have its
parameters changed (which data classes are restricted, what a required tier
is) without a code change. It is deliberately not a generic condition
language — the four evaluators below are the reasoning the platform actually
needs; a rule row configures one of them rather than expressing new logic from
scratch.

Two things a plain check function cannot do, and the reason this module exists
rather than just parameterizing ``constraints.py`` in place:

* **Exceptions** — a specific subject can be granted a specific, reasoned,
  audited exemption from a specific rule (``RuleException``). This is applied
  as a post-filter here, not inside each evaluator, so every evaluator stays
  ignorant of exceptions and cannot accidentally skip recording a filtered
  finding.
* **Derived facts** — the ``derives_annotation`` kind writes a new annotation
  when its conditions hold, the general form of "role transformation": a fact
  produced by other facts rather than asserted by a person. Written with
  ``source="derived"`` so it is never mistaken for something a human confirmed.

Every evaluator fails open, same as before: an unannotated resource produces
no finding, never a false "wrong".
"""

import logging
from typing import Callable

from app.ontology import store
from app.ontology.vocab import AgentTier, Predicate, SubjectType
from app.services.workflow_engine.models import StepType, ValidationIssue, WorkflowDefinition

logger = logging.getLogger(__name__)

# (subject_type, subject_id, issue) — carried internally so the exception
# post-filter knows what each finding is about without parsing the message.
_Finding = tuple[str, str, ValidationIssue]


def _issue(severity: str, code: str, message: str, step_id: str | None = None,
           field: str | None = None) -> ValidationIssue:
    return ValidationIssue(severity=severity, code=code, message=message, step_id=step_id, field=field)


def _labels(concept_ids) -> str:
    out = []
    for cid in concept_ids:
        concept = store.get_concept(cid)
        out.append(concept["label"] if concept else cid)
    return ", ".join(sorted(out))


def check_rules(
    definition: WorkflowDefinition,
    agents_by_id: dict[str, dict] | None = None,
    connectors_by_id: dict[str, dict] | None = None,
) -> list[ValidationIssue]:
    """Run every approved rule over a definition, then apply exceptions.

    This is what ``constraints.check`` delegates to. ``agents_by_id`` and
    ``connectors_by_id`` are live inventory keyed by id — capability and
    cardinality rules cannot run without them and are skipped rather than
    guessed at, same policy as before.
    """
    if not store.is_seeded():
        return []

    agents_by_id = agents_by_id or {}
    connectors_by_id = connectors_by_id or {}

    findings: list[_Finding] = []
    for rule in store.list_rules(status="approved"):
        evaluator = _EVALUATORS.get(rule["kind"])
        if evaluator is None:
            logger.warning("Ontology rule '%s' has unknown kind '%s' — skipped", rule["id"], rule["kind"])
            continue
        try:
            for subject_type, subject_id, issue in evaluator(rule, definition, agents_by_id, connectors_by_id):
                findings.append((rule["id"], subject_type, subject_id, issue))
        except Exception as e:
            # A broken rule must not block saving a workflow.
            logger.warning("Ontology rule '%s' failed: %s", rule["id"], e)

    excepted = store.live_exceptions()
    return [
        issue for rule_id, subject_type, subject_id, issue in findings
        if (rule_id, subject_type, subject_id) not in excepted
    ]


# ── Capability coverage ────────────────────────────────────────────────────


def _eval_capability_gap(rule, definition, agents_by_id, connectors_by_id) -> list[_Finding]:
    """An agent must be able to reach what it says it needs.

    This is the rule that earns the ontology its keep: it turns "this agent was
    supposed to read GitHub but nobody attached the connector" from a runtime
    failure into an edit-time one.
    """
    out: list[_Finding] = []

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

        satisfied = {c for c in required if store.descendants(c) & provided}
        missing = required - satisfied
        # Reasoning capabilities need nothing attached — the model itself is
        # the provider — so they are never reported as gaps.
        missing = {c for c in missing if not c.startswith("capability.reasoning")}
        if not missing:
            continue

        sources = store.annotation_sources(
            SubjectType.AGENT.value, agent_id, Predicate.REQUIRES_CAPABILITY.value
        )
        confirmed = any(sources.get(c) != "inferred" for c in missing)
        severity = "error" if confirmed else "warning"
        hint = (
            "Attach a tool or connector, or drop the requirement from the agent's annotations."
            if confirmed else
            "This requirement was inferred automatically and may be wrong — confirm or remove it "
            "on the agent."
        )
        out.append((
            SubjectType.AGENT.value, agent_id,
            _issue(
                severity, "ontology.capability_gap",
                f"Agent '{agent.get('name', agent_id)}' needs {_labels(missing)}, but nothing "
                f"attached to it provides that. {hint}",
                step.id, "agent_id",
            ),
        ))

    return out


# ── Data egress ────────────────────────────────────────────────────────────


def _eval_egress(rule, definition, agents_by_id, connectors_by_id) -> list[_Finding]:
    """Restricted data must not reach a third-party connector.

    ``restricted_data_classes`` (bare values, e.g. ``["pii", "financial"]``)
    comes from ``rule["params"]`` rather than a module constant, so a
    different restricted set can be shipped per rule row without a deploy.
    """
    restricted_classes = set(rule["params"].get("restricted_data_classes") or [])
    if not restricted_classes:
        return []

    out: list[_Finding] = []
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
            if cid.rsplit(".", 1)[-1] in restricted_classes
        }
        if not restricted:
            continue

        name = connectors_by_id.get(connector_id, {}).get("name", connector_id)
        out.append((
            SubjectType.CONNECTOR.value, connector_id,
            _issue(
                rule["severity"], "ontology.restricted_egress",
                f"{_labels(restricted)} reaches '{name}', which sends data to a third party. "
                f"Remove the upstream step that introduces it, or drop the egress annotation if "
                f"this connector is in fact internal.",
                step.id, "connector_id",
            ),
        ))

    return out


# ── Guardrail coverage ─────────────────────────────────────────────────────


def _eval_guardrail(rule, definition, agents_by_id, connectors_by_id) -> list[_Finding]:
    """A workflow taking user input should open with a foundation agent."""
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
        return []  # unannotated — say nothing

    required_tier = rule["params"].get("required_tier", AgentTier.FOUNDATION.value)
    if tier == required_tier:
        return []

    name = agents_by_id.get(agent_id, {}).get("name", agent_id)
    return [(
        SubjectType.AGENT.value, agent_id,
        _issue(
            rule["severity"], "ontology.no_entry_guardrail",
            f"The workflow opens on '{name}', which is a {tier.replace('_', ' ')} agent. "
            f"Workflows that take untrusted input usually open with a foundation guardrail "
            f"(moderation or topic control) before any business logic runs.",
            entry.id, "agent_id",
        ),
    )]


# ── Document library coverage ──────────────────────────────────────────────


def _eval_library_domain(rule, definition, agents_by_id, connectors_by_id) -> list[_Finding]:
    """An agent's documents should be from the domain it serves."""
    from app.rag import library_domain

    out: list[_Finding] = []

    for step in definition.steps:
        if step.type != StepType.AGENT:
            continue
        agent_id = (step.config or {}).get("agent_id")
        agent = agents_by_id.get(agent_id or "")
        if not agent:
            continue

        library_ids = _library_ids_of(agent)
        agent_domains = set(
            store.annotations_for(SubjectType.AGENT.value, agent_id)
            .get(Predicate.SERVES_DOMAIN.value, [])
        )
        if not agent_domains or not library_ids:
            continue

        reachable: set[str] = set()
        for concept_id in agent_domains:
            reachable |= store.descendants(concept_id)
            reachable |= store.ancestors(concept_id, include_self=True)

        for library_id in library_ids:
            library_domains = set(library_domain.domains_for(library_id))
            if not library_domains:
                continue
            if library_domains & reachable:
                continue
            out.append((
                SubjectType.LIBRARY.value, library_id,
                _issue(
                    rule["severity"], "library_domain_mismatch",
                    f"Agent '{agent.get('name') or agent_id}' serves {_labels(agent_domains)} but "
                    f"reads a document library scoped to {_labels(library_domains)}. It will cite "
                    f"those documents as if they were about its own domain.",
                    step.id,
                ),
            ))

    return out


def _library_ids_of(agent: dict) -> list[str]:
    try:
        from app.rag.scope import library_ids_from_tools

        return library_ids_from_tools(agent.get("tools") or [])
    except Exception:
        return []


# ── Cardinality (formal axioms) ────────────────────────────────────────────

#: Which predicate on a step's config carries the id of the subject to check,
#: per subject type. Cardinality is scoped to resources the workflow actually
#: references — the same scoping every other rule kind uses — because nothing
#: enumerates "every agent that has ever existed" cheaply.
_SUBJECT_STEP_KEY = {
    SubjectType.AGENT.value: (StepType.AGENT, "agent_id"),
    SubjectType.CONNECTOR.value: (StepType.CONNECTOR, "connector_id"),
}


def _eval_cardinality(rule, definition, agents_by_id, connectors_by_id) -> list[_Finding]:
    """A subject must have between ``min`` and ``max`` annotations for a predicate.

    Params: ``subject_type``, ``predicate``, ``min`` (default 0), ``max``
    (default None — unbounded). This is what closes the "formal axioms" gap a
    plain taxonomy has no way to express, e.g. "every agent has exactly one tier".
    """
    subject_type = rule["params"].get("subject_type")
    predicate = rule["params"].get("predicate")
    minimum = rule["params"].get("min", 0)
    maximum = rule["params"].get("max")
    if not subject_type or not predicate:
        return []

    step_spec = _SUBJECT_STEP_KEY.get(subject_type)
    if not step_spec:
        return []
    step_type, config_key = step_spec
    inventory = agents_by_id if subject_type == SubjectType.AGENT.value else connectors_by_id

    out: list[_Finding] = []
    seen: set[str] = set()
    for step in definition.steps:
        if step.type != step_type:
            continue
        subject_id = (step.config or {}).get(config_key)
        if not subject_id or subject_id not in inventory or subject_id in seen:
            continue
        seen.add(subject_id)

        count = len(store.annotations_for(subject_type, subject_id).get(predicate, []))
        if count < minimum or (maximum is not None and count > maximum):
            name = inventory.get(subject_id, {}).get("name", subject_id)
            bound = f"at least {minimum}" if maximum is None else f"between {minimum} and {maximum}"
            out.append((
                subject_type, subject_id,
                _issue(
                    rule["severity"], "ontology.cardinality",
                    f"'{name}' has {count} '{predicate}' annotation(s); this rule requires {bound}.",
                    step.id, config_key,
                ),
            ))

    return out


# ── Derived / conditional facts ("role transformation") ───────────────────


def _eval_derives_annotation(rule, definition, agents_by_id, connectors_by_id) -> list[_Finding]:
    """Write a new annotation when its conditions hold — a fact from other facts.

    Params: ``when`` — a list of ``{"predicate": ..., "concept_id": ...}`` or
    ``{"predicate": ..., "concept_id_prefix": ...}`` conditions, all of which
    must hold; ``write`` — ``{"predicate": ..., "concept_id": ...}``, the
    annotation to add. Scoped to agents referenced by the workflow, same as
    the other kinds. Never silent about the mutation: every write it makes is
    also surfaced as a finding, so nothing changes a resource's classification
    without showing up somewhere a person will see it.
    """
    conditions = rule["params"].get("when") or []
    write = rule["params"].get("write") or {}
    write_predicate, write_concept = write.get("predicate"), write.get("concept_id")
    if not conditions or not write_predicate or not write_concept:
        return []

    out: list[_Finding] = []
    seen: set[str] = set()
    for step in definition.steps:
        if step.type != StepType.AGENT:
            continue
        agent_id = (step.config or {}).get("agent_id")
        if not agent_id or agent_id not in agents_by_id or agent_id in seen:
            continue
        seen.add(agent_id)

        annotations = store.annotations_for(SubjectType.AGENT.value, agent_id)

        def holds(cond: dict) -> bool:
            values = annotations.get(cond.get("predicate"), [])
            if "concept_id" in cond:
                return cond["concept_id"] in values
            if "concept_id_prefix" in cond:
                return any(v.startswith(cond["concept_id_prefix"]) for v in values)
            return False

        if not all(holds(c) for c in conditions):
            continue
        if write_concept in annotations.get(write_predicate, []):
            continue  # already holds — nothing to derive

        store.annotate(SubjectType.AGENT.value, agent_id, write_predicate, write_concept, source="derived")
        agent_name = agents_by_id[agent_id].get("name", agent_id)
        out.append((
            SubjectType.AGENT.value, agent_id,
            _issue(
                "warning", "ontology.derived_annotation",
                f"Rule '{rule['id']}' derived that '{agent_name}' now has "
                f"'{write_predicate}' = '{_labels([write_concept])}', based on its existing "
                f"annotations. Review it like any other automatic classification.",
                step.id, "agent_id",
            ),
        ))

    return out


_EVALUATORS: dict[str, Callable] = {
    "capability_gap": _eval_capability_gap,
    "egress": _eval_egress,
    "guardrail": _eval_guardrail,
    "library_domain": _eval_library_domain,
    "cardinality": _eval_cardinality,
    "derives_annotation": _eval_derives_annotation,
}
