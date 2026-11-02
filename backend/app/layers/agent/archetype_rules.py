"""
Deciding an archetype without a model call, wherever the facts allow.

Tiers, highest precedence first:

  1. Always-on rules — enforced at run time (the rules engine caps tool rounds
     whatever is decided here), and the invariants in ``enforce_invariants``
  2. The process document — a declared agent design, and its governance
  3. Guidance with strength must / avoid and an effect
  4. Built-in rules — the execution profile mapped to a type
  5. Guidance with strength should / may and an effect
  6. The model, for capabilities nothing above decided (AgentArchetypeLayer)
  7. The default — exactly how agents were built before archetypes existed

Each tier yields a *partial*: only the fields it actually decides. They are
composed lowest first, so a higher tier overrides only what it states.
"""

from __future__ import annotations

from typing import Any, Optional

from app.core.specs import ArchetypeSpec, OversightSpec

_SUB_TYPES = {"task": ("task", []), "goal": ("goal", ["planner_executor"]),
              "conversational": ("conversational", []), "planner": ("task", ["planner_executor"]),
              "critic": ("task", ["reflective"])}


def _get(facts: Any, path: str) -> Any:
    cursor: Any = facts or {}
    for part in path.split("."):
        if not isinstance(cursor, dict):
            return None
        cursor = cursor.get(part)
    return cursor


def default_for(pipeline: str) -> ArchetypeSpec:
    """What every agent was before archetypes: tool-using, and conversational in chat."""
    primary = "conversational" if pipeline == "agent" else "task"
    return ArchetypeSpec(primary_type=primary, patterns=["tool_using_react"], source="default",
                         rationale="Default: no profile, guidance or document decided it.")


def from_document(facts: dict, capability: Any = None) -> Optional[dict]:
    """Tier 2: what the process document states — its agent design and its governance."""
    if not facts:
        return None
    out: dict = {}
    design = facts.get("agent_design") if isinstance(facts.get("agent_design"), dict) else {}
    stage = getattr(capability, "process_stage", None)
    sub = next((s for s in design.get("sub_agents") or []
                if isinstance(s, dict) and stage and stage in (s.get("stages") or [])), None)
    if sub and sub.get("type") in _SUB_TYPES:
        primary, extra = _SUB_TYPES[sub["type"]]
        out.update(primary_type=primary, patterns_add=list(extra),
                   rationale=f"The process document assigns stage '{stage}' to its {sub['type']} "
                             f"sub-agent '{sub.get('name')}'.")
    elif design.get("primary_type"):
        out.update(primary_type=design["primary_type"],
                   rationale=f"The process document declares a {design['primary_type']} agent"
                             + (f": {design['mapping_rationale']}" if design.get("mapping_rationale") else "."))
    if design.get("patterns"):
        out["patterns_add"] = list(dict.fromkeys(list(out.get("patterns_add") or []) + list(design["patterns"])))
    if len(design.get("sub_agents") or []) > 1 and not sub:
        out["patterns_add"] = list(dict.fromkeys(list(out.get("patterns_add") or []) + ["multi_agent"]))
        out["sub_agents"] = list(design["sub_agents"])
    for key in ("model_preference", "max_tool_rounds"):
        if design.get(key):
            out[key] = design[key]

    gov = facts.get("governance") if isinstance(facts.get("governance"), dict) else {}
    for key in ("action_authority", "reversibility"):
        if gov.get(key):
            out[key] = gov[key]
    if isinstance(gov.get("human_oversight"), dict) and gov["human_oversight"].get("model"):
        out["oversight"] = dict(gov["human_oversight"])
    criteria = _get(gov, "validation.criteria")
    if criteria:
        out["reflection_criteria"] = list(criteria)
    if out:
        out["source"] = "document"
    return out or None


