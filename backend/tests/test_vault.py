"""Vault: values encrypted and bound to their entry, never listed, resolved only for
code allowed to use them, scrubbed from results, and every change audited."""

import asyncio

import pytest
from cryptography.fernet import Fernet
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.vault import crypto, redact, store
from app.vault.models import VaultSecret

KEY_A = Fernet.generate_key().decode()
KEY_B = Fernet.generate_key().decode()


@pytest.fixture
def vault(monkeypatch, tmp_path):
    import app.vault.models  # noqa: F401
    from app.config import settings
    from app.database import Base

    engine = create_engine(f"sqlite:///{tmp_path / 'vault.db'}",
                           connect_args={"check_same_thread": False})
    Base.metadata.create_all(engine)
    monkeypatch.setattr(store, "SessionLocal", sessionmaker(bind=engine))
    monkeypatch.setenv("VAULT_MASTER_KEYS", KEY_A)
    monkeypatch.setattr(settings, "VAULT_ENABLED", True)
    monkeypatch.setattr(settings, "VAULT_ALLOW_REVEAL", False)
    monkeypatch.setattr(settings, "VAULT_VERSION_HISTORY", 2)
    crypto.reset()
    yield store.SessionLocal
    crypto.reset()


def _add(name="OPENWEATHER_API_KEY", value="sk-weather-0123456789abcd", **kw):
    return store.create_secret(name=name, value=value, service=kw.pop("service", "OpenWeather"), **kw)


def test_value_is_encrypted_and_never_listed(vault):
    entry = _add()
    assert entry["hint"] == "••••abcd" and entry["sensitive"] and entry["usable"]
    with vault() as db:
        row = db.get(VaultSecret, entry["id"])
        assert "sk-weather" not in row.ciphertext
    listing = store.list_secrets()
    assert all("value" not in s and "ciphertext" not in s for s in listing)
    assert "sk-weather" not in str(listing) and "sk-weather" not in str(store.catalogue())


def test_names_are_normalised_and_validated(vault):
    assert _add(name="acme crm-token")["name"] == "ACME_CRM_TOKEN"
    with pytest.raises(store.VaultError):
        _add(name="ACME_CRM_TOKEN")              # duplicate
    with pytest.raises(store.VaultError):
        store.create_secret(name="ACME_URL", value="not a url", kind="url")
    url = store.create_secret(name="ACME_URL", value="https://crm.acme.test/v2", kind="url")
    assert not url["sensitive"] and url["hint"] == "https://crm.acme.test/v2"


def test_ciphertext_is_bound_to_its_entry(vault):
    a, b = _add("A_KEY", "value-of-a-123456"), _add("B_KEY", "value-of-b-123456")
    with vault() as db:
        ra, rb = db.get(VaultSecret, a["id"]), db.get(VaultSecret, b["id"])
        rb.ciphertext = ra.ciphertext            # someone swaps rows in the database
        db.commit()
    res = store.resolve(["A_KEY", "B_KEY"], consumer="tool")
    assert res.values == {"A_KEY": "value-of-a-123456"} and res.problems == {"B_KEY": "error"}


def test_resolve_checks_status_and_consumer(vault):
    _add("OPEN_KEY", "open-value-123456")
    _add("LIMITED_KEY", "limited-value-123456", allowed_consumers=["fetch_weather", "crm_*"])
    off = _add("OFF_KEY", "off-value-1234567")
    store.update_secret(off["id"], disabled=True)
    old = _add("OLD_KEY", "old-value-1234567", expires_at="2000-01-01T00:00:00Z")
    assert old["status"] == "expired"

    res = store.resolve(["OPEN_KEY", "LIMITED_KEY", "OFF_KEY", "OLD_KEY", "NOPE"],
                        consumer="fetch_weather@3")
    assert set(res.values) == {"OPEN_KEY", "LIMITED_KEY"}
    assert res.problems == {"OFF_KEY": "disabled", "OLD_KEY": "expired", "NOPE": "missing"}
    assert store.resolve(["LIMITED_KEY"], consumer="crm_sync").values
    assert store.resolve(["LIMITED_KEY"], consumer="other_tool").problems == {"LIMITED_KEY": "denied"}

    entry = store.get_secret("OPEN_KEY")
    assert entry["use_count"] == 1 and entry["used_by"] == ["fetch_weather@3"]
    actions = [e["action"] for e in store.audit_log()]
    assert "use" in actions and "denied" in actions


