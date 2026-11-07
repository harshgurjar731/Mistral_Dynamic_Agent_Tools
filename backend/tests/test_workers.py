"""One workflow worker per workspace (app.auth.workers). No Temporal, no Mistral."""

import json
import os
import tempfile
import time

import pytest

from app.auth import context, scoping, workers


@pytest.fixture
def default_ws(monkeypatch):
    monkeypatch.setenv("DEPLOYMENT_NAME", "azure-vm")
    scoping.set_default_workspace("default0000000000")
    yield "default0000000000"
    scoping.set_default_workspace(None)


def test_default_workspace_keeps_the_existing_queue(default_ws):
    assert workers.deployment_name(default_ws) == "azure-vm"
    assert workers.deployment_name(None) == "azure-vm"
    assert workers.deployment_name("abcdef1234567890") == "azure-vm-abcdef12"


def test_current_deployment_follows_the_callers_workspace(default_ws):
    assert workers.current_deployment_name() == "azure-vm"
    with context.use_workspace("abcdef1234567890"):
        assert workers.current_deployment_name() == "azure-vm-abcdef12"


def test_process_workspace_is_the_fallback(default_ws):
    try:
        context.set_process_workspace("proc-ws")
        assert context.current_workspace_id() == "proc-ws"
        with context.use_workspace("request-ws"):
            assert context.current_workspace_id() == "request-ws"
        with context.unscoped():
            assert context.current_workspace_id() is None
    finally:
        context.set_process_workspace(None)
    assert context.current_workspace_id() is None


def test_files_are_grouped_by_owning_workspace(default_ws):
    d = tempfile.mkdtemp(prefix="wf_")
    for name in ("alpha", "beta", "legacy"):
        open(os.path.join(d, f"workflow_{name}.py"), "w").close()
    open(os.path.join(d, "helper.py"), "w").close()
    out = workers.files_by_workspace(d, owners={"alpha": "ws-a", "beta": "ws-b"})
    assert out == {
        "ws-a": ["workflow_alpha.py"],
        "ws-b": ["workflow_beta.py"],
        # Compiled before workspaces existed: it ran on the platform worker.
        default_ws: ["workflow_legacy.py"],
    }


def _ws(wid, **kw):
    return {"id": wid, "name": wid.upper(), "disabled": False, "key_status": "valid", **kw}


def test_only_workspaces_with_a_key_and_published_workflows_get_a_worker(default_ws):
    spaces = [_ws(default_ws), _ws("ws-a"), _ws("ws-idle"), _ws("ws-off", disabled=True),
              _ws("ws-bad", key_status="invalid"), _ws("ws-nokey")]
    keys = {default_ws: "k0", "ws-a": "k1", "ws-idle": "k2", "ws-off": "k3", "ws-bad": "k4",
            "ws-nokey": None}
    files = {default_ws: ["workflow_x.py"], "ws-a": ["workflow_b.py", "workflow_a.py"],
             "ws-off": ["workflow_o.py"], "ws-bad": ["workflow_q.py"], "ws-nokey": ["workflow_n.py"]}
    desired = workers.desired_workers(spaces, keys, files)
    assert set(desired) == {default_ws, "ws-a"}
    assert desired["ws-a"].files == ("workflow_a.py", "workflow_b.py")
    assert desired["ws-a"].deployment == "azure-vm-ws-a"
    assert desired[default_ws].deployment == "azure-vm"


def test_a_key_or_workflow_change_needs_a_new_process(default_ws):
    a = workers.desired_workers([_ws("ws-a")], {"ws-a": "k1"}, {"ws-a": ["workflow_a.py"]})["ws-a"]
    same = workers.desired_workers([_ws("ws-a")], {"ws-a": "k1"}, {"ws-a": ["workflow_a.py"]})["ws-a"]
    rekeyed = workers.desired_workers([_ws("ws-a")], {"ws-a": "k2"}, {"ws-a": ["workflow_a.py"]})["ws-a"]
    more = workers.desired_workers([_ws("ws-a")], {"ws-a": "k1"},
                                   {"ws-a": ["workflow_a.py", "workflow_b.py"]})["ws-a"]
    assert a.same_process(same)
    assert not a.same_process(rekeyed)
    assert not a.same_process(more)
    assert "k1" not in repr(a)  # the key itself is never kept, only a fingerprint


def test_status_roundtrip_and_staleness(default_ws, monkeypatch):
    d = tempfile.mkdtemp(prefix="st_")
    workers.write_status({"ws-a": workers.WorkerStatus("ws-a", state="running", pid=42)},
                         directory=d)
    st = workers.read_status(d)
    assert st["workers"]["ws-a"]["state"] == "running" and not st.get("stale")
    path = workers.status_path(d)
    data = json.load(open(path))
    data["updated_at"] = time.time() - 3600
    json.dump(data, open(path, "w"))
    assert workers.read_status(d)["stale"] is True


def test_worker_process_does_not_rewrite_the_default_workspace(monkeypatch):
    """A workspace's worker runs with that workspace's MISTRAL_API_KEY; it must
    not record it as the Default workspace's key."""
    from sqlalchemy import create_engine
    from sqlalchemy.orm import sessionmaker

    import app.auth.models  # noqa: F401
    from app.auth import store
    from app.config import settings
    from app.database import Base

    path = os.path.join(tempfile.mkdtemp(prefix="wk_"), "a.db")
    engine = create_engine(f"sqlite:///{path}", connect_args={"check_same_thread": False})
    Base.metadata.create_all(engine)
    monkeypatch.setattr(store, "SessionLocal", sessionmaker(bind=engine))
    store._key_cache.clear()
    try:
        monkeypatch.setattr(settings, "MISTRAL_API_KEY", "platform-key-" + "p" * 20)
        ws_id = store.ensure_default_workspace()
        before = store.get_workspace(ws_id)["key_hint"]
        monkeypatch.setenv("APP_WORKSPACE_ID", "some-other-workspace")
        monkeypatch.setattr(settings, "MISTRAL_API_KEY", "workspace-key-" + "w" * 20)
        assert store.ensure_default_workspace() == ws_id
        assert store.get_workspace(ws_id)["key_hint"] == before
    finally:
        store._key_cache.clear()
        scoping.set_default_workspace(None)
