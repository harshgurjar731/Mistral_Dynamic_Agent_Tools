"""Topology pins activity versions; runtime recovery only rebuilds what was specified."""

import asyncio
from types import SimpleNamespace

from app.core.specs import CodeResolution, WorkflowSpec
from app.layers.workflow.topology_layer import _pin_activity
from app.services.workflow_engine import step_runners
from app.services.workflow_engine.models import WorkflowStep


def _ctx(metadata, activities=()):
    return SimpleNamespace(metadata=metadata,
                           workflow_spec=WorkflowSpec(inventory={"activities": list(activities)}))


def test_bound_activity_gets_version_and_requirement():
    ctx = _ctx({"activity_bindings": {"gst": "apply_gst"}, "activity_versions": {"gst": 3},
                "activity_requirements": {"gst": {"name": "apply_gst"}}})
    config = {"tool_name": "apply_gst"}
    _pin_activity(ctx, "gst", "apply_gst", config)
    assert config["tool_version"] == 3 and config["code_requirement"] == {"name": "apply_gst"}


def test_catalogue_activity_chosen_by_the_model_is_pinned_to_its_version():
    ctx = _ctx({}, [{"name": "format_invoice", "version": 2}])
    config = {"tool_name": "format_invoice"}
    _pin_activity(ctx, "fmt", "format_invoice", config)
    assert config == {"tool_name": "format_invoice", "tool_version": 2}


def test_step_without_requirement_is_not_rebuilt_from_guesses():
    step = WorkflowStep(id="gst", type="tool", config={"tool_name": "apply_gst"})
    rebuilt, message = asyncio.run(step_runners._recover_missing_activity(step, "apply_gst"))
    assert not rebuilt and "no specification" in message


def test_step_with_requirement_is_rebuilt_and_unpinned(monkeypatch):
    import app.layers.codegen as codegen

    seen = {}

    async def fake_resolve(need, **_):
        seen["need"] = need
        return CodeResolution(status="built", name="apply_gst", version=1)

    monkeypatch.setattr(codegen, "resolve_code_need", fake_resolve)
    step = WorkflowStep(id="gst", type="tool", config={
        "tool_name": "apply_gst", "tool_version": 4,
        "code_requirement": {"name": "apply_gst", "description": "GST"}})
    rebuilt, _ = asyncio.run(step_runners._recover_missing_activity(step, "apply_gst"))
    assert rebuilt and "tool_version" not in step.config
    assert seen["need"].origin == "runtime" and seen["need"].requirement["name"] == "apply_gst"
