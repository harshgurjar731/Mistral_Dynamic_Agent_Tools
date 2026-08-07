# Dynamic MCP Tool Server — Analysis & Developer Guide

## 1. What This Is

A **dynamic MCP tool factory** deployed on Railway. You POST Python code to it via HTTP, and it:
1. Auto-detects pip dependencies (via Codestral)
2. Installs them in the container
3. Registers the code as an MCP tool (keyed on the `run()` function signature)
4. Exposes tools over **three transports**: plain HTTP REST, SSE (legacy), and Streamable HTTP (new)

Live at: `https://dynamicagentmcp-production-ae20.up.railway.app`

---

## 2. Current Live State (Verified)

| Check | Result |
|---|---|
| `/health` | ✅ 200 — `healthy`, 2 tools loaded |
| `/tools` | ✅ 200 — `greet`, `submit_code` registered |
| `POST /mcp` (initialize) | ✅ 200 — Returns `serverInfo`, protocol `2025-03-26` |
| `POST /mcp` (tools/list, with session) | ✅ 200 — Both tools returned with full `inputSchema` |
| `POST /mcp` (tools/call greet) | ✅ 200 — `"Hello, World! Welcome to the dynamic MCP server."` |
| `GET /sse` | ✅ 200 — Returns SSE stream with session endpoint |
| `POST /submit-code` | ✅ 200 — Tool submission works |

**Bottom line: The server is fully functional on all transports.**

---

## 3. All Endpoints — Practical Reference

### HTTP REST Endpoints (for humans/scripts)

These are standard FastAPI endpoints. Use `httpx`, `curl`, or any HTTP client.

#### `GET /health`
```bash
curl https://dynamicagentmcp-production-ae20.up.railway.app/health
```
```json
{"status": "healthy", "service": "dynamic-mcp-server", "tools_loaded": 2, "tool_names": ["greet", "submit_code"]}
```

#### `POST /submit-code`
Submit Python code to create a new MCP tool. The code **must** contain a `def run(...)` or `async def run(...)` function.

```bash
curl -X POST https://dynamicagentmcp-production-ae20.up.railway.app/submit-code \
  -H "Content-Type: application/json" \
  -d '{
    "name": "add_numbers",
    "description": "Add two numbers",
    "code": "def run(a: float, b: float) -> float:\n    \"\"\"Add two numbers.\"\"\"\\n    return a + b"
  }'
```

