# Agent Control Plane

# Build a Production-Grade Agentic AI Control Plane UI

## 0. PRIMARY OBJECTIVE

Rebuild the frontend for the existing **Agentic AI Design Patterns** platform using the existing backend exactly as specified in the attached `LOVABLE_FRONTEND_SPEC.md`.

The backend is already implemented and is NOT to be changed.

Your task is to create a **production-grade, premium, futuristic AI/agent-centric frontend** that plugs directly into the existing FastAPI backend.

This is not a prototype.

This should feel like an internal platform built by a world-class AI infrastructure/product team — somewhere between:

* OpenAI developer tooling
* Anthropic Console
* LangGraph Studio
* Linear
* Vercel
* Ray Dashboard
* modern observability platforms
* high-end enterprise AI control planes

The visual language should be:

**Dark + glassmorphic + futuristic + intelligent + technical + premium + restrained.**

Avoid gimmicky “cyberpunk” styling.

The UI should communicate:

> “This is a serious control plane for building, orchestrating, observing and governing AI agents.”

---

# 1. ABSOLUTE BACKEND CONTRACT

The backend is fixed.

DO NOT modify, redesign, rename, reinterpret or simplify the backend APIs.

Every endpoint, HTTP method, request body, query parameter, response shape and SSE event described in `LOVABLE_FRONTEND_SPEC.md` must be respected exactly.

The specification explicitly states that backend wiring is authoritative and the frontend must reproduce it exactly.

Do NOT:

* create fake APIs
* create mock data as the primary data source
* invent endpoint names
* change payload structures
* change SSE event names
* hardcode backend data that should come from APIs
* replace REST/SSE with local-only state
* add authentication/login
* change API prefixes
* shorten request timeouts
* remove existing functionality
* replace Graph RAG with a static visualization

The finished application must work against the existing backend without backend changes.

---

# 2. REQUIRED TECHNOLOGY

Use:

* React 19
* TypeScript
* Vite
* React Router DOM v7
* TanStack React Query v5
* Axios
* Zustand + persist
* @xyflow/react v12
* dagre
* react-markdown
* remark-gfm
* react-syntax-highlighter
* lucide-react
* framer-motion
* Tailwind CSS
* shadcn/ui or Radix-based primitives

For graphs, use:

* @xyflow/react
* dagre
* custom React Flow nodes
* custom edges
* minimap
* zoom controls
* fit-view
* progressive expansion
* selection state
* inspector panels

Do not replace React Flow with a static SVG graph.

---

# 3. API CONNECTION

The frontend must communicate through relative paths.

Use:

```ts
export const api = axios.create({
  baseURL: '',
  timeout: 420_000,
  headers: {
    'Content-Type': 'application/json'
  }
});
```

Vite proxy:

```ts
server: {
  port: 3000,
  proxy: {
    '/api': 'http://localhost:8000',
    '/health': 'http://localhost:8000',
    '/uploads': 'http://localhost:8000'
  }
}
```

Support the optional `localStorage.auth_token` header exactly as specified.

Do not create a login screen.

Handle both backend error formats:

```json
{ "detail": "..." }
```

and

```json
{
  "error": "...",
  "message": "...",
  "details": {}
}
```

Also check for `{ error: "..." }` in HTTP 200 responses.

Long-running operations may take minutes.

Never use a 30-second timeout.

---

# 4. PRODUCT IDENTITY

Product name:

**Agentic AI Design Patterns**

Positioning:

> AI Agent Control Plane

Core pillars:

1. Orchestration
2. Agents
3. Dynamic Tools
4. Workflows
5. Executions
6. Ontology
7. Graph RAG
8. Connectors
9. MCP
10. Libraries
11. Conversations
12. Platform Health

The product is a control plane for building, running and observing AI agent systems on top of Mistral AI. Its six core capabilities are orchestration, agents, dynamic tools, workflows, ontology and Graph RAG.

---

# 5. VISUAL DIRECTION

## Overall aesthetic

Create a sophisticated dark interface.

Base background:

* almost-black navy
* subtle blue/indigo undertones
* very low contrast background gradients

Use:

* translucent surfaces
* backdrop blur
* thin borders
* subtle inner highlights
* soft shadows
* atmospheric gradients
* restrained glow
* depth through layering

Do NOT make every card glow.

Do NOT use excessive neon.

Do NOT make everything rounded like a consumer SaaS dashboard.

The aesthetic should be:

**80% enterprise AI infrastructure**
**15% futuristic**
**5% visual spectacle**

---

# 6. COLOR SYSTEM

Use a semantic token system.

Base:

