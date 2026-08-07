---
name: mistral-mcp-server
description: "Use this skill whenever building, debugging, or deploying a remote MCP server intended to be registered as a Mistral Connector. Covers transport selection, server structure, Railway deployment, authentication, connector registration, and all known Mistral-specific compatibility rules. Trigger on: 'build MCP server', 'Mistral connector', 'FastMCP', 'connector debugger error', 'transport_detection', '405 Method Not Allowed on /sse'."
compatibility: "Python 3.11+, FastMCP, Railway, Mistral Studio / Connectors API (Public Preview)"
---

# Mistral MCP Server — Build & Deployment Skill

## Why this skill exists

Mistral Connectors are registered MCP servers. Mistral's MCP client implements the
**Streamable HTTP transport** from spec `2025-03-26`. Most tutorials and libraries
default to the old **SSE transport** (GET /sse + POST /messages). These two are
incompatible. If you deploy with the old transport, the Connector Debugger returns
`transport_detection → 405 Method Not Allowed` every time.

This skill gives you the complete mental model and copy-paste templates to build
a server that passes Mistral's debugger on the first try.

---

## 1. The Two Transports — Know This Cold

### Old SSE Transport (BROKEN with Mistral)

```
GET  /sse       → opens SSE stream (server → client events)
POST /messages  → sends JSON-RPC (client → server)
```

Mistral's client does NOT use this. It POSTs JSON-RPC directly to the endpoint
you register. If your server only accepts GET on that path, you get 405.

### New Streamable HTTP Transport (REQUIRED by Mistral)

```
POST /mcp   → client sends JSON-RPC initialize/tool calls
              server responds with either:
              - application/json        (single response)
              - text/event-stream       (streaming response)
GET  /mcp   → optional, server-initiated messages
```

Single endpoint. Accepts POST. Mistral always sends the MCP `initialize` handshake
as a POST first. Your server must handle this.

**Rule: Never register a `/sse` URL with Mistral. Always use `/mcp` (or any
Streamable HTTP endpoint).**

---

## 2. Transport Detection — What Mistral's Debugger Checks

The debugger runs these steps in order. All must pass:

| Step | What it checks |
|---|---|
| `transport_detection` | POSTs `initialize` to your URL. Expects 200 + valid JSON-RPC response |
| `authentication` | Validates header/OAuth if configured |
| `tool_discovery` | Calls `tools/list` — expects array of tool objects |
| `tool_validation` | Checks each tool has `name`, `description`, `inputSchema` |

A 405 on `transport_detection` means: wrong transport. Your `/sse` endpoint
only allows GET. Fix = switch to Streamable HTTP.

---

## 3. Minimal Working Server (FastMCP)

```python
# server.py
from fastmcp import FastMCP

# FastMCP defaults to streamable-http transport
# This is the ONLY transport Mistral's connector can reach
mcp = FastMCP(
    name="my-agent-server",
    instructions="You help with X. Use the provided tools.",
)

@mcp.tool()
def echo_message(message: str) -> str:
    """Echo back the provided message for testing."""
    return f"Echo: {message}"

@mcp.tool()
def get_status() -> dict:
    """Return server health status."""
    return {"status": "ok", "version": "1.0.0"}

if __name__ == "__main__":
    # transport="http" = Streamable HTTP (spec 2025-03-26)
    # host="0.0.0.0" is required on Railway (not 127.0.0.1)
    # port must match Railway's $PORT env var
    import os
    port = int(os.getenv("PORT", 8000))
    mcp.run(transport="http", host="0.0.0.0", port=port)
```

The default path FastMCP mounts the Streamable HTTP transport on is `/mcp`.
Your connector URL in Mistral should be:
```
https://your-service.up.railway.app/mcp
```
NOT `/sse`.

---

## 4. Full Production Template

```python
# server.py
import os
import logging
from contextlib import asynccontextmanager
from typing import Any

from fastmcp import FastMCP
from fastmcp.exceptions import ToolError

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# ── Lifespan (startup / shutdown) ──────────────────────────────────────────
@asynccontextmanager
async def lifespan(app):
    logger.info("MCP server starting up")
    # Init DB connections, load models, etc.
    yield
    logger.info("MCP server shutting down")

# ── Server definition ───────────────────────────────────────────────────────
mcp = FastMCP(
    name="dynamic-agent-mcp",
    instructions=(
        "You are a dynamic agent server. "
        "Use the available tools to answer questions accurately."
    ),
    lifespan=lifespan,
)

# ── Tools ───────────────────────────────────────────────────────────────────
@mcp.tool()
def example_tool(query: str, limit: int = 10) -> dict[str, Any]:
    """
    Perform an example operation.

    Args:
        query: The search query string.
        limit: Maximum number of results to return (default 10).

    Returns:
        Dictionary with results and metadata.
    """
    if not query.strip():
        raise ToolError("query cannot be empty")

    return {
        "query": query,
        "results": [],
        "total": 0,
        "limit": limit,
    }

# ── Entry point ─────────────────────────────────────────────────────────────
if __name__ == "__main__":
    port = int(os.getenv("PORT", 8000))
    mcp.run(
        transport="http",        # Streamable HTTP — REQUIRED for Mistral
        host="0.0.0.0",          # Required on Railway
        port=port,
        # path="/mcp",           # Default. Change if needed.
    )
```

