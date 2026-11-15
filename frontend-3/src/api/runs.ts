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

export const runsApi = {
  list: (params: { status?: string; kind?: string; limit?: number } = {}) =>
    get<{ runs: BackgroundRun[] }>("/api/runs", params),
  get: (id: string) => get<BackgroundRun>(`/api/runs/${id}`),
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
