# Mistral Dynamic Agent — Hybrid Architecture Implementation Guide

> **Prepared for:** Antigravity Implementation Team  
> **Project:** Mistral Dynamic Agent Backend  
> **Stack:** FastAPI · Mistral AI SDK v2.0.0 · SQLite · Python venv · Docker Tool Service  
> **Scope:** Local-first architecture. Orchestration + workflow engine runs in a Python venv. Tool lifecycle + MCP servers isolated inside Docker. Designed for scalability.

---

## 1. Overview

The system is split into **two runtime environments**:

1. **Local venv (`:8000`)** — FastAPI backend handling orchestration, agent management, conversations, routing, and **dynamic workflow orchestration**. Runs directly on the host via `uvicorn`.
2. **Docker Tool Service (`:9000`)** — A self-contained FastAPI microservice inside Docker. Handles the **complete tool lifecycle** (codegen, analysis, sandbox, storage, execution) **and MCP server management**. When an agent returns a `tool_call`, the local backend proxies the request to this service.

The local backend communicates with the Docker Tool Service over HTTP on `localhost:9000`. External network egress goes to `api.mistral.ai` over HTTPS from both environments.

### Scalability by design
- **Backend** is structured with a pluggable service layer so a **workflow engine** (DAG-based multi-agent pipelines) can be added without restructuring existing services.
- **Docker** uses a multi-container compose setup so **MCP servers** can be added as sibling containers on the same internal network, discovered and proxied by the Tool Service.

---

## 2. Request Lifecycle — End to End

```
React UI
  │
  │  POST /api/orchestrate   (or /api/orchestrate/stream)
  ▼
FastAPI  main.py  :8000  (local venv)
  │  Parse body · attach session-id · CORS headers
  ▼
Query Router
  ├── Orchestrator path  →  orchestrator_service.py
  └── Direct chat path   →  chat_service.py  (bypasses orchestrator)
```

### 2.1 Orchestrator Path

```
orchestrator_service.py  (local venv)
  │
  ├─ 1. Intent Analyser     — calls MISTRAL_ORCHESTRATOR_MODEL to classify query
  ├─ 2. Agent Provisioner   — creates a temporary Mistral Agent via Agents API
  │                           (persona · temperature · model · toolset)
  ├─ 3. conversation_service.py — opens/continues thread via Mistral Conversations API
  │
  ▼
Tool Resolver  (local — queries Docker Tool Service)
  ├── Tool exists in Docker Tool Service?  →  skip synthesis, go to Execution Loop
  └── New tool needed?                     →  POST /synthesize to Docker Tool Service
```

### 2.2 Direct Chat Path

```
chat_service.py  (local venv)
  │  Direct call to saved Mistral Agent or base model
  │  No orchestrator involved
  ▼
Execution Loop  (tool calls proxied to Docker Tool Service)
```

### 2.3 Tool Call Execution Flow

```
Mistral Agent returns tool_call
  │
  ▼
chat_service.py  (local venv)
  │
  ├── Native tool?   →  Execute locally (get_weather, calculate, etc.)
  └── Dynamic tool?  →  POST http://localhost:9000/execute/{tool_name}
                          │
                          ▼
                     Docker Tool Service :9000
                          │  Load stored .py module
                          │  Execute function with arguments
                          │  Return JSON result
                          ▼
                     Response back to chat_service.py
                          │
                          ▼
                     Append tool result to messages → re-query Mistral
```

---

## 3. Directory Structure