```css
--background: #05070B;
--background-elevated: #080C12;
--surface: rgba(15, 20, 29, 0.68);
--surface-elevated: rgba(20, 27, 38, 0.78);
--surface-hover: rgba(30, 38, 52, 0.72);

--border: rgba(148, 163, 184, 0.12);
--border-strong: rgba(148, 163, 184, 0.20);

--text-primary: #F8FAFC;
--text-secondary: #CBD5E1;
--text-muted: #94A3B8;
```

Accent palette:

```css
--indigo: #6366F1;
--purple: #8B5CF6;
--blue: #3B82F6;
--cyan: #06B6D4;
--pink: #EC4899;
--emerald: #10B981;
--amber: #F59E0B;
--red: #EF4444;
```

Use gradients sparingly.

Preferred gradient:

```text
indigo → violet → cyan
```

Only use stronger glow for:

* active AI processing
* selected graph nodes
* active workflow execution
* streaming
* important primary CTA
* system status

---

# 7. GLASS SYSTEM

Create reusable primitives:

* GlassPanel
* GlassCard
* GlassModal
* GlassDrawer
* GlassTooltip
* GlassInput
* GlassButton
* GlassTabs
* GlassTable
* GlassBadge
* GlassInspector
* GlassCommandBar

Glass panels should use:

```css
background: rgba(...)
backdrop-filter: blur(...)
border: 1px solid rgba(...)
```

The glass effect must remain subtle and readable.

Avoid excessive transparency that makes text difficult to read.

---

# 8. TYPOGRAPHY

Primary:

**Inter**

Monospace:

**JetBrains Mono**

Use:

* strong typography hierarchy
* compact eyebrow labels
* large page titles
* readable descriptions
* monospace for IDs, code, traces and technical metadata

Page structure:

```text
EYEBROW
Large Title
Short descriptive subtitle

Primary action area
Content
```

Do not make every piece of text uppercase.

---

# 9. GLOBAL APP SHELL

Create a premium application shell.

Desktop:

```text
┌──────────────────────────────────────────────────────────────┐
│ Sidebar │                    Main Workspace                  │
│         │                                                     │
│         │                                                     │
│         │                                                     │
└──────────────────────────────────────────────────────────────┘
```

Sidebar:

* 280px expanded
* 72px collapsed
* animated spring transition
* icon-only collapsed state
* mobile drawer below md breakpoint

Brand:

**Agentic AI Design Patterns**

Use a subtle sparkle/agent mark.

Navigation:

* Orchestrator
* Playground
* Agents
* Tools
* Workflows
* Executions
* Conversations
* Connectors
* Ontology
* MCP Servers
* Libraries
* Health

Preserve expandable sidebar groups:

### Playground

```text
Chats
+ New session
Session 1
Session 2
...
```

### Agents

```text
Active Agents
Agent A
  Sessions
Agent B
  Sessions
```

Persist sessions using Zustand + persist.

Use:

```text
mistral-chat-sessions
```

for chat sessions.

Use:

```text
agent_planner_history
```

for planner history.

---

# 10. GLOBAL NAVIGATION EXPERIENCE

Add a subtle command-center feel.

Top workspace header should support:

* breadcrumbs
* contextual actions
* connection status
* current environment
* refresh
* command/search affordance where appropriate

Do not overcrowd the header.

Use a floating command palette for navigation/actions.

---

# 11. GLOBAL LIVE SYSTEM INDICATOR

Because this platform has multiple streaming surfaces, introduce a unified live-state visual language.

States:

```text
Idle
Connecting
Live
Reconnecting
Closed
Disconnected
Error
```

Use:

* tiny animated pulse
* semantic badge
* tooltip
* elapsed time when relevant

Do not use aggressive blinking.

---

# 12. ORCHESTRATOR — `/`

This is the hero experience.

Make this the most polished screen.

Empty state:

Large centered heading:

> What do you want your AI system to accomplish?

Subheading explaining that the platform can design and orchestrate an agent automatically.

Composer:

* large glass textarea
* auto-resizing
* max height 120px
* Enter = submit
* Shift+Enter = newline
* tier selector
* send button

Once submitted, transition into an AI execution narrative.

Show a vertical timeline:

```text
● Analysing your query
│
● Designing agent
│
● Selecting model
│
● Equipping tools
│
● Creating agent
│
● Executing
│
● Processing results
│
● Complete
```

Each step should animate naturally.

Active step:

* pulsing dot
* subtle glow
* shimmer

Completed step:

* check icon
* reduced glow

Error:

* red state
* expandable error details

When `agent_config` arrives, render a beautiful Agent Blueprint Card containing:

* agent name
* model
* tier
* tools
* connectors

When `text_chunk` streams:

* render markdown live
* smooth text reveal
* keep autoscroll
* don't animate every character individually

When complete:

show:

**Agent created**

with CTA:

**Open Agent →**

The Orchestrator timeline is a core identity of the product and should visually communicate the backend process without exposing hidden chain-of-thought. Use event/status information supplied by the backend only.

