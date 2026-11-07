"""Accounts, sessions, workspaces, roles and RBAC (app.auth). No Mistral calls."""

import os
import tempfile

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.auth import mistral_keys, passwords, permissions, store
from app.auth.context import Principal, use_workspace
from app.auth.mistral_keys import KeyCheck
from app.auth.store import AuthError

KEY_A = "a" * 20 + "AAAA"
KEY_B = "b" * 20 + "BBBB"


# ── Fixtures ────────────────────────────────────────────────────────────────

@pytest.fixture
def auth_db(monkeypatch):
    """A fresh database for the auth store, with keys that Mistral "accepts"."""
    import app.auth.models  # noqa: F401
    from app.database import Base

    path = os.path.join(tempfile.mkdtemp(prefix="auth_"), "auth.db")
    engine = create_engine(f"sqlite:///{path}", connect_args={"check_same_thread": False})
    Base.metadata.create_all(engine)
    Session = sessionmaker(bind=engine)
    monkeypatch.setattr(store, "SessionLocal", Session)
    monkeypatch.setattr(mistral_keys, "verify",
                        lambda key: KeyCheck(True, "valid", "ok", 3) if key.strip() in (KEY_A, KEY_B)
                        else KeyCheck(False, "invalid", "Mistral rejected this key."))
    monkeypatch.setattr(mistral_keys, "same_workspace", lambda old, new: None)
    from app.config import settings

    monkeypatch.setattr(settings, "MISTRAL_API_KEY", "platform-key-" + "x" * 20)
    store.reset_rate_limits()
    store._key_cache.clear()
    store.ensure_system_roles()
    yield Session
    store._key_cache.clear()


def _role(key):
    return next(r for r in store.list_roles() if r["system_key"] == key)


def _admin_principal(admin_id="adm", email="root@example.com"):
    return Principal(kind="admin", id=admin_id, email=email, name="Root", session_id="s")


def _new_active_user(email="dev@example.com", name="Dee Veloper", role="builder", ws=None):
    ws = ws or store.create_workspace(name=f"WS {email}", api_key=KEY_A if "dev" in email else KEY_B)
    u = store.create_user(email=email, name=name,
                          memberships=[{"workspace_id": ws["id"], "role_id": _role(role)["id"]}])
    store.accept_link(u["link"]["token"], password="correct horse battery")
    return u, ws


# ── Policy ──────────────────────────────────────────────────────────────────

def test_every_api_route_has_an_access_rule():
    """Deny by default: a new endpoint without a rule would answer 403, so
    every route the app serves must be matched by a rule."""
    import app.main
    from app.config import settings

    missing = []
    for route in app.main.app.routes:
        path = getattr(route, "path", "")
        if not path.startswith(settings.API_PREFIX + "/"):
            continue
        sample = path[len(settings.API_PREFIX):].replace("{", "").replace("}", "")
        sample = "/".join(seg if seg else seg for seg in sample.split("/"))
        for method in getattr(route, "methods", set()) - {"HEAD", "OPTIONS"}:
            if permissions.match(method, sample) is None:
                missing.append(f"{method} {path}")
    assert not missing, "Routes without an access rule:\n" + "\n".join(sorted(missing))


def test_rules_name_only_known_permissions():
    for rule in permissions.RULES:
        for p in rule.perms:
            assert p in permissions.PERMISSION_KEYS, p


@pytest.mark.parametrize("method,path,expected", [
    ("GET", "/workflows", ("workflows.view",)),
    ("POST", "/workflows/loan/execute", ("workflows.run",)),
    ("POST", "/workflows/loan/publish", ("workflows.deploy",)),
    ("PUT", "/workflows/loan", ("workflows.manage",)),
    ("POST", "/workflows/executions/abc/cancel", ("workflows.run",)),
    ("POST", "/vault/secrets/X/reveal", ("vault.reveal",)),
    ("POST", "/reviews/12/decision", ("reviews.decide",)),
])
def test_policy_examples(method, path, expected):
    rule = permissions.match(method, path)
    assert rule is not None and rule.perms == expected


@pytest.mark.parametrize("method,path", [
    ("PUT", "/settings"), ("POST", "/settings/cleanup"), ("POST", "/vault/rotate-key"),
    ("GET", "/admin/users"),
])
def test_platform_administration_is_admin_only(method, path):
    assert permissions.match(method, path).access == permissions.ADMIN


