"""Delete rules: refusals, detaching, and graph cleanup — no Mistral, no tool service."""

import asyncio
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

from app.services import delete_rules


def _wf(name, steps, archived=False):
    return SimpleNamespace(
        name=name, archived=archived,
        steps=[SimpleNamespace(id=sid, config=cfg) for sid, cfg in steps],
    )


@pytest.fixture
def workflows(monkeypatch):
    import app.services.workflow_engine.engine as engine

    items = []
    monkeypatch.setattr(engine, "list_workflows", lambda: items)
    return items


@pytest.fixture
def agents(monkeypatch):
    items = []
    monkeypatch.setattr(delete_rules, "_all_agents_raw", lambda *a, **k: items)
    return items


@pytest.fixture
def graph(monkeypatch):
    calls = []
    monkeypatch.setattr(delete_rules, "forget_in_graph",
                        lambda t, i: calls.append((t, i)) or {"annotations_removed": 1})
    return calls


def _agent(agent_id, tools=(), libraries=()):
    spec = [{"type": "function", "function": {"name": t}} for t in tools]
    if libraries:
        spec.append({"type": "document_library", "library_ids": list(libraries)})
    return {"id": agent_id, "name": f"Agent {agent_id}", "tools": spec}


# ── helpers ────────────────────────────────────────────────────────────────


def test_workflow_usage_includes_archived(workflows):
    workflows += [
        _wf("claims", [("gst", {"tool_name": "apply_gst"}), ("letter", {"agent_id": "a1"})]),
        _wf("old", [("x", {"tool_name": "apply_gst"})], archived=True),
        _wf("other", [("y", {"tool_name": "something_else"})]),
    ]
    users = delete_rules.workflows_using_tool("apply_gst")
    assert [u["name"] for u in users] == ["claims", "old"]
    assert users[1]["archived"] is True and users[0]["steps"] == ["gst"]


def test_activity_in_use_is_refused(workflows):
    workflows.append(_wf("claims", [("gst", {"tool_name": "apply_gst"})]))
    with pytest.raises(delete_rules.InUse) as e:
        delete_rules.check_tool_deletable("apply_gst", "activity")
    assert "activity 'apply_gst'" in str(e.value) and "claims" in str(e.value)
    delete_rules.check_tool_deletable("unused_activity", "activity")  # no raise


def test_library_attached_to_agent_is_refused(agents):
    agents += [_agent("a1", libraries=["lib-1"]), _agent("a2")]
    with pytest.raises(delete_rules.InUse) as e:
        delete_rules.check_library_deletable("lib-1", "Policies")
    assert "Agent a1" in str(e.value) and "Agent a2" not in str(e.value)
    delete_rules.check_library_deletable("lib-2")


def test_detach_keeps_the_agents_other_attachments(agents, monkeypatch):
    from app.services import agent_service

    agents += [_agent("a1", tools=["word_count", "calculate"]), _agent("a2", tools=["calculate"])]
    monkeypatch.setattr(agent_service, "current_attachments", lambda agent_id: {
        "tools": ["word_count", "calculate", "document_library"],
        "document_library_ids": ["lib-1"], "connectors": [],
    })
    updates = []

    async def fake_update(client, agent_id, data, skip_rules=False):
        updates.append((agent_id, data, skip_rules))
        return {"id": agent_id}

    monkeypatch.setattr(agent_service, "update_agent", fake_update)
    detached = asyncio.run(delete_rules.detach_tool_from_agents(object(), "word_count"))
    assert [a["id"] for a in detached] == ["a1"]
    # Only the one tool is dropped; the library key rides along untouched.
    assert updates == [("a1", {"tools": ["calculate", "document_library"]}, True)]


# ── routes ────────────────────────────────────────────────────────────────


@pytest.fixture
def client(monkeypatch):
    from app.dependencies import get_mistral_client
    from app.main import app

    app.dependency_overrides[get_mistral_client] = lambda: object()
    try:
        yield TestClient(app)
    finally:
        app.dependency_overrides.pop(get_mistral_client, None)


@pytest.fixture
def tool_service(monkeypatch):
    from app.services import tool_registry
    from app.services.tool_resolver import tool_resolver

    state = {"record": None, "deleted": []}

    async def get_tool(tool_id):
        return state["record"]

    async def delete_tool(tool_id):
        state["deleted"].append(tool_id)
        return {"status": "deleted", "tool_name": state["record"]["name"]}

    async def no_refresh():
        return None

    monkeypatch.setattr(tool_resolver, "get_tool", get_tool)
    monkeypatch.setattr(tool_resolver, "delete_tool", delete_tool)
    monkeypatch.setattr(tool_registry, "refresh_dynamic_tools", no_refresh)
    return state


