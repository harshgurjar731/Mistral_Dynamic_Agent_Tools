import { get, post } from "./client";

/**
 * Background runs — creation pipelines that keep going when the page that
 * started them is closed. Start one, then follow `/api/runs/{id}/events`.
 */
export type RunKind = "workflow_plan" | "agent" | "tool_synthesis" | "activity_synthesis";
export type RunStatus = "running" | "completed" | "failed" | "cancelled" | "interrupted";

export interface RunProgress {
  total: number;
  done: number;
  label?: string | null | undefined;
  note?: string | null | undefined;
}

export interface BackgroundRun {
  id: string;
  kind: RunKind;
  title: string;
  status: RunStatus;
  request: Record<string, unknown>;
  result: Record<string, unknown> | null;
  error: string | null;
  progress: RunProgress;
  last_seq: number;
  created_at: string | null;
  updated_at: string | null;
  finished_at: string | null;
}

export interface AgentRunRequest {
  query: string;
  tier?: string | undefined;
  agent_id?: string | undefined;
  conversation_id?: string | undefined;
  image_base64?: string | undefined;
  image_mime?: string | undefined;
}

export const runsApi = {
  list: (params: { status?: string; kind?: string; limit?: number } = {}) =>
    get<{ runs: BackgroundRun[] }>("/api/runs", params),
  get: (id: string) => get<BackgroundRun>(`/api/runs/${id}`),
  cancel: (id: string) => post<{ cancelled: boolean; status: string }>(`/api/runs/${id}/cancel`),
  startWorkflowPlan: (goal: string) => post<BackgroundRun>("/api/runs/workflow-plan", { goal }),
  startAgent: (body: AgentRunRequest) => post<BackgroundRun>("/api/runs/agent", body),
  startSynthesis: (task: string, purpose: "tool" | "activity") =>
    post<BackgroundRun>("/api/runs/synthesis", { task, purpose }),
};

export const eventsUrl = (id: string, after: number) => `/api/runs/${id}/events?after=${after}`;

export const isTerminal = (status: RunStatus | undefined) =>
  status !== undefined && status !== "running";
