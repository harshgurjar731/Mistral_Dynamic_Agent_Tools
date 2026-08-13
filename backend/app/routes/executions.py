"""
Workflow Execution Routes.

A thin HTTP surface over ``services.workflow_engine.executions``, mirroring the
Mistral Workflow Executions API so the frontend can be written against the
documented contract:

    https://docs.mistral.ai/api/endpoint/workflows/executions

Route order matters here. ``/workflows/executions/cancel`` (batch) has to be
declared before ``/workflows/executions/{execution_id}`` or FastAPI matches the
literal path as an execution id.
"""

import asyncio
import json
import logging
from datetime import datetime
from typing import Any, Optional

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from app.services.workflow_engine import executions as exec_service
from app.services.workflow_engine.executions import ExecutionDetail

logger = logging.getLogger(__name__)

router = APIRouter(tags=["Workflow Executions"])


def _sse(event: str, data: Any) -> str:
    """Frame a payload as an SSE message.

    Newlines inside the JSON have to become separate ``data:`` lines or the
    frame terminates early and the client sees truncated JSON.
    """
    payload = data if isinstance(data, str) else json.dumps(data, default=str)
    payload = payload.replace("\n", "\ndata: ")
    return f"event: {event}\ndata: {payload}\n\n"


def _http_error(e: Exception, what: str) -> HTTPException:
    """Map an SDK failure onto a status the UI can act on."""
    text = str(e)
    lowered = text.lower()
    if "404" in text or "not found" in lowered:
        return HTTPException(status_code=404, detail=f"{what} not found.")
    if "409" in text or "already" in lowered:
        return HTTPException(status_code=409, detail=text)
    return HTTPException(status_code=502, detail=f"{what} failed: {text}")


# ── Request bodies ────────────────────────────────────────────────────────────

class InvocationRequest(BaseModel):
    """Body shared by signals, queries and updates.

    ``signal_name``/``payload`` are accepted as aliases because the previous
    version of this API used them; keeping them avoids breaking any client that
    has not been updated.
    """
    name: Optional[str] = None
    input: dict = Field(default_factory=dict)
    signal_name: Optional[str] = None
    payload: Optional[dict] = None

    def resolved_name(self, default: Optional[str] = None) -> str:
        name = self.name or self.signal_name or default
        if not name:
            raise HTTPException(status_code=422, detail="A handler 'name' is required.")
        return name

    def resolved_input(self) -> dict:
        return self.input or self.payload or {}


class ResetRequest(BaseModel):
    event_id: int
    reason: Optional[str] = None
    exclude_signals: bool = False
    exclude_updates: bool = False


class BatchRequest(BaseModel):
    execution_ids: list[str] = Field(default_factory=list)


# ── Listing ───────────────────────────────────────────────────────────────────

@router.get("/workflows/executions")
async def list_executions(
    workflow_identifier: Optional[str] = Query(None, description="Filter to one workflow"),
    status: Optional[str] = Query(None, description="RUNNING, COMPLETED, FAILED, …"),
    search: Optional[str] = Query(None),
    user_id: Optional[str] = Query(None),
    page_size: int = Query(50, ge=1, le=200),
    next_page_token: Optional[str] = Query(None),
):
    """List executions across all workflows, merged with local DAG-engine runs."""
    return await exec_service.list_runs(
        workflow_identifier=workflow_identifier,
        status=status,
        search=search,
        user_id=user_id,
        page_size=page_size,
        next_page_token=next_page_token,
    )


# ── Batch control (must precede /{execution_id}) ──────────────────────────────

@router.post("/workflows/executions/cancel")
async def batch_cancel_executions(request: BatchRequest):
    """Gracefully cancel several executions in one call."""
    if not request.execution_ids:
        raise HTTPException(status_code=422, detail="execution_ids must not be empty.")
    try:
        return await exec_service.batch_cancel(request.execution_ids)
    except Exception as e:
        raise _http_error(e, "Batch cancel")


@router.post("/workflows/executions/terminate")
async def batch_terminate_executions(request: BatchRequest):
    """Hard-stop several executions in one call."""
    if not request.execution_ids:
        raise HTTPException(status_code=422, detail="execution_ids must not be empty.")
    try:
        return await exec_service.batch_terminate(request.execution_ids)
    except Exception as e:
        raise _http_error(e, "Batch terminate")


