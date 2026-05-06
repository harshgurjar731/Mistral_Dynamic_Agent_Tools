"""
Tool Resolver — HTTP calls to Docker Tool Service.
Handles tool discovery, synthesis triggers, and schema fetching.
"""

import httpx
import logging
from hashlib import sha256
import json
from app.config import settings

logger = logging.getLogger(__name__)


class ToolResolver:
    """Communicates with the Docker Tool Service over HTTP."""

    def __init__(self, base_url: str = None):
        self.base_url = base_url or settings.TOOL_SERVICE_URL
        self._client = httpx.AsyncClient(base_url=self.base_url, timeout=60.0)

    async def health_check(self) -> bool:
        """Check if the Tool Service is reachable."""
        try:
            resp = await self._client.get("/health", timeout=3.0)
            return resp.status_code == 200
        except Exception:
            return False

    async def get_tool_by_hash(self, name: str, description: str, parameters: dict) -> dict | None:
        """Look up a tool by content hash. Returns tool record or None."""
        schema_str = json.dumps({"name": name, "description": description, "parameters": parameters}, sort_keys=True)
        content_hash = sha256(schema_str.encode()).hexdigest()

        try:
            resp = await self._client.get(f"/tools/by-hash/{content_hash}")
            if resp.status_code == 200:
                return resp.json()
        except Exception as e:
            logger.warning("Tool lookup failed: %s", e)
        return None

    async def trigger_synthesis(self, name: str, description: str, parameters: dict, required: list[str]) -> dict:
        """Trigger tool synthesis on the Docker Tool Service."""
        try:
            resp = await self._client.post("/synthesize", json={
                "name": name,
                "description": description,
                "parameters": parameters,
                "required": required,
            })
            return resp.json()
        except httpx.ConnectError:
            logger.error("Cannot reach Tool Service at %s", self.base_url)
            return {"status": "error", "message": f"Tool Service unreachable at {self.base_url}"}
        except Exception as e:
            logger.error("Synthesis trigger failed: %s", e)
            return {"status": "error", "message": str(e)}

    async def execute_tool(self, tool_name: str, arguments: dict) -> dict:
        """Execute a tool via the Docker Tool Service."""
        try:
            resp = await self._client.post(f"/execute/{tool_name}", json={"arguments": arguments})
            if resp.status_code == 200:
                return resp.json()
            else:
                return {"error": f"Tool Service returned {resp.status_code}: {resp.text}"}
        except httpx.ConnectError:
            return {"error": f"Tool Service unreachable at {self.base_url}"}
        except Exception as e:
            return {"error": str(e)}

    async def list_tools(self) -> list[dict]:
        """Fetch all tool schemas from the Docker Tool Service."""
        try:
            resp = await self._client.get("/tools")
            if resp.status_code == 200:
                data = resp.json()
                return data.get("tools", [])
        except Exception as e:
            logger.warning("Failed to list tools from Tool Service: %s", e)
        return []

    async def get_pending_tools(self) -> list[dict]:
        """Fetch pending tools from the Docker Tool Service."""
        try:
            resp = await self._client.get("/tools/pending")
            if resp.status_code == 200:
                return resp.json()
        except Exception:
            pass
        return []

    async def approve_tool(self, tool_id: int) -> dict:
        """Approve a tool via the Docker Tool Service."""
        try:
            resp = await self._client.post(f"/tools/{tool_id}/approve")
            return resp.json()
        except Exception as e:
            return {"error": str(e)}

    async def reject_tool(self, tool_id: int) -> dict:
        """Reject a tool via the Docker Tool Service."""
        try:
            resp = await self._client.post(f"/tools/{tool_id}/reject")
            return resp.json()
        except Exception as e:
            return {"error": str(e)}

    async def delete_tool(self, tool_id: int) -> dict:
        """Delete a tool via the Docker Tool Service."""
        try:
            resp = await self._client.delete(f"/tools/{tool_id}")
            return resp.json()
        except Exception as e:
            return {"error": str(e)}

    async def update_tool(self, tool_id: int, source_code: str, description: str) -> dict:
        """Update a tool's code and description via the Docker Tool Service."""
        try:
            resp = await self._client.put(f"/tools/{tool_id}", json={
                "source_code": source_code,
                "description": description
            })
            return resp.json()
        except Exception as e:
            return {"error": str(e)}

    async def execute_mcp_tool(self, server: str, tool: str, arguments: dict) -> dict:
        """Execute a tool via an MCP server through the Docker Tool Service."""
        try:
            resp = await self._client.post(f"/mcp/execute/{server}/{tool}", json={"arguments": arguments})
            if resp.status_code == 200:
                return resp.json()
            return {"error": f"MCP execution returned {resp.status_code}: {resp.text}"}
        except Exception as e:
            return {"error": str(e)}

    async def get_tool_by_content_hash(self, content_hash: str) -> dict | None:
        """Look up a tool by its SHA-256 content hash."""
        try:
            resp = await self._client.get(f"/tools/by-hash/{content_hash}")
            if resp.status_code == 200:
                return resp.json()
            return None
        except Exception:
            return None

    async def synthesize_from_task(self, task: str) -> dict:
        """Trigger tool synthesis from a plain English task description by first generating a schema."""
        try:
            from mistralai.client import Mistral
            from app.config import settings
            import json

            client = Mistral(api_key=settings.MISTRAL_API_KEY, timeout_ms=120000)
            
            EXPLICIT_SYNTHESIS_PROMPT = """You are an expert AI tool designer.
The user will describe a tool they want to create. You must design and output the JSON schema for this tool.
Do NOT evaluate whether the tool is needed. Always create the schema.

You MUST respond with a valid JSON object with this exact structure:
{
  "tool_name": "name_in_snake_case",
  "tool_description": "Detailed description of what the tool does.",
  "parameters": {
    "type": "object",
    "properties": {
      "param1": {"type": "string", "description": "..."}
    }
  },
  "required": ["param1"]
}
"""

            result = client.chat.complete(
                model=settings.MISTRAL_CODING_MODEL,
                messages=[
                    {"role": "system", "content": EXPLICIT_SYNTHESIS_PROMPT},
                    {"role": "user", "content": f"Task Description: {task}"},
                ],
                temperature=0.1,
                response_format={"type": "json_object"},
            )

            raw = result.choices[0].message.content
            data = json.loads(raw)

            # Now that we have the schema, trigger the actual synthesis on the tool service
            return await self.trigger_synthesis(
                name=data.get("tool_name", "unknown"),
                description=data.get("tool_description", ""),
                parameters=data.get("parameters", {}),
                required=data.get("required", [])
            )
        except Exception as e:
            logger.error("Failed to parse task to schema: %s", e)
            return {"status": "error", "message": str(e)}

    async def list_mcp_servers(self) -> list:
        """List all registered MCP servers."""
        try:
            resp = await self._client.get("/mcp/servers")
            if resp.status_code == 200:
                return resp.json()
        except Exception:
            pass
        return []

    async def register_mcp_server(self, data: dict) -> dict:
        """Register a new MCP server."""
        try:
            resp = await self._client.post("/mcp/servers", json=data)
            return resp.json()
        except Exception as e:
            return {"error": str(e)}

    async def mcp_health_check(self) -> dict:
        """Ping all registered MCP servers."""
        try:
            resp = await self._client.post("/mcp/health-check")
            if resp.status_code == 200:
                return resp.json()
        except Exception:
            pass
        return {"error": "MCP health check failed"}


# Singleton instance
tool_resolver = ToolResolver()