```
backend/                                   # LOCAL VENV
├── app/
│   ├── main.py                            # FastAPI entry :8000, CORS, exception handlers
│   ├── config.py                          # .env loading — model IDs, TOOL_SERVICE_URL
│   ├── dependencies.py                    # Mistral client DI
│   ├── database.py                        # SQLAlchemy + SQLite (agent metadata + workflows)
│   ├── exceptions.py                      # Custom error types
│   ├── routes/
│   │   ├── orchestrator.py                # POST /api/orchestrate, /stream
│   │   ├── chat.py                        # POST /api/chat/completions, /stream
│   │   ├── agents.py                      # CRUD /api/agents
│   │   ├── conversations.py              # CRUD /api/conversations
│   │   ├── tools.py                       # Proxy to Docker Tool Service for approval UI
│   │   └── workflows.py                   # [FUTURE] CRUD /api/workflows
│   ├── schemas/
│   │   └── ...                            # Pydantic request/response models
│   └── services/
│       ├── orchestrator_service.py        # Intent, agent provisioning, routing
│       ├── chat_service.py                # Execution loop, streaming
│       ├── agent_service.py               # Mistral Agents API wrapper
│       ├── conversation_service.py        # Mistral Conversations API wrapper
│       ├── tool_resolver.py               # Queries Docker Tool Service, triggers synthesis
│       ├── tool_registry.py               # Routes: native → local, dynamic → Docker proxy
│       └── workflow_engine/               # [FUTURE] Dynamic workflow orchestration
│           ├── __init__.py
│           ├── engine.py                  # DAG executor — step sequencing, branching
│           ├── models.py                  # Workflow, Step, Edge, Condition schemas
│           └── step_runners.py            # Agent step, tool step, conditional step
├── sql_app.db                             # SQLite — agent metadata + workflow definitions
├── requirements.txt
└── .env

tool-service/                              # DOCKER TOOL SERVICE
├── Dockerfile
├── docker-compose.yml                     # Multi-container: tool-service + MCP servers
├── requirements.txt                       # FastAPI, mistralai, ruff, sandbox deps
├── sandbox_requirements.txt               # Safe subset of libs for generated tool code
├── .env
├── app/
│   ├── main.py                            # FastAPI entry :9000
│   ├── config.py                          # MISTRAL_CODING_MODEL, AUTO_APPROVE, MCP config
│   ├── database.py                        # SQLite for tool index (inside container)
│   ├── routes/
│   │   ├── synthesis.py                   # POST /synthesize
│   │   ├── execution.py                   # POST /execute/{tool_name}
│   │   ├── management.py                 # GET /tools, /pending, approve, reject
│   │   └── mcp.py                         # [FUTURE] MCP server management routes
│   └── services/
│       ├── synthesis_service.py           # Codestral codegen, lint, sandbox, approval
│       ├── execution_service.py           # Dynamic import + execute stored tools
│       ├── sandbox.py                     # Subprocess sandbox runner (within container)
│       └── mcp_manager.py                 # [FUTURE] MCP server discovery, proxy, lifecycle
├── mcp_servers/                           # [FUTURE] MCP server configs and data
│   └── mcp_registry.json                 # Registry of available MCP servers
├── dynamic_tools/                         # Generated .py files stored here post-approval
└── tool_service.db                        # SQLite — tool index, hashes, status
```

---

## 4. Environment Configuration

### Local Backend `.env`

```env
# Mistral Platform
MISTRAL_API_KEY=your_key_here

# Model assignments
MISTRAL_ORCHESTRATOR_MODEL=mistral-large-latest

# Docker Tool Service connection
TOOL_SERVICE_URL=http://localhost:9000

# Database
DATABASE_URL=sqlite:///./sql_app.db

# [FUTURE] Workflow engine
# WORKFLOW_MAX_STEPS=20
# WORKFLOW_STEP_TIMEOUT=60
```

### Docker Tool Service `.env`

```env
# Mistral Platform (for Codestral code generation)
MISTRAL_API_KEY=your_key_here

# Model assignment
MISTRAL_CODING_MODEL=codestral-latest

# Tool synthesis safety
AUTO_APPROVE_DYNAMIC_TOOLS=false

# Database (inside container)
DATABASE_URL=sqlite:///./tool_service.db

# [FUTURE] MCP server configuration
# MCP_SERVERS_ENABLED=false
# MCP_REGISTRY_PATH=mcp_servers/mcp_registry.json
```

---

## 5. Orchestration Layer — `orchestrator_service.py` (local venv)