def test_system_roles_are_ordered_by_power():
    roles = {r.key: r.permissions for r in permissions.SYSTEM_ROLES}
    assert roles["viewer"] <= roles["reviewer"] <= roles["maintainer"]
    assert roles["viewer"] <= roles["operator"] <= roles["builder"] <= roles["maintainer"]
    assert "vault.reveal" not in roles["builder"]
    assert "workflows.deploy" not in roles["builder"]


# ── Passwords ───────────────────────────────────────────────────────────────

def test_password_hash_roundtrip_and_policy():
    h = passwords.hash_password("correct horse battery")
    assert h.startswith("$argon2id$")
    assert passwords.verify_password(h, "correct horse battery")
    assert not passwords.verify_password(h, "wrong horse battery")
    assert not passwords.verify_password(None, "anything")
    for bad in ("short", "password123", "aaaaaaaaaaaa"):
        with pytest.raises(passwords.PasswordPolicyError):
            passwords.check_policy(bad)
    with pytest.raises(passwords.PasswordPolicyError):
        passwords.check_policy("jane.doe-rocks!", email="jane.doe@example.com")
    with pytest.raises(passwords.PasswordPolicyError):
        passwords.check_policy("tenletters", admin=True)  # admins need 12


# ── Workspaces ──────────────────────────────────────────────────────────────

def test_workspace_needs_a_working_unique_key(auth_db):
    with pytest.raises(AuthError) as e:
        store.create_workspace(name="Bad", api_key="z" * 24)
    assert e.value.code == "key_invalid"
    ws = store.create_workspace(name="Lending", api_key=KEY_A)
    assert ws["key_status"] == "valid" and ws["key_hint"] == "••••AAAA"
    assert "api_key" not in ws and "key_ciphertext" not in ws
    with pytest.raises(AuthError) as e:
        store.create_workspace(name="Lending 2", api_key=KEY_A)
    assert e.value.code == "duplicate_key"
    with pytest.raises(AuthError) as e:
        store.create_workspace(name="lending", api_key=KEY_B)
    assert e.value.code == "duplicate"
    assert store.workspace_key(ws["id"]) == KEY_A


def test_default_workspace_uses_platform_key_and_is_protected(auth_db):
    from app.config import settings

    ws_id = store.ensure_default_workspace()
    assert store.ensure_default_workspace() == ws_id
    assert store.workspace_key(ws_id) == settings.MISTRAL_API_KEY
    with pytest.raises(AuthError):
        store.update_workspace(ws_id, disabled=True)
    with pytest.raises(AuthError):
        store.delete_workspace(ws_id)
    with pytest.raises(AuthError):
        store.rotate_key(ws_id, api_key=KEY_B)


def test_rotate_key_refuses_another_mistral_workspace_unless_confirmed(auth_db, monkeypatch):
    ws = store.create_workspace(name="Ops", api_key=KEY_A)
    monkeypatch.setattr(mistral_keys, "same_workspace", lambda old, new: False)
    with pytest.raises(AuthError) as e:
        store.rotate_key(ws["id"], api_key=KEY_B)
    assert e.value.code == "other_workspace"
    out = store.rotate_key(ws["id"], api_key=KEY_B, allow_other_workspace=True)
    assert out["key_hint"] == "••••BBBB"
    assert store.workspace_key(ws["id"]) == KEY_B


def test_disabled_workspace_has_no_key(auth_db):
    ws = store.create_workspace(name="Ops", api_key=KEY_A)
    store.update_workspace(ws["id"], disabled=True)
    assert store.workspace_key(ws["id"]) is None


def test_workspace_with_members_is_not_deleted(auth_db):
    u, ws = _new_active_user()
    with pytest.raises(AuthError) as e:
        store.delete_workspace(ws["id"])
    assert e.value.code == "in_use"


# ── Users, invites and sign-in ──────────────────────────────────────────────

def test_user_needs_a_workspace(auth_db):
    with pytest.raises(AuthError) as e:
        store.create_user(email="x@example.com", name="X", memberships=[])
    assert e.value.code == "memberships"


