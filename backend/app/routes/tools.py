"""
Tool Proxy Routes — Proxy to Docker Tool Service for tool management,
synthesis, and MCP operations.
"""

from fastapi import APIRouter, Request
from app.services.tool_resolver import tool_resolver

router = APIRouter(tags=["Tools"])


# ── Tool Management ────────────────────────────────────────────────────────

@router.get("/tools/pending")
async def get_pending_tools():
    """Proxy → Docker Tool Service: list pending tools."""
    return await tool_resolver.get_pending_tools()


@router.post("/tools/{tool_id}/approve")
async def approve_tool(tool_id: int):
    """Proxy → Docker Tool Service: approve a pending tool."""
    return await tool_resolver.approve_tool(tool_id)


@router.post("/tools/{tool_id}/reject")
async def reject_tool(tool_id: int):
    """Proxy → Docker Tool Service: reject a pending tool."""
    return await tool_resolver.reject_tool(tool_id)


@router.delete("/tools/{tool_id}")
async def delete_tool(tool_id: str):
    """Proxy → Docker Tool Service: delete a tool."""
    if str(tool_id).startswith("native-") or str(tool_id).startswith("builtin-"):
        return {"error": "Cannot delete native or built-in tools."}
    return await tool_resolver.delete_tool(int(tool_id))


@router.put("/tools/{tool_id}")
async def update_tool(tool_id: str, request: Request):
    """Proxy → Docker Tool Service: update a tool's code and description."""
    if str(tool_id).startswith("native-") or str(tool_id).startswith("builtin-"):
        return {"error": "Cannot edit native or built-in tools."}
        
    body = await request.json()
    return await tool_resolver.update_tool(
        int(tool_id),
        source_code=body.get("source_code", ""),
        description=body.get("description", ""),
        purpose=body.get("purpose"),
    )


@router.get("/tools")
async def list_all_tools():
    """Proxy → Docker Tool Service: list all tools, and append native tools."""
    import json
    from app.services.tool_registry import BUILTIN_TOOLS, NATIVE_EXECUTORS, FUNCTION_TOOLS
    
    dynamic_tools = await tool_resolver.list_tools()
    all_tools = list(dynamic_tools) if isinstance(dynamic_tools, list) else dynamic_tools.get("tools", [])
    
    # Append native SQL tools
    for name, func in NATIVE_EXECUTORS.items():
        if name in FUNCTION_TOOLS:
            schema = FUNCTION_TOOLS[name]
            desc = schema.get("function", {}).get("description", "Native backend tool.")
            all_tools.append({
                "id": f"native-{name}",
                "name": name,
                "version": "1.0.0",
                "status": "approved",
                "description": desc,
                "schema_json": json.dumps(schema),
                "source_code": "# Native backend tool. Code is hardcoded in the backend for security and cannot be edited here.",
                "purpose": "tool",
            })
            
    # Append Mistral built-ins
    for name, schema in BUILTIN_TOOLS.items():
        all_tools.append({
            "id": f"builtin-{name}",
            "name": name,
            "version": "1.0.0",
            "status": "approved",
            "description": f"Mistral built-in capability: {schema.get('type')}",
            "schema_json": json.dumps(schema),
            "source_code": "# Mistral built-in capability. No source code available.",
            "purpose": "tool",
        })
        
    return all_tools


@router.get("/tools/by-hash/{hash}")
async def get_tool_by_hash(hash: str):
    """Proxy → Docker Tool Service: find tool by SHA-256 hash."""
    return await tool_resolver.get_tool_by_content_hash(hash)


@router.get("/tools/{tool_id}")
async def get_tool(tool_id: str):
    """Single tool (dynamic, native, built-in, or pending) for the tool/activity detail pages."""
    from fastapi import HTTPException

    for tool in await list_all_tools():
        if str(tool.get("id")) == tool_id:
            return tool

    pending = await tool_resolver.get_pending_tools()
    pending_tools = pending if isinstance(pending, list) else (pending or {}).get("tools", [])
    for tool in pending_tools:
        if str(tool.get("id")) == tool_id:
            return tool

    raise HTTPException(status_code=404, detail=f"Tool '{tool_id}' not found.")


# ── Synthesis ──────────────────────────────────────────────────────────────

@router.post("/tools/synthesize")
async def synthesize_tool(request: Request):
    """Proxy → Docker Tool Service: trigger tool synthesis."""
    body = await request.json()
    purpose = body.get("purpose") or "tool"
    return await tool_resolver.synthesize_from_task(body.get("task", ""), purpose=purpose)


# ── MCP Proxy ──────────────────────────────────────────────────────────────

@router.get("/mcp/servers")
async def list_mcp_servers():
    """Proxy → Docker Tool Service: list MCP servers."""
    return await tool_resolver.list_mcp_servers()


@router.post("/mcp/servers")
async def register_mcp_server(request: Request):
    """Proxy → Docker Tool Service: register MCP server."""
    body = await request.json()
    return await tool_resolver.register_mcp_server(body)


@router.post("/mcp/execute/{server_name}/{tool_name}")
async def execute_mcp_tool(server_name: str, tool_name: str, request: Request):
    """Proxy → Docker Tool Service: execute MCP tool."""
    body = await request.json()
    return await tool_resolver.execute_mcp_tool(server_name, tool_name, body.get("arguments", {}))


@router.post("/mcp/health-check")
async def mcp_health_check():
    """Proxy → Docker Tool Service: ping all MCP servers."""
    return await tool_resolver.mcp_health_check()


@router.delete("/mcp/servers/{server_name}")
async def delete_mcp_server(server_name: str):
    """Proxy → Docker Tool Service: delete an MCP server."""
    return await tool_resolver.delete_mcp_server(server_name)


@router.post("/mcp/servers/{server_name}/disconnect")
async def disconnect_mcp_server(server_name: str):
    """Proxy → Docker Tool Service: disconnect an MCP server."""
    return await tool_resolver.disconnect_mcp_server(server_name)


@router.post("/mcp/servers/{server_name}/reconnect")
async def reconnect_mcp_server(server_name: str):
    """Proxy → Docker Tool Service: reconnect an MCP server."""
    return await tool_resolver.reconnect_mcp_server(server_name)


@router.get("/mcp/servers/{server_name}/tools")
async def get_mcp_server_tools(server_name: str):
    """Proxy → Docker Tool Service: get tools from an MCP server."""
    return await tool_resolver.get_mcp_server_tools(server_name)


@router.post("/tools/{tool_id}/publish-mcp")
async def publish_tool_to_mcp(tool_id: int, request: Request):
    """Proxy → Docker Tool Service: publish a tool to an MCP server."""
    body = await request.json()
    return await tool_resolver.publish_tool_to_mcp(tool_id, body.get("server_name", ""))
