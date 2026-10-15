"""Rebuilding a tool or activity from a run-time failure, and testing one by hand."""

import asyncio

import pytest

from app.core.specs import CodeNeed
from app.layers.codegen import pipeline
from app.services import code_rebuild, tool_testing
from app.services.workflow_engine.models import WorkflowDefinition
from tests.test_codegen_pipeline import GST_REQ, stub  # noqa: F401 — the fixture

RECORD = {"id": 11, "name": "apply_gst", "version_no": 3, "status": "approved",
          "purpose": "activity", "source_code": "def run(**kw):\n    return kw['subtotal'] * 1.18",
          "output_schema": GST_REQ["output_schema"],
          "spec": {**GST_REQ, "purpose": "activity", "origin": "workflow"}}


# ── The rebuild request ────────────────────────────────────────────────────


def test_rebuild_needs_an_error_or_a_comment():
    with pytest.raises(code_rebuild.RebuildError):
        code_rebuild.build_request(RECORD, error=" ", comment="", failing_input=None,
                                   expected_output=None)


def test_rebuild_keeps_the_contract_and_carries_the_failure():
    req, guidance = code_rebuild.build_request(
        RECORD, error="TypeError: can't multiply str", comment="subtotal may be a string",
        failing_input={"subtotal": "100"}, expected_output={"gst_amount": 18.0, "grand_total": 118.0})
    assert req["name"] == "apply_gst" and req["input_schema"] == GST_REQ["input_schema"]
    assert req["feedback"]["previous_code"].startswith("def run")
    assert req["feedback"]["failing_input"] == {"subtotal": "100"}
    assert req["examples"][-1]["input"] == {"subtotal": "100"}, "the fix is held to it from now on"
    assert guidance == ["subtotal may be a string", "Error seen at run time: TypeError: can't multiply str"]


def test_without_an_expected_output_no_example_is_invented():
    req, _ = code_rebuild.build_request(RECORD, error="boom", comment="", failing_input={"subtotal": 1},
                                        expected_output=None)
    assert req["examples"] == GST_REQ["examples"]


# ── The feedback pipeline ──────────────────────────────────────────────────


def _feedback_need(failing=None):
    req, guidance = code_rebuild.build_request(RECORD, error="TypeError", comment="accept strings",
                                               failing_input=failing, expected_output=None)
    return CodeNeed(purpose="activity", origin="feedback", name_hint="apply_gst",
                    intent=req["description"], guidance=guidance, requirement=req)


def _run(need, **kw):
    return asyncio.run(pipeline.resolve_code_need(need, client=object(), **kw))


def test_rebuild_is_screened_keeps_its_name_and_sends_the_feedback(stub):
    s = stub(answers={"policy gate": {"allowed": True}},
             catalogue=[{"name": "apply_gst", "purpose": "activity"}])
    resolution = _run(_feedback_need())
    assert resolution.status == "built" and resolution.name == "apply_gst"
    assert s.phases == ["policy gate"], "screened again — it carries typed text — but not re-authored"
    assert "accept strings" in s.prompts[0]
    assert s.submitted[0]["feedback"]["runtime_error"] == "TypeError"


def test_rebuild_blocked_by_policy_builds_nothing(stub):
    s = stub(answers={"policy gate": {"allowed": False, "reason": "no"}})
    assert _run(_feedback_need()).status == "blocked" and s.submitted == []


def test_rebuild_that_still_fails_on_the_failing_input_is_rolled_back_and_retried(stub, monkeypatch):
    s = stub(answers={"policy gate": {"allowed": True}},
             builds=[{"status": "approved", "tool_id": 21, "version": 4},
                     {"status": "approved", "tool_id": 22, "version": 5}])
    calls = {"n": 0}

    async def execute(name, arguments, version=None):
        if arguments == {"subtotal": "100"}:
            calls["n"] += 1
            if version == 4:
                return {"result": {"status": "error", "message": "still TypeError"}}
            return {"result": {"status": "success", "data": {"gst_amount": 18.0, "grand_total": 118.0}}}
        return await s.execute_tool(name, arguments, version)

    from app.services import tool_resolver as tr
    monkeypatch.setattr(tr.tool_resolver, "execute_tool", execute)
    resolution = _run(_feedback_need(failing={"subtotal": "100"}),
                      must_succeed=[{"subtotal": "100"}])
    assert resolution.status == "built" and resolution.version == 5
    assert s.rejected == [21], "the version that still failed was rolled back"
    assert "also failed" in s.submitted[1]["feedback"]["runtime_error"]
    assert calls["n"] == 2