def test_invite_then_login_then_logout(auth_db):
    ws = store.create_workspace(name="Lending", api_key=KEY_A)
    u = store.create_user(email="Ann@Example.com", name="Ann Smith",
                          memberships=[{"workspace_id": ws["id"], "role_id": _role("operator")["id"]}])
    assert u["status"] == "invited" and u["email"] == "ann@example.com"
    token = u["link"]["token"]
    info = store.link_info(token)
    assert info["kind"] == "invite" and info["workspaces"][0]["name"] == "Lending"
    with pytest.raises(AuthError):
        store.login("user", "ann@example.com", "anything at all")      # not set up yet
    result = store.accept_link(token, password="correct horse battery")
    with pytest.raises(AuthError) as e:
        store.accept_link(token, password="correct horse battery")     # one use only
    assert e.value.code == "link_invalid"

    p = store.resolve_session("user", result["token"])
    assert p.workspace_id == ws["id"] and p.role_name == "Operator"
    assert p.can("workflows.run") and not p.can("workflows.manage")

    s = store.login("user", "ANN@example.com", "correct horse battery")
    assert store.resolve_session("user", s["token"]) is not None
    assert store.resolve_session("admin", s["token"]) is None           # kinds never mix
    store.logout(s["token"])
    assert store.resolve_session("user", s["token"]) is None


def test_wrong_password_locks_the_account(auth_db, monkeypatch):
    _new_active_user()
    for _ in range(4):
        with pytest.raises(AuthError) as e:
            store.login("user", "dev@example.com", "not the password!")
        assert e.value.code == "credentials"
    with pytest.raises(AuthError):
        store.login("user", "dev@example.com", "not the password!")
    with pytest.raises(AuthError) as e:
        store.login("user", "dev@example.com", "correct horse battery")
    assert e.value.code == "locked"
    uid = store.list_users()[0]["id"]
    store.unlock_user(uid)
    assert store.login("user", "dev@example.com", "correct horse battery")["token"]


def test_unknown_email_and_wrong_password_look_the_same(auth_db):
    _new_active_user()
    with pytest.raises(AuthError) as a:
        store.login("user", "nobody@example.com", "whatever whatever")
    with pytest.raises(AuthError) as b:
        store.login("user", "dev@example.com", "whatever whatever")
    assert (a.value.status, a.value.message) == (b.value.status, b.value.message)


def test_ip_rate_limit(auth_db, monkeypatch):
    monkeypatch.setenv("AUTH_IP_ATTEMPTS", "5")
    for _ in range(5):
        with pytest.raises(AuthError):
            store.login("user", "nobody@example.com", "x" * 12, ip="10.0.0.1")
    with pytest.raises(AuthError) as e:
        store.login("user", "nobody@example.com", "x" * 12, ip="10.0.0.1")
    assert e.value.code == "rate_limited"


def test_multiple_workspaces_and_switching(auth_db):
    u, ws_a = _new_active_user()
    ws_b = store.create_workspace(name="Second", api_key=KEY_B)
    store.set_memberships(u["id"], [
        {"workspace_id": ws_a["id"], "role_id": _role("builder")["id"]},
        {"workspace_id": ws_b["id"], "role_id": _role("viewer")["id"]},
    ])
    token = store.login("user", "dev@example.com", "correct horse battery")["token"]
    p = store.resolve_session("user", token)
    assert p.workspace_id == ws_a["id"] and p.can("workflows.manage")
    store.switch_workspace(p, ws_b["id"])
    p = store.resolve_session("user", token)
    assert p.workspace_id == ws_b["id"] and not p.can("workflows.manage")
    assert len(store.my_workspaces(p)) == 2

    # Removed from the active workspace: the session moves to one still held.
    store.set_memberships(u["id"], [{"workspace_id": ws_a["id"], "role_id": _role("builder")["id"]}])
    p = store.resolve_session("user", token)
    assert p.workspace_id == ws_a["id"]
    with pytest.raises(AuthError):
        store.switch_workspace(p, ws_b["id"])


def test_disabled_workspace_moves_or_ends_the_session(auth_db):
    u, ws = _new_active_user()
    token = store.login("user", "dev@example.com", "correct horse battery")["token"]
    store.update_workspace(ws["id"], disabled=True)
    assert store.resolve_session("user", token) is None
    with pytest.raises(AuthError) as e:
        store.login("user", "dev@example.com", "correct horse battery")
    assert e.value.code == "no_workspace"


