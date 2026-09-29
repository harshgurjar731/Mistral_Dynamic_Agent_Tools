"""
Annotate an agent the moment it is created.

Four of the five agent-creation paths in this project — the workflow planner,
the orchestrator's dynamic agent, the le Chat gateway and the step runner's
auto-create — produced agents with no annotations at all. Only agents made
through the Agent Studio were ever tagged, which is why the store held 257
inferred annotations against 2 stated ones: everything else arrived untagged
and waited for someone to run the backfill script.

An untagged agent is not excluded from planning — ``matcher.filter_subjects``
keeps anything it cannot classify — but it is never *narrowed on* either. So
scoping quietly loses precision as generated agents accumulate, which shows up
as more agents in every planner prompt rather than as a visible failure.

This module closes that at the source. It reuses the backfill's heuristics
rather than restating them, so there is one definition of how a domain or a
capability is guessed, and it writes ``source="inferred"`` so everything it
produces stays advisory: the validator reports a gap on an inferred annotation
as a warning, never as an error that blocks a publish.
"""

from __future__ import annotations

import logging
from typing import Optional

from app.ontology import backfill, matcher, store
from app.ontology.vocab import (
    Predicate,
    Scheme,
    SubjectType,
    coerce_tier,
    domains_for_tier,
)

logger = logging.getLogger(__name__)

#: Provenances that a guess must not overwrite.
#:
#: ``set_annotations`` replaces rather than merges, so re-tagging an agent
#: someone has already corrected in the Annotations tab would silently undo
#: their work — and demote a publish-blocking error back to a warning.
_PROTECTED_SOURCES = frozenset({"user", "seed"})


def _is_protected(
    subject_id: str, predicate: str, subject_type: str = SubjectType.AGENT.value
) -> bool:
    """True when a human (or the seed) has already spoken for this predicate."""
    try:
        sources = store.annotation_sources(subject_type, subject_id, predicate)
    except Exception:
        # Unreadable store — treat as protected. Declining to write is always
        # safer than overwriting something that might have been confirmed.
        return True
    return any(source in _PROTECTED_SOURCES for source in sources.values())


def _domains_for(tier: str, goal: Optional[str], name: str, body: str) -> list[str]:
    """Which domains to record.

    Foundation agents are domain-agnostic *by definition* — the tier exists for
    safety and quality gates that apply to every domain — so pinning one to an
    industry would be wrong even when the text of the request it was created
    for matches one strongly. They go under `domain.system` instead, which is a
    sibling of the industries rather than one of them: the claim being recorded
    is "belongs to no industry", not "belongs to industry X".

    For the other tiers the originating goal is the better signal when there is
    one: an agent generated for "assess a residential mortgage application"
    belongs to mortgage regardless of how its instructions happen to be worded.
    """
    fixed = domains_for_tier(tier)
    if fixed is not None:
        return fixed

    if goal:
        from_goal = matcher.match_domains(goal, limit=2)
        if from_goal:
            return from_goal

    return backfill.propose_domains_for(name, body)


def annotate_agent(
    agent_id: str,
    *,
    name: str = "",
    description: str = "",
    instructions: str = "",
    tier: Optional[str] = None,
    goal: Optional[str] = None,
    source: str = "inferred",
) -> dict:
    """Tag a freshly created agent. Best effort — never raises.

    ``goal`` is the request the agent was generated for, when the caller has
    one; it is a stronger domain signal than the generated instructions.

    Returns a summary of what was written, for logging.
    """
    written: dict[str, list[str]] = {}
    if not agent_id:
        return written

    try:
        if not store.is_seeded():
            return written

        resolved_tier = coerce_tier(tier)
        text = " ".join(part for part in (name, description, instructions) if part)

        requires, provides = backfill._split_capabilities(
            backfill._propose_capabilities(text)
        )

        candidates = {
            Predicate.HAS_TIER.value: [f"{Scheme.AGENT_TIER.value}.{resolved_tier}"],
            Predicate.SERVES_DOMAIN.value: _domains_for(
                resolved_tier, goal, name, f"{description} {instructions}"
            ),
            Predicate.REQUIRES_CAPABILITY.value: requires,
            Predicate.PROVIDES_CAPABILITY.value: provides,
        }

        known = {concept["id"] for concept in store.list_concepts()}

        for predicate, concept_ids in candidates.items():
            # An empty guess is not the same as "remove what is there" — this
            # writes only what it is confident enough to state.
            valid = [cid for cid in concept_ids if cid in known]
            if not valid or _is_protected(agent_id, predicate):
                continue
            store.set_annotations(
                SubjectType.AGENT.value, agent_id, predicate, valid, source=source
            )
            written[predicate] = valid

        if written:
            logger.info(
                "Auto-annotated agent %s (%s): %s",
                agent_id, name or "unnamed",
                {p: v for p, v in written.items()},
            )
    except Exception as e:
        # Annotation improves planning; it is never what makes an agent work.
        logger.warning("Could not auto-annotate agent %s: %s", agent_id, e)

    return written


def annotate_workflow(
    workflow_name: str,
    *,
    description: str = "",
    step_text: str = "",
    goal: Optional[str] = None,
    source: str = "inferred",
) -> dict:
    """Classify a workflow against the same vocabulary its agents use.

    A workflow has no tier — the vocabulary is called ``agent_tier`` and means
    reuse breadth, which is a property of an agent, not of a pipeline. What it
    does have is a domain and the capabilities its steps exercise, and those are
    what make it findable and checkable alongside everything else.

    ``step_text`` is the concatenated step ids and templates: a workflow's own
    name is often generic ("demo1") while its steps say exactly what it does.
    """
    written: dict[str, list[str]] = {}
    if not workflow_name:
        return written

    try:
        if not store.is_seeded():
            return written

        text = " ".join(
            part for part in (workflow_name.replace("_", " "), description, step_text) if part
        )

        domains = []
        if goal:
            domains = matcher.match_domains(goal, limit=2)
        if not domains:
            domains = backfill.propose_domains_for(
                workflow_name.replace("_", " "), f"{description} {step_text}"
            )

        requires, provides = backfill._split_capabilities(
            backfill._propose_capabilities(text)
        )

        candidates = {
            Predicate.SERVES_DOMAIN.value: domains,
            Predicate.REQUIRES_CAPABILITY.value: requires,
            Predicate.PROVIDES_CAPABILITY.value: provides,
        }

        known = {concept["id"] for concept in store.list_concepts()}
        subject = SubjectType.WORKFLOW.value

        for predicate, concept_ids in candidates.items():
            valid = [cid for cid in concept_ids if cid in known]
            if not valid or _is_protected(workflow_name, predicate, subject):
                continue
            store.set_annotations(subject, workflow_name, predicate, valid, source=source)
            written[predicate] = valid

        if written:
            logger.info("Auto-annotated workflow '%s': %s", workflow_name, written)
    except Exception as e:
        logger.warning("Could not auto-annotate workflow %s: %s", workflow_name, e)

    return written