### Responsibilities
- Analyse user intent using `MISTRAL_ORCHESTRATOR_MODEL`
- Provision a temporary, task-specific Mistral Agent via the Agents API
- Tear down the agent after execution completes
- Delegate thread/context management to `conversation_service.py`
- Query Docker Tool Service for available tool schemas (to configure agent toolset)
- Trigger synthesis on Docker Tool Service when a new tool is needed
- Pass the resolved agent + toolset to the execution loop

### Key implementation detail
The agent provisioner must configure the temporary agent with:
- The correct `model` for the task complexity
- A task-specific `system_prompt` derived from the intent analysis
- Only the tools required for this specific task (schemas fetched from Docker Tool Service)

The agent is torn down after the execution loop returns a final response. Do not persist temporary agents — they accumulate on the Mistral Platform.

### Conversation state
`conversation_service.py` manages thread state via the Mistral Conversations API. Context lives on Mistral's side, not in local memory. The local session store holds only the `thread_id` reference, not the full message history.

---

## 6. Tool Resolver — `tool_resolver.py` (local venv)

This service queries the Docker Tool Service to check if a tool already exists and triggers synthesis when needed.

### Logic

```python
import httpx
from hashlib import sha256

TOOL_SERVICE_URL = config.TOOL_SERVICE_URL  # http://localhost:9000

async def resolve_tool(tool_schema: ToolSchema) -> dict | None:
    content_hash = sha256(tool_schema.json().encode()).hexdigest()
    
    # Check if tool exists in Docker Tool Service
    async with httpx.AsyncClient() as client:
        response = await client.get(
            f"{TOOL_SERVICE_URL}/tools/by-hash/{content_hash}"
        )
    
    if response.status_code == 200:
        return response.json()  # tool exists and is approved
    
    # Not found — orchestrator triggers synthesis
    return None

async def trigger_synthesis(tool_schema: ToolSchema) -> dict:
    async with httpx.AsyncClient(timeout=60.0) as client:
        response = await client.post(
            f"{TOOL_SERVICE_URL}/synthesize",
            json=tool_schema.dict()
        )
    return response.json()  # { status: "approved"|"pending_approval", tool_name: ... }
```

---

## 7. Docker Tool Service — Complete Tool Lifecycle

The Docker Tool Service is a self-contained FastAPI application running inside Docker. It owns the **complete lifecycle** of dynamic tools: generation, validation, storage, and runtime execution.

### 7.1 API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/synthesize` | Receive tool schema → generate code → test → store |
| `POST` | `/execute/{tool_name}` | Execute a stored tool function with arguments, return result |
| `GET` | `/tools` | List all registered tools with their OpenAPI schemas |
| `GET` | `/tools/by-hash/{hash}` | Lookup tool by content hash |
| `GET` | `/tools/pending` | List tools awaiting approval |
| `POST` | `/tools/{id}/approve` | Approve a pending tool |
| `POST` | `/tools/{id}/reject` | Reject a pending tool |
| `GET` | `/health` | Health check |

### 7.2 Tool Execution — `execution_service.py`

When the local backend proxies a `tool_call` to the Docker Tool Service, this service loads and executes the stored function.

```python
import importlib.util

# In-process cache of loaded tool functions
_execution_cache: dict[str, callable] = {}

def execute_tool(tool_name: str, arguments: dict) -> dict:
    # Check cache first
    if tool_name in _execution_cache:
        return {"result": _execution_cache[tool_name](**arguments)}
    
    # Load from SQLite index
    record = db.query(ToolRecord).filter_by(name=tool_name, status="approved").first()
    if not record:
        raise ToolNotFoundError(f"Tool '{tool_name}' not found or not approved")
    
    # Dynamic import from stored .py file
    spec = importlib.util.spec_from_file_location(tool_name, record.module_path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    
    # Cache and execute
    _execution_cache[tool_name] = module.run
    return {"result": module.run(**arguments)}
```

### 7.3 Tool Synthesis Pipeline — `synthesis_service.py`

Every stage must complete successfully before the tool is considered valid. Sequential, no shortcuts.

#### Stage 1 — Prompt Builder

Construct the Codestral prompt with:
- The required function signature derived from the tool schema
- Input/output type annotations
- Forbidden imports list (e.g. `os.system`, `subprocess`, `socket`)
- A concrete usage example
- Instruction to return only valid Python — no markdown fences, no prose

