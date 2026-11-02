"""
Agent archetypes — what shape of agent a capability needs, and how that shapes its design.

The decision itself is made by ``AgentArchetypeLayer``. This module holds what
the layers around it share: the per-type design instructions the design and
instruction layers append, and the rendering of a decided archetype.
"""

from __future__ import annotations

import logging
from typing import Any

logger = logging.getLogger(__name__)

#: What each primary type means for how the agent is written.
TYPE_INSTRUCTIONS: dict[str, str] = {
    "task": (
        "This is a TASK agent: a bounded job with a clear start and end. Give it a strict input "
        "and output contract, a fixed sequence of steps, and only the tools that job needs. It "
        "must not explore beyond the job or ask open questions; when input is outside the "
        "contract it returns a structured error instead of guessing."
    ),
    "conversational": (
        "This is a CONVERSATIONAL agent: built around dialogue. It clarifies ambiguous requests "
        "before acting, keeps context across turns, confirms before any change it makes, and "
        "hands a structured draft to the next step rather than acting on its own."
    ),
    "goal": (
        "This is a GOAL agent: it is given an outcome, not steps. It first writes a short plan, "
        "executes it step by step, checks progress against explicit stop criteria and re-plans "
        "when a step fails. It must state when it is done and why, and stop at its budget."
    ),
}

PATTERN_INSTRUCTIONS: dict[str, str] = {
    "tool_using_react": (
        "Alternate reasoning and tool calls: decide what is missing, call the one tool that "
        "provides it, read the result, then decide again."
    ),
    "planner_executor": (
        "Produce the plan as an explicit, inspectable list of steps (JSON) before executing any "
        "of them, so the plan can be reviewed."
    ),
    "reflective": (
        "Before returning, check the output against the validation criteria and the source "
        "material it was produced from; correct anything that does not hold, and say what was "
        "checked."
    ),
    "multi_agent": (
        "Delegate each sub-task to the sub-agent named for it and combine their results; do not "
        "redo a sub-agent's work yourself."
    ),
}


def describe(archetype: Any) -> str:
    """The design instructions for a decided archetype; "" for none."""
    if archetype is None:
        return ""
    primary = getattr(archetype, "primary_type", None) or (archetype.get("primary_type") if isinstance(archetype, dict) else None)
    if not primary or primary == "none":
        return ""
    patterns = getattr(archetype, "patterns", None)
    if patterns is None and isinstance(archetype, dict):
        patterns = archetype.get("patterns")
    criteria = getattr(archetype, "reflection_criteria", None)
    if criteria is None and isinstance(archetype, dict):
        criteria = archetype.get("reflection_criteria")
    lines = ["## Agent type", TYPE_INSTRUCTIONS.get(primary, "")]
    for pattern in patterns or []:
        text = PATTERN_INSTRUCTIONS.get(pattern)
        if text:
            lines.append(f"- {text}")
    if criteria:
        lines.append("Validation criteria the output is checked against: " + "; ".join(criteria))
    oversight = getattr(archetype, "oversight", None)
    if oversight is not None and getattr(oversight, "model", "") == "human_in_the_loop":
        if oversight.applies_to == "exceptions_only":
            lines.append("Return JSON that includes a boolean field `needs_review`: true when the case is "
                         "an exception a person must look at, false otherwise.")
        elif oversight.applies_to == "threshold_based" and oversight.threshold:
            lines.append(f"Return JSON that includes the field named in this review threshold: "
                         f"{oversight.threshold}.")
    lines.append("Write these behaviours into agent_instructions.")
    return "\n".join(line for line in lines if line)


def design_block(capability: Any) -> str:
    """Archetype instructions for a workflow capability's design prompt; "" when undecided."""
    text = describe(getattr(capability, "archetype", None))
    return "\n\n" + text if text else ""


# ── Applying a decided archetype to an agent ───────────────────────────────

_PREFERENCE_TIERS = {"large": "mistral-large-latest", "medium": "mistral-medium-latest",
                     "small": "mistral-small-latest"}


def model_for(archetype: Any, current: str) -> str:
    """The model an archetype prefers, when it prefers one the platform can run."""
    from app.config import resolve_agent_model, settings

    preference = getattr(archetype, "model_preference", None) or "platform_default"
    if preference == "reasoning":
        wanted = settings.AGENT_MODEL_REASONING
    else:
        wanted = _PREFERENCE_TIERS.get(preference)
    if not wanted:
        return current
    resolved = resolve_agent_model(wanted)
    # resolve_agent_model falls back to the default for an unselectable model;
    # keep what was chosen rather than silently downgrading it.
    return resolved if resolved != settings.DEFAULT_AGENT_MODEL or wanted == settings.DEFAULT_AGENT_MODEL else current


def tool_rounds(archetype: Any, current: int) -> int:
    """The archetype's round budget, never above the guardrail envelope's."""
    wanted = getattr(archetype, "max_tool_rounds", None)
    return min(current, int(wanted)) if wanted else current


def tag(subject_type: str, subject_id: str, archetype: Any) -> None:
    """File the agent under its type and patterns, so reuse can match on them. Never raises."""
    if archetype is None or not subject_id:
        return
    from app.catalog import store
    from app.catalog.vocab import Predicate, agent_pattern_concept, agent_type_concept

    try:
        if archetype.primary_type and archetype.primary_type != "none":
            store.set_annotations(subject_type, subject_id, Predicate.HAS_AGENT_TYPE.value,
                                  [agent_type_concept(archetype.primary_type)], source="pipeline")
        store.set_annotations(subject_type, subject_id, Predicate.HAS_PATTERN.value,
                              [agent_pattern_concept(p) for p in archetype.patterns], source="pipeline")
    except Exception as e:
        logger.debug("Could not tag %s %s with its archetype: %s", subject_type, subject_id, e)


def compatible(agent_id: str, archetype: Any) -> bool:
    """Whether an existing agent may be reused for work needing this archetype.

    An agent never tagged with a type predates archetypes and stays reusable;
    one tagged with a different primary type is not.
    """
    if archetype is None or not agent_id:
        return True
    from app.catalog import store
    from app.catalog.vocab import Predicate, agent_type_concept

    try:
        types = store.annotations_for("agent", agent_id).get(Predicate.HAS_AGENT_TYPE.value, [])
    except Exception:
        return True
    return not types or agent_type_concept(archetype.primary_type) in types
