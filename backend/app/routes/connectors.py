"""
Connector Routes — CRUD /api/connectors

Connectors are MCP servers registered with Mistral, which owns their
credentials and executes their tools. Deliberately separate from the
``/api/mcp/*`` routes in ``tools.py``, which drive the Docker Tool Service's own
MCP registry — the two registries do not share state and neither reads the
other's servers.
"""

import logging

from fastapi import APIRouter, Query
from pydantic import BaseModel, Field
from typing import Any, Optional

from app.services import connector_service

logger = logging.getLogger(__name__)
router = APIRouter(tags=["Connectors"])


# ── Request models ─────────────────────────────────────────────────────────


class AuthData(BaseModel):
    """OAuth2 client credentials for a connector that needs its own app registration."""
    client_id: str
    client_secret: str


class CreateConnectorRequest(BaseModel):
    name: str = Field(..., description="Alphanumeric, dashes/underscores, 64 chars max.")
    description: str
    server: str = Field(..., description="URL of the MCP server.")
    icon_url: Optional[str] = None
    system_prompt: Optional[str] = None
    visibility: Optional[str] = Field(
        default=None, description="shared_org | shared_workspace | private"
    )
    headers: Optional[dict] = None
    auth_data: Optional[AuthData] = None


class UpdateConnectorRequest(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    icon_url: Optional[str] = None
    system_prompt: Optional[str] = None
    connection_config: Optional[dict] = None


class CallToolRequest(BaseModel):
    arguments: dict = Field(default_factory=dict)
    credentials_name: Optional[str] = None


class CredentialsRequest(BaseModel):
    name: str = "default"
    credentials: dict = Field(default_factory=dict)
    is_default: bool = True


class ActivationRequest(BaseModel):
    active: bool = True
    include: Optional[list[str]] = None
    exclude: Optional[list[str]] = None
    requires_confirmation: Optional[list[str]] = None
    skip_confirmation: Optional[list[str]] = None


# ── Connector CRUD ─────────────────────────────────────────────────────────


@router.get("/connectors")
async def list_connectors(page_size: int = 200, cursor: Optional[str] = None):
    """List all connectors visible to this API key, directory ones included."""
    return await connector_service.list_connectors(page_size=page_size, cursor=cursor)


@router.get("/connectors/{connector_id}")
async def get_connector(connector_id: str):
    """Get one connector by id or name."""
    return await connector_service.get_connector(connector_id)


@router.post("/connectors")
async def create_connector(request: CreateConnectorRequest):
    """Register an MCP server URL as a new custom connector."""
    return await connector_service.create_connector(request.model_dump(exclude_none=True))


@router.patch("/connectors/{connector_id}")
async def update_connector(connector_id: str, request: UpdateConnectorRequest):
    """Update a custom connector's metadata."""
    return await connector_service.update_connector(
        connector_id, request.model_dump(exclude_none=True)
    )


@router.delete("/connectors/{connector_id}")
async def delete_connector(connector_id: str):
    """Delete a custom connector, and its edges in the knowledge graph."""
    from app.services import delete_rules

    result = await connector_service.delete_connector(connector_id)
    if isinstance(result, dict) and not result.get("error"):
        result["graph"] = delete_rules.forget_in_graph("connector", connector_id)
    return result


# ── Tools ──────────────────────────────────────────────────────────────────


@router.get("/connectors/{connector_id}/tools")
async def list_connector_tools(connector_id: str):
    """List the tools a connector exposes."""
    tools = await connector_service.list_connector_tools(connector_id)
    return {"tools": tools, "count": len(tools)}


@router.post("/connectors/{connector_id}/tools/{tool_name}/call")
async def call_connector_tool(connector_id: str, tool_name: str, request: CallToolRequest):
    """Invoke a connector tool directly — used by the UI's test action."""
    result = await connector_service.call_connector_tool(
        connector_id,
        tool_name,
        request.arguments,
        credentials_name=request.credentials_name,
    )
    return {"result": result, "output": connector_service.flatten_tool_result(result)}


# ── Authentication ─────────────────────────────────────────────────────────


@router.get("/connectors/{connector_id}/authentication")
async def get_auth_methods(connector_id: str):
    """Describe the authentication methods a connector supports."""
    return await connector_service.get_auth_methods(connector_id)


@router.get("/connectors/{connector_id}/auth-url")
async def get_auth_url(connector_id: str, credentials_name: Optional[str] = None):
    """Start an OAuth2 flow. The returned URL expires — fetch it on demand."""
    return await connector_service.get_auth_url(connector_id, credentials_name)


# ── Credentials ────────────────────────────────────────────────────────────


@router.get("/connectors/{connector_id}/credentials")
async def list_credentials(connector_id: str, scope: str = "user"):
    """List stored credentials at a scope (organization | workspace | user)."""
    creds = await connector_service.list_credentials(connector_id, scope)
    return {"credentials": creds, "scope": scope, "count": len(creds)}


@router.post("/connectors/{connector_id}/credentials")
async def set_credentials(connector_id: str, request: CredentialsRequest, scope: str = "user"):
    """Store a named credential, e.g. {"bearer_token": "..."}."""
    return await connector_service.set_credentials(
        connector_id,
        scope=scope,
        name=request.name,
        credentials=request.credentials,
        is_default=request.is_default,
    )


@router.delete("/connectors/{connector_id}/credentials")
async def delete_credentials(
    connector_id: str,
    scope: str = "user",
    credentials_name: Optional[str] = Query(default=None),
):
    """Delete one named credential, or every credential at this scope."""
    return await connector_service.delete_credentials(connector_id, scope, credentials_name)


# ── Activation ─────────────────────────────────────────────────────────────


@router.post("/connectors/{connector_id}/activation")
async def set_activation(connector_id: str, request: ActivationRequest, scope: str = "organization"):
    """Activate or deactivate a connector, optionally filtering its tools."""
    return await connector_service.set_activation(
        connector_id,
        scope=scope,
        active=request.active,
        tool_configuration=request.model_dump(exclude_none=True, exclude={"active"}),
    )
