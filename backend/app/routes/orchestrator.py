"""
Orchestrator Routes — POST /api/orchestrate and /api/orchestrate/stream
"""

import json
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from typing import Optional

from app.dependencies import get_mistral_client
from app.services.orchestrator_service import orchestrate, orchestrate_stream

router = APIRouter(tags=["Orchestrator"])


def _check_design_allowed(request: "OrchestrateRequest") -> None:
    """Talking to an existing agent needs chat.use (the route rule); designing
    and creating a new one — no agent_id — needs orchestrator.use."""
    from app.auth.context import current_principal

    p = current_principal()
    if p is not None and p.kind == "user" and not request.agent_id and not p.can("orchestrator.use"):
        raise HTTPException(status_code=403, detail={
            "message": f"Your role ({p.role_name or 'your role'}) in {p.workspace_name or 'this workspace'} "
                       "can chat with existing agents but not design new ones.",
            "code": "forbidden", "needs": ["orchestrator.use"]})


class OrchestrateRequest(BaseModel):
    query: str
    agent_id: Optional[str] = None
    conversation_id: Optional[str] = None
    cleanup_agent: bool = False
    workflow: Optional[str] = None
    tier: Optional[str] = None
    image_base64: Optional[str] = None
    image_mime: Optional[str] = None
    #: {"enabled": bool, "document_ids": [int]} — see ProcessKnowledgeLayer.
    process_knowledge: Optional[dict] = None


@router.post("/orchestrate")
async def orchestrate_endpoint(request: OrchestrateRequest, client=Depends(get_mistral_client)):
    """Full orchestration — JSON response."""
    _check_design_allowed(request)
    result = await orchestrate(
        client=client,
        query=request.query,
        agent_id=request.agent_id,
        conversation_id=request.conversation_id,
        cleanup_agent=request.cleanup_agent,
        tier=request.tier,
        image_base64=request.image_base64,
        image_mime=request.image_mime,
        process_knowledge=request.process_knowledge,
    )
    return result


@router.post("/orchestrate/stream")
async def orchestrate_stream_endpoint(request: OrchestrateRequest, client=Depends(get_mistral_client)):
    """Full orchestration — SSE stream."""
    _check_design_allowed(request)
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
            process_knowledge=request.process_knowledge,
        ),
        media_type="text/event-stream",
    )
