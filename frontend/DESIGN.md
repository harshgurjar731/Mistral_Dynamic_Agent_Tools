# Mistral Dynamic Agent - Frontend Design Document

This document outlines the architecture, technology stack, directory structure, and design principles of the Mistral Dynamic Agent frontend application.

## 🚀 Overview

The frontend is a modern, responsive Single Page Application (SPA) built to serve as the "Command Center" for the Mistral Dynamic Agent ecosystem. It provides users with an intuitive, dynamic interface to manage AI agents, synthesize dynamic tools, orchestrate multi-agent workflows, and interact with the orchestration engine. 

The application is built with a mobile-first, highly responsive approach, featuring a premium dark-mode aesthetic with smooth micro-animations.

---

## 🛠️ Technology Stack

- **Core Framework:** React 18+ powered by Vite (for rapid development and optimized builds).
- **Language:** TypeScript (for type safety and self-documenting code).
- **Styling & Layout:** Tailwind CSS (v4) utilizing a custom token-based design system (`tokens.css`).
- **Animations:** Framer Motion (for layout transitions, spring animations, and modal popups).
- **Routing:** React Router DOM (v6).
- **State Management:**
  - **Server State:** TanStack React Query (for caching, background refetching, and API synchronization).
  - **Client State:** Zustand (for persistent local session storage, primarily used in chat sessions).
- **Diagrams / DAGs:** React Flow (for visualizing Workflow DAGs).
- **Icons:** Lucide React.
- **Markdown Rendering:** `react-markdown` and `react-syntax-highlighter` (for parsing LLM outputs and rendering code blocks).

---

## 📁 Directory Structure

The project follows a **Feature-Sliced Design (FSD)** inspired structure, grouping code by domain rather than file type to improve maintainability.

```text
frontend/
├── src/
│   ├── api/                  # Axios API clients for backend communication
│   │   ├── agents.ts
│   │   ├── chat.ts
│   │   ├── health.ts
│   │   ├── mcp.ts
│   │   ├── orchestrator.ts
│   │   ├── tools.ts
│   │   └── workflows.ts
│   ├── components/           # Shared & Global UI components
│   │   ├── layout/
│   │   │   ├── AppShell.tsx  # Main application wrapper with responsive routing container
│   │   │   └── Sidebar.tsx   # Mobile-responsive collapsible navigation drawer
│   │   └── ui/               # Reusable UI primitives (Buttons, Modals, etc.)
│   ├── features/             # Domain-specific modules
│   │   ├── agents/           # Agent Studio and Agent details
│   │   ├── chat/             # Playground and Orchestrator chat interfaces
│   │   ├── conversations/    # Chat history management
│   │   ├── health/           # System health monitoring dashboard
│   │   ├── mcp/              # Model Context Protocol registry
│   │   ├── tools/            # Tool synthesis and lifecycle management
│   │   └── workflows/        # Multi-agent Workflow DAG planner, visualizer, and dashboard
│   ├── lib/                  # Utilities and constants
│   │   ├── queryClient.ts    # React Query configuration and Query Key (QK) constants
│   │   └── utils.ts          # Tailwind class merging (`cn` utility)
│   ├── store/                # Client-side global state
│   │   └── sessionStore.ts   # Zustand persistent store for chat sessions
│   ├── styles/               # CSS and theme tokens
│   │   └── tokens.css        # Core color palette and CSS variables
│   ├── App.tsx               # Root component and Router configuration
│   ├── index.css             # Tailwind imports and global styles (scrollbars, base styles)
│   └── main.tsx              # React DOM mounting and QueryClientProvider setup
```

---

## 🎨 Design System & UX Principles

The UI is built to look highly premium and dynamic, adhering to the following design guidelines:

### 1. Theming & Colors
- **Dark Mode Native:** The application utilizes a deep, vibrant dark mode driven by CSS variables (`var(--color-bg-base)`, `var(--color-bg-surface)`).
- **Subtle Gradients & Glassmorphism:** Cards and interactive elements use subtle translucency and gradient borders to create depth.
- **Accents:** Distinct accent colors for states: Success (Green), Warning (Amber), Danger (Red), and primary brand accents.

### 2. Standardized UI Patterns
- **Empty States:** A unified component format is used across all dashboards when no data is present. It features a centered layout with a large circular icon, clear title, descriptive subtitle, and a primary Call-to-Action (CTA) button.
- **Skeleton Loaders:** To prevent layout shifts during API calls, high-fidelity skeleton loaders perfectly mimic the structural layout of the loaded cards.
- **Custom Scrollbars:** Slim, unobtrusive dark-themed scrollbars are implemented globally to enhance the sleek feel.

### 3. Responsiveness
- **Mobile First:** The application ensures usability on small devices.
- **Collapsible Drawer:** The Sidebar converts into an overlay drawer on mobile screens (≤ 768px), triggered by a hamburger menu in the `AppShell` header.
- **Information Density:** Flexible CSS grid layouts, `flex-wrap` utility classes, and intelligent `line-clamp` boundaries ensure text truncation is graceful and data remains readable across all viewports.

---

## 🧭 Routing Architecture

The routing is handled by `React Router DOM` inside `App.tsx` and wrapped within the `AppShell` component. Lazy loading (`React.lazy`) is used for all major feature components to split the JS bundle and improve initial load times.

**Core Routes:**
- `/` - **Orchestrator Chat**: The dynamic interface for generating agents from natural language prompts.
- `/chat` - **Playground**: Standard chat interface for direct Mistral model communication.
- `/agents` - **Agent Studio**: Manage and create specialized AI agents.
- `/agents/:id` - **Agent Detail**: Chat interface tailored to a specific agent's context.
- `/tools` - **Tool Lifecycle**: Synthesize, review, and manage code-based dynamic tools.
- `/workflows` - **Workflows Dashboard**: Manage dynamic multi-agent pipelines.
- `/workflows/new` - **Workflow Planner**: Create new DAG workflows.
- `/workflows/archived` - **Archived Workflows**: View previously archived pipelines.
- `/workflows/:workflowName` - **Workflow Visualizer**: Interactive React Flow diagram for DAG execution.
- `/conversations` - **Conversations**: Manage historical threads.
- `/mcp` - **MCP Servers**: Register and ping external MCP integrations.
- `/health` - **System Health**: View live status of backend and tool-service microservices.
- `*` - **404 Not Found**: Standardized fallback page.

---

## 🧠 State Management Strategy

### Server State (TanStack Query)
- **Data Fetching:** All backend data (Agents, Tools, Workflows, MCPs) is fetched using `useQuery`.
- **Mutations:** Actions like creating agents, deleting workflows, or synthesizing tools use `useMutation`.
- **Invalidation:** Query Keys (defined in `lib/queryClient.ts`) are used to instantly invalidate and refetch data upon successful mutations, ensuring the UI remains perfectly synced with the backend without requiring manual page reloads.

### Client State (Zustand)
- **Session Store (`sessionStore.ts`):** Manages all chat sessions locally. It handles appending message chunks during streaming, creating new chat sessions, switching between agent/general contexts, and uses Zustand's `persist` middleware to save conversations across browser refreshes.