# ── Single execution ──────────────────────────────────────────────────────────

@router.get("/workflows/executions/{execution_id}", response_model=ExecutionDetail)
async def get_execution(
    execution_id: str,
    with_steps: bool = Query(True, description="Include per-step trace progress"),
):
    """Execution detail, from Mistral if it lives there and locally otherwise."""
    detail = await exec_service.fetch_execution(execution_id, with_steps=with_steps)
    if not detail:
        raise HTTPException(status_code=404, detail=f"Execution '{execution_id}' not found")
    return detail


@router.get("/workflows/executions/{execution_id}/steps")
async def get_execution_steps(
    execution_id: str,
    include_internal: bool = Query(False),
):
    """Per-step progress only — cheaper than the full detail for polling."""
    steps = await exec_service.fetch_progress_steps(execution_id, include_internal)
    if not steps:
        # No trace events yet, or a local run that has none at all. Falling back
        # to the full detail also tells us whether the execution exists, so an
        # unknown id 404s instead of looking like a run with no steps.
        detail = await exec_service.fetch_execution(execution_id)
        if not detail:
            raise HTTPException(status_code=404, detail=f"Execution '{execution_id}' not found")
        steps = detail.steps
    return {"execution_id": execution_id, "steps": [s.model_dump() for s in steps]}


@router.get("/workflows/executions/{execution_id}/history")
async def get_execution_history(
    execution_id: str,
    decode_payloads: bool = Query(True),
):
    """Raw event history — the source of the ``event_id`` a reset targets."""
    try:
        return {"execution_id": execution_id,
                "history": await exec_service.fetch_history(execution_id, decode_payloads)}
    except Exception as e:
        raise _http_error(e, "Execution history")


# ── Trace / observability ─────────────────────────────────────────────────────

@router.get("/workflows/executions/{execution_id}/trace/info")
async def get_trace_info(execution_id: str):
    """Whether trace data has been collected for this execution."""
    try:
        return await exec_service.fetch_trace_info(execution_id)
    except Exception as e:
        # Absence of a trace is a normal state, not a failure.
        logger.debug("Trace info unavailable for %s: %s", execution_id, e)
        return {"execution_id": execution_id, "available": False, "detail": str(e)}


@router.get("/workflows/executions/{execution_id}/trace/summary")
async def get_trace_summary(execution_id: str):
    """Hierarchical span tree — what ran, nested, with durations."""
    try:
        return await exec_service.fetch_trace_summary(execution_id)
    except Exception as e:
        raise _http_error(e, "Trace summary")


@router.get("/workflows/executions/{execution_id}/trace/events")
async def get_trace_events(
    execution_id: str,
    merge_same_id_events: bool = Query(True),
    include_internal_events: bool = Query(False),
):
    """Flat trace event list, including the per-step progress lifecycle."""
    try:
        return await exec_service.fetch_trace_events(
            execution_id, merge_same_id_events, include_internal_events
        )
    except Exception as e:
        raise _http_error(e, "Trace events")


@router.get("/workflows/executions/{execution_id}/trace/otel")
async def get_trace_otel(execution_id: str):
    """OpenTelemetry trace payload, for export into an APM tool."""
    try:
        return await exec_service.fetch_trace_otel(execution_id)
    except Exception as e:
        raise _http_error(e, "OTel trace")


@router.get("/workflows/executions/{execution_id}/logs")
async def get_execution_logs(
    execution_id: str,
    limit: int = Query(500, ge=1, le=5000),
    since: int = Query(0, ge=0, description="Return only lines with seq >= this"),
):
    """Execution logs — the engine's own narration plus any platform logs.

    ``since`` makes this pollable: pass back the ``next_seq`` from the previous
    response to fetch only what is new.
    """
    try:
        return await exec_service.fetch_logs(execution_id, limit, since)
    except Exception as e:
        logger.debug("Logs unavailable for %s: %s", execution_id, e)
        return {"execution_id": execution_id, "logs": [], "platform_logs": [],
                "next_seq": since, "source": "none", "detail": str(e)}


