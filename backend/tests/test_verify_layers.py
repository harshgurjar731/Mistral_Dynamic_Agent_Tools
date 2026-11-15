"""The Verify stage: scenarios run end to end, failures repaired, side effects stubbed."""

import asyncio
from types import SimpleNamespace

from app.core.context import PipelineContext
from app.core.specs import WorkflowSpec
from app.layers.workflow import verify_layers as vl
from app.layers.workflow.issue_owners import by_owner, owner_of
from app.services.workflow_engine import dry_run
from app.services.workflow_engine.models import StepResult, StepType, WorkflowDefinition, WorkflowStep

RECORD = {"type": "object", "properties": {"decision_record": {
    "type": "object", "properties": {"decision": {"type": "string", "enum": ["approve", "refer", "decline"]}},
    "required": ["decision"]}}, "required": ["decision_record"]}


def _definition():
    return WorkflowDefinition(name="loan", entry_step="policy", steps=[
        WorkflowStep(id="policy", type=StepType.AGENT, next_steps=["notify"],
                     config={"agent_id": "a", "query_template": "x", "output_schema": RECORD}),
        WorkflowStep(id="notify", type=StepType.CONNECTOR, next_steps=[],
                     config={"connector_id": "c", "tool_name": "send_email", "arguments": {"to": "{{email}}"}}),
    ], input_schema=[{"name": "application", "type": "object", "required": True}])


def _ctx():
    spec = WorkflowSpec(goal="g", workflow_name="loan")
    spec.definition = _definition()
    return PipelineContext(workflow_spec=spec)


def _patch_engine(monkeypatch, runs):
    from app.services.workflow_engine import engine

    calls = []

    async def execute(name, inputs, execution_id=None, wait_for_result=False):
        calls.append((inputs, dry_run.active()))
        return runs.pop(0)

    monkeypatch.setattr(engine, "get_workflow", lambda name: _definition())
    monkeypatch.setattr(engine, "execute_workflow", execute)
    return calls


def _run(status, results, variables):
    return SimpleNamespace(status=status, step_results=results, variables=variables, result={})


SCENARIO = {"name": "Strong case", "input": {"application": {}},
            "expect": [{"path": "step_policy_output.decision_record.decision", "equals": "approve",
                        "why": "every rule passes"}]}


def test_a_scenario_checks_steps_typed_outputs_and_expected_outcomes(monkeypatch):
    bad_output = {"decision_record": {"decision": "maybe"}}
    calls = _patch_engine(monkeypatch, [_run("COMPLETED", [
        StepResult(step_id="policy", status="completed", output=bad_output)],
        {"step_policy_output": bad_output})])
    outcome = asyncio.run(vl.run_scenario(_ctx(), "loan", SCENARIO))
    assert calls[0][1] is True, "scenarios run as dry runs"
    assert not outcome["passed"]
    assert any("does not match its record" in p for p in outcome["problems"])
    assert any("expected outcome not met" in p and "approve" in p for p in outcome["problems"])


def test_failures_are_repaired_and_the_scenarios_run_again(monkeypatch):
    from app.config import settings

    good = {"decision_record": {"decision": "approve"}}
    _patch_engine(monkeypatch, [
        _run("FAILED", [StepResult(step_id="policy", status="failed", error="name 'round' is not defined")], {}),
        _run("COMPLETED", [StepResult(step_id="policy", status="completed", output=good)],
             {"step_policy_output": good}),
    ])
    monkeypatch.setattr(settings, "WORKFLOW_DRY_RUN_REPAIRS", 2)
    repairs = []

    async def fake_repair(ctx, name, parent, round_no, failed):
        repairs.append((round_no, failed[0]["problems"][0]))
        return {"applied": True, "summary": "fixed the code"}

    monkeypatch.setattr(vl, "repair", fake_repair)
    ctx = _ctx()
    ctx.metadata[vl.SCENARIOS_KEY] = [SCENARIO]
    result = asyncio.run(vl.run_verification(ctx, "workflow_dry_run"))
    assert result["passed"] is True
    assert repairs == [(1, "step 'policy' failed: name 'round' is not defined")]
    assert [r["failed"] for r in result["rounds"]] == [1, 0]
    subs = [(e.data["id"], e.data["state"]) for e in ctx.events if e.event == "sublayer"]
    assert ("r0:s0", "failed") in subs and ("r1:s0", "completed") in subs


def test_connectors_and_reviews_are_stubbed_in_a_dry_run():
    definition = _definition()
    connector = definition.steps[1]
    review = WorkflowStep(id="review", type=StepType.HUMAN_REVIEW, next_steps=[], config={})
    assert not dry_run.stubs(connector)
    with dry_run.enabled():
        assert dry_run.stubs(connector) and dry_run.stubs(review)
        sent = dry_run.stub_result(connector, {"email": "a@b.c"})
        approved = dry_run.stub_result(review, {})
    assert sent.status == "completed" and sent.output["would_send"] == {"to": "a@b.c"}
    assert approved.output["review"]["decision"] == "approved"


def test_validation_issues_go_back_to_the_layer_that_made_them():
    assert owner_of("dataflow.argument_shape") == "data_flow"
    assert owner_of("condition.dangling_branch") == "step_topology"
    assert owner_of("condition.cannot_evaluate") == "data_flow"
    assert owner_of("input.undeclared") == "input_schema"
    assert owner_of("process_control_uncovered") is None
    grouped = by_owner([{"code": "step.dangling_edge", "step_id": "a", "message": "points nowhere"},
                        {"code": "tool.bad_arguments", "step_id": "b", "message": "not an object"}])
    assert set(grouped) == {"step_topology", "data_flow"}
    assert "step 'a'" in grouped["step_topology"][0]


def test_mcp_tools_are_not_called_in_a_dry_run(monkeypatch):
    import json as _json

    from app.services import tool_registry
    from app.services.tool_resolver import tool_resolver

    async def boom(*a, **k):
        raise AssertionError("an MCP tool must not be called in a dry run")

    monkeypatch.setattr(tool_resolver, "execute_mcp_tool", boom)
    monkeypatch.setitem(tool_registry.ALL_TOOLS, "crm:create_ticket", {"function": {"name": "crm:create_ticket"}})

    async def call():
        with dry_run.enabled():
            return await tool_registry._route_tool("crm:create_ticket", {"title": "x"})

    result = _json.loads(asyncio.run(call()))
    assert result["dry_run"] is True and result["would_send"] == {"title": "x"}


def test_agents_with_mistral_connectors_are_flagged(monkeypatch):
    good = {"decision_record": {"decision": "approve"}}
    _patch_engine(monkeypatch, [_run("COMPLETED", [StepResult(step_id="policy", status="completed", output=good)],
                                     {"step_policy_output": good})])
    ctx = _ctx()
    ctx.workflow_spec.provisioned_agents = [{"agent_id": "a", "connectors": ["gmail"]}]
    outcome = asyncio.run(vl.run_scenario(ctx, "loan", SCENARIO))
    assert outcome["passed"] is True
    assert outcome["warnings"] and "gmail" in outcome["warnings"][0]
