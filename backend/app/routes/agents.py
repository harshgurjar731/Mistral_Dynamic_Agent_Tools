"""
Agent Routes — CRUD /api/agents
Aligned with Mistral OpenAPI spec endpoints.
"""

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from typing import Optional

from app.dependencies import get_mistral_client
from app.services import agent_service

router = APIRouter(tags=["Agents"])


class CreateAgentRequest(BaseModel):
    name: str
    model: str = "mistral-large-latest"
    instructions: str = "You are a helpful assistant."
    description: Optional[str] = None
    tools: list = []


class UpdateAgentRequest(BaseModel):
    name: Optional[str] = None
    instructions: Optional[str] = None
    description: Optional[str] = None


@router.get("/agents")
async def list_agents(page: int = 0, page_size: int = 20, client=Depends(get_mistral_client)):
    """List all saved agents."""
    return await agent_service.list_agents(client, page=page, page_size=page_size)


@router.get("/agents/{agent_id}")
async def get_agent(agent_id: str, client=Depends(get_mistral_client)):
    """Get a specific agent by ID."""
    return await agent_service.get_agent(client, agent_id)


@router.post("/agents")
async def create_agent(request: CreateAgentRequest, client=Depends(get_mistral_client)):
    """Create a permanent agent."""
    return await agent_service.create_agent(client, request.model_dump())


@router.patch("/agents/{agent_id}")
async def update_agent(agent_id: str, request: UpdateAgentRequest, client=Depends(get_mistral_client)):
    """Update agent config."""
    return await agent_service.update_agent(client, agent_id, request.model_dump(exclude_none=True))


@router.delete("/agents/{agent_id}")
async def delete_agent(agent_id: str, client=Depends(get_mistral_client)):
    """Delete agent."""
    return await agent_service.delete_agent(client, agent_id)
