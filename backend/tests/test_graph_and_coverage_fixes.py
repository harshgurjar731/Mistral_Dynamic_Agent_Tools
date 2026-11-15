"""Fixes for the claim workflow's validation errors: fan-outs and capability coverage."""

from app.layers.workflow.topology_layer import normalise_graph
from app.services.workflow_engine.models import StepType, WorkflowDefinition, WorkflowStep
from app.services.workflow_engine.validation import validate_workflow


def _s(sid, nxt=(), group=None, kind="agent", **config):
    return {"id": sid, "type": kind, "next_steps": list(nxt), "parallel_group": group,
            "config": {"agent_id": "a", "query_template": "x", **config}}


def test_continuations_already_in_one_group_name_only_the_first():
    steps = [_s("validate", ["fraud", "topic", "afford"]), _s("fraud", ["decide"], "checks"),
             _s("topic", ["decide"], "checks"), _s("afford", ["decide"], "checks"), _s("decide")]
    changes = normalise_graph(steps, {})
    assert steps[0]["next_steps"] == ["fraud"] and changes


def test_independent_continuations_become_a_parallel_group():
    steps = [_s("decide", ["review", "letter"]), _s("review", ["end"]), _s("letter", ["end"]), _s("end")]
    normalise_graph(steps, {"review": {"decide"}, "letter": {"decide"}})
    assert steps[0]["next_steps"] == ["review"]
    assert steps[1]["parallel_group"] == steps[2]["parallel_group"] == "decide_fanout"


def test_dependent_continuations_are_chained():
    steps = [_s("decide", ["review", "letter"]), _s("review", ["end"]), _s("letter", ["end"]), _s("end")]
    normalise_graph(steps, {"letter": {"review"}})
    assert steps[0]["next_steps"] == ["review"] and steps[1]["next_steps"] == ["letter"]


def test_validator_accepts_a_fan_out_to_one_group():
    definition = WorkflowDefinition(name="w", entry_step="a", steps=[
        WorkflowStep(id="a", type=StepType.AGENT, next_steps=["b", "c"], config={"agent_id": "x", "query_template": "q"}),
        WorkflowStep(id="b", type=StepType.AGENT, next_steps=["d"], parallel_group="g", config={"agent_id": "x", "query_template": "q"}),
        WorkflowStep(id="c", type=StepType.AGENT, next_steps=["d"], parallel_group="g", config={"agent_id": "x", "query_template": "q"}),
        WorkflowStep(id="d", type=StepType.AGENT, next_steps=[], config={"agent_id": "x", "query_template": "q"}),
    ])
    assert "step.multiple_next" not in {i.code for i in validate_workflow(definition).issues}


def test_coverage_counts_what_the_workflow_hands_an_agent(monkeypatch):
    from app.catalog import store
    from app.rules import engine

    definition = WorkflowDefinition(name="claim", entry_step="payable", steps=[
        WorkflowStep(id="payable", type=StepType.TOOL, next_steps=["letter"],
                     config={"tool_name": "payable_amount", "arguments": {}}),
        WorkflowStep(id="letter", type=StepType.AGENT, next_steps=[],
                     config={"agent_id": "ag_letter",
                             "query_template": "Write the letter for {{step_payable_output.payable}}"}),
    ])
    monkeypatch.setattr(store, "annotations_for", lambda kind, sid: {
        "requires_capability": ["capability.computation", "capability.retrieval"]} if sid == "ag_letter" else {})
    monkeypatch.setattr(store, "annotation_sources", lambda *a: {"capability.computation": "inferred",
                                                                 "capability.retrieval": "inferred"})
    rule = {"type": "capability_coverage", "name": "Capability coverage", "enforcement": "warn"}
    issues = engine._capability_coverage(rule, definition, {"ag_letter": {"name": "Letter", "tools": []}}, {})
    assert issues == []

    # Not handed anything, and nothing upstream computes: still flagged.
    definition.steps[1].config["query_template"] = "Write a letter."
    definition.steps[0].type = StepType.AGENT
    definition.steps[0].config = {"agent_id": "other", "query_template": "q"}
    issues = engine._capability_coverage(rule, definition, {"ag_letter": {"name": "Letter", "tools": []}}, {})
    assert issues and "Computation" in issues[0].message or "computation" in issues[0].message.lower()
