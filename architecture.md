# Architecture — Layered Pipeline with Parallelism

## System Overview

```mermaid
graph TB
    subgraph Frontend["Frontend (React)"]
        UI["Chat UI / Workflow UI"]
    end

    subgraph Routes["FastAPI Routes"]
        OR["/api/orchestrate"]
        OSR["/api/orchestrate/stream"]
        WPR["/api/workflows/plan"]
    end

    subgraph Adapters["Thin Service Adapters (~120 + ~45 lines)"]
        OS["orchestrator_service.py"]
        WP["workflow_planner.py"]
    end

    subgraph Pipelines["Pipeline Engine"]
        CP["chat_pipeline"]
        WPP["workflow_pipeline"]
    end

    subgraph ChatLayers["Chat Pipeline Layers"]
        direction TB
        CL["CleanupLayer"]
        PG["ParallelGroup"]
        EL["ExecutionLayer"]
    end

    subgraph ParallelOps["⚡ Parallel Group"]
        SL["SynthesisLayer"]
        ARL["AgentResolverLayer"]
    end

    subgraph WorkflowLayer["Workflow Planning Layer"]
        direction TB
        P1["Phase 1: Analyse"]
        P2["Phase 2: Synthesise"]
        P3["Phase 3: Create Agents"]
        P4["Phase 4: Build DAG"]
        P5["Phase 5: Save & Deploy"]
    end

    subgraph External["External Services"]
        MAPI["Mistral AI API"]
        TS["Docker Tool Service"]
    end

    UI -->|HTTP/SSE| OR & OSR & WPR
    OR & OSR --> OS
    WPR --> WP
    OS --> CP
    WP --> WPP
    CP --> CL --> PG --> EL
    PG --> SL & ARL
    WPP --> P1 --> P2 --> P3 --> P4 --> P5
    SL & ARL & EL --> MAPI
    SL & P2 --> TS
    EL --> TS

    style PG fill:#2d6a4f,stroke:#40916c,color:#fff
    style SL fill:#1b4332,stroke:#40916c,color:#fff
    style ARL fill:#1b4332,stroke:#40916c,color:#fff
    style P1 fill:#264653,stroke:#2a9d8f,color:#fff
    style P2 fill:#264653,stroke:#2a9d8f,color:#fff
    style P3 fill:#264653,stroke:#2a9d8f,color:#fff
    style CP fill:#7209b7,stroke:#9d4edd,color:#fff
    style WPP fill:#7209b7,stroke:#9d4edd,color:#fff
```

---

## Chat Pipeline — Detailed Flow

```mermaid
sequenceDiagram
    participant R as Route
    participant A as Adapter
    participant CL as CleanupLayer
    participant PG as ParallelGroup
    participant SL as SynthesisLayer
    participant ARL as AgentResolverLayer
    participant EL as ExecutionLayer
    participant M as Mistral API
    participant TS as Tool Service

    R->>A: orchestrate(query, ...)
    A->>A: Build PipelineContext
    A->>CL: pipeline.execute(ctx)
    
    Note over CL: Wraps in try/finally

    CL->>PG: next(ctx)

    Note over PG: ⚡ asyncio.gather

    par Parallel Execution
        PG->>SL: process(ctx.snapshot())
        SL->>M: LLM: "Need new tool?"
        SL->>TS: trigger_synthesis()
        SL-->>PG: ctx with synthesis_result
    and
        PG->>ARL: process(ctx.snapshot())
        ARL->>M: LLM: "Analyse query"
        ARL->>M: agents.create(...)
        ARL-->>PG: ctx with agent_config + agent_id
    end

    PG->>PG: merge(results)
    PG->>EL: next(ctx)

    EL->>M: conversations.start(agent_id)
    
    loop Tool Call Rounds (max 5)
        Note over EL: ⚡ asyncio.gather per round
        par Concurrent Tool Execution
            EL->>TS: execute_tool(tool_1)
        and
            EL->>TS: execute_tool(tool_2)
        and
            EL->>TS: execute_tool(tool_N)
        end
        EL->>M: conversations.append(results)
    end

    EL-->>CL: ctx with response
    
    Note over CL: finally: delete agent if cleanup_agent

    CL-->>A: ctx
    A-->>R: ctx.result / ctx.events
```

---

## Workflow Pipeline — Internal Parallelism

```mermaid
sequenceDiagram
    participant R as Route
    participant A as Adapter
    participant WPL as WorkflowPlanningLayer
    participant M as Mistral API
    participant TS as Tool Service
    participant AS as Agent Service

    R->>A: plan_workflow_stream(goal)
    A->>A: Build PipelineContext
    A->>WPL: pipeline.execute(ctx)

    Note over WPL: Phase 1: Analyse Goal

    par ⚡ Resource Fetching
        WPL->>TS: list_tools()
    and
        WPL->>AS: list_agents()
    and
        WPL->>M: GET /v1/workflows
    end

    WPL->>M: LLM: Analyse requirements

    Note over WPL: Phase 2: Synthesise Tools

    par ⚡ Bounded Synthesis (Semaphore=3)
        WPL->>TS: synthesize(tool_1)
    and
        WPL->>TS: synthesize(tool_2)
    and
        WPL->>TS: synthesize(tool_3)
    end

    WPL->>TS: refresh_dynamic_tools() [once]

    Note over WPL: Phase 3: Create Agents

    par ⚡ Bounded Creation (Semaphore=5)
        WPL->>M: agents.create(agent_1)
    and
        WPL->>M: agents.create(agent_2)
    and
        WPL->>M: agents.create(agent_N)
    end

    Note over WPL: Phase 4: Build DAG
    WPL->>M: LLM: Build workflow DAG

    Note over WPL: Phase 5: Save & Deploy
    WPL->>WPL: save_workflow()
    WPL->>WPL: compile_to_python()
    WPL->>M: check registration

    WPL-->>A: ctx with events
    A-->>R: yield SSE events
```

