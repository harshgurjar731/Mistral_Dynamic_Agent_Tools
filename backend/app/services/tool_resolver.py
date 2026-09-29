"""
Tool Resolver — HTTP calls to Docker Tool Service.
Handles tool discovery, synthesis triggers, and schema fetching.
"""

import asyncio
import httpx
import logging
import time
from hashlib import sha256
import json
from app.config import settings

logger = logging.getLogger(__name__)


def resolution_to_result(resolution) -> dict:
    """A CodeResolution in the result shape callers of this client expect."""
    status = {
        "built": "approved", "reused": "approved",
        "pending_approval": "pending_approval",
    }.get(resolution.status, "failed")
    result = resolution.as_dict()
    result["status"] = status
    result["resolution"] = resolution.status
    if resolution.status == "reused" and not resolution.message:
        result["message"] = f"Reused existing {resolution.purpose} '{resolution.name}'"
    return result


#: Failures where the request provably never reached the Tool Service, so
#: sending it again cannot run anything twice.
_NOT_SENT = (httpx.ConnectError, httpx.ConnectTimeout)


class ToolServiceUnavailable(Exception):
    """The Tool Service refused connections for the whole wait budget."""


class ToolResolver:
    """Communicates with the Docker Tool Service over HTTP."""

    def __init__(self, base_url: str = None):
        self.base_url = base_url or settings.TOOL_SERVICE_URL
        self._client = httpx.AsyncClient(base_url=self.base_url, timeout=180.0)

    async def _send(self, method: str, url: str, *, wait: float | None = None,
                    read_only: bool = False, **kwargs) -> httpx.Response:
        """Send one request, riding out a Tool Service restart.

        A refused connection is retried with backoff for up to ``wait`` seconds
        (``TOOL_SERVICE_WAIT_SECONDS`` by default). Only failures where the
        request never reached the service are retried — an execution is never
        sent twice. ``read_only`` requests also retry a 502/503/504 from a proxy.

        Raises :class:`ToolServiceUnavailable` when the service stays down.
        """
        budget = settings.TOOL_SERVICE_WAIT_SECONDS if wait is None else wait
        deadline = time.monotonic() + max(0.0, budget)
        delay, warned = 1.0, False
        while True:
            try:
                resp = await self._client.request(method, url, **kwargs)
                if not (read_only and resp.status_code in (502, 503, 504)):
                    return resp
                problem = f"HTTP {resp.status_code}"
            except _NOT_SENT as e:
                problem = type(e).__name__
            if time.monotonic() + delay > deadline:
                raise ToolServiceUnavailable(
                    f"Tool Service unreachable at {self.base_url} "
                    f"({problem}; waited {budget:.0f}s for it to come back)"
                )
            if not warned:
                logger.warning("Tool Service at %s not answering (%s) — retrying for up to %.0fs",
                               self.base_url, problem, budget)
                warned = True
            await asyncio.sleep(delay)
            delay = min(delay * 2, 10.0)

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

    # ── Synthesis jobs ──────────────────────────────────────────────────
    #
    # Synthesis takes minutes with reasoning models. It runs as a job on the
    # tool service; this client submits it and follows its progress. The old
    # blocking POST /synthesize under a 180s client timeout gave up while the
    # service carried on, so a tool could appear after the workflow had
    # already recorded that building it failed.

    async def submit_job(self, spec: dict) -> dict:
        """Queue a synthesis job. Returns ``{"job_id", ...}`` or ``{"status": "error"}``."""
        try:
            resp = await self._send("POST", "/synthesis/jobs", json=spec, timeout=30.0)
            if resp.status_code in (200, 202):
                return resp.json()
            return {"status": "error",
                    "message": f"Tool Service returned {resp.status_code}: {resp.text[:500]}"}
        except ToolServiceUnavailable as e:
            return {"status": "error", "message": str(e)}
        except Exception as e:
            return {"status": "error", "message": f"{type(e).__name__}: {e}"}

    async def await_job(self, job_id: str, on_event=None, timeout: float = 1200.0) -> dict:
        """Follow a job to its result, streaming progress to ``on_event(event)``.

        Streams Server-Sent Events; if the stream drops, falls back to polling,
        so a proxy that buffers SSE costs only latency, not the result.
        """
        deadline = time.monotonic() + timeout
        try:
            async with self._client.stream(
                "GET", f"/synthesis/jobs/{job_id}/events", params={"since": 0},
                timeout=httpx.Timeout(timeout, connect=10.0),
            ) as resp:
                if resp.status_code == 200:
                    event_name, data_lines = "", []
                    async for line in resp.aiter_lines():
                        if line.startswith("event:"):
                            event_name = line[6:].strip()
                        elif line.startswith("data:"):
                            data_lines.append(line[5:].strip())
                        elif line == "" and data_lines:
                            payload = json.loads("\n".join(data_lines))
                            data_lines = []
                            if event_name == "result" and isinstance(payload, dict):
                                return payload
                            if event_name == "progress" and on_event:
                                try:
                                    on_event(payload)
                                except Exception:
                                    logger.debug("progress callback failed", exc_info=True)
        except Exception as e:
            logger.info("Job %s event stream ended (%s) — polling", job_id, type(e).__name__)

        while time.monotonic() < deadline:
            try:
                resp = await self._client.get(f"/synthesis/jobs/{job_id}", timeout=15.0)
                if resp.status_code == 200:
                    info = resp.json()
                    if info.get("result"):
                        return info["result"]
                elif resp.status_code == 404:
                    return {"status": "error", "message": f"Synthesis job {job_id} not found"}
            except Exception as e:
                logger.debug("Polling job %s failed: %s", job_id, e)
            await asyncio.sleep(2.0)
        return {"status": "failed", "job_id": job_id,
                "message": f"Synthesis job {job_id} did not finish in {timeout:.0f}s"}

    async def run_synthesis(self, spec: dict, on_event=None) -> dict:
        """Submit ``spec`` (SynthesisSpec v2) and wait for the outcome.

        A version held for approval is approved here — the platform has always
        auto-approved so a plan is never blocked on a review queue — unless the
        tool service says a person *must* review it (declared write/delete side
        effects). That one is left pending.
        """
        submitted = await self.submit_job(spec)
        job_id = submitted.get("job_id")
        if not job_id:
            return {"status": "error", "tool_name": spec.get("name"),
                    "message": submitted.get("message", "could not submit synthesis job")}
        result = await self.await_job(job_id, on_event=on_event)
        result.setdefault("tool_name", spec.get("name"))

        if (result.get("status") == "pending_approval" and result.get("tool_id")
                and not result.get("review_required")):
            approved = await self.approve_tool(result["tool_id"])
            if approved.get("status") == "approved":
                result["status"] = "approved"
                result["message"] = "Built, verified and auto-approved"
            else:
                logger.warning("Auto-approve failed for '%s': %s", spec.get("name"), approved)
        return result

    async def trigger_synthesis(
        self, name: str, description: str, parameters: dict, required: list[str],
        api_details: str = "No external API. This is a pure computation using standard library.",
        expected_output_shape: str = "A dictionary containing the result.",
        purpose: str = "tool",
        **v2_fields,
    ) -> dict:
        """Legacy entry point: build a spec from v1 fields and run synthesis.

        New code goes through the code-requirement pipeline (``app.layers.codegen``),
        which authors a full v2 spec with an output contract and worked examples.
        """
        spec = {
            "name": str(name),
            "description": str(description) if description else f"Tool {name}",
            "parameters": parameters if isinstance(parameters, dict) else {},
            "required": required if isinstance(required, list) else [],
            "api_details": str(api_details) if api_details
            else "No external API. This is a pure computation using the standard library.",
            "expected_output_shape": str(expected_output_shape or ""),
            "purpose": purpose if purpose in ("tool", "activity") else "tool",
            **{k: v for k, v in v2_fields.items() if v is not None},
        }
        return await self.run_synthesis(spec)

    async def execute_tool(self, tool_name: str, arguments: dict, version: int | None = None) -> dict:
        """Execute a tool via the Docker Tool Service; ``version`` pins one."""
        try:
            body = {"arguments": arguments}
            if version is not None:
                body["version"] = int(version)
            resp = await self._send("POST", f"/execute/{tool_name}", json=body)
            if resp.status_code == 200:
                return resp.json()
            else:
                return {"error": f"Tool Service returned {resp.status_code}: {resp.text}"}
        except ToolServiceUnavailable as e:
            return {"error": str(e)}
        except Exception as e:
            return {"error": str(e)}

    async def get_tool(self, tool_id: int) -> dict | None:
        """One version by id, superseded versions included."""
        try:
            resp = await self._send("GET", f"/tools/{int(tool_id)}", read_only=True, wait=15)
            if resp.status_code == 200:
                return resp.json()
        except Exception as e:
            logger.warning("Tool lookup %s failed: %s", tool_id, e)
        return None

    async def activate_tool(self, tool_id: int) -> dict:
        """Make an approved version the active one (rollback / roll-forward)."""
        try:
            resp = await self._client.post(f"/tools/{int(tool_id)}/activate")
            return resp.json()
        except Exception as e:
            return {"error": str(e)}

    async def get_tool_versions(self, name: str) -> list[dict]:
        """Every version of one tool, newest first."""
        try:
            resp = await self._send("GET", f"/tools/{name}/versions", read_only=True, wait=15)
            if resp.status_code == 200:
                return resp.json().get("tools", [])
        except Exception as e:
            logger.warning("Version lookup for '%s' failed: %s", name, e)
        return []

    async def list_tools(self) -> list[dict]:
        """Fetch all tool schemas from the Docker Tool Service."""
        try:
            resp = await self._send("GET", "/tools", read_only=True, wait=15)
            if resp.status_code == 200:
                data = resp.json()
                return data.get("tools", [])
        except Exception as e:
            # Name the type: several httpx errors (dropped connections) carry an empty message.
            logger.warning("Failed to list tools from Tool Service: %s: %s", type(e).__name__, e)
        return []

    async def get_pending_tools(self) -> list[dict]:
        """Fetch pending tools from the Docker Tool Service."""
        try:
            resp = await self._send("GET", "/tools/pending", read_only=True, wait=15)
            if resp.status_code == 200:
                return resp.json()
        except Exception:
            pass
        return []

    async def approve_tool(self, tool_id: int) -> dict:
        """Approve a tool via the Docker Tool Service."""
        try:
            resp = await self._send("POST", f"/tools/{tool_id}/approve")
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
            resp = await self._send("DELETE", f"/tools/{tool_id}")
            return resp.json()
        except Exception as e:
            return {"error": str(e)}

    async def update_tool(self, tool_id: int, source_code: str, description: str, purpose: str | None = None) -> dict:
        """Update a tool's code, description and (optionally) purpose via the Docker Tool Service."""
        try:
            body = {"source_code": source_code, "description": description}
            if purpose:
                body["purpose"] = purpose
            resp = await self._client.put(f"/tools/{tool_id}", json=body)
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

    async def synthesize_from_task(self, task: str, purpose: str = "tool", on_event=None) -> dict:
        """Build a tool or activity from a plain-English request.

        Runs the code-requirement pipeline: normalise the request, screen it,
        check the catalogue for something that already does it, author a v2
        specification (output contract, worked examples), and build it.
        """
        from app.core.specs import CodeNeed
        from app.layers.codegen import resolve_code_need

        need = CodeNeed(purpose=purpose if purpose in ("tool", "activity") else "tool",
                        origin="explicit", intent=str(task or "").strip())
        resolution = await resolve_code_need(need, on_event=on_event)
        return resolution_to_result(resolution)

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

    async def delete_mcp_server(self, name: str) -> dict:
        """Delete an MCP server."""
        try:
            resp = await self._client.delete(f"/mcp/servers/{name}")
            return resp.json()
        except Exception as e:
            return {"error": str(e)}

    async def disconnect_mcp_server(self, name: str) -> dict:
        """Disconnect an MCP server."""
        try:
            resp = await self._client.post(f"/mcp/servers/{name}/disconnect")
            return resp.json()
        except Exception as e:
            return {"error": str(e)}

    async def reconnect_mcp_server(self, name: str) -> dict:
        """Reconnect an MCP server."""
        try:
            resp = await self._client.post(f"/mcp/servers/{name}/reconnect")
            return resp.json()
        except Exception as e:
            return {"error": str(e)}

    async def get_mcp_server_tools(self, name: str) -> dict:
        """Get tools from an MCP server."""
        try:
            resp = await self._client.get(f"/mcp/servers/{name}/tools")
            if resp.status_code == 200:
                return resp.json()
        except Exception as e:
            logger.warning("Failed to get MCP server tools: %s", e)
        return {"tools": []}

    async def publish_tool_to_mcp(self, tool_id: int, server_name: str) -> dict:
        """Publish a tool to an MCP server."""
        try:
            resp = await self._client.post(f"/tools/{tool_id}/publish-mcp", json={"server_name": server_name})
            return resp.json()
        except Exception as e:
            return {"error": str(e)}


# Singleton instance
tool_resolver = ToolResolver()