---

# 13. PLAYGROUND — `/playground`

Two-pane AI chat environment.

Main:

* conversation
* assistant messages
* markdown
* code blocks
* image attachments
* streaming

Right:

**Chat Settings**

Controls:

* model
* safe prompt
* advanced settings

Composer:

* attachment
* textarea
* send
* streaming state

Create polished assistant/user message bubbles without excessive rounded-card styling.

Assistant messages should feel like AI workspace output rather than social messaging.

---

# 14. AGENT STUDIO — `/agents`

Create a premium agent management grid.

Header:

**Agent Studio**

Subtitle:

> Create and manage specialized AI agents.

Toolbar:

* Search
* Tier filter
* Domain filter
* Sort
* Create Agent

Agent cards should show:

* agent name
* model
* description
* tier
* domain
* industry knowledge indicator
* tool count
* connector count
* created time
* protected state

Tier identity:

### Foundation

Indigo

### Domain

Amber

### Use Case

Emerald

Fetch tiers from:

`GET /api/ontology/tiers`

Never hardcode the actual tier list.

Cards should have subtle hover elevation and border illumination.

---

# 15. AGENT DETAIL — `/agents/:id`

Create a professional AI agent cockpit.

Desktop:

```text
┌─────────────────────────────────────┬──────────────────────┐
│                                     │                      │
│              Agent Chat             │ Configuration         │
│                                     │ Inspector             │
│                                     │                      │
│                                     │                      │
└─────────────────────────────────────┴──────────────────────┘
```

Configuration inspector:

### Agent Configuration

* Name
* Description
* Model
* Instructions
* Tier
* Use Case
* Domain

### Completion Parameters

* Temperature
* Top P
* Max Tokens
* Random Seed
* Frequency Penalty
* Presence Penalty

### Tools Equipped

### Connectors

Changes are saved only on explicit Save/PATCH.

Never autosave every keystroke.

---

# 16. TOOLS — `/tools`

Design this like an AI tool laboratory.

Tabs:

* Active Tools
* Pending Review

Main area:

Tool cards with:

* tool name
* version
* source
* status
* description
* hash
* sandbox status

Source identities:

```text
builtin
native
dynamic
```

Dynamic tools get editable controls.

Native and builtin tools are read-only.

Tool detail should feel like an IDE:

```text
Tool Definition
────────────────────────
Python source code
```

Use syntax highlighting.

Additional panels:

* Parameters Schema
* Sandbox Output
* Publish
* Remote Server
* MCP

Synthesis should show a multi-stage progress experience rather than a generic spinner.

---

# 17. WORKFLOWS — `/workflows`

This should feel like an AI orchestration command center.

Header:

**Workflows**

Subtitle:

> Design, execute, and monitor multi-agent pipelines.

Workflow cards:

* name
* description
* step count
* entry step
* source
* deployment state
* unpublished changes

Actions:

* Open Builder
* Register
* Archive
* Execute
* Inspect

Use a compact but premium grid/list hybrid.

---

# 18. WORKFLOW CREATION CHOOSER — `/workflows/new`

Two major cards:

## AI Planner

> Describe it

Explain:

* tools attached to agents
* agents wired into a DAG
* publishable workflow

## Visual Builder

> Build it visually

Use visually distinct icons and previews.

The cards should feel like two different creation modes rather than ordinary navigation cards.

---

# 19. AI WORKFLOW PLANNER — `/workflows/new/ai`

Make this one of the strongest screens.

Structure:

```text
Workflow goal
       ↓
Planning timeline
       ↓
Requirements
       ↓
Tools
       ↓
Agents
       ↓
DAG
       ↓
Compilation
       ↓
Registration
```

Show five-phase planning progress.

Live events must update the UI.

Events:

* status
* requirements
* tool_exists
* tool_new
* agent_exists
* agent_new
* workflow_ready
* compiled
* registered
* fatal_error
* error
* done

Show:

* reused tools
* newly generated tools
* reused agents
* generated agents
* equipped tools
* DAG preview
* compilation state
* registration state

Final state:

```text
Workflow ready

[Open Workflow]
[Execute Now]
```

Planning history should appear in a side panel.

---

# 20. WORKFLOW BUILDER

This is a flagship interface.

Use a three-column IDE layout:

```text
┌────────────┬───────────────────────────────┬───────────────┐
│ Palette    │ Canvas                        │ Inspector     │
│            │                               │               │
│ Agents     │       React Flow              │ Workflow      │
│ Tools      │                               │ Step          │
│ Connectors │                               │ Configuration │
│ Logic      │                               │               │
└────────────┴───────────────────────────────┴───────────────┘
```

Tabs:

* Canvas
* Definition
* Script

Palette:

* Agents
* Tools
* Connectors
* Logic

Logic:

* Condition
* Transform

Canvas:

