"""Goal agents (bounded re-plan loop) and guidance feedback from build outcomes."""

import asyncio
import json

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.services.workflow_engine.models import StepResult, StepType, WorkflowStep


def _goal_step(**archetype):
    return WorkflowStep(id="sourcing", type=StepType.AGENT, config={
        "agent_id": "a1", "query_template": "Find savings for {{category}}",
        "archetype": {"primary_type": "goal", "patterns": ["planner_executor"],
                      "reflection_criteria": ["Three suppliers compared"], **archetype}})


def _patch(monkeypatch, verdicts):
    from app.core import decision
    from app.services.workflow_engine import step_runners

    runs = []

    async def fake_agent(step, variables):
        runs.append((step.config, dict(variables)))
        return StepResult(step_id=step.id, status="completed", output={"answer": f"attempt {len(runs)}"},
                          output_preview=f"attempt {len(runs)}")

    answers = iter(json.dumps(v) for v in verdicts)

    async def fake_decide(client, **kw):
        return next(answers)

    monkeypatch.setattr(step_runners, "run_agent_step", fake_agent)
    monkeypatch.setattr(decision, "decide", fake_decide)
    monkeypatch.setattr("app.dependencies.get_mistral_client", lambda: None)
    return runs


def test_goal_loop_replans_from_what_remains_until_done(monkeypatch):
    from app.services.workflow_engine.step_runners import run_agent_or_goal_step

    runs = _patch(monkeypatch, [{"done": False, "remaining": ["supplier C"], "reason": "two of three"},
                                {"done": True, "remaining": [], "reason": "all compared"}])
    result = asyncio.run(run_agent_or_goal_step(_goal_step(), {"category": "packaging"}))
    assert len(runs) == 2
    first_config, second_config = runs[0][0], runs[1][0]
    assert first_config["archetype"]["primary_type"] == "goal_iteration"  # no recursion
    assert "{{__goal_progress}}" in second_config["query_template"]
    assert runs[1][1]["__goal_remaining"] == "- supplier C"
    assert result.output["_goal"] == {"iterations": 2, "budget": 3, "done": True,
                                      "reason": "all compared", "remaining": []}
    assert "goal met after 2 of 3" in result.output_preview


def test_goal_loop_stops_at_its_budget(monkeypatch):
    from app.services.workflow_engine.step_runners import run_agent_or_goal_step

    runs = _patch(monkeypatch, [{"done": False, "remaining": ["more"]}] * 2)
    result = asyncio.run(run_agent_or_goal_step(_goal_step(goal_iterations=2), {"category": "x"}))
    assert len(runs) == 2 and result.output["_goal"]["done"] is False


def test_non_goal_agents_run_once(monkeypatch):
    from app.services.workflow_engine.step_runners import run_agent_or_goal_step

    runs = _patch(monkeypatch, [])
    step = WorkflowStep(id="s", type=StepType.AGENT, config={"agent_id": "a", "archetype": {"primary_type": "task"}})
    asyncio.run(run_agent_or_goal_step(step, {}))
    assert len(runs) == 1


@pytest.fixture
def kdb(monkeypatch, tmp_path):
    import app.knowledge.models  # noqa: F401
    import app.process.models  # noqa: F401
    from app.database import Base
    from app.knowledge import store
    from app.process import store as process_store

    engine = create_engine(f"sqlite:///{tmp_path / 'f.db'}", connect_args={"check_same_thread": False})
    Base.metadata.create_all(engine)
    Session = sessionmaker(bind=engine)
    monkeypatch.setattr(store, "SessionLocal", Session)
    monkeypatch.setattr(process_store, "SessionLocal", Session)
    return Session


def test_repeated_rollbacks_send_guidance_back_to_review(kdb):
    from app.knowledge import store

    item = store.create_item({"kind": "guidance", "category": "workflow_pattern", "title": "Split extraction",
                              "body": "Split extraction into one step per document.", "strength": "should"})
    assert store.record_outcome([item["id"]], accepted=True) == []
    assert store.record_outcome([item["id"]], accepted=False) == []
    assert store.record_outcome([item["id"]], accepted=False) == []
    assert store.record_outcome([item["id"]], accepted=False) == [item["id"]]
    flagged = store.get_item(item["id"])
    assert flagged["status"] == "proposed" and "rolled back" in flagged["rationale"]
    assert flagged["stats"] == {"used": 0, "accepted_builds": 1, "rolled_back_builds": 3}


def test_a_rolled_back_workflow_counts_against_its_guidance(kdb):
    from app.core.context import PipelineContext
    from app.core.specs import WorkflowSpec
    from app.knowledge import pipeline as guidance, retrieval, store
    from app.layers.knowledge_context_layer import KnowledgeContextLayer
    from app.layers.workflow import plan_control

    item = store.create_item({"kind": "guidance", "category": "archetype", "title": "t", "body": "b"})
    ctx = PipelineContext(query="q")
    ctx.workflow_spec = WorkflowSpec(goal="g")
    ctx.metadata[guidance.CONTEXT_KEY] = retrieval.build_pack([{**item, "applies": "true", "score": 1}], mode="auto")
    guidance.record_applied(ctx, "agent_archetype", [item["id"]], how="decided task")
    ctx.metadata[plan_control.ROLLED_BACK_KEY] = True
    KnowledgeContextLayer("workflow")._persist(ctx)
    assert store.get_item(item["id"])["stats"]["rolled_back_builds"] == 1


def test_feedback_route_lists_used_guidance(kdb):
    from fastapi.testclient import TestClient

    import app.main
    from app.knowledge import store

    item = store.create_item({"kind": "guidance", "category": "naming", "title": "n", "body": "b"})
    store.bump_stats([item["id"]], "used")
    body = TestClient(app.main.app).get("/api/knowledge/feedback").json()
    assert [i["id"] for i in body["items"]] == [item["id"]] and body["rollback_threshold"] == 3
