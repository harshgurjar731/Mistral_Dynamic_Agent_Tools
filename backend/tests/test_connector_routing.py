"""Connector mode needs a real, attachable connector; invalid plans are never compiled."""

import asyncio
from types import SimpleNamespace

from app.core.specs import CapabilitySpec, WorkflowSpec
from app.layers.workflow.execution_mode_layer import ExecutionModeLayer


def _ctx(capabilities, connector_ids):
    spec = WorkflowSpec(goal="g", capabilities=capabilities,
                        inventory={"connector_ids": connector_ids})
    return SimpleNamespace(workflow_spec=spec, metadata={}, emit=lambda *a, **k: None)


def _decide(cap_id, mode, connector_id=None):
    return {"capability_id": cap_id, "mode": mode, "connector_id": connector_id,
            "rationale": "r", "redundant": False, "merge_into": None}


def test_public_api_without_a_connector_becomes_an_activity():
    fx = CapabilitySpec(id="currency_conversion", name="convert", purpose="Frankfurter API")
    ctx = _ctx([fx], connector_ids=["conn_github"])  # some connector exists, not this one
    ExecutionModeLayer().apply(ctx, {"decisions": [_decide("currency_conversion", "connector")]})
    assert fx.kind == "activity" and fx.connector_id is None


def test_unknown_connector_id_is_demoted_too():
    fx = CapabilitySpec(id="fx", name="convert", purpose="p")
    ctx = _ctx([fx], connector_ids=["conn_github"])
    ExecutionModeLayer().apply(ctx, {"decisions": [_decide("fx", "connector", "conn_made_up")]})
    assert fx.kind == "activity"


def test_attachable_connector_is_kept_and_remembered():
    issue = CapabilitySpec(id="open_issue", name="open", purpose="file a GitHub issue")
    ctx = _ctx([issue], connector_ids=["conn_github"])
    ExecutionModeLayer().apply(ctx, {"decisions": [_decide("open_issue", "connector", "conn_github")]})
    assert issue.kind == "connector" and issue.connector_id == "conn_github"


def test_topology_binds_the_chosen_connector():
    from app.layers.workflow.topology_layer import StepTopologyLayer

    issue = CapabilitySpec(id="open_issue", name="open", purpose="p", kind="connector",
                           connector_id="conn_github")
    ctx = _ctx([issue], connector_ids=["conn_github"])
    ctx.workflow_spec.provisioned_agents = []
    StepTopologyLayer().apply(ctx, {"steps": [{
        "id": "open_issue", "type": "connector", "binding": {"tool_name": "create_issue"},
        "next_steps": [],
    }], "entry_step": "open_issue"})
    step = ctx.workflow_spec.topology["steps"][0]
    assert step["config"]["connector_id"] == "conn_github"
    assert step["config"]["tool_name"] == "create_issue"


def test_invalid_plan_is_not_compiled(monkeypatch, tmp_path):
    from app.layers.workflow import finalize_layers

    written = []
    monkeypatch.setattr("app.services.mistral_workflows_compiler.compile_workflow_to_python",
                        lambda d: written.append(d) or "code")
    events = []
    spec = WorkflowSpec(goal="g", workflow_name="broken")
    spec.definition = object()
    ctx = SimpleNamespace(workflow_spec=spec,
                          metadata={finalize_layers.VALIDATION_FAILED_KEY: True},
                          emit=lambda kind, payload: events.append((kind, payload)))

    async def done(c):
        return c

    asyncio.run(finalize_layers.WorkflowCompilationLayer().process(ctx, done))
    assert written == [] and events and events[0][0] == "compiled" and "Not compiled" in events[0][1]