* drag/drop
* connect nodes
* dagre layout
* zoom
* minimap
* fit view
* horizontal/vertical layout
* node selection
* validation overlays

Node visual language:

### Agent

Purple / Cpu

### Tool

Blue / Wrench

### Connector

Cyan / Plug

### Condition

Amber / GitBranch

### Transform

Emerald / Code

Nodes must look premium and compact.

Each node should show:

* icon
* name
* type
* status
* errors/warnings
* entry state

Edges should be elegant and readable.

Avoid oversized cards inside the canvas.

Inspector should dynamically adapt to selected node.

---

# 21. WORKFLOW VISUALIZER

`/workflows/:workflowName`

Full-bleed graph workspace.

Right inspector.

Controls:

* Fit View
* Horizontal layout
* Vertical layout
* Zoom
* Minimap
* Open Builder

Selecting a node should illuminate:

* selected node
* incoming edges
* outgoing edges
* related nodes

Inspector sections:

* Node Specification
* Agent Parameters
* Query / Instruction Prompt
* Compute Tier & Engine
* Execution Arguments Schema
* Attribute Variable Mappings
* Conditional Formula Expression
* Router Outcomes
* Connections Directory
* Incoming Inputs
* Outgoing Outputs
* Parallel group

---

# 22. EXECUTION MONITOR

This should look like an AI observability console.

Header:

* workflow
* execution ID
* runtime
* status
* live state
* elapsed duration

Tabs:

```text
Steps
Result
Logs
Events
Trace
History
Control
```

## Steps

Create a sophisticated vertical execution timeline.

Each step:

* step name
* step type
* status
* duration
* input preview
* output preview
* parallel grouping

Active nodes should pulse.

Completed nodes should settle visually.

Failed nodes should clearly surface errors.

## Result

Markdown/JSON-aware result viewer.

## Logs

Terminal-style log viewer.

Features:

* filtering
* copy
* download
* level indicators

## Events

Event stream.

## Trace

Create a span waterfall.

This should visually resemble professional distributed tracing systems.

## History

Raw execution history.

## Control

Controls for:

* Signal
* Query
* Update
* Cancel
* Terminate
* Reset

Destructive controls must require confirmation.

---

# 23. EXECUTIONS DASHBOARD

Create a dense but highly readable observability table.

Columns:

* Execution
* Workflow
* Status
* Started
* Duration
* Runtime

Filters:

* Search
* Status
* Workflow
* Page size

Selection:

* checkbox
* Cancel selected
* Terminate selected

Statuses must always use the same semantic identity:

```text
PENDING
RUNNING
RETRYING_AFTER_ERROR
COMPLETED
FAILED
CANCELLED
TERMINATED
TIMED_OUT
CONTINUED_AS_NEW
```

Use consistent visual states across the entire application.

---

# 24. ONTOLOGY

This is a major knowledge-management interface.

Route:

`/ontology`

Tabs:

* Overview
* Vocabulary
* Annotations
* Knowledge
* Scope preview
* Graph RAG

Do not make this look like a generic CRUD admin page.

It should feel like a **knowledge operating system**.

---

# 25. ONTOLOGY OVERVIEW GRAPH

Create a sophisticated knowledge graph workspace.

Top controls:

* Everything
* Taxonomy
* Resources
* Search
* Expand
* Collapse

Use React Flow.

Support:

* progressive disclosure
* node expansion
* selection
* filtering
* search
* fit view
* zoom
* minimap
* layout controls
* inspector

Concept nodes should surface:

* concept label
* hierarchy level
* rollup
* resource count
* subject counts

Edges must respect the backend's `reveal` semantics.

---

# 26. KNOWLEDGE GRAPH VISUAL DESIGN — VERY IMPORTANT

The Graph RAG knowledge graph is one of the most important visual elements of the entire product.

DO NOT render it as a generic React Flow demo.

It must look like a professional enterprise knowledge graph.

For large graphs:

* avoid giant unreadable node clusters
* use progressive disclosure
* cluster related entities
* use zoom-dependent information density
* use labels only when readable
* fade low-priority edges
* support node focus
* support neighborhood expansion
* highlight selected node's 1-hop and 2-hop neighborhood
* provide graph statistics
* provide a legend
* provide filtering
* provide search
* provide scope selection

Graph controls:

```text
Fit
Zoom +
Zoom -
Reset
Layout
Minimap
Fullscreen
Focus selection
Expand neighborhood
Collapse neighborhood
```

Use a floating glass control rail.

Large graph mode should support:

* node clustering
* progressive labels
* edge fading
* selection isolation
* search-to-focus
* neighborhood expansion
* confidence visualization
* degree visualization

Do not allow a large graph to become a wall of overlapping text.

---

# 27. GRAPH NODE DESIGN

Knowledge graph nodes should visually encode:

