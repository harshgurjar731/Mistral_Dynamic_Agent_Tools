import type { RebuildRequest } from "@/types";
import type { ProcessKnowledgeRequest } from "./processes";
import { get, post } from "./client";

/**
 * Background runs — creation pipelines that keep going when the page that
 * started them is closed. Start one, then follow `/api/runs/{id}/events`.
 */
export type RunKind =
  | "workflow_plan"
  | "agent"
  | "tool_synthesis"
  | "activity_synthesis"
  | "workflow_refine"
  | "workflow_verify"
  | "agent_evaluate";
export type RunStatus = "running" | "completed" | "failed" | "cancelled" | "interrupted";

export interface RunProgress {
  total: number;
  done: number;
  /** 0–1: finished layers plus the running layer's measured share. */
  fraction?: number | undefined;
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

export interface WorkflowRefineRequest {
  workflow_name: string;
  instruction: string;
  focus_step_ids?: string[];
  origin?: "editor" | "planner";
  /** The failed run to fix; omitted: the latest run, when it failed. */
  execution_id?: string;
}

export interface AgentRunRequest {
  query: string;
  tier?: string | undefined;
  agent_id?: string | undefined;
  conversation_id?: string | undefined;
  image_base64?: string | undefined;
  image_mime?: string | undefined;
  /** The orchestration page's process-knowledge toggle and attachments. */
  process_knowledge?: ProcessKnowledgeRequest | undefined;
}

/** Where a new activity goes in the builder: it is written to fit between these steps. */
export interface StepPlacement {
  /** The workflow as it is in the builder (it may be unsaved). */
  definition: unknown;
  after_step_id?: string | null;
  before_step_ids?: string[];
}

/** One layer of a run's planning report. Times are Unix ms; null when not recorded. */
export interface ReportLayer {
  name: string;
  label: string;
  detail: string;
  /** A stage groups the layers after it (``parent`` names it). */
  stage: boolean;
  parent: string | null;
  depth: number;
  state: "pending" | "active" | "completed" | "failed" | "skipped" | string;
  started_at: number | null;
  ended_at: number | null;
  ms: number | null;
  /** Running layers: time so far. */
  elapsed_ms?: number | null;
  /** From the start of the run. */
  offset_ms: number | null;
  summary: string | null;
  error: string | null;
  /** How many times it ran — more than one after a rewind. */
  runs: number;
  subs: Array<{
    id: string;
    label: string;
    state: string;
    ms: number | null;
    summary: string | null;
    error: string | null;
  }>;
}

export interface ReportDecision {
  id: string;
  kind: string | null;
  title: string | null;
  options: string[];
  recommended: string | null;
  asked_at: number | null;
  answered_at: number | null;
  waited_ms: number | null;
  offset_ms: number | null;
  choice: string | null;
  /** "user", or "timeout" when the deadline took the recommended choice. */
  by: string | null;
  extended: number;
}

/** What happened in a planning (or agent) run, with timings — GET /runs/{id}/report. */
export interface RunReport {
  run: BackgroundRun;
  /** False for runs recorded before event times were kept: durations only. */
  timed: boolean;
  started_at: string | null;
  finished_at: string | null;
  duration_ms: number | null;
  waiting_ms: number;
  working_ms: number | null;
  layers: ReportLayer[];
  layer_counts: { total: number; completed: number; failed: number; skipped: number };
  decisions: ReportDecision[];
  rewinds: Array<{
    round: number | null;
    to: string | null;
    from: string | null;
    reason: string | null;
    at: number | null;
  }>;
  calls: Array<{ kind: string; count: number; ms: number; failed: number }>;
  models: Array<{ name: string; count: number; ms: number; failed: number }>;
  errors: Array<{ at: number | null; message: string }>;
  event_counts: Record<string, number>;
}

export const runsApi = {
  list: (params: { status?: string; kind?: string; limit?: number } = {}) =>
    get<{ runs: BackgroundRun[] }>("/api/runs", params),
  get: (id: string) => get<BackgroundRun>(`/api/runs/${id}`),
  /** Timings, questions, calls and rewinds of one run. */
  report: (id: string) => get<RunReport>(`/api/runs/${id}/report`),
  cancel: (id: string) => post<{ cancelled: boolean; status: string }>(`/api/runs/${id}/cancel`),
  startWorkflowPlan: (goal: string, processKnowledge?: ProcessKnowledgeRequest) =>
    post<BackgroundRun>("/api/runs/workflow-plan", {
      goal,
      ...(processKnowledge ? { process_knowledge: processKnowledge } : {}),
    }),
  startAgent: (body: AgentRunRequest) => post<BackgroundRun>("/api/runs/agent", body),
  /** `placement`: an activity for a place on the builder canvas, written to fit the steps around it. */
  startSynthesis: (task: string, purpose: "tool" | "activity", placement?: StepPlacement) =>
    post<BackgroundRun>("/api/runs/synthesis", {
      task,
      purpose,
      ...(placement ? { placement } : {}),
    }),
  /** Answer a question a running run is waiting on (its `decision_required` event). */
  /** Rebuild a tool/activity version from a failure; tracked like a synthesis run. */
  startRebuild: (body: RebuildRequest) => post<BackgroundRun>("/api/runs/rebuild", body),
  /** Refine with AI: analyse, plan and carry out a fix (workflow edits and activity code). */
  startWorkflowRefine: (body: WorkflowRefineRequest) =>
    post<BackgroundRun>("/api/runs/workflow-refine", body),
  /** Test a saved workflow on designed scenarios (dry run); each repair is put to the user. */
  startWorkflowVerify: (workflowName: string) =>
    post<BackgroundRun>("/api/runs/workflow-verify", { workflow_name: workflowName }),
  /** Test an existing agent on designed prompts; revised instructions are put to the user. */
  startAgentEvaluate: (agentId: string) =>
    post<BackgroundRun>("/api/runs/agent-evaluate", { agent_id: agentId }),
  /** Keep a question waiting longer before its recommended choice is taken. */
  extendDecision: (id: string, decisionId: string, seconds = 300) =>
    post<{ deadline: string }>(`/api/runs/${id}/decisions/${decisionId}/extend`, { seconds }),
  /** `message` only counts for a choice the question lists in `message_options`. */
  decide: (
    id: string,
    decisionId: string,
    choice: string,
    message?: string,
    answers?: PrerequisiteAnswer[],
  ) =>
    post<{ accepted: boolean; choice: string }>(`/api/runs/${id}/decisions/${decisionId}`, {
      choice,
      ...(message ? { message } : {}),
      ...(answers ? { answers } : {}),
    }),
};

/** One thing a build needs from its user (`prerequisites` questions and events). */
export interface PrerequisiteItem {
  key: string;
  category: "credential" | "endpoint" | "configuration" | "information";
  label: string;
  service: string;
  why: string;
  /** The name code reads it by (vault categories). */
  name: string;
  secret_kind: string;
  sensitive: boolean;
  required: boolean;
  format_hint: string;
  alternative: string;
  default: string;
  used_by: string[];
  candidates: Array<{
    id: string;
    name: string;
    label: string;
    service: string;
    kind: string;
    usable: boolean;
    status: string;
    hint: string;
    score: number;
  }>;
  status: "pending" | "vault" | "environment" | "answered" | "skipped" | "deferred";
  auto: boolean;
  secret_id: string | null;
  secret_name: string | null;
  /** An information item's answer; always null for a vault category. */
  value: string | null;
  instruction: string;
}

/**
 * How one item was settled. There is no field for a value: a credential is
 * stored in the vault first and named here by `secret_id`.
 */
export type PrerequisiteAnswer =
  | { key: string; action: "vault"; secret_id: string }
  | { key: string; action: "text"; text: string }
  | { key: string; action: "skip"; instruction?: string }
  | { key: string; action: "defer" };

/** A question a run stopped to ask (`decision_required`). */
export interface RunDecision {
  id: string;
  kind: "build_failed" | "review_workflow" | "prerequisites" | string;
  options: string[];
  default: string;
  /** The choice taken when the deadline passes with no answer (same as default). */
  recommended?: string;
  /** When the recommended choice is taken (ISO); moved by "Keep waiting". */
  deadline?: string;
  /** The wait the question was asked with, in seconds. */
  timeout_s?: number;
  title?: string;
  /** build_failed: what could not be built. */
  entity?: "activity" | "agent" | string;
  attempts?: number;
  failures?: Array<{
    id?: string;
    name?: string;
    step?: string;
    error?: string;
    rolled_back?: boolean;
  }>;
  /** review_workflow */
  workflow_name?: string;
  valid?: boolean;
  /** review_workflow: valid and every dry-run scenario passed; and why not. */
  verified?: boolean;
  not_verified_reason?: string;
  /** The workflow can be changed by revision while this waits. */
  revisable?: boolean;
  /** Choices that accept a typed message (e.g. retry: what to change first). */
  message_options?: string[];
  last_test?: { passed: boolean; summary: string } | null;
  /** verify_repair: the fix planned for the failed scenarios, and what failed. */
  fix_summary?: string;
  fix_items?: Array<{ title?: string; kind?: string; detail?: string }>;
  scenario_failures?: Array<{ name: string; problems: string[] }>;
  /** revise_instructions: what the judge asked for, and the instructions before and after. */
  agent_name?: string;
  changes?: string;
  current_instructions?: string;
  revised_instructions?: string;
  /** Everything the plan has created so far — what a rollback removes. */
  created?: Array<{ kind: string; id: string; name?: string }>;
  /** prerequisites: what is being built, and where the check ran. */
  stage?: "workflow" | "agent" | "code";
  subject?: string;
  items?: PrerequisiteItem[];
  /** prerequisites: why the previous answer could not be used (asked again). */
  problems?: string[];
  round?: number;
  vault?: { enabled: boolean; admin_token_required: boolean };
  run_id?: string | null;
}

export const eventsUrl = (id: string, after: number) => `/api/runs/${id}/events?after=${after}`;

export const isTerminal = (status: RunStatus | undefined) =>
  status !== undefined && status !== "running";
