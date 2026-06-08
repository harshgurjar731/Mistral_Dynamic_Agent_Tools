# 🤖 Mistral Dynamic Agent Tools

> **A production-grade, hybrid AI agent platform** built on [Mistral AI](https://mistral.ai).  
> Dynamically synthesises Python tools at runtime, orchestrates multi-step workflows through a local DAG engine (or Mistral's cloud Temporal workers), and exposes everything through a polished React 19 frontend — all with zero agent restart required.

---

## 📋 Table of Contents

1. [Overview](#-overview)
2. [Key Features](#-key-features)
3. [High-Level Architecture](#-high-level-architecture)
4. [Service Deep-Dives](#-service-deep-dives)
   - [Backend (FastAPI)](#-backend-fastapi--port-8000)
   - [Tool Service (Docker)](#-tool-service-docker--port-9000)
   - [Frontend (React + Vite)](#-frontend-react--vite--port-5173)
   - [Mistral Workflows](#-mistral-workflows-module)
5. [Core Subsystems](#-core-subsystems)
   - [Orchestration Engine](#orchestration-engine)
   - [Dynamic Tool Synthesis Pipeline](#dynamic-tool-synthesis-pipeline)
   - [3-Tier Tool Execution Router](#3-tier-tool-execution-router)
   - [Workflow Planner (5-Phase SSE)](#workflow-planner-5-phase-sse-generator)
   - [Mistral Workflows Compiler](#mistral-workflows-compiler)
   - [MCP Manager](#mcp-manager)
6. [Data Flow Diagrams](#-data-flow-diagrams)
7. [Project Structure](#-project-structure)
8. [API Reference](#-api-reference)
9. [Environment Variables](#-environment-variables)
10. [Getting Started](#-getting-started)
11. [Technology Stack](#-technology-stack)
12. [Roadmap](#-roadmap)
13. [Contributing](#-contributing)
14. [License](#-license)

---

## 🔭 Overview

**Mistral Dynamic Agent Tools** solves a fundamental problem with static AI agents: they can only use tools you give them upfront. This platform breaks that constraint — when an agent encounters a task that requires a new capability, it *writes, validates, and registers a new Python tool on-the-fly* using Codestral, without any restart.

The system is built around three independently deployable services:

| Service | Runtime | Port | Responsibility |
|---|---|---|---|
| `backend` | Python / FastAPI | `8000` | Orchestration, agent management, workflow planning, streaming |
| `tool-service` | Python / FastAPI / Docker | `9000` | Tool synthesis, sandboxed execution, MCP proxying |
| `frontend` | React 19 / Vite / TypeScript | `5173` | Full management UI with real-time SSE streaming |

---

## ✨ Key Features

| Feature | Description |
|---|---|
| **Dynamic Tool Synthesis** | Codestral writes new Python tools on-demand; ruff + AST + sandbox validate them before registration |
| **Self-Healing Code Generation** | Up to 3 automatic retry loops with error feedback fed back to Codestral |
| **LLM Execution Fallback** | If a tool crashes at runtime, a secondary Mistral call synthesises a synthetic answer |
| **Hybrid Orchestration** | Local DAG workflow engine with optional fall-through to Mistral Workflows (Temporal cloud) |
| **5-Phase Workflow Planner** | SSE-streamed: analyse → synthesise tools → create agents → build DAG → compile & register |
| **3-Tier Tool Router** | Native (local) → Dynamic (Docker proxy) → MCP (JSON-RPC sidecar) |
| **Multimodal Support** | Vision-capable: send base64-encoded images with user messages via Mistral Vision API |
| **Real-time Streaming** | Full SSE pipelines for chat, orchestrator, and workflow planning |
| **MCP-Ready** | JSON-RPC `initialize` + `tools/list` + `tools/call` handshake implemented; sidecar containers pre-configured |
| **Agent CRUD** | Full lifecycle management of Mistral agents (create, read, update, delete) via `client.beta.agents` |
| **Conversation Persistence** | SQLite-backed conversation history with follow-up message appending |
| **Docker Sandbox** | Tool code executes as `sandboxuser` (non-root) in an isolated container |
| **Content-Hash Deduplication** | SHA-256 hash prevents re-synthesising an identical tool |

---

## 🏗️ High-Level Architecture

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                           React 19 Frontend                                  │
│  Vite + TypeScript + React Query + Zustand + Framer Motion + @xyflow/react   │
│                                                                              │
│  OrchestratorChat │ GeneralChat │ AgentStudio │ ToolLifecycle               │
│  WorkflowPlanner  │ WorkflowVisualizer │ McpRegistry │ HealthDashboard      │
└───────────────────────────┬──────────────────────────────────────────────────┘
                            │ HTTP REST + SSE (EventSource)
                            │
┌───────────────────────────▼──────────────────────────────────────────────────┐
│                    FastAPI Backend   (port 8000)                              │
│                                                                              │
│  Routers:                                                                    │
│  /api/agents          /api/conversations    /api/chat                        │
│  /api/orchestrator    /api/tools            /api/uploads                     │
│  /api/workflows                                                              │
│                                                                              │
│  Core Services:                                                              │
│  ┌─────────────────┐  ┌──────────────────┐  ┌──────────────────────────┐   │
│  │ orchestrator_   │  │ workflow_planner  │  │ mistral_workflows_       │   │
│  │ service.py      │  │ .py              │  │ compiler.py              │   │
│  │ (SSE streaming) │  │ (5-phase SSE)    │  │ (DAG → Python SDK file)  │   │
│  └────────┬────────┘  └────────┬─────────┘  └──────────────────────────┘   │
│           │                   │                                              │
│  ┌────────▼────────────────────▼──────────────────────────────────────────┐ │
│  │  tool_registry.py  ←→  tool_resolver.py  (HTTP bridge to Tool Service) │ │
│  │  3-tier router: Native | Dynamic | MCP                                 │ │
│  └────────────────────────────────────────────────────────────────────────┘ │
│           │                              │                                   │
│           │ SQLite (sql_app.db)          │ Mistral API                       │
└───────────┼──────────────────────────────┼───────────────────────────────────┘
            │ REST HTTP                    │ SDK calls
            │                   ┌──────────▼──────────┐
┌───────────▼─────────┐         │   Mistral AI Cloud  │
│  Tool Service        │         │                     │
│  Docker (port 9000)  │         │  • mistral-large    │
│                      │         │  • codestral-latest │
│  Routes:             │         │  • mistral-vision   │
│  POST /synthesize    │         │  • Mistral Workflows│
│  POST /execute/{n}   │         │    (Temporal cloud) │
│  GET  /tools         │         └─────────────────────┘
│  POST /mcp/execute/…│
│                      │
│  Services:           │
│  synthesis_service   │  ← 6-stage pipeline (Codestral → AST → ruff → sandbox)
│  execution_service   │  ← in-process cache + LLM fallback
│  mcp_manager         │  ← JSON-RPC proxy to MCP sidecar containers
│                      │
│  Volumes:            │
│  /app/dynamic_tools  │  ← synthesised .py files (persisted)
│  /app/db             │  ← SQLite tool registry
│  /app/documents      │  ← generated documents
│  Networks: tool-net  │  ← Docker bridge (future MCP sidecars)
└──────────────────────┘
```

---

## 🔬 Service Deep-Dives

### 🟦 Backend (FastAPI) — Port 8000

**Entry point:** `backend/app/main.py`

#### Startup Lifecycle (`lifespan`)
1. Initialises the `Mistral` client (singleton via `dependencies.py`).
2. Calls `refresh_dynamic_tools()` — fetches all approved tools from the Docker Tool Service and merges them into the in-memory `ALL_TOOLS` registry.
3. Registers custom exception handlers for `MistralAPIError`, `AgentNotFoundError`, `ConversationNotFoundError`, `ToolServiceError`, `WorkflowError`.
4. Mounts `StaticFiles` at `/uploads` for serving uploaded multimodal content.

#### Routers
| Router File | Prefix | Purpose |
|---|---|---|
| `agents.py` | `/api/agents` | CRUD for Mistral agents (list, create, get, update, delete) |
| `chat.py` | `/api/chat` | General chat completions (non-orchestrated) |
| `conversations.py` | `/api/conversations` | Conversation history management |
| `orchestrator.py` | `/api/orchestrator` | Streaming + non-streaming orchestration runs |
| `tools.py` | `/api/tools` | Tool listing, synthesis trigger, approval/rejection |
| `uploads.py` | `/api/uploads` | Multimodal file uploads (images) |
| `workflows.py` | `/api/workflows` | Workflow CRUD, planning (SSE), execution, status polling |

#### Key Configuration (`config.py`)
| Setting | Default | Notes |
|---|---|---|
| `MISTRAL_ORCHESTRATOR_MODEL` | `mistral-large-latest` | Used for query analysis and DAG building |
| `MISTRAL_CODING_MODEL` | `codestral-latest` | Used for tool synthesis |
| `AUTO_APPROVE_DYNAMIC_TOOLS` | `true` | Skips manual review gate |
| `TOOL_SERVICE_URL` | `http://localhost:9000` | Docker Tool Service endpoint |
| `DATABASE_URL` | `sqlite:///./sql_app.db` | Conversation + agent persistence |
| `MISTRAL_WORKER_ENABLED` | `false` | Enable Temporal cloud worker |
| `MISTRAL_WORKFLOWS_DIR` | `../mistral_workflows` | Output directory for compiled `.py` workflow files |

---

### 🟧 Tool Service (Docker) — Port 9000

**Entry point:** `tool-service/app/main.py`

A fully isolated FastAPI microservice running in Docker with a **non-root `sandboxuser`** for subprocess-level isolation.

#### Startup Lifecycle
1. Calls `init_db()` — creates SQLite schema (tool registry).
2. Creates `/app/documents` directory for generated files.
3. Calls `seed_native_tools(db)` — pre-populates 5 built-in tools (`get_weather`, `calculate`, `search_knowledge`, `create_document`, `send_email`).
4. Calls `warm_cache(db)` — dynamically imports all `approved` tools into `_execution_cache` so first calls are instant.

#### Routers
| Router | Path | Purpose |
|---|---|---|
| `synthesis.py` | `POST /synthesize` | Run the 6-stage synthesis pipeline |
| `execution.py` | `POST /execute/{name}` | Execute an approved tool by name |
| `management.py` | `GET/POST/PUT/DELETE /tools/...` | Tool CRUD, approve, reject |
| `mcp.py` | `/mcp/...` | MCP server registration and proxying |

#### Docker Configuration
```
Image Base:    python:3.11-slim
Non-root user: sandboxuser
Exposed port:  9000
Volumes:
  tool-data  → /app/dynamic_tools   (synthesised .py files)
  tool-db    → /app/db              (SQLite registry)
  tool-docs  → /app/documents       (generated documents)
Network:       tool-net (bridge)    (future MCP sidecar discovery)
```

---

### 🟩 Frontend (React + Vite) — Port 5173

**Entry point:** `frontend/src/App.tsx`

Built with React 19, Vite 8, TypeScript 6, and TailwindCSS 4.

#### Pages / Routes
| Path | Component | Purpose |
|---|---|---|
| `/` | `OrchestratorChat` | Main chat with full dynamic orchestration + SSE streaming |
| `/playground` | `GeneralChat` | Direct chat completions without orchestration |
| `/agents` | `AgentStudio` | Browse, create, and edit Mistral agents |
| `/agents/:id` | `AgentDetail` | View agent details, conversations, tool assignments |
| `/tools` | `ToolLifecycle` | Tool registry, synthesis, approval/rejection, code editor |
| `/workflows` | `WorkflowDashboard` | Workflow management hub |
| `/workflows/new` | `WorkflowPlanner` | 5-phase SSE-driven workflow creation with live progress |
| `/workflows/:name` | `WorkflowVisualizer` | Interactive DAG viewer (`@xyflow/react` + `dagre`) |
| `/workflows/:name/execute` | `WorkflowExecutionPage` | Live workflow execution with step tracking |
| `/workflows/archived` | `ArchivedWorkflows` | View persisted/deployed workflow history |
| `/conversations` | `ConversationMgr` | Conversation history browser |
| `/mcp` | `McpRegistry` | MCP server registration and health monitoring |
| `/health` | `HealthDashboard` | System health overview (backend + tool-service) |

#### Key Libraries
| Library | Version | Usage |
|---|---|---|
| `react` | 19.2 | Core UI framework |
| `@tanstack/react-query` | 5.x | Server state management, caching, background refetch |
| `zustand` | 5.x | Global client state (active agent, settings) |
| `framer-motion` | 12.x | Page transitions and micro-animations |
| `@xyflow/react` | 12.x | DAG workflow visualizer |
| `dagre` | 0.8 | Auto-layout for workflow DAGs |
| `react-markdown` + `remark-gfm` | 10.x | Markdown rendering of agent responses |
| `react-syntax-highlighter` | 16.x | Tool source code display |
| `react-hook-form` + `zod` | 7.x / 4.x | Form validation |
| `axios` | 1.x | HTTP client |
| `lucide-react` | 1.x | Icon set |

---

### 🟪 Mistral Workflows Module

**Location:** `mistral_workflows/`

Contains compiled Python files generated by `mistral_workflows_compiler.py`. Each file is a fully deployable Mistral Workflows SDK module with:
- `@workflows.activity()` decorated functions (one per DAG step, with retry policies)
- A `@workflows.workflow.define` class with signals, queries, and the DAG entrypoint
- Determinism-safe primitives (`workflow.now()`, `workflow.uuid4()`)
- A 24-hour `execution_timeout` for long-running workflows

---

## ⚙️ Core Subsystems

### Orchestration Engine

**File:** `backend/app/services/orchestrator_service.py`

The orchestrator is the beating heart of the platform. Every user query goes through a structured pipeline:

```
User Query
    │
    ▼
[1] _check_synthesis_needed()
    │  Uses Codestral to decide if a new tool is required.
    │  If yes, calls tool_resolver.trigger_synthesis() → Tool Service
    │  Then refreshes the dynamic tools cache.
    │
    ▼
[2] _analyze_query()
    │  Uses mistral-large to produce an agent config JSON:
    │  { agent_name, agent_instructions, model, tools[], temperature, tier }
    │
    ▼
[3] _create_dynamic_agent()
    │  Calls client.beta.agents.create() with the resolved tool definitions.
    │  Returns a Mistral agent_id.
    │
    ▼
[4] client.beta.conversations.start()
    │  Starts a new conversation against the dynamic agent.
    │
    ▼
[5] _process_tool_calls()  (loop, max 5 rounds)
    │  Detects function.call entries in the conversation output.
    │  Routes each via execute_tool() (3-tier router).
    │  Appends function.result entries via client.beta.conversations.append().
    │
    ▼
[6] _extract_response()
    │  Finds the last assistant-role message and returns its text.
    │
    ▼
Response returned to caller
```

**Streaming variant** (`orchestrate_stream`):
- Uses `client.beta.conversations.start_stream` / `append_stream`
- Yields typed SSE events: `status`, `agent_config`, `text_chunk`, `conversation_id`, `done`, `error`
- Handles Beta API (`function.call.delta`) and Standard API (`choices[].delta.tool_calls`) tool call formats
- Recursively calls `_consume_stream_and_tools` after executing tool batches to continue the stream

**Three execution paths:**
1. **New query** → full analysis + dynamic agent creation
2. **Existing agent** (`agent_id` provided) → skip analysis, use existing agent
3. **Follow-up** (`conversation_id` provided) → append to existing conversation

---

### Dynamic Tool Synthesis Pipeline

**File:** `tool-service/app/services/synthesis_service.py`

A 6-stage hardened pipeline that goes from a tool spec to a running, registered Python function:

```
Stage 1 — Prompt Builder
  ↓  Assembles a structured Codestral prompt from name, description,
     parameter schema, API details, and expected output shape.

Stage 2 — Codestral Call
  ↓  POST to Mistral with model=codestral-latest, temperature=0.1.
     Strips markdown fences (``` python ... ```) from response.

Stage 3 — Static Analysis (with self-heal loop, max 3 retries)
  ├─ ruff format  (auto-formats code before analysis)
  ├─ ast.parse()  (catches SyntaxError)
  ├─ Import whitelist check
  │   Forbidden: os, subprocess, socket, shutil, sys, ctypes,
  │              multiprocessing, threading, signal, importlib
  │   Allowed: stdlib + requests, pandas, numpy, httpx, pydantic,
  │            mistralai, PIL, sklearn, scipy, aiohttp, bs4, ...
  ├─ Verify `run` function exists (required entrypoint convention)
  └─ ruff lint --select E,F --ignore E501,F401,F841

Stage 3a — Self-Heal Retry Loop
  ↓  Error fed back to Codestral as a follow-up message.
     Repeats Stage 3 → 3a up to MAX_RETRIES=3 times.

Stage 4 — Sandbox Test (with retry loop)
  ↓  generate_test_inputs() creates type-safe dummy arguments.
     run_in_sandbox() executes the run() function in isolation.
     On failure: error fed back to Codestral → re-analyse → re-sandbox.

Stage 5 — Approval Gate
  ├─ AUTO_APPROVE=true  → immediately writes to disk, registers
  └─ AUTO_APPROVE=false → stored as `pending_approval` in SQLite

Stage 6 — Write & Register
  ↓  Written to dynamic_tools/{name}_{hash[:8]}.py
     Dynamically imported via importlib.util
     run() function loaded into _execution_cache[name]
     ToolRecord saved to SQLite (name, hash, version, schema_json,
     source_code, module_path, status, sandbox_output)
```

**Content-hash deduplication:** A SHA-256 hash of `{name, description, parameters}` is computed before synthesis. If the same spec is submitted again, synthesis is skipped and the existing record is returned.

---

### 3-Tier Tool Execution Router

**File:** `backend/app/services/tool_registry.py`

When the orchestrator calls `execute_tool(name, args)`, it routes through three tiers in order:

```
Tier 1 — Native Tools (execute locally, zero latency)
  ├─ execute_sql_query   → SQLAlchemy against backend SQLite
  └─ get_database_schema → sqlite_master inspection

Tier 2 — Dynamic Tools (proxy to Docker Tool Service)
  ├─ Check if name is in _dynamic_tool_schemas (runtime-synthesised)
  └─ POST http://tool-service:9000/execute/{name}
     └─ Tool Service execution_service:
        ├─ load_tool() → _execution_cache[name]
        ├─ run_fn(**arguments)
        ├─ If soft error → llm_fallback() (Codestral generates synthetic result)
        └─ If hard crash → llm_fallback() then return error if fallback also fails

Tier 3 — MCP Tools (proxy through Tool Service to MCP sidecar)
  └─ Tool name format: "server:tool_name"
     POST http://tool-service:9000/mcp/execute/{server}/{tool}
     └─ mcp_manager.execute_tool(server_name, tool_name, args)
        └─ JSON-RPC POST to http://{mcp-server}/mcp
           { "method": "tools/call", "params": { "name": ..., "arguments": ... } }
```

**Built-in Mistral API tools** (pass-through to Mistral cloud, no local execution):
- `web_search` → `{"type": "web_search"}`
- `code_interpreter` → `{"type": "code_interpreter"}`
- `image_generation` → `{"type": "image_generation"}`

---

### Workflow Planner (5-Phase SSE Generator)

**File:** `backend/app/services/workflow_planner.py`

An async generator that streams SSE events during all five phases of workflow creation:

```
Phase 1 — Analyse Goal
  ├─ Fetch existing tools from Tool Service
  ├─ Fetch all Mistral agents (classified into foundation/domain/use_case tiers)
  ├─ Fetch existing Mistral Workflows (cloud API)
  └─ Call mistral-large with WORKFLOW_ANALYSIS_SYSTEM_PROMPT
     → Returns { tools_needed[], agents_needed[], workflow_description }
     SSE event: "requirements"

Phase 2 — Synthesise Missing Tools
  ├─ For each tool_needed NOT already in registry:
  │   └─ tool_resolver.trigger_synthesis() → Tool Service pipeline
  │      → refresh_dynamic_tools() to merge into ALL_TOOLS
  │      SSE events: "tool_exists" or "tool_new"
  └─ On synthesis failure: SSE "fatal_error" and return

Phase 3 — Create Agents
  ├─ For each agent_needed:
  │   ├─ Try to find existing agent by explicit ID or name match
  │   ├─ If found: SSE "agent_exists" (reuse)
  │   └─ If not: client.beta.agents.create() with resolved tools
  │              SSE "agent_new"
  └─ On creation failure: SSE "fatal_error" and return

Phase 4 — Build DAG
  ├─ Call mistral-large with WORKFLOW_DAG_SYSTEM_PROMPT
  │   Inputs: created_agents[], goal, requirements
  └─ Returns WorkflowDefinition JSON (validated via Pydantic)
     SSE event: "status" → "Building workflow DAG…"

Phase 5 — Save, Compile, Register
  ├─ 5a: save_workflow(workflow_def) → persist to local store
  │       SSE event: "workflow_ready" (includes full DAG dict)
  ├─ 5b: compile_workflow_to_python(workflow_def)
  │       Writes workflow_{name}.py to mistral_workflows/
  │       SSE event: "compiled"
  └─ 5c: GET https://api.mistral.ai/v1/workflows → check registration
         If registered: SSE "registered" with mistral_workflow_id
         If not: SSE "registered" with auto-connect note
         SSE event: "done"
```

---

### Mistral Workflows Compiler

**File:** `backend/app/services/mistral_workflows_compiler.py`

Translates a `WorkflowDefinition` Pydantic model (DAG) into a deployable Mistral Workflows SDK Python module:

- **One `@workflows.activity()` per DAG step** — each calls the local `run_step()` engine
- **Timeout policies:** 300s default, 30s for `CONDITION`/`TRANSFORM` step types
- **Retry policy:** `retry_policy_max_attempts=3` on all activities
- **`@workflows.workflow.define` class** with:
  - `user_message` signal (receive messages during execution)
  - `get_progress` query (return completed step IDs)
  - `get_last_result` query (return latest step output)
  - `run()` entrypoint that walks the DAG with cycle detection (max 50 steps)
- **Determinism-safe:** Uses `workflow.now()` instead of `datetime.now()`

---

### MCP Manager

**File:** `tool-service/app/services/mcp_manager.py`

Implements MCP protocol (Model Context Protocol) JSON-RPC for sidecar server discovery and tool proxying:

```
Registration flow:
  POST /mcp/servers  →  MCPManager.register_server()
    │  1. JSON-RPC initialize handshake
    │     { "method": "initialize", "params": { "protocolVersion": "2025-06-18" } }
    │  2. If healthy: tools/list discovery
    └─ Persists to mcp_servers/mcp_registry.json

Execution flow:
  POST /mcp/execute/{server}/{tool}  →  MCPManager.execute_tool()
    └─ JSON-RPC tools/call
       { "method": "tools/call", "params": { "name": tool_name, "arguments": {...} } }
```

**Pre-configured MCP servers** (in `mcp_registry.json`, all disabled by default):
| Name | URL | Description |
|---|---|---|
| `filesystem` | `http://mcp-filesystem:3001` | File system read/write/search |
| `database` | `http://mcp-database:3002` | SQL queries, schema inspection |
| `web-search` | `http://mcp-web-search:3003` | Web search and scraping |

All run as Docker sibling containers on `tool-net` bridge network.

---

## 📊 Data Flow Diagrams

### Chat with Dynamic Orchestration

```
User → POST /api/orchestrator/run (stream=true)
  │
  ├─ SSE: "Analyzing your query..."
  ├─ _check_synthesis_needed()
  │     └─ Codestral: "does this need a new tool?"
  │           YES → trigger_synthesis() → Tool Service → refresh cache
  ├─ SSE: agent_config { agent_name, model, tools, tier }
  ├─ SSE: "Creating {agent_name}..."
  │     └─ client.beta.agents.create(model, name, instructions, tools)
  ├─ SSE: "Processing your query..."
  │     └─ client.beta.conversations.start_stream(agent_id, inputs)
  │           ├─ SSE: text_chunk (streamed tokens)
  │           └─ On tool calls:
  │                 ├─ SSE: "Executing tools..."
  │                 ├─ execute_tool(name, args)  [3-tier router]
  │                 ├─ SSE: "Processing tool results..."
  │                 └─ append_stream(tool results) → more text_chunks
  ├─ SSE: conversation_id
  └─ SSE: done { agent_id, agent_name }
```

### Tool Synthesis Lifecycle

```
Request (name, description, parameters, required)
  │
  ├─ SHA-256 hash → check DB for existing record
  │     FOUND + approved    → return immediately (skip synthesis)
  │     FOUND + pending     → return pending status
  │
  ├─ Stage 2: Codestral generates Python code
  ├─ Stage 3: ruff format → ast.parse → import check → run check → ruff lint
  │     FAIL → append error → Codestral retry (up to 3x)
  ├─ Stage 4: generate_test_inputs → run_in_sandbox
  │     FAIL → append sandbox error → Codestral retry (up to 3x)
  ├─ Stage 5: AUTO_APPROVE check
  │     TRUE  → Stage 6 immediately
  │     FALSE → save as pending_approval
  └─ Stage 6: write to dynamic_tools/{name}_{hash[:8]}.py
              importlib.util.spec_from_file_location → exec
              _execution_cache[name] = module.run
              ToolRecord saved to SQLite
```

---

## 📁 Project Structure

```
Mistral_Dynamic_Agent_Tools/
│
├── backend/                              # FastAPI backend service
│   ├── .env / .env.example
│   ├── requirements.txt
│   ├── sql_app.db                        # SQLite (conversations, agents local data)
│   └── app/
│       ├── main.py                       # App entry-point & lifespan
│       ├── config.py                     # Pydantic-Settings (env vars)
│       ├── database.py                   # SQLAlchemy engine + session
│       ├── dependencies.py               # Mistral client singleton
│       ├── exceptions.py                 # Custom exception classes + handlers
│       ├── prompts.py                    # All LLM system/user prompts (47 KB)
│       ├── routes/
│       │   ├── agents.py                 # GET/POST/PUT/DELETE /api/agents
│       │   ├── chat.py                   # POST /api/chat
│       │   ├── conversations.py          # Conversation history
│       │   ├── orchestrator.py           # POST /api/orchestrator/run (SSE)
│       │   ├── tools.py                  # Tool management + synthesis trigger
│       │   ├── uploads.py                # Multimodal file uploads
│       │   └── workflows.py             # Workflow CRUD + planner (SSE) + execution
│       └── services/
│           ├── agent_service.py          # Mistral agent CRUD wrapper
│           ├── chat_service.py           # General chat completion
│           ├── conversation_service.py   # Conversation persistence
│           ├── conversational_workflow_service.py
│           ├── mistral_worker.py         # Temporal cloud worker runner
│           ├── mistral_workflows_compiler.py  # DAG → Python SDK file
│           ├── orchestrator_service.py   # Core SSE orchestration engine
│           ├── tool_registry.py          # 3-tier tool registry + executor
│           ├── tool_resolver.py          # HTTP client to Tool Service
│           ├── workflow_planner.py       # 5-phase SSE workflow planner
│           └── workflow_engine/          # Local DAG executor
│               ├── engine.py             # save/load/run workflow
│               ├── models.py             # WorkflowDefinition, WorkflowStep, StepType
│               ├── step_runners.py       # Per-step-type execution logic
│               └── _worker_inner.py      # Temporal worker internals
│
├── frontend/                             # React 19 + Vite frontend
│   ├── package.json
│   ├── vite.config.ts
│   ├── index.html
│   └── src/
│       ├── App.tsx                       # Router setup (createBrowserRouter)
│       ├── main.tsx                      # React root (MotionConfig wrapper)
│       ├── index.css                     # Global styles + CSS variables
│       ├── api/                          # Axios API client functions
│       ├── components/
│       │   └── layout/AppShell.tsx       # Sidebar + main layout wrapper
│       ├── features/
│       │   ├── agents/                   # AgentStudio, AgentDetail
│       │   ├── chat/                     # OrchestratorChat, GeneralChat
│       │   ├── conversations/            # ConversationManager
│       │   ├── health/                   # HealthDashboard
│       │   ├── mcp/                      # McpRegistry
│       │   ├── tools/                    # ToolLifecycle
│       │   └── workflows/                # WorkflowDashboard, Planner, Visualizer, Execution
│       ├── lib/                          # Shared utilities
│       ├── store/                        # Zustand global state
│       └── styles/                       # Design tokens
│
├── tool-service/                         # Dockerised tool sandbox
│   ├── Dockerfile                        # python:3.11-slim, sandboxuser, ruff
│   ├── docker-compose.yml                # service + volumes + tool-net
│   ├── requirements.txt                  # fastapi, uvicorn, mistralai, httpx, sqlalchemy
│   ├── sandbox_requirements.txt          # requests, pandas, numpy, bs4, httpx
│   ├── .env / .env.example
│   ├── dynamic_tools/                    # Synthesised .py tool files (volume-mounted)
│   ├── mcp_servers/
│   │   └── mcp_registry.json             # MCP server definitions (filesystem/db/web-search)
│   └── app/
│       ├── main.py                       # FastAPI entry-point (seed + warm cache)
│       ├── config.py                     # Tool-service settings
│       ├── database.py                   # SQLAlchemy (tool_service.db)
│       ├── models.py                     # ToolRecord ORM model
│       ├── schemas.py                    # Pydantic request/response schemas
│       ├── seed_native_tools.py          # Pre-seeds 5 built-in tools
│       ├── prompts.py                    # Codestral synthesis prompts (34 KB)
│       ├── routes/
│       │   ├── synthesis.py              # POST /synthesize
│       │   ├── execution.py              # POST /execute/{name}
│       │   ├── management.py             # GET/POST/PUT/DELETE /tools/...
│       │   └── mcp.py                    # MCP server management + proxy
│       └── services/
│           ├── synthesis_service.py      # 6-stage Codestral pipeline
│           ├── execution_service.py      # Cache + LLM fallback executor
│           ├── mcp_manager.py            # MCP JSON-RPC manager (singleton)
│           ├── sandbox.py                # Sandboxed test execution
│           └── llm_fallback.py           # Codestral fallback result generator
│
└── mistral_workflows/                    # Compiled Mistral Workflows SDK .py files
    └── workflow_{name}.py                # Auto-generated by compiler
```

---

## 📡 API Reference

### Backend — `http://localhost:8000`

#### Agents
| Method | Path | Description |
|---|---|---|
| `GET` | `/api/agents` | List all Mistral agents (paginated) |
| `POST` | `/api/agents` | Create a new Mistral agent |
| `GET` | `/api/agents/{id}` | Get a specific agent |
| `PUT` | `/api/agents/{id}` | Update agent (name, model, instructions, tools) |
| `DELETE` | `/api/agents/{id}` | Delete a Mistral agent |

#### Chat & Orchestration
| Method | Path | Description |
|---|---|---|
| `POST` | `/api/chat` | General chat completion (non-orchestrated) |
| `POST` | `/api/orchestrator/run` | Full orchestration run (supports `stream=true`) |

#### Tools
| Method | Path | Description |
|---|---|---|
| `GET` | `/api/tools` | List all available tools (native + dynamic) |
| `POST` | `/api/tools/synthesize` | Explicitly trigger tool synthesis from task description |
| `POST` | `/api/tools/{id}/approve` | Approve a pending tool |
| `POST` | `/api/tools/{id}/reject` | Reject a pending tool |

#### Workflows
| Method | Path | Description |
|---|---|---|
| `POST` | `/api/workflows` | Create a workflow (SSE stream of 5 phases) |
| `GET` | `/api/workflows` | List all local workflows |
| `GET` | `/api/workflows/{name}` | Get a specific workflow definition (DAG) |
| `POST` | `/api/workflows/{name}/execute` | Execute a workflow with input variables |
| `GET` | `/api/workflows/{name}/status` | Poll execution status |
| `DELETE` | `/api/workflows/{name}` | Delete a workflow |

#### System
| Method | Path | Description |
|---|---|---|
| `GET` | `/health` | Backend health check (includes tool-service reachability) |

---

### Tool Service — `http://localhost:9000`

| Method | Path | Description |
|---|---|---|
| `POST` | `/synthesize` | Run the 6-stage synthesis pipeline |
| `POST` | `/execute/{name}` | Execute a named approved tool |
| `GET` | `/tools` | List all tools with schemas |
| `GET` | `/tools/pending` | List tools awaiting approval |
| `GET` | `/tools/by-hash/{hash}` | Look up tool by content hash |
| `POST` | `/tools/{id}/approve` | Approve a pending tool |
| `POST` | `/tools/{id}/reject` | Reject a pending tool |
| `PUT` | `/tools/{id}` | Update tool code and description |
| `DELETE` | `/tools/{id}` | Delete a tool from DB, disk, and cache |
| `GET` | `/mcp/servers` | List registered MCP servers |
| `POST` | `/mcp/servers` | Register a new MCP server |
| `POST` | `/mcp/execute/{server}/{tool}` | Execute an MCP tool via proxy |
| `POST` | `/mcp/health-check` | Health-check all registered MCP servers |
| `GET` | `/health` | Tool service health check |

Full OpenAPI spec available at `/docs` (both services) and in [`openapi.yaml`](./openapi.yaml).

---

## 🔐 Environment Variables

### `backend/.env`

| Variable | Default | Description |
|---|---|---|
| `MISTRAL_API_KEY` | *(required)* | Your Mistral AI API key |
| `MISTRAL_ORCHESTRATOR_MODEL` | `mistral-large-latest` | Model for orchestration and DAG planning |
| `MISTRAL_CODING_MODEL` | `codestral-latest` | Model for tool synthesis |
| `AUTO_APPROVE_DYNAMIC_TOOLS` | `true` | Auto-approve synthesised tools (skip human review) |
| `TOOL_SERVICE_URL` | `http://localhost:9000` | Docker Tool Service URL |
| `CORS_ORIGINS` | `http://localhost:5173,...` | Comma-separated allowed CORS origins |
| `DATABASE_URL` | `sqlite:///./sql_app.db` | SQLAlchemy connection string |
| `API_PREFIX` | `/api` | URL prefix for all API routes |
| `WORKFLOW_MAX_STEPS` | `20` | Max steps allowed in a single workflow execution |
| `WORKFLOW_STEP_TIMEOUT` | `60` | Per-step timeout in seconds |
| `MISTRAL_WORKER_ENABLED` | `false` | Enable Temporal cloud worker (requires `mistralai-workflows`) |
| `DEPLOYMENT_NAME` | `default` | Mistral Workflows deployment name |
| `MISTRAL_WORKFLOWS_DIR` | `../mistral_workflows` | Output path for compiled workflow `.py` files |

### `tool-service/.env`

| Variable | Default | Description |
|---|---|---|
| `MISTRAL_API_KEY` | *(required)* | Your Mistral AI API key (for Codestral synthesis) |
| `MISTRAL_CODING_MODEL` | `codestral-latest` | Model used for code generation |
| `AUTO_APPROVE_DYNAMIC_TOOLS` | `false` | Auto-approve synthesised tools inside the container |
| `DATABASE_URL` | `sqlite:///./tool_service.db` | Tool registry DB path |
| `MCP_REGISTRY_PATH` | `mcp_servers/mcp_registry.json` | Path to MCP server registry JSON |

---

## 🚀 Getting Started

### Prerequisites

- Python **3.11+**
- Node.js **18+** & npm
- Docker & Docker Compose
- A [Mistral AI API key](https://console.mistral.ai/)

---

### 1. Clone the repo

```bash
git clone https://github.com/<your-username>/Mistral_Dynamic_Agent_Tools.git
cd Mistral_Dynamic_Agent_Tools
```

---

### 2. Configure environment variables

#### Backend
```bash
cd backend
cp .env.example .env
# Edit .env — set MISTRAL_API_KEY at minimum
```

#### Tool Service
```bash
cd ../tool-service
cp .env.example .env
# Edit .env — set MISTRAL_API_KEY
```

---

### 3. Start the Tool Service (Docker)

```bash
cd tool-service
docker compose up --build -d
```

The tool sandbox will be available at **http://localhost:9000**.  
Swagger UI: **http://localhost:9000/docs**

> **What happens on first start:**
> - SQLite schema is created in the `tool-db` volume
> - 5 native tools are seeded (`get_weather`, `calculate`, `search_knowledge`, `create_document`, `send_email`)
> - Execution cache is warmed with all approved tools

---

### 4. Start the Backend

```bash
cd backend
python -m venv .venv

# Windows
.venv\Scripts\activate
# macOS / Linux
source .venv/bin/activate

pip install -r requirements.txt
uvicorn app.main:app --reload
```

The API will be available at **http://localhost:8000**.  
Swagger UI: **http://localhost:8000/docs**

> **Note on Mistral Workflows Worker:**  
> Set `MISTRAL_WORKER_ENABLED=false` in `backend/.env` unless you have a Mistral cloud deployment configured. The local DAG engine handles all workflows by default.

---

### 5. Start the Frontend

```bash
cd frontend
npm install
npm run dev
```

The UI will be available at **http://localhost:5173**.

---

## 🛠️ Technology Stack

### Backend
| Technology | Version | Role |
|---|---|---|
| Python | 3.11+ | Core runtime |
| FastAPI | latest | Web framework |
| Uvicorn | latest | ASGI server |
| Pydantic / pydantic-settings | v2 | Data validation & config |
| SQLAlchemy | latest | ORM + SQLite |
| mistralai | latest | Mistral SDK (agents, chat, conversations, workflows) |
| httpx | latest | Async HTTP client (tool-service bridge) |
| watchfiles | latest | Hot reload |

### Tool Service
| Technology | Version | Role |
|---|---|---|
| Python | 3.11+ (Docker) | Core runtime |
| FastAPI | latest | Web framework |
| ruff | latest | Static analysis & auto-formatting |
| importlib.util | stdlib | Dynamic tool loading |
| ast | stdlib | Syntax validation + import checking |

### Frontend
| Technology | Version | Role |
|---|---|---|
| React | 19.2 | UI framework |
| TypeScript | 6.0 | Type safety |
| Vite | 8.x | Build tool & dev server |
| TailwindCSS | 4.x | Utility CSS |
| @tanstack/react-query | 5.x | Server state |
| Zustand | 5.x | Client state |
| @xyflow/react + dagre | 12.x / 0.8 | DAG visualizer |
| Framer Motion | 12.x | Animations |

---

## 🛣️ Roadmap

- [ ] OAuth2 / API-key authentication layer
- [ ] Multi-tenant agent isolation
- [ ] MCP server sidecar support (filesystem, database, web-search — infrastructure ready)
- [ ] Mistral Workflows cloud deployment guide
- [ ] Tool versioning and rollback
- [ ] Eval framework for synthesised tools
- [ ] Agent tier management UI (foundation / domain / use_case)
- [ ] Workflow execution history and replay
- [ ] Rate limiting and quotas per-agent

---

## 🤝 Contributing

Pull requests are welcome! Please open an issue first to discuss major changes.

1. Fork the repo
2. Create a feature branch (`git checkout -b feature/my-feature`)
3. Commit your changes (`git commit -m 'Add my feature'`)
4. Push to the branch (`git push origin feature/my-feature`)
5. Open a Pull Request

---

## 📄 License

MIT © 2026 — see [LICENSE](./LICENSE) for details.
