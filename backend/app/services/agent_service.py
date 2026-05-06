"""
Agent Service — Mistral Agents API wrapper.
Uses direct HTTP for list operations (SDK sentinel bug workaround)
and SDK client for create/update/delete.
"""

import logging
import httpx
from mistralai.client import Mistral
from app.config import settings
from app.exceptions import MistralAPIError, AgentNotFoundError

logger = logging.getLogger(__name__)

# Direct HTTP client for endpoints where SDK has sentinel issues
_http_client = httpx.Client(
    base_url="https://api.mistral.ai",
    headers={"Authorization": f"Bearer {settings.MISTRAL_API_KEY}"},
    timeout=30.0,
)


async def list_agents(client: Mistral, page: int = 0, page_size: int = 20) -> dict:
    """List all agents via direct HTTP (bypasses SDK sentinel serialization)."""
    try:
        resp = _http_client.get("/v1/agents", params={"page": page, "page_size": page_size})
        resp.raise_for_status()
        data = resp.json()

        # API returns an array directly per OpenAPI spec
        agent_list = data if isinstance(data, list) else data.get("data", data)
        agents = []
        for agent in agent_list:
            if isinstance(agent, dict):
                agents.append({
                    "id": agent.get("id"),
                    "name": agent.get("name"),
                    "model": agent.get("model"),
                    "description": agent.get("description"),
                    "instructions": agent.get("instructions"),
                    "tools": agent.get("tools", []),
                    "created_at": str(agent.get("created_at", "")),
                })
            else:
                agents.append({
                    "id": getattr(agent, "id", None),
                    "name": getattr(agent, "name", None),
                    "model": getattr(agent, "model", None),
                    "description": getattr(agent, "description", None),
                    "instructions": getattr(agent, "instructions", None),
                    "tools": getattr(agent, "tools", []),
                    "created_at": str(getattr(agent, "created_at", "")),
                })
        # Paginated response format for frontend useInfiniteQuery
        total_pages = 1 if len(agents) < page_size else page + 2
        return {
            "items": agents,
            "page": page,
            "page_size": page_size,
            "total_pages": total_pages,
            "count": len(agents),
        }
    except httpx.HTTPStatusError as e:
        logger.error(f"Failed to list agents: {e.response.text}")
        raise MistralAPIError(f"Failed to list agents: {e.response.text}")
    except Exception as e:
        logger.error(f"Failed to list agents: {e}")
        raise MistralAPIError(f"Failed to list agents: {str(e)}")


async def get_agent(client: Mistral, agent_id: str) -> dict:
    """Get a single agent by ID."""
    try:
        agent = client.beta.agents.get(agent_id=agent_id)
        return {
            "id": agent.id,
            "name": getattr(agent, "name", None),
            "model": getattr(agent, "model", None),
            "description": getattr(agent, "description", None),
            "instructions": getattr(agent, "instructions", None),
            "tools": getattr(agent, "tools", []),
            "created_at": str(getattr(agent, "created_at", "")),
        }
    except Exception as e:
        if "not found" in str(e).lower() or "404" in str(e):
            raise AgentNotFoundError(agent_id)
        raise MistralAPIError(f"Failed to get agent: {str(e)}")


async def create_agent(client: Mistral, data: dict) -> dict:
    """Create a new agent."""
    try:
        create_kwargs = {
            "model": data["model"],
            "name": data["name"],
            "instructions": data.get("instructions", "You are a helpful assistant."),
        }
        if data.get("description"):
            create_kwargs["description"] = data["description"]
        if data.get("tools"):
            from app.services.tool_registry import get_tools
            create_kwargs["tools"] = get_tools(data["tools"])

        agent = client.beta.agents.create(**create_kwargs)
        return {"id": agent.id, "name": getattr(agent, "name", None), "model": getattr(agent, "model", None)}
    except Exception as e:
        logger.error(f"Failed to create agent: {e}")
        raise MistralAPIError(f"Failed to create agent: {str(e)}")


async def update_agent(client: Mistral, agent_id: str, data: dict) -> dict:
    """Update an agent."""
    try:
        update_kwargs = {"agent_id": agent_id}
        if "name" in data:
            update_kwargs["name"] = data["name"]
        if "instructions" in data:
            update_kwargs["instructions"] = data["instructions"]
        if "description" in data:
            update_kwargs["description"] = data["description"]

        agent = client.beta.agents.update(**update_kwargs)
        return {"id": agent.id, "name": getattr(agent, "name", None)}
    except Exception as e:
        if "not found" in str(e).lower():
            raise AgentNotFoundError(agent_id)
        raise MistralAPIError(f"Failed to update agent: {str(e)}")


async def delete_agent(client: Mistral, agent_id: str) -> dict:
    """Delete an agent."""
    try:
        client.beta.agents.delete(agent_id=agent_id)
        return {"deleted": True, "agent_id": agent_id}
    except Exception as e:
        err_str = str(e).lower()
        if "not found" in err_str or "404" in err_str:
            raise AgentNotFoundError(agent_id)
        if "permission" in err_str or "403" in err_str:
            raise MistralAPIError(
                "Permission denied: You cannot delete this agent. It may be a system or built-in agent.", 
                status_code=403
            )
        raise MistralAPIError(f"Failed to delete agent: {str(e)}")
