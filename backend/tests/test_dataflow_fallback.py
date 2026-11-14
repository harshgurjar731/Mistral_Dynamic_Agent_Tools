"""The data-flow decision is retried once, and a failed wiring is never silent.

In the recording the "Wire the data" layer showed "Could not be decided — a
default was used instead", and the workflow still validated with activity steps
that had no arguments. Now the decision gets a second attempt; if that fails
too, activity arguments are wired only by exact field name and every step left
unwired is a blocking validation error.
"""

import asyncio
import json

from app.core.context import PipelineContext
from app.core.specs import CapabilitySpec, WorkflowSpec
from app.layers.workflow import dataflow_layer
from app.layers.workflow.dataflow_layer import DataFlowLayer

INVENTORY = {"activities": [
    {"name": "affordability", "parameters": {"equipment_cost": {"type": "number"},
                                             "term_months": {"type": "integer"}},
     "required": ["equipment_cost", "term_months"],
     "output_schema": {"type": "object", "properties": {"instalment": {"type": "number"}}}},
    {"name": "validate", "parameters": {"application": {"type": "object"}}, "required": ["application"],
     "output_schema": {"type": "object", "properties": {"equipment_cost": {"type": "number"}}}},
]}


def _ctx():
    caps = [
        CapabilitySpec(id="check", name="Validate", purpose="validate", kind="activity",
                       inputs=["application"], outputs=["equipment_cost"]),
        CapabilitySpec(id="afford", name="Affordability", purpose="afford", kind="activity",
                       outputs=["instalment"], depends_on=["check"]),
    ]
    topology = {"name": "w", "entry_step": "check", "steps": [
        {"id": "check", "type": "tool", "next_steps": ["afford"], "parallel_group": None,
         "config": {"tool_name": "validate"}},
        {"id": "afford", "type": "tool", "next_steps": [], "parallel_group": None,
         "config": {"tool_name": "affordability"}},
    ]}
    spec = WorkflowSpec(goal="g", workflow_name="w", inventory=INVENTORY, capabilities=caps,
                        topology=topology)
    return PipelineContext(workflow_spec=spec)


def _script(monkeypatch, answers):
    calls = []

    async def fake_decide(client, **kw):
        calls.append(kw.get("phase"))
        answer = answers[len(calls) - 1]
        if isinstance(answer, Exception):
            raise answer
        return json.dumps(answer)

    monkeypatch.setattr("app.core.decision.decide", fake_decide)
    return calls


async def _run(ctx):
    async def done(c):
        return c

    return await DataFlowLayer().process(ctx, done)


def test_a_failed_decision_is_retried(monkeypatch):
    good = {"steps": [
        {"id": "check", "config": {"arguments": {"application": "{{application}}"}}},
        {"id": "afford", "config": {"arguments": {"equipment_cost": "{{step_check_output.equipment_cost}}",
                                                  "term_months": "{{term_months}}"}}},
    ], "input_schema": [], "reasoning": "wired"}
    calls = _script(monkeypatch, [RuntimeError("model down"), good])
    ctx = asyncio.run(_run(_ctx()))
    assert len(calls) == 2
    assert not ctx.metadata.get("dataflow_unwired")
    afford = next(s for s in ctx.workflow_spec.dag["steps"] if s["id"] == "afford")
    assert afford["config"]["arguments"]["term_months"] == "{{term_months}}"


def test_two_failures_wire_by_name_and_report_the_rest(monkeypatch):
    calls = _script(monkeypatch, [RuntimeError("down"), RuntimeError("still down")])
    ctx = asyncio.run(_run(_ctx()))
    assert len(calls) == 2
    steps = {s["id"]: s for s in ctx.workflow_spec.dag["steps"]}
    # Matched by exact name: the validate step's output and the capability input.
    assert steps["check"]["config"]["arguments"] == {"application": "{{application}}"}
    assert steps["afford"]["config"]["arguments"] == {
        "equipment_cost": "{{step_check_output.equipment_cost}}"}
    unwired = [i for i in ctx.metadata["contract_issues"] if i["code"] == "dataflow.unwired"]
    assert [(i["step_id"], i["severity"]) for i in unwired] == [("afford", "error")]
    assert "term_months" in unwired[0]["message"]
    assert "failed twice" in ctx.workflow_spec.rationale["data_flow"]
    assert dataflow_layer._FALLBACK_KEY in ctx.metadata
