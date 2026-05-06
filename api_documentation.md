# Mistral Dynamic Agent Architecture — API Documentation

This document provides a comprehensive list of all APIs available in the Mistral Dynamic Agent project, split across the two primary microservices.

---

## 1. Backend Orchestrator (Port 8000)
The backend service (`app.main`) handles all user-facing interactions, Mistral LLM communications, and workflow orchestration. All core APIs are prefixed with `/api`.

### System & Health
* **`GET /health`**
  * **Description**: Checks the health of the FastAPI application and verifies connectivity to the Docker Tool Service.
* **`GET /docs`**
  * **Description**: Auto-generated Swagger UI for interactive API exploration.

### Agents (`/api/agents`)
* **`GET /api/agents`**
  * **Description**: Lists all saved and available Mistral agents.
  * **Query Params**: `page`, `page_size`
* **`GET /api/agents/{agent_id}`**
  * **Description**: Retrieves detailed configuration for a specific agent.
* **`POST /api/agents`**
  * **Description**: Creates a new permanent agent.
  * **Body**: `CreateAgentRequest` (requires `name`, `model`, optional `instructions`, `description`, `tools`).
* **`PATCH /api/agents/{agent_id}`**
  * **Description**: Updates an existing agent's configuration.
  * **Body**: `UpdateAgentRequest` (optional `name`, `instructions`, `description`).
* **`DELETE /api/agents/{agent_id}`**
  * **Description**: Deletes an agent from the system.

### Chat (`/api/chat`)
* **`POST /api/chat/completions`**
  * **Description**: Direct chat completion bypassing the orchestrator. Supports automatic multi-turn tool execution.
  * **Body**: `ChatCompletionRequest` (requires `model`, `messages`, aligned with standard Mistral API).
* **`POST /api/chat/stream`**
  * **Description**: Direct chat completion returning a Server-Sent Events (SSE) stream for real-time typing effects.
  * **Body**: `ChatCompletionRequest`.

### Conversations (`/api/conversations`)
* **`GET /api/conversations`**
  * **Description**: Lists all active conversation threads.
* **`GET /api/conversations/{conversation_id}`**
  * **Description**: Retrieves metadata for a specific conversation.
* **`GET /api/conversations/{conversation_id}/history`**
  * **Description**: Retrieves all messages and tool execution entries in a conversation's history.
* **`DELETE /api/conversations/{conversation_id}`**
  * **Description**: Deletes a conversation thread.

### Orchestrator (`/api/orchestrate`)
* **`POST /api/orchestrate`**
  * **Description**: The primary entry point for the agentic workflow. Analyzes user intent, dynamically synthesizes missing tools via Codestral, routes to the appropriate agent, and executes the request.
  * **Body**: `OrchestratorRequest` (requires `query`, optional `agent_id`, `conversation_id`, `workflow`).
* **`POST /api/orchestrate/stream`**
  * **Description**: Streaming equivalent of the orchestrator, yielding progress events and final text chunks via SSE.

### Workflows (`/api/workflows`)
* **`GET /api/workflows`**
  * **Description**: Lists all registered Directed Acyclic Graph (DAG) workflows.
* **`POST /api/workflows`**
  * **Description**: Creates a new workflow definition.
* **`GET /api/workflows/{workflow_name}`**
  * **Description**: Retrieves the DAG structure of a specific workflow.
* **`POST /api/workflows/{workflow_name}/execute`**
  * **Description**: Executes a multi-step workflow.
* **`GET /api/workflows/executions/{execution_id}`**
  * **Description**: Retrieves the status and result of a historical workflow execution.
* **`DELETE /api/workflows/{workflow_name}`**
  * **Description**: Deletes a workflow definition.

### Tools Proxy (`/api/tools`)
*Note: These endpoints act as proxies to the Docker Tool Service.*
* **`GET /api/tools`**
  * **Description**: Lists all active tools currently loaded in the registry.
* **`GET /api/tools/pending`**
  * **Description**: Lists newly synthesized dynamic tools awaiting human approval.
* **`POST /api/tools/{tool_id}/approve`**
  * **Description**: Approves a pending tool, moving it into active production.
* **`POST /api/tools/{tool_id}/reject`**
  * **Description**: Rejects and deletes a pending tool.

---

## 2. Docker Tool Service (Port 9000)
The containerized microservice responsible for dynamic tool lifecycle management (synthesis, sandboxing, and execution) and MCP integration.

### Health
* **`GET /health`**
  * **Description**: Basic health check verifying the sandbox is responsive.

### Synthesis (`/synthesize`)
* **`POST /synthesize`**
  * **Description**: Takes a natural language task description, uses Codestral to generate Python code, runs AST safety checks and Ruff linting, and executes the code in a sandboxed subprocess to ensure it works before saving it to the `pending` database.
  * **Body**: Requires `task` (string description of the tool to create).

### Execution (`/execute`)
* **`POST /execute/{tool_name}`**
  * **Description**: Executes a dynamic tool safely in a non-root subprocess.
  * **Body**: JSON object containing the `kwargs` arguments to pass to the tool.

### Tool Management (`/tools`)
* **`GET /tools`**
  * **Description**: Lists all approved tools and their JSON schemas (used by the orchestrator for tool injection).
* **`GET /tools/by-hash/{hash}`**
  * **Description**: Looks up a tool based on its SHA-256 source code hash to prevent duplicates.
* **`GET /tools/pending`**
  * **Description**: Lists tools that have passed sandbox testing but await human approval.
* **`POST /tools/{tool_id}/approve`**
  * **Description**: Promotes a tool from pending to approved.
* **`POST /tools/{tool_id}/reject`**
  * **Description**: Deletes a pending tool.

### Model Context Protocol (MCP) (`/servers`)
* **`GET /servers`**
  * **Description**: Lists all currently registered MCP servers from the `mcp_registry.json`.
* **`POST /servers`**
  * **Description**: Registers a new external MCP server.
* **`POST /execute/{server_name}/{tool_name}`**
  * **Description**: Routes a tool execution request to an external MCP server via JSON-RPC.
* **`POST /health-check`**
  * **Description**: Pings all registered MCP servers to verify connectivity.