def from_rules(facts: dict, *, capability: Any = None, requirements: Any = None) -> Optional[dict]:
    """Tier 4: the execution profile (or, in chat, the requirement analysis) mapped to a type."""
    profile = _get(facts, "execution_profile") if isinstance(_get(facts, "execution_profile"), dict) else {}
    out: dict = {}
    reasons: list[str] = []
    interaction = profile.get("interaction_mode")
    determinism = profile.get("workflow_determinism")
    horizon = profile.get("task_horizon")
    variability = profile.get("input_variability")

    if interaction in ("user_dialogue", "embedded_assist"):
        out["primary_type"] = "conversational"
        reasons.append(f"interaction is {interaction}")
    elif determinism == "fixed_steps":
        out["primary_type"] = "task"
        reasons.append("the steps are fixed")
    elif determinism == "open_ended":
        out.update(primary_type="goal", patterns_add=["planner_executor"], model_preference="reasoning")
        reasons.append("the work is open-ended, so it must plan and re-plan")
    elif determinism == "variable_steps":
        out["primary_type"] = "task"
        reasons.append("the outcome is bounded but the steps vary")
        if horizon in ("many_steps", "long_running", "multi_day") or variability in ("mixed_formats", "unstructured"):
            out["patterns_add"] = ["planner_executor"]
            reasons.append("long or varied work wants an inspectable plan")
    elif requirements is not None:
        task_type = getattr(requirements, "task_type", None)
        if task_type == "conversation":
            out["primary_type"] = "conversational"
            reasons.append("the request is a conversation")
        elif task_type in ("lookup", "transformation") and getattr(requirements, "complexity", "") == "simple":
            out["primary_type"] = "task"
            reasons.append(f"a simple {task_type}")

    needs_tools = bool(getattr(capability, "agent_needs_tools", False)) or bool(
        _get(facts, "integrations.systems") or _get(facts, "integrations.connectors"))
    if needs_tools:
        out["patterns_add"] = list(out.get("patterns_add") or []) + ["tool_using_react"]
    if not out:
        return None
    out["source"] = "rules"
    out["rationale"] = "Built-in rules: " + ("; ".join(reasons) if reasons else "tools are needed") + "."
    return out


def from_guidance(items: list[dict], strengths: tuple[str, ...]) -> list[dict]:
    """Tiers 3 and 5: each applicable guidance effect as a partial, lowest score first."""
    out = []
    for item in sorted(items, key=lambda i: i.get("score", 0)):
        effect = item.get("effect") or {}
        if item.get("strength") not in strengths or not effect:
            continue
        # Only conditions that were checked and hold apply deterministically;
        # an item whose conditions are unknown reaches the model as context.
        if item.get("conditions") and item.get("applies") != "true":
            continue
        partial: dict = {"source": "guidance", "guidance_ids": [item["id"]],
                         "rationale": f"Guidance {item['id']} ({item.get('strength')}): {item['title']}."}
        if effect.get("archetype.primary_type"):
            partial["primary_type"] = effect["archetype.primary_type"]
        if effect.get("archetype.patterns.add"):
            partial["patterns_add"] = list(effect["archetype.patterns.add"])
        if effect.get("archetype.patterns.remove"):
            partial["patterns_remove"] = list(effect["archetype.patterns.remove"])
        oversight = {k.rsplit(".", 1)[-1]: v for k, v in effect.items() if k.startswith("archetype.oversight.")}
        if oversight:
            partial["oversight"] = oversight
        for key in ("model_preference", "max_tool_rounds"):
            if effect.get(f"archetype.{key}"):
                partial[key] = effect[f"archetype.{key}"]
        out.append(partial)
    return out


