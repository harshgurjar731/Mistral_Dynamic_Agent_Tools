import { api } from './client';

/**
 * Workflow execution API.
 *
 * Mirrors the Mistral Workflow Executions API
 * (https://docs.mistral.ai/api/endpoint/workflows/executions) as proxied by the
 * backend, which merges server-side executions with local DAG-engine runs and
 * tags each with `source`.
 */

// ── Status ────────────────────────────────────────────────────────────────────

export const EXECUTION_STATUSES = [
  'PENDING',
  'RUNNING',
  'RETRYING_AFTER_ERROR',
  'COMPLETED',
  'FAILED',
  'CANCELLED',
  'TERMINATED',
  'TIMED_OUT',
  'CONTINUED_AS_NEW',
] as const;

export type ExecutionStatus = (typeof EXECUTION_STATUSES)[number];

/** States after which no further updates will arrive. */
export const TERMINAL_STATUSES: ReadonlySet<string> = new Set([
  'COMPLETED', 'FAILED', 'CANCELLED', 'TERMINATED', 'TIMED_OUT', 'CONTINUED_AS_NEW',
]);

/** States where the execution is still doing work and can be controlled. */
export const ACTIVE_STATUSES: ReadonlySet<string> = new Set([
  'PENDING', 'RUNNING', 'RETRYING_AFTER_ERROR',
]);

export const isTerminal = (status?: string | null) =>
  TERMINAL_STATUSES.has((status ?? '').toUpperCase());

export const isActive = (status?: string | null) =>
  ACTIVE_STATUSES.has((status ?? '').toUpperCase());

// ── Shapes ────────────────────────────────────────────────────────────────────

export interface ExecutionStep {
  id: string;
  name: string;
  /** RUNNING | COMPLETED | FAILED */
  status: string;
  start_time_ms?: number | null;
  end_time_ms?: number | null;
  duration_ms?: number | null;
  error?: string | null;
  internal?: boolean;
  attributes?: Record<string, unknown>;
  input_preview?: string | null;
  output_preview?: string | null;
  parallel_group?: string | null;
}

export interface ExecutionDetail {
  execution_id: string;
  workflow_name: string;
  status: string;
  start_time?: string | null;
  end_time?: string | null;
  result?: unknown;
  error?: string | null;
  root_execution_id?: string | null;
  parent_execution_id?: string | null;
  run_id?: string | null;
  user_id?: string | null;
  deployment_name?: string | null;
  total_duration_ms?: number | null;
  source: 'mistral' | 'local';
  steps: ExecutionStep[];
}

export interface ExecutionSummary {
  execution_id: string;
  workflow_name: string;
  status: string;
  start_time?: string | null;
  end_time?: string | null;
  total_duration_ms?: number | null;
  run_id?: string | null;
  root_execution_id?: string | null;
  parent_execution_id?: string | null;
  user_id?: string | null;
  source: 'mistral' | 'local';
}

export interface ExecutionListResponse {
  executions: ExecutionSummary[];
  next_page_token?: string | null;
  count: number;
  remote_available: boolean;
}

export interface TraceSpan {
  span_id: string;
  name: string;
  start_time_unix_nano: number;
  end_time_unix_nano?: number | null;
  attributes?: Record<string, unknown>;
  events?: Array<Record<string, unknown>>;
  children?: TraceSpan[] | null;
}

export interface TraceSummary {
  workflow_name?: string;
  execution_id?: string;
  status?: string;
  start_time?: string | null;
  end_time?: string | null;
  total_duration_ms?: number | null;
  span_tree?: TraceSpan | null;
}

export interface TraceEvent {
  id: string;
  name: string;
  type: string;
  timestamp_unix_nano: number;
  internal?: boolean;
  status?: string;
  error?: string | null;
  start_time_unix_ms?: number;
  end_time_unix_ms?: number | null;
  attributes?: Record<string, unknown>;
}

export interface TraceEventsResponse {
  execution_id?: string;
  status?: string;
  events: TraceEvent[];
}

/** One captured line from the engine's own narration of a run. */
export interface LogLine {
  seq: number;
  timestamp: string;
  level: 'DEBUG' | 'INFO' | 'WARNING' | 'ERROR' | 'CRITICAL' | string;
  logger: string;
  message: string;
  step_id?: string | null;
}

export interface ExecutionLogsResponse {
  execution_id: string;
  logs: LogLine[];
  /** Logs from the Mistral platform, when the execution ran server-side. */
  platform_logs: unknown[];
  next_seq: number;
  source: 'local' | 'mistral' | 'none';
  detail?: string;
}

export interface WorkflowMetrics {
  execution_count?: number | null;
  success_count?: number | null;
  error_count?: number | null;
  average_latency_ms?: number | null;
  latency_over_time?: unknown;
  retry_rate?: number | null;
  available?: boolean;
  detail?: string;
}

