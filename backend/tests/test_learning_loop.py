"""Fixes that keep recurring are proposed as build guidance (never applied on their own)."""

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

import app.database as database
from app import learning


def _revision(code="dataflow.argument_shape", code_fix=False):
    rev = {"validation": {"resolved": [{"code": code, "message": "Step 'afford' lacks term_months"}]}, "plan": []}
    if code_fix:
        rev["plan"].append({"kind": "code", "status": "completed", "tool_name": "affordability",
                            "detail": "round() is not defined → compute without round()"})
    return rev


def test_signatures_from_a_revision():
    sigs = [s for s, _ in learning.signatures(_revision(code_fix=True))]
    assert sigs == ["dataflow.argument_shape", "activity.code_fix"]


def test_a_recurring_fix_is_proposed_once(monkeypatch, tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path / 'learn.db'}")
    learning.BuildLesson.__table__.create(engine)
    monkeypatch.setattr(database, "SessionLocal", sessionmaker(bind=engine))
    proposed = []

    def upsert(data, key=()):
        proposed.append(data)
        return {"id": 77}

    from app.knowledge import store

    monkeypatch.setattr(store, "upsert_item", upsert)
    assert learning.record_fix("w1", _revision()) == []
    assert learning.record_fix("w2", _revision()) == []
    assert learning.record_fix("w3", _revision()) == [77]
    assert learning.record_fix("w4", _revision()) == [], "proposed once"
    item = proposed[0]
    assert item["status"] == "proposed" and item["kind"] == "guidance" and item["audience"] == "builder"
    assert "w3" in item["body"] and "parameter shapes" in item["title"]


def test_benchmark_scoring_reads_a_finished_plan():
    from types import SimpleNamespace

    from app.core.context import PipelineContext
    from app.core.events import SSEEvent
    from app.core.specs import WorkflowSpec
    from evals.planner_benchmark import GOALS, score

    ctx = PipelineContext(workflow_spec=WorkflowSpec(goal="g"))
    ctx.workflow_spec.definition = SimpleNamespace(steps=[1, 2, 3])
    ctx.metadata.update({"dry_run": {"passed": True, "scenarios": [{"name": "s", "passed": True}],
                                     "rounds": [{"round": 0, "repair": {"applied": True}}]},
                         "_rewind_count": 1})
    ctx.events.append(SSEEvent(event="sublayer", data={"id": "repair_1", "parent": "data_flow"}))
    result = score(ctx)
    assert result["valid"] and result["dry_run"] and result["steps"] == 3
    assert (result["rewinds"], result["repairs"], result["self_repairs"]) == (1, 1, 1)
    assert result["contract"] is False
    assert len(GOALS) >= 5