# ── Re-pinning workflows ───────────────────────────────────────────────────


def test_steps_on_the_failed_version_move_to_the_fix(monkeypatch):
    from app.services.workflow_engine import engine

    wf = WorkflowDefinition(name="invoice_flow", entry_step="a", steps=[
        {"id": "a", "type": "tool", "config": {"tool_name": "apply_gst", "tool_version": 3},
         "next_steps": ["b"]},
        {"id": "b", "type": "tool", "config": {"tool_name": "apply_gst", "tool_version": 1},
         "next_steps": ["c"]},
        {"id": "c", "type": "tool", "config": {"tool_name": "apply_gst"}},
    ])
    saved = []
    monkeypatch.setattr(engine, "list_workflows", lambda: [wf])
    monkeypatch.setattr(engine, "save_workflow", lambda d: saved.append(d) or d.name)
    changed = code_rebuild.repin_workflows("apply_gst", 3, 4, {"name": "apply_gst", "feedback": {"x": 1}})
    assert changed == [{"workflow_name": "invoice_flow", "steps": ["a", "c"], "is_deployed": False}]
    assert wf.steps[0].config["tool_version"] == 4
    assert wf.steps[1].config["tool_version"] == 1, "a deliberate pin to another version is kept"
    assert "tool_version" not in wf.steps[2].config
    assert "feedback" not in wf.steps[0].config["code_requirement"]


# ── Manual test ─────────────────────────────────────────────────────────────


@pytest.fixture
def tool_service(monkeypatch):
    from app.services import tool_resolver as tr

    state = {"record": dict(RECORD), "response": None, "calls": []}

    async def get_tool(tool_id):
        return state["record"] if tool_id == state["record"]["id"] else None

    async def execute_tool(name, arguments, version=None):
        state["calls"].append((name, arguments, version))
        return state["response"]

    monkeypatch.setattr(tr.tool_resolver, "get_tool", get_tool)
    monkeypatch.setattr(tr.tool_resolver, "execute_tool", execute_tool)
    return state


def _test(**kw):
    return asyncio.run(tool_testing.run_test(11, {"subtotal": 100}, **kw))


def test_example_run_passes_and_pins_the_version(tool_service):
    tool_service["response"] = {"result": {"status": "success",
                                           "data": {"gst_amount": 18.0, "grand_total": 118.0}}}
    out = _test(example_index=0)
    assert out["outcome"] == "passed" and out["ok"]
    assert tool_service["calls"] == [("apply_gst", {"subtotal": 100}, 3)]


def test_wrong_output_and_missing_fields_are_reported(tool_service):
    tool_service["response"] = {"result": {"status": "success", "data": {"gst_amount": 20.0}}}
    out = _test(example_index=0)
    assert out["outcome"] == "wrong_output" and "expected 18.0" in out["error"]
    assert out["missing_fields"] == ["grand_total"]


def test_error_envelope_and_refused_call_are_told_apart(tool_service):
    tool_service["response"] = {"result": {"status": "error", "error_type": "runtime_crash",
                                           "message": "apply_gst raised an exception"}}
    assert _test()["outcome"] == "returned_error"
    tool_service["response"] = {"error": 'Tool Service returned 422: {"detail": "requires subtotal"}'}
    out = _test()
    assert out["outcome"] == "call_failed" and out["error"] == "requires subtotal"


def test_unapproved_or_side_effecting_versions_need_confirmation(tool_service):
    tool_service["record"] = {**RECORD, "status": "pending_approval"}
    with pytest.raises(tool_testing.TestRefused, match="approve it first"):
        _test()
    tool_service["record"] = {**RECORD, "side_effects": "write"}
    with pytest.raises(tool_testing.TestRefused, match="Confirm"):
        _test()
    tool_service["response"] = {"result": {"status": "success", "data": {}}}
    assert _test(allow_side_effects=True)["outcome"] == "wrong_output"
