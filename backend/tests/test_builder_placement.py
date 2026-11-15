"""An activity created on the builder canvas is written to fit the steps around it."""

import asyncio
from types import SimpleNamespace

from app.core.specs import CodeResolution
from app.services.workflow_engine.builder_context import step_neighbours

OUT = {"type": "object", "properties": {"equipment_cost": {"type": "number"},
                                        "deposit_amount": {"type": "number"}}}
CATALOG = {"completeness_check": {"input": {"type": "object", "properties": {"app": {"type": "object"}}},
                                  "output": OUT, "version": 1},
           "send_offer": {"input": {"type": "object", "properties": {"monthly_instalment": {"type": "number"}}},
                          "output": None, "version": 1}}


def _definition():
    return {
        "name": "loan", "description": "Equipment finance", "entry_step": "intake",
        "input_schema": [{"name": "application", "type": "object", "required": True}],
        "steps": [
            {"id": "intake", "type": "agent", "next_steps": ["check"],
             "config": {"agent_id": "a", "query_template": "{{application}}"}},
            {"id": "check", "type": "tool", "next_steps": ["offer"],
             "config": {"tool_name": "completeness_check", "arguments": {}}},
            {"id": "offer", "type": "tool", "next_steps": [],
             "config": {"tool_name": "send_offer", "arguments": {}}},
        ],
    }


def test_neighbours_list_closest_first_with_output_schemas():
    up, down = step_neighbours(_definition(), after="check", before=["offer"], catalog=CATALOG)
    assert [u["id"] for u in up] == ["check", "intake", "workflow_input"]
    assert up[0]["output_schema"] == OUT and up[0]["variable"] == "step_check_output"
    assert "no declared schema" in up[1]["returns"]
    assert up[2]["outputs"] == ["application"]
    assert down == [{"id": "offer", "kind": "tool", "name": "offer", "activity": "send_offer",
                     "input_schema": CATALOG["send_offer"]["input"], "inputs": ["monthly_instalment"]}]


def test_an_existing_step_uses_its_own_parents_and_children():
    up, down = step_neighbours(_definition(), step_id="check", catalog=CATALOG)
    assert [u["id"] for u in up] == ["intake", "workflow_input"]
    assert [d["id"] for d in down] == ["offer"]


def test_a_half_built_draft_is_fine():
    up, down = step_neighbours({"steps": [{"id": "x"}, {"type": "tool"}, "junk"]}, after="missing")
    assert up == [] and down == []


def test_synthesis_in_place_goes_through_the_requirement_pipeline(monkeypatch):
    from app.layers.codegen import pipeline
    from app.runs import runners
    from app.services.workflow_engine import rule_validation

    seen = {}

    async def resolve(need, **kw):
        seen["need"] = need
        return CodeResolution(status="built", name="affordability", version=1, purpose="activity",
                              output_schema={"type": "object"})

    async def catalog():
        return CATALOG

    monkeypatch.setattr(pipeline, "resolve_code_need", resolve)
    monkeypatch.setattr(rule_validation, "_activity_catalog", catalog)
    events = []
    ctx = SimpleNamespace(client=None, event_queue=SimpleNamespace(emit=lambda *a: events.append(a)))
    placement = {"definition": _definition(), "after_step_id": "check", "before_step_ids": ["offer"]}
    result = asyncio.run(runners._synthesise_in_place(ctx, "work out the monthly instalment",
                                                      placement, None, None, ["use vault key X"]))
    assert result["status"] == "success" and result["tool_name"] == "affordability"
    need = seen["need"]
    assert need.purpose == "activity" and need.origin == "workflow"
    assert need.upstream[0]["output_schema"] == OUT
    assert need.downstream[0]["inputs"] == ["monthly_instalment"]
    assert need.guidance == ["use vault key X"]
    assert events and "check" in events[0][1]


def test_fan_out_fix_groups_independent_targets_and_chains_dependent_ones():
    from app.services.workflow_engine.builder_context import fix_fan_outs

    d = {"steps": [
        {"id": "start", "type": "tool", "next_steps": ["a", "b"], "config": {}},
        {"id": "a", "type": "agent", "next_steps": ["end"], "config": {"query_template": "{{x}}"}},
        {"id": "b", "type": "agent", "next_steps": ["end"], "config": {"query_template": "{{y}}"}},
        {"id": "end", "type": "tool", "next_steps": [], "config": {}},
    ]}
    fixed, changes = fix_fan_outs(d)
    by = {s["id"]: s for s in fixed["steps"]}
    assert by["start"]["next_steps"] == ["a"]
    assert by["a"]["parallel_group"] == by["b"]["parallel_group"] == "start_fanout"
    assert changes and d["steps"][0]["next_steps"] == ["a", "b"], "the input is not modified"

    d["steps"][2]["config"]["query_template"] = "{{step_a_output.summary}}"
    fixed, _ = fix_fan_outs(d)
    by = {s["id"]: s for s in fixed["steps"]}
    assert by["start"]["next_steps"] == ["a"] and by["a"]["next_steps"] == ["b"]
    assert by["b"]["next_steps"] == ["end"] and by["a"]["parallel_group"] is None


def test_agent_output_schema_is_validated():
    from app.services.workflow_engine.models import WorkflowDefinition
    from app.services.workflow_engine.validation import validate_workflow

    def issues(schema):
        d = WorkflowDefinition(name="wf_test", entry_step="a", steps=[
            {"id": "a", "type": "agent", "next_steps": [],
             "config": {"agent_id": "x", "query_template": "q", "output_schema": schema}}])
        return {(i.code, i.severity) for i in validate_workflow(d).issues if i.code.startswith("agent.")}

    assert issues({"type": "object", "properties": {"d": {"type": "string"}}, "required": ["d"]}) == set()
    assert ("agent.bad_output_schema", "error") in issues({"type": "array"})
    assert ("agent.empty_output_schema", "warning") in issues({"type": "object", "properties": {}})
    assert ("agent.bad_output_schema", "warning") in issues(
        {"type": "object", "properties": {"d": {}}, "required": ["e"]})
