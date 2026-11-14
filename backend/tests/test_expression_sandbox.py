"""Condition and transform steps: the scope they run in is the scope they are checked against.

The SME equipment finance recording needed two hand-written revisions because
transform code used ``round`` (not in the old sandbox) and never assigned
``output``. Both are now either supported or rejected at plan time.
"""

import asyncio

from app.services.workflow_engine.expression_sandbox import (
    check_condition,
    check_transform,
    eval_condition,
    run_transform,
)
from app.services.workflow_engine.models import StepType, WorkflowStep
from app.services.workflow_engine.step_runners import run_condition_step, run_transform_step
from app.services.workflow_engine.validation import _validate_condition_step, _validate_transform_step

DEPOSIT = """
src = variables.get('step_check_output') or {}
src = json.loads(src) if isinstance(src, str) else src
app = src.get('validated_application') or {}
cost = float(app.get('equipment_cost') or 0)
dep = float(app.get('deposit_amount') or 0)
need = round(cost * 0.1, 2)
output = {'min_deposit_gbp': need, 'deposit_ok': dep >= need,
          'shortfall': max(need - dep, 0.0)}
"""


def _step(kind, **config):
    return WorkflowStep(id="s", type=kind, config=config, next_steps=[])


def test_statements_with_round_and_max_run():
    variables = {"step_check_output": {"validated_application": {"equipment_cost": 185000,
                                                                 "deposit_amount": 32000}}}
    out = run_transform(DEPOSIT, variables)
    assert out == {"min_deposit_gbp": 18500.0, "deposit_ok": True, "shortfall": 0.0}
    assert check_transform(DEPOSIT) is None


def test_single_expression_is_the_output():
    code = "{'total': round(sum(x['amount'] for x in variables['items']), 2)}"
    assert check_transform(code) is None
    assert run_transform(code, {"items": [{"amount": 1.005}, {"amount": 2}]}) == {"total": 3.0}


def test_json_string_upstream_output_is_readable():
    code = "json.loads(variables['step_a_output'])['x'] * 2"
    assert run_transform(code, {"step_a_output": '{"x": 21}'}) == 42


def test_check_rejects_what_would_fail_at_run_time():
    assert "assign the result to `output`" in check_transform("x = 1\ny = x + 1")
    assert "math" in check_transform("output = {'v': math.floor(2.5)}")
    assert "imports are not allowed" in check_transform("import os\noutput = {}")
    assert "cannot be used" in check_transform("output = ().__class__")
    assert "syntax error" in check_transform("output = {")


def test_comprehension_and_loop_names_are_bound():
    code = "rows = variables['rows']\noutput = {'n': len([r for r in rows if r])}\nfor i in range(2):\n    pass"
    assert check_transform(code) is None


def test_condition_builtins_work_and_are_checked():
    assert eval_condition("len([1, 2]) == 2 and round(2.456, 1) == 2.5") is True
    assert check_condition("{{step_calc_output.deposit_ok}} == True") is None
    assert check_condition("len({{step_x_output.items}}) > 0") is None
    assert "reference workflow values" in check_condition("deposit_ok == True")
    assert "imports" in check_condition("__import__('os')") or "cannot be used" in check_condition("__import__('os')")


def test_validation_reports_transform_and_condition_problems():
    issues = list(_validate_transform_step(_step(StepType.TRANSFORM, transform_code="x = round(1.2)")))
    assert [i.code for i in issues] == ["transform.cannot_run"]
    assert not list(_validate_transform_step(_step(StepType.TRANSFORM, transform_code=DEPOSIT)))
    issues = list(_validate_condition_step(_step(StepType.CONDITION, expression="ok == True",
                                                 true_step="s", false_step="s"), {"s"}))
    assert [i.code for i in issues] == ["condition.cannot_evaluate"]


def test_runners_use_the_sandbox():
    variables = {"step_check_output": {"validated_application": {"equipment_cost": 100,
                                                                 "deposit_amount": 5}}}
    result = asyncio.run(run_transform_step(_step(StepType.TRANSFORM, transform_code=DEPOSIT), variables))
    assert result.status == "completed"
    assert result.output["deposit_ok"] is False and result.output["shortfall"] == 5.0

    cond = _step(StepType.CONDITION, expression="len({{items}}) == 2", true_step="yes", false_step="no")
    result = asyncio.run(run_condition_step(cond, {"items": [1, 2]}))
    assert result.status == "completed" and result.output["next_step"] == "yes"
