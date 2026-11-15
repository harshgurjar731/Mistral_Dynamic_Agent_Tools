"""Auto-wire arguments in the builder: kept, exact name, then model — every reference checked."""

import asyncio

import pytest

from app.services.workflow_engine import argument_wiring as aw

CHECK_OUT = {"type": "object", "properties": {
    "applicant": {"type": "object", "properties": {"income": {"type": "number"}}},
    "equipment_cost": {"type": "number"}}}
AFFORD_IN = {"type": "object", "properties": {
    "equipment_cost": {"type": "number"}, "annual_income": {"type": "number"},
    "currency": {"type": "string"}, "term_months": {"type": "integer"}},
    "required": ["equipment_cost", "annual_income", "term_months"]}
CATALOG = {"check": {"input": {"type": "object", "properties": {}}, "output": CHECK_OUT, "version": 1},
           "afford": {"input": AFFORD_IN, "output": None, "version": 1}}


def _definition(arguments=None):
    return {"name": "loan", "entry_step": "c", "input_schema": [{"name": "application", "type": "object"}],
            "steps": [
                {"id": "c", "type": "tool", "next_steps": ["a"], "config": {"tool_name": "check", "arguments": {}}},
                {"id": "a", "type": "tool", "next_steps": [],
                 "config": {"tool_name": "afford", "arguments": arguments or {}}},
            ]}


def _model(answer):
    async def ask(client, step, params, upstream, wired, todo):
        ask.seen = {"todo": todo, "wired": dict(wired)}
        return answer, {"annual_income": "income is the annual figure"}
    return ask


def test_exact_names_then_model_and_bad_paths_are_dropped(monkeypatch):
    ask = _model({"annual_income": "{{step_c_output.applicant.income}}",
                  "term_months": "{{step_c_output.applicant.term}}",  # not in the schema
                  "currency": "GBP"})
    monkeypatch.setattr(aw, "_ask_model", ask)
    out = asyncio.run(aw.wire_arguments(_definition(), "a", catalog=CATALOG, client=object()))
    assert ask.seen["wired"] == {"equipment_cost": "{{step_c_output.equipment_cost}}"}
    assert out["arguments"] == {"equipment_cost": "{{step_c_output.equipment_cost}}",
                                "annual_income": "{{step_c_output.applicant.income}}",
                                "currency": "GBP"}
    assert out["sources"] == {"equipment_cost": "exact", "annual_income": "model", "currency": "model"}
    assert out["missing"] == ["term_months"]
    assert "does not exist" in out["notes"]["term_months"]


def test_fitting_arguments_are_kept_and_the_model_is_not_needed(monkeypatch):
    monkeypatch.setattr(aw, "_ask_model", _model({}))
    args = {"annual_income": "{{step_c_output.applicant.income}}", "term_months": 36,
            "currency": "GBP"}
    out = asyncio.run(aw.wire_arguments(_definition(args), "a", catalog=CATALOG, use_model=False))
    assert out["sources"]["annual_income"] == "kept" and out["sources"]["equipment_cost"] == "exact"
    assert out["missing"] == [] and out["issues"] == []


def test_a_reference_to_a_later_step_is_refused(monkeypatch):
    monkeypatch.setattr(aw, "_ask_model", _model({"annual_income": "{{step_a_output.x}}"}))
    out = asyncio.run(aw.wire_arguments(_definition(), "a", catalog=CATALOG, client=object()))
    assert "annual_income" not in out["arguments"]


def test_only_activity_steps_are_wired():
    with pytest.raises(aw.WiringError):
        asyncio.run(aw.wire_arguments({"steps": [{"id": "x", "type": "agent", "config": {}}]}, "x",
                                      catalog={}))