---

## Core Framework — Class Hierarchy

```mermaid
classDiagram
    class PipelineContext {
        +str query
        +str agent_id
        +str conversation_id
        +ImageData image
        +str tier
        +bool cleanup_agent
        +bool stream
        +dict agent_config
        +str created_agent_id
        +Any synthesis_result
        +str response_text
        +list~SSEEvent~ events
        +dict result
        +str error
        +dict metadata
        +Any client
        +emit(event, data)
        +set_error(message)
        +snapshot() PipelineContext
        +merge(other)
    }

    class SSEEvent {
        +str event
        +Any data
        +serialize() str
    }

    class Layer {
        <<abstract>>
        +str name
        +bool enabled
        +process(ctx, next)* PipelineContext
        +should_run(ctx) bool
    }

    class ParallelGroup {
        +str name
        +list~Layer~ layers
        +process(ctx, next) PipelineContext
    }

    class Pipeline {
        -list~Layer~ _layers
        +add(layer, before, after) Pipeline
        +remove(name) Pipeline
        +execute(ctx) PipelineContext
        +layer_names list~str~
    }

    class SynthesisLayer { +name = "synthesis" }
    class AgentResolverLayer { +name = "agent_resolver" }
    class ExecutionLayer { +name = "execution" }
    class CleanupLayer { +name = "cleanup" }
    class WorkflowPlanningLayer { +name = "workflow_planning" }

    Layer <|-- ParallelGroup
    Layer <|-- SynthesisLayer
    Layer <|-- AgentResolverLayer
    Layer <|-- ExecutionLayer
    Layer <|-- CleanupLayer
    Layer <|-- WorkflowPlanningLayer
    Pipeline o-- Layer
    ParallelGroup o-- Layer
    PipelineContext o-- SSEEvent
    Layer ..> PipelineContext : processes
```

---

## Before vs After

````carousel
### Before — Monolithic

```
orchestrator_service.py  (717 lines)
├── _parse_agent_config()
├── _sse()
├── _build_user_inputs()
├── _check_synthesis_needed()      ← LLM call
├── orchestrate()
│   ├── _handle_followup()
│   ├── _handle_existing_agent()
│   └── _handle_new_query()
│       ├── _check_synthesis_needed()   ← sequential
│       ├── _analyze_query()            ← sequential  
│       ├── _create_dynamic_agent()     ← sequential
│       └── _process_tool_calls()       ← sequential loop
├── orchestrate_stream()
│   └── _consume_stream_and_tools()     ← sequential tools
├── _extract_response()
└── _extract_stream_chunk()

workflow_planner.py      (370 lines)
├── Phase 1: fetch tools, agents, workflows  ← sequential
├── Phase 2: synthesize tools                ← sequential loop
├── Phase 3: create agents                   ← sequential loop
├── Phase 4: build DAG
└── Phase 5: save & deploy
```

> [!WARNING]
> Every LLM call and I/O operation runs sequentially, even when independent.
<!-- slide -->
### After — Pipeline with Parallelism

```
core/
├── context.py      PipelineContext (snapshot + merge)
├── layer.py        Layer ABC + ParallelGroup
├── pipeline.py     Middleware-style executor
└── events.py       Typed SSEEvent

layers/
├── __init__.py     Pipeline assembly
├── synthesis_layer.py          ─┐
├── agent_resolver_layer.py     ─┤ ⚡ ParallelGroup
├── execution_layer.py           │  ⚡ gather(tool_calls)
├── cleanup_layer.py             │  try/finally wrapper
└── workflow_planning_layer.py   │  ⚡ Phases 1-3 parallel
                                 
services/
├── orchestrator_service.py   (~120 lines — thin adapter)
└── workflow_planner.py       (~45 lines — thin adapter)
```

> [!TIP]
> Adding a new feature = 1 file + 1 line registration. No existing files touched.
````

---

## File Map

```mermaid
graph LR
    subgraph core["core/ (framework)"]
        E[events.py]
        CTX[context.py]
        L[layer.py]
        P[pipeline.py]
    end

    subgraph layers["layers/ (features)"]
        INIT["__init__.py"]
        SL[synthesis_layer.py]
        ARL[agent_resolver_layer.py]
        EL[execution_layer.py]
        CL[cleanup_layer.py]
        WPL[workflow_planning_layer.py]
    end

    subgraph services["services/ (adapters)"]
        OS[orchestrator_service.py]
        WP[workflow_planner.py]
    end

    subgraph routes["routes/"]
        OR[orchestrator.py]
        WR[workflows.py]
    end

    OR --> OS --> INIT
    WR --> WP --> INIT
    INIT --> SL & ARL & EL & CL & WPL
    INIT --> P
    SL & ARL & EL & CL & WPL --> L & CTX
    CTX --> E
    P --> L

    style core fill:#1a1a2e,stroke:#16213e,color:#e94560
    style layers fill:#0f3460,stroke:#16213e,color:#e94560
    style services fill:#533483,stroke:#16213e,color:#e94560
    style routes fill:#2b2d42,stroke:#16213e,color:#e94560
```
