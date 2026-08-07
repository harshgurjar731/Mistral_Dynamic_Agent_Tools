"""
MCP Manager — Server discovery, registration, health checking, and tool proxying.
Follows MCP protocol conventions (JSON-RPC initialize handshake).
"""

import json
import os
import logging
import httpx

from app.config import settings

logger = logging.getLogger(__name__)


class MCPServerInfo:
    """Information about a registered MCP server."""
    def __init__(self, name: str, url: str, protocol: str = "mcp-v1",
                 enabled: bool = False, description: str = ""):
        self.name = name
        self.url = url
        self.protocol = protocol
        self.enabled = enabled
        self.description = description
        self.healthy = False
        self.tools: list[dict] = []


class MCPManager:
    """
    Manages MCP server discovery, registration, and proxying.
    MCP servers are sibling containers on the tool-net Docker network.
    """

    def __init__(self):
        self.servers: dict[str, MCPServerInfo] = {}
        self._load_registry()

    def _load_registry(self):
        """Load MCP server registry from JSON file."""
        registry_path = settings.MCP_REGISTRY_PATH
        if not os.path.exists(registry_path):
            logger.info("No MCP registry found at %s", registry_path)
            return

        try:
            with open(registry_path, "r") as f:
                data = json.load(f)

            for server_data in data.get("servers", []):
                info = MCPServerInfo(
                    name=server_data["name"],
                    url=server_data["url"],
                    protocol=server_data.get("protocol", "mcp-v1"),
                    enabled=server_data.get("enabled", False),
                    description=server_data.get("description", ""),
                )
                self.servers[info.name] = info

            logger.info("Loaded %d MCP servers from registry", len(self.servers))
        except Exception as e:
            logger.error("Failed to load MCP registry: %s", e)

    def _save_registry(self):
        """Save current server registry to JSON file."""
        registry_path = settings.MCP_REGISTRY_PATH
        os.makedirs(os.path.dirname(registry_path), exist_ok=True)

        data = {
            "servers": [
                {
                    "name": s.name,
                    "url": s.url,
                    "protocol": s.protocol,
                    "enabled": s.enabled,
                    "description": s.description,
                }
                for s in self.servers.values()
            ]
        }

        with open(registry_path, "w") as f:
            json.dump(data, f, indent=2)

    async def list_servers(self) -> list[dict]:
        """List all registered MCP servers with health status."""
        result = []
        for server in self.servers.values():
            result.append({
                "name": server.name,
                "url": server.url,
                "protocol": server.protocol,
                "enabled": server.enabled,
                "healthy": server.healthy,
                "description": server.description,
                "tools_count": len(server.tools),
            })
        return result

    async def register_server(self, name: str, url: str, protocol: str = "mcp-v1",
                               description: str = "") -> dict:
        """Register a new MCP server."""
        # Strip whitespace to prevent URL issues like trailing %20
        name = name.strip()
        url = url.strip().rstrip("/")
        info = MCPServerInfo(name=name, url=url, protocol=protocol,
                            enabled=True, description=description)

        # Perform full MCP lifecycle: initialize → initialized → tools/list
        init_ok, tools = await self._initialize_and_discover(info)
        info.healthy = init_ok
        info.tools = tools

        self.servers[name] = info
        self._save_registry()

        return {
            "name": name,
            "url": url,
            "healthy": init_ok,
            "tools_discovered": len(info.tools),
        }

    async def _initialize_and_discover(self, server: MCPServerInfo) -> tuple[bool, list[dict]]:
        """Perform full MCP lifecycle: initialize → initialized notification → tools/list.
        
        The Streamable HTTP transport requires session tracking via
        the Mcp-Session-Id header returned by the initialize response.
        """
        base_headers = {
            "Content-Type": "application/json",
            "Accept": "application/json, text/event-stream",
        }
        
        try:
            async with httpx.AsyncClient(timeout=20, verify=True) as client:
                # Step 1: Initialize handshake
                resp = await client.post(
                    server.url,
                    headers=base_headers,
                    json={
                        "jsonrpc": "2.0",
                        "id": 1,
                        "method": "initialize",
                        "params": {
                            "protocolVersion": "2025-03-26",
                            "capabilities": {},
                            "clientInfo": {
                                "name": "MistralDynamicAgentToolService",
                                "version": "1.0.0",
                            },
                        },
                    },
                )
                
                if resp.status_code != 200:
                    logger.warning("MCP init returned %d for %s", resp.status_code, server.name)
                    return False, []
                
                data = self._extract_response(resp)
                if not data or "result" not in data:
                    logger.warning("MCP init unexpected response from %s: %s", server.name, data)
                    return False, []
                
                logger.info("MCP handshake successful with %s", server.name)
                
                # Capture session ID from response headers
                session_id = resp.headers.get("mcp-session-id", "")
                session_headers = {**base_headers}
                if session_id:
                    session_headers["Mcp-Session-Id"] = session_id
                
                # Step 2: Send initialized notification (required by MCP spec)
                await client.post(
                    server.url,
                    headers=session_headers,
                    json={
                        "jsonrpc": "2.0",
                        "method": "notifications/initialized",
                    },
                )
                
                # Step 3: Discover tools
                tools_resp = await client.post(
                    server.url,
                    headers=session_headers,
                    json={
                        "jsonrpc": "2.0",
                        "id": 2,
                        "method": "tools/list",
                        "params": {},
                    },
                )
                
                tools = []
                if tools_resp.status_code == 200:
                    tools_data = self._extract_response(tools_resp)
                    if tools_data:
                        tools = tools_data.get("result", {}).get("tools", [])
                        logger.info("Discovered %d tools from %s", len(tools), server.name)
                else:
                    logger.warning("tools/list returned %d for %s", tools_resp.status_code, server.name)
                
                return True, tools
                
        except Exception as e:
            logger.warning("MCP initialize+discover failed for %s: %s", server.name, e)
        return False, []

    async def _initialize_handshake(self, server: MCPServerInfo) -> bool:
        """Perform MCP JSON-RPC initialize handshake (for health checks)."""
        ok, _ = await self._initialize_and_discover(server)
        return ok

    def _parse_sse_response(self, text: str) -> dict | None:
        """Parse an SSE response to extract JSON-RPC data from 'data:' lines."""
        import json as _json
        for line in text.strip().split("\n"):
            line = line.strip()
            if line.startswith("data:"):
                payload = line[len("data:"):].strip()
                if payload:
                    try:
                        return _json.loads(payload)
                    except Exception:
                        continue
        return None

    def _extract_response(self, resp) -> dict | None:
        """Extract JSON-RPC response from either plain JSON or SSE."""
        content_type = resp.headers.get("content-type", "")
        if "text/event-stream" in content_type:
            return self._parse_sse_response(resp.text)
        else:
            try:
                return resp.json()
            except Exception:
                return None

    async def _discover_tools(self, server: MCPServerInfo) -> list[dict]:
        """Discover available tools from an MCP server."""
        _, tools = await self._initialize_and_discover(server)
        return tools

    async def execute_tool(self, server_name: str, tool_name: str, arguments: dict) -> dict:
        """Proxy a tool call to the appropriate MCP server."""
        server = self.servers.get(server_name)
        if not server:
            return {"error": f"MCP server '{server_name}' not found"}

        if not server.enabled:
            return {"error": f"MCP server '{server_name}' is disabled"}

        try:
            async with httpx.AsyncClient(timeout=30, verify=True) as client:
                resp = await client.post(
                    server.url,
                    headers={
                        "Content-Type": "application/json",
                        "Accept": "application/json, text/event-stream",
                    },
                    json={
                        "jsonrpc": "2.0",
                        "id": 3,
                        "method": "tools/call",
                        "params": {
                            "name": tool_name,
                            "arguments": arguments,
                        },
                    },
                )
                if resp.status_code == 200:
                    data = self._extract_response(resp)
                    if data and "result" in data:
                        return {"result": data["result"], "server": server_name, "tool": tool_name}
                    elif data and "error" in data:
                        return {"error": data["error"].get("message", "MCP call failed")}

                return {"error": f"MCP server returned {resp.status_code}"}
        except Exception as e:
            return {"error": f"MCP execution failed: {str(e)}"}

    async def health_check_all(self):
        """Check health of all registered MCP servers."""
        for server in self.servers.values():
            if server.enabled:
                server.healthy = await self._initialize_handshake(server)

    async def disconnect_server(self, name: str) -> dict:
        """Disable a server without deleting it."""
        server = self.servers.get(name)
        if not server:
            return {"error": f"Server '{name}' not found"}
        server.enabled = False
        server.healthy = False
        self._save_registry()
        return {"status": "disconnected", "name": name}

    async def delete_server(self, name: str) -> dict:
        """Remove a server from the registry entirely."""
        if name not in self.servers:
            return {"error": f"Server '{name}' not found"}
        del self.servers[name]
        self._save_registry()
        return {"status": "deleted", "name": name}

    async def reconnect_server(self, name: str) -> dict:
        """Re-enable and re-handshake a disconnected server."""
        server = self.servers.get(name)
        if not server:
            return {"error": f"Server '{name}' not found"}
        server.enabled = True
        server.healthy = await self._initialize_handshake(server)
        if server.healthy:
            server.tools = await self._discover_tools(server)
        self._save_registry()
        return {
            "status": "reconnected",
            "name": name,
            "healthy": server.healthy,
            "tools_discovered": len(server.tools),
        }

    async def get_server_tools(self, name: str) -> list[dict]:
        """Get the discovered tools for a specific server in real-time."""
        server = self.servers.get(name)
        if not server:
            return []
        # Always fetch in real-time to ensure the tool list is fresh
        if server.healthy:
            server.tools = await self._discover_tools(server)
            self._save_registry()
        return server.tools


# Singleton instance
mcp_manager = MCPManager()
