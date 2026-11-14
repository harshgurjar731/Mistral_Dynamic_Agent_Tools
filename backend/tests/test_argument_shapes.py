"""Plan-time check of activity arguments against the activity's input schema.

Built from the SME equipment finance workflow: activities authored with
different field names (``annual_turnover`` vs ``annual_turnover_gbp``) and an
``underwriter_review`` call whose ``referral_case`` lacked required fields.
Both passed validation and failed the run; both are now errors before publish.
"""

from app.services.workflow_engine.argument_shapes import (
    catalog_from_inventory,
    catalog_from_listing,
    check_argument_shapes,
)

APPLICATION = {
    "type": "object",
    "properties": {"business_name": {"type": "string"}, "annual_turnover": {"type": "number"},
                   "equipment_cost": {"type": "number"}},
    "required": ["business_name", "annual_turnover", "equipment_cost"],
}

ACTIVITIES = {
    "completeness_check": {
        "input": {"type": "object", "properties": {"classified_application": APPLICATION},
                  "required": ["classified_application"]},
        "output": {"type": "object", "properties": {
            "validated_application": {"type": "object", "properties": {
                "equipment_cost": {"type": "number"}, "business_name": {"type": "string"}}},
            "is_complete": {"type": "boolean"}}},
    },
    "affordability_calculation": {
        "input": {"type": "object", "properties": {"validated_application": {
            "type": "object",
            "properties": {"equipment_cost_gbp": {"type": "number"}, "term_months": {"type": "integer"}},
            "required": ["equipment_cost_gbp", "term_months"]}},
            "required": ["validated_application"]},
        "output": {"type": "object", "properties": {"monthly_instalment_gbp": {"type": "number"}}},
    },
}


def _workflow(steps, inputs=None):
    return {"name": "w", "entry_step": steps[0]["id"], "steps": steps,
            "input_schema": inputs or [{"name": "raw_application", "type": "object", "schema": {
                "type": "object", "properties": {
                    "business_name": {"type": "string"}, "annual_turnover": {"type": "number"},
                    "equipment_cost": {"type": "number"}, "loan_term_months": {"type": "integer"}}}}]}


def _tool(step_id, tool, arguments):
    return {"id": step_id, "type": "tool", "next_steps": [],
            "config": {"tool_name": tool, "arguments": arguments}}


def test_whole_upstream_record_with_other_field_names_is_an_error():
    wf = _workflow([
        _tool("check", "completeness_check", {"classified_application": "{{raw_application}}"}),
        _tool("afford", "affordability_calculation",
              {"validated_application": "{{step_check_output.validated_application}}"}),
    ])
    issues = check_argument_shapes(wf, ACTIVITIES)
    assert [i["step_id"] for i in issues] == ["afford"]
    assert "equipment_cost_gbp" in issues[0]["message"] and "term_months" in issues[0]["message"]
    assert issues[0]["code"] == "dataflow.argument_shape"


def test_explicit_mapping_onto_the_parameter_names_passes():
    wf = _workflow([
        _tool("check", "completeness_check", {"classified_application": "{{raw_application}}"}),
        _tool("afford", "affordability_calculation", {"validated_application": {
            "equipment_cost_gbp": "{{step_check_output.validated_application.equipment_cost}}",
            "term_months": "{{raw_application.loan_term_months}}"}}),
    ])
    assert check_argument_shapes(wf, ACTIVITIES) == []


def test_literal_record_missing_a_required_field():
    wf = _workflow([_tool("afford", "affordability_calculation",
                          {"validated_application": {"equipment_cost_gbp": 185000}})])
    issues = check_argument_shapes(wf, ACTIVITIES)
    assert len(issues) == 1 and "term_months" in issues[0]["message"]
    assert issues[0]["field"] == "arguments.validated_application"


def test_scalar_or_text_where_a_record_is_required():
    wf = _workflow([
        _tool("check", "completeness_check", {"classified_application": "{{raw_application.business_name}}"}),
        _tool("check2", "completeness_check", {"classified_application": "Application: {{raw_application}}"}),
    ])
    codes = {(i["step_id"], i["code"]) for i in check_argument_shapes(wf, ACTIVITIES)}
    assert codes == {("check", "dataflow.argument_shape"), ("check2", "dataflow.argument_shape")}


def test_missing_required_parameter():
    wf = _workflow([_tool("afford", "affordability_calculation", {})])
    issues = check_argument_shapes(wf, ACTIVITIES)
    assert len(issues) == 1 and "validated_application" in issues[0]["message"]


def test_unknown_sources_are_not_judged():
    agent = {"id": "risk", "type": "agent", "next_steps": [], "config": {"agent_id": "a"}}
    wf = _workflow([agent, _tool("afford", "affordability_calculation",
                                 {"validated_application": "{{step_risk_output.result}}"})])
    assert check_argument_shapes(wf, ACTIVITIES) == []


def test_planned_requirement_is_used_when_the_activity_is_not_listed():
    step = _tool("afford", "affordability_calculation", {"validated_application": {}})
    step["config"]["code_requirement"] = {"input_schema": ACTIVITIES["affordability_calculation"]["input"]}
    issues = check_argument_shapes(_workflow([step]), {})
    assert len(issues) == 1


def test_catalog_adapters():
    listing = catalog_from_listing([{
        "name": "x", "status": "approved", "is_active": True, "version_no": 3,
        "schema": {"function": {"name": "x", "parameters": {"type": "object", "properties": {}}}},
        "output_schema": {"type": "object"}}])
    assert listing["x"]["version"] == 3 and listing["x"]["input"]["type"] == "object"
    inv = catalog_from_inventory([{"name": "y", "parameters": {"a": {"type": "number"}}, "required": ["a"],
                                   "output_schema": None}])
    assert inv["y"]["input"] == {"type": "object", "properties": {"a": {"type": "number"}}, "required": ["a"]}