#### Stage 2 — Codestral Call

```python
response = mistral_client.chat.complete(
    model=config.MISTRAL_CODING_MODEL,  # codestral-latest
    messages=[
        {"role": "system", "content": CODEGEN_SYSTEM_PROMPT},
        {"role": "user",   "content": prompt}
    ]
)
generated_code = response.choices[0].message.content
```

#### Stage 3 — Static Analyser

```python
import ast, subprocess

def static_analyse(code: str) -> tuple[bool, str]:
    try:
        ast.parse(code)
    except SyntaxError as e:
        return False, f"SyntaxError: {e}"
    
    tree = ast.parse(code)
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for alias in node.names:
                if alias.name in FORBIDDEN_IMPORTS:
                    return False, f"Forbidden import: {alias.name}"
    
    result = subprocess.run(
        ["ruff", "check", "--stdin-filename", "tool.py", "-"],
        input=code.encode(), capture_output=True
    )
    if result.returncode != 0:
        return False, result.stdout.decode()
    
    return True, ""
```

#### Stage 3a — Self-Heal Retry Loop

```python
MAX_RETRIES = 3

for attempt in range(MAX_RETRIES):
    ok, error = static_analyse(generated_code)
    if ok:
        break
    
    messages.append({"role": "assistant", "content": generated_code})
    messages.append({
        "role": "user",
        "content": f"The code failed with this error:\n\n{error}\n\nFix it and return only the corrected Python function."
    })
    generated_code = call_codestral(messages)

if not ok:
    raise ToolSynthesisError("Max retries exceeded during static analysis")
```

The same retry pattern applies to sandbox failures.

#### Stage 4 — Sandbox Test (within container)

Run the generated function in a subprocess **within the Docker container itself**. The container is the security boundary. The subprocess runs with minimal environment, no inherited secrets, and a hard timeout.

```python
import subprocess, tempfile, json, os

def run_in_sandbox(code: str, test_inputs: list[dict]) -> tuple[bool, str]:
    with tempfile.NamedTemporaryFile(suffix=".py", mode="w", delete=False) as f:
        f.write(code)
        f.write(f"\n\nif __name__ == '__main__':\n")
        f.write(f"    import json, sys\n")
        f.write(f"    inputs = {json.dumps(test_inputs)}\n")
        f.write(f"    for inp in inputs:\n")
        f.write(f"        print(json.dumps(run(**inp)))\n")
        tmp_path = f.name

    try:
        result = subprocess.run(
            ["python", tmp_path],
            capture_output=True,
            timeout=10,
            env={"PATH": "/usr/bin:/usr/local/bin"},  # minimal env — no secrets
            cwd="/tmp"
        )
    finally:
        os.unlink(tmp_path)

    if result.returncode != 0:
        return False, result.stderr.decode()

    return True, result.stdout.decode()
```

Test inputs are auto-generated from the tool's OpenAPI schema. Every required parameter gets a type-valid example value.

**If sandbox fails:** append the stderr output to the Codestral conversation and retry (same loop as Stage 3a, shared retry counter).

#### Stage 5 — Approval Gate

```python
if config.AUTO_APPROVE_DYNAMIC_TOOLS:
    _write_and_register(code, schema, test_output)
else:
    db.add(ToolRecord(
        name=schema.name,
        hash=content_hash,
        source_code=code,
        schema_json=schema.json(),
        status="pending_approval",
        sandbox_output=test_output
    ))
```

When `AUTO_APPROVE_DYNAMIC_TOOLS=false`, the service returns `{"status": "pending_approval"}`. The local backend relays this to the React UI.

#### Stage 6 — Write and Register (on approval)

```python
def _write_and_register(code: str, schema: ToolSchema, content_hash: str):
    # Write to disk inside the container
    module_path = f"dynamic_tools/{schema.name}_{content_hash[:8]}.py"
    with open(module_path, "w") as f:
        f.write(code)
    
    # Verify it loads correctly
    spec = importlib.util.spec_from_file_location(schema.name, module_path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    
    # Update SQLite
    db.query(ToolRecord).filter_by(hash=content_hash).update({
        "module_path": module_path,
        "status": "approved"
    })
    
    # Warm execution cache
    _execution_cache[schema.name] = module.run
```