def test_activity_used_by_workflow_is_not_deleted(client, tool_service, workflows, graph):
    tool_service["record"] = {"id": 7, "name": "apply_gst", "purpose": "activity", "status": "approved"}
    workflows.append(_wf("claims", [("gst", {"tool_name": "apply_gst"})]))
    resp = client.delete("/api/tools/7")
    assert resp.status_code == 409 and "claims" in resp.json()["detail"]
    assert tool_service["deleted"] == [] and graph == []


def test_tool_is_detached_from_agents_then_deleted(client, tool_service, workflows, graph, monkeypatch):
    tool_service["record"] = {"id": 3, "name": "word_count", "purpose": "tool", "status": "approved"}
    detached_calls = []

    async def fake_detach(c, name):
        detached_calls.append(name)
        return [{"id": "a1", "name": "Helper"}]

    monkeypatch.setattr(delete_rules, "detach_tool_from_agents", fake_detach)
    resp = client.delete("/api/tools/3")
    body = resp.json()
    assert resp.status_code == 200 and body["detached_from"] == ["Helper"]
    assert detached_calls == ["word_count"] and tool_service["deleted"] == [3]
    assert graph == [("tool", "word_count")]


def test_pending_version_is_deleted_without_checks(client, tool_service, workflows, graph, monkeypatch):
    tool_service["record"] = {"id": 9, "name": "apply_gst", "purpose": "activity",
                              "status": "pending_approval"}
    workflows.append(_wf("claims", [("gst", {"tool_name": "apply_gst"})]))
    resp = client.delete("/api/tools/9")
    assert resp.status_code == 200 and tool_service["deleted"] == [9]
    assert graph == [], "one pending version going does not remove the tool from the graph"


def test_library_attached_to_an_agent_cannot_be_deleted(client, agents, monkeypatch):
    from app.services import library_service

    agents.append(_agent("a1", libraries=["lib-1"]))
    called = []

    async def fake_delete(library_id):
        called.append(library_id)
        return {"deleted": True}

    monkeypatch.setattr(library_service, "delete_library", fake_delete)
    resp = client.delete("/api/libraries/lib-1")
    assert resp.status_code == 409 and "Agent a1" in resp.json()["detail"]
    assert called == []


def test_unattached_library_is_deleted_and_leaves_the_graph(client, agents, graph, monkeypatch):
    from app.services import library_service

    async def fake_delete(library_id):
        return {"deleted": True, "library_id": library_id}

    monkeypatch.setattr(library_service, "delete_library", fake_delete)
    resp = client.delete("/api/libraries/lib-9")
    assert resp.status_code == 200 and graph == [("library", "lib-9")]


def test_agent_delete_removes_only_the_agent(client, graph, monkeypatch):
    from app.services import agent_service

    async def fake_delete(c, agent_id):
        return {"deleted": True, "agent_id": agent_id}

    monkeypatch.setattr(agent_service, "delete_agent", fake_delete)
    resp = client.delete("/api/agents/ag_1")
    assert resp.status_code == 200 and graph == [("agent", "ag_1")]


def test_library_document_delete_removes_its_graph_slice(client, monkeypatch):
    from app.rag import graph_store, store as rag_store
    from app.services import library_service

    async def fake_delete(library_id, document_id):
        return {"deleted": True}

    removed_rows, graph_calls = [], []
    monkeypatch.setattr(library_service, "delete_document", fake_delete)
    monkeypatch.setattr(graph_store, "delete_document_graph",
                        lambda doc, lib: graph_calls.append((doc, lib)) or {"deleted": True})
    monkeypatch.setattr(rag_store, "list_documents", lambda library_id: [
        {"id": 5, "mistral_doc_id": "doc-1"}, {"id": 6, "mistral_doc_id": "doc-2"}])
    monkeypatch.setattr(rag_store, "delete_document", lambda i: removed_rows.append(i))
    resp = client.delete("/api/libraries/lib-1/documents/doc-1")
    assert resp.status_code == 200
    assert graph_calls == [("doc-1", "lib-1")] and removed_rows == [5]
