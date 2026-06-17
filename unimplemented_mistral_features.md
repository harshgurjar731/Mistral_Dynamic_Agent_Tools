# Unimplemented Mistral Features Analysis

This document provides a detailed breakdown of the features described in the official Mistral Studio API documentation that are **not currently implemented** in the `Mistral_Dynamic_Agent_Tools` project. 

While the project has extensively integrated Mistral Agents, Custom Tools (including MCP), Conversations, and Temporal-backed Workflows, there are two distinct Mistral-native capabilities missing from the current implementation.

---

## 1. Native Agent Handoffs (`handoffs` & `handoff_execution`)

### Mistral Documentation Definition
Mistral provides a native mechanism called **Handoffs** to orchestrate agentic workflows directly through the Mistral servers. Handoffs allow an agent to autonomously transfer the conversation context to another agent mid-action. 

- When creating or updating an agent, developers can supply a `handoffs` array containing the IDs of other agents that this agent is allowed to delegate to.
- When starting a conversation, developers pass the `handoff_execution` parameter, which dictates whether the handoff runs automatically on Mistral's servers (`server`) or yields back to the client (`client`) for manual intervention.

### Status in the Project: Not Implemented
The project currently manages multi-agent interactions via a custom Orchestrator Engine (`orchestrator_service.py` and `workflow_planner.py`), effectively bypassing Mistral's native agent-to-agent handoff implementation.

- The `agent_service.py` endpoints for creating and updating agents (`POST /agents`, `PATCH /agents/{id}`) do not accept or forward the `handoffs` array to the Mistral API.
- The conversations API calls (`client.beta.conversations.start`) do not configure `handoff_execution`.

### Why it Matters
By not utilizing Mistral's native Handoffs, the project assumes the burden of manually parsing agent outputs, deciding when to transfer control, and routing inputs between agents through the custom Workflow Engine. 
Implementing native handoffs would:
1. Simplify the multi-agent routing logic.
2. Reduce round-trips to the backend since the Mistral server can execute the handoffs internally (using `handoff_execution="server"`).
3. Allow the Mistral UI/Studio to properly reflect agent connections.

---

## 2. Document Library Tool (`document_library`)

### Mistral Documentation Definition
Mistral offers several "built-in" tools that require no infrastructure from the developer to run. Among these is the **Document Library** tool (`{"type": "document_library"}`).
This is a built-in Retrieval-Augmented Generation (RAG) tool that enables an agent to autonomously search through documents that the user has uploaded to their Mistral Libraries. It grounds the agent's knowledge in specific custom data.

### Status in the Project: Not Implemented
The project includes a robust dynamic `tool_registry.py` that maps tools between the frontend and the Mistral API.
Currently, the registry supports:
- `web_search`
- `code_interpreter`
- `image_generation`
- Custom `function` calling
- `mcp` Connectors

However, it **completely lacks support for the `document_library` tool**. An agent cannot be configured with this tool through the UI or the backend services.

### Why it Matters
Without the Document Library tool, users cannot easily ground their Mistral agents using proprietary PDFs, text files, or documentation libraries managed within Mistral Studio. Implementing this would instantly grant agents native RAG capabilities without requiring the project to build a custom vector database or document parsing pipeline.

---

## 3. Advanced Workflow Input Schemas

### Mistral Documentation Definition
According to the [Workflows Building Guide](https://docs.mistral.ai/studio-api/workflows/building-workflows/workflows), a Workflow's `run()` entrypoint can accept any JSON-serializable type, including:
- Primitive inputs and multi-parameter inputs.
- Single Pydantic `BaseModel` schemas.
- A Union of Pydantic models (allowing the workflow to dynamically decide routing based on input structure).
- Optional Unions (`| None`).

### Status in the Project: Partially Implemented
The project translates a dynamic GUI-based DAG into a Mistral Workflow SDK script (`mistral_workflows_compiler.py`). However, it strictly confines all workflow inputs to a single, hardcoded Pydantic wrapper:
```python
class DynamicInput(BaseModel):
    variables: Dict[str, Any] = {}
```

### Why it Matters
By forcing all input through a generic dictionary wrapper, the platform prevents the Mistral Studio and external API consumers from receiving strict, typed input validation. If a user wants to enforce that a Workflow requires specific fields (e.g., `report_type: str`, `include_details: bool`) using Mistral's native UI schema generation, they cannot do so through the current compiler implementation.

---

## 4. Advanced Workflow Control Primitives

### Mistral Documentation Definition
Based on the `sitemap.xml` exploration and workflow documentation, Mistral Workflows support a wide array of advanced orchestration features natively, including:
- **Local Activities** (`/activities/local_activities`): For short-lived functions that shouldn't incur the overhead of standard Temporal task queuing.
- **Sticky Worker Sessions** (`/activities/sticky_worker_sessions`): To keep subsequent activities on the same physical worker (e.g., to reuse a downloaded large model or dataset).
- **Sub-Workflows** (`/sub_workflows`): Allowing a workflow to instantiate and wait for another workflow entirely.
- **Wait For Conditions** (`/waiting_for_conditions`): Natively pausing a workflow until a specific external or internal state evaluates to true.
- **Scheduling** (`/scheduling`): Setting up cron jobs or delayed executions natively on the Mistral server.

### Status in the Project: Not Implemented
The project's Workflow Engine (`mistral_workflows_compiler.py` and `app/routes/workflows.py`) implements a basic DAG engine handling Sequential Execution, Parallel Groups, Condition Steps, and basic UI Signals/Queries. It does not expose or compile code leveraging Sub-Workflows, Local Activities, Scheduling, or native Wait conditions.

### Why it Matters
As users build increasingly complex agentic systems, basic DAGs are insufficient. Exposing native Sub-Workflows allows for modular and reusable architectures. Scheduling allows for periodic reporting agents. Local activities vastly increase execution speed for fast API calls.

---

## 5. Conversational Workflows

### Mistral Documentation Definition
Mistral's documentation highlights the concept of **Conversational Workflows** (`/interacting-with-workflows/conversational_workflows`), integrating workflows directly into *le Chat* or custom interfaces using Vibe, forms, and tools.

### Status in the Project: Not Implemented
While the project has an `orchestrator_service.py` that ties together agent chats and workflows, it lacks direct integration with Mistral's native conversational workflow schemas (e.g., `publish_in_vibe`, `forms_and_confirmations`, `tool_ui`). 

### Why it Matters
Without this parity, workflows deployed through the project remain purely programmatic API endpoints rather than interactive experiences accessible through Mistral's chat interfaces.

---

## Summary Recommendation
To achieve 100% parity with the capabilities described in the Mistral Agents and Workflows APIs, the project should:
1. **Agents:** Update `agent_service.py` to support the `handoffs` array schema and update `tool_registry.py` to support the `document_library` built-in tool.
2. **Workflow Inputs:** Refactor `mistral_workflows_compiler.py` to allow users to define typed Input Models via the GUI, rather than falling back on a generic `Dict[str, Any]` schema.
3. **Advanced Workflows:** Extend the DAG visualizer and compiler to support `Sub-Workflows`, `Local Activities`, and `Scheduled` workflow execution configurations.
