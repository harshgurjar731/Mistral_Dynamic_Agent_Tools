"""A slow model cannot stall a build.

Six small activities took 70 minutes to build: each model call waited out a
5-minute timeout — up to three times on the same model — before the fallback
answered in seconds.
"""

import time

import pytest

from app.config import settings
from app.llm import client, speed
from app.llm.routes import ModelRoute, other_model, route_for


@pytest.fixture(autouse=True)
def _fresh():
    speed.reset()
    yield
    speed.reset()


def _route(monkeypatch, primary="mistral-large-4", fallback="mistral-medium-2604"):
    route = ModelRoute("codegen", primary, "high", timeout_ms=5000, fallback_model=fallback)
    monkeypatch.setattr(client, "route_for", lambda role: route)
    return route


def _models(monkeypatch, delays=None, errors=None):
    calls = []

    def fake_call(route, model, messages, *, json_mode, use_effort):
        calls.append(model)
        time.sleep((delays or {}).get(model, 0))
        if model in (errors or {}):
            raise RuntimeError(errors[model])
        return f"code from {model}", None

    monkeypatch.setattr(client, "_call", fake_call)
    monkeypatch.setattr(client.time, "sleep", lambda s: None) if not delays else None
    return calls


def test_a_slow_model_is_raced_against_the_fallback(monkeypatch):
    _route(monkeypatch)
    monkeypatch.setattr(settings, "TOOL_MODEL_HEDGE_SECONDS", 0.05)
    calls = _models(monkeypatch, delays={"mistral-large-4": 0.6})
    started = time.monotonic()
    text, model = client.complete("codegen", [])
    assert (text, model) == ("code from mistral-medium-2604", "mistral-medium-2604")
    assert time.monotonic() - started < 0.5, "did not wait for the slow model"
    assert calls == ["mistral-large-4", "mistral-medium-2604"]


def test_a_model_that_keeps_losing_is_skipped(monkeypatch):
    _route(monkeypatch)
    monkeypatch.setattr(settings, "TOOL_MODEL_HEDGE_SECONDS", 0.02)
    calls = _models(monkeypatch, delays={"mistral-large-4": 0.2})
    for _ in range(speed.STRIKES):
        client.complete("codegen", [])
    assert speed.skipped("mistral-large-4")
    calls.clear()
    assert client.complete("codegen", [])[1] == "mistral-medium-2604"
    assert calls == ["mistral-medium-2604"], "the slow model is not asked at all"


def test_a_timeout_is_not_retried_on_the_same_model(monkeypatch):
    _route(monkeypatch, primary="mistral-medium-2604", fallback="mistral-large-4")
    monkeypatch.setattr(settings, "TOOL_MODEL_MAX_ATTEMPTS", 3)
    calls = _models(monkeypatch, errors={"mistral-medium-2604": "Request timed out after 240000ms"})
    text, model = client.complete("codegen", [])
    assert model == "mistral-large-4"
    assert calls == ["mistral-medium-2604", "mistral-large-4"], "one timeout, then the other model"


def test_a_fast_primary_is_not_hedged_and_the_fallback_is_always_a_different_model(monkeypatch):
    _route(monkeypatch, primary="mistral-medium-2604", fallback="mistral-large-4")
    monkeypatch.setattr(settings, "TOOL_MODEL_HEDGE_SECONDS", 5)
    calls = _models(monkeypatch)
    assert client.complete("codegen", [])[1] == "mistral-medium-2604"
    assert calls == ["mistral-medium-2604"]

    assert other_model("mistral-medium-2604", "mistral-medium-2604") == "mistral-large-4"
    assert other_model("mistral-large-4", "mistral-large-4") == "mistral-medium-2604"
    assert other_model("mistral-large-4", None) is None
    for role in ("codegen", "repair", "arbiter"):
        route = route_for(role)
        assert route.fallback_model and route.fallback_model != route.model