def test_status_does_not_count_a_use(vault):
    _add("S_KEY", "status-value-123456")
    assert store.status(["S_KEY", "MISSING"]) == {
        "S_KEY": {"exists": True, "usable": True, "reason": "ok", "id": store.get_secret("S_KEY")["id"],
                  "label": "S Key", "kind": "api_key", "service": "OpenWeather", "flags": []},
        "MISSING": {"exists": False, "usable": False, "reason": "missing"},
    }
    assert store.get_secret("S_KEY")["use_count"] == 0


def test_versions_rollback_and_history_limit(vault):
    entry = _add("ROT_KEY", "first-value-123456")
    for v in ("second-value-123456", "third-value-1234567", "fourth-value-123456"):
        store.set_value(entry["id"], v)
    kept = store.versions(entry["id"])
    assert kept[0]["current"] and kept[0]["version"] == 4
    assert [v["version"] for v in kept[1:]] == [3, 2]        # history limit 2
    store.rollback(entry["id"], 2)
    assert store.resolve(["ROT_KEY"], consumer="t").values["ROT_KEY"] == "second-value-123456"
    assert store.get_secret("ROT_KEY")["version"] == 5


def test_reveal_is_gated_and_audited(vault, monkeypatch):
    from app.config import settings

    secret = _add("REV_KEY", "reveal-me-12345678")
    url = store.create_secret(name="REV_URL", value="https://x.test", kind="url")
    assert store.reveal(url["id"])["value"] == "https://x.test"   # not sensitive: always
    with pytest.raises(PermissionError):
        store.reveal(secret["id"])
    monkeypatch.setattr(settings, "VAULT_ALLOW_REVEAL", True)
    assert store.reveal(secret["id"])["value"] == "reveal-me-12345678"
    reveals = [e for e in store.audit_log(action="reveal")]
    assert [e["outcome"] for e in reveals].count("denied") == 1


def test_making_an_entry_sensitive_hides_its_hint(vault):
    url = store.create_secret(name="CRM_URL", value="https://crm.internal.test", kind="url")
    assert store.update_secret(url["id"], sensitive=True)["hint"] == "••••test"


def test_master_key_rotation(vault, monkeypatch):
    entry = _add("ROTATE_ME", "rotate-value-123456")
    monkeypatch.setenv("VAULT_MASTER_KEYS", f"{KEY_B},{KEY_A}")
    crypto.reset()
    assert "old_key" in store.get_secret(entry["id"])["flags"]
    report = store.rotate_master_key()
    assert report["re_encrypted"] == 1 and not report["unreadable"]
    monkeypatch.setenv("VAULT_MASTER_KEYS", KEY_B)         # old key removed
    crypto.reset()
    assert store.resolve(["ROTATE_ME"], consumer="t").values == {"ROTATE_ME": "rotate-value-123456"}


def test_candidates_rank_exact_then_service(vault):
    _add("OPENWEATHER_API_KEY", "weather-value-123456")
    _add("WEATHER_BACKUP_KEY", "backup-value-123456", service="WeatherCo")
    best = store.candidates(name="OPENWEATHER_API_KEY")
    assert best[0]["name"] == "OPENWEATHER_API_KEY" and best[0]["score"] == 1.0
    by_service = store.candidates(name="OWM_KEY", service="OpenWeather", kind="api_key")
    assert by_service[0]["name"] == "OPENWEATHER_API_KEY" and by_service[0]["score"] == 0.8


def test_vault_off_resolves_nothing(vault, monkeypatch):
    from app.config import settings

    _add("K_OFF", "value-when-off-1234")
    monkeypatch.setattr(settings, "VAULT_ENABLED", False)
    assert store.resolve(["K_OFF"], consumer="t").values == {}
    with pytest.raises(store.VaultError):
        _add("NEW_ONE", "x-123456789")


def test_scrub_masks_values_anywhere():
    values = {"API_KEY": "sk-live-abcdef123", "SHORT": "eu"}
    result = {"status": "error", "message": "GET https://api.test/?key=sk-live-abcdef123 failed",
              "nested": [{"echo": "sk-live-abcdef123"}], "region": "eu-west"}
    clean = redact.scrub(result, values)
    assert "sk-live" not in str(clean)
    assert clean["message"].endswith("?key=[vault:API_KEY] failed")
    assert clean["region"] == "eu-west"                      # too short to scrub safely


# ── Routes ─────────────────────────────────────────────────────────────────


@pytest.fixture
def client(vault):
    from fastapi import FastAPI
    from fastapi.testclient import TestClient

    from app.routes import vault as routes

    app = FastAPI()
    app.include_router(routes.router, prefix="/api")
    return TestClient(app)


