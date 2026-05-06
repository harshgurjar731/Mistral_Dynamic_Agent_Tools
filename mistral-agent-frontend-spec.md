# Mistral Dynamic Agent — Production React Frontend Specification

> **Audience**: Senior frontend engineers and tech leads  
> **Stack**: React 18 + TypeScript + Vite + TailwindCSS + Framer Motion + React Query  
> **API coverage**: All 16 features derived from Backend Orchestrator (port 8000) + Docker Tool Service (port 9000)  
> **Design philosophy**: Refined dark-first command-centre aesthetic — dense information, surgical precision, zero chrome clutter

---

## Table of Contents

1. [Design System](#1-design-system)
2. [Project Architecture](#2-project-architecture)
3. [API Client Layer](#3-api-client-layer)
4. [State Management](#4-state-management)
5. [Application Shell & Navigation](#5-application-shell--navigation)
6. [Feature Modules](#6-feature-modules)
   - 6.1 [Agent Studio](#61-agent-studio)
   - 6.2 [Orchestrator Chat](#62-orchestrator-chat)
   - 6.3 [Tool Lifecycle Manager](#63-tool-lifecycle-manager)
   - 6.4 [Workflow Builder & Executor](#64-workflow-builder--executor)
   - 6.5 [Conversation Thread Manager](#65-conversation-thread-manager)
   - 6.6 [MCP Server Registry](#66-mcp-server-registry)
   - 6.7 [System Health Monitor](#67-system-health-monitor)
7. [Shared Components](#7-shared-components)
8. [Real-Time & Streaming](#8-real-time--streaming)
9. [Accessibility](#9-accessibility)
10. [Performance](#10-performance)
11. [Testing Strategy](#11-testing-strategy)
12. [Deployment](#12-deployment)

---

## 1. Design System

### 1.1 Visual Direction

The interface is a **dark-first command centre** inspired by aerospace ground control and professional code editors. Think: deep charcoal backgrounds, precise monospaced data, electric accent punctuation, and an absolute minimum of decorative chrome. Every pixel earns its place.

**Typography stack**:
```css
--font-display:  'Syne', sans-serif;         /* Headers, agent names, big numbers */
--font-body:     'DM Sans', sans-serif;       /* Body copy, labels, descriptions */
--font-mono:     'JetBrains Mono', monospace; /* Code, API paths, hashes, JSON */
```

Import via Google Fonts in `index.html`:
```html
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Syne:wght@500;600;700&family=DM+Sans:wght@400;500&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
```

### 1.2 Color Tokens

All tokens live in `src/styles/tokens.css` and are consumed as CSS custom properties throughout. Tailwind's config extends from these same values.

```css
:root {
  /* --- Backgrounds --- */
  --bg-base:        #0d0f10;   /* Page root */
  --bg-raised:      #141618;   /* Cards, panels */
  --bg-overlay:     #1c1f22;   /* Modals, dropdowns */
  --bg-subtle:      #20242a;   /* Input fills, table rows */
  --bg-hover:       #252a30;   /* Hover states */

  /* --- Borders --- */
  --border-faint:   rgba(255,255,255,0.06);
  --border-default: rgba(255,255,255,0.10);
  --border-strong:  rgba(255,255,255,0.18);
  --border-focus:   rgba(99,179,237,0.55);   /* Electric blue focus ring */

  /* --- Text --- */
  --text-primary:   #eef0f2;
  --text-secondary: #9ba3ae;
  --text-muted:     #5a636e;
  --text-inverse:   #0d0f10;

  /* --- Accent palette (one primary, precise semantics) --- */
  --accent-electric: #4EB8FF;   /* Primary interactive: buttons, links, selection */
  --accent-glow:     rgba(78,184,255,0.15); /* Glow halos on focus */
  --accent-success:  #34C77B;
  --accent-warning:  #F5A623;
  --accent-danger:   #F25C5C;
  --accent-purple:   #A78BFA;   /* MCP / external integrations */
  --accent-amber:    #FBBF24;   /* Pending / awaiting states */

  /* --- Semantic surfaces --- */
  --surface-success: rgba(52,199,123,0.08);
  --surface-warning: rgba(245,166,35,0.08);
  --surface-danger:  rgba(242,92,92,0.08);
  --surface-info:    rgba(78,184,255,0.08);
  --surface-purple:  rgba(167,139,250,0.08);
}
```

### 1.3 Tailwind Configuration

`tailwind.config.ts`:
```typescript
import type { Config } from 'tailwindcss';

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: {
          base:    'var(--bg-base)',
          raised:  'var(--bg-raised)',
          overlay: 'var(--bg-overlay)',
          subtle:  'var(--bg-subtle)',
          hover:   'var(--bg-hover)',
        },
        border: {
          faint:   'var(--border-faint)',
          default: 'var(--border-default)',
          strong:  'var(--border-strong)',
          focus:   'var(--border-focus)',
        },
        text: {
          primary:   'var(--text-primary)',
          secondary: 'var(--text-secondary)',
          muted:     'var(--text-muted)',
        },
        accent: {
          electric: 'var(--accent-electric)',
          success:  'var(--accent-success)',
          warning:  'var(--accent-warning)',
          danger:   'var(--accent-danger)',
          purple:   'var(--accent-purple)',
          amber:    'var(--accent-amber)',
        },
      },
      fontFamily: {
        display: ['Syne', 'sans-serif'],
        body:    ['DM Sans', 'sans-serif'],
        mono:    ['JetBrains Mono', 'monospace'],
      },
      animation: {
        'fade-in':    'fadeIn 0.18s ease-out',
        'slide-up':   'slideUp 0.22s cubic-bezier(0.22,1,0.36,1)',
        'pulse-dot':  'pulseDot 2s ease-in-out infinite',
        'stream-in':  'streamIn 0.12s ease-out',
        'glow-ring':  'glowRing 2s ease-in-out infinite',
      },
      keyframes: {
        fadeIn:    { from: { opacity: '0' }, to: { opacity: '1' } },
        slideUp:   { from: { opacity: '0', transform: 'translateY(8px)' }, to: { opacity: '1', transform: 'translateY(0)' } },
        pulseDot:  { '0%,100%': { opacity: '1' }, '50%': { opacity: '0.3' } },
        streamIn:  { from: { opacity: '0' }, to: { opacity: '1' } },
        glowRing:  { '0%,100%': { boxShadow: '0 0 0 0 var(--accent-glow)' }, '50%': { boxShadow: '0 0 0 6px var(--accent-glow)' } },
      },
      borderRadius: {
        sm:  '4px',
        md:  '6px',
        lg:  '10px',
        xl:  '14px',
        '2xl': '20px',
      },
      boxShadow: {
        card:   '0 1px 3px rgba(0,0,0,0.4), 0 1px 2px rgba(0,0,0,0.3)',
        modal:  '0 20px 60px rgba(0,0,0,0.7)',
        glow:   '0 0 20px var(--accent-glow)',
        'inner-top': 'inset 0 1px 0 rgba(255,255,255,0.06)',
      },
    },
  },
  plugins: [],
} satisfies Config;
```

### 1.4 Motion Principles (Framer Motion)

```typescript
// src/lib/motion.ts
export const motionPresets = {
  fadeIn: {
    initial: { opacity: 0 },
    animate: { opacity: 1 },
    exit:    { opacity: 0 },
    transition: { duration: 0.15 },
  },
  slideUp: {
    initial: { opacity: 0, y: 10 },
    animate: { opacity: 1, y: 0 },
    exit:    { opacity: 0, y: 6 },
    transition: { duration: 0.2, ease: [0.22, 1, 0.36, 1] },
  },
  stagger: (delayChildren = 0.05) => ({
    animate: { transition: { staggerChildren: delayChildren } },
  }),
  scaleIn: {
    initial: { opacity: 0, scale: 0.96 },
    animate: { opacity: 1, scale: 1 },
    exit:    { opacity: 0, scale: 0.97 },
    transition: { duration: 0.18, ease: [0.22, 1, 0.36, 1] },
  },
};

// Globally respect reduced motion
export const shouldAnimate = () =>
  !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
```

---

## 2. Project Architecture

### 2.1 Directory Structure

```
mistral-agent-ui/
├── public/
│   └── favicon.svg
├── src/
│   ├── api/                      # All HTTP + SSE client logic
│   │   ├── client.ts             # Axios instance, interceptors
│   │   ├── agents.ts
│   │   ├── chat.ts
│   │   ├── conversations.ts
│   │   ├── orchestrator.ts
│   │   ├── workflows.ts
│   │   ├── tools.ts              # Tools proxy (port 8000)
│   │   ├── docker/               # Docker Tool Service (port 9000)
│   │   │   ├── synthesis.ts
│   │   │   ├── execution.ts
│   │   │   ├── toolRegistry.ts
│   │   │   └── mcp.ts
│   │   └── health.ts
│   │
│   ├── components/               # Shared/atomic UI components
│   │   ├── ui/
│   │   │   ├── Badge.tsx
│   │   │   ├── Button.tsx
│   │   │   ├── Card.tsx
│   │   │   ├── CodeBlock.tsx
│   │   │   ├── ConfirmDialog.tsx
│   │   │   ├── DataTable.tsx
│   │   │   ├── Divider.tsx
│   │   │   ├── EmptyState.tsx
│   │   │   ├── Input.tsx
│   │   │   ├── JsonViewer.tsx
│   │   │   ├── Modal.tsx
│   │   │   ├── Select.tsx
│   │   │   ├── Skeleton.tsx
│   │   │   ├── Spinner.tsx
│   │   │   ├── StatusDot.tsx
│   │   │   ├── Textarea.tsx
│   │   │   ├── Toast.tsx
│   │   │   ├── Tooltip.tsx
│   │   │   └── index.ts
│   │   ├── layout/
│   │   │   ├── AppShell.tsx
│   │   │   ├── Sidebar.tsx
│   │   │   ├── TopBar.tsx
│   │   │   ├── CommandPalette.tsx
│   │   │   └── PageHeader.tsx
│   │   └── domain/               # Cross-feature domain components
│   │       ├── AgentCard.tsx
│   │       ├── ToolCard.tsx
│   │       ├── WorkflowStatusBadge.tsx
│   │       └── McpServerCard.tsx
│   │
│   ├── features/                 # Feature-sliced modules
│   │   ├── agents/
│   │   │   ├── AgentStudio.tsx
│   │   │   ├── AgentList.tsx
│   │   │   ├── AgentEditor.tsx
│   │   │   ├── AgentDetail.tsx
│   │   │   ├── hooks/
│   │   │   │   ├── useAgents.ts
│   │   │   │   └── useAgentMutations.ts
│   │   │   └── index.ts
│   │   ├── chat/
│   │   │   ├── OrchestratorChat.tsx
│   │   │   ├── ChatThread.tsx
│   │   │   ├── MessageBubble.tsx
│   │   │   ├── ToolCallBlock.tsx
│   │   │   ├── StreamingCursor.tsx
│   │   │   ├── ChatInput.tsx
│   │   │   ├── AgentSelector.tsx
│   │   │   ├── ModeToggle.tsx    /* orchestrate vs. direct */
│   │   │   ├── hooks/
│   │   │   │   ├── useStreamingChat.ts
│   │   │   │   └── useOrchestratorStream.ts
│   │   │   └── index.ts
│   │   ├── tools/
│   │   │   ├── ToolLifecycle.tsx
│   │   │   ├── SynthesisPanel.tsx
│   │   │   ├── PendingApprovals.tsx
│   │   │   ├── ActiveRegistry.tsx
│   │   │   ├── ToolDetailDrawer.tsx
│   │   │   ├── DuplicateGuard.tsx
│   │   │   ├── hooks/
│   │   │   │   ├── useToolSynthesis.ts
│   │   │   │   ├── usePendingTools.ts
│   │   │   │   └── useToolRegistry.ts
│   │   │   └── index.ts
│   │   ├── workflows/
│   │   │   ├── WorkflowDashboard.tsx
│   │   │   ├── WorkflowBuilder.tsx
│   │   │   ├── DagCanvas.tsx
│   │   │   ├── DagNode.tsx
│   │   │   ├── DagEdge.tsx
│   │   │   ├── ExecutionPanel.tsx
│   │   │   ├── ExecutionHistory.tsx
│   │   │   ├── hooks/
│   │   │   │   ├── useWorkflows.ts
│   │   │   │   └── useWorkflowExecution.ts
│   │   │   └── index.ts
│   │   ├── conversations/
│   │   │   ├── ConversationManager.tsx
│   │   │   ├── ConversationList.tsx
│   │   │   ├── ConversationDetail.tsx
│   │   │   ├── HistoryTimeline.tsx
│   │   │   ├── hooks/
│   │   │   │   └── useConversations.ts
│   │   │   └── index.ts
│   │   ├── mcp/
│   │   │   ├── McpRegistry.tsx
│   │   │   ├── ServerList.tsx
│   │   │   ├── RegisterServerModal.tsx
│   │   │   ├── HealthCheckPanel.tsx
│   │   │   ├── hooks/
│   │   │   │   └── useMcpServers.ts
│   │   │   └── index.ts
│   │   └── health/
│   │       ├── HealthDashboard.tsx
│   │       ├── ServiceCard.tsx
│   │       ├── McpConnectivityMap.tsx
│   │       └── hooks/
│   │           └── useHealth.ts
│   │
│   ├── hooks/                    # App-wide hooks
│   │   ├── useCommandPalette.ts
│   │   ├── useToast.ts
│   │   ├── useLocalStorage.ts
│   │   └── useKeyboardShortcut.ts
│   │
│   ├── store/                    # Zustand global store slices
│   │   ├── uiStore.ts
│   │   ├── chatStore.ts
│   │   └── index.ts
│   │
│   ├── lib/
│   │   ├── motion.ts
│   │   ├── queryClient.ts
│   │   └── utils.ts
│   │
│   ├── styles/
│   │   ├── tokens.css
│   │   └── global.css
│   │
│   ├── types/
│   │   ├── agent.ts
│   │   ├── chat.ts
│   │   ├── conversation.ts
│   │   ├── tool.ts
│   │   ├── workflow.ts
│   │   └── mcp.ts
│   │
│   ├── App.tsx
│   ├── router.tsx
│   └── main.tsx
```

### 2.2 Dependencies

```json
{
  "dependencies": {
    "react": "^18.3.0",
    "react-dom": "^18.3.0",
    "react-router-dom": "^6.23.0",
    "@tanstack/react-query": "^5.36.0",
    "@tanstack/react-query-devtools": "^5.36.0",
    "zustand": "^4.5.2",
    "axios": "^1.7.2",
    "framer-motion": "^11.2.6",
    "react-hook-form": "^7.51.5",
    "zod": "^3.23.5",
    "@hookform/resolvers": "^3.4.2",
    "cmdk": "^1.0.0",
    "@radix-ui/react-dialog": "^1.0.5",
    "@radix-ui/react-dropdown-menu": "^2.0.6",
    "@radix-ui/react-select": "^2.0.0",
    "@radix-ui/react-tooltip": "^1.0.7",
    "@radix-ui/react-scroll-area": "^1.0.5",
    "@radix-ui/react-tabs": "^1.0.4",
    "@radix-ui/react-switch": "^1.0.3",
    "@radix-ui/react-slider": "^1.1.2",
    "lucide-react": "^0.383.0",
    "reactflow": "^11.11.3",
    "@codemirror/react": "^0.0.14",
    "@codemirror/lang-python": "^6.1.4",
    "@codemirror/lang-json": "^6.0.1",
    "react-virtuoso": "^4.7.9",
    "date-fns": "^3.6.0",
    "clsx": "^2.1.1",
    "tailwind-merge": "^2.3.0"
  },
  "devDependencies": {
    "typescript": "^5.4.5",
    "vite": "^5.2.11",
    "@vitejs/plugin-react": "^4.3.0",
    "tailwindcss": "^3.4.3",
    "autoprefixer": "^10.4.19",
    "postcss": "^8.4.38",
    "vitest": "^1.6.0",
    "@testing-library/react": "^16.0.0",
    "@testing-library/user-event": "^14.5.2",
    "msw": "^2.3.0",
    "eslint": "^9.3.0",
    "@typescript-eslint/eslint-plugin": "^7.10.0"
  }
}
```

---

## 3. API Client Layer

### 3.1 Axios Instances

Two separate Axios instances — one per microservice — with shared interceptor logic.

```typescript
// src/api/client.ts
import axios, { AxiosError, type InternalAxiosRequestConfig } from 'axios';
import { toastStore } from '../store';

const createClient = (baseURL: string) => {
  const instance = axios.create({
    baseURL,
    timeout: 30_000,
    headers: { 'Content-Type': 'application/json' },
  });

  instance.interceptors.request.use((config: InternalAxiosRequestConfig) => {
    // Attach auth token if present (future-proof)
    const token = localStorage.getItem('auth_token');
    if (token) config.headers.Authorization = `Bearer ${token}`;
    return config;
  });

  instance.interceptors.response.use(
    (res) => res,
    (err: AxiosError) => {
      const msg = (err.response?.data as any)?.detail ?? err.message;
      toastStore.getState().push({ type: 'error', message: msg });
      return Promise.reject(err);
    }
  );

  return instance;
};

export const orchestratorClient = createClient(
  import.meta.env.VITE_ORCHESTRATOR_URL ?? 'http://localhost:8000'
);

export const dockerClient = createClient(
  import.meta.env.VITE_DOCKER_TOOL_URL ?? 'http://localhost:9000'
);
```

### 3.2 SSE Streaming Utility

```typescript
// src/api/sse.ts
export interface SSEEvent {
  type: string;
  data: string;
}

export function createSSEStream(
  url: string,
  body: object,
  onEvent: (event: SSEEvent) => void,
  onDone?: () => void,
  signal?: AbortSignal
): () => void {
  const ctrl = new AbortController();
  const combinedSignal = signal ?? ctrl.signal;

  (async () => {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: combinedSignal,
    });

    const reader = res.body?.getReader();
    if (!reader) return;
    const decoder = new TextDecoder();

    let buffer = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) { onDone?.(); break; }
      buffer += decoder.decode(value, { stream: true });

      // Parse SSE lines
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      let eventType = 'message';
      for (const line of lines) {
        if (line.startsWith('event:')) eventType = line.slice(6).trim();
        if (line.startsWith('data:')) {
          onEvent({ type: eventType, data: line.slice(5).trim() });
          eventType = 'message';
        }
      }
    }
  })().catch((e) => {
    if (e.name !== 'AbortError') console.error('SSE error', e);
  });

  return () => ctrl.abort();
}
```

### 3.3 Domain API Modules

**Agents** (`src/api/agents.ts`):
```typescript
import { orchestratorClient as c } from './client';
import type { Agent, CreateAgentRequest, UpdateAgentRequest, PaginatedResponse } from '../types';

export const agentsApi = {
  list:   (page = 1, page_size = 20) =>
    c.get<PaginatedResponse<Agent>>('/api/agents', { params: { page, page_size } }),
  get:    (id: string)  => c.get<Agent>(`/api/agents/${id}`),
  create: (body: CreateAgentRequest) => c.post<Agent>('/api/agents', body),
  update: (id: string, body: UpdateAgentRequest) => c.patch<Agent>(`/api/agents/${id}`, body),
  delete: (id: string)  => c.delete(`/api/agents/${id}`),
};
```

**Orchestrator** (`src/api/orchestrator.ts`):
```typescript
import { orchestratorClient as c } from './client';
import { createSSEStream, type SSEEvent } from './sse';
import type { OrchestratorRequest, OrchestratorResponse } from '../types';

const BASE = import.meta.env.VITE_ORCHESTRATOR_URL ?? 'http://localhost:8000';

export const orchestratorApi = {
  run: (body: OrchestratorRequest) =>
    c.post<OrchestratorResponse>('/api/orchestrate', body),

  stream: (
    body: OrchestratorRequest,
    onEvent: (e: SSEEvent) => void,
    onDone?: () => void,
    signal?: AbortSignal
  ) => createSSEStream(`${BASE}/api/orchestrate/stream`, body, onEvent, onDone, signal),

  chatCompletion: (body: object) => c.post('/api/chat/completions', body),
  chatStream: (body: object, onEvent: (e: SSEEvent) => void, onDone?: () => void, signal?: AbortSignal) =>
    createSSEStream(`${BASE}/api/chat/stream`, body, onEvent, onDone, signal),
};
```

**Synthesis** (`src/api/docker/synthesis.ts`):
```typescript
import { dockerClient as c } from '../client';
import type { SynthesisRequest, SynthesisResult } from '../../types';

export const synthesisApi = {
  synthesize: (task: string) =>
    c.post<SynthesisResult>('/synthesize', { task }),
};
```

**Full modules follow the same pattern for**: conversations, workflows, tools (proxy), toolRegistry, execution, mcp, health.

---

## 4. State Management

### 4.1 React Query Setup

```typescript
// src/lib/queryClient.ts
import { QueryClient } from '@tanstack/react-query';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime:          60_000,      // 1 minute
      gcTime:             5 * 60_000,  // 5 minutes
      retry:              2,
      refetchOnWindowFocus: false,
    },
    mutations: {
      onError: () => {},               // Global handled by interceptor
    },
  },
});
```

**Query key factory** (`src/lib/queryKeys.ts`):
```typescript
export const QK = {
  agents:        () => ['agents'] as const,
  agent:         (id: string) => ['agents', id] as const,
  conversations: () => ['conversations'] as const,
  conversation:  (id: string) => ['conversations', id] as const,
  history:       (id: string) => ['conversations', id, 'history'] as const,
  workflows:     () => ['workflows'] as const,
  workflow:      (name: string) => ['workflows', name] as const,
  execution:     (id: string) => ['workflow-execution', id] as const,
  tools:         () => ['tools'] as const,
  pendingTools:  () => ['tools', 'pending'] as const,
  toolHash:      (hash: string) => ['tools', 'hash', hash] as const,
  mcpServers:    () => ['mcp-servers'] as const,
  health8k:      () => ['health', '8000'] as const,
  health9k:      () => ['health', '9000'] as const,
};
```

### 4.2 Zustand Global Store

```typescript
// src/store/uiStore.ts
import { create } from 'zustand';
import { devtools } from 'zustand/middleware';

interface Toast { id: string; type: 'success'|'error'|'info'|'warning'; message: string; }

interface UIStore {
  sidebarOpen:  boolean;
  cmdPalette:   boolean;
  toasts:       Toast[];
  activePath:   string;
  setSidebar:   (open: boolean) => void;
  setCmdPalette:(open: boolean) => void;
  push:         (toast: Omit<Toast, 'id'>) => void;
  dismiss:      (id: string) => void;
}

export const useUIStore = create<UIStore>()(
  devtools((set) => ({
    sidebarOpen:  true,
    cmdPalette:   false,
    toasts:       [],
    activePath:   '/',
    setSidebar:   (open) => set({ sidebarOpen: open }),
    setCmdPalette:(open) => set({ cmdPalette: open }),
    push: (t) => set((s) => ({
      toasts: [...s.toasts, { ...t, id: crypto.randomUUID() }],
    })),
    dismiss: (id) => set((s) => ({
      toasts: s.toasts.filter((t) => t.id !== id),
    })),
  }))
);

// Convenience export for interceptors (no hook required)
export const toastStore = useUIStore;
```

```typescript
// src/store/chatStore.ts
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Message } from '../types';

interface ChatStore {
  messages:        Message[];
  conversationId:  string | null;
  selectedAgentId: string | null;
  mode:            'orchestrate' | 'direct';
  streaming:       boolean;
  appendChunk:     (chunk: string) => void;
  addMessage:      (msg: Message) => void;
  setConversation: (id: string | null) => void;
  setAgent:        (id: string | null) => void;
  setMode:         (m: 'orchestrate' | 'direct') => void;
  setStreaming:     (v: boolean) => void;
  reset:           () => void;
}

export const useChatStore = create<ChatStore>()(
  persist(
    (set) => ({
      messages:        [],
      conversationId:  null,
      selectedAgentId: null,
      mode:            'orchestrate',
      streaming:       false,
      appendChunk: (chunk) => set((s) => {
        const last = s.messages[s.messages.length - 1];
        if (last?.role === 'assistant') {
          return {
            messages: [
              ...s.messages.slice(0, -1),
              { ...last, content: last.content + chunk },
            ],
          };
        }
        return { messages: [...s.messages, { id: crypto.randomUUID(), role: 'assistant', content: chunk }] };
      }),
      addMessage:      (msg) => set((s) => ({ messages: [...s.messages, msg] })),
      setConversation: (id)  => set({ conversationId: id }),
      setAgent:        (id)  => set({ selectedAgentId: id }),
      setMode:         (m)   => set({ mode: m }),
      setStreaming:     (v)   => set({ streaming: v }),
      reset: () => set({ messages: [], conversationId: null, streaming: false }),
    }),
    { name: 'chat-store', partialize: (s) => ({ mode: s.mode, selectedAgentId: s.selectedAgentId }) }
  )
);
```

---

## 5. Application Shell & Navigation

### 5.1 Router (`src/router.tsx`)

```typescript
import { createBrowserRouter, RouterProvider, Outlet } from 'react-router-dom';
import { AppShell } from './components/layout/AppShell';
import { lazy, Suspense } from 'react';
import { PageSkeleton } from './components/ui/Skeleton';

const AgentStudio        = lazy(() => import('./features/agents'));
const OrchestratorChat   = lazy(() => import('./features/chat'));
const ToolLifecycle      = lazy(() => import('./features/tools'));
const WorkflowDashboard  = lazy(() => import('./features/workflows'));
const ConversationMgr    = lazy(() => import('./features/conversations'));
const McpRegistry        = lazy(() => import('./features/mcp'));
const HealthDashboard    = lazy(() => import('./features/health'));

const router = createBrowserRouter([
  {
    path: '/',
    element: <AppShell><Outlet /></AppShell>,
    children: [
      { index: true,              element: <Suspense fallback={<PageSkeleton />}><OrchestratorChat /></Suspense> },
      { path: 'agents',           element: <Suspense fallback={<PageSkeleton />}><AgentStudio /></Suspense> },
      { path: 'agents/:id',       element: <Suspense fallback={<PageSkeleton />}><AgentStudio /></Suspense> },
      { path: 'tools',            element: <Suspense fallback={<PageSkeleton />}><ToolLifecycle /></Suspense> },
      { path: 'workflows',        element: <Suspense fallback={<PageSkeleton />}><WorkflowDashboard /></Suspense> },
      { path: 'conversations',    element: <Suspense fallback={<PageSkeleton />}><ConversationMgr /></Suspense> },
      { path: 'mcp',              element: <Suspense fallback={<PageSkeleton />}><McpRegistry /></Suspense> },
      { path: 'health',           element: <Suspense fallback={<PageSkeleton />}><HealthDashboard /></Suspense> },
    ],
  },
]);

export const Router = () => <RouterProvider router={router} />;
```

### 5.2 AppShell (`src/components/layout/AppShell.tsx`)

The shell is a three-zone layout: `[Sidebar] [Content]` with a slide-over notification tray. Sidebar collapses to an icon-only rail on narrow viewports (≥ 1024px uses expanded form by default).

```typescript
import { motion, AnimatePresence } from 'framer-motion';
import { Sidebar } from './Sidebar';
import { TopBar } from './TopBar';
import { CommandPalette } from './CommandPalette';
import { ToastStack } from '../ui/Toast';
import { useUIStore } from '../../store';

export const AppShell: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { sidebarOpen, cmdPalette } = useUIStore();

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-bg-base text-text-primary font-body">
      {/* Sidebar */}
      <motion.aside
        animate={{ width: sidebarOpen ? 220 : 56 }}
        transition={{ type: 'spring', stiffness: 300, damping: 30 }}
        className="flex-shrink-0 border-r border-border-faint flex flex-col"
      >
        <Sidebar collapsed={!sidebarOpen} />
      </motion.aside>

      {/* Main content area */}
      <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
        <TopBar />
        <main className="flex-1 overflow-auto">
          <AnimatePresence mode="wait">
            {children}
          </AnimatePresence>
        </main>
      </div>

      {/* Command Palette */}
      <AnimatePresence>
        {cmdPalette && <CommandPalette />}
      </AnimatePresence>

      {/* Toast notifications */}
      <ToastStack />
    </div>
  );
};
```

### 5.3 Sidebar (`src/components/layout/Sidebar.tsx`)

```typescript
import { NavLink } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  BotMessageSquare, Wrench, GitBranch, MessageSquare,
  Server, Activity, ChevronLeft, Cpu,
} from 'lucide-react';
import { useUIStore } from '../../store';
import { cn } from '../../lib/utils';

const NAV = [
  { to: '/',               icon: BotMessageSquare, label: 'Chat',          accent: 'text-accent-electric' },
  { to: '/agents',         icon: Cpu,              label: 'Agents'         },
  { to: '/tools',          icon: Wrench,           label: 'Tools',         accent: 'text-accent-amber' },
  { to: '/workflows',      icon: GitBranch,        label: 'Workflows'      },
  { to: '/conversations',  icon: MessageSquare,    label: 'Conversations'  },
  { to: '/mcp',            icon: Server,           label: 'MCP Servers',   accent: 'text-accent-purple' },
  { to: '/health',         icon: Activity,         label: 'Health'         },
] as const;

export const Sidebar: React.FC<{ collapsed: boolean }> = ({ collapsed }) => {
  const { setSidebar } = useUIStore();

  return (
    <>
      {/* Logo + collapse toggle */}
      <div className="h-12 flex items-center justify-between px-3 border-b border-border-faint flex-shrink-0">
        {!collapsed && (
          <span className="font-display font-600 text-sm tracking-wide text-text-primary">
            Mistral Agent
          </span>
        )}
        <button
          onClick={() => setSidebar(collapsed)}
          className="ml-auto p-1.5 rounded-md hover:bg-bg-hover text-text-muted hover:text-text-primary transition-colors"
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          <motion.div animate={{ rotate: collapsed ? 180 : 0 }} transition={{ duration: 0.2 }}>
            <ChevronLeft size={14} />
          </motion.div>
        </button>
      </div>

      {/* Nav links */}
      <nav className="flex-1 px-2 py-3 space-y-0.5 overflow-y-auto">
        {NAV.map(({ to, icon: Icon, label, accent }) => (
          <NavLink
            key={to}
            to={to}
            end={to === '/'}
            className={({ isActive }) => cn(
              'flex items-center gap-2.5 px-2 py-2 rounded-md text-sm transition-all duration-150',
              isActive
                ? 'bg-bg-subtle text-text-primary'
                : 'text-text-secondary hover:bg-bg-hover hover:text-text-primary',
            )}
          >
            {({ isActive }) => (
              <>
                <Icon
                  size={16}
                  className={cn(isActive ? (accent ?? 'text-accent-electric') : 'text-text-muted')}
                />
                {!collapsed && (
                  <motion.span
                    initial={false}
                    animate={{ opacity: 1 }}
                    className="truncate"
                  >
                    {label}
                  </motion.span>
                )}
              </>
            )}
          </NavLink>
        ))}
      </nav>

      {/* Footer: docs link */}
      {!collapsed && (
        <div className="px-3 py-3 border-t border-border-faint">
          <a
            href="http://localhost:8000/docs"
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-text-muted hover:text-text-secondary transition-colors"
          >
            API Docs ↗
          </a>
        </div>
      )}
    </>
  );
};
```

### 5.4 Command Palette

Accessible via `Cmd+K` / `Ctrl+K`. Uses `cmdk` library. Searches agents, tools, workflows, and nav destinations.

```typescript
// src/components/layout/CommandPalette.tsx
import { Command } from 'cmdk';
import { motion } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { agentsApi } from '../../api/agents';
import { QK } from '../../lib/queryKeys';
import { useUIStore } from '../../store';

export const CommandPalette = () => {
  const { setCmdPalette } = useUIStore();
  const navigate = useNavigate();

  const { data: agents } = useQuery({
    queryKey: QK.agents(),
    queryFn:  () => agentsApi.list().then(r => r.data.items),
  });

  const go = (path: string) => { navigate(path); setCmdPalette(false); };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-24 bg-black/60 backdrop-blur-sm"
      onClick={() => setCmdPalette(false)}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.96, y: -8 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.96, y: -8 }}
        transition={{ duration: 0.15 }}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-xl bg-bg-overlay border border-border-default rounded-xl shadow-modal overflow-hidden"
      >
        <Command className="font-body">
          <Command.Input
            placeholder="Search agents, tools, workflows…"
            className="w-full bg-transparent px-4 py-3.5 text-sm text-text-primary placeholder:text-text-muted border-b border-border-faint outline-none"
            autoFocus
          />
          <Command.List className="max-h-80 overflow-y-auto py-2">
            <Command.Empty className="px-4 py-8 text-center text-sm text-text-muted">
              No results found.
            </Command.Empty>

            <Command.Group heading="Navigation" className="px-2">
              {[
                ['Chat',          '/'],
                ['Agents',        '/agents'],
                ['Tools',         '/tools'],
                ['Workflows',     '/workflows'],
                ['Conversations', '/conversations'],
                ['MCP Servers',   '/mcp'],
                ['Health',        '/health'],
              ].map(([label, path]) => (
                <Command.Item
                  key={path}
                  onSelect={() => go(path)}
                  className="flex items-center gap-2.5 px-2 py-2 rounded-md text-sm text-text-secondary hover:bg-bg-hover hover:text-text-primary cursor-pointer transition-colors"
                >
                  {label}
                </Command.Item>
              ))}
            </Command.Group>

            {agents?.length ? (
              <Command.Group heading="Agents" className="px-2">
                {agents.map((a) => (
                  <Command.Item
                    key={a.id}
                    onSelect={() => go(`/agents/${a.id}`)}
                    className="flex items-center gap-2.5 px-2 py-2 rounded-md text-sm text-text-secondary hover:bg-bg-hover hover:text-text-primary cursor-pointer transition-colors"
                  >
                    <span className="text-accent-electric text-xs font-mono">[agent]</span>
                    {a.name}
                  </Command.Item>
                ))}
              </Command.Group>
            ) : null}
          </Command.List>
        </Command>
      </motion.div>
    </div>
  );
};
```

---

## 6. Feature Modules

### 6.1 Agent Studio

**Route**: `/agents`, `/agents/:id`  
**APIs**: `GET/POST/PATCH/DELETE /api/agents/{id}`

#### Layout

A master-detail split: left panel is a scrollable agent list with search + filter; right panel shows the selected agent's detail or the creation form.

#### AgentList (`src/features/agents/AgentList.tsx`)

```typescript
import { useInfiniteQuery } from '@tanstack/react-query';
import { agentsApi } from '../../api/agents';
import { QK } from '../../lib/queryKeys';
import { AgentCard } from '../../components/domain/AgentCard';
import { Spinner } from '../../components/ui/Spinner';
import { Input } from '../../components/ui/Input';
import { useState, useDeferredValue } from 'react';
import { useNavigate, useParams } from 'react-router-dom';

export const AgentList = () => {
  const [q, setQ] = useState('');
  const deferred = useDeferredValue(q);
  const { id: selectedId } = useParams();
  const navigate = useNavigate();

  const { data, fetchNextPage, hasNextPage, isFetchingNextPage, isLoading } =
    useInfiniteQuery({
      queryKey: [...QK.agents(), deferred],
      queryFn: ({ pageParam = 1 }) =>
        agentsApi.list(pageParam, 20).then((r) => r.data),
      getNextPageParam: (last) =>
        last.page < last.total_pages ? last.page + 1 : undefined,
      initialPageParam: 1,
    });

  const agents = data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <div className="flex flex-col h-full">
      <div className="p-3 border-b border-border-faint">
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search agents…"
          className="text-sm"
        />
      </div>
      <div className="flex-1 overflow-y-auto p-2 space-y-1">
        {isLoading && <Spinner className="mx-auto mt-8" />}
        {agents.map((agent) => (
          <AgentCard
            key={agent.id}
            agent={agent}
            selected={agent.id === selectedId}
            onClick={() => navigate(`/agents/${agent.id}`)}
          />
        ))}
        {hasNextPage && (
          <button
            onClick={() => fetchNextPage()}
            disabled={isFetchingNextPage}
            className="w-full py-2 text-xs text-text-muted hover:text-text-secondary transition-colors"
          >
            {isFetchingNextPage ? 'Loading…' : 'Load more'}
          </button>
        )}
      </div>
      <div className="p-3 border-t border-border-faint">
        <button
          onClick={() => navigate('/agents/new')}
          className="w-full py-1.5 text-sm text-accent-electric border border-accent-electric/30 rounded-md hover:bg-surface-info transition-colors"
        >
          + New Agent
        </button>
      </div>
    </div>
  );
};
```

#### AgentEditor (`src/features/agents/AgentEditor.tsx`)

Full-featured form with live preview of instructions, model selector, and tool attachment checklist.

```typescript
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation, useQueryClient, useQuery } from '@tanstack/react-query';
import { agentsApi } from '../../api/agents';
import { QK } from '../../lib/queryKeys';
import { Input, Textarea, Select, Button, Badge } from '../../components/ui';
import { useNavigate } from 'react-router-dom';
import { toolsApi } from '../../api/tools';

const schema = z.object({
  name:         z.string().min(1, 'Name is required'),
  model:        z.string().min(1),
  instructions: z.string().optional(),
  description:  z.string().optional(),
  tools:        z.array(z.string()),
});
type FormData = z.infer<typeof schema>;

const MODELS = ['mistral-large-latest', 'mistral-medium', 'codestral-latest', 'open-mistral-7b'];

export const AgentEditor: React.FC<{ agent?: Agent }> = ({ agent }) => {
  const qc = useQueryClient();
  const navigate = useNavigate();

  const { data: availableTools = [] } = useQuery({
    queryKey: QK.tools(),
    queryFn:  () => toolsApi.list().then((r) => r.data),
  });

  const { control, register, handleSubmit, watch, formState: { errors, isDirty } } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: {
      name:         agent?.name ?? '',
      model:        agent?.model ?? 'mistral-large-latest',
      instructions: agent?.instructions ?? '',
      description:  agent?.description ?? '',
      tools:        agent?.tools?.map((t) => t.id) ?? [],
    },
  });

  const mutation = useMutation({
    mutationFn: (data: FormData) =>
      agent
        ? agentsApi.update(agent.id, data)
        : agentsApi.create(data),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: QK.agents() });
      navigate(`/agents/${res.data.id}`);
    },
  });

  const instructions = watch('instructions');

  return (
    <form onSubmit={handleSubmit((d) => mutation.mutate(d))} className="h-full flex flex-col">
      <div className="flex-1 overflow-y-auto p-6 space-y-6">

        {/* Name + Model row */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-xs text-text-muted mb-1.5">Agent Name</label>
            <Input {...register('name')} placeholder="e.g. Code Reviewer" />
            {errors.name && <p className="text-xs text-accent-danger mt-1">{errors.name.message}</p>}
          </div>
          <div>
            <label className="block text-xs text-text-muted mb-1.5">Model</label>
            <Controller name="model" control={control} render={({ field }) => (
              <Select {...field}>
                {MODELS.map((m) => <option key={m} value={m}>{m}</option>)}
              </Select>
            )} />
          </div>
        </div>

        {/* Description */}
        <div>
          <label className="block text-xs text-text-muted mb-1.5">Description</label>
          <Input {...register('description')} placeholder="Short description of what this agent does" />
        </div>

        {/* Instructions + live preview */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-xs text-text-muted mb-1.5">System Instructions</label>
            <Textarea
              {...register('instructions')}
              rows={12}
              placeholder="You are a helpful assistant that…"
              className="font-mono text-xs"
            />
          </div>
          <div>
            <label className="block text-xs text-text-muted mb-1.5">Preview</label>
            <div className="bg-bg-subtle rounded-lg p-3 h-full text-xs text-text-secondary font-mono whitespace-pre-wrap overflow-y-auto border border-border-faint">
              {instructions || <span className="text-text-muted italic">Instructions will appear here…</span>}
            </div>
          </div>
        </div>

        {/* Tool attachment */}
        <div>
          <label className="block text-xs text-text-muted mb-2">Attached Tools</label>
          <Controller name="tools" control={control} render={({ field }) => (
            <div className="grid grid-cols-2 gap-1.5">
              {availableTools.map((tool) => {
                const checked = field.value.includes(tool.id);
                return (
                  <label
                    key={tool.id}
                    className={`flex items-center gap-2 px-2.5 py-2 rounded-md border cursor-pointer text-xs transition-colors ${
                      checked
                        ? 'border-accent-electric/40 bg-surface-info text-text-primary'
                        : 'border-border-faint hover:border-border-default text-text-secondary'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={(e) => {
                        field.onChange(
                          e.target.checked
                            ? [...field.value, tool.id]
                            : field.value.filter((id) => id !== tool.id)
                        );
                      }}
                      className="sr-only"
                    />
                    <span className="truncate font-mono">{tool.name}</span>
                  </label>
                );
              })}
            </div>
          )} />
        </div>
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between p-4 border-t border-border-faint">
        <button type="button" onClick={() => navigate(-1)} className="text-sm text-text-muted hover:text-text-secondary transition-colors">
          Cancel
        </button>
        <Button
          type="submit"
          disabled={!isDirty || mutation.isPending}
          loading={mutation.isPending}
        >
          {agent ? 'Save Changes' : 'Create Agent'}
        </Button>
      </div>
    </form>
  );
};
```

---

### 6.2 Orchestrator Chat

**Route**: `/`  
**APIs**: `POST /api/orchestrate`, `POST /api/orchestrate/stream`, `POST /api/chat/completions`, `POST /api/chat/stream`

This is the application's primary surface — a full-featured chat interface with mode switching, agent selection, streaming responses, and tool-call visualisation.

#### Layout

Three-panel: [Conversation list sidebar] [Chat thread] [Context drawer (agent detail / tool calls)]

#### OrchestratorChat (`src/features/chat/OrchestratorChat.tsx`)

```typescript
import { useState } from 'react';
import { ChatThread } from './ChatThread';
import { ChatInput } from './ChatInput';
import { AgentSelector } from './AgentSelector';
import { ModeToggle } from './ModeToggle';
import { ConversationSidebar } from './ConversationSidebar';
import { useChatStore } from '../../store/chatStore';
import { useOrchestratorStream } from './hooks/useOrchestratorStream';
import { useStreamingChat } from './hooks/useStreamingChat';

export const OrchestratorChat = () => {
  const { mode, selectedAgentId, conversationId, addMessage, setConversation } = useChatStore();
  const [sidebarOpen, setSidebarOpen] = useState(true);

  const orchestratorStream = useOrchestratorStream();
  const directStream       = useStreamingChat();

  const handleSubmit = (query: string) => {
    addMessage({ id: crypto.randomUUID(), role: 'user', content: query });

    if (mode === 'orchestrate') {
      orchestratorStream.start({
        query,
        agent_id:        selectedAgentId ?? undefined,
        conversation_id: conversationId ?? undefined,
      });
    } else {
      directStream.start({ query, agentId: selectedAgentId });
    }
  };

  return (
    <div className="flex h-full">
      {/* Conversation sidebar */}
      {sidebarOpen && (
        <aside className="w-56 border-r border-border-faint flex-shrink-0">
          <ConversationSidebar />
        </aside>
      )}

      {/* Chat column */}
      <div className="flex flex-col flex-1 min-w-0">
        {/* Toolbar */}
        <div className="h-11 px-4 border-b border-border-faint flex items-center justify-between gap-3 flex-shrink-0">
          <button
            onClick={() => setSidebarOpen(!sidebarOpen)}
            className="text-text-muted hover:text-text-secondary transition-colors p-1"
            aria-label="Toggle conversation list"
          >
            ≡
          </button>
          <div className="flex items-center gap-3">
            <ModeToggle />
            <AgentSelector />
          </div>
        </div>

        {/* Messages */}
        <ChatThread className="flex-1 min-h-0" />

        {/* Input */}
        <div className="border-t border-border-faint p-3">
          <ChatInput
            onSubmit={handleSubmit}
            disabled={orchestratorStream.streaming || directStream.streaming}
            onStop={() => {
              orchestratorStream.stop();
              directStream.stop();
            }}
          />
        </div>
      </div>
    </div>
  );
};
```

#### MessageBubble (`src/features/chat/MessageBubble.tsx`)

```typescript
import { motion } from 'framer-motion';
import { ToolCallBlock } from './ToolCallBlock';
import { CodeBlock } from '../../components/ui/CodeBlock';
import type { Message } from '../../types';

export const MessageBubble: React.FC<{ message: Message }> = ({ message }) => {
  const isUser = message.role === 'user';

  return (
    <motion.div
      variants={{ hidden: { opacity: 0, y: 8 }, visible: { opacity: 1, y: 0 } }}
      className={`flex gap-3 ${isUser ? 'flex-row-reverse' : ''}`}
    >
      {/* Avatar */}
      <div className={`w-6 h-6 rounded-full flex-shrink-0 mt-1 flex items-center justify-center text-xs font-mono
        ${isUser ? 'bg-accent-electric text-bg-base' : 'bg-bg-subtle border border-border-default text-text-muted'}`}>
        {isUser ? 'U' : 'M'}
      </div>

      <div className={`max-w-[70%] min-w-0 space-y-2 ${isUser ? 'items-end' : 'items-start'} flex flex-col`}>
        {/* Tool calls (assistant only) */}
        {message.tool_calls?.map((tc) => (
          <ToolCallBlock key={tc.id} toolCall={tc} />
        ))}

        {/* Text content */}
        {message.content && (
          <div className={`px-3.5 py-2.5 rounded-xl text-sm leading-relaxed whitespace-pre-wrap break-words
            ${isUser
              ? 'bg-accent-electric text-bg-base rounded-tr-sm'
              : 'bg-bg-raised border border-border-faint text-text-primary rounded-tl-sm'
            }`}
          >
            {message.content}
            {message.streaming && <StreamingCursor />}
          </div>
        )}

        <span className="text-[10px] text-text-muted px-1">
          {message.timestamp ? new Date(message.timestamp).toLocaleTimeString() : ''}
        </span>
      </div>
    </motion.div>
  );
};
```

#### ToolCallBlock (`src/features/chat/ToolCallBlock.tsx`)

Displays tool invocation and result inline with expandable code view.

```typescript
import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronRight, Zap } from 'lucide-react';
import { JsonViewer } from '../../components/ui/JsonViewer';
import type { ToolCall } from '../../types';

export const ToolCallBlock: React.FC<{ toolCall: ToolCall }> = ({ toolCall }) => {
  const [open, setOpen] = useState(false);

  return (
    <div className="border border-accent-amber/25 bg-surface-warning rounded-lg overflow-hidden w-full max-w-sm">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-2 px-3 py-2 text-xs text-accent-amber hover:bg-accent-amber/10 transition-colors"
      >
        <Zap size={12} />
        <span className="font-mono truncate">{toolCall.function.name}</span>
        <motion.div
          animate={{ rotate: open ? 90 : 0 }}
          className="ml-auto flex-shrink-0"
        >
          <ChevronRight size={12} />
        </motion.div>
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ height: 0 }} animate={{ height: 'auto' }} exit={{ height: 0 }}
            className="overflow-hidden"
          >
            <div className="border-t border-accent-amber/15 p-3 space-y-2">
              <p className="text-[10px] text-text-muted uppercase tracking-wide">Arguments</p>
              <JsonViewer data={JSON.parse(toolCall.function.arguments || '{}')} />
              {toolCall.result !== undefined && (
                <>
                  <p className="text-[10px] text-text-muted uppercase tracking-wide mt-3">Result</p>
                  <JsonViewer data={toolCall.result} />
                </>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
```

#### useOrchestratorStream (`src/features/chat/hooks/useOrchestratorStream.ts`)

```typescript
import { useRef, useState } from 'react';
import { orchestratorApi } from '../../../api/orchestrator';
import { useChatStore } from '../../../store/chatStore';
import type { OrchestratorRequest } from '../../../types';

export const useOrchestratorStream = () => {
  const { appendChunk, addMessage, setStreaming } = useChatStore();
  const [streaming, setStreamingLocal] = useState(false);
  const stopRef = useRef<(() => void) | null>(null);

  const start = (req: OrchestratorRequest) => {
    setStreamingLocal(true);
    setStreaming(true);
    // Seed an empty assistant message
    addMessage({ id: crypto.randomUUID(), role: 'assistant', content: '', streaming: true });

    const ctrl = new AbortController();
    stopRef.current = () => ctrl.abort();

    const stop = orchestratorApi.stream(
      req,
      (event) => {
        if (event.type === 'text_chunk') {
          appendChunk(event.data);
        }
        if (event.type === 'tool_call') {
          const tc = JSON.parse(event.data);
          // append tool call to last assistant message via store action
          useChatStore.getState().appendToolCall(tc);
        }
        if (event.type === 'conversation_id') {
          useChatStore.getState().setConversation(event.data);
        }
      },
      () => {
        setStreamingLocal(false);
        setStreaming(false);
        useChatStore.getState().finalizeStreaming();
      },
      ctrl.signal,
    );
    stopRef.current = stop;
  };

  const stop = () => { stopRef.current?.(); setStreamingLocal(false); setStreaming(false); };

  return { start, stop, streaming };
};
```

---

### 6.3 Tool Lifecycle Manager

**Route**: `/tools`  
**APIs**: Synthesis, pending/approve/reject (both ports), hash lookup, registry list

#### Layout

Three-tab view: **Synthesize** | **Pending Approval** | **Active Registry**

#### SynthesisPanel (`src/features/tools/SynthesisPanel.tsx`)

```typescript
import { useForm } from 'react-hook-form';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { synthesisApi } from '../../api/docker/synthesis';
import { toolRegistryApi } from '../../api/docker/toolRegistry';
import { Textarea, Button, Badge } from '../../components/ui';
import { CodeBlock } from '../../components/ui/CodeBlock';
import { DuplicateGuard } from './DuplicateGuard';
import { QK } from '../../lib/queryKeys';
import { sha256 } from '../../lib/utils';

export const SynthesisPanel = () => {
  const [task, setTask] = useState('');
  const [result, setResult] = useState<SynthesisResult | null>(null);
  const qc = useQueryClient();

  // Duplicate hash check (live as user types, debounced)
  const taskHash = sha256(task);

  const { data: existingTool } = useQuery({
    queryKey: QK.toolHash(taskHash),
    queryFn:  () => toolRegistryApi.getByHash(taskHash).then(r => r.data),
    enabled:  task.length > 20,
    retry:    false,
  });

  const synthesis = useMutation({
    mutationFn: () => synthesisApi.synthesize(task).then(r => r.data),
    onSuccess: (data) => {
      setResult(data);
      qc.invalidateQueries({ queryKey: QK.pendingTools() });
    },
  });

  return (
    <div className="max-w-2xl mx-auto py-8 px-4 space-y-6">
      <div>
        <h2 className="font-display text-base font-600 text-text-primary mb-1">Synthesize a Tool</h2>
        <p className="text-sm text-text-secondary">
          Describe what you need in plain English. Codestral will generate, lint, and sandbox the code.
        </p>
      </div>

      {/* Duplicate warning */}
      {existingTool && <DuplicateGuard tool={existingTool} />}

      {/* Task input */}
      <div>
        <label className="block text-xs text-text-muted mb-1.5">Task description</label>
        <Textarea
          value={task}
          onChange={(e) => setTask(e.target.value)}
          rows={5}
          placeholder="e.g. A function that takes a URL and returns the HTTP status code and response time in milliseconds."
          className="text-sm"
        />
      </div>

      <Button
        onClick={() => synthesis.mutate()}
        disabled={task.length < 10 || synthesis.isPending || !!existingTool}
        loading={synthesis.isPending}
        className="w-full"
      >
        {synthesis.isPending ? 'Synthesizing with Codestral…' : 'Synthesize Tool'}
      </Button>

      {/* Result */}
      {result && (
        <div className="space-y-4 animate-slide-up">
          <div className="flex items-center gap-2">
            <Badge variant="success">Sandbox passed</Badge>
            <span className="text-xs text-text-muted font-mono">{result.tool_id}</span>
          </div>

          <div>
            <p className="text-xs text-text-muted mb-1.5">Generated code</p>
            <CodeBlock language="python" code={result.code} />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="bg-bg-subtle rounded-md p-3">
              <p className="text-[10px] text-text-muted uppercase tracking-wide mb-1">Lint result</p>
              <p className="text-xs font-mono text-accent-success">{result.lint_status ?? 'Clean'}</p>
            </div>
            <div className="bg-bg-subtle rounded-md p-3">
              <p className="text-[10px] text-text-muted uppercase tracking-wide mb-1">Sandbox run</p>
              <p className="text-xs font-mono text-accent-success">{result.sandbox_status ?? 'Passed'}</p>
            </div>
          </div>

          <p className="text-xs text-text-secondary">
            Tool is now in the <strong className="text-text-primary">Pending Approval</strong> queue.
          </p>
        </div>
      )}
    </div>
  );
};
```

#### PendingApprovals (`src/features/tools/PendingApprovals.tsx`)

```typescript
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import { Check, X } from 'lucide-react';
import { toolsApi } from '../../api/tools';
import { QK } from '../../lib/queryKeys';
import { CodeBlock } from '../../components/ui/CodeBlock';
import { Badge } from '../../components/ui/Badge';
import { useState } from 'react';

export const PendingApprovals = () => {
  const qc = useQueryClient();
  const [expanded, setExpanded] = useState<string | null>(null);

  const { data: pending = [], isLoading } = useQuery({
    queryKey: QK.pendingTools(),
    queryFn:  () => toolsApi.listPending().then(r => r.data),
    refetchInterval: 5_000,
  });

  const approve = useMutation({
    mutationFn: (id: string) => toolsApi.approve(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: QK.pendingTools() }),
  });

  const reject = useMutation({
    mutationFn: (id: string) => toolsApi.reject(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: QK.pendingTools() }),
  });

  if (isLoading) return <div className="p-8 text-center text-text-muted text-sm">Loading…</div>;

  if (!pending.length) return (
    <div className="flex flex-col items-center py-16 text-text-muted text-sm gap-2">
      <span className="text-2xl">✓</span>
      No tools awaiting approval.
    </div>
  );

  return (
    <div className="space-y-3 p-4 max-w-3xl mx-auto">
      <AnimatePresence initial={false}>
        {pending.map((tool) => (
          <motion.div
            key={tool.id}
            layout
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96 }}
            className="bg-bg-raised border border-border-default rounded-xl overflow-hidden"
          >
            {/* Header */}
            <div className="flex items-center gap-3 px-4 py-3">
              <Badge variant="warning">Pending</Badge>
              <span className="font-mono text-sm text-text-primary">{tool.name}</span>
              <span className="text-xs text-text-muted ml-auto">{tool.created_at}</span>
              <button
                onClick={() => setExpanded(expanded === tool.id ? null : tool.id)}
                className="text-xs text-text-muted hover:text-text-secondary ml-2 transition-colors"
              >
                {expanded === tool.id ? 'Collapse' : 'View code'}
              </button>
            </div>

            {/* Code expansion */}
            <AnimatePresence>
              {expanded === tool.id && (
                <motion.div
                  initial={{ height: 0 }} animate={{ height: 'auto' }} exit={{ height: 0 }}
                  className="overflow-hidden"
                >
                  <div className="border-t border-border-faint px-4 py-3">
                    <CodeBlock language="python" code={tool.code} maxHeight={240} />
                    <p className="text-xs text-text-muted mt-2 font-mono">
                      SHA-256: {tool.hash}
                    </p>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Actions */}
            <div className="flex gap-2 px-4 py-2.5 border-t border-border-faint bg-bg-subtle/50">
              <button
                onClick={() => approve.mutate(tool.id)}
                disabled={approve.isPending}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-accent-success border border-accent-success/30 rounded-md hover:bg-surface-success transition-colors"
              >
                <Check size={12} /> Approve
              </button>
              <button
                onClick={() => reject.mutate(tool.id)}
                disabled={reject.isPending}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-accent-danger border border-accent-danger/30 rounded-md hover:bg-surface-danger transition-colors"
              >
                <X size={12} /> Reject
              </button>
            </div>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
};
```

---

### 6.4 Workflow Builder & Executor

**Route**: `/workflows`  
**APIs**: `GET/POST/DELETE /api/workflows`, `POST /api/workflows/{name}/execute`, `GET /api/workflows/executions/{id}`

#### Layout

Two sub-views: **Workflow list** (left) + **DAG canvas** (right, using ReactFlow) + **Execution panel** (drawer or bottom pane).

#### DagCanvas (`src/features/workflows/DagCanvas.tsx`)

```typescript
import ReactFlow, {
  addEdge, Background, Controls, MiniMap,
  useNodesState, useEdgesState,
  type Node, type Edge, type Connection,
} from 'reactflow';
import 'reactflow/dist/style.css';
import { DagNode } from './DagNode';
import { useCallback } from 'react';
import type { WorkflowDefinition } from '../../types';

const nodeTypes = { dagNode: DagNode };

export const DagCanvas: React.FC<{
  workflow: WorkflowDefinition;
  onChange?: (nodes: Node[], edges: Edge[]) => void;
  readonly?: boolean;
}> = ({ workflow, onChange, readonly = false }) => {
  const initialNodes: Node[] = workflow.steps.map((step, i) => ({
    id: step.id,
    type: 'dagNode',
    position: step.position ?? { x: i * 200, y: 100 },
    data: { label: step.name, tool: step.tool, description: step.description },
  }));

  const initialEdges: Edge[] = workflow.edges.map((e) => ({
    id: `${e.from}-${e.to}`,
    source: e.from,
    target: e.to,
    animated: false,
    style: { stroke: 'var(--accent-electric)', strokeWidth: 1.5, opacity: 0.5 },
  }));

  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);

  const onConnect = useCallback((conn: Connection) => {
    setEdges((eds) => addEdge({ ...conn, animated: false }, eds));
  }, []);

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      onConnect={readonly ? undefined : onConnect}
      nodeTypes={nodeTypes}
      nodesDraggable={!readonly}
      nodesConnectable={!readonly}
      fitView
      proOptions={{ hideAttribution: true }}
      style={{ background: 'var(--bg-base)' }}
    >
      <Background color="rgba(255,255,255,0.04)" gap={24} />
      <Controls
        style={{ background: 'var(--bg-raised)', border: '1px solid var(--border-faint)' }}
      />
      <MiniMap
        style={{ background: 'var(--bg-raised)' }}
        maskColor="rgba(0,0,0,0.5)"
      />
    </ReactFlow>
  );
};
```

#### ExecutionPanel (`src/features/workflows/ExecutionPanel.tsx`)

Polls `GET /api/workflows/executions/{id}` every 2 seconds while status is pending/running.

```typescript
import { useQuery } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { workflowsApi } from '../../api/workflows';
import { QK } from '../../lib/queryKeys';
import { Badge } from '../../components/ui/Badge';
import { JsonViewer } from '../../components/ui/JsonViewer';

export const ExecutionPanel: React.FC<{ executionId: string }> = ({ executionId }) => {
  const { data: exec } = useQuery({
    queryKey: QK.execution(executionId),
    queryFn:  () => workflowsApi.getExecution(executionId).then(r => r.data),
    refetchInterval: (q) =>
      q.state.data?.status === 'running' ? 2_000 : false,
  });

  if (!exec) return null;

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-center gap-3">
        <span className="text-xs text-text-muted font-mono">{executionId.slice(0, 8)}</span>
        <ExecutionStatusBadge status={exec.status} />
        <span className="text-xs text-text-muted ml-auto">
          {exec.started_at} → {exec.finished_at ?? '…'}
        </span>
      </div>

      {/* Step progress */}
      <div className="space-y-2">
        {exec.steps?.map((step) => (
          <div key={step.id} className="flex items-center gap-3 px-3 py-2 rounded-md bg-bg-subtle text-xs">
            <StepStatusDot status={step.status} />
            <span className="font-mono text-text-primary">{step.name}</span>
            {step.duration_ms && (
              <span className="text-text-muted ml-auto">{step.duration_ms}ms</span>
            )}
          </div>
        ))}
      </div>

      {/* Result */}
      {exec.result && (
        <div>
          <p className="text-xs text-text-muted mb-1.5">Output</p>
          <JsonViewer data={exec.result} />
        </div>
      )}
    </div>
  );
};

const ExecutionStatusBadge: React.FC<{ status: string }> = ({ status }) => {
  const variants = {
    pending:   'warning',
    running:   'info',
    completed: 'success',
    failed:    'danger',
  } as const;
  return <Badge variant={variants[status as keyof typeof variants] ?? 'default'}>{status}</Badge>;
};
```

---

### 6.5 Conversation Thread Manager

**Route**: `/conversations`  
**APIs**: `GET /api/conversations`, `GET /api/conversations/{id}`, `GET /api/conversations/{id}/history`, `DELETE /api/conversations/{id}`

#### Layout

Left: searchable conversation list with metadata (model, message count, last activity). Right: full history timeline with message + tool-call entries.

#### HistoryTimeline (`src/features/conversations/HistoryTimeline.tsx`)

```typescript
import { useQuery } from '@tanstack/react-query';
import { conversationsApi } from '../../api/conversations';
import { QK } from '../../lib/queryKeys';
import { Virtuoso } from 'react-virtuoso';
import { MessageBubble } from '../chat/MessageBubble';
import { ToolCallBlock } from '../chat/ToolCallBlock';
import type { HistoryEntry } from '../../types';

export const HistoryTimeline: React.FC<{ conversationId: string }> = ({ conversationId }) => {
  const { data: history = [], isLoading } = useQuery({
    queryKey: QK.history(conversationId),
    queryFn:  () => conversationsApi.history(conversationId).then(r => r.data),
  });

  if (isLoading) return <div className="p-8 text-center text-text-muted text-sm">Loading history…</div>;

  return (
    <Virtuoso
      data={history}
      style={{ height: '100%' }}
      itemContent={(_, entry: HistoryEntry) =>
        entry.type === 'message' ? (
          <div className="px-4 py-2">
            <MessageBubble message={entry.message} />
          </div>
        ) : (
          <div className="px-4 py-1">
            <ToolCallBlock toolCall={entry.tool_call} />
          </div>
        )
      }
    />
  );
};
```

---

### 6.6 MCP Server Registry

**Route**: `/mcp`  
**APIs**: `GET/POST /servers`, `POST /execute/{server}/{tool}`, `POST /health-check`

#### Layout

Grid of server cards + a register-server modal + a health-check status panel.

#### RegisterServerModal (`src/features/mcp/RegisterServerModal.tsx`)

```typescript
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { mcpApi } from '../../api/docker/mcp';
import { QK } from '../../lib/queryKeys';
import { Modal, Input, Button } from '../../components/ui';

const schema = z.object({
  name:        z.string().min(1),
  url:         z.string().url('Must be a valid URL'),
  description: z.string().optional(),
});

export const RegisterServerModal: React.FC<{ open: boolean; onClose: () => void }> = ({ open, onClose }) => {
  const qc = useQueryClient();
  const { register, handleSubmit, formState: { errors }, reset } = useForm({
    resolver: zodResolver(schema),
  });

  const mutation = useMutation({
    mutationFn: (data: z.infer<typeof schema>) => mcpApi.register(data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: QK.mcpServers() });
      reset();
      onClose();
    },
  });

  return (
    <Modal open={open} onClose={onClose} title="Register MCP Server">
      <form onSubmit={handleSubmit((d) => mutation.mutate(d))} className="space-y-4">
        <div>
          <label className="block text-xs text-text-muted mb-1">Server name</label>
          <Input {...register('name')} placeholder="e.g. github-mcp" />
          {errors.name && <p className="text-xs text-accent-danger mt-1">{errors.name.message}</p>}
        </div>
        <div>
          <label className="block text-xs text-text-muted mb-1">Endpoint URL</label>
          <Input {...register('url')} placeholder="https://mcp.example.com/rpc" />
          {errors.url && <p className="text-xs text-accent-danger mt-1">{errors.url.message}</p>}
        </div>
        <div>
          <label className="block text-xs text-text-muted mb-1">Description (optional)</label>
          <Input {...register('description')} placeholder="What does this server provide?" />
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onClose} className="text-sm text-text-muted hover:text-text-secondary">Cancel</button>
          <Button type="submit" loading={mutation.isPending}>Register</Button>
        </div>
      </form>
    </Modal>
  );
};
```

#### HealthCheckPanel (`src/features/mcp/HealthCheckPanel.tsx`)

```typescript
import { useMutation, useQuery } from '@tanstack/react-query';
import { mcpApi } from '../../api/docker/mcp';
import { StatusDot } from '../../components/ui/StatusDot';

export const HealthCheckPanel = () => {
  const ping = useMutation({
    mutationFn: () => mcpApi.healthCheck().then(r => r.data),
  });

  return (
    <div className="p-4 border border-border-faint rounded-xl space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium text-text-secondary">MCP Connectivity</p>
        <button
          onClick={() => ping.mutate()}
          disabled={ping.isPending}
          className="text-xs text-accent-electric hover:text-accent-electric/80 transition-colors"
        >
          {ping.isPending ? 'Checking…' : 'Run health check'}
        </button>
      </div>
      {ping.data && (
        <div className="space-y-1.5">
          {Object.entries(ping.data).map(([server, status]: [string, any]) => (
            <div key={server} className="flex items-center gap-2 text-xs">
              <StatusDot status={status.reachable ? 'online' : 'offline'} />
              <span className="font-mono text-text-primary">{server}</span>
              {status.latency_ms && (
                <span className="text-text-muted ml-auto">{status.latency_ms}ms</span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
```

---

### 6.7 System Health Monitor

**Route**: `/health`  
**APIs**: `GET /health` (8000), `GET /health` (9000), `POST /health-check` (MCP)

```typescript
// src/features/health/HealthDashboard.tsx
import { useQuery } from '@tanstack/react-query';
import { healthApi } from '../../api/health';
import { QK } from '../../lib/queryKeys';
import { ServiceCard } from './ServiceCard';
import { McpConnectivityMap } from './McpConnectivityMap';
import { motion } from 'framer-motion';

export const HealthDashboard = () => {
  const { data: h8k, isError: e8k } = useQuery({
    queryKey: QK.health8k(),
    queryFn:  () => healthApi.orchestrator(),
    refetchInterval: 15_000,
  });

  const { data: h9k, isError: e9k } = useQuery({
    queryKey: QK.health9k(),
    queryFn:  () => healthApi.dockerTool(),
    refetchInterval: 15_000,
  });

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-6">
      <div>
        <h1 className="font-display text-lg font-600 text-text-primary">System Health</h1>
        <p className="text-sm text-text-secondary mt-0.5">Live status of all microservices</p>
      </div>

      <motion.div
        className="grid grid-cols-2 gap-4"
        variants={{ visible: { transition: { staggerChildren: 0.06 } } }}
        initial="hidden" animate="visible"
      >
        <ServiceCard
          label="Backend Orchestrator"
          port={8000}
          data={h8k}
          error={e8k}
        />
        <ServiceCard
          label="Docker Tool Service"
          port={9000}
          data={h9k}
          error={e9k}
        />
      </motion.div>

      <McpConnectivityMap />
    </div>
  );
};
```

---

## 7. Shared Components

### 7.1 Button (`src/components/ui/Button.tsx`)

```typescript
import { forwardRef } from 'react';
import { cn } from '../../lib/utils';
import { Spinner } from './Spinner';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'ghost' | 'danger' | 'success';
  size?:    'sm' | 'md' | 'lg';
  loading?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = 'primary', size = 'md', loading, disabled, children, ...props }, ref) => {
    const variants = {
      primary: 'bg-accent-electric text-bg-base hover:bg-accent-electric/90 border-transparent',
      ghost:   'bg-transparent border-border-default text-text-secondary hover:bg-bg-hover hover:text-text-primary',
      danger:  'bg-transparent border-accent-danger/30 text-accent-danger hover:bg-surface-danger',
      success: 'bg-transparent border-accent-success/30 text-accent-success hover:bg-surface-success',
    };
    const sizes = {
      sm: 'px-2.5 py-1 text-xs rounded-md',
      md: 'px-3.5 py-1.5 text-sm rounded-lg',
      lg: 'px-5 py-2 text-sm rounded-lg',
    };

    return (
      <button
        ref={ref}
        disabled={disabled || loading}
        className={cn(
          'inline-flex items-center gap-2 font-medium border transition-all duration-150',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus',
          'disabled:opacity-50 disabled:cursor-not-allowed',
          variants[variant],
          sizes[size],
          className,
        )}
        {...props}
      >
        {loading && <Spinner size={12} />}
        {children}
      </button>
    );
  }
);
Button.displayName = 'Button';
```

### 7.2 Badge (`src/components/ui/Badge.tsx`)

```typescript
import { cn } from '../../lib/utils';

type Variant = 'default' | 'info' | 'success' | 'warning' | 'danger' | 'purple';

const variantClasses: Record<Variant, string> = {
  default: 'bg-bg-subtle text-text-secondary border-border-default',
  info:    'bg-surface-info text-accent-electric border-accent-electric/25',
  success: 'bg-surface-success text-accent-success border-accent-success/25',
  warning: 'bg-surface-warning text-accent-amber border-accent-amber/25',
  danger:  'bg-surface-danger text-accent-danger border-accent-danger/25',
  purple:  'bg-surface-purple text-accent-purple border-accent-purple/25',
};

export const Badge: React.FC<{ variant?: Variant; className?: string; children: React.ReactNode }> = ({
  variant = 'default', className, children,
}) => (
  <span className={cn(
    'inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium border',
    variantClasses[variant],
    className,
  )}>
    {children}
  </span>
);
```

### 7.3 CodeBlock (`src/components/ui/CodeBlock.tsx`)

Uses CodeMirror 6 with Python and JSON language support.

```typescript
import { useEffect, useRef } from 'react';
import { EditorView, basicSetup } from 'codemirror';
import { python } from '@codemirror/lang-python';
import { json } from '@codemirror/lang-json';
import { oneDark } from '@codemirror/theme-one-dark';
import { EditorState } from '@codemirror/state';

const langMap: Record<string, any> = { python, json };

export const CodeBlock: React.FC<{
  code: string;
  language?: 'python' | 'json';
  maxHeight?: number;
  readOnly?: boolean;
}> = ({ code, language = 'python', maxHeight = 360, readOnly = true }) => {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!ref.current) return;
    const view = new EditorView({
      state: EditorState.create({
        doc: code,
        extensions: [
          basicSetup,
          langMap[language]?.() ?? [],
          oneDark,
          EditorView.editable.of(!readOnly),
          EditorView.theme({
            '&': { fontSize: '12px', background: 'transparent' },
            '.cm-scroller': { fontFamily: 'JetBrains Mono, monospace', maxHeight: `${maxHeight}px`, overflow: 'auto' },
            '.cm-gutters': { background: 'transparent', border: 'none' },
            '.cm-content': { padding: '12px 0' },
          }),
        ],
      }),
      parent: ref.current,
    });
    return () => view.destroy();
  }, [code, language]);

  return (
    <div
      ref={ref}
      className="rounded-lg overflow-hidden border border-border-faint bg-[#1a1d21]"
    />
  );
};
```

### 7.4 JsonViewer (`src/components/ui/JsonViewer.tsx`)

```typescript
import { useState } from 'react';
import { cn } from '../../lib/utils';

export const JsonViewer: React.FC<{ data: unknown; depth?: number }> = ({ data, depth = 0 }) => {
  const [collapsed, setCollapsed] = useState(depth > 1);

  if (data === null) return <span className="text-text-muted font-mono text-xs">null</span>;
  if (typeof data !== 'object') {
    const color = typeof data === 'string' ? 'text-accent-success' : 'text-accent-amber';
    const val = typeof data === 'string' ? `"${data}"` : String(data);
    return <span className={cn('font-mono text-xs', color)}>{val}</span>;
  }

  const isArray = Array.isArray(data);
  const entries = isArray
    ? (data as unknown[]).map((v, i) => [i, v])
    : Object.entries(data as Record<string, unknown>);

  const open = isArray ? '[' : '{';
  const close = isArray ? ']' : '}';

  if (entries.length === 0) return <span className="font-mono text-xs text-text-muted">{open}{close}</span>;

  return (
    <span>
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="font-mono text-xs text-text-secondary hover:text-text-primary"
      >
        {open}
        {collapsed && <span className="text-text-muted"> … {close}</span>}
      </button>
      {!collapsed && (
        <div className="pl-4">
          {entries.map(([key, val]) => (
            <div key={String(key)} className="flex gap-1.5 text-xs">
              {!isArray && <span className="font-mono text-accent-electric">"{String(key)}"</span>}
              {!isArray && <span className="text-text-muted">:</span>}
              <JsonViewer data={val} depth={depth + 1} />
            </div>
          ))}
        </div>
      )}
      {!collapsed && <span className="font-mono text-xs text-text-secondary">{close}</span>}
    </span>
  );
};
```

### 7.5 Toast System (`src/components/ui/Toast.tsx`)

```typescript
import { AnimatePresence, motion } from 'framer-motion';
import { CheckCircle, AlertCircle, Info, XCircle, X } from 'lucide-react';
import { useUIStore } from '../../store';

const icons = {
  success: <CheckCircle size={14} className="text-accent-success" />,
  error:   <XCircle    size={14} className="text-accent-danger"  />,
  warning: <AlertCircle size={14} className="text-accent-amber"  />,
  info:    <Info        size={14} className="text-accent-electric"/>,
};

export const ToastStack = () => {
  const { toasts, dismiss } = useUIStore();

  return (
    <div
      className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 pointer-events-none"
      aria-live="polite"
    >
      <AnimatePresence>
        {toasts.map((toast) => (
          <motion.div
            key={toast.id}
            initial={{ opacity: 0, y: 16, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.95 }}
            transition={{ duration: 0.18 }}
            className="pointer-events-auto flex items-center gap-2.5 px-3.5 py-2.5 bg-bg-overlay border border-border-default rounded-xl shadow-modal min-w-64 max-w-sm"
          >
            {icons[toast.type]}
            <p className="text-sm text-text-primary flex-1">{toast.message}</p>
            <button
              onClick={() => dismiss(toast.id)}
              className="text-text-muted hover:text-text-secondary p-0.5"
              aria-label="Dismiss"
            >
              <X size={12} />
            </button>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
};
```

---

## 8. Real-Time & Streaming

### 8.1 StreamingCursor

```typescript
// src/features/chat/StreamingCursor.tsx
export const StreamingCursor = () => (
  <span
    className="inline-block w-[2px] h-[13px] bg-current ml-0.5 align-middle animate-pulse-dot"
    aria-hidden="true"
  />
);
```

### 8.2 Pending Tool Poll

The `PendingApprovals` component already uses `refetchInterval: 5_000`. To signal new approvals across the app, use React Query's `queryClient.invalidateQueries` inside mutation `onSuccess` callbacks.

### 8.3 Workflow Execution Polling

The `ExecutionPanel` uses a dynamic `refetchInterval` that runs every 2 seconds while status is `running` and stops when `completed` or `failed`:

```typescript
refetchInterval: (query) =>
  ['pending', 'running'].includes(query.state.data?.status ?? '')
    ? 2_000
    : false,
```

---

## 9. Accessibility

### 9.1 Requirements

- All interactive elements are keyboard-navigable and have visible focus rings (`ring-2 ring-border-focus`).
- `aria-live="polite"` on the Toast stack for screen reader announcements.
- `role="dialog"` and `aria-modal="true"` on all modals (via Radix `@radix-ui/react-dialog`).
- Streaming messages use `aria-label` on the container to announce "Response streaming" then "Response complete".
- Color is never the sole differentiator — status dots include a text label, badges include icon + text.
- Sidebar collapse/expand button has `aria-label` and `aria-expanded`.
- Keyboard shortcut `Cmd+K` opens the command palette; `Esc` dismisses it.

### 9.2 Focus Management

Use `@radix-ui/react-dialog`'s built-in focus trap for modals. Return focus to the trigger element on close.

```typescript
// Modal wrapper using Radix Dialog
import * as Dialog from '@radix-ui/react-dialog';

export const Modal: React.FC<{
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
}> = ({ open, onClose, title, children }) => (
  <Dialog.Root open={open} onOpenChange={(o) => !o && onClose()}>
    <Dialog.Portal>
      <Dialog.Overlay className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm animate-fade-in" />
      <Dialog.Content
        className="fixed z-50 left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-lg bg-bg-overlay border border-border-default rounded-xl shadow-modal animate-slide-up p-0 outline-none"
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-border-faint">
          <Dialog.Title className="text-sm font-medium text-text-primary">{title}</Dialog.Title>
          <Dialog.Close className="text-text-muted hover:text-text-secondary p-1">
            <X size={14} />
          </Dialog.Close>
        </div>
        <div className="p-5">{children}</div>
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>
);
```

---

## 10. Performance

### 10.1 Code Splitting

Every feature module is lazy-loaded via `React.lazy()`. Each lazy boundary has a skeleton fallback (`<PageSkeleton />`).

### 10.2 Virtualised Lists

All long lists (conversation history, agent list > 50 items, tool registry) use `react-virtuoso`:
```typescript
import { Virtuoso } from 'react-virtuoso';
<Virtuoso data={items} itemContent={(_, item) => <ItemRow item={item} />} style={{ height: '100%' }} />
```

### 10.3 Deferred State for Search

```typescript
const [q, setQ] = useState('');
const deferred = useDeferredValue(q);
// Pass `deferred` to the query, `q` to the input — UI stays responsive
```

### 10.4 Query Caching

- Agent list: `staleTime: 60_000` — minimal refetches during a session.
- Pending tools: `refetchInterval: 5_000` while the tab is open.
- Health: `refetchInterval: 15_000`.
- Conversation history: no auto-refetch (stable data).

### 10.5 Bundle Optimisation (Vite)

```typescript
// vite.config.ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          react:      ['react', 'react-dom', 'react-router-dom'],
          tanstack:   ['@tanstack/react-query'],
          framer:     ['framer-motion'],
          reactflow:  ['reactflow'],
          codemirror: ['codemirror', '@codemirror/lang-python', '@codemirror/lang-json'],
          radix:      Object.keys(require('./package.json').dependencies)
                            .filter((k) => k.startsWith('@radix-ui')),
        },
      },
    },
  },
});
```

---

## 11. Testing Strategy

### 11.1 Unit Tests (Vitest + Testing Library)

```typescript
// src/features/agents/__tests__/AgentEditor.test.tsx
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { queryClient } from '../../../lib/queryClient';
import { AgentEditor } from '../AgentEditor';
import { server } from '../../../mocks/server';
import { http, HttpResponse } from 'msw';

beforeAll(() => server.listen());
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const Wrapper: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <QueryClientProvider client={queryClient}>
    <MemoryRouter>{children}</MemoryRouter>
  </QueryClientProvider>
);

test('creates an agent and navigates to detail', async () => {
  server.use(
    http.post('http://localhost:8000/api/agents', () =>
      HttpResponse.json({ id: 'new-id', name: 'Test Agent', model: 'mistral-large-latest' })
    )
  );

  render(<AgentEditor />, { wrapper: Wrapper });

  await userEvent.type(screen.getByPlaceholderText(/e\.g\. Code Reviewer/), 'Test Agent');
  await userEvent.click(screen.getByRole('button', { name: /Create Agent/ }));

  await waitFor(() => {
    expect(window.location.pathname).toBe('/agents/new-id');
  });
});
```

### 11.2 MSW Mock Handlers

```typescript
// src/mocks/handlers.ts
import { http, HttpResponse } from 'msw';

export const handlers = [
  http.get('http://localhost:8000/api/agents', () =>
    HttpResponse.json({ items: [], page: 1, total_pages: 1 })
  ),
  http.get('http://localhost:8000/health', () =>
    HttpResponse.json({ status: 'ok', docker_tool_service: 'reachable' })
  ),
  http.post('http://localhost:9000/synthesize', () =>
    HttpResponse.json({ tool_id: 'tool-abc', code: 'def run(): pass', lint_status: 'clean', sandbox_status: 'passed' })
  ),
  // Add all routes…
];
```

### 11.3 Coverage Targets

| Layer           | Target |
|-----------------|--------|
| API modules     | 95%    |
| Custom hooks    | 90%    |
| UI components   | 80%    |
| Feature pages   | 70%    |

---

## 12. Deployment

### 12.1 Environment Variables

```bash
# .env.production
VITE_ORCHESTRATOR_URL=https://api.your-domain.com     # Port 8000 proxy
VITE_DOCKER_TOOL_URL=https://tools.your-domain.com    # Port 9000 proxy
```

### 12.2 Docker

```dockerfile
# Dockerfile
FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM nginx:alpine
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
```

```nginx
# nginx.conf
server {
  listen 80;
  root /usr/share/nginx/html;
  index index.html;

  location / {
    try_files $uri $uri/ /index.html;
  }

  # Proxy SSE streams — disable buffering
  location /api/orchestrate/stream {
    proxy_pass         http://orchestrator:8000;
    proxy_buffering    off;
    proxy_cache        off;
    proxy_set_header   X-Accel-Buffering no;
    proxy_read_timeout 300s;
  }

  location /api/ {
    proxy_pass http://orchestrator:8000;
  }
}
```

### 12.3 Docker Compose

```yaml
# docker-compose.yml
services:
  frontend:
    build: .
    ports:
      - "3000:80"
    environment:
      - VITE_ORCHESTRATOR_URL=http://orchestrator:8000
      - VITE_DOCKER_TOOL_URL=http://docker-tool:9000
    depends_on:
      - orchestrator

  orchestrator:
    image: mistral-orchestrator:latest
    ports:
      - "8000:8000"

  docker-tool:
    image: mistral-docker-tool:latest
    ports:
      - "9000:9000"
```

### 12.4 Pre-deployment Checklist

- [ ] All feature routes load without errors in production build (`npm run build && npm run preview`)
- [ ] SSE streams work through the Nginx proxy (check `proxy_buffering off`)
- [ ] `VITE_ORCHESTRATOR_URL` and `VITE_DOCKER_TOOL_URL` are set correctly in the build environment
- [ ] `Content-Security-Policy` header allows `connect-src` for both API origins
- [ ] Health endpoints are reachable from the frontend origin (no CORS issues)
- [ ] Lighthouse score ≥ 90 on Performance, Accessibility, Best Practices
- [ ] All pending tool approvals UI tested with a human reviewer walk-through
- [ ] Streaming chat tested across Chrome, Firefox, and Safari (SSE compatibility)

---

*End of specification — 12 sections, 16 API features, production-grade implementation guidance.*
