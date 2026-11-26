"""Live step progress for Mistral runs comes from workflow events, not the trace.

The trace lands when the run ends, so a run page fed only by it shows nothing
until then. These tests pin the event folding and how the trace is merged in.
"""

import asyncio

from app.services.workflow_engine import executions as ex

WF = "claims-flow"
NS = 1_000_000  # nanoseconds per millisecond
T0 = 1_700_000_000_000  # a real epoch time, in ms


def _ev(kind, ts_ms, task, activity, **attrs):
    return {"event_type": kind, "event_timestamp": (T0 + ts_ms) * NS, "workflow_name": WF,
            "attributes": {"task_id": task, "activity_name": activity, **attrs}}


def test_step_id_follows_the_compiler_naming():
    assert ex.step_id_for_activity("run_claims_flow_extract", WF) == "extract"
    assert ex.step_id_for_activity("something_else", WF) is None


def test_running_step_shows_before_the_run_ends():
    events = [
        _ev("ACTIVITY_TASK_STARTED", 1000, "1", "run_claims_flow_extract", input={"value": {"claim": 1}}),
        _ev("ACTIVITY_TASK_COMPLETED", 1500, "1", "run_claims_flow_extract", result={"value": {"amount": 5}}),
        _ev("ACTIVITY_TASK_STARTED", 1600, "2", "run_claims_flow_score"),
    ]
    steps, failure = ex.steps_from_workflow_events(events, WF)
    assert failure is None
    assert [(s.attributes["app.step.id"], s.status) for s in steps] == [
        ("extract", "COMPLETED"), ("score", "RUNNING")]
    assert steps[0].duration_ms == 500
    assert '"amount": 5' in steps[0].output_preview
    assert '"claim": 1' in steps[0].input_preview
    assert steps[1].start_time_ms == T0 + 1600


def test_retry_and_final_failure_carry_the_error():
    events = [
        _ev("ACTIVITY_TASK_STARTED", 1000, "7", "run_claims_flow_pay"),
        _ev("ACTIVITY_TASK_RETRYING", 1100, "7", "run_claims_flow_pay", attempt=1,
            failure={"message": "timeout calling bank"}),
    ]
    steps, _ = ex.steps_from_workflow_events(events, WF)
    assert steps[0].status == "RETRYING_AFTER_ERROR"
    assert steps[0].error == "timeout calling bank"

    events.append(_ev("ACTIVITY_TASK_FAILED", 1900, "7", "run_claims_flow_pay", attempt=3,
                      failure={"message": "ValueError: account closed"}))
    events.append({"event_type": "WORKFLOW_EXECUTION_FAILED", "event_timestamp": (T0 + 2000) * NS,
                   "attributes": {"failure": {"message": "Activity task failed"}}})
    steps, failure = ex.steps_from_workflow_events(events, WF)
    assert steps[0].status == "FAILED"
    assert steps[0].error == "ValueError: account closed"
    assert steps[0].attributes["attempt"] == 3
    assert failure == "Activity task failed"


def test_trace_only_fills_in_and_never_duplicates():
    live, _ = ex.steps_from_workflow_events(
        [_ev("ACTIVITY_TASK_STARTED", 1000, "1", "run_claims_flow_extract")], WF)
    trace = [
        ex.ExecutionStep(id="t1", name="run_claims_flow_extract", status="COMPLETED",
                         input_preview="from trace", attributes={"gen_ai.model": "m"}),
        ex.ExecutionStep(id="t2", name="unrelated span", status="COMPLETED"),
    ]
    merged = ex._merge_trace_detail(live, trace)
    assert len(merged) == 1
    assert merged[0].status == "RUNNING"          # events decide the state
    assert merged[0].input_preview == "from trace"
    assert merged[0].attributes["gen_ai.model"] == "m"
    # No events (e.g. an older run): the trace is used as before.
    assert ex._merge_trace_detail([], trace) == trace


def test_fetch_execution_uses_events_while_running(monkeypatch):
    async def mistral(_id):
        return ex.ExecutionDetail(execution_id="e1", workflow_name=WF, status="RUNNING")

    async def events(_id):
        return [_ev("ACTIVITY_TASK_STARTED", 1000, "1", "run_claims_flow_extract")]

    async def trace(_id, include_internal=False):
        return []  # the trace has not landed yet

    monkeypatch.setattr(ex, "_mistral_execution", mistral)
    monkeypatch.setattr(ex, "fetch_workflow_events", events)
    monkeypatch.setattr(ex, "fetch_progress_steps", trace)
    detail = asyncio.run(ex.fetch_execution("e1"))
    assert [s.status for s in detail.steps] == ["RUNNING"]
    assert detail.steps[0].attributes["app.step.id"] == "extract"


def _hist(event_id, kind, ts, **attrs):
    key = "".join(p.capitalize() for p in kind.lower().split("_"))
    key = key[0].lower() + key[1:] + "EventAttributes"
    return {"eventId": str(event_id), "eventType": f"EVENT_TYPE_{kind}",
            "eventTime": f"2026-11-25T10:39:{ts:02d}.052196082Z", key: attrs}