### 7.4 SQLite `tools` table schema (inside container)

```sql
CREATE TABLE tools (
    id             INTEGER PRIMARY KEY,
    name           TEXT NOT NULL,
    hash           TEXT NOT NULL UNIQUE,
    version        TEXT NOT NULL,
    schema_json    TEXT NOT NULL,
    source_code    TEXT NOT NULL,
    module_path    TEXT,
    status         TEXT NOT NULL,      -- 'pending_approval' | 'approved' | 'rejected'
    sandbox_output TEXT,
    created_at     DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

---

## 8. Tool Registry — `tool_registry.py` (local venv)

The local registry acts as a **router**: native tools execute locally, dynamic tools are proxied to Docker Tool Service via HTTP.

```python
import httpx

TOOL_SERVICE_URL = config.TOOL_SERVICE_URL

_NATIVE_REGISTRY: dict[str, ToolEntry] = {
    "get_database_schema": ToolEntry(fn=get_database_schema, schema=...),
    "execute_sql_query":   ToolEntry(fn=execute_sql_query,   schema=...),
    "get_weather":         ToolEntry(fn=get_weather,         schema=...),
    "calculate":           ToolEntry(fn=calculate,           schema=...),
    "web_search":          ToolEntry(fn=web_search,          schema=...),
}

async def execute(name: str, arguments: dict) -> any:
    # 1. Native tools — execute locally
    if name in _NATIVE_REGISTRY:
        return _NATIVE_REGISTRY[name].fn(**arguments)
    
    # 2. Dynamic tools — proxy to Docker Tool Service
    async with httpx.AsyncClient(timeout=30.0) as client:
        response = await client.post(
            f"{TOOL_SERVICE_URL}/execute/{name}",
            json=arguments
        )
    
    if response.status_code == 404:
        raise ToolNotFoundError(f"Tool '{name}' not found in Docker Tool Service")
    
    return response.json()["result"]

async def get_all_schemas() -> list[dict]:
    """Fetch native schemas + dynamic schemas from Docker Tool Service."""
    native = [entry.schema.dict() for entry in _NATIVE_REGISTRY.values()]
    
    async with httpx.AsyncClient() as client:
        response = await client.get(f"{TOOL_SERVICE_URL}/tools")
    dynamic = [t["schema"] for t in response.json() if t["status"] == "approved"]
    
    return native + dynamic
```

---

## 9. Execution Loop — `chat_service.py` (local venv)

The tool call loop is recursive. It continues until Mistral returns no pending `tool_calls`. Dynamic tool calls are proxied to Docker Tool Service via `tool_registry.execute()`.

```python
async def run_agent_loop(
    agent_id: str,
    thread_id: str,
    messages: list[dict],
    stream: bool = False
) -> AsyncGenerator[str, None] | dict:
    
    while True:
        response = await mistral_client.agents.complete(
            agent_id=agent_id,
            messages=messages
        )
        
        choice = response.choices[0]
        
        if not choice.message.tool_calls:
            if stream:
                yield choice.message.content
            else:
                return {"result": choice.message.content}
            break
        
        messages.append(choice.message)
        
        for tool_call in choice.message.tool_calls:
            # Routes to local native fn or Docker Tool Service automatically
            tool_result = await tool_registry.execute(
                name=tool_call.function.name,
                arguments=json.loads(tool_call.function.arguments)
            )
            
            messages.append({
                "role":         "tool",
                "tool_call_id": tool_call.id,
                "content":      json.dumps(tool_result)
            })
```

### SSE streaming

```python
from fastapi.responses import StreamingResponse

@router.post("/api/orchestrate/stream")
async def orchestrate_stream(request: OrchestrateRequest):
    async def event_generator():
        async for chunk in run_agent_loop(..., stream=True):
            yield f"data: {json.dumps({'content': chunk})}\n\n"
        yield "data: [DONE]\n\n"
    
    return StreamingResponse(event_generator(), media_type="text/event-stream")
