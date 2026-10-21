"""Central settings: overrides, defaults, live application and the model catalog."""

import asyncio
import json
import time
from datetime import datetime, timedelta, timezone

import pytest

from app.app_settings import catalog, tool_service
from app.app_settings.core import Section, SettingDef, SettingsStore, coerce
from app.app_settings.store import get_store
from app.config import resolve_agent_model, settings
from app.llm_routes import route_for


@pytest.fixture(autouse=True)
def _clean_store():
    get_store().reset()
    yield
    get_store().reset()


def test_override_applies_live_and_reset_restores_default():
    store = get_store()
    before = settings.DECISION_CONCURRENCY
    assert store.update({"DECISION_CONCURRENCY": before + 3}) == ["DECISION_CONCURRENCY"]
    assert settings.DECISION_CONCURRENCY == before + 3
    assert store.describe("DECISION_CONCURRENCY")["source"] == "override"

    store.reset(section="orchestration")
    assert settings.DECISION_CONCURRENCY == before
    assert store.describe("DECISION_CONCURRENCY")["source"] != "override"


def test_overrides_persist_to_disk(tmp_path):
    path = tmp_path / "rs.json"
    defs = [SettingDef("X", "s", "X", "", type="int", default=1)]
    store = SettingsStore([Section("s", "S", "")], defs, path, "backend")
    store.install(object())
    store.update({"X": 5})
    assert json.loads(path.read_text())["overrides"] == {"X": 5}

    again = SettingsStore([Section("s", "S", "")], defs, path, "backend")
    again.install(object())
    assert again.value("X") == 5


def test_route_override_wins_over_code_default():
    assert route_for("spec_author").model == "mistral-medium-2604"
    get_store().update({"ROUTE_SPEC_AUTHOR_MODEL": "mistral-large-2512",
                        "ROUTE_SPEC_AUTHOR_EFFORT": "omit",
                        "ROUTE_SPEC_AUTHOR_FALLBACK": "none"})
    route = route_for("spec_author")
    assert route.model == "mistral-large-2512"
    assert route.reasoning_effort is None
    assert route.fallback_model is None


def test_model_list_round_trips_as_comma_string():
    get_store().update({"AGENT_MODEL_CHOICES": ["a-model", "b-model", "a-model"]})
    assert settings.AGENT_MODEL_CHOICES == "a-model,b-model"
    assert settings.agent_model_choices == ["a-model", "b-model"]


def test_tier_labels_resolve_to_configured_models():
    get_store().update({"AGENT_MODEL_SMALL": "ministral-8b-latest",
                        "DEFAULT_AGENT_MODEL": "mistral-medium-latest"})
    assert resolve_agent_model("mistral-small-latest") == "ministral-8b-latest"
    assert resolve_agent_model("not-a-model") == "mistral-medium-latest"


def test_validation_rejects_bad_values_and_secrets():
    store = get_store()
    with pytest.raises(ValueError):
        store.update({"DECISION_CONCURRENCY": 0})
    with pytest.raises(ValueError):
        store.update({"MISTRAL_API_KEY": "sk-leak"})
    with pytest.raises(ValueError):
        store.update({"NOT_A_SETTING": 1})
    assert store.describe("MISTRAL_API_KEY")["value"] in ("", "••••••••")


def test_coerce_types():
    assert coerce(SettingDef("b", "s", "B", "", type="bool"), "off") is False
    assert coerce(SettingDef("f", "s", "F", "", type="model", allow_none=True), "None") == "none"
    with pytest.raises(ValueError):
        coerce(SettingDef("e", "s", "E", "", type="enum", options=("a",)), "b")


def _write_catalog(models):
    catalog._save({"fetched_at": time.time(), "source": "test", "models": models})


