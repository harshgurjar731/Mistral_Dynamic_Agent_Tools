"""Tool safety rules: shipped off, configured per rule and per place, and
applied to prompts and the build screen only where switched on."""

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.safety import apply as safety, store


@pytest.fixture
def db(monkeypatch, tmp_path):
    import app.safety.models  # noqa: F401
    from app.database import Base

    engine = create_engine(f"sqlite:///{tmp_path / 'safety.db'}",
                           connect_args={"check_same_thread": False})
    Base.metadata.create_all(engine)
    monkeypatch.setattr(store, "SessionLocal", sessionmaker(bind=engine))
    store.seed()
    return engine


def _prompts():
    from app.prompts import SYNTHESIS_CHECK_SYSTEM_PROMPT
    from app.prompts_codegen import ACTIVITY_SPEC_SYSTEM, TOOL_SPEC_SYSTEM
    from app.prompts_decisions import AGENT_DESIGN_SYSTEM_PROMPT, TOOL_SELECTION_SYSTEM_PROMPT

    return {
        "capability_gap": SYNTHESIS_CHECK_SYSTEM_PROMPT,
        "tool_selection": TOOL_SELECTION_SYSTEM_PROMPT,
        "workflow_agent_design": AGENT_DESIGN_SYSTEM_PROMPT,
        "spec_authoring": TOOL_SPEC_SYSTEM,
        "spec_authoring_activity": ACTIVITY_SPEC_SYSTEM,
    }


def test_everything_ships_off(db):
    rules = store.list_rules()
    assert len(rules) == len(store.BUILTIN)
    assert not any(r["enabled"] for r in rules)
    for point in store.POINTS:
        assert store.rules_for(point) == []
    # Every prompt that used to carry the blocklist carries nothing now.
    for name, prompt in _prompts().items():
        point = "spec_authoring" if name.startswith("spec") else name
        filled = safety.apply(prompt, point)
        assert safety.MARKER not in filled and "safety rules" not in filled.lower(), name


def test_seed_never_overwrites_a_users_choice(db):
    store.update_rule("no_arbitrary_code", enabled=True, strictness="strict",
                      applies_to=["screen_tool_build"])
    store.seed()
    rule = next(r for r in store.list_rules() if r["id"] == "no_arbitrary_code")
    assert rule["enabled"] and rule["strictness"] == "strict"
    assert rule["applies_to"] == ["screen_tool_build"]


def test_guidance_follows_place_and_strictness(db):
    store.update_rule("no_auth_bypass", enabled=True, strictness="strict",
                      applies_to=["tool_selection"])
    store.update_rule("no_impersonation", enabled=True, strictness="advise",
                      applies_to=["tool_selection", "capability_gap"])
    prompts = _prompts()
    selection = safety.apply(prompts["tool_selection"], "tool_selection")
    assert "[NEVER] Never design or request a tool that bypasses authentication" in selection
    assert "[AVOID]" in selection and safety.MARKER not in selection
    gap = safety.apply(prompts["capability_gap"], "capability_gap")
    assert "impersonates" in gap and "bypasses" not in gap
    design = safety.apply(prompts["workflow_agent_design"], "workflow_agent_design")
    assert "Tool safety rules" not in design


def test_custom_rules(db):
    rule = store.create_rule(title="No scraping", rule="Scrapes websites that forbid it.",
                             strictness="strict", applies_to=["screen_tool_build"])
    assert rule["id"].startswith("custom_") and not rule["enabled"]  # added off
    store.update_rule(rule["id"], enabled=True)
    assert [r["id"] for r in store.rules_for("screen_tool_build")] == [rule["id"]]
    assert store.rules_for("screen_rebuild") == []

    with pytest.raises(store.SafetyRuleError):
        store.create_rule(title="Bad", rule="Something bad.", applies_to=["nowhere"])
    with pytest.raises(store.SafetyRuleError):
        store.update_rule("no_impersonation", rule="reworded")  # built-in wording is fixed
    with pytest.raises(store.SafetyRuleError):
        store.delete_rule("no_impersonation")
    store.delete_rule(rule["id"])
    assert store.rules_for("screen_tool_build") == []


def test_turn_all_off(db):
    for r in store.BUILTIN:
        store.update_rule(r["id"], enabled=True)
    assert store.turn_all_off() == len(store.BUILTIN)
    assert all(store.rules_for(p) == [] for p in store.POINTS)


def test_screen_points():
    assert safety.screen_point("tool", "explicit") == "screen_tool_build"
    assert safety.screen_point("activity", "workflow") == "screen_activity_build"
    assert safety.screen_point("tool", "feedback") == "screen_rebuild"


def test_api(db):
    from fastapi.testclient import TestClient

    from app.main import app

    client = TestClient(app)
    data = client.get("/api/safety-rules").json()
    assert data["summary"]["active_rules"] == 0
    assert {p["kind"] for p in data["points"]} == {"guidance", "screen"}

    on = client.patch("/api/safety-rules/no_arbitrary_code",
                      json={"enabled": True, "strictness": "strict",
                            "applies_to": ["screen_rebuild"]}).json()
    assert on["enabled"] and on["applies_to"] == ["screen_rebuild"]
    assert client.get("/api/safety-rules").json()["summary"]["points_in_use"] == ["screen_rebuild"]

    made = client.post("/api/safety-rules", json={
        "title": "No paid APIs", "rule": "Calls a paid third-party API.",
        "applies_to": ["capability_gap"]})
    assert made.status_code == 201
    assert client.patch("/api/safety-rules/no_arbitrary_code",
                        json={"strictness": "extreme"}).status_code == 422
    assert client.delete("/api/safety-rules/no_arbitrary_code").status_code == 422
    assert client.delete(f"/api/safety-rules/{made.json()['id']}").status_code == 200
    off = client.post("/api/safety-rules/turn-off").json()
    assert off["turned_off"] == 1 and off["summary"]["active_rules"] == 0
