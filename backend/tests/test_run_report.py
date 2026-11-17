"""The planning report: layer timings, decisions and waits, calls — from the event log."""

import asyncio
import json

from app.runs.manager import LiveRun
from app.runs.report import build_report

T0 = 1_700_000_000_000  # ms


def _ev(seq, event, data, at):
    return (seq, event, json.dumps(data) if not isinstance(data, str) else data, T0 + at)


SUMMARY = {"id": "r1", "kind": "workflow_plan", "title": "Assess a claim", "status": "completed",
           "created_at": "2023-11-14T22:13:20Z", "finished_at": "2023-11-14T22:14:20Z"}
# 2023-11-14T22:13:20Z is T0; the run took 60 s.

EVENTS = [
    _ev(1, "pipeline", {"layers": [
        {"name": "design", "label": "Design", "children": [
            {"name": "decompose", "label": "Decompose"},
            {"name": "wire", "label": "Wire data"},
        ]},
        {"name": "dry_run", "label": "Dry run"},
        {"name": "internal", "label": "x", "hidden": True},
    ]}, 0),
    _ev(2, "layer", {"name": "decompose", "state": "active"}, 1000),
    _ev(3, "step", {"id": 1, "kind": "model", "name": "mistral-medium-2604", "state": "active"}, 1100),
    _ev(4, "step", {"id": 1, "state": "completed", "ms": 4000}, 5100),
    _ev(5, "layer", {"name": "decompose", "state": "completed", "ms": 5000, "summary": "6 steps"}, 6000),
    _ev(6, "decision_required", {"id": "d1", "kind": "review_workflow", "title": "Review the plan",
                                 "options": ["accept", "revise"], "recommended": "accept"}, 6500),
    _ev(7, "decision_extended", {"id": "d1"}, 10000),
    _ev(8, "decision_made", {"id": "d1", "choice": "accept", "by": "user"}, 26500),
    _ev(9, "layer", {"name": "wire", "state": "active"}, 27000),
    _ev(10, "sublayer", {"parent": "wire", "id": "check", "label": "Check", "state": "failed",
                         "error": "bad ref"}, 28000),
    _ev(11, "rewind", {"to": "decompose", "from": "wire", "round": 1, "reason": "bad ref"}, 29000),
    _ev(12, "step", {"id": 2, "kind": "tool", "name": "lookup", "state": "active"}, 30000),
    _ev(13, "step", {"id": 2, "state": "failed", "ms": 200, "error": "timeout"}, 30200),
    _ev(14, "layer", {"name": "wire", "state": "completed", "ms": 9000}, 36000),
    _ev(15, "layer", {"name": "dry_run", "state": "failed", "ms": 20000, "error": "0/3 passed"}, 58000),
    _ev(16, "error", "Dry run failed", 59000),
]


def test_layers_have_times_offsets_and_outcomes():
    r = build_report(SUMMARY, EVENTS)
    assert r["timed"] is True
    assert r["duration_ms"] == 60_000
    names = [l["name"] for l in r["layers"]]
    assert names == ["design", "decompose", "wire", "dry_run"]   # hidden layer left out
    design = r["layers"][0]
    assert design["stage"] is True
    decompose = r["layers"][1]
    assert decompose["parent"] == "design" and decompose["depth"] == 1
    assert decompose["offset_ms"] == 1000 and decompose["ms"] == 5000
    assert decompose["summary"] == "6 steps"
    wire = r["layers"][2]
    assert wire["subs"][0]["error"] == "bad ref"
    assert r["layers"][3]["state"] == "failed" and r["layers"][3]["error"] == "0/3 passed"
    assert r["layer_counts"] == {"total": 3, "completed": 2, "failed": 1, "skipped": 0}


def test_decisions_record_the_wait():
    r = build_report(SUMMARY, EVENTS)
    d = r["decisions"][0]
    assert d["title"] == "Review the plan"
    assert d["choice"] == "accept" and d["by"] == "user"
    assert d["waited_ms"] == 20_000 and d["extended"] == 1 and d["offset_ms"] == 6500
    assert r["waiting_ms"] == 20_000 and r["working_ms"] == 40_000


def test_calls_rewinds_and_errors():
    r = build_report(SUMMARY, EVENTS)
    calls = {c["kind"]: c for c in r["calls"]}
    assert calls["model"] == {"kind": "model", "count": 1, "ms": 4000, "failed": 0}
    assert calls["tool"]["failed"] == 1
    assert r["models"][0]["name"] == "mistral-medium-2604"
    assert r["rewinds"][0]["to"] == "decompose" and r["rewinds"][0]["at"] == T0 + 29000
    assert r["errors"][0]["message"] == "Dry run failed"


def test_old_runs_without_times_still_report_durations():
    untimed = [(e[0], e[1], e[2], None) for e in EVENTS]
    r = build_report(SUMMARY, untimed)
    assert r["timed"] is False
    assert r["layers"][1]["ms"] == 5000 and r["layers"][1]["offset_ms"] is None
    assert r["decisions"][0]["waited_ms"] is None
    assert r["duration_ms"] == 60_000      # from the run's own start and finish


def test_live_run_stamps_every_event():
    async def go():
        run = LiveRun(id="x", kind="agent", title="t", request={})
        seq = run.emit("layer", {"name": "a", "state": "active"})
        return run, seq

    run, seq = asyncio.run(go())
    assert isinstance(run.times[seq], int) and run.times[seq] > T0


def test_report_route_is_open_to_signed_in_users():
    from app.auth import permissions

    rule = permissions.match("GET", "/runs/abc/report")
    assert rule is not None and rule.access == permissions.USER


def test_store_keeps_times_and_migrates_old_databases(monkeypatch):
    import os
    import tempfile

    from sqlalchemy import create_engine, inspect, text
    from sqlalchemy.orm import sessionmaker

    from app.runs import store

    path = os.path.join(tempfile.mkdtemp(prefix="runs_"), "r.db")
    eng = create_engine(f"sqlite:///{path}", connect_args={"check_same_thread": False})
    # A database from before the column existed.
    with eng.begin() as conn:
        conn.execute(text("CREATE TABLE pipeline_run_events (id INTEGER PRIMARY KEY, run_id VARCHAR,"
                          " seq INTEGER, event VARCHAR, data TEXT)"))
    monkeypatch.setattr(store, "SessionLocal", sessionmaker(bind=eng))

    store.ensure_schema()
    assert "at" in {c["name"] for c in inspect(eng).get_columns("pipeline_run_events")}
    store.ensure_schema()  # idempotent

    store.write_batch("r1", [(1, "layer", "{}", T0), (2, "log", "x")], {})
    assert store.events_with_times("r1") == [(1, "layer", "{}", T0), (2, "log", "x", None)]