---

## 5. Railway-Specific Requirements

### Procfile or start command

```
# Procfile
web: python server.py
```

Or in `railway.toml`:
```toml
[deploy]
startCommand = "python server.py"
healthcheckPath = "/mcp"
healthcheckTimeout = 10
```

### Environment variables needed on Railway

| Variable | Value | Notes |
|---|---|---|
| `PORT` | Set by Railway automatically | Your server MUST read `$PORT` |
| `PYTHONUNBUFFERED` | `1` | Shows logs in real time |
| `API_KEY` | your secret | If you want bearer token auth |

### Requirements (requirements.txt)

```
fastmcp>=2.0.0
httpx
```

### Critical Railway gotchas

- **Always bind to `0.0.0.0`**, never `localhost` or `127.0.0.1`. Railway's
  reverse proxy (Hikari) routes external traffic to `0.0.0.0:$PORT`.
- **Read `$PORT` from env**. Railway assigns the port. Hardcoding 8000 may work
  locally but can break under Railway's routing.
- **Railway health checks**: if you set a health check path, make sure your
  server responds to `GET /mcp` or `GET /health`. FastMCP's Streamable HTTP
  transport responds to GET on the `/mcp` path.
- **Restart policy**: set to `on-failure` so Railway restarts on crash.
- The error header `x-hikari-trace: jfk1.pqzh` confirms Railway received the
  request and rejected it (405) before your app even handled it — meaning your
  FastAPI/FastMCP app returned 405 on GET, which is correct for `/sse` but wrong
  for the path Mistral is trying to POST to.

---

## 6. Connector Registration in Mistral Studio

### Via API (Python)

```python
import asyncio
from mistralai.client import Mistral

client = Mistral(api_key="your-api-key")

async def register():
    connector = await client.beta.connectors.create_async(
        name="dynamic_agent_mcp",               # alphanumeric + _ + - only, max 64 chars
        description="Dynamic agent MCP server", # shown to users
        server="https://your-service.up.railway.app/mcp",  # MUST be /mcp not /sse
        visibility="private",                   # private | shared_workspace | shared_org
        # headers={"Authorization": "Bearer YOUR_SECRET"},  # if you added auth
    )
    print(f"Registered: {connector.id}")

asyncio.run(register())
```

### Connector name rules

- Max 64 characters
- Only alphanumeric characters, underscores, dashes
- Must be unique in your workspace
- Can reference by name OR UUID in subsequent API calls

### Visibility scopes

| Scope | Who can use |
|---|---|
| `private` | Only the creator |
| `shared_workspace` | Everyone in the workspace |
| `shared_org` | Everyone in the org (org admin only) |

---

## 7. Authentication Patterns

### Pattern A: No auth (dev/internal only)

Register with no `headers` or `auth_data`. Fine for internal tools.

### Pattern B: Static API key (recommended for most cases)

Add a bearer token check in your server:

```python
# server.py
import os
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse

API_KEY = os.getenv("API_KEY", "")

class BearerAuthMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        if API_KEY:  # Only enforce if key is set
            auth = request.headers.get("Authorization", "")
            if auth != f"Bearer {API_KEY}":
                return JSONResponse(
                    {"error": "unauthorized"},
                    status_code=401,
                    headers={"WWW-Authenticate": "Bearer"},
                )
        return await call_next(request)
```

Register the connector with the static header:

```python
connector = await client.beta.connectors.create_async(
    name="secure_agent",
    server="https://your-service.up.railway.app/mcp",
    headers={"Authorization": f"Bearer {YOUR_API_KEY}"},
    visibility="private",
)
```

In the Debugger, set:
- Credentials → Custom header
- Header name: `Authorization`
- Header value: `Bearer YOUR_TOKEN`

### Pattern C: OAuth 2.0

