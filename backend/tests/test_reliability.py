"""Queues, background tasks, run history and orphan recovery. No network."""

import asyncio
import json
import os
import tempfile
from datetime import datetime, timezone

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.auth.context import use_workspace
from app.core import runtime


# ── Runtime ─────────────────────────────────────────────────────────────────

def test_thread_count_is_sized_for_io(monkeypatch):
    monkeypatch.delenv("WORKER_THREADS", raising=False)
    assert runtime.thread_count() >= 32
    monkeypatch.setenv("WORKER_THREADS", "100")
    assert runtime.thread_count() == 100


def test_spawned_tasks_are_held_until_done():
    async def main():
        done = asyncio.Event()

        async def job():
            await asyncio.sleep(0.01)
            done.set()

        task = runtime.spawn(job(), name="t")
        assert task in runtime.background_tasks()
        await asyncio.wait_for(done.wait(), 1)
        await asyncio.sleep(0)
        assert task not in runtime.background_tasks()

    asyncio.run(main())


def test_key_gates_are_fifo_and_separate_per_key():
    async def main():
        order: list[str] = []
        gate_a = runtime.key_gate("t", 1, key_id="a")
        gate_b = runtime.key_gate("t", 1, key_id="b")
        assert gate_a is not gate_b
        assert runtime.key_gate("t", 1, key_id="a") is gate_a

        async def use(gate, name, hold=0.02):
            async with gate:
                order.append(name)
                await asyncio.sleep(hold)

        # Three on key a queue in arrival order; key b is not held up by them.
        tasks = [asyncio.create_task(use(gate_a, f"a{i}")) for i in range(3)]
        await asyncio.sleep(0)
        tasks.append(asyncio.create_task(use(gate_b, "b0", hold=0)))
        await asyncio.gather(*tasks)
        assert [o for o in order if o.startswith("a")] == ["a0", "a1", "a2"]
        assert order.index("b0") < order.index("a1")

    asyncio.run(main())


# ── Run admission ───────────────────────────────────────────────────────────

class _Store:
    def create_run(self, *a, **k): pass
    def write_batch(self, *a, **k): pass
    def events_after(self, *a, **k): return []
    def get_run(self, *a, **k): return None
    def list_runs(self, *a, **k): return []


@pytest.fixture
def manager(monkeypatch):
    from app.config import settings
    from app.runs import manager as mod

    monkeypatch.setattr(mod, "store", _Store())
    monkeypatch.setattr(settings, "RUN_CONCURRENCY", 1)
    return mod.RunManager()


def test_runs_beyond_the_limit_wait_in_line_and_say_so(manager):
    from app.runs.manager import RunOutcome

    async def main():
        started: list[str] = []
        release = asyncio.Event()

        def runner(name):
            async def go(run):
                started.append(name)
                await release.wait()
                return RunOutcome()
            return go

        with use_workspace("ws-1"):
            r1 = await manager.start("agent", "one", {}, runner("one"))
            await asyncio.sleep(0.05)
            r2 = await manager.start("agent", "two", {}, runner("two"))
            r3 = await manager.start("agent", "three", {}, runner("three"))
        with use_workspace("ws-2"):
            other = await manager.start("agent", "elsewhere", {}, runner("elsewhere"))
        await asyncio.sleep(2.3)
        # One slot in ws-1: only the first runs; ws-2 has its own line.
        assert started == ["one", "elsewhere"]
        statuses = [d for _s, e, d in r3.events if e == "status"]
        assert any("1 ahead of you" in s for s in statuses)
        release.set()
        await asyncio.gather(r1.task, r2.task, r3.task, other.task)
        assert started[2:] == ["two", "three"]                 # in arrival order

    asyncio.run(main())


def test_cancelling_a_waiting_run_frees_its_place(manager):
    from app.runs.manager import RunOutcome

    async def main():
        release = asyncio.Event()
        ran: list[str] = []

        def runner(name):
            async def go(run):
                ran.append(name)
                await release.wait()
                return RunOutcome()
            return go

        with use_workspace("ws-c"):
            first = await manager.start("agent", "a", {}, runner("a"))
            await asyncio.sleep(0.05)
            waiting = await manager.start("agent", "b", {}, runner("b"))
            last = await manager.start("agent", "c", {}, runner("c"))
        await asyncio.sleep(0.1)
        await manager.cancel(waiting.id)
        await asyncio.sleep(0.05)
        assert waiting.status == "cancelled"
        release.set()
        await asyncio.gather(first.task, last.task, return_exceptions=True)
        assert ran == ["a", "c"]

    asyncio.run(main())


