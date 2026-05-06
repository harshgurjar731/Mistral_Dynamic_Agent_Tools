"""
Orchestrator Routes — POST /api/orchestrate and /api/orchestrate/stream
"""

import json
from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from typing import Optional

from app.dependencies import get_mistral_client
from app.services.orchestrator_service import orchestrate, orchestrate_stream

router = APIRouter(tags=["Orchestrator"])


class OrchestrateRequest(BaseModel):
    query: str
    agent_id: Optional[str] = None
    conversation_id: Optional[str] = None
    cleanup_agent: bool = False
    workflow: Optional[str] = None


@router.post("/orchestrate")
async def orchestrate_endpoint(request: OrchestrateRequest, client=Depends(get_mistral_client)):
    """Full orchestration — JSON response."""
    result = await orchestrate(
        client=client,
        query=request.query,
        agent_id=request.agent_id,
        conversation_id=request.conversation_id,
        cleanup_agent=request.cleanup_agent,
    )
    return result


@router.post("/orchestrate/stream")
async def orchestrate_stream_endpoint(request: OrchestrateRequest, client=Depends(get_mistral_client)):
    """Full orchestration — SSE stream."""
    return StreamingResponse(
        orchestrate_stream(
            client=client,
            query=request.query,
            agent_id=request.agent_id,
            conversation_id=request.conversation_id,
            cleanup_agent=request.cleanup_agent,
        ),
        media_type="text/event-stream",
    )
