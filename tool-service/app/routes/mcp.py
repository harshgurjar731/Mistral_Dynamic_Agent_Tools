"""
MCP Routes — Server management, tool discovery, and tool execution via MCP protocol.
"""

from fastapi import APIRouter, HTTPException
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


# ── Server CRUD ─────────────────────────────────────────────────────────────


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


@router.delete("/servers/{server_name}")
async def delete_mcp_server(server_name: str):
    """Remove a server from the registry entirely."""
    result = await mcp_manager.delete_server(server_name)
    if "error" in result:
        raise HTTPException(status_code=404, detail=result["error"])
    return result


@router.post("/servers/{server_name}/disconnect")
async def disconnect_mcp_server(server_name: str):
    """Disable a server without deleting it."""
    result = await mcp_manager.disconnect_server(server_name)
    if "error" in result:
        raise HTTPException(status_code=404, detail=result["error"])
    return result


@router.post("/servers/{server_name}/reconnect")
async def reconnect_mcp_server(server_name: str):
    """Re-enable and re-handshake a disconnected server."""
    result = await mcp_manager.reconnect_server(server_name)
    if "error" in result:
        raise HTTPException(status_code=404, detail=result["error"])
    return result


# ── Tool Discovery ──────────────────────────────────────────────────────────


@router.get("/servers/{server_name}/tools")
async def list_server_tools(server_name: str):
    """List all tools discovered on a specific MCP server."""
    if server_name not in mcp_manager.servers:
        raise HTTPException(status_code=404, detail=f"Server '{server_name}' not found")
    tools = await mcp_manager.get_server_tools(server_name)
    return {"server": server_name, "tools": tools, "count": len(tools)}


# ── Tool Execution ──────────────────────────────────────────────────────────


@router.post("/execute/{server_name}/{tool_name}")
async def execute_mcp_tool(server_name: str, tool_name: str, request: MCPExecuteRequest):
    """Execute a tool via an MCP server."""
    result = await mcp_manager.execute_tool(server_name, tool_name, request.arguments)
    if "error" in result:
        raise HTTPException(status_code=400, detail=result["error"])
    return result


# ── Health Check ────────────────────────────────────────────────────────────


@router.post("/health-check")
async def health_check_all():
    """Check health of all registered MCP servers."""
    await mcp_manager.health_check_all()
    servers = await mcp_manager.list_servers()
    return {"servers": servers}
