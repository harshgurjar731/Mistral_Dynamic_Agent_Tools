"""The workflow's data contract: decided once, checked, and built to by every later layer."""

import asyncio
import json

from app.core.context import PipelineContext
from app.core.specs import CapabilitySpec, CodeNeed, CodeRequirement, WorkflowSpec
from app.layers.codegen.profiles import ActivityRequirementProfile
from app.layers.workflow import data_contract_layer as dc
from app.layers.workflow.dataflow_layer import _apply_contract

APPLICATION = {"type": "object", "properties": {
    "business_name": {"type": "string", "description": "Registered business name"},
    "equipment_cost": {"type": "number", "description": "Equipment cost in GBP"},
    "credit_file": {"type": "object", "description": "Internal credit file", "properties": {
        "defaults_last_24m": {"type": "integer", "description": "Defaults in the last 24 months"}}},
}, "required": ["business_name", "equipment_cost"]}
AFFORD = {"type": "object", "properties": {
    "monthly_instalment_gbp": {"type": "number", "description": "Monthly repayment in GBP"},
    "ltv_percent": {"type": "number", "description": "Loan to value, percentage"}},
    "required": ["monthly_instalment_gbp"]}
RISK = {"type": "object", "properties": {
    "risk_score": {"type": "integer", "description": "0-100, higher is riskier — not the credit score"}},
    "required": ["risk_score"]}

ANSWER = {
    "records": [
        {"name": "application", "origin": "run_input", "description": "The SME application", "schema": APPLICATION},
        {"name": "affordability_result", "origin": "afford", "description": "Affordability", "schema": AFFORD},
        {"name": "risk_assessment", "origin": "risk", "description": "Credit risk", "schema": RISK},
    ],
    "capabilities": [
        {"id": "afford", "consumes": ["application"], "produces": "affordability_result"},
        {"id": "risk", "consumes": ["application", "affordability_result"], "produces": "risk_assessment"},
    ],
    "reasoning": "one application record in, two records out",
}


def _caps():
    return [CapabilitySpec(id="afford", name="Affordability", kind="activity", inputs=["validated app"]),
            CapabilitySpec(id="risk", name="Credit risk", kind="agent")]  # no depends_on yet


def _ctx():
    return PipelineContext(workflow_spec=WorkflowSpec(goal="g", capabilities=_caps()))


def _run(answers, monkeypatch):
    queue = iter(answers)
    prompts = []

    async def fake(client, **kw):
        prompts.append(kw["user"])
        return json.dumps(next(queue))

    monkeypatch.setattr("app.core.decision.decide", fake)

    async def done(c):
        return c

    return asyncio.run(dc.DataContractLayer().process(_ctx(), done)), prompts


def test_contract_is_applied_and_ordering_added(monkeypatch):
    ctx, prompts = _run([ANSWER], monkeypatch)
    spec = ctx.workflow_spec
    assert set(spec.data_contract["records"]) == {"application", "affordability_result", "risk_assessment"}
    risk = next(c for c in spec.capabilities if c.id == "risk")
    assert risk.depends_on == ["afford"], "a consumer now runs after its producer"
    assert risk.inputs == ["application", "affordability_result"] and risk.outputs == ["risk_assessment"]
    assert len(prompts) == 1
    assert dc.check_contract(spec.data_contract, spec.capabilities) == []


def test_contract_problems_are_sent_back_and_fixed(monkeypatch):
    bad = json.loads(json.dumps(ANSWER))
    bad["records"][1]["schema"]["properties"]["ltv_percent"].pop("description")
    bad["capabilities"][1]["consumes"].append("ghost_record")
    ctx, prompts = _run([bad, ANSWER], monkeypatch)
    assert len(prompts) == 2
    assert "ghost_record" in prompts[1] and "ltv_percent" in prompts[1]
    assert dc.check_contract(ctx.workflow_spec.data_contract, ctx.workflow_spec.capabilities) == []


