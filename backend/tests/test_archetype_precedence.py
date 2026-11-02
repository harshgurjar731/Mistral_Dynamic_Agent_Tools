"""Agent archetypes: the P2P mapping, the precedence order, the invariants, and the layer."""

import asyncio
import json
from types import SimpleNamespace

from app.core.specs import CapabilitySpec
from app.layers.agent import archetype_rules as rules

# The P2P agent items, with the execution profiles the analysis said were missing.
P2P = {
    "copilot": {"execution_profile": {"interaction_mode": "user_dialogue", "workflow_determinism": "variable_steps"},
                "integrations": {"systems": [{"id": "portal", "name": "Procurement portal", "access": "write"}]},
                "governance": {"action_authority": "draft", "reversibility": "reversible"}},
    "sourcing": {"execution_profile": {"interaction_mode": "event_triggered", "workflow_determinism": "variable_steps",
                                       "task_horizon": "many_steps", "input_variability": "mixed_formats"},
                 "governance": {"action_authority": "draft", "human_oversight": {"model": "human_in_the_loop"}}},
    "vendor_idp": {"execution_profile": {"interaction_mode": "event_triggered", "workflow_determinism": "fixed_steps",
                                         "input_variability": "standard_forms"},
                   "governance": {"action_authority": "read_only", "human_oversight": {"model": "human_on_the_loop"}}},
    "invoice_idp": {"execution_profile": {"interaction_mode": "event_triggered", "workflow_determinism": "fixed_steps",
                                          "input_variability": "mixed_formats"},
                    "integrations": {"systems": [{"id": "sap", "name": "SAP FI", "access": "write"}]},
                    "governance": {"action_authority": "write", "reversibility": "financial_impact",
                                   "validation": {"criteria": ["3-way match passes"]}}},
    "autonomous": {"execution_profile": {"interaction_mode": "scheduled", "workflow_determinism": "open_ended",
                                         "task_horizon": "long_running"}},
}


def _resolve(facts, items=(), pipeline="workflow", **kw):
    return rules.resolve(facts, list(items), pipeline=pipeline, **kw)


def test_p2p_items_map_as_the_analysis_said():
    copilot = _resolve(P2P["copilot"])
    assert copilot.primary_type == "conversational" and "tool_using_react" in copilot.patterns
    assert "planner_executor" not in copilot.patterns  # dialogue agents do not plan-then-execute

    sourcing = _resolve(P2P["sourcing"])
    # The profile decided the type; the document contributed only its governance.
    assert (sourcing.primary_type, sourcing.source) == ("task", "rules")
    assert "planner_executor" in sourcing.patterns
    assert sourcing.oversight.model == "human_in_the_loop"

    vendor = _resolve(P2P["vendor_idp"])
    assert vendor.primary_type == "task" and "reflective" not in vendor.patterns

    invoice = _resolve(P2P["invoice_idp"])
    assert invoice.primary_type == "task"
    assert "reflective" in invoice.patterns  # writes with financial impact
    assert invoice.reflection_criteria == ["3-way match passes"]

    autonomous = _resolve(P2P["autonomous"])
    assert autonomous.primary_type == "goal" and "planner_executor" in autonomous.patterns
    assert autonomous.model_preference == "reasoning"
    assert autonomous.oversight.model == "human_in_the_loop"  # goal agents never run unsupervised


def _guide(id_, strength, effect, conditions=(), applies="true", score=1.0):
    return {"id": id_, "title": f"g{id_}", "strength": strength, "effect": effect,
            "conditions": list(conditions), "applies": applies, "score": score}


def test_must_guidance_beats_rules_and_should_guidance_does_not():
    facts = {"execution_profile": {"workflow_determinism": "fixed_steps"}}
    should = _guide(1, "should", {"archetype.primary_type": "goal"})
    must = _guide(2, "must", {"archetype.primary_type": "conversational"})

    assert _resolve(facts, [should]).primary_type == "task"           # rules (4) over should (5)
    spec = _resolve(facts, [should, must])
    assert (spec.primary_type, spec.source) == ("conversational", "guidance")  # must (3) over rules (4)
    assert spec.guidance_ids == [2] or 2 in spec.guidance_ids


def test_document_beats_must_guidance_and_the_conflict_is_recorded():
    facts = {"agent_design": {"primary_type": "task"}}
    must = _guide(7, "must", {"archetype.primary_type": "goal"})
    spec = _resolve(facts, [must])
    assert (spec.primary_type, spec.source) == ("task", "document")
    assert spec.conflicts and "document chose task over guidance's goal" in spec.conflicts[0]


def test_guidance_with_unknown_conditions_is_not_applied_deterministically():
    item = _guide(3, "must", {"archetype.primary_type": "goal"},
                  conditions=[{"attr": "governance.reversibility", "op": "eq", "value": "irreversible"}],
                  applies="unknown")
    partials, decided = rules.deterministic({}, [item])
    assert not decided and partials == []


def test_patterns_add_and_remove_and_round_bounds():
    items = [_guide(1, "should", {"archetype.patterns.add": ["reflective", "multi_agent"]}),
             _guide(2, "must", {"archetype.patterns.remove": ["multi_agent"], "archetype.max_tool_rounds": 99})]
    spec = _resolve({}, items)
    assert "reflective" in spec.patterns and "multi_agent" not in spec.patterns
    assert spec.max_tool_rounds == 20


