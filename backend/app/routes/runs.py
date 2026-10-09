"""
Background run routes — start creation pipelines that outlive the request.

    POST /runs/workflow-plan     plan a workflow
    POST /runs/agent             design (or reuse) an agent and answer with it
    POST /runs/synthesis         synthesise an agent tool or an activity
    GET  /runs                   list runs (?status=running&kind=…)
    GET  /runs/{id}              one run: status, progress, result
    GET  /runs/{id}/events       SSE: replay after ?after=<seq>, then follow live
    POST /runs/{id}/cancel       stop a running run
    POST /runs/{id}/decisions/{d} answer a question the run is waiting on

Starting returns immediately with the run. Closing the event stream never stops
a run; only the cancel endpoint does.
"""

from functools import partial
from typing import Literal, Optional

from fastapi import APIRouter, Depends, Header, HTTPException, Query
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from app.dependencies import get_mistral_client
from app.runs import runners
from app.runs.manager import manager

router = APIRouter(tags=["Runs"])

_SSE_HEADERS = {"Cache-Control": "no-cache", "X-Accel-Buffering": "no", "Connection": "keep-alive"}


class WorkflowPlanRun(BaseModel):
    goal: str = Field(min_length=1)


class AgentRun(BaseModel):
    query: str = Field(min_length=1)
    agent_id: Optional[str] = None
    conversation_id: Optional[str] = None
    tier: Optional[str] = None
    image_base64: Optional[str] = None
    image_mime: Optional[str] = None


class SynthesisRun(BaseModel):
    task: str = Field(min_length=1)
    purpose: Literal["tool", "activity"] = "tool"


@router.post("/runs/workflow-plan", status_code=202)
async def start_workflow_plan(body: WorkflowPlanRun, client=Depends(get_mistral_client)):
    goal = body.goal.strip()
    run = await manager.start(
        "workflow_plan", goal, {"goal": goal},
        partial(runners.workflow_plan, client=client, goal=goal),
    )
    return run.snapshot()


@router.post("/runs/agent", status_code=202)
async def start_agent(body: AgentRun, client=Depends(get_mistral_client)):
    query = body.query.strip()
    request = body.model_dump(exclude={"image_base64"})
    request["has_image"] = bool(body.image_base64)
    run = await manager.start(
        "agent", query, request,
        partial(
            runners.agent, client=client, query=query,
            agent_id=body.agent_id, conversation_id=body.conversation_id, tier=body.tier,
            image_base64=body.image_base64, image_mime=body.image_mime,
        ),
    )
    return run.snapshot()


@router.post("/runs/synthesis", status_code=202)
async def start_synthesis(body: SynthesisRun):
    task = body.task.strip()
    kind = "activity_synthesis" if body.purpose == "activity" else "tool_synthesis"
    run = await manager.start(
        kind, task, {"task": task, "purpose": body.purpose},
        partial(runners.synthesis, task=task, purpose=body.purpose),
    )
    return run.snapshot()


@router.get("/runs")
async def list_runs(
    status: Optional[str] = Query(None, description="Comma-separated statuses"),
    kind: Optional[str] = Query(None, description="Comma-separated kinds"),
    limit: int = Query(30, ge=1, le=200),
):
    return {"runs": await manager.list_runs(status=status, kind=kind, limit=limit)}


@router.get("/runs/{run_id}")
async def get_run(run_id: str):
    run = await manager.get(run_id)
    if run is None:
        raise HTTPException(status_code=404, detail=f"Run '{run_id}' not found.")
    return run


@router.get("/runs/{run_id}/events")
async def stream_run_events(
    run_id: str,
    after: int = Query(0, ge=0),
    last_event_id: Optional[str] = Header(None, alias="Last-Event-ID"),
):
    if manager.live(run_id) is None and await manager.get(run_id) is None:
        raise HTTPException(status_code=404, detail=f"Run '{run_id}' not found.")
    if last_event_id and last_event_id.isdigit():
        after = max(after, int(last_event_id))
    return StreamingResponse(
        manager.stream(run_id, after), media_type="text/event-stream", headers=_SSE_HEADERS,
    )


@router.post("/runs/{run_id}/cancel")
async def cancel_run(run_id: str):
    if not await manager.cancel(run_id):
        run = await manager.get(run_id)
        if run is None:
            raise HTTPException(status_code=404, detail=f"Run '{run_id}' not found.")
        return {"cancelled": False, "status": run["status"]}
    return {"cancelled": True, "status": "cancelling"}


class DecisionAnswer(BaseModel):
    choice: str = Field(min_length=1)


@router.post("/runs/{run_id}/decisions/{decision_id}")
async def answer_decision(run_id: str, decision_id: str, body: DecisionAnswer):
    """Answer a question a running run is waiting on (``decision_required`` event)."""
    error = manager.answer(run_id, decision_id, body.choice)
    if error:
        if manager.live(run_id) is None and await manager.get(run_id) is None:
            raise HTTPException(status_code=404, detail=f"Run '{run_id}' not found.")
        raise HTTPException(status_code=409, detail=error)
    return {"accepted": True, "choice": body.choice}
