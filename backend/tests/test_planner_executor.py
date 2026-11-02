"""Planner–executor through Mistral handoffs: expansion, wiring, and the run itself."""

import asyncio
from types import SimpleNamespace

from app.core.specs import ArchetypeSpec, CapabilitySpec, WorkflowSpec

SUBS = [{"name": "Comparison planner", "role": "Plans the comparison", "type": "planner", "stages": ["plan"]},
        {"name": "Quote extractor", "role": "Extracts one quote", "type": "task", "stages": ["extract"]},
        {"name": "Source verifier", "role": "Checks values against the documents", "type": "critic"}]


def _ctx(patterns=("planner_executor",), subs=SUBS, reuse=None):
    from app.core.context import PipelineContext

    arch = ArchetypeSpec(primary_type="task", patterns=list(patterns), sub_agents=[dict(s) for s in subs],
                         reflection_criteria=["prices traceable to a page"], action_authority="draft")
    cap = CapabilitySpec(id="compare", name="Compare quotes", purpose="Compare supplier quotes", kind="agent",
                         archetype=arch, reuse_agent_id=reuse, inputs=["quotes"])
    ctx = PipelineContext(query="q")
    ctx.workflow_spec = WorkflowSpec(goal="Select a supplier", capabilities=[cap])
    return ctx


def _expand(ctx):
    from app.layers.workflow.pattern_expansion_layer import PatternExpansionLayer

    async def nxt(c):
        return c
    return asyncio.run(PatternExpansionLayer().process(ctx, nxt))


def test_sub_agents_become_handoff_capabilities():
    ctx = _expand(_ctx())
    caps = {c.id: c for c in ctx.workflow_spec.capabilities}
    children = [c for c in caps.values() if c.expanded_from == "compare"]
    assert {c.id for c in children} == {"compare__comparison_planner", "compare__quote_extractor",
                                        "compare__source_verifier"}
    planner, verifier = caps["compare__comparison_planner"], caps["compare__source_verifier"]
    assert "planner_executor" in planner.archetype.patterns
    assert "reflective" in verifier.archetype.patterns
    assert verifier.archetype.reflection_criteria == ["prices traceable to a page"]
    assert planner.archetype.oversight.model == "not_applicable"  # the parent's step is reviewed
    assert planner.process_stage == "plan" and planner.inputs == ["quotes"]
    parent = caps["compare"]
    assert "multi_agent" in parent.archetype.patterns
    assert all(s["capability_id"] for s in parent.archetype.sub_agents)


def test_expansion_is_idempotent_and_skips_reuse_and_plain_planners():
    ctx = _expand(_expand(_ctx()))
    assert len(ctx.workflow_spec.capabilities) == 4
    assert len(_expand(_ctx(reuse="existing-agent")).workflow_spec.capabilities) == 1
    assert len(_expand(_ctx(subs=[])).workflow_spec.capabilities) == 1


def test_topology_leaves_sub_agents_out():
    from app.layers.workflow.topology_layer import StepTopologyLayer

    ctx = _expand(_ctx())
    ctx.workflow_spec.inventory = {"activities": [], "tool_descriptions": "", "connector_descriptions": ""}
    _, user = StepTopologyLayer().build_prompt(ctx)
    assert '"compare"' in user and "compare__quote_extractor" not in user


def test_handoffs_are_wired_after_provisioning():
    from app.layers.workflow.pattern_expansion_layer import wire_handoffs

    ctx = _expand(_ctx())
    calls = []
    ctx.client = SimpleNamespace(beta=SimpleNamespace(agents=SimpleNamespace(
        update=lambda **kw: calls.append(kw))))
    ctx.workflow_spec.provisioned_agents = [
        {"capability_id": "compare", "agent_id": "parent"},
        {"capability_id": "compare__comparison_planner", "agent_id": "p1"},
        {"capability_id": "compare__quote_extractor", "agent_id": "p2"},
        {"capability_id": "compare__source_verifier", "agent_id": "p3"}]
    assert asyncio.run(wire_handoffs(ctx)) == ["compare"]
    assert calls == [{"agent_id": "parent", "handoffs": ["p1", "p2", "p3"]}]


def test_oversight_stamps_the_handoff_flag():
    from app.layers.workflow.oversight_layer import _runtime_archetype

    ctx = _expand(_ctx())
    parent = ctx.workflow_spec.capabilities[0]
    assert _runtime_archetype(parent.archetype)["handoffs"] is True
    assert _runtime_archetype(ArchetypeSpec())["handoffs"] is False


def test_run_with_handoffs_executes_our_tools_and_returns_the_final_answer(monkeypatch):
    from app.services import tool_registry
    from app.services.workflow_engine.step_runners import run_with_handoffs

    def entry(**kw):
        return SimpleNamespace(**kw)

    first = SimpleNamespace(conversation_id="c1", outputs=[
        entry(type="agent.handoff", next_agent_id="p2"),
        entry(type="function.call", name="fx_rate", arguments='{"ccy": "EUR"}', tool_call_id="t1")])
    final = SimpleNamespace(conversation_id="c1", outputs=[
        entry(type="message.output", agent_id="parent", content=[SimpleNamespace(text="Supplier B wins.")])])
    appended = []

    def append(**kw):
        appended.append(kw)
        return final

    client = SimpleNamespace(beta=SimpleNamespace(conversations=SimpleNamespace(
        start=lambda **kw: first, append=append)))

    async def fake_tool(name, args):
        return {"rate": 1.08, "args": args}

    monkeypatch.setattr(tool_registry, "execute_tool", fake_tool)
    answer, rounds, hit, seen = asyncio.run(run_with_handoffs(client, "parent", "compare", "s", 5))
    assert answer == "Supplier B wins." and rounds == 1 and not hit
    assert seen == ["p2", "parent"]
    sent = appended[0]["inputs"][0]
    assert sent["tool_call_id"] == "t1" and '"rate": 1.08' in sent["result"]
    assert appended[0]["handoff_execution"] == "server"