def test_sub_agent_stage_assignment_from_the_document():
    facts = {"agent_design": {"primary_type": "task", "sub_agents": [
        {"name": "Planner", "type": "planner", "stages": ["plan"]},
        {"name": "Verifier", "type": "critic", "stages": ["verify"]}]}}
    planner = _resolve(facts, capability=CapabilitySpec(id="plan", process_stage="plan"))
    verifier = _resolve(facts, capability=CapabilitySpec(id="verify", process_stage="verify"))
    other = _resolve(facts, capability=CapabilitySpec(id="draft", process_stage="draft"))
    assert "planner_executor" in planner.patterns
    assert "reflective" in verifier.patterns
    assert "multi_agent" in other.patterns and len(other.sub_agents) == 2


def test_default_is_how_agents_were_built_before():
    assert _resolve({}).to_dict()["primary_type"] == "task"
    chat = _resolve({}, pipeline="agent")
    assert (chat.primary_type, chat.patterns, chat.source) == ("conversational", ["tool_using_react"], "default")


# ── The layer ──────────────────────────────────────────────────────────────


def _workflow_ctx(caps, facts=None):
    from app.core.context import PipelineContext
    from app.core.specs import WorkflowSpec
    from app.process import pipeline as pk

    ctx = PipelineContext(query="g")
    ctx.workflow_spec = WorkflowSpec(goal="Process supplier invoices", capabilities=caps)
    if facts is not None:
        ctx.metadata[pk.CONTEXT_KEY] = {"enabled": True, "documents": [{"id": 1}], "facts": facts,
                                        "stages": [], "controls": [], "exceptions": [], "risks": [],
                                        "regulations": [], "actors": [], "kpis": [], "data_entities": [],
                                        "refs": {}}
    return ctx


def _run(layer, ctx):
    async def nxt(c):
        return c
    return asyncio.run(layer.process(ctx, nxt))


def test_layer_asks_the_model_only_for_what_is_undecided(monkeypatch):
    from app.core import decision
    from app.layers.agent.archetype_layer import AgentArchetypeLayer

    asked = []

    async def fake(client, **kw):
        asked.append(kw["user"])
        return json.dumps({"decisions": [{"id": "summarise", "primary_type": "task", "patterns": ["reflective"],
                                          "rationale": "bounded"}], "reasoning": "ok"})

    monkeypatch.setattr(decision, "decide", fake)
    caps = [CapabilitySpec(id="extract", name="Extract", purpose="Extract invoice fields", kind="agent",
                           agent_needs_tools=True),
            CapabilitySpec(id="summarise", name="Summarise", purpose="Write a summary", kind="agent"),
            CapabilitySpec(id="total", name="Total", purpose="Sum lines", kind="activity")]
    ctx = _run(AgentArchetypeLayer("workflow"), _workflow_ctx(caps))
    assert len(asked) == 1 and "summarise" in asked[0] and "id: extract" in asked[0]
    assert caps[1].archetype.source == "llm" and "reflective" in caps[1].archetype.patterns
    assert caps[2].archetype is None  # activities get no type
    summary = ctx.layer_summary("agent_archetype")
    # A tools hint alone decides no type, so "extract" was asked too; the answer
    # skipped it, so it keeps the default.
    assert "Decided 1 by default, 1 by llm." in summary


def test_layer_skips_the_model_when_facts_decide_everything(monkeypatch):
    from app.core import decision
    from app.layers.agent.archetype_layer import AgentArchetypeLayer

    async def boom(client, **kw):
        raise AssertionError("the model should not be asked")

    monkeypatch.setattr(decision, "decide", boom)
    caps = [CapabilitySpec(id="extract", name="Extract", purpose="Extract", kind="agent")]
    _run(AgentArchetypeLayer("workflow"), _workflow_ctx(caps, facts=P2P["invoice_idp"]))
    assert caps[0].archetype.primary_type == "task" and caps[0].archetype.source in ("rules", "document")


def test_layer_failure_keeps_the_default(monkeypatch):
    from app.core import decision
    from app.layers.agent.archetype_layer import AgentArchetypeLayer

    async def down(client, **kw):
        raise RuntimeError("rate limited")

    monkeypatch.setattr(decision, "decide", down)
    caps = [CapabilitySpec(id="x", name="X", purpose="Do x", kind="agent")]
    _run(AgentArchetypeLayer("workflow"), _workflow_ctx(caps))
    assert (caps[0].archetype.primary_type, caps[0].archetype.source) == ("task", "default")


def test_chat_layer_decides_the_one_agent(monkeypatch):
    from app.core import decision
    from app.core.context import PipelineContext
    from app.core.specs import RequirementSpec
    from app.layers.agent.archetype_layer import AgentArchetypeLayer

    async def boom(client, **kw):
        raise AssertionError("decided by the requirement analysis")

    monkeypatch.setattr(decision, "decide", boom)
    ctx = PipelineContext(query="chat with me about invoices")
    ctx.requirements = RequirementSpec(intent="talk", task_type="conversation")
    _run(AgentArchetypeLayer("agent"), ctx)
    assert ctx.agent_spec.archetype.primary_type == "conversational"


def test_reuse_compatibility(monkeypatch):
    from app.catalog import store
    from app.layers.agent import archetype

    tags = {"a-task": {"has_agent_type": ["agent_type.task"]}, "a-old": {}}
    monkeypatch.setattr(store, "annotations_for", lambda st, sid: tags.get(sid, {}))
    goal = SimpleNamespace(primary_type="goal")
    task = SimpleNamespace(primary_type="task")
    assert archetype.compatible("a-task", task) and not archetype.compatible("a-task", goal)
    assert archetype.compatible("a-old", goal)  # untagged agents predate archetypes