```

---

## 10. API Endpoints Reference

### Local Backend (`:8000`)

| Method | Endpoint | Handler | Description |
|--------|----------|---------|-------------|
| `POST` | `/api/orchestrate` | `orchestrator.py` | Full orchestration — JSON response |
| `POST` | `/api/orchestrate/stream` | `orchestrator.py` | Full orchestration — SSE stream |
| `POST` | `/api/chat/completions` | `chat.py` | Direct chat — bypasses orchestrator |
| `POST` | `/api/chat/stream` | `chat.py` | Direct chat — SSE stream |
| `GET` | `/api/agents` | `agents.py` | List all saved agents |
| `POST` | `/api/agents` | `agents.py` | Create a permanent agent |
| `PATCH` | `/api/agents/{id}` | `agents.py` | Update agent config |
| `DELETE` | `/api/agents/{id}` | `agents.py` | Delete agent |
| `GET` | `/api/conversations` | `conversations.py` | List conversation threads |
| `POST` | `/api/conversations` | `conversations.py` | Create new thread |
| `GET` | `/api/tools/pending` | `tools.py` | Proxy → Docker Tool Service |
| `POST` | `/api/tools/{id}/approve` | `tools.py` | Proxy → Docker Tool Service |
| `POST` | `/api/tools/{id}/reject` | `tools.py` | Proxy → Docker Tool Service |

### Docker Tool Service (`:9000`)

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/synthesize` | Full synthesis pipeline: codegen → lint → sandbox → store |
| `POST` | `/execute/{tool_name}` | Execute stored tool function with arguments |
| `GET` | `/tools` | List all tools with schemas |
| `GET` | `/tools/by-hash/{hash}` | Lookup by content hash |
| `GET` | `/tools/pending` | List pending-approval tools |
| `POST` | `/tools/{id}/approve` | Approve a pending tool |
| `POST` | `/tools/{id}/reject` | Reject a pending tool |
| `GET` | `/health` | Health check |
| `GET` | `/mcp/servers` | [FUTURE] List registered MCP servers |
| `POST` | `/mcp/servers` | [FUTURE] Register a new MCP server |
| `POST` | `/mcp/execute/{server}/{tool}` | [FUTURE] Execute tool via MCP server |

---

## 11. Docker Tool Service Setup

### Dockerfile

```dockerfile
FROM python:3.11-slim
WORKDIR /app

# Install service dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Install sandbox-safe libraries separately
COPY sandbox_requirements.txt .
RUN pip install --no-cache-dir -r sandbox_requirements.txt

# Non-root user for sandbox subprocess isolation
RUN useradd -m sandboxuser

COPY . .

# Create dynamic_tools directory
RUN mkdir -p dynamic_tools && chown sandboxuser:sandboxuser dynamic_tools

EXPOSE 9000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "9000"]
```

### Docker Compose

```yaml
version: "3.9"
services:
  tool-service:
    build: ./tool-service
    ports:
      - "9000:9000"
    env_file: ./tool-service/.env
    volumes:
      - tool-data:/app/dynamic_tools
      - tool-db:/app/tool_service.db
    networks:
      - tool-net
    restart: unless-stopped

  # ──────────────────────────────────────────────
  # [FUTURE] MCP Servers — add as sibling containers
  # Each MCP server runs in its own container on tool-net
  # The tool-service discovers and proxies requests to them
  # ──────────────────────────────────────────────
  # mcp-filesystem:
  #   image: mcp/filesystem-server:latest
  #   volumes:
  #     - mcp-fs-data:/data
  #   networks:
  #     - tool-net
  #   restart: unless-stopped
  #
  # mcp-database:
  #   image: mcp/database-server:latest
  #   environment:
  #     - DB_CONNECTION_STRING=...
  #   networks:
  #     - tool-net
  #   restart: unless-stopped
  #
  # mcp-web-search:
  #   image: mcp/web-search-server:latest
  #   networks:
  #     - tool-net
  #   restart: unless-stopped

networks:
  tool-net:
    driver: bridge

volumes:
  tool-data:
  tool-db:
```