* entity type
* confidence
* degree
* relationship density

Node anatomy:

```text
┌──────────────────────────┐
│ ● ENTITY TYPE            │
│                          │
│ Entity Name              │
│ short description        │
│                          │
│ 24 relations · 94%       │
└──────────────────────────┘
```

But when zoomed out, simplify to:

```text
● Entity Name
```

At very high zoom:

```text
Entity Name
Type
Description
Degree
Confidence
```

Use progressive disclosure.

Selected node:

* stronger border
* subtle halo
* related edges illuminated
* unrelated graph elements reduced in opacity

---

# 28. KNOWLEDGE GRAPH EDGES

Edges must show:

* predicate
* confidence
* evidence availability

Avoid permanently displaying every edge label.

Show edge labels:

* when zoom permits
* on hover
* when selected
* for the focused neighborhood

On edge hover:

Show a glass tooltip:

```text
RELATION
source → target

Predicate
Evidence
Document
Confidence
```

---

# 29. GRAPH RAG — LIBRARIES

Graph RAG contains:

* Libraries
* Graph
* Test retrieval
* Timeline

Library cards should show:

* document count
* tracked documents
* graphed documents
* pending documents
* failed documents
* entities
* relations
* extraction rules status

Document status should be visually distinct:

```text
uploaded
indexing
extracted
extracting
proposed
graphed
unsupported
failed
```

---

# 30. GRAPH RAG — HUMAN REVIEW

The draft-review workflow is critical.

Before committing entities to Neo4j, provide a professional review workspace.

Split:

```text
Entities
Relations
Evidence
```

Entity table:

* Name
* Type
* Description
* Aliases
* Confidence
* Mentions

Relation table:

```text
Source → Predicate → Target
Evidence
Confidence
```

Deleting an entity must visually communicate:

> This will also remove every relation connected to this entity.

Commit should feel like a controlled approval action.

After commit show:

* entities committed
* relations committed
* orphan nodes removed
* trace ID

---

# 31. GRAPH RAG — TEST RETRIEVAL

Create a premium retrieval-debugging console.

Header:

> Ask the graph

Input:

```text
Which suppliers is Contoso bound to?
```

Controls:

* library
* hops
* limit
* optimize

Results should be visually separated:

### Query Plan

Show:

* original query
* rewritten query
* subqueries
* entity hints
* intent
* backend
* cached

### Matched Entities

### Retrieved Relations

Show:

* hop count
* predicate
* evidence

### Passages

Show:

* filename
* chunk index
* verbatim quote

### Rendered

Show the exact rendered block that is handed to the model.

This should look like a professional retrieval debugger.

---

# 32. GRAPH RAG — QUERY OPTIMIZER

Optimizer panel:

* agent ID
* name
* model
* backend
* toolkit availability
* protected state
* cached queries

Actions:

* Ensure
* Reset
* Preview

Preview should display the QueryPlan before executing the query.

---

# 33. GRAPH RAG — TIMELINE

Create a trace/timeline interface.

Each processing trace contains a tree.

Show:

```text
Ingestion
 ├── Document parsing
 ├── Chunking
 ├── Entity extraction
 ├── Relation extraction
 ├── Draft creation
 ├── Human review
 └── Neo4j commit
```

Each node:

* stage
* status
* duration
* message
* metadata

Statuses:

```text
running
ok
failed
skipped
```

Support live-follow using the RAG timeline SSE stream.

---

# 34. ONTOLOGY VOCABULARY

Create a knowledge-management interface with:

* schemes
* concepts
* hierarchy
* synonyms
* definitions
* levels

Concept hierarchy should be visually understandable.

Use tree navigation on the left and detail inspector on the right.

Before deleting a concept:

show cascade preview:

* child concepts
* annotation count
* affected subjects

Require explicit cascade confirmation.

---

# 35. ONTOLOGY ANNOTATIONS

Create a resource classification interface.

Subject types:

* agent
* tool
* connector
* workflow
* library

Predicates:

* has_tier
* serves_domain
* handles_data_class
* requires_capability
* provides_capability
* egresses_to

Use grouped predicate sections.

Auto-classify should display the returned reasoning in a visually prominent but controlled explanation panel.

Do not fabricate reasoning.

Only display backend-provided reasoning.

---

# 36. ONTOLOGY KNOWLEDGE

Create an industry knowledge management interface.

Features:

* search
* domain filtering
* knowledge creation
* knowledge deletion
* attach knowledge tool

Knowledge cards should show:

* title
* concept
* kind
* tags
* last-known-good date
* content preview

Search should display:

1. structured hits
2. rendered retrieval block

---

# 37. SCOPE PREVIEW

Input:

> Describe a workflow goal…

Show:

* matched domains
* scores
* label
* matched concepts
* scoped graph