Only use if your MCP server is an OAuth resource server (e.g. wrapping Gmail, Slack).
Mistral handles the redirect flow. You must configure the redirect URI:
```
https://console.mistral.ai/build/connectors/debugger/oauth-callback
```
Note: Mistral does not support passing tokens programmatically — OAuth must be
done through Studio UI.

---

## 8. Tool Design Rules (Critical for Mistral Compatibility)

### Tool schema requirements

Every tool MUST have:
- `name`: string, unique within the server
- `description`: clear natural-language description of what the tool does
- `inputSchema`: valid JSON Schema object

```python
# Good — Mistral can discover and call this
@mcp.tool()
def search_documents(
    query: str,
    collection: str,
    top_k: int = 5
) -> list[dict]:
    """
    Search documents in a vector collection.

    Args:
        query: Natural language search query.
        collection: Name of the collection to search.
        top_k: Number of results to return (default 5, max 20).

    Returns:
        List of document chunks with scores.
    """
    ...
```

```python
# Bad — missing description, Mistral model won't know when to call this
@mcp.tool()
def do_thing(x):
    pass
```

### Tool return types

Return JSON-serializable types only:
- `str`, `int`, `float`, `bool`
- `dict`, `list`
- Pydantic models (FastMCP serializes them)

Do not return raw file bytes, non-serializable objects, or raise unhandled exceptions.

### Tool naming

- Snake_case only
- Descriptive: `search_rag_index` not `search`
- No spaces or special characters

### Error handling

Raise `ToolError` from `fastmcp.exceptions` for user-facing errors. Mistral
surfaces these in the `isError: true` content block.

```python
from fastmcp.exceptions import ToolError

@mcp.tool()
def risky_operation(doc_id: str) -> dict:
    """..."""
    if not doc_id:
        raise ToolError("doc_id is required")
    result = fetch_doc(doc_id)
    if result is None:
        raise ToolError(f"Document '{doc_id}' not found")
    return result
```

---

## 9. Using a Connector in Conversations

### Basic conversation

```python
response = await client.beta.conversations.start_async(
    model="mistral-small-latest",
    inputs=[{"role": "user", "content": "Run a search for AI trends."}],
    tools=[
        {
            "type": "connector",
            "connector_id": "dynamic_agent_mcp",  # name or UUID
        }
    ],
)
```

### Filter which tools the model can call

```python
tools=[
    {
        "type": "connector",
        "connector_id": "dynamic_agent_mcp",
        "tool_configuration": {
            "include": ["search_documents"],   # allowlist
            # "exclude": ["dangerous_tool"],  # or blocklist — not both
        },
    }
]
```

### Mix with built-in tools

```python
tools=[
    {"type": "web_search"},
    {"type": "connector", "connector_id": "dynamic_agent_mcp"},
]
```

### Attach to an Agent permanently

```python
agent = await client.beta.agents.create_async(
    name="rag_agent",
    model="mistral-small-latest",
    instructions="You are a RAG agent. Always search before answering.",
    tools=[{"type": "connector", "connector_id": "dynamic_agent_mcp"}],
)
# Now start conversations with agent_id instead of model
response = await client.beta.conversations.start_async(
    agent_id=agent.id,  # NOT model= here
    inputs=[{"role": "user", "content": "..."}],
)
```

### Direct tool call (no model involved)

```python
result = await client.beta.connectors.call_tool_async(
    connector_id_or_name="dynamic_agent_mcp",
    tool_name="search_documents",
    arguments={"query": "LLM evaluation", "collection": "papers", "top_k": 3},
)
for item in result.content:
    if hasattr(item, "text"):
        print(item.text)
```

---

## 10. Human-in-the-loop (Optional)

Gate specific tool calls for approval before they run:

```python
tools=[
    {
        "type": "connector",
        "connector_id": "dynamic_agent_mcp",
        "tool_configuration": {
            "requires_confirmation": ["delete_document", "update_record"],
        },
    }
]
```

When these tools are triggered, Mistral returns a `function.call` with
`confirmation_status: "pending"` instead of executing. You then approve or deny:

```python
# Approve
await client.beta.conversations.continue_async(
    conversation_id=conv_id,
    tool_confirmations=[{"tool_call_id": tc_id, "confirmation": "allow"}],
)

# Deny
await client.beta.conversations.continue_async(
    conversation_id=conv_id,
    tool_confirmations=[{"tool_call_id": tc_id, "confirmation": "deny"}],
)
```

---

## 11. Debugging Checklist

### Step 1: Confirm transport

```bash
# Test from your local machine or Railway shell
curl -X POST https://your-service.up.railway.app/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"test","version":"1.0.0"}}}'
```

