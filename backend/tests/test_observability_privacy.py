"""Credentials never reach Mistral observability, and the Logs page never shows
sign-in traces. No Mistral calls."""

import asyncio
import json
from types import SimpleNamespace

from app.observability import tracing
from app.observability.http import ActionTracingMiddleware, is_private_path
from app.routes import observability as obs_routes

from tests.test_auth import _new_active_user, auth_db  # noqa: F401 — fixture


# ── Scrubbing ───────────────────────────────────────────────────────────────

def test_scrub_masks_secret_fields_at_any_depth():
    out = tracing.scrub({
        "email": "dev@example.com",
        "password": "hunter2",
        "new_password": "n",
        "accessToken": "t",
        "api_key": "k",
        "nested": [{"client_secret": "s", "max_tokens": 5, "session_id": "abc"}],
        "token": None,
    })
    assert out["email"] == "dev@example.com"
    for key in ("password", "new_password", "accessToken", "api_key"):
        assert out[key] == tracing.REDACTED
    assert out["nested"][0] == {"client_secret": tracing.REDACTED, "max_tokens": 5, "session_id": "abc"}
    assert out["token"] is None


def test_private_paths():
    assert is_private_path("/api/auth/login")
    assert is_private_path("/api/auth/links/abc123")
    assert is_private_path("/api/admin/auth/login")
    assert is_private_path("/api/admin/users")
    assert not is_private_path("/api/agents")
    assert not is_private_path("/api/authoring")


# ── Middleware ──────────────────────────────────────────────────────────────

def _call(path: str, monkeypatch) -> dict:
    """Run one POST through the middleware; report what the app saw."""
    seen: dict = {}
    monkeypatch.setattr(tracing, "enabled", lambda: True)

    async def app(scope, receive, send):
        seen["private"] = tracing.is_private()
        await receive()
        await send({"type": "http.response.start", "status": 200, "headers": []})
        await send({"type": "http.response.body", "body": b"{}"})

    body = json.dumps({"email": "dev@example.com", "password": "hunter2"}).encode()

    async def receive():
        return {"type": "http.request", "body": body, "more_body": False}

    async def send(message):
        pass

    scope = {"type": "http", "method": "POST", "path": path, "query_string": b"",
             "headers": [(b"content-type", b"application/json")]}
    asyncio.run(ActionTracingMiddleware(app)(scope, receive, send))
    return seen


def test_sign_in_requests_run_private(monkeypatch):
    assert _call("/api/auth/login", monkeypatch)["private"] is True
    assert _call("/api/admin/auth/login", monkeypatch)["private"] is True
    assert _call("/api/agents", monkeypatch)["private"] is False
    assert tracing.is_private() is False


def test_private_context_opens_no_app_span():
    with tracing.private():
        with tracing._span("x", kind="step") as s:
            assert not s.is_recording()


def test_exporter_drops_private_spans(monkeypatch):
    from opentelemetry.sdk.trace.export import SpanExportResult

    sent: list = []

    class Fake:
        def export(self, batch):
            sent.extend(batch)
            return SpanExportResult.SUCCESS

    exporter = tracing._WorkspaceRoutingExporter()
    monkeypatch.setattr(exporter, "_for_key", lambda key: Fake())
    monkeypatch.setattr(exporter, "_key_of", lambda ws: "key")
    public = SimpleNamespace(attributes={"app.kind": "http"})
    private = SimpleNamespace(attributes={tracing.PRIVATE_ATTRIBUTE: True})
    exporter.export([public, private])
    assert sent == [public]


def test_tagger_marks_spans_started_in_private():
    marked: dict = {}
    span = SimpleNamespace(set_attribute=lambda k, v: marked.__setitem__(k, v))
    with tracing.private():
        tracing._WorkspaceTagger().on_start(span)
    assert marked == {tracing.PRIVATE_ATTRIBUTE: True}


# ── Logs page ───────────────────────────────────────────────────────────────

def test_logs_page_hides_sign_in_traces():
    assert obs_routes._private_name("POST /api/auth/login")
    assert obs_routes._private_name("POST /api/admin/auth/login")
    assert not obs_routes._private_name("POST /api/agents")
    assert obs_routes._private_span({"name": "POST /x", "attributes": {"url.path": "/api/auth/login"}})


def test_logs_page_masks_old_request_bodies():
    attrs = obs_routes._scrub_attrs({
        "app.request.body": json.dumps({"email": "a@b.c", "password": "hunter2"}),
        "url.path": "/api/agents",
    })
    body = json.loads(attrs["app.request.body"])
    assert body == {"email": "a@b.c", "password": tracing.REDACTED}


# ── Admin audit log ─────────────────────────────────────────────────────────

def test_audit_auth_category(auth_db):  # noqa: F811
    from app.auth import store

    _new_active_user()
    store.login("user", "dev@example.com", "correct horse battery", ip="1.2.3.4")
    try:
        store.login("user", "dev@example.com", "wrong password!!", ip="1.2.3.4")
    except store.AuthError:
        pass
    events = store.audit_log(action="auth")["events"]
    actions = {e["action"] for e in events}
    assert "user.login" in actions
    assert "user.invite_accept" in actions
    assert not any(a.startswith(("workspace.", "role.")) for a in actions)
    dumped = json.dumps(events)
    assert "correct horse battery" not in dumped
    assert "wrong password!!" not in dumped