The graph should visually highlight the subset selected by the planner.

Disable submission below the backend-required minimum input length.

---

# 38. CONNECTORS

Create a clean integration registry.

Cards:

* connector name
* service
* status
* credentials
* tools
* activation

Detail page should provide:

* overview
* tools
* credentials
* connection state
* actions

---

# 39. MCP SERVERS

Create an MCP infrastructure dashboard.

Tabs as required by backend.

Show:

* server
* status
* tools
* health
* proxy state
* actions

Make it feel like infrastructure management, not a generic settings page.

---

# 40. LIBRARIES

Create a document-library management interface.

Show:

* library name
* document count
* status
* graph coverage
* processing state

Documents should be inspectable.

Integrate naturally with Graph RAG.

---

# 41. CONVERSATIONS

Conversation Manager:

* conversation list
* search
* expandable history
* user messages
* assistant messages
* tool entries
* delete

Make the history viewer resemble an AI debugging console.

---

# 42. HEALTH DASHBOARD

Create a system health overview.

Monitor:

* backend
* tool service
* Neo4j
* Mistral
* worker
* remote execution availability

Use:

```text
Healthy
Degraded
Unavailable
```

If Neo4j is unavailable, the Graph RAG experience must degrade gracefully rather than breaking the application.

If tool-service is unavailable, show a warning on Tools but keep the rest of the application usable.

A pending workflow worker is not an error.

---

# 43. GLOBAL GRAPH DESIGN SYSTEM

There are four graph/canvas experiences:

1. Workflow Builder
2. Workflow Visualizer
3. Ontology Graph
4. Graph RAG

They must share:

### Graph toolbar

* Fit View
* Zoom In
* Zoom Out
* Minimap
* Layout
* Fullscreen

### Selection model

Selected node:

* stronger border
* subtle glow
* inspector opens
* neighbors highlighted

### Inspector

Always use the same right-side inspector pattern.

### Empty graph

Show:

* meaningful icon
* explanation
* primary action

### Offline graph

Show:

```text
Knowledge graph unavailable

Neo4j is currently unavailable.

Reason:
<backend reason>

[Retry]
```

Never show a blank graph.

The backend specifically requires Graph RAG to display an inline offline state when Neo4j is unavailable.

---

# 44. GRAPH PERFORMANCE

Large graphs are expected.

Design for potentially hundreds/thousands of nodes.

Use:

* progressive rendering
* clustering
* viewport-aware labels
* lazy expansion
* memoized nodes
* memoized edges
* minimized React re-renders
* debounced search
* progressive disclosure
* graph scoping
* neighborhood expansion

Never render thousands of permanent text labels.

Do not use expensive animated effects on every node.

Animations should be reserved for:

* selection
* active execution
* graph expansion
* live updates

---

# 45. MOTION SYSTEM

Use Framer Motion.

Motion should communicate state, not decoration.

Use:

* sidebar spring
* route transitions
* modal transitions
* panel expansion
* graph inspector transitions
* workflow execution transitions
* streaming indicators

Avoid:

* constant floating animations
* excessive glowing
* bouncing cards
* unnecessary particle effects

Respect:

```text
prefers-reduced-motion
```

---

# 46. LOADING STATES

Never show a blank screen.

Use skeletons matching the final layout.

Examples:

Agent grid:

```text
[████████] [████████] [████████]
[████████] [████████] [████████]
```

Workflow list:

Use row skeletons.

Graph:

Show:

```text
Loading graph
Fetching entities
Preparing relationships
```

Long-running operations should show actual phase descriptions rather than a generic spinner.

The backend specification explicitly requires skeletons for stable route chrome and phase-aware progress for long-running actions.

---

# 47. EMPTY STATES

Every list must have a designed empty state.

Structure:

```text
[Icon]

Nothing here yet

Short explanation

[Primary action]
```

Examples:

```text
No agents found
Create your first agent

No workflows yet
Create with AI Planner
Build visually

No executions match this view
Adjust your filters

No graph data
Upload a document to build your knowledge graph
```

Do not use blank white/grey areas.

---

# 48. ERROR STATES

Errors should never silently become empty states.

Use inline error cards containing:

* error icon
* human-readable message
* optional technical details
* Retry

For severe errors:

show a larger incident-style panel.

Preserve backend error messages.

---

# 49. TOASTS

Use toasts only for transient feedback.

Examples:

* Saved successfully
* Workflow published
* Agent created
* Tool approved
* Document committed
* Copied to clipboard

Do not use toasts as the only indication of important errors.

---

# 50. TABLE DESIGN

Replace dense legacy tables with premium data tables.

Features:

* sticky headers
* subtle row separators
* hover state
* aligned columns
* status badges
* compact density
* comfortable density
* column-aware spacing
* row actions
* keyboard navigation

Tables should feel like infrastructure consoles.