def test_model_status_flags_deprecated_unknown_and_incapable():
    past = (datetime.now(timezone.utc) - timedelta(days=1)).isoformat()
    future = (datetime.now(timezone.utc) + timedelta(days=30)).isoformat()
    _write_catalog([
        {"id": "m-ok", "aliases": ["m-ok-latest"], "capabilities": {"completion_chat": True}},
        {"id": "m-old", "deprecation": future, "deprecation_replacement_model": "m-ok",
         "capabilities": {"completion_chat": True}},
        {"id": "m-gone", "deprecation": past, "capabilities": {"completion_chat": True}},
        {"id": "m-mod", "capabilities": {"moderation": True}},
    ])
    idx = catalog.index()
    assert catalog.model_status("m-ok-latest", "chat", idx)["status"] == "ok"
    assert catalog.model_status("m-old", "chat", idx)["replacement"] == "m-ok"
    assert catalog.model_status("m-gone", "chat", idx)["status"] == "retired"
    assert catalog.model_status("nope", "chat", idx)["status"] == "unknown"
    assert catalog.model_status("m-mod", "chat", idx)["status"] == "incapable"


def test_review_upgrades_deprecated_models(monkeypatch):
    future = (datetime.now(timezone.utc) + timedelta(days=30)).isoformat()
    _write_catalog([
        {"id": "new-large", "capabilities": {"completion_chat": True, "function_calling": True}},
        {"id": "old-large", "deprecation": future, "deprecation_replacement_model": "new-large",
         "capabilities": {"completion_chat": True, "function_calling": True}},
    ])
    get_store().update({"DEFAULT_AGENT_MODEL": "old-large"})

    async def unreachable():
        raise ConnectionError("down")

    monkeypatch.setattr(tool_service, "get_settings", unreachable)

    report = asyncio.run(catalog.review(apply=False))
    assert any(i["key"] == "DEFAULT_AGENT_MODEL" for i in report["issues"])
    assert settings.DEFAULT_AGENT_MODEL == "old-large"

    report = asyncio.run(catalog.review(apply=True))
    assert {"target": "backend", "key": "DEFAULT_AGENT_MODEL", "model": "new-large"} in report["upgraded"]
    assert settings.DEFAULT_AGENT_MODEL == "new-large"


def test_change_saved_by_another_process_is_picked_up(tmp_path):
    """Two stores on one file stand in for the API and the workflows worker."""
    path = tmp_path / "rs.json"
    defs = [SettingDef("X", "s", "X", "", type="int", default=1)]

    class Obj:  # a pydantic-like settings object with field X
        model_fields = {"X": type("F", (), {"default": 1})()}
        X = 1

    api = SettingsStore([Section("s", "S", "")], defs, path, "backend", watch=False)
    worker = SettingsStore([Section("s", "S", "")], defs, path, "backend", watch=False)
    obj = Obj()
    worker.install(obj)
    api.install(Obj())
    fired = []
    worker.on_change(["X"], lambda: fired.append(obj.X))

    api.update({"X": 7})
    time.sleep(0.01)
    assert worker.sync() == ["X"]
    assert obj.X == 7 and fired == [7]

    api.reset()
    assert worker.sync() == ["X"]
    assert obj.X == 1


def test_hook_runs_on_save_and_reset():
    calls = []
    store = get_store()
    store.on_change(["UPLOAD_MAX_MB"], lambda: calls.append(settings.UPLOAD_MAX_MB))
    store.update({"UPLOAD_MAX_MB": 33})
    store.reset(keys=["UPLOAD_MAX_MB"])
    assert calls == [33, 20]


def test_ui_settings_have_defaults_and_validate():
    store = get_store()
    assert store.value("UI_ACCENT") == "ember"
    assert store.value("UI_SIDEBAR_COLLAPSED") is True
    store.update({"UI_ACCENT": "violet"})
    assert store.value("UI_ACCENT") == "violet"
    with pytest.raises(ValueError):
        store.update({"UI_ACCENT": "neon"})


def test_every_setting_is_described():
    for key, defn in get_store().defs.items():
        assert defn.description.strip(), f"{key} has no description"
        assert defn.impact, f"{key} has no impact areas"
        assert defn.used_in, f"{key} has no code locations"
