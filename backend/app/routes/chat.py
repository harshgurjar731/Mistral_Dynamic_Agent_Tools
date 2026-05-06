"""
Chat Routes — POST /api/chat/completions and /api/chat/stream
Aligned with Mistral OpenAPI ChatCompletionRequest schema.
"""

from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from typing import Optional, Any

from app.dependencies import get_mistral_client
from app.services.chat_service import chat_completion, stream_chat_completion

router = APIRouter(tags=["Chat"])


# ── Request Models (aligned with OpenAPI ChatCompletionRequest) ─────────────

class ChatMessage(BaseModel):
    role: str
    content: str
    name: Optional[str] = None
    tool_call_id: Optional[str] = None
    tool_calls: Optional[list] = None


class ChatCompletionRequest(BaseModel):
    """Matches Mistral OpenAPI ChatCompletionRequest schema."""
    model: str = "mistral-large-latest"
    messages: list[ChatMessage]
    agent_id: Optional[str] = None
    temperature: Optional[float] = None
    top_p: Optional[float] = None
    max_tokens: Optional[int] = None
    stream: bool = False
    stop: Optional[str | list[str]] = None
    random_seed: Optional[int] = None
    tools: Optional[list[dict]] = None
    tool_choice: Optional[Any] = None
    response_format: Optional[dict] = None
    safe_prompt: bool = False
    parallel_tool_calls: Optional[bool] = None


@router.post("/chat/completions")
async def chat_completions(request: ChatCompletionRequest, client=Depends(get_mistral_client)):
    """Direct chat completion — bypasses orchestrator."""
    data = request.model_dump(exclude_none=True)
    # Convert ChatMessage objects to plain dicts
    data["messages"] = [msg.model_dump(exclude_none=True) for msg in request.messages]
    result = await chat_completion(client, data)
    return result


@router.post("/chat/stream")
async def chat_stream(request: ChatCompletionRequest, client=Depends(get_mistral_client)):
    """Direct chat — SSE stream."""
    data = request.model_dump(exclude_none=True)
    data["messages"] = [msg.model_dump(exclude_none=True) for msg in request.messages]
    return StreamingResponse(
        stream_chat_completion(client, data),
        media_type="text/event-stream",
    )
