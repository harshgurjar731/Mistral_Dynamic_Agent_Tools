# 🤖 Mistral Dynamic Agent Tools

A production-grade, **hybrid AI agent platform** built on [Mistral AI](https://mistral.ai). Dynamically synthesises tools at runtime, orchestrates multi-step workflows with a local DAG engine (or Mistral's cloud Temporal workers), and exposes everything through a polished React frontend.

---

## ✨ Key Features

| Feature | Description |
|---|---|
| **Dynamic Tool Synthesis** | The agent writes, validates, and registers new Python tools on-demand using Codestral |
| **Hybrid Orchestration** | Local DAG workflow engine with optional fall-through to Mistral Workflows (Temporal) |
| **Containerised Tool Service** | Synthesised tools execute in an isolated Docker sandbox with a non-root user |
| **Agent Management** | Full CRUD for Mistral agents — instructions, model, attached tools |
| **Real-time Streaming** | SSE-based streaming for chat, orchestrator runs, and workflow progress |
| **MCP-Ready** | Architecture supports future Model Context Protocol (MCP) server sidecars |

---

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        React Frontend                           │
│            (Vite + TypeScript + React Query + Zustand)          │
└────────────────────────┬────────────────────────────────────────┘
                         │ HTTP / SSE
┌────────────────────────▼────────────────────────────────────────┐
│               FastAPI Backend  (port 8000)                      │
│  • Agent / Conversation / Tool CRUD                             │
│  • Orchestrator — multi-tool agent runs                         │
│  • Workflow Planner — compile, register, publish workflows       │
│  • Workflow Engine — local DAG executor (fallback)              │
│  • Mistral Workflows Worker — cloud Temporal execution          │
└────────┬───────────────────────────────────┬────────────────────┘
         │ REST                              │ Mistral API
┌────────▼─────────────┐          ┌──────────▼──────────┐
│  Tool Service Docker  │          │   Mistral AI Cloud  │
│     (port 9000)       │          │  (LLM + Workflows)  │
│  • Synthesise tools   │          └─────────────────────┘
│  • Sandbox execution  │
│  • Persist to volume  │
└──────────────────────┘
```

---

## 📁 Project Structure

```
Mistral_Dynamic_Agent_Tools/
├── backend/                    # FastAPI backend
│   ├── app/
│   │   ├── config.py           # Pydantic-Settings config
│   │   ├── main.py             # App entry-point & lifespan
│   │   ├── routes/             # API routers (agents, chat, orchestrator, workflows …)
│   │   └── services/
│   │       ├── agent_service.py
│   │       ├── chat_service.py
│   │       ├── orchestrator_service.py
│   │       ├── tool_registry.py
│   │       ├── tool_resolver.py
│   │       ├── workflow_planner.py
│   │       ├── mistral_worker.py
│   │       ├── mistral_workflows_compiler.py
│   │       └── workflow_engine/  # Local DAG step runners
│   ├── requirements.txt
│   └── .env.example
│
├── frontend/                   # React + Vite + TypeScript UI
│   ├── src/
│   │   ├── components/
│   │   ├── pages/
│   │   └── store/
│   ├── package.json
│   └── vite.config.ts
│
├── tool-service/               # Containerised tool sandbox
│   ├── app/
│   │   ├── routes/
│   │   └── services/
│   ├── dynamic_tools/          # Runtime-generated Python tools
│   ├── Dockerfile
│   ├── docker-compose.yml
│   ├── requirements.txt
│   ├── sandbox_requirements.txt
│   └── .env.example
│
└── mistral_workflows/          # Compiled Mistral Workflow modules
```

---

## 🚀 Getting Started

### Prerequisites

- Python 3.11+
- Node.js 18+ & npm
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
# Open .env and set MISTRAL_API_KEY (and any other values you want to override)
```

#### Tool Service
```bash
cd ../tool-service
cp .env.example .env
# Open .env and set MISTRAL_API_KEY
```

---

### 3. Start the Tool Service (Docker)

```bash
cd tool-service
docker compose up --build -d
```

The tool sandbox will be available at **http://localhost:9000**.

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
Interactive docs: **http://localhost:8000/docs**

> **Note on Mistral Workflows Worker**  
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

## ⚙️ Environment Variables

### `backend/.env`

| Variable | Default | Description |
|---|---|---|
| `MISTRAL_API_KEY` | *(required)* | Your Mistral AI API key |
| `MISTRAL_ORCHESTRATOR_MODEL` | `mistral-large-latest` | Model used for orchestration |
| `MISTRAL_CODING_MODEL` | `codestral-latest` | Model used for tool synthesis |
| `AUTO_APPROVE_DYNAMIC_TOOLS` | `true` | Auto-persist synthesised tools |
| `TOOL_SERVICE_URL` | `http://localhost:9000` | URL of the Docker Tool Service |
| `CORS_ORIGINS` | `http://localhost:5173,...` | Comma-separated allowed origins |
| `DATABASE_URL` | `sqlite:///./sql_app.db` | SQLAlchemy connection string |
| `MISTRAL_WORKER_ENABLED` | `false` | Enable Temporal cloud worker |
| `DEPLOYMENT_NAME` | `dynamic-workflows-worker` | Mistral Workflows deployment name |
| `MISTRAL_WORKFLOWS_DIR` | `../mistral_workflows` | Path to compiled workflow modules |

### `tool-service/.env`

| Variable | Default | Description |
|---|---|---|
| `MISTRAL_API_KEY` | *(required)* | Your Mistral AI API key |
| `MISTRAL_CODING_MODEL` | `codestral-latest` | Model used for code generation |
| `AUTO_APPROVE_DYNAMIC_TOOLS` | `false` | Auto-persist tools in sandbox |
| `DATABASE_URL` | `sqlite:///./tool_service.db` | Tool registry DB (inside container) |

---

## 🔑 API Overview

| Method | Path | Description |
|---|---|---|
| GET | `/api/agents` | List all agents |
| POST | `/api/agents` | Create a new agent |
| GET/PUT/DELETE | `/api/agents/{id}` | Manage a specific agent |
| POST | `/api/conversations` | Start a conversation |
| POST | `/api/chat` | Send a message (streaming) |
| POST | `/api/orchestrator/run` | Run a multi-step orchestration |
| GET | `/api/tools` | List available tools |
| POST | `/api/workflows` | Create & register a workflow |
| GET | `/api/workflows/{id}/status` | Poll workflow execution status |
| GET | `/health` | Service health check |

Full OpenAPI spec is available at `/docs` when the backend is running, and in [`openapi.yaml`](./openapi.yaml).

---

## 🧩 How Dynamic Tool Synthesis Works

1. User sends a task that requires a capability the agent doesn't have.
2. The Orchestrator detects the gap and prompts **Codestral** to write a Python tool.
3. The synthesised code is sent to the **Tool Service** which:
   - Runs static analysis (ruff) and a sandboxed test execution.
   - Persists the tool to the `dynamic_tools/` volume.
4. The new tool is registered in the **Tool Registry** and made available to Mistral agents.
5. Future requests can use the tool immediately — no restart needed.

---

## 🛣️ Roadmap

- [ ] OAuth2 / API-key authentication layer
- [ ] Multi-tenant agent isolation
- [ ] MCP server sidecar support (filesystem, database, web-search)
- [ ] Mistral Workflows cloud deployment guide
- [ ] Tool versioning and rollback
- [ ] Eval framework for synthesised tools

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
