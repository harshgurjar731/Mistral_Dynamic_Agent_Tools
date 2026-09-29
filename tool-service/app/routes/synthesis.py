"""
Synthesis routes.

    POST /synthesis/jobs               queue a job → 202 {job_id}
    GET  /synthesis/jobs/{id}          state and, when finished, the result
    GET  /synthesis/jobs/{id}/events   progress as Server-Sent Events
    POST /synthesize                   legacy blocking call: waits up to
                                       SYNTHESIZE_WAIT_SECONDS, then 202 {job_id}
"""

from __future__ import annotations

import asyncio
import json

from fastapi import APIRouter, HTTPException
from fastapi.responses import JSONResponse, StreamingResponse

from app.config import settings
from app.schemas import JobResponse, SynthesizeRequest, SynthesizeResponse
from app.synthesis.jobs import TERMINAL, get_manager
from app.synthesis.spec import SynthesisSpec

router = APIRouter(tags=["Synthesis"])


def _spec(request: SynthesizeRequest) -> SynthesisSpec:
    return SynthesisSpec.from_request(**request.model_dump())


def _response(result: dict) -> SynthesizeResponse:
    fields = SynthesizeResponse.model_fields
    return SynthesizeResponse(**{k: v for k, v in result.items() if k in fields and v is not None})


@router.post("/synthesis/jobs", status_code=202, response_model=JobResponse)
def submit_job(request: SynthesizeRequest):
    manager = get_manager()
    job_id, joined = manager.submit(_spec(request))
    info = manager.get(job_id) or {}
    return JobResponse(job_id=job_id, status=info.get("status", "queued"), tool_name=request.name,
                       purpose=request.purpose, joined_existing=joined)


@router.get("/synthesis/jobs/{job_id}", response_model=JobResponse)
def get_job(job_id: str):
    info = get_manager().get(job_id)
    if info is None:
        raise HTTPException(status_code=404, detail="Job not found")
    return JobResponse(**info)


@router.get("/synthesis/jobs/{job_id}/events")
async def job_events(job_id: str, since: int = 0):
    manager = get_manager()
    if manager.get(job_id) is None:
        raise HTTPException(status_code=404, detail="Job not found")

    async def stream():
        cursor = since
        idle = 0
        while True:
            events, done = manager.events(job_id, cursor)
            for event in events:
                yield f"id: {event.get('seq', cursor)}\nevent: progress\ndata: {json.dumps(event, default=str)}\n\n"
            cursor += len(events)
            if done and not events:
                info = manager.get(job_id) or {}
                yield f"event: result\ndata: {json.dumps(info.get('result'), default=str)}\n\n"
                return
            idle = 0 if events else idle + 1
            if idle and idle % 30 == 0:
                yield ": keep-alive\n\n"
            await asyncio.sleep(0.5)

    return StreamingResponse(stream(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


@router.post("/synthesize", response_model=SynthesizeResponse)
async def synthesize(request: SynthesizeRequest):
    """Blocking compatibility wrapper over the job API."""
    manager = get_manager()
    job_id, _ = manager.submit(_spec(request))
    result = await asyncio.to_thread(manager.wait, job_id, settings.SYNTHESIZE_WAIT_SECONDS)
    if result is None:
        info = manager.get(job_id) or {}
        status = info.get("status", "running")
        body = SynthesizeResponse(
            status=status if status not in TERMINAL else "running", tool_name=request.name,
            purpose=request.purpose, job_id=job_id,
            message=f"Still building — poll /synthesis/jobs/{job_id}",
        )
        return JSONResponse(status_code=202, content=body.model_dump())
    return _response({**result, "job_id": job_id})