# ── Admin: audit event detail ───────────────────────────────────────────────

def test_audit_event_detail(auth_db):  # noqa: F811
    from app.auth import store

    u, ws = _new_active_user()
    store.login("user", "dev@example.com", "correct horse battery", ip="1.2.3.4")
    login = store.audit_log(action="user.login")["events"][0]

    detail = store.audit_event(login["id"])
    assert detail["action"] == "user.login" and detail["ip"] == "1.2.3.4"
    assert detail["actor"]["email"] == "dev@example.com" and detail["actor"]["exists"]
    assert detail["workspace"]["id"] == ws["id"]
    assert any(e["action"] == "user.invite_accept" for e in detail["by_actor"])
    assert all(e["id"] != login["id"] for e in detail["by_actor"])
    assert detail["older_id"] is not None and detail["newer_id"] is None

    import pytest

    with pytest.raises(store.AuthError):
        store.audit_event(10_000_000)


# ── Admin: activity logs ────────────────────────────────────────────────────

def test_search_actions_keeps_root_spans_only(monkeypatch):
    def raw(span_id, parent, name, actor):
        return SimpleNamespace(
            trace_id="t" + span_id, span_id=span_id, parent_span_id=parent, span_name=name,
            span_kind="SERVER", start_time=None, end_time=None, duration_ns=1_000_000,
            status_code="Unset", status_message=None, error_type=None, service_name="svc",
            operation_name=None, response_model=None, request_model=None, provider_name=None,
            agent_id=None, agent_name=None, conversation_id=None, workflow_name=None,
            tool_name=None, tool_call_arguments=None, tool_call_result=None,
            input_messages=None, output_messages=None, system_instructions=None,
            usage_input_tokens=0, usage_output_tokens=0, usage_cache_read_input_tokens=0,
            response_finish_reasons=[], request_temperature=None, scope_name=None,
            resource_attributes={},
            span_attributes={"app.kind": "http", "enduser.id": actor,
                             "http.response.status_code": "201"},
        )

    seen = {}

    class Spans:
        async def search_spans_async(self, **kw):
            seen.update(kw)
            feed = SimpleNamespace(results=[raw("a", "", "POST /api/agents", "user:u1"),
                                            raw("b", "a", "child", "user:u1")],
                                   next=None, cursor=None)
            return SimpleNamespace(spans=feed)

    monkeypatch.setattr(obs_routes, "_api", lambda: SimpleNamespace(spans=Spans()))
    out = asyncio.run(obs_routes.search_actions(actor_ref="user:u1"))
    assert [r["span_id"] for r in out["items"]] == ["a"]
    assert out["items"][0]["actor_ref"] == "user:u1"
    assert out["items"][0]["http_status"] == 201
    assert "span_attributes['enduser.id'] = 'user:u1'" in seen["search_expression"]


def test_activity_logs_merges_workspaces_and_names_people(auth_db, monkeypatch):  # noqa: F811
    from app.auth import store
    from app.auth.context import current_workspace_id
    from app.routes import admin as admin_routes

    u, ws = _new_active_user()
    monkeypatch.setattr(tracing, "enabled", lambda: True)
    calls = []

    async def fake_search(**kw):
        wid = current_workspace_id()
        calls.append((wid, kw["actor_ref"]))
        return {"items": [{
            "trace_id": f"t-{wid}", "span_id": "s", "name": "POST /api/agents", "kind": "http",
            "start_time": "2026-11-14T10:00:00Z" if wid == ws["id"] else "2026-11-14T09:00:00Z",
            "duration_ms": 5, "status_code": "Unset", "status_message": None,
            "http_status": 200, "actor_ref": f"user:{u['id']}", "workspace_id": None,
            "workflow_name": None, "execution_id": None, "console_url": "",
        }], "cursor": "next" if wid == ws["id"] else None}

    monkeypatch.setattr(obs_routes, "search_actions", fake_search)
    out = asyncio.run(admin_routes.activity_logs(
        workspace_id=None, user_id=u["id"], kind=None, status=None, q=None, hours=24,
        page_size=50, cursor=None))

    readable = [w["id"] for w in store.list_workspaces() if store.workspace_key(w["id"])]
    assert sorted(c[0] for c in calls) == sorted(readable)
    assert all(c[1] == f"user:{u['id']}" for c in calls)
    assert out["items"][0]["workspace_id"] == ws["id"]  # newest first
    assert out["items"][0]["actor"]["email"] == "dev@example.com"
    assert out["has_more"] and admin_routes._decode_cursor(out["cursor"]) == {ws["id"]: "next"}

    # The next page reads only the workspaces that have more.
    calls.clear()
    asyncio.run(admin_routes.activity_logs(
        workspace_id=None, user_id=None, kind=None, status="error", q=None, hours=24,
        page_size=50, cursor=out["cursor"]))
    assert [c[0] for c in calls] == [ws["id"]]
