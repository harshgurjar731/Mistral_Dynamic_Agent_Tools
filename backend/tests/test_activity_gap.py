"""ActivityGapLayer retries failed builds, defers what can be rebuilt, and reports the rest;
a saved workflow's activity step can be rebuilt on demand."""

import asyncio
import json

import pytest

from app.core.context import PipelineContext
from app.core.specs import CapabilitySpec, CodeRequirement, CodeResolution, WorkflowSpec
from app.layers.workflow import tool_gap_layer
from app.services.workflow_engine import activity_rebuild
from app.services.workflow_engine.models import WorkflowDefinition

REQ = {"name": "apply_gst", "description": "GST", "purpose": "activity", "kind": "pure",
       "input_schema": {"type": "object", "properties": {"subtotal": {"type": "number"}},
                        "required": ["subtotal"]},
       "output_schema": {"type": "object", "properties": {"grand_total": {"type": "number"}}}}


def _ctx(*caps):
    spec = WorkflowSpec(goal="invoice", capabilities=[
        CapabilitySpec(id=c, name=c, purpose=f"do {c}", kind="activity") for c in caps])
    return PipelineContext(workflow_spec=spec)


def _plan(ctx):
    event = next(e for e in ctx.events if e.event == "activity_plan")
    return json.loads(event.data)


@pytest.fixture
def resolve(monkeypatch):
    """Script resolve_code_needs: one list of resolutions per call."""
    calls: list[list] = []

    def install(*rounds):
        queue = list(rounds)

        async def fake(needs, **kw):
            calls.append([n.capability["id"] for n in needs])
            return queue.pop(0)[: len(needs)]

        import app.layers.codegen as codegen
        monkeypatch.setattr(codegen, "resolve_code_needs", fake)
        return calls
    return install


def _run(ctx):
    async def done(c):
        return c
    return asyncio.run(tool_gap_layer.ActivityGapLayer().process(ctx, done))


def test_failed_activity_is_retried_once_on_its_own(resolve):
    calls = resolve(
        [CodeResolution(status="built", name="a1", version=1),
         CodeResolution(status="failed", name="b1", message="Tool Service unreachable")],
        [CodeResolution(status="built", name="b1", version=1,
                        requirement=CodeRequirement.from_dict({**REQ, "name": "b1"}))],
    )
    ctx = _run(_ctx("a", "b"))
    assert calls == [["a", "b"], ["b"]]
    assert ctx.metadata["activity_bindings"] == {"a": "a1", "b": "b1"}
    assert _plan(ctx)["failed"] == [] and ctx.metadata["build_issues"] == []


def test_blocked_activity_is_not_retried(resolve):
    calls = resolve([CodeResolution(status="blocked", name="x", message="policy")])
    ctx = _run(_ctx("a"))
    assert calls == [["a"]]
    assert ctx.metadata["build_issues"][0]["code"] == "activity.unbuilt"


def test_build_failure_with_sound_spec_is_deferred_to_first_run(resolve):
    failing = CodeResolution(status="failed", name="apply_gst", message="rolled back",
                             retry_requirement=REQ, rolled_back=True)
    resolve([failing], [failing])
    ctx = _run(_ctx("gst"))
    assert ctx.metadata["activity_bindings"] == {"gst": "apply_gst"}
    assert ctx.metadata["activity_requirements"]["gst"] == REQ
    issue = ctx.metadata["build_issues"][0]
    assert issue["code"] == "activity.deferred" and issue["severity"] == "warning"
    row = _plan(ctx)["failed"][0]
    assert row["deferred"] and row["rolled_back"]
    assert any(a["name"] == "apply_gst" for a in ctx.workflow_spec.inventory["activities"])


def test_unsound_spec_is_reported_as_an_error_and_left_unbound(resolve):
    failing = CodeResolution(status="failed", name="apply_gst", message="could not be made implementable")
    resolve([failing], [failing])
    ctx = _run(_ctx("gst"))
    assert ctx.metadata["activity_bindings"] == {}
    issue = ctx.metadata["build_issues"][0]
    assert issue["code"] == "activity.unbuilt" and issue["severity"] == "error"
    assert issue["step_id"] == "gst"
    assert _plan(ctx)["failed"][0]["deferred"] is False


# ── On-demand rebuild of a saved step ──────────────────────────────────────


def _definition(config):
    return WorkflowDefinition(name="invoice_flow", entry_step="gst", steps=[
        {"id": "gst", "type": "tool", "description": "apply GST", "config": config,
         "next_steps": ["letter"]},
        {"id": "letter", "type": "agent", "config": {
            "agent_id": "ag_1", "query_template": "Total {{step_gst_output.grand_total}}"}},
    ])


def test_rebuild_uses_the_stored_requirement_and_rebinds(monkeypatch):
    import app.layers.codegen as codegen
    seen = {}

    async def fake(need, **_):
        seen["need"] = need
        return CodeResolution(status="built", name="apply_gst", version=3,
                              requirement=CodeRequirement.from_dict(REQ))

    monkeypatch.setattr(codegen, "resolve_code_need", fake)
    definition = _definition({"tool_name": "apply_gst", "code_requirement": REQ})
    resolution, changed = asyncio.run(activity_rebuild.rebuild_step_activity(definition, "gst"))
    assert changed and seen["need"].origin == "runtime"
    assert definition.steps[0].config["tool_version"] == 3


def test_rebuild_without_requirement_authors_from_the_workflow(monkeypatch):
    import app.layers.codegen as codegen
    seen = {}

    async def fake(need, **_):
        seen["need"] = need
        return CodeResolution(status="failed", message="still broken", rolled_back=True)

    monkeypatch.setattr(codegen, "resolve_code_need", fake)
    definition = _definition({"tool_name": "", "arguments": {"subtotal": "{{subtotal}}"}})
    resolution, changed = asyncio.run(activity_rebuild.rebuild_step_activity(definition, "gst"))
    assert not changed and definition.steps[0].config == {"tool_name": "", "arguments": {"subtotal": "{{subtotal}}"}}
    cap = seen["need"].capability
    assert cap["inputs"] == ["subtotal"] and cap["outputs"] == ["grand_total"]


def test_rebuild_rejects_a_non_activity_step():
    with pytest.raises(activity_rebuild.RebuildError):
        asyncio.run(activity_rebuild.rebuild_step_activity(
            _definition({"tool_name": "x"}), "letter"))