export interface ListExecutionsParams {
  workflow_identifier?: string;
  status?: string;
  search?: string;
  user_id?: string;
  page_size?: number;
  next_page_token?: string;
}

const base = '/api/workflows/executions';

export const executionsApi = {
  // ── Reads ───────────────────────────────────────────────────────────────
  list: (params: ListExecutionsParams = {}) =>
    api.get<ExecutionListResponse>(base, { params }),

  get: (id: string, withSteps = true) =>
    api.get<ExecutionDetail>(`${base}/${id}`, { params: { with_steps: withSteps } }),

  steps: (id: string, includeInternal = false) =>
    api.get<{ execution_id: string; steps: ExecutionStep[] }>(`${base}/${id}/steps`, {
      params: { include_internal: includeInternal },
    }),

  history: (id: string, decodePayloads = true) =>
    api.get<{ execution_id: string; history: unknown }>(`${base}/${id}/history`, {
      params: { decode_payloads: decodePayloads },
    }),

  // ── Trace / observability ───────────────────────────────────────────────
  traceInfo: (id: string) => api.get(`${base}/${id}/trace/info`),

  traceSummary: (id: string) => api.get<TraceSummary>(`${base}/${id}/trace/summary`),

  traceEvents: (id: string, opts: { merge?: boolean; includeInternal?: boolean } = {}) =>
    api.get<TraceEventsResponse>(`${base}/${id}/trace/events`, {
      params: {
        merge_same_id_events: opts.merge ?? true,
        include_internal_events: opts.includeInternal ?? false,
      },
    }),

  traceOtel: (id: string) => api.get(`${base}/${id}/trace/otel`),

  /** `since` makes this pollable — pass back the previous `next_seq`. */
  logs: (id: string, opts: { limit?: number; since?: number } = {}) =>
    api.get<ExecutionLogsResponse>(`${base}/${id}/logs`, {
      params: { limit: opts.limit ?? 500, since: opts.since ?? 0 },
    }),

  // ── Control ─────────────────────────────────────────────────────────────
  signal: (id: string, name: string, input: Record<string, unknown> = {}) =>
    api.post<{ delivered: boolean; detail?: string }>(`${base}/${id}/signals`, { name, input }),

  query: (id: string, name: string, input: Record<string, unknown> = {}) =>
    api.post<{ result: unknown }>(`${base}/${id}/queries`, { name, input }),

  update: (id: string, name: string, input: Record<string, unknown> = {}) =>
    api.post<{ result: unknown }>(`${base}/${id}/updates`, { name, input }),

  cancel: (id: string) => api.post(`${base}/${id}/cancel`),

  terminate: (id: string) => api.post(`${base}/${id}/terminate`),

  reset: (
    id: string,
    body: { event_id: number; reason?: string; exclude_signals?: boolean; exclude_updates?: boolean },
  ) => api.post(`${base}/${id}/reset`, body),

  batchCancel: (ids: string[]) => api.post(`${base}/cancel`, { execution_ids: ids }),

  batchTerminate: (ids: string[]) => api.post(`${base}/terminate`, { execution_ids: ids }),

  // ── Per-workflow ────────────────────────────────────────────────────────
  metrics: (workflowName: string, range?: { start_time?: string; end_time?: string }) =>
    api.get<WorkflowMetrics>(`/api/workflows/${workflowName}/metrics`, { params: range }),

  /** SSE endpoint path — consume with `useExecutionStream`, not axios. */
  streamUrl: (id: string) => `${base}/${id}/stream`,
};

// ── Formatting helpers ────────────────────────────────────────────────────────

export function formatDuration(ms?: number | null): string {
  if (ms == null || Number.isNaN(ms)) return '—';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const minutes = Math.floor(ms / 60_000);
  const seconds = Math.round((ms % 60_000) / 1000);
  if (minutes < 60) return `${minutes}m ${seconds}s`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

/**
 * Wall-clock duration for an execution.
 *
 * Prefers the server's `total_duration_ms` and falls back to the timestamps,
 * measuring against "now" while the run is still going so the UI can tick.
 */
export function executionDuration(
  execution: Pick<ExecutionDetail, 'start_time' | 'end_time' | 'total_duration_ms' | 'status'>,
  now = Date.now(),
): number | null {
  if (execution.total_duration_ms != null) return execution.total_duration_ms;
  if (!execution.start_time) return null;
  const started = new Date(execution.start_time).getTime();
  if (Number.isNaN(started)) return null;
  const ended = execution.end_time ? new Date(execution.end_time).getTime() : now;
  return Math.max(0, ended - started);
}

export function formatTimestamp(value?: string | null): string {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString();
}
