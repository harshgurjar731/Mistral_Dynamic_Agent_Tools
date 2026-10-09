"""Planning stops and asks when something cannot be built, and the user drives
testing, accepting and rolling back the built workflow."""

import asyncio
import json

import pytest

from app.core.context import PipelineContext
from app.core.specs import CapabilitySpec, CodeRequirement, CodeResolution, WorkflowSpec
from app.layers.workflow import finalize_layers, plan_control, tool_gap_layer
from app.runs.manager import LiveRun
from app.services.workflow_engine.models import WorkflowDefinition

REQ = {"name": "apply_gst", "description": "GST", "purpose": "activity", "kind": "pure",
       "input_schema": {"type": "object", "properties": {"subtotal": {"type": "number"}},
                        "required": ["subtotal"]}}


class FakeRun:
    """An event sink that answers questions from a script."""

    def __init__(self, *choices):
        self.choices = list(choices)
        self.questions: list[dict] = []
        self.events: list[tuple[str, str]] = []

    def put_nowait(self, sse):
        self.events.append((sse.event, sse.data))

    async def ask(self, kind, question, *, options, default):
        self.questions.append({"kind": kind, "options": options, "default": default, **question})
        return {"choice": self.choices.pop(0)}

    def payloads(self, event):
        return [json.loads(d) for e, d in self.events if e == event]


def _ctx(run, *caps):
    spec = WorkflowSpec(goal="invoice", capabilities=[
        CapabilitySpec(id=c, name=c, purpose=f"do {c}", kind="activity") for c in caps])
    ctx = PipelineContext(workflow_spec=spec)
    ctx.event_queue = run
    return ctx


def _done(c):
    async def go(ctx):
        return ctx
    return go(c)


def _resolver(monkeypatch, *rounds):
    queue, calls = list(rounds), []

    async def fake(needs, **kw):
        calls.append([n.capability["id"] for n in needs])
        return queue.pop(0)[: len(needs)]

    import app.layers.codegen as codegen
    monkeypatch.setattr(codegen, "resolve_code_needs", fake)
    return calls


def _failing(name="apply_gst"):
    return CodeResolution(status="failed", name=name, message="code kept failing", rolled_back=True)


def _built(name, tool_id):
    return CodeResolution(status="built", name=name, version=1, tool_id=tool_id, created=True,
                          requirement=CodeRequirement.from_dict({**REQ, "name": name}))


# ── LiveRun.ask ─────────────────────────────────────────────────────────────


def test_live_run_waits_for_the_users_answer():
    async def go():
        run = LiveRun(id="r1", kind="workflow_plan", title="t", request={})
        task = asyncio.create_task(run.ask("build_failed", {"title": "x"},
                                           options=["retry", "manual"], default="manual"))
        await asyncio.sleep(0)
        asked = run.payload("decision_required")
        assert run.answer(asked["id"], "rollback") is not None, "not an offered choice"
        assert run.answer(asked["id"], "retry") is None
        answer = await task
        return run, answer

    run, answer = asyncio.run(go())
    assert answer["choice"] == "retry"
    assert run.payload("decision_made")["by"] == "user"


def test_live_run_takes_the_default_when_nobody_answers():
    async def go():
        run = LiveRun(id="r2", kind="workflow_plan", title="t", request={})
        return run, await run.ask("review_workflow", {}, options=["test", "accept"],
                                  default="accept", timeout=0.01)

    run, answer = asyncio.run(go())
    assert answer["choice"] == "accept" and run.payload("decision_made")["by"] == "timeout"


# ── Activities ──────────────────────────────────────────────────────────────


def test_failed_activity_is_retried_when_the_user_asks(monkeypatch):
    calls = _resolver(monkeypatch, [_built("a1", 1), _failing("b1")], [_failing("b1")],
                      [_built("b1", 2)])
    run = FakeRun("retry")
    ctx = asyncio.run(tool_gap_layer.ActivityGapLayer().process(_ctx(run, "a", "b"), _done))
    assert calls == [["a", "b"], ["b"], ["b"]]
    assert run.questions[0]["kind"] == "build_failed" and run.questions[0]["attempts"] == 2
    assert [f["id"] for f in run.questions[0]["failures"]] == ["b"]
    assert ctx.metadata["activity_bindings"] == {"a": "a1", "b": "b1"}
    assert [c["name"] for c in plan_control.created(ctx)] == ["a1", "b1"]


