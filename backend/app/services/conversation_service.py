"""
Conversation Service — Mistral Conversations API wrapper.
Uses direct HTTP for list operations (SDK sentinel bug workaround)
and SDK client for other operations.
"""

import logging
import httpx
from mistralai.client import Mistral
from app.config import settings
from app.exceptions import MistralAPIError

logger = logging.getLogger(__name__)

# Direct HTTP client for endpoints where SDK has sentinel issues
_http_client = httpx.Client(
    base_url="https://api.mistral.ai",
    headers={"Authorization": f"Bearer {settings.MISTRAL_API_KEY}"},
    timeout=30.0,
)


async def list_conversations(client: Mistral) -> dict:
    """List conversation threads via direct HTTP (bypasses SDK sentinel serialization)."""
    try:
        resp = _http_client.get("/v1/conversations", params={"page": 0, "page_size": 100})
        resp.raise_for_status()
        data = resp.json()

        # API returns an array directly per OpenAPI spec
        conv_list = data if isinstance(data, list) else data.get("data", data)
        conversations = []
        for conv in conv_list:
            if isinstance(conv, dict):
                conversations.append({
                    "id": conv.get("id"),
                    "agent_id": conv.get("agent_id"),
                    "model": conv.get("model"),
                    "created_at": str(conv.get("created_at", "")),
                })
            else:
                conversations.append({
                    "id": getattr(conv, "id", None),
                    "agent_id": getattr(conv, "agent_id", None),
                    "model": getattr(conv, "model", None),
                    "created_at": str(getattr(conv, "created_at", "")),
                })
        return {"conversations": conversations, "count": len(conversations)}
    except httpx.HTTPStatusError as e:
        logger.error(f"Failed to list conversations: {e.response.text}")
        raise MistralAPIError(f"Failed to list conversations: {e.response.text}")
    except Exception as e:
        logger.error(f"Failed to list conversations: {e}")
        raise MistralAPIError(f"Failed to list conversations: {str(e)}")


async def get_conversation(client: Mistral, conversation_id: str) -> dict:
    """Get a single conversation by ID."""
    try:
        conv = client.beta.conversations.get(conversation_id=conversation_id)
        return {
            "id": conv.id,
            "agent_id": getattr(conv, "agent_id", None),
            "model": getattr(conv, "model", None),
            "created_at": str(getattr(conv, "created_at", "")),
        }
    except Exception as e:
        raise MistralAPIError(f"Failed to get conversation: {str(e)}")


async def get_conversation_history(client: Mistral, conversation_id: str) -> dict:
    """Get conversation history (all entries)."""
    try:
        history = client.beta.conversations.get_history(conversation_id=conversation_id)
        return history
    except Exception as e:
        raise MistralAPIError(f"Failed to get conversation history: {str(e)}")


async def delete_conversation(client: Mistral, conversation_id: str) -> dict:
    """Delete a conversation."""
    try:
        client.beta.conversations.delete(conversation_id=conversation_id)
        return {"deleted": True, "conversation_id": conversation_id}
    except Exception as e:
        raise MistralAPIError(f"Failed to delete conversation: {str(e)}")


async def create_conversation(client: Mistral) -> dict:
    """Create a new conversation thread."""
    try:
        # Conversations are created via start(), not a separate create endpoint
        return {"message": "Use POST /api/orchestrate to start a new conversation with an agent."}
    except Exception as e:
        raise MistralAPIError(f"Failed to create conversation: {str(e)}")