Expected: `200 OK` with JSON body containing `result.serverInfo`.
If you get 405: your server is still using old SSE transport.
If you get 404: wrong path — check if FastMCP mounted at `/mcp` or different path.

### Step 2: Confirm tool discovery

```bash
curl -X POST https://your-service.up.railway.app/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}'
```

Expected: `200 OK` with `result.tools` array.

### Step 3: Run Mistral Connector Debugger

Studio → Connectors → Debugger
URL: `https://your-service.up.railway.app/mcp`
Credentials: Custom header if you added auth.

### Common errors and fixes

| Error | Cause | Fix |
|---|---|---|
| `405 on /sse` | Old SSE transport | Switch to `transport="http"` in FastMCP |
| `404 on /mcp` | Wrong path or not mounted | Check FastMCP version; default path is `/mcp` |
| `connection refused` | Server not bound to 0.0.0.0 | Add `host="0.0.0.0"` to `mcp.run()` |
| `401 Unauthorized` | Missing/wrong auth header | Check header name is `Authorization` |
| Tool not found | Wrong tool name in `call_tool_async` | Run `list_tools_async` to verify exact names |
| `tools/list` empty | Tools not registered | Decorate with `@mcp.tool()` before `mcp.run()` |
| Init fails, missing `serverInfo` | Non-spec-compliant response | Use FastMCP >= 2.0 — it handles this automatically |
| HTML response instead of JSON | Wrong URL (hitting a web app not MCP) | Confirm URL resolves to the MCP endpoint specifically |

---

## 12. Connector Lifecycle (Full Flow)

```
1. Deploy server to Railway
   └── Binds to 0.0.0.0:$PORT
   └── Mounts Streamable HTTP at POST /mcp

2. Validate in Debugger
   └── Studio → Connectors → Debugger
   └── Enter: https://your-service.up.railway.app/mcp
   └── All steps must pass (transport, tools, validation)

3. Register Connector
   └── client.beta.connectors.create_async(server="...../mcp")
   └── Gets connector ID + name

4. (Optional) Authenticate
   └── Static: pass headers={"Authorization": "Bearer TOKEN"}
   └── OAuth: user completes redirect flow in Studio

5. Discover tools
   └── client.beta.connectors.list_tools_async("connector_name")
   └── Confirms tool names before using in conversations

6. Use in conversations
   └── tools=[{"type": "connector", "connector_id": "..."}]
   └── Model auto-discovers and calls relevant tools

7. Update / delete
   └── client.beta.connectors.update_async(connector_id=uuid, ...)
   └── client.beta.connectors.delete_async(connector_id=uuid)
```

---

## 13. File Structure for a Railway MCP Server

```
project/
├── server.py             # Main MCP server
├── tools/
│   ├── __init__.py
│   ├── search.py         # Tool implementations
│   └── agents.py
├── requirements.txt
├── Procfile              # web: python server.py
├── railway.toml          # Optional Railway config
└── .env.example          # API_KEY=, PORT=8000
```

---

## 14. MCP Protocol Version

Mistral's client handshakes with `protocolVersion: "2025-03-26"` (as seen in the
debugger's POST body). FastMCP >= 2.0 supports this natively. If you're on an
older version or building your own server, ensure your `initialize` response
returns:

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "protocolVersion": "2025-03-26",
    "serverInfo": {
      "name": "your-server-name",
      "version": "1.0.0"
    },
    "capabilities": {
      "tools": {}
    }
  }
}
```

Missing `serverInfo` or mismatched `protocolVersion` causes the init step to fail.

---

## 15. Quick Reference — What NOT to do

- Do NOT use `transport="sse"` — it creates a GET-only `/sse` endpoint
- Do NOT bind to `127.0.0.1` on Railway
- Do NOT hardcode a port; always read `$PORT` from env
- Do NOT return non-serializable objects from tools
- Do NOT register a URL ending in `/sse` with Mistral Connectors
- Do NOT mix `model=` and `agent_id=` in the same `conversations.start_async` call
- Do NOT pass `include` and `exclude` in `tool_configuration` at the same time
- Do NOT use OAuth for passing tokens programmatically — use `headers` for static keys

---

## Sources

- https://docs.mistral.ai/studio-api/connectors
- https://docs.mistral.ai/studio-api/connectors/management
- https://docs.mistral.ai/studio-api/connectors/debugger
- https://docs.mistral.ai/studio-api/connectors/conversations
- https://docs.mistral.ai/studio-api/connectors/tool_calling
- https://docs.mistral.ai/studio-api/connectors/confirmation
- https://modelcontextprotocol.io/ (MCP spec 2025-03-26)