def test_rollback_removes_what_the_plan_built_and_stops(monkeypatch):
    _resolver(monkeypatch, [_built("a1", 7), _failing("b1")], [_failing("b1")])
    from app.services import tool_resolver as tr

    deleted = []

    async def delete_tool(tool_id):
        deleted.append(tool_id)
        return {"status": "deleted", "message": "Tool deleted (1 version(s))"}

    monkeypatch.setattr(tr.tool_resolver, "delete_tool", delete_tool)
    run = FakeRun("rollback")
    ctx = asyncio.run(tool_gap_layer.ActivityGapLayer().process(_ctx(run, "a", "b"), _done))
    assert deleted == [7]
    assert ctx.error and "Rolled back" in ctx.error
    assert ctx.metadata[plan_control.ROLLED_BACK_KEY]
    assert run.payloads("plan_rolled_back")[0]["items"][0]["removed"] is True
    assert not run.payloads("activity_plan"), "planning stopped before binding anything"


def test_manual_finishes_the_plan_without_the_failed_activity(monkeypatch):
    _resolver(monkeypatch, [_failing()], [_failing()])
    run = FakeRun("manual")
    ctx = asyncio.run(tool_gap_layer.ActivityGapLayer().process(_ctx(run, "gst"), _done))
    assert ctx.error is None
    row = run.payloads("activity_plan")[0]["failed"][0]
    assert row["manual"] is True
    assert ctx.metadata["build_issues"][0]["code"] == "activity.unbuilt"


# ── Review: user-driven test, accept, rollback ─────────────────────────────


def _review_ctx(run, monkeypatch, tests):
    definition = WorkflowDefinition(name="invoice_flow", entry_step="gst", steps=[
        {"id": "gst", "type": "tool", "config": {"tool_name": "apply_gst"}}])
    spec = WorkflowSpec(goal="invoice", workflow_name="invoice_flow")
    spec.definition = definition
    ctx = PipelineContext(workflow_spec=spec)
    ctx.event_queue = run

    from app.services.workflow_engine import engine, plan_test

    monkeypatch.setattr(engine, "get_workflow", lambda name: definition)

    async def fake_test(defn, client):
        return tests.pop(0)

    monkeypatch.setattr(plan_test, "test_workflow", fake_test)
    return ctx


def test_review_tests_only_when_asked_then_accepts(monkeypatch):
    run = FakeRun("test", "accept")
    ctx = _review_ctx(run, monkeypatch, [{"passed": True, "summary": "1 passed"}])
    asyncio.run(finalize_layers.WorkflowReviewLayer().process(ctx, _done))
    assert [q["kind"] for q in run.questions] == ["review_workflow", "review_workflow"]
    assert run.questions[1]["last_test"] == {"passed": True, "summary": "1 passed"}
    assert run.payloads("workflow_test")[0]["passed"] is True
    assert run.payloads("workflow_accepted")[0] == {
        "workflow_name": "invoice_flow", "tested": True, "passed": True}
    assert ctx.error is None


def test_review_rollback_restores_an_overwritten_workflow(monkeypatch):
    run = FakeRun("rollback")
    ctx = _review_ctx(run, monkeypatch, [])
    previous = WorkflowDefinition(name="invoice_flow", entry_step="old", steps=[
        {"id": "old", "type": "tool", "config": {"tool_name": "x"}}])
    plan_control.record_created(ctx, "workflow", "invoice_flow", "invoice_flow",
                                previous=previous.model_dump(mode="json"))
    from app.services.workflow_engine import engine

    saved = []
    monkeypatch.setattr(engine, "save_workflow", lambda d: saved.append(d) or d.name)
    asyncio.run(finalize_layers.WorkflowReviewLayer().process(ctx, _done))
    assert saved and saved[0].entry_step == "old"
    assert ctx.metadata[plan_control.ROLLED_BACK_KEY] and not run.payloads("workflow_test")


def test_without_an_interactive_run_nothing_is_asked(monkeypatch):
    ctx = _review_ctx(None, monkeypatch, [])
    ctx.event_queue = None
    asyncio.run(finalize_layers.WorkflowReviewLayer().process(ctx, _done))
    assert ctx.error is None and not any(e.event == "decision_required" for e in ctx.events)