def test_disable_and_delete_user_end_their_sessions(auth_db):
    u, ws = _new_active_user()
    token = store.login("user", "dev@example.com", "correct horse battery")["token"]
    store.set_user_status(u["id"], disabled=True)
    assert store.resolve_session("user", token) is None
    with pytest.raises(AuthError) as e:
        store.login("user", "dev@example.com", "correct horse battery")
    assert e.value.code == "disabled"
    store.set_user_status(u["id"], disabled=False)
    token = store.login("user", "dev@example.com", "correct horse battery")["token"]
    out = store.delete_user(u["id"])
    assert out["mode"] == "anonymised"
    assert store.resolve_session("user", token) is None
    assert store.list_users() == []
    # The email is free again.
    store.create_user(email="dev@example.com", name="New Dev",
                      memberships=[{"workspace_id": ws["id"], "role_id": _role("viewer")["id"]}])


def test_never_signed_in_user_is_removed_outright(auth_db):
    ws = store.create_workspace(name="Lending", api_key=KEY_A)
    u = store.create_user(email="new@example.com", name="New Person",
                          memberships=[{"workspace_id": ws["id"], "role_id": _role("viewer")["id"]}])
    assert store.delete_user(u["id"])["mode"] == "removed"


def test_password_change_ends_other_sessions(auth_db):
    _new_active_user()
    t1 = store.login("user", "dev@example.com", "correct horse battery")["token"]
    t2 = store.login("user", "dev@example.com", "correct horse battery")["token"]
    p1 = store.resolve_session("user", t1)
    with pytest.raises(AuthError):
        store.change_password(p1, "wrong current pw", "another good passphrase")
    store.change_password(p1, "correct horse battery", "another good passphrase")
    assert store.resolve_session("user", t1) is not None
    assert store.resolve_session("user", t2) is None
    assert store.login("user", "dev@example.com", "another good passphrase")


def test_reset_link_sets_a_new_password(auth_db):
    u, _ = _new_active_user()
    link = store.issue_link(u["id"])
    assert link["kind"] == "reset" and link["path"].startswith("/reset-password/")
    store.accept_link(link["token"], password="brand new passphrase")
    assert store.login("user", "dev@example.com", "brand new passphrase")


# ── Roles ───────────────────────────────────────────────────────────────────

def test_custom_roles(auth_db):
    role = store.create_role(name="Release manager",
                             permissions=["workflows.view", "workflows.deploy", "bogus.perm"])
    assert role["permissions"] == ["workflows.deploy", "workflows.view"]
    with pytest.raises(AuthError):
        store.create_role(name="Empty", permissions=[])
    with pytest.raises(AuthError):
        store.update_role(_role("viewer")["id"], permissions=["workflows.view"])
    with pytest.raises(AuthError):
        store.delete_role(_role("viewer")["id"])

    u, ws = _new_active_user(role="viewer")
    store.set_memberships(u["id"], [{"workspace_id": ws["id"], "role_id": role["id"]}])
    token = store.login("user", "dev@example.com", "correct horse battery")["token"]
    assert store.resolve_session("user", token).can("workflows.deploy")

    store.update_role(role["id"], permissions=["workflows.view"])
    assert not store.resolve_session("user", token).can("workflows.deploy")

    with pytest.raises(AuthError) as e:
        store.delete_role(role["id"])
    assert e.value.code == "in_use"
    store.delete_role(role["id"], reassign_to=_role("viewer")["id"])
    assert store.resolve_session("user", token).role_name == "Viewer"


# ── Admins ──────────────────────────────────────────────────────────────────

def test_bootstrap_admin_must_change_password(auth_db, monkeypatch):
    monkeypatch.setenv("ADMIN_EMAIL", "root@example.com")
    monkeypatch.setenv("ADMIN_INITIAL_PASSWORD", "initial admin passphrase")
    assert store.ensure_bootstrap_admin()
    assert store.ensure_bootstrap_admin() is None                       # only once
    token = store.login("admin", "root@example.com", "initial admin passphrase")
    assert token["must_change_password"] is True
    p = store.resolve_session("admin", token["token"])
    assert p.must_change_password
    store.change_password(p, "initial admin passphrase", "a much better admin passphrase")
    assert not store.resolve_session("admin", token["token"]).must_change_password


def test_last_admin_and_self_are_protected(auth_db, monkeypatch):
    monkeypatch.setenv("ADMIN_EMAIL", "root@example.com")
    monkeypatch.setenv("ADMIN_INITIAL_PASSWORD", "initial admin passphrase")
    root_id = store.ensure_bootstrap_admin()
    me = _admin_principal(root_id)
    with pytest.raises(AuthError):
        store.delete_admin(root_id, actor=me)
    with pytest.raises(AuthError):
        store.update_admin(root_id, disabled=True, actor=me)
    other = store.create_admin(email="second@example.com", name="Second Admin", actor=me)
    store.accept_link(other["link"]["token"], password="another strong passphrase")
    store.update_admin(other["id"], disabled=True, actor=me)
    with pytest.raises(AuthError) as e:
        store.delete_admin(root_id, actor=_admin_principal("someone-else"))
    assert e.value.code == "last_admin"


