"""
Op progress routes — follow what a tagged request is doing.

    GET /ops/{id}/events   SSE: replay after ?after=<seq>, then follow live

The id is the ``X-Op-Id`` the browser sent with the request. Opening the
stream before the request arrives is fine — it waits for it.
"""

from typing import Optional

from fastapi import APIRouter, Header, HTTPException, Query
from fastapi.responses import StreamingResponse

from app.progress import registry

router = APIRouter(tags=["Progress"])

_SSE_HEADERS = {"Cache-Control": "no-cache", "X-Accel-Buffering": "no", "Connection": "keep-alive"}


@router.get("/ops/{op_id}/events")
async def stream_op_events(
    op_id: str,
    after: int = Query(0, ge=0),
    last_event_id: Optional[str] = Header(None, alias="Last-Event-ID"),
):
    if not registry.valid(op_id):
        raise HTTPException(status_code=400, detail="Invalid op id.")
    if last_event_id and last_event_id.isdigit():
        after = max(after, int(last_event_id))
    return StreamingResponse(
        registry.stream(op_id, after), media_type="text/event-stream", headers=_SSE_HEADERS,
    )