---

## 12. Local Development Setup

### Prerequisites
- Python 3.11+
- Docker Desktop (for the Tool Service container)

### Local Backend (venv)

```bash
cd backend
python -m venv .venv

# Windows
.venv\Scripts\activate

# macOS / Linux
source .venv/bin/activate

pip install -r requirements.txt
uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
```

### Docker Tool Service

```bash
cd tool-service
docker compose up --build -d
```

The local backend runs on `localhost:8000`. The Docker Tool Service runs on `localhost:9000`. Only the Tool Service runs in Docker — the backend runs directly in your venv.

---

## 13. Key Architecture Decisions and Rationale

| Decision | Rationale |
|----------|-----------|
| Complete tool lifecycle isolated in Docker | Generated code never touches the host filesystem or executes in the local Python process. All dynamic tool code is generated, stored, and executed inside the container. |
| Local backend proxies tool calls via HTTP | The execution loop treats native and dynamic tools uniformly. Native tools run locally; dynamic tools are transparently proxied to the Docker Tool Service. |
| Docker Tool Service owns its own SQLite | Tool metadata, source code, and status are self-contained inside the container. The local backend never needs to store or manage generated tool code. |
| Subprocess sandbox within Docker container | Even inside Docker, generated code runs in a subprocess with minimal env and no secrets. Defence in depth — container isolation + subprocess isolation. |
| Real Mistral Agent provisioned per orchestrator query | Mistral handles system prompt injection and tool binding natively. Temporary agents are correctly isolated per task. |
| Thread state via Mistral Conversations API | Context window managed by Mistral platform. Survives local server restarts. No local memory pressure. |
| Self-heal retry with structured error context | Passing the exact lint or sandbox error back to Codestral consistently produces correct fixes within 1–2 attempts. |
| `AUTO_APPROVE_DYNAMIC_TOOLS=false` as default | Generated code never executes in the runtime until a developer confirms it. Essential safety control. |
| Content-hash deduplication | Identical tool schemas skip the entire synthesis pipeline. Reduces Codestral API calls and latency. |
| SSE stream as default for orchestrator path | Agentic reasoning takes time. SSE chunks deliver the thought process incrementally. |
| Pluggable workflow engine in backend | The `workflow_engine/` module is isolated from orchestration. Workflows compose existing agents and tools — no coupling to the execution loop. |
| MCP servers as sibling Docker containers | Each MCP server runs in its own container on `tool-net`. The Tool Service discovers and proxies requests. Adding a new MCP server = adding a container to compose. |

---

## 14. Scalability — Future Extensions

### 14.1 Dynamic Workflow Engine (Backend)

The backend is pre-structured for a **DAG-based workflow engine** that lets users define multi-step agent pipelines.

#### Workflow model

```python
# workflow_engine/models.py

class WorkflowStep:
    id: str
    type: str              # "agent" | "tool" | "condition" | "transform"
    config: dict           # agent_id, tool_name, condition_expr, etc.
    next_steps: list[str]  # edges to downstream steps

class Workflow:
    id: str
    name: str
    steps: list[WorkflowStep]
    entry_step: str        # starting node in the DAG
    variables: dict        # shared context passed between steps
```

#### How it fits

```
POST /api/workflows              →  Create workflow definition (stored in SQLite)
POST /api/workflows/{id}/run     →  Execute workflow
GET  /api/workflows/{id}/status  →  Poll execution status
```

The workflow engine:
- Reads the DAG definition from SQLite
- Executes steps in topological order
- **Agent steps** → call `orchestrator_service` or `chat_service`
- **Tool steps** → call `tool_registry.execute()` (native or Docker proxy)
- **Condition steps** → evaluate expressions to branch the DAG
- **Transform steps** → reshape data between steps
- Passes a shared `variables` context dict through the pipeline

#### Why it scales
- Steps are **independent runners** — adding a new step type = adding one function to `step_runners.py`
- Workflows compose existing agents and tools — no changes to the orchestrator or execution loop
- Workflow definitions are JSON-serializable — can be created via UI or API