def test_helpers_used_by_later_layers(monkeypatch):
    ctx, _ = _run([ANSWER], monkeypatch)
    spec = ctx.workflow_spec
    assert dc.record_ref(spec, "application") == "{{application}}"
    assert dc.record_ref(spec, "affordability_result") == "{{step_afford_output.affordability_result}}"
    out = dc.output_schema_for(spec, "risk")
    assert out["required"] == ["risk_assessment"] and out["properties"]["risk_assessment"]["properties"]
    ins = dc.input_schema_for(spec, "afford")
    assert list(ins["properties"]) == ["application"]
    fields = dc.run_input_fields(spec)
    assert fields[0]["name"] == "application" and "credit_file" in fields[0]["schema"]["properties"]
    assert "risk_assessment" in dc.design_block(spec, next(c for c in spec.capabilities if c.id == "risk"))


def test_activity_spec_is_held_to_the_contract(monkeypatch):
    ctx, _ = _run([ANSWER], monkeypatch)
    spec = ctx.workflow_spec
    need = CodeNeed(purpose="activity", capability={"outputs": ["affordability_result"]},
                    contract={"input_schema": dc.input_schema_for(spec, "afford"),
                              "output_schema": dc.output_schema_for(spec, "afford")})
    drifted = CodeRequirement(
        name="affordability", purpose="activity",
        input_schema={"type": "object", "properties": {"equipment_cost_gbp": {"type": "number"}}},
        output_schema={"type": "object", "properties": {"monthly_instalment": {"type": "number"}}},
        examples=[{"input": {"application": {"business_name": "N", "equipment_cost": 185000}},
                   "output": {"affordability_result": {"monthly_instalment_gbp": 3022.37}}},
                  {"input": {"application": {"business_name": "N"}}, "output": {}}])
    issues = ActivityRequirementProfile().bind_contract(need, drifted)
    assert list(drifted.input_schema["properties"]) == ["application"], "the contract's schema is enforced"
    assert "affordability_result" in drifted.output_schema["properties"]
    assert any("worked example 2 input" in i and "equipment_cost" in i for i in issues)


def test_wiring_is_taken_from_the_contract(monkeypatch):
    ctx, _ = _run([ANSWER], monkeypatch)
    ctx.workflow_spec.inventory = {"activities": [{"name": "affordability_calc",
                                                   "parameters": {"application": {"type": "object"}},
                                                   "required": ["application"]}]}
    steps = [
        {"id": "afford", "type": "tool", "config": {"tool_name": "affordability_calc",
                                                    "arguments": {"application": "{{raw}}"}}},
        {"id": "risk", "type": "agent", "config": {"query_template": "Assess."}},
    ]
    inputs = _apply_contract(ctx, steps, [{"name": "application", "type": "string"}])
    assert steps[0]["config"]["arguments"] == {"application": "{{application}}"}
    assert steps[1]["config"]["output_schema"]["required"] == ["risk_assessment"]
    assert inputs[0]["type"] == "object" and "schema" in inputs[0]


def test_reuse_requires_an_activity_that_fits_the_contract():
    from app.layers.codegen.layers import contract_misfit

    contract = {"input_schema": {"type": "object", "properties": {"application": APPLICATION}},
                "output_schema": {"type": "object", "properties": {"affordability_result": AFFORD}}}
    fits = {"schema": {"function": {"parameters": {"properties": {"application": APPLICATION}}}},
            "output_schema": {"properties": {"affordability_result": AFFORD}}}
    assert contract_misfit(contract, fits) == []
    renamed = {"schema": {"function": {"parameters": {"properties": {"app": APPLICATION}}}},
               "output_schema": {"properties": {"affordability_result": {
                   "type": "object", "properties": {"instalment": {"type": "number"}}}}}}
    problems = contract_misfit(contract, renamed)
    assert "takes no 'application'" in problems
    assert any("monthly_instalment_gbp" in p for p in problems)
    assert contract_misfit({}, renamed) == []