def compose(base: ArchetypeSpec, partials: list[dict]) -> ArchetypeSpec:
    """Apply partials lowest precedence first. Records where tiers disagreed on the type."""
    spec = base
    decided: Optional[dict] = None
    for partial in partials:
        if not partial:
            continue
        new_type = partial.get("primary_type")
        if new_type:
            if decided and decided["primary_type"] != new_type and decided["source"] != partial["source"]:
                spec.conflicts.append(f"{partial['source']} chose {new_type} over "
                                      f"{decided['source']}'s {decided['primary_type']}.")
            spec.primary_type = new_type
            spec.source = partial["source"]
            decided = {"primary_type": new_type, "source": partial["source"]}
            if partial.get("rationale"):
                spec.rationale = partial["rationale"]
        elif partial.get("rationale") and spec.source == "default":
            spec.rationale = partial["rationale"]
        patterns = list(spec.patterns)
        for p in partial.get("patterns_add") or []:
            if p not in patterns:
                patterns.append(p)
        spec.patterns = [p for p in patterns if p not in (partial.get("patterns_remove") or [])]
        if partial.get("oversight"):
            merged = {**spec.oversight.to_dict(), **partial["oversight"]}
            spec.oversight = OversightSpec(**{k: merged[k] for k in OversightSpec.__dataclass_fields__ if k in merged})
        for key in ("action_authority", "reversibility", "model_preference", "max_tool_rounds", "confidence"):
            if partial.get(key):
                setattr(spec, key, partial[key])
        if partial.get("reflection_criteria"):
            spec.reflection_criteria = list(partial["reflection_criteria"])
        if partial.get("sub_agents"):
            spec.sub_agents = list(partial["sub_agents"])
        for gid in partial.get("guidance_ids") or []:
            if gid not in spec.guidance_ids:
                spec.guidance_ids.append(gid)
    return spec


def enforce_invariants(spec: ArchetypeSpec) -> None:
    """Tier 1: what no tier may undo."""
    from app.catalog.vocab import COSTLY_REVERSIBILITY, WRITING_AUTHORITIES

    if spec.primary_type == "none":
        return
    if (spec.action_authority in WRITING_AUTHORITIES or spec.reversibility in COSTLY_REVERSIBILITY) \
            and "reflective" not in spec.patterns:
        spec.patterns.append("reflective")
        spec.rationale += " Reflective added: it writes, or its mistakes cost money."
    if spec.primary_type == "goal" and "planner_executor" not in spec.patterns:
        spec.patterns.append("planner_executor")
    if spec.primary_type == "conversational" and "planner_executor" in spec.patterns:
        spec.patterns.remove("planner_executor")
    if spec.max_tool_rounds is not None:
        spec.max_tool_rounds = max(1, min(20, int(spec.max_tool_rounds)))
    if spec.primary_type == "goal" and spec.oversight.model in ("not_applicable", "human_out_of_the_loop"):
        # Goal agents are the hardest to control: they never run unsupervised.
        spec.oversight = OversightSpec(**{**spec.oversight.to_dict(), "model": "human_in_the_loop",
                                          "applies_to": "every_transaction"})
        spec.rationale += " Human-in-the-loop required for a goal agent."


def deterministic(facts: dict, guidance_items: list[dict], *, capability: Any = None,
                  requirements: Any = None) -> tuple[list[dict], bool]:
    """The partials tiers 2–5 yield, lowest first, and whether any of them decided the type."""
    partials = [
        *from_guidance(guidance_items, ("should", "may")),                    # 5
        from_rules(facts, capability=capability, requirements=requirements),  # 4
        *from_guidance(guidance_items, ("must", "avoid")),                    # 3
        from_document(facts, capability),                                     # 2
    ]
    partials = [p for p in partials if p]
    return partials, any(p.get("primary_type") for p in partials)


def resolve(facts: dict, guidance_items: list[dict], *, pipeline: str, capability: Any = None,
            requirements: Any = None, model_partial: Optional[dict] = None) -> ArchetypeSpec:
    """The full archetype: default ⊕ model ⊕ tiers 5..2, then the invariants."""
    partials, _ = deterministic(facts, guidance_items, capability=capability, requirements=requirements)
    spec = compose(default_for(pipeline), ([model_partial] if model_partial else []) + partials)
    enforce_invariants(spec)
    return spec
