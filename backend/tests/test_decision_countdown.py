"""A run's question counts down; with no answer the recommended choice is taken."""

import asyncio
import time
from datetime import datetime

from app.runs.manager import LiveRun


def _events(run, name):
    import json

    return [json.loads(p) for _, e, p in run.events if e == name]


def test_no_answer_takes_the_recommended_choice():
    run = LiveRun(id="r1", kind="workflow_plan", title="t", request={})
    answer = asyncio.run(run.ask("review_workflow", {"title": "Review"}, options=["accept", "rollback"],
                                 default="accept", timeout=0.2))
    assert answer == {"choice": "accept"}
    asked = _events(run, "decision_required")[0]
    assert asked["recommended"] == "accept" and asked["timeout_s"] == 0
    assert datetime.fromisoformat(asked["deadline"].replace("Z", "+00:00"))
    assert _events(run, "decision_made")[0]["by"] == "timeout"


def test_keep_waiting_moves_the_deadline_and_an_answer_still_wins():
    run = LiveRun(id="r2", kind="workflow_plan", title="t", request={})

    async def scenario():
        task = asyncio.create_task(run.ask("build_failed", {}, options=["retry", "manual"],
                                           default="manual", timeout=0.5))
        await asyncio.sleep(0.05)
        decision_id = _events(run, "decision_required")[0]["id"]
        before = time.time()
        deadline, error = run.extend(decision_id, 60)
        assert error is None
        assert datetime.fromisoformat(deadline.replace("Z", "+00:00")).timestamp() > before + 30
        await asyncio.sleep(0.6)  # past the original deadline: still waiting
        assert not task.done()
        assert run.answer(decision_id, "retry") is None
        return await task

    assert asyncio.run(scenario())["choice"] == "retry"
    assert _events(run, "decision_made")[0]["by"] == "user"
    assert _events(run, "decision_extended")
