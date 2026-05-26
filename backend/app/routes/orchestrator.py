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
    tier: Optional[str] = None
    image_base64: Optional[str] = None
    image_mime: Optional[str] = None


@router.post("/orchestrate")
async def orchestrate_endpoint(request: OrchestrateRequest, client=Depends(get_mistral_client)):
    """Full orchestration — JSON response."""
    result = await orchestrate(
        client=client,
        query=request.query,
        agent_id=request.agent_id,
        conversation_id=request.conversation_id,
        cleanup_agent=request.cleanup_agent,
        tier=request.tier,
        image_base64=request.image_base64,
        image_mime=request.image_mime,
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
            tier=request.tier,
            image_base64=request.image_base64,
            image_mime=request.image_mime,
        ),
        media_type="text/event-stream",
    )