# ── Local execution history ─────────────────────────────────────────────────

@pytest.fixture
def history_db(monkeypatch):
    import app.services.workflow_engine.reviews  # noqa: F401
    from app.database import Base
    from app.services.workflow_engine import run_history

    path = os.path.join(tempfile.mkdtemp(prefix="hist_"), "h.db")
    eng = create_engine(f"sqlite:///{path}", connect_args={"check_same_thread": False})
    Base.metadata.create_all(eng)
    Session = sessionmaker(bind=eng)
    monkeypatch.setattr(run_history, "SessionLocal", Session)
    return Session


def _run(exec_id, status):
    from app.services.workflow_engine.models import WorkflowRun, WorkflowStatus

    return WorkflowRun(execution_id=exec_id, workflow_name="wf", status=WorkflowStatus(status),
                       start_time=datetime.now(timezone.utc))


def test_history_survives_and_restart_closes_orphans(history_db):
    from app.services.workflow_engine import run_history
    from app.services.workflow_engine.reviews import HumanReview

    run_history.save(_run("done-1", "COMPLETED"))
    run_history.save(_run("open-1", "RUNNING"))
    with history_db() as db:
        db.add(HumanReview(execution_id="open-1", step_id="s", engine="local", status="pending"))
        db.commit()

    out = run_history.interrupt_orphans()
    assert out == {"executions": 1, "reviews": 1}
    assert run_history.load("done-1").status.value == "COMPLETED"
    closed = run_history.load("open-1")
    assert closed.status.value == "TERMINATED" and closed.result["interrupted"] is True
    with history_db() as db:
        assert db.query(HumanReview).one().status == "timed_out"
    assert {r.execution_id for r in run_history.recent("wf")} == {"done-1", "open-1"}


def test_shutdown_closes_live_runs(history_db):
    from app.services.workflow_engine import run_history

    live = [_run("live-1", "RUNNING"), _run("live-2", "COMPLETED")]
    assert run_history.interrupt_live(live, "shutting down") == 1
    assert run_history.load("live-1").status.value == "TERMINATED"


# ── Unfinished plans ────────────────────────────────────────────────────────

def test_unfinished_plan_reclaims_only_what_nothing_uses(monkeypatch):
    from app.core.context import PipelineContext
    from app.layers.workflow import plan_control

    removed: list[str] = []

    async def fake_remove(ctx, item):
        removed.append(item["id"])
        return "deleted"

    monkeypatch.setattr(plan_control, "_remove", fake_remove)
    monkeypatch.setattr(plan_control, "_in_use", lambda items: {"ag_shared"})

    async def main():
        ctx = PipelineContext(query="x")
        plan_control.record_created(ctx, "agent", "ag_new", "New agent")
        plan_control.record_created(ctx, "agent", "ag_shared", "Shared agent")
        plan_control.record_created(ctx, "activity", "42", "fetch_rates")
        assert [e.event for e in ctx.events].count("plan_item_created") == 3
        report = await plan_control.reclaim_unused(ctx, "cancelled")
        assert {r["id"] for r in report} == {"ag_new", "42"}

        saved = PipelineContext(query="y")
        plan_control.record_created(saved, "agent", "ag_kept", "Kept")
        plan_control.record_created(saved, "workflow", "wf", "wf")
        assert await plan_control.reclaim_unused(saved, "failed") == []

    asyncio.run(main())
    assert sorted(removed) == ["42", "ag_new"]


def test_restart_recovery_reads_the_event_log(monkeypatch):
    from app.runs import recovery, store

    events = [
        (1, "plan_item_created", json.dumps({"kind": "agent", "id": "ag1", "name": "A"})),
        (2, "plan_item_created", json.dumps({"kind": "activity", "id": "7", "name": "t"})),
        (3, "plan_rolled_back", json.dumps({"items": [{"kind": "activity", "id": "7",
                                                      "removed": True}]})),
    ]
    monkeypatch.setattr(store, "events_after", lambda run_id, after=0: events)
    assert recovery._items_of("r1") == [{"kind": "agent", "id": "ag1", "name": "A"}]
