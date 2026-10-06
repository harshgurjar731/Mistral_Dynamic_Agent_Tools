import { get } from "./client";

/*
 * Traces of everything the backend does, read back from Mistral
 * Observability (see backend/app/routes/observability.py). One trace per
 * action — an API request, a workflow execution, a background run.
 */

export type TraceKind = "workflow" | "run" | "pipeline" | "http" | "llm" | "other";

/** step · rule · tool · llm · layer · pipeline · workflow · run · http · agent … */
export type SpanKind = string;

export type RuleVerdict = "pass" | "fixed" | "warn" | "fail";

export interface TraceRow {
  trace_id: string;
  name: string;
  kind: TraceKind;
  workflow_name: string | null;
  conversation_id: string | null;
  agent_name: string | null;
  agent_id: string | null;
  service_name: string;
  environment: string | null;
  start_time: string | null;
  end_time: string | null;
  duration_ms: number | null;
  status_code: string;
  error_count: number;
  span_count: number;
  llm_call_count: number;
  tool_call_count: number;
  retrieval_count: number;
  input_tokens: number;
  output_tokens: number;
  models_used: string[];
  tools_used: string[];
  first_input: string | null;
  last_output: string | null;
  console_url: string;
}

export interface SpanRow {
  span_id: string;
  parent_span_id: string | null;
  name: string;
  kind: SpanKind;
  span_kind: string;
  start_time: string | null;
  end_time: string | null;
  duration_ms: number | null;
  status_code: string;
  status_message: string | null;
  error_type: string | null;
  service_name: string;
  operation_name: string | null;
  model: string | null;
  provider: string | null;
  agent_id: string | null;
  agent_name: string | null;
  conversation_id: string | null;
  workflow_name: string | null;
  tool_name: string | null;
  tool_call_arguments: string | null;
  tool_call_result: string | null;
  input_messages: string | null;
  output_messages: string | null;
  system_instructions: string | null;
  usage: { input_tokens: number; output_tokens: number; cache_read_input_tokens: number };
  finish_reasons: string[];
  temperature: number | null;
  attributes: Record<string, string>;
  resource: Record<string, string>;
  scope: string | null;
}

export interface RuleVerdictRow {
  trace_id: string | null;
  span_id: string;
  parent_span_id: string | null;
  time: string | null;
  rule_id: string | null;
  rule_name: string;
  verdict: RuleVerdict | null;
  outcome: string | null;
  checkpoint: string | null;
  message: string | null;
  detail: string | null;
  scope: string | null;
  subject_id: string | null;
  execution_id: string | null;
  step_id: string | null;
  workflow_name: string | null;
  conversation_id: string | null;
}

export interface TraceDetail {
  trace: TraceRow;
  root: SpanRow | null;
  spans: SpanRow[];
  rules: RuleVerdictRow[];
  rule_counts: Record<RuleVerdict, number>;
  execution_id: string | null;
  truncated: boolean;
}

export interface Feed<T> {
  items: T[];
  cursor: string | null;
  has_more: boolean;
}

export interface ObservabilityStatus {
  enabled: boolean;
  service_name: string;
  environment: string;
  redaction: boolean;
  endpoint: string;
  console_url: string;
}

export interface TraceQuery {
  kind?: TraceKind | "" | undefined;
  workflow?: string | undefined;
  status?: "error" | "ok" | "" | undefined;
  q?: string | undefined;
  hours?: number | undefined;
  page_size?: number | undefined;
  cursor?: string | undefined;
}

export interface RuleQuery {
  verdict?: RuleVerdict | "" | undefined;
  rule?: string | undefined;
  workflow?: string | undefined;
  hours?: number | undefined;
  cursor?: string | undefined;
}

/** Drop empty filters so they are not sent as `?kind=`. */
function params(q: object): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(q).filter(([, v]) => v !== undefined && v !== null && v !== ""),
  );
}

export const observabilityApi = {
  status: () => get<ObservabilityStatus>("/api/observability/status"),
  traces: (q: TraceQuery) => get<Feed<TraceRow>>("/api/observability/traces", params(q)),
  trace: (traceId: string) => get<TraceDetail>(`/api/observability/traces/${traceId}`),
  executionTrace: (executionId: string) =>
    get<TraceDetail>(`/api/observability/executions/${encodeURIComponent(executionId)}`),
  rules: (q: RuleQuery) => get<Feed<RuleVerdictRow>>("/api/observability/rules", params(q)),
  workflows: () => get<{ workflows: string[] }>("/api/observability/workflows"),
};