_SCHEMA_MISMATCH = ("credit: the arguments do not match the activity's input schema "
                    "— id: 'MJ9' is not of type 'object'")
# The em dash as it came back from a real run: decoded as Latin-1, then cp1252.
_GARBLED = _SCHEMA_MISMATCH.encode("utf-8").decode("latin-1").encode("utf-8").decode("cp1252")


def _failed_history():
    act = "run_claims_flow_credit"
    return {"events": [
        _hist(1, "WORKFLOW_EXECUTION_STARTED", 1),
        _hist(5, "ACTIVITY_TASK_SCHEDULED", 2, activityType={"name": "run_claims_flow_extract"},
              input={"payloads": [{"claim": 1}]}),
        _hist(6, "ACTIVITY_TASK_STARTED", 3, scheduledEventId="5", attempt=1),
        _hist(7, "ACTIVITY_TASK_COMPLETED", 4, scheduledEventId="5", result={"payloads": [{"amount": 5}]}),
        _hist(8, "ACTIVITY_TASK_SCHEDULED", 5, activityType={"name": act}),
        _hist(9, "ACTIVITY_TASK_STARTED", 8, scheduledEventId="8", attempt=3,
              lastFailure={"message": _GARBLED}),
        _hist(10, "ACTIVITY_TASK_FAILED", 9, scheduledEventId="8", failure={"message": _GARBLED}),
        _hist(11, "WORKFLOW_EXECUTION_FAILED", 10,
              failure={"message": "Activity task failed", "cause": {"message": _GARBLED}}),
    ]}


def test_history_gives_the_steps_and_the_real_error():
    steps, failure = ex.steps_from_history(_failed_history(), WF)
    assert [(s.attributes["app.step.id"], s.status) for s in steps] == [
        ("extract", "COMPLETED"), ("credit", "FAILED")]
    assert '"amount": 5' in steps[0].output_preview
    assert '"claim": 1' in steps[0].input_preview
    assert steps[0].duration_ms == 1000
    assert steps[1].attributes["attempt"] == 3
    assert steps[1].error == _SCHEMA_MISMATCH          # dash repaired
    assert failure == _SCHEMA_MISMATCH                 # the cause, not "Activity task failed"


def test_fetch_execution_falls_back_to_history(monkeypatch):
    async def mistral(_id):
        return ex.ExecutionDetail(execution_id="e1", workflow_name=WF, status="FAILED")

    async def events(_id):  # only the workflow's own, generic, failure
        return [{"event_type": "WORKFLOW_EXECUTION_FAILED", "event_timestamp": T0 * NS,
                 "attributes": {"failure": {"message": "Activity task failed"}}}]

    async def trace(_id, include_internal=False):
        return []

    async def history(_id, decode_payloads=True):
        return _failed_history()

    monkeypatch.setattr(ex, "_mistral_execution", mistral)
    monkeypatch.setattr(ex, "fetch_workflow_events", events)
    monkeypatch.setattr(ex, "fetch_progress_steps", trace)
    monkeypatch.setattr(ex, "fetch_history", history)
    detail = asyncio.run(ex.fetch_execution("e1"))
    assert [s.status for s in detail.steps] == ["COMPLETED", "FAILED"]
    assert detail.error == _SCHEMA_MISMATCH


def test_generic_failure_gives_way_to_the_step_error(monkeypatch):
    async def mistral(_id):
        return ex.ExecutionDetail(execution_id="e1", workflow_name=WF, status="FAILED")

    async def events(_id):
        return [_ev("ACTIVITY_TASK_FAILED", 1000, "1", "run_claims_flow_pay",
                    failure={"message": "account closed"}),
                {"event_type": "EVENT_TYPE_WORKFLOW_EXECUTION_FAILED", "event_timestamp": T0 * NS,
                 "attributes": {"failure": {"message": "Activity task failed"}}}]

    async def trace(_id, include_internal=False):
        return []

    monkeypatch.setattr(ex, "_mistral_execution", mistral)
    monkeypatch.setattr(ex, "fetch_workflow_events", events)
    monkeypatch.setattr(ex, "fetch_progress_steps", trace)
    detail = asyncio.run(ex.fetch_execution("e1"))
    assert detail.error == "account closed"


def test_repair_text_leaves_clean_text_alone():
    assert ex.repair_text("plain — text, café") == "plain — text, café"
    assert ex.repair_text(_GARBLED) == _SCHEMA_MISMATCH
    assert ex.repair_text(None) is None


def test_event_timestamps_in_any_unit():
    assert ex._event_ms(1_700_000_000_000_000_000) == 1_700_000_000_000
    assert ex._event_ms(1_700_000_000_000) == 1_700_000_000_000
    assert ex._event_ms(1_700_000_000) == 1_700_000_000_000
    assert ex._event_ms("x") is None
