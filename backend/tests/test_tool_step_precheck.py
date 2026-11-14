"""An activity step checks its arguments against the activity's input schema before calling it.

In the recording, ``underwriter_review`` was called with a ``referral_case`` of
the wrong shape and the tool service answered 422 with the first problem only.
The step now fails before the call, listing every mismatch.
"""

import asyncio

from app.services.workflow_engine import step_runners
from app.services.workflow_engine.models import StepType, WorkflowStep

PARAMS = {
    "type": "object",
    "properties": {
        "referral_case": {
            "type": "object",
            "properties": {
                "application": {"type": "object",
                                "properties": {"business_name": {"type": "string"},
                                               "requested_amount_gbp": {"type": "number"}},
                                "required": ["business_name", "requested_amount_gbp"]},
                "referral_reasons": {"type": "array", "items": {"type": "string"}},
            },
            "required": ["application", "referral_reasons"],
        },
    },
    "required": ["referral_case"],
}


def _patch(monkeypatch, calls):
    async def params(_name):
        return PARAMS

    async def execute(name, arguments, version=None):
        calls.append(arguments)
        return {"status": "success", "data": {"ok": True}}

    monkeypatch.setattr(step_runners, "_tool_parameters", params)
    from app.services import tool_registry

    monkeypatch.setattr(tool_registry, "execute_tool", execute)


def _step(arguments):
    return WorkflowStep(id="review", type=StepType.TOOL, next_steps=[],
                        config={"tool_name": "underwriter_review", "arguments": arguments})


def test_mismatched_arguments_fail_before_the_call(monkeypatch):
    calls = []
    _patch(monkeypatch, calls)
    step = _step({"referral_case": {"application": {"business_name": "{{name}}"},
                                    "referral_reasons": "{{reasons}}"}})
    result = asyncio.run(step_runners.run_tool_step(step, {"name": "Northfield Fabrication",
                                                           "reasons": {"r": "watchlist"}}))
    assert result.status == "failed"
    assert calls == []
    assert "requested_amount_gbp" in result.error
    assert "referral_case/referral_reasons" in result.error


def test_matching_arguments_are_sent(monkeypatch):
    calls = []
    _patch(monkeypatch, calls)
    step = _step({"referral_case": {"application": {"business_name": "{{name}}",
                                                    "requested_amount_gbp": "{{amount}}"},
                                    "referral_reasons": ["policy referral"]}})
    result = asyncio.run(step_runners.run_tool_step(step, {"name": "N", "amount": 153000}))
    assert result.status == "completed", result.error
    assert calls and calls[0]["referral_case"]["application"]["requested_amount_gbp"] == 153000
