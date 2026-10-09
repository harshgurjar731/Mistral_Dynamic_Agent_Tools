"""Run prerequisites: what blocks a run, what only warns, and how to fix each."""

import asyncio
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from app.services.workflow_engine import prerequisites
from app.services.workflow_engine.models import WorkflowDefinition

REQ = {"name": "apply_gst", "description": "GST", "kind": "pure", "secrets": ["GST_API_KEY"]}


class FakeAgents:
    def __init__(self, existing):
        self.existing = existing

    def get(self, agent_id):
        if agent_id not in self.existing:
            raise RuntimeError("404 agent not found")
        return SimpleNamespace(name=self.existing[agent_id])


def _client(**agents):
    return SimpleNamespace(beta=SimpleNamespace(agents=FakeAgents(agents)))


@pytest.fixture
def services(monkeypatch):
    """Tool service, connectors, attachments and libraries, all scripted."""
    from app.services import agent_service, connector_service, library_service
    from app.services import tool_resolver as tr

    state = {"up": True, "versions": {}, "secrets": {}, "connectors": {},
             "attachments": {}, "libraries": []}

    async def health_check():
        return state["up"]

    async def get_tool_versions(name):
        return state["versions"].get(name, [])

    async def secrets_status(names):
        return {n: state["secrets"].get(n, {"allowed": False, "set": False}) for n in names}

    async def get_connector(cid):
        if cid not in state["connectors"]:
            raise RuntimeError("not found")
        return state["connectors"][cid]

    async def list_libraries():
        return state["libraries"]

    monkeypatch.setattr(tr.tool_resolver, "health_check", health_check)
    monkeypatch.setattr(tr.tool_resolver, "get_tool_versions", get_tool_versions)
    monkeypatch.setattr(tr.tool_resolver, "secrets_status", secrets_status)
    monkeypatch.setattr(connector_service, "get_connector", get_connector)
    monkeypatch.setattr(library_service, "list_libraries", list_libraries)
    monkeypatch.setattr(agent_service, "current_attachments",
                        lambda agent_id: state["attachments"].get(
                            agent_id, {"connectors": [], "document_library_ids": None}))
    return state


def _definition(*steps, deployed=True):
    steps = list(steps)
    for a, b in zip(steps, steps[1:]):
        a.setdefault("next_steps", [b["id"]])
    return WorkflowDefinition(name="invoice_flow", entry_step=steps[0]["id"], steps=steps,
                              is_deployed=deployed)


def _check(definition, client=None):
    return asyncio.run(prerequisites.check_prerequisites(definition, client or _client()))


def _by_id(report):
    return {i["id"]: i for i in report["items"]}


def test_everything_in_place_is_ready(services):
    services["versions"]["apply_gst"] = [{"id": 4, "version_no": 2, "status": "approved",
                                          "is_active": True}]
    services["secrets"]["GST_API_KEY"] = {"allowed": True, "set": True}
    report = _check(_definition(
        {"id": "gst", "type": "tool", "config": {"tool_name": "apply_gst", "code_requirement": REQ}},
        {"id": "letter", "type": "agent", "config": {"agent_id": "ag_1"}},
    ), _client(ag_1="Letter writer"))
    assert report["ready"], [i for i in report["items"] if i["blocking"]]
    assert _by_id(report)["activity.gst"]["action"]["to"] == "/workflows/activities/4"


def test_missing_activity_blocks_with_a_build_action(services):
    report = _check(_definition(
        {"id": "gst", "type": "tool", "config": {"tool_name": "apply_gst", "code_requirement": REQ}}))
    item = _by_id(report)["activity.gst"]
    assert not report["ready"] and item["blocking"]
    assert item["action"] == {"type": "rebuild", "step_id": "gst", "label": "Build it now"}
    assert "specification" in item["instructions"][0]


def test_pending_activity_needs_approval(services):
    services["versions"]["apply_gst"] = [{"id": 9, "version_no": 1, "status": "pending_approval",
                                          "review_required": True}]
    item = _by_id(_check(_definition(
        {"id": "gst", "type": "tool", "config": {"tool_name": "apply_gst"}})))["activity.gst"]
    assert item["status"] == "unmet" and item["action"]["type"] == "approve"
    assert item["action"]["tool_id"] == 9 and "review" in item["detail"]


def test_missing_secret_blocks_with_configuration_steps(services):
    services["versions"]["apply_gst"] = [{"id": 4, "version_no": 1, "status": "approved",
                                          "is_active": True}]
    item = _by_id(_check(_definition(
        {"id": "gst", "type": "tool",
         "config": {"tool_name": "apply_gst", "code_requirement": REQ}})))["secret.gst.GST_API_KEY"]
    assert item["blocking"] and "SECRETS_ALLOWLIST" in item["instructions"][0]


def test_tool_service_down_blocks_and_skips_activity_checks(services):
    services["up"] = False
    report = _check(_definition({"id": "gst", "type": "tool", "config": {"tool_name": "apply_gst"}}))
    ids = _by_id(report)
    assert ids["service.tools"]["blocking"] and "activity.gst" not in ids


def test_deleted_agent_blocks(services):
    item = _by_id(_check(_definition(
        {"id": "letter", "type": "agent", "config": {"agent_id": "gone"}})))["agent.letter"]
    assert item["blocking"] and "no longer exists" in item["detail"]


def test_agent_connector_and_empty_library_only_warn(services):
    services["attachments"]["ag_1"] = {"connectors": [{"connector_id": "c1"}],
                                       "document_library_ids": ["lib1"]}
    services["connectors"]["c1"] = {"title": "Gmail", "is_authenticated": False, "active": True}
    services["libraries"] = [{"id": "lib1", "name": "Policies", "document_count": 0}]
    report = _check(_definition({"id": "letter", "type": "agent", "config": {"agent_id": "ag_1"}}),
                    _client(ag_1="Letter writer"))
    ids = _by_id(report)
    assert report["ready"]
    assert ids["agent.letter.connector.c1"]["status"] == "warning"
    assert ids["agent.letter.library.lib1"]["action"]["to"] == "/libraries/lib1"


def test_unconnected_connector_step_blocks_with_a_connect_link(services):
    services["connectors"]["c1"] = {"title": "Gmail", "is_authenticated": False,
                                    "auth_type": "oauth2", "active": True}
    item = _by_id(_check(_definition(
        {"id": "send", "type": "connector",
         "config": {"connector_id": "c1", "tool_name": "send_email"}})))["connector.send"]
    assert item["blocking"] and item["action"] == {"type": "link", "to": "/connectors/c1",
                                                   "label": "Connect"}


def test_unregistered_workflow_is_a_warning(services):
    report = _check(_definition({"id": "letter", "type": "agent", "config": {"agent_id": "ag_1"}},
                                deployed=False), _client(ag_1="x"))
    assert report["ready"] and _by_id(report)["deploy.registered"]["status"] == "warning"


def test_run_is_refused_while_prerequisites_are_unmet(services, monkeypatch):
    from app.routes import workflows as routes

    monkeypatch.setattr(routes, "get_mistral_client", lambda: _client())
    definition = _definition({"id": "letter", "type": "agent", "config": {"agent_id": "gone"}})
    with pytest.raises(HTTPException) as err:
        asyncio.run(routes._require_prerequisites(definition))
    assert err.value.status_code == 409
    assert err.value.detail["prerequisites"]["blocking_count"] == 1
    assert "cannot run yet" in err.value.detail["message"]