def test_audit_records_actions(auth_db):
    store.create_workspace(name="Lending", api_key=KEY_A, actor=_admin_principal())
    events = store.audit_log(action="workspace.")["events"]
    assert events and events[0]["actor_email"] == "root@example.com"


# ── Workspace isolation ─────────────────────────────────────────────────────

@pytest.fixture
def scoped_workflows(monkeypatch):
    """The workflow engine on a temp database, with workspace scoping on."""
    from app.auth import scoping, setup
    from app.services.workflow_engine import engine as wf

    path = os.path.join(tempfile.mkdtemp(prefix="scope_"), "wf.db")
    eng = create_engine(f"sqlite:///{path}", connect_args={"check_same_thread": False})
    wf._Base.metadata.create_all(eng)
    monkeypatch.setattr(wf, "_Session", sessionmaker(bind=eng))
    setup.register_scoped_models()
    yield wf
    scoping.set_default_workspace(None)


def _definition(name):
    from app.services.workflow_engine.models import WorkflowDefinition

    return WorkflowDefinition(name=name, description="d", entry_step="start", steps=[])


def test_rows_are_invisible_across_workspaces(scoped_workflows, monkeypatch):
    wf = scoped_workflows
    monkeypatch.setattr(wf, "_annotate_workflow", lambda d: None)
    with use_workspace("ws-a"):
        wf.save_workflow(_definition("alpha"))
    with use_workspace("ws-b"):
        wf.save_workflow(_definition("beta"))
        assert [w.name for w in wf.list_workflows()] == ["beta"]
        assert wf.get_workflow("alpha") is None
        assert wf.delete_workflow("alpha") is False
    with use_workspace("ws-a"):
        assert [w.name for w in wf.list_workflows()] == ["alpha"]
    # Outside any workspace (boot, admin maintenance) everything is visible.
    assert sorted(w.name for w in wf.list_workflows()) == ["alpha", "beta"]


def test_rows_made_outside_a_workspace_go_to_the_default(scoped_workflows, monkeypatch):
    from app.auth import scoping

    wf = scoped_workflows
    monkeypatch.setattr(wf, "_annotate_workflow", lambda d: None)
    scoping.set_default_workspace("ws-default")
    wf.save_workflow(_definition("boot_made"))
    with use_workspace("ws-default"):
        assert [w.name for w in wf.list_workflows()] == ["boot_made"]
    with use_workspace("ws-other"):
        assert wf.list_workflows() == []


# ── HTTP ────────────────────────────────────────────────────────────────────

@pytest.fixture
def http(auth_db):
    import app.main
    from fastapi.testclient import TestClient

    return TestClient(app.main.app, base_url="http://testserver")


@pytest.mark.real_auth
def test_api_needs_a_session(http):
    r = http.get("/api/workflows")
    assert r.status_code == 401 and r.json()["code"] == "unauthenticated"
    assert http.get("/api/auth/session").json() == {"user": None, "admin": None}
    assert http.get("/health").status_code == 200


@pytest.mark.real_auth
def test_role_decides_what_a_user_can_call(http, monkeypatch):
    _new_active_user(role="viewer")
    r = http.post("/api/auth/login", json={"email": "dev@example.com",
                                           "password": "correct horse battery"})
    assert r.status_code == 200
    assert "mdat_session" in r.cookies
    me = http.get("/api/auth/session").json()["user"]
    assert me["workspace"]["role_name"] == "Viewer"
    assert "workflows.view" in me["permissions"]

    r = http.post("/api/workflows/plan", json={}, headers={"Origin": "http://testserver"})
    assert r.status_code == 403 and r.json()["code"] == "forbidden"
    r = http.get("/api/admin/users")
    assert r.status_code == 401                                   # users are not admins

    r = http.post("/api/auth/logout", headers={"Origin": "http://testserver"})
    assert r.status_code == 200
    assert http.get("/api/auth/session").json()["user"] is None


@pytest.mark.real_auth
def test_cross_site_writes_are_refused(http):
    _new_active_user()
    http.post("/api/auth/login", json={"email": "dev@example.com",
                                       "password": "correct horse battery"})
    r = http.post("/api/workflows/plan", json={}, headers={"Origin": "https://evil.example"})
    assert r.status_code == 403 and r.json()["code"] == "csrf"