---

# 51. RESPONSIVENESS

Desktop is the primary target.

At medium width:

* collapse sidebar
* preserve workspace

At mobile:

* sidebar becomes drawer
* builder becomes read-only graph + inspector
* graphs remain usable
* inspector becomes bottom sheet/drawer
* tables become horizontally scrollable or card-based

Never allow graph/workflow pages to break.

---

# 52. ACCESSIBILITY

Everything must be keyboard reachable.

Use:

* proper focus states
* ARIA labels
* semantic buttons
* keyboard navigation
* accessible dialogs
* accessible tabs
* aria-live for streaming status

For graph canvases, provide a non-canvas fallback listing nodes so screen readers can access graph information.

---

# 53. STATE MANAGEMENT

Use TanStack Query for server state.

Use Zustand only for local/persistent client state.

Do not put API data into Zustand unnecessarily.

Preserve:

```text
mistral-chat-sessions
agent_planner_history
auth_token
```

Everything else should remain server state.

Use the query key factory defined by the backend specification.

Respect invalidation after mutations.

---

# 54. SSE / STREAMING

Implement streaming correctly.

Streams:

```text
POST /api/orchestrate/stream
POST /api/chat/stream
POST /api/workflows/plan
GET  /api/workflows/executions/{id}/stream
GET  /api/rag/timeline/{trace_id}/stream
```

POST streams cannot use EventSource.

Use fetch streaming.

GET streams may use EventSource or fetch streaming.

Events must be handled exactly.

Do not JSON.parse plain string events:

* status
* text_chunk
* conversation_id
* error

`done` closes the stream.

Execution stream retries only while non-terminal.

RAG timeline must deduplicate stage updates correctly.

The specification defines all five streams and their exact event catalog.

---

# 55. DO NOT EXPOSE PRIVATE MODEL CHAIN-OF-THOUGHT

When displaying AI activity:

show only:

* backend-provided statuses
* tool execution states
* workflow phases
* retrieved data
* model outputs
* traces
* events

Do not invent or display hidden chain-of-thought.

Use labels such as:

```text
Analysing request
Selecting tools
Building workflow
Executing step
Processing result
```

when these are supplied by the backend event stream.

---

# 56. COMPONENT ARCHITECTURE

Build reusable components.

Recommended structure:

```text
src/
  components/
    ui/
    layout/
    glass/
    navigation/
    chat/
    agents/
    tools/
    workflows/
    executions/
    ontology/
    graph/
    rag/
    inspectors/
    tables/
    status/
    empty-states/
    errors/

  hooks/
    useSSE/
    useOrchestrator/
    useWorkflowStream/
    useRagTimeline/
    useGraph/
    useExecutionStream/

  pages/
    orchestrator/
    playground/
    agents/
    tools/
    workflows/
    executions/
    conversations/
    ontology/
    connectors/
    mcp/
    libraries/
    health/

  api/
    client.ts
    agents.ts
    tools.ts
    workflows.ts
    executions.ts
    ontology.ts
    rag.ts
    connectors.ts
    mcp.ts
    libraries.ts

  stores/
    sessions.ts
    plannerHistory.ts

  graph/
    nodes/
    edges/
    layouts/
    controls/

  types/
```

Do not build every page as one giant component.

---

# 57. ROUTES

Implement all routes defined by the backend specification.

Important:

```text
/
 /playground
 /agents
 /agents/:id
 /tools
 /workflows
 /workflows/new
 /workflows/new/ai
 /workflows/new/visual
 /workflows/archived
 /workflows/executions
 /executions
 /workflows/:workflowName
 /workflows/:workflowName/edit
 /workflows/:workflowName/execute
 /conversations
 /ontology
 /connectors
 /connectors/:id
 /mcp
 /mcp/:serverName
 /remote-servers/:id
 /libraries
 /health
 *
```

Register:

```text
/workflows/executions
```

BEFORE:

```text
/workflows/:workflowName
```

so `executions` is not interpreted as a workflow name.

Support:

```text
?execId=<id>
```

deep links.

---

# 58. DATA INTEGRITY

Do not invent missing data.

If the backend returns:

```text
available: false
```

represent the unavailable state.

If a list returns zero items:

represent an empty state.

If an API returns an error:

represent an error.

If data is loading:

represent loading.

Never manufacture fake entities to make screens look populated.

For visual polish during development, mock data may be used only in isolated design previews and must be clearly separated from production API state.

---

# 59. SEMANTIC STATUS SYSTEM

Create one centralized status mapping.

Execution statuses:

```text
PENDING → muted
RUNNING → blue + pulse
RETRYING_AFTER_ERROR → amber + pulse
COMPLETED → emerald
FAILED → red
CANCELLED → slate
TERMINATED → orange
TIMED_OUT → orange
CONTINUED_AS_NEW → purple
```

