"""
Conversation Routes — CRUD /api/conversations
Aligned with Mistral OpenAPI spec endpoints.
"""

from fastapi import APIRouter, Depends

from app.dependencies import get_mistral_client
from app.services import conversation_service

router = APIRouter(tags=["Conversations"])


@router.get("/conversations")
async def list_conversations(client=Depends(get_mistral_client)):
    """List all conversations."""
    return await conversation_service.list_conversations(client)


@router.get("/conversations/{conversation_id}")
async def get_conversation(conversation_id: str, client=Depends(get_mistral_client)):
    """Get a specific conversation."""
    return await conversation_service.get_conversation(client, conversation_id)


@router.get("/conversations/{conversation_id}/history")
async def get_conversation_history(conversation_id: str, client=Depends(get_mistral_client)):
    """Get all entries in a conversation."""
    return await conversation_service.get_conversation_history(client, conversation_id)


@router.delete("/conversations/{conversation_id}")
async def delete_conversation(conversation_id: str, client=Depends(get_mistral_client)):
    """Delete a conversation."""
    return await conversation_service.delete_conversation(client, conversation_id)