@pytest.mark.real_auth
def test_admin_portal_flow(http, monkeypatch):
    monkeypatch.setenv("ADMIN_EMAIL", "root@example.com")
    monkeypatch.setenv("ADMIN_INITIAL_PASSWORD", "initial admin passphrase")
    store.ensure_bootstrap_admin()
    o = {"Origin": "http://testserver"}
    r = http.post("/api/admin/auth/login", json={"email": "root@example.com",
                                                 "password": "initial admin passphrase"})
    assert r.status_code == 200 and r.json()["must_change_password"]
    # Nothing but the password change until it is done.
    assert http.get("/api/admin/users").json()["code"] == "password_change_required"
    r = http.post("/api/admin/auth/password", headers=o, json={
        "current_password": "initial admin passphrase",
        "new_password": "a much better admin passphrase"})
    assert r.status_code == 200

    ws = http.post("/api/admin/workspaces", headers=o, json={"name": "Lending", "api_key": KEY_A})
    assert ws.status_code == 201, ws.text
    roles = http.get("/api/admin/roles").json()["roles"]
    builder = next(r for r in roles if r["system_key"] == "builder")
    u = http.post("/api/admin/users", headers=o, json={
        "email": "ann@example.com", "name": "Ann Smith",
        "memberships": [{"workspace_id": ws.json()["id"], "role_id": builder["id"]}]})
    assert u.status_code == 201, u.text
    assert u.json()["link"]["path"].startswith("/invite/")
    assert http.get("/api/admin/overview").json()["users"]["invited"] == 1
    # An admin session is not a user session.
    assert http.get("/api/workflows").status_code == 401


@pytest.mark.real_auth
def test_dev_proxy_origin_is_same_site_even_with_cors_wildcard(http, monkeypatch):
    """Vite's proxy rewrites Host (changeOrigin) but forwards X-Forwarded-Host;
    a CORS "*" must not be what lets the request through."""
    from app.config import settings

    monkeypatch.setattr(settings, "CORS_ORIGINS", "*")
    _new_active_user()
    http.post("/api/auth/login", json={"email": "dev@example.com",
                                       "password": "correct horse battery"})
    proxied = {"Origin": "http://localhost:5173", "X-Forwarded-Host": "localhost:5173"}
    assert http.post("/api/workflows/validate", json={}, headers=proxied).status_code != 403
    foreign = {"Origin": "http://localhost:5173"}
    r = http.post("/api/workflows/validate", json={}, headers=foreign)
    assert r.status_code == 403 and r.json()["code"] == "csrf"


def test_policy_endpoint_is_the_server_rule_table():
    import re

    import app.main
    from fastapi.testclient import TestClient

    body = TestClient(app.main.app).get("/api/auth/policy").json()
    assert len(body["rules"]) == len(permissions.RULES)
    for exported, rule in zip(body["rules"], permissions.RULES):
        assert re.compile(exported["pattern"]).pattern == rule.pattern.pattern
        assert set(exported["methods"]) == set(rule.methods)
        assert tuple(exported["perms"]) == rule.perms
    # Only syntax JavaScript reads identically: no lookbehind, named groups, \A or \Z.
    for exported in body["rules"]:
        for unsupported in ("(?<", "(?P", "\\A", "\\Z"):
            assert unsupported not in exported["pattern"], exported["pattern"]


@pytest.mark.real_auth
def test_chat_role_can_talk_to_agents_but_not_design_them(http, monkeypatch):
    from app import dependencies

    monkeypatch.setattr(dependencies, "_mistral_client", object())
    _new_active_user(role="operator")
    http.post("/api/auth/login", json={"email": "dev@example.com",
                                       "password": "correct horse battery"})
    o = {"Origin": "http://testserver"}
    r = http.post("/api/orchestrate/stream", json={"query": "design me an agent"}, headers=o)
    assert r.status_code == 403
    assert "not design" in r.json()["detail"]["message"]


def test_successful_sign_ins_do_not_use_up_the_address_limit(auth_db, monkeypatch):
    """A whole office behind one address signing in must not be throttled."""
    monkeypatch.setenv("AUTH_IP_ATTEMPTS", "5")
    _new_active_user()
    for _ in range(12):
        assert store.login("user", "dev@example.com", "correct horse battery", ip="10.9.9.9")