def test_routes_never_return_values(client):
    created = client.post("/api/vault/secrets", json={"name": "GH_TOKEN", "value": "ghp_secretvalue1234",
                                                      "kind": "token", "service": "GitHub"})
    assert created.status_code == 201 and "ghp_secret" not in created.text
    overview = client.get("/api/vault")
    assert overview.status_code == 200 and "ghp_secret" not in overview.text
    assert overview.json()["summary"]["total"] == 1
    assert client.post("/api/vault/secrets/GH_TOKEN/reveal").status_code == 403
    status = client.get("/api/vault/status", params={"names": "GH_TOKEN,NOPE"}).json()["secrets"]
    assert status["GH_TOKEN"]["usable"] and not status["NOPE"]["exists"]


def test_admin_token_guards_writes(client, monkeypatch):
    monkeypatch.setenv("VAULT_ADMIN_TOKEN", "letmein")
    body = {"name": "GUARDED", "value": "guarded-value-1234"}
    assert client.post("/api/vault/secrets", json=body).status_code == 401
    assert client.post("/api/vault/secrets", json=body,
                       headers={"X-Vault-Token": "wrong"}).status_code == 401
    assert client.post("/api/vault/secrets", json=body,
                       headers={"X-Vault-Token": "letmein"}).status_code == 201
    assert client.get("/api/vault").json()["admin_token_required"] is True


# ── Execution: the Tool Service asks, the backend answers from the vault ────


class _Resp:
    def __init__(self, status, payload):
        self.status_code, self._payload, self.text = status, payload, str(payload)

    def json(self):
        return self._payload


def test_execute_learns_secret_names_and_masks_the_result(vault, monkeypatch):
    from app.services.tool_resolver import ToolResolver

    _add("WEATHER_KEY", "weather-secret-98765")
    sent = []

    async def fake_send(method, url, **kw):
        body = kw["json"]
        sent.append(dict(body))
        if "secrets" not in body:
            return _Resp(428, {"detail": {"reason": "secrets_required", "secrets": ["WEATHER_KEY"]}})
        return _Resp(200, {"result": {"status": "success",
                                      "data": {"echo": body["secrets"]["WEATHER_KEY"]}},
                           "tool_name": "fetch_weather", "version": 1})

    resolver = ToolResolver("http://tool-service.test")
    monkeypatch.setattr(resolver, "_send", fake_send)
    first = asyncio.run(resolver.execute_tool("fetch_weather", {"city": "Pune"}))
    assert first["result"]["data"]["echo"] == "[vault:WEATHER_KEY]"
    assert len(sent) == 2 and sent[0]["vault"] is True and "secrets" not in sent[0]
    assert sent[1]["secret_names"] == ["WEATHER_KEY"]

    sent.clear()
    asyncio.run(resolver.execute_tool("fetch_weather@1", {"city": "Pune"}))
    assert len(sent) == 1 and sent[0]["secrets"] == {"WEATHER_KEY": "weather-secret-98765"}


def test_deployment_fills_blank_tool_secrets_only_when_asked(vault):
    from app.services import workflow_packager as packager
    from app.services.workflow_engine.models import (
        DeploymentManifest,
        DeploymentSetup,
        DeploymentSetupField,
    )

    _add("WEATHER_KEY", "deploy-weather-12345")
    manifest = DeploymentManifest.model_construct(workflow_name="wx", setup=[
        DeploymentSetupField(key="WEATHER_KEY", label="WEATHER_KEY", secret=True, group="tool"),
        DeploymentSetupField(key="OTHER_KEY", label="OTHER_KEY", secret=True, group="tool"),
    ])
    gen = {"NEO4J_PASSWORD": "x", "SQL_DB_PASSWORD": "y"}

    def env(setup):
        return {k: v for _, k, v in packager._env_values(manifest, None, setup, gen)}

    assert env(DeploymentSetup())["WEATHER_KEY"] == ""
    filled = env(DeploymentSetup(use_vault=True))
    assert filled["WEATHER_KEY"] == "deploy-weather-12345" and filled["OTHER_KEY"] == ""
    # A value the operator typed wins over the vault.
    typed = env(DeploymentSetup(use_vault=True, env={"WEATHER_KEY": "typed"}))
    assert typed["WEATHER_KEY"] == "typed"
    assert store.get_secret("WEATHER_KEY")["used_by"] == ["deployment:wx"]