---

### 14.2 MCP Server Integration (Docker)

The Docker compose setup is pre-structured for **MCP (Model Context Protocol) servers** as sibling containers.

#### Architecture

```
tool-net (Docker bridge network)
  │
  ├── tool-service :9000          ← existing: synthesis + execution + MCP proxy
  ├── mcp-filesystem :3001        ← [FUTURE] file operations MCP server
  ├── mcp-database :3002          ← [FUTURE] database access MCP server
  ├── mcp-web-search :3003        ← [FUTURE] web search MCP server
  └── mcp-custom :300X            ← [FUTURE] any custom MCP server
```

#### MCP Manager — `mcp_manager.py`

```python
# Manages MCP server discovery, registration, and proxying

class MCPManager:
    def __init__(self):
        self.registry = load_registry("mcp_servers/mcp_registry.json")
    
    async def list_servers(self) -> list[MCPServerInfo]:
        """List all registered MCP servers with health status."""
        ...
    
    async def discover_tools(self, server_name: str) -> list[ToolSchema]:
        """Query an MCP server for its available tools."""
        ...
    
    async def execute_tool(
        self, server_name: str, tool_name: str, arguments: dict
    ) -> dict:
        """Proxy a tool call to the appropriate MCP server."""
        ...
```

#### MCP Registry (`mcp_registry.json`)

```json
{
  "servers": [
    {
      "name": "filesystem",
      "url": "http://mcp-filesystem:3001",
      "protocol": "mcp-v1",
      "enabled": false
    },
    {
      "name": "database",
      "url": "http://mcp-database:3002",
      "protocol": "mcp-v1",
      "enabled": false
    }
  ]
}
```

#### How tool resolution expands

The `tool_registry.py` in the local backend gains a third routing tier:

```
tool_call received
  ├── 1. Native tool?     →  Execute locally
  ├── 2. Dynamic tool?    →  POST /execute/{name} to Docker Tool Service
  └── 3. MCP tool?        →  POST /mcp/execute/{server}/{tool} to Docker Tool Service
                               └── Tool Service proxies to MCP container on tool-net
```

#### Why it scales
- Adding a new MCP server = adding a container to `docker-compose.yml` + a registry entry
- All MCP servers are isolated on `tool-net` — no host access
- The Tool Service acts as a **unified gateway** — the local backend doesn't need to know about individual MCP servers
- MCP servers can be enabled/disabled via registry config without redeployment

---

## 15. Implementation Order

Implement in this sequence to maintain a working system at every stage:

**Phase 1 — Docker Tool Service (core)**
1. Scaffold `tool-service/` directory with FastAPI app, Dockerfile, and docker-compose
2. Implement `synthesis_service.py` with Codestral codegen, static analysis, and self-heal retry
3. Implement `sandbox.py` subprocess sandbox within the container
4. Implement `execution_service.py` with dynamic import and in-process cache
5. Add `tools` SQLite table and management routes (list, approve, reject)
6. Build and verify: `docker compose up --build`

**Phase 2 — Local backend integration**
7. Implement `tool_resolver.py` in local backend (HTTP calls to Docker Tool Service)
8. Update `tool_registry.py` to route: native → local, dynamic → Docker proxy
9. Update `orchestrator_service.py` to use `tool_resolver.py` and fetch schemas from Docker
10. Update `chat_service.py` execution loop to use async `tool_registry.execute()`
11. Verify SSE streaming on `/api/orchestrate/stream` end to end with React UI

**Phase 3 — Workflow engine** *(future)*
12. Create `workflow_engine/` module with models, DAG executor, and step runners
13. Add `workflows` SQLite table and CRUD routes
14. Integrate workflow steps with existing agent and tool services

**Phase 4 — MCP servers** *(future)*
15. Implement `mcp_manager.py` in Docker Tool Service
16. Add MCP routes and registry configuration
17. Add first MCP server container to docker-compose
18. Extend `tool_registry.py` with MCP routing tier

---

*Document version: 3.0 — Scalable architecture with workflow engine and MCP server extension points*
