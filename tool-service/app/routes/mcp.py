"""
MCP Routes — Server management and tool execution via MCP protocol.
"""

from fastapi import APIRouter
from pydantic import BaseModel
from typing import Optional

from app.services.mcp_manager import mcp_manager

router = APIRouter(prefix="/mcp", tags=["MCP Servers"])


class RegisterServerRequest(BaseModel):
    name: str
    url: str
    protocol: str = "mcp-v1"
    description: Optional[str] = ""


class MCPExecuteRequest(BaseModel):
    arguments: dict = {}


@router.get("/servers")
async def list_mcp_servers():
    """List all registered MCP servers with health status."""
    servers = await mcp_manager.list_servers()
    return {"servers": servers, "count": len(servers)}


@router.post("/servers")
async def register_mcp_server(request: RegisterServerRequest):
    """Register a new MCP server. Performs initialize handshake and tool discovery."""
    result = await mcp_manager.register_server(
        name=request.name,
        url=request.url,
        protocol=request.protocol,
        description=request.description,
    )
    return result


@router.post("/execute/{server_name}/{tool_name}")
async def execute_mcp_tool(server_name: str, tool_name: str, request: MCPExecuteRequest):
    """Execute a tool via an MCP server."""
    result = await mcp_manager.execute_tool(server_name, tool_name, request.arguments)
    if "error" in result:
        from fastapi import HTTPException
        raise HTTPException(status_code=400, detail=result["error"])
    return result


@router.post("/health-check")
async def health_check_all():
    """Check health of all registered MCP servers."""
    await mcp_manager.health_check_all()
    servers = await mcp_manager.list_servers()
    return {"servers": servers}