**Validation rules** (from [models.py](file:///c:/Users/Himanshu/Downloads/dynamic_mcp_railway/app/models.py)):
- `name`: 1-64 chars, lowercase, starts with letter, only `[a-z0-9_]`
- `description`: 1-500 chars
- `code`: must contain `def run(` or `async def run(`

#### `GET /tools`
List all registered tools with their manifests.

#### `DELETE /tools/{tool_name}`
Remove a tool. Triggers a full server reload.

#### `POST /reload`
Force a full reload — rebuilds the MCP instance and re-registers all tools from disk.

> [!WARNING]
> Both `DELETE` and `POST /reload` trigger `_do_full_reload()` which has a known bug (see §6).

---

### MCP Streamable HTTP Endpoint (for Mistral Connectors)

**Endpoint:** `POST /mcp`

This is the transport Mistral connectors use. It follows the MCP spec `2025-03-26`.

#### Step 1: Initialize (get a session)
```bash
curl -X POST https://dynamicagentmcp-production-ae20.up.railway.app/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"test","version":"1.0.0"}}}'
```
Response headers include `mcp-session-id: <session_id>`. **Save this** — all subsequent calls require it.

#### Step 2: List tools
```bash
curl -X POST https://dynamicagentmcp-production-ae20.up.railway.app/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -H "mcp-session-id: <SESSION_ID>" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}'
```

#### Step 3: Call a tool
```bash
curl -X POST https://dynamicagentmcp-production-ae20.up.railway.app/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -H "mcp-session-id: <SESSION_ID>" \
  -d '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"greet","arguments":{"name":"Mistral"}}}'
```

> [!IMPORTANT]
> Without `mcp-session-id`, you get `400 Bad Request: Missing session ID` (except for `initialize`).

---

### MCP SSE Endpoint (legacy, for older MCP clients)

**Endpoint:** `GET /sse`

Two-step protocol:
1. `GET /sse` → Opens an SSE stream, first event gives you a session URI like `/messages/?session_id=abc123`
2. `POST /messages/?session_id=abc123` → Send JSON-RPC messages to the server

> [!CAUTION]
> Mistral's connector client does **NOT** use this transport. It uses Streamable HTTP (`/mcp`).
> The SSE endpoint exists for backward compatibility with other MCP clients only.

---

## 4. Mistral Connector Status

Currently registered active connectors pointing at this server:

| Name | Server URL | Will it work? |
|---|---|---|
| `dynamic_mcp_factory` | `.../mcp` | ✅ Correct transport, active |
| `dyn_work_latest_streamablehttp` | `.../mcp` | ✅ Correct transport |

*(Note: Older connectors like `dynamic_work` pointing at `/sse` were deleted because Mistral's client only supports Streamable HTTP).*

### How to use the working connector

```python
from mistralai.client import Mistral
client = Mistral(api_key="YOUR_KEY")

# Option A: Direct tool call (no model)
result = client.beta.connectors.call_tool(
    connector_id_or_name="dyn_work_latest_streamablehttp",
    tool_name="greet",
    arguments={"name": "World"},
)

# Option B: In a conversation
response = client.beta.conversations.start(
    model="mistral-medium-latest",
    inputs="Greet 'Himanshu' using the greet tool.",
    tools=[{"type": "connector", "connector_id": "dyn_work_latest_streamablehttp"}],
)

# Option C: Attached to an agent
agent = client.beta.agents.create(
    model="mistral-medium-latest",
    name="ToolAgent",
    tools=[{"type": "connector", "connector_id": "dyn_work_latest_streamablehttp"}],
)
response = client.beta.conversations.start(
    agent_id=agent.id,
    inputs="What tools do you have?",
)
```

---

## 5. Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                   Railway Container                          │
│                                                              │
│  FastAPI (app/main.py)                                       │
│  ├── POST /submit-code  ─── Codestral → pip install → disk  │
│  ├── GET  /tools        ─── list from disk + memory         │
│  ├── DELETE /tools/{n}  ─── delete + full reload            │
│  ├── POST /reload       ─── rebuild MCP + re-register all   │
│  ├── GET  /health       ─── status check                    │
│  │                                                           │
│  ├── GET  /sse          ─── SSE transport (legacy)          │
│  ├── POST /messages/    ─── SSE message handler             │
│  │                                                           │
│  └── POST /mcp          ─── Streamable HTTP transport       │
│      └── GET /mcp       ─── (server-initiated, minimal)     │
│                                                              │
│  Tool execution:                                             │
│  └── Subprocess sandbox (/app/sandbox/)                      │
│      └── Runs user code with stripped env vars               │
│      └── 130s timeout                                        │
│                                                              │
│  Storage:                                                    │
│  └── /app/tools/{name}/ (Railway volume for persistence)     │
│      ├── {name}.py          (user code)                      │
│      ├── manifest.json      (metadata)                       │
│      └── standalone_mcp.py  (standalone runner)              │
└─────────────────────────────────────────────────────────────┘
```

### Key Files

| File | Purpose |
|---|---|
| [main.py](file:///c:/Users/Himanshu/Downloads/dynamic_mcp_railway/app/main.py) | FastAPI app + MCP server + all endpoints + reload logic |
| [codestral.py](file:///c:/Users/Himanshu/Downloads/dynamic_mcp_railway/app/codestral.py) | LLM-based dependency detection (Codestral) |
| [processor.py](file:///c:/Users/Himanshu/Downloads/dynamic_mcp_railway/app/processor.py) | pip install + write tool to disk |
| [executor.py](file:///c:/Users/Himanshu/Downloads/dynamic_mcp_railway/app/executor.py) | Sandboxed subprocess execution of tool code |
| [tool_loader.py](file:///c:/Users/Himanshu/Downloads/dynamic_mcp_railway/app/tool_loader.py) | AST parser: extracts `run()` params + docstring |
| [models.py](file:///c:/Users/Himanshu/Downloads/dynamic_mcp_railway/app/models.py) | Pydantic request/response models |

---

## 6. Resolved Issues (Fixed in Recent Commits)

### ✅ Route mutation after `_do_full_reload()` silently ignored (Fixed)
**Fix applied:** Used ASGI delegator wrappers (`_messages_delegator`, `_streamable_delegator`) that dynamically route to the current global instances. This ensures reloads work perfectly without Starlette caching old routes.

### ✅ `dynamic_mcp_agent.py` registered connector pointing at `/sse` (Fixed)
Superseded by new test scripts (`test_attached_agent.py` and `test_agent.py`) which correctly use the `/mcp` transport.

### ✅ `submit_code` tool used `localhost` internally (Fixed)
**Fix applied:** The tool was re-registered via `register_core_tools.py` to use the public production URL `https://dynamicagentmcp-production-ae20.up.railway.app/submit-code`.

### ✅ `mcp.settings.transport_security` `NoneType` Error (Fixed)
**Fix applied:** Added a `None` check before attempting to modify `enable_dns_rebinding_protection`.

### ✅ Stale connectors registered with Mistral (Fixed)
**Fix applied:** Old `/sse` connectors were deleted, and a new proper one `dynamic_mcp_factory` was created.

---

## 7. The Tool Submission Flow (How It Actually Works)

```
Client (you/agent)                          Server (Railway)
       │                                         │
       │  POST /submit-code                       │
       │  {"name":"foo", "description":"...",      │
       │   "code":"def run(x: str)..."}            │
       │ ──────────────────────────────────────►   │
       │                                          │── 1. Validate: code has run()
       │                                          │── 2. Codestral: detect pip deps
       │                                          │── 3. pip install --target _libs
       │                                          │── 4. Write foo.py + manifest.json
       │                                          │── 5a. NEW tool: register in-process
       │                                          │── 5b. EXISTING tool: full reload
       │  ◄──────────────────────────────────────  │
       │  200 {"status":"success", ...}            │
       │                                          │
       │  Now tool "foo" is available via:        │
       │  • POST /mcp (Streamable HTTP)           │
       │  • GET /sse + POST /messages/ (SSE)      │
```

---

## 8. Working With the Server — Practical Cookbook

### Submit a new tool
```python
import httpx
url = "https://dynamicagentmcp-production-ae20.up.railway.app/submit-code"
r = httpx.post(url, json={
    "name": "reverse_text",
    "description": "Reverse a string",
    "code": 'def run(text: str) -> str:\n    """Reverse the input text."""\n    return text[::-1]'
})
print(r.json())
```

### Test it directly via MCP Streamable HTTP
```python
import httpx

base = "https://dynamicagentmcp-production-ae20.up.railway.app"
headers = {"Content-Type": "application/json", "Accept": "application/json, text/event-stream"}

# 1. Initialize → get session ID
r = httpx.post(f"{base}/mcp", json={
    "jsonrpc": "2.0", "id": 1, "method": "initialize",
    "params": {"protocolVersion": "2025-03-26", "capabilities": {},
               "clientInfo": {"name": "test", "version": "1.0.0"}}
}, headers=headers)
session_id = r.headers["mcp-session-id"]

# 2. Call your tool
r = httpx.post(f"{base}/mcp", json={
    "jsonrpc": "2.0", "id": 2, "method": "tools/call",
    "params": {"name": "reverse_text", "arguments": {"text": "hello"}}
}, headers={**headers, "mcp-session-id": session_id})
print(r.text)  # → "olleh"
```

### Test it via Mistral agent
```python
from mistralai.client import Mistral
client = Mistral(api_key="YOUR_KEY")

response = client.beta.conversations.start(
    model="mistral-medium-latest",
    inputs="Reverse the text 'dynamic mcp' using the reverse_text tool.",
    tools=[{"type": "connector", "connector_id": "dyn_work_latest_streamablehttp"}],
)
for output in response.outputs:
    if output.type == "message.output":
        print(output.content)
```

### Delete a tool
```python
r = httpx.delete(f"{base}/tools/reverse_text")
print(r.json())  # {"status": "deleted", "tool_name": "reverse_text"}
```

### Conversational Agent with Attached Connector
We created a fully interactive, self-improving agent script: `test_attached_agent.py`.

```bash
uv run python test_attached_agent.py
```
**Features of the script:**
- Attaches the `dynamic_mcp_factory` connector directly to a Mistral agent.
- Interactive terminal chat loop with the agent.
- **Persistent Sessions**: Conversation state is saved in `.attached_agent_state.json`.
- **Automated Session Refreshing**: The script continuously polls `/tools` in the background. If the agent writes code and uses the `submit_code` tool to register a *new* MCP tool, the script detects the change, automatically refreshes the conversation session to reload the tool schemas, and seamlessly prompts the agent to continue its task using the newly created tool!

---

## 9. What a Developer Needs to Know

### The `run()` contract
Every submitted tool **must** have a function named `run`. This is the entry point. Its:
- **Parameter names** → become the tool's input schema fields
- **Type annotations** → become JSON Schema types (`str`, `int`, `float`, `bool`, `list`, `dict`)  
- **Docstring** → becomes the tool description shown to the model
- **Return value** → must be JSON-serializable

### Two libraries, same name
The codebase uses `mcp` (the PyPI package `mcp>=1.27`), which provides `mcp.server.fastmcp.FastMCP`. This is **not** the same as the standalone `fastmcp>=2.0` package from PyPI. The SKILL.md reference imports `from fastmcp import FastMCP` — that's the newer standalone package. The server uses the bundled one from the `mcp` package.

### Deployment
- Push to `main` → Railway auto-deploys from Dockerfile
- Single worker (`--workers 1`) required because MCP state is in-process
- Volume mounted at `/app/tools` for persistence across deploys
- `MISTRAL_API_KEY` set as Railway env var (for Codestral dependency analysis)

### Transport summary

| Transport | Endpoint | Who uses it | Status |
|---|---|---|---|
| REST HTTP | `/submit-code`, `/tools`, `/health`, `/reload` | You, scripts | ✅ Working |
| SSE (MCP) | `GET /sse` + `POST /messages/` | Generic MCP clients | ✅ Working (first connection) |
| Streamable HTTP (MCP) | `POST /mcp` | Mistral connectors | ✅ Working |

---

## 10. Next Steps (Recommended)

1. **Add Authentication** — Currently zero authentication on all endpoints. Consider adding API keys or tokens.
2. **Experiment with complex tools** — Now that the agent can dynamically write its own MCP tools, try asking it to build complex integrations (e.g., calling external REST APIs, data processing pipelines) and watch it use them in real-time.
