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
        info = MCPServerInfo(name=name, url=url, protocol=protocol,
                            enabled=True, description=description)

        # Perform MCP initialize handshake
        init_ok = await self._initialize_handshake(info)
        info.healthy = init_ok

        if init_ok:
            # Discover tools
            info.tools = await self._discover_tools(info)

        self.servers[name] = info
        self._save_registry()

        return {
            "name": name,
            "url": url,
            "healthy": init_ok,
            "tools_discovered": len(info.tools),
        }

    async def _initialize_handshake(self, server: MCPServerInfo) -> bool:
        """Perform MCP JSON-RPC initialize handshake."""
        try:
            async with httpx.AsyncClient(timeout=10) as client:
                resp = await client.post(
                    f"{server.url}/mcp",
                    json={
                        "jsonrpc": "2.0",
                        "id": 1,
                        "method": "initialize",
                        "params": {
                            "protocolVersion": "2025-06-18",
                            "capabilities": {},
                        },
                    },
                )
                if resp.status_code == 200:
                    data = resp.json()
                    if "result" in data:
                        logger.info("MCP handshake successful with %s", server.name)
                        return True
        except Exception as e:
            logger.warning("MCP handshake failed with %s: %s", server.name, e)
        return False

    async def _discover_tools(self, server: MCPServerInfo) -> list[dict]:
        """Discover available tools from an MCP server."""
        try:
            async with httpx.AsyncClient(timeout=10) as client:
                resp = await client.post(
                    f"{server.url}/mcp",
                    json={
                        "jsonrpc": "2.0",
                        "id": 2,
                        "method": "tools/list",
                        "params": {},
                    },
                )
                if resp.status_code == 200:
                    data = resp.json()
                    tools = data.get("result", {}).get("tools", [])
                    logger.info("Discovered %d tools from %s", len(tools), server.name)
                    return tools
        except Exception as e:
            logger.warning("Tool discovery failed for %s: %s", server.name, e)
        return []

    async def execute_tool(self, server_name: str, tool_name: str, arguments: dict) -> dict:
        """Proxy a tool call to the appropriate MCP server."""
        server = self.servers.get(server_name)
        if not server:
            return {"error": f"MCP server '{server_name}' not found"}

        if not server.enabled:
            return {"error": f"MCP server '{server_name}' is disabled"}

        try:
            async with httpx.AsyncClient(timeout=30) as client:
                resp = await client.post(
                    f"{server.url}/mcp",
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
                    data = resp.json()
                    if "result" in data:
                        return {"result": data["result"], "server": server_name, "tool": tool_name}
                    elif "error" in data:
                        return {"error": data["error"].get("message", "MCP call failed")}

                return {"error": f"MCP server returned {resp.status_code}"}
        except Exception as e:
            return {"error": f"MCP execution failed: {str(e)}"}

    async def health_check_all(self):
        """Check health of all registered MCP servers."""
        for server in self.servers.values():
            if server.enabled:
                server.healthy = await self._initialize_handshake(server)


# Singleton instance
mcp_manager = MCPManager()