Step types:

```text
agent → purple
tool → blue
connector → cyan
condition → amber
transform → emerald
```

Tool source:

```text
builtin
native
dynamic
```

These identities must remain consistent throughout the entire application.

---

# 60. COMMAND PALETTE

Add a global command/search experience.

Possible actions:

* Go to Agents
* Go to Workflows
* Create Agent
* Create Workflow
* Open Executions
* Search Agents
* Search Workflows
* Search Conversations
* Open Ontology
* Open Graph RAG

Do not make this replace the primary sidebar.

---

# 61. DETAILS THAT MAKE IT FEEL PREMIUM

Add subtle:

* ambient background gradients
* contextual glow
* glass layers
* thin borders
* micro-interactions
* hover states
* intelligent spacing
* animated state transitions
* skeleton loaders
* command palette
* contextual inspectors
* rich tooltips
* keyboard shortcuts where appropriate

Do NOT add:

* meaningless particles
* giant neon text
* fake AI brain animations
* excessive gradients
* excessive rounded rectangles
* distracting 3D effects

---

# 62. DESIGN PHILOSOPHY

Every screen should answer:

1. What am I looking at?
2. What is the current state?
3. What can I do?
4. What changed?
5. What needs my attention?

The user should never have to visually decode the application.

Use progressive disclosure.

Keep primary actions obvious.

Keep technical details available but secondary.

---

# 63. GRAPH-FIRST DESIGN PRINCIPLE

The application contains important graph data.

Graphs are not decorative.

They represent:

* workflow execution
* ontology relationships
* knowledge graph entities
* RAG relationships

Therefore graphs must be treated as **first-class application surfaces**.

Every graph must support:

* zoom
* pan
* fit
* minimap
* selection
* filtering
* search
* layout
* inspector
* readable large-scale visualization
* responsive fallback

---

# 64. FINAL VISUAL TARGET

The final product should visually communicate:

```text
                 AGENTIC AI
                      │
       ┌──────────────┼──────────────┐
       │              │              │
    AGENTS        WORKFLOWS        TOOLS
       │              │              │
       └──────────────┼──────────────┘
                      │
                  EXECUTIONS
                      │
          ┌───────────┴───────────┐
          │                       │
       ONTOLOGY                GRAPH RAG
          │                       │
          └───────────┬───────────┘
                      │
                KNOWLEDGE SYSTEM
```

The UI should feel like the operating system for this entire agent ecosystem.

---

# 65. IMPLEMENTATION PRIORITY

Build in this order:

### Phase 1

Application shell + design system + routing

### Phase 2

Orchestrator + Playground + Agents

### Phase 3

Tools + Connectors + MCP

### Phase 4

Workflow Dashboard + Planner + Builder

### Phase 5

Execution Monitor + Execution Dashboard

### Phase 6

Ontology

### Phase 7

Graph RAG + Neo4j

### Phase 8

Health + Conversations + Libraries

### Phase 9

Polish

* animations
* skeletons
* empty states
* error states
* responsive behavior
* accessibility
* performance
* graph optimization

---

# 66. DEFINITION OF DONE

The project is complete only when:

* all routes work
* all backend endpoints are wired
* all SSE streams work
* all request payloads match the specification
* all response states are handled
* loading states exist
* empty states exist
* error states exist
* long-running actions show meaningful progress
* protected agents cannot be deleted
* builtin/native tools cannot be edited/deleted
* Save and Publish workflows remain separate
* workflow node positions persist through `ui_layout`
* ontology tiers come from the backend
* concept deletion has cascade preview
* RAG draft review happens before commit
* deleting an entity handles its relations
* Graph RAG offline state works
* Graph RAG retrieval debugging works
* graph controls are consistent
* large graphs remain readable
* execution streaming reconnects correctly
* mobile layout remains usable
* reduced motion is respected
* no login screen is introduced
* no backend modification is required

The original acceptance checklist specifically requires correct proxying, long Axios timeouts, all five streaming surfaces, all 25 routes, correct mutation behavior, graph degradation, and consistent graph/status design.

---

# 67. MOST IMPORTANT INSTRUCTION TO LOVABLE

Do not optimize for “looks good in a screenshot.”

Optimize for:

**production usability + backend compatibility + information hierarchy + graph usability + observability + agent-centric workflows.**

The visual design should be significantly better than the existing application, but functionality must remain equivalent.

Think:

> “Premium AI infrastructure control plane.”

Not:

> “Generic dark SaaS dashboard.”

Build the UI as if it will be used every day by AI engineers, platform engineers, ML engineers and technical product teams to build and debug real agent systems.

The final result should be polished enough to look like a mature commercial AI platform.

This project was built with [Lovable](https://lovable.dev).

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/9346c2f7-4b4c-44fa-a134-672160900a2b).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
