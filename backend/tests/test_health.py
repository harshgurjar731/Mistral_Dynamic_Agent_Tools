"""System status (users) and system health (admins). No network calls."""

import pytest

from app import health
from app.health import Check


@pytest.fixture(autouse=True)
def _fresh():
    health.clear_cache()
    yield
    health.clear_cache()


@pytest.fixture
def services(monkeypatch):
    """Every dependency healthy; tests flip the ones they care about."""
    state = {"tools": True, "mistral": "ok", "graph": True}

    async def tool_service():
        if state["tools"]:
            return Check("tool_service", "Tool service", "ok", "major", "ok")
        return Check("tool_service", "Tool service", "down", "major", "The tool service isn't "
                     "responding.", impact="Tools fail.", details={"url": "http://x:9000"})

    async def mistral(key, label="your workspace"):
        if state["mistral"] == "ok":
            return Check("mistral", "Mistral AI", "ok", "critical", "Connected.", latency_ms=80)
        return Check("mistral", "Mistral AI", "down", "critical", "Mistral rejected the key.",
                     impact="AI unavailable.", details={"http_status": 401})

    def graph():
        if state["graph"]:
            return Check("knowledge_graph", "Knowledge graph", "ok", "minor", "Available.")
        return Check("knowledge_graph", "Knowledge graph", "off", "minor", "Offline.",
                     impact="Graph search is off.", details={"reason": "bolt refused"})

    monkeypatch.setattr(health, "_tool_service", tool_service)
    monkeypatch.setattr(health, "_mistral", mistral)
    monkeypatch.setattr(health, "_knowledge_graph", graph)
    monkeypatch.setattr(health, "_worker", lambda ws: None)
    return state


def _client():
    import app.main
    from fastapi.testclient import TestClient

    return TestClient(app.main.app)


def test_all_good_is_operational(services):
    body = _client().get("/api/status").json()
    assert body["status"] == "operational"
    assert body["headline"] == "All systems operational"
    assert body["issues"] == []


def test_users_see_issues_in_plain_language_without_internals(services):
    services["tools"] = False
    body = _client().get("/api/status").json()
    assert body["status"] == "degraded"
    [issue] = body["issues"]
    assert issue["name"] == "Tools" and issue["impact"]
    for c in body["components"]:
        assert set(c) == {"key", "name", "state", "message", "impact"}   # no details, latency


def test_mistral_down_is_an_outage(services):
    services["mistral"] = "bad"
    body = _client().get("/api/status").json()
    assert body["status"] == "outage"
    assert body["issues"][0]["name"] == "AI models (Mistral)"


def test_optional_graph_is_a_notice_not_degradation(services):
    services["graph"] = False
    body = _client().get("/api/status").json()
    assert body["status"] == "operational"
    assert [i["key"] for i in body["issues"]] == ["knowledge_graph"]


def test_admin_health_has_details_and_workspaces(services, monkeypatch):
    from app.auth import store, workers

    monkeypatch.setattr(store, "list_workspaces", lambda: [{
        "id": "ws1", "name": "Lending", "disabled": False, "is_default": True, "members": 3,
        "key_status": "invalid", "key_checked_at": None, "key_error": "rejected"}])
    monkeypatch.setattr(workers, "read_status", lambda: {"enabled": False, "workers": {},
                                                         "updated_at": None})
    monkeypatch.setattr(workers, "files_by_workspace", lambda: {})
    body = _client().get("/api/admin/health").json()
    keys = {c["key"]: c for c in body["components"]}
    assert {"api", "database", "mistral", "tool_service", "vault", "workspace_keys"} <= set(keys)
    assert keys["api"]["details"]["version"]
    assert keys["workspace_keys"]["state"] == "degraded"
    assert body["status"] == "degraded"
    assert body["workspaces"][0]["name"] == "Lending"


def test_verdict_rules():
    ok = Check("a", "A", "ok", "critical", "")
    assert health._verdict([ok]) == "operational"
    assert health._verdict([ok, Check("b", "B", "down", "minor", "")]) == "operational"
    assert health._verdict([ok, Check("b", "B", "down", "major", "")]) == "degraded"
    assert health._verdict([ok, Check("b", "B", "degraded", "critical", "")]) == "degraded"
    assert health._verdict([ok, Check("b", "B", "down", "critical", "")]) == "outage"
