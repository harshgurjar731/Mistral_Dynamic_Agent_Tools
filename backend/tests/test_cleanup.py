"""Settings → Cleanup: targets run in order, one failure does not stop the
rest, the baseline is restored, and the API refuses unconfirmed, empty, busy
or unauthorised requests. Nothing here touches the real database or Mistral."""

import asyncio

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text

from app.cleanup import targets as cleanup_targets
from app.cleanup.targets import Target


def _target(tid, log, fail=False, removed=None):
    async def count():
        return {"things": 1}

    async def purge():
        log.append(tid)
        if fail:
            raise RuntimeError(f"{tid} broke")
        return dict(removed or {"records": 2})

    return Target(tid, tid.title(), "", "Group", False, count, purge)


@pytest.fixture
def fake(monkeypatch):
    log: list[str] = []
    prepared: list[bool] = []
    fakes = [
        _target("first", log),
        _target("second", log, fail=True),
        _target("third", log, removed={"deleted": 3, "failed": 1, "errors": ["x: gone"]}),
    ]
    monkeypatch.setattr(cleanup_targets, "TARGETS", fakes)
    monkeypatch.setattr(cleanup_targets, "_BY_ID", {t.id: t for t in fakes})
    monkeypatch.setattr("app.db_setup.prepare_database",
                        lambda seed_rules=True: prepared.append(seed_rules))
    monkeypatch.setattr(cleanup_targets, "busy", lambda: [])
    return log, prepared


def test_runs_in_registry_order_and_carries_on_after_a_failure(fake):
    log, prepared = fake
    result = asyncio.run(cleanup_targets.run(["third", "first", "second"]))

    assert log == ["first", "second", "third"]
    by_id = {r["id"]: r for r in result["results"]}
    assert by_id["first"]["ok"] and by_id["first"]["removed"] == {"records": 2}
    assert not by_id["second"]["ok"] and by_id["second"]["errors"] == ["second broke"]
    # Partial failures inside a purge are reported, not hidden.
    assert not by_id["third"]["ok"] and by_id["third"]["errors"] == ["x: gone"]
    assert "errors" not in by_id["third"]["removed"]
    assert result["ok"] is False
    assert prepared == [True], "the fresh-install baseline is restored after every run"


def test_unknown_target_is_refused(fake):
    with pytest.raises(ValueError):
        asyncio.run(cleanup_targets.run(["first", "nope"]))


def test_preview_reports_count_errors_per_target(monkeypatch):
    async def broken():
        raise RuntimeError("Tool Service unreachable")

    ok = _target("ok", [])
    bad = Target("bad", "Bad", "", "Group", False, broken, ok.purge)
    monkeypatch.setattr(cleanup_targets, "TARGETS", [ok, bad])
    monkeypatch.setattr(cleanup_targets, "busy", lambda: ["build: something"])

    preview = asyncio.run(cleanup_targets.preview())
    rows = {t["id"]: t for t in preview["targets"]}
    assert rows["ok"]["counts"] == {"things": 1} and rows["ok"]["error"] is None
    assert rows["bad"]["counts"] == {} and "unreachable" in rows["bad"]["error"]
    assert preview["busy"] == ["build: something"]


# ── Table helpers ─────────────────────────────────────────────────────────


@pytest.fixture
def engine(monkeypatch, tmp_path):
    eng = create_engine(f"sqlite:///{tmp_path / 'cleanup.db'}")
    with eng.begin() as conn:
        conn.execute(text("CREATE TABLE things (id INTEGER PRIMARY KEY)"))
        conn.execute(text("INSERT INTO things (id) VALUES (1), (2), (3)"))
        conn.execute(text(
            "CREATE TABLE ontology_annotations (id INTEGER PRIMARY KEY, "
            "subject_type TEXT, subject_id TEXT)"
        ))
        conn.execute(text(
            "INSERT INTO ontology_annotations (subject_type, subject_id) VALUES "
            "('agent', 'a1'), ('agent', 'keep-me'), ('workflow', 'w1'), ('library', 'l1')"
        ))
    monkeypatch.setattr(cleanup_targets, "_engine", lambda: eng)
    return eng


def test_clear_tables_skips_missing_tables(engine):
    assert cleanup_targets._clear_tables("things", "no_such_table") == 3
    assert cleanup_targets._count_rows("things") == 0
    assert cleanup_targets._count_rows("no_such_table") == 0


def test_forget_annotations_keeps_the_platform_agents(engine):
    assert cleanup_targets._forget_annotations("agent", keep=["keep-me"]) == 1
    assert cleanup_targets._forget_annotations("workflow", "library") == 2
    with engine.connect() as conn:
        left = conn.execute(text("SELECT subject_id FROM ontology_annotations")).fetchall()
    assert [r[0] for r in left] == ["keep-me"]


# ── API ───────────────────────────────────────────────────────────────────


@pytest.fixture
def client(fake, monkeypatch):
    from app.routes import cleanup as cleanup_routes

    app = FastAPI()
    app.include_router(cleanup_routes.router, prefix="/api")
    monkeypatch.delenv("VAULT_ADMIN_TOKEN", raising=False)
    return TestClient(app)


def test_api_requires_the_confirmation_phrase(client, fake):
    log, _ = fake
    resp = client.post("/api/settings/cleanup", json={"targets": ["first"], "confirm": "yes"})
    assert resp.status_code == 400 and log == []


def test_api_requires_something_to_delete(client):
    resp = client.post("/api/settings/cleanup", json={"targets": [], "confirm": "DELETE"})
    assert resp.status_code == 400


def test_api_everything_runs_every_target(client, fake):
    log, _ = fake
    resp = client.post("/api/settings/cleanup", json={"everything": True, "confirm": "DELETE"})
    assert resp.status_code == 200
    assert log == ["first", "second", "third"]


def test_api_refuses_while_runs_are_in_progress(client, fake, monkeypatch):
    log, _ = fake
    monkeypatch.setattr(cleanup_targets, "busy", lambda: ["build: agent"])
    resp = client.post("/api/settings/cleanup", json={"targets": ["first"], "confirm": "DELETE"})
    assert resp.status_code == 409 and log == []


def test_api_wiping_the_vault_needs_its_admin_token(client, fake, monkeypatch):
    monkeypatch.setenv("VAULT_ADMIN_TOKEN", "s3cret")
    body = {"targets": ["vault"], "confirm": "DELETE"}
    assert client.post("/api/settings/cleanup", json=body).status_code == 401
    # With the token it gets past the guard (and on to the unknown-target check here).
    resp = client.post("/api/settings/cleanup", json=body, headers={"X-Vault-Token": "s3cret"})
    assert resp.status_code == 400 and "Unknown" in resp.json()["detail"]


def test_preview_api_names_the_confirmation_phrase(client):
    resp = client.get("/api/settings/cleanup")
    assert resp.status_code == 200
    assert resp.json()["confirm_phrase"] == "DELETE"
    assert [t["id"] for t in resp.json()["targets"]] == ["first", "second", "third"]


def test_every_real_target_is_registered_once():
    ids = [t.id for t in cleanup_targets.TARGETS]
    assert len(ids) == len(set(ids))
    assert {"agents", "workflows", "tools", "libraries", "uploads", "settings"} <= set(ids)
    # The vocabulary runs last: every other purge removes its annotations first.
    assert ids[-1] == "ontology"