# ── Live stream ───────────────────────────────────────────────────────────────

@router.get("/workflows/executions/{execution_id}/stream")
async def stream_execution(execution_id: str):
    """SSE stream of status, step progress and workflow-published events.

    Event names: ``execution_update``, ``workflow_event``, ``ping``, ``error``,
    ``done``. The client should treat ``done`` as the close signal.
    """
    async def _generate():
        try:
            async for event_name, payload in exec_service.stream_execution(execution_id):
                yield _sse(event_name, payload)
        except asyncio.CancelledError:
            raise
        except Exception as e:
            logger.error("Execution stream for %s failed: %s", execution_id, e, exc_info=True)
            yield _sse("error", {"execution_id": execution_id, "detail": str(e)})
            yield _sse("done", {"execution_id": execution_id, "status": "FAILED"})

    return StreamingResponse(
        _generate(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
            "Connection": "keep-alive",
        },
    )


# ── Control ───────────────────────────────────────────────────────────────────

@router.post("/workflows/executions/{execution_id}/signals")
async def signal_execution(execution_id: str, request: InvocationRequest):
    """Deliver a signal to a running execution (fire and forget)."""
    # Signals default to the conversational handler the execution console uses,
    # so a chat message needs no handler name.
    return await exec_service.send_signal(
        execution_id, request.resolved_name("user_message"), request.resolved_input()
    )


# Retained so older clients posting to /signal keep working.
@router.post("/workflows/executions/{execution_id}/signal", include_in_schema=False)
async def signal_execution_legacy(execution_id: str, request: InvocationRequest):
    return await signal_execution(execution_id, request)


@router.post("/workflows/executions/{execution_id}/queries")
async def query_execution(execution_id: str, request: InvocationRequest):
    """Read state out of a running execution via a query handler."""
    try:
        return await exec_service.send_query(
            execution_id, request.resolved_name(), request.resolved_input()
        )
    except Exception as e:
        raise _http_error(e, f"Query '{request.resolved_name()}'")


@router.post("/workflows/executions/{execution_id}/updates")
async def update_execution(execution_id: str, request: InvocationRequest):
    """Send an update — a signal that returns a value once the handler runs."""
    try:
        return await exec_service.send_update(
            execution_id, request.resolved_name(), request.resolved_input()
        )
    except Exception as e:
        raise _http_error(e, f"Update '{request.resolved_name()}'")


@router.post("/workflows/executions/{execution_id}/cancel")
async def cancel_execution(execution_id: str):
    """Graceful cancel — cleanup handlers still run."""
    try:
        return await exec_service.cancel(execution_id)
    except Exception as e:
        raise _http_error(e, "Cancel")


@router.post("/workflows/executions/{execution_id}/terminate")
async def terminate_execution(execution_id: str):
    """Hard stop — no cleanup."""
    try:
        return await exec_service.terminate(execution_id)
    except Exception as e:
        raise _http_error(e, "Terminate")


@router.post("/workflows/executions/{execution_id}/reset")
async def reset_execution(execution_id: str, request: ResetRequest):
    """Rewind to a history event and replay from there."""
    try:
        return await exec_service.reset(
            execution_id,
            event_id=request.event_id,
            reason=request.reason,
            exclude_signals=request.exclude_signals,
            exclude_updates=request.exclude_updates,
        )
    except Exception as e:
        raise _http_error(e, "Reset")


# ── Per-workflow views ────────────────────────────────────────────────────────

@router.get("/workflows/{workflow_name}/metrics")
async def get_workflow_metrics(
    workflow_name: str,
    start_time: Optional[datetime] = Query(None),
    end_time: Optional[datetime] = Query(None),
):
    """Aggregate metrics: run counts, success/error split, latency, retry rate."""
    try:
        return await exec_service.workflow_metrics(workflow_name, start_time, end_time)
    except Exception as e:
        logger.debug("Metrics unavailable for '%s': %s", workflow_name, e)
        return {
            "execution_count": None, "success_count": None, "error_count": None,
            "average_latency_ms": None, "latency_over_time": None, "retry_rate": None,
            "available": False, "detail": str(e),
        }
