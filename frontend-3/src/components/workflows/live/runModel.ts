/**
 * A live run, step by step, in the workflow's own order.
 *
 * The execution reports the steps that have started (from Mistral's trace
 * progress events, or the local engine's step results). The definition knows
 * every step, including the ones not reached yet. This model joins the two, so
 * the page can show the whole workflow — done, running, waiting for a person,
 * failed, still to come — and say which step a failure happened at.
 */
import type { ExecutionDetail, ExecutionStep, WorkflowDefinition, WorkflowStep } from "@/types";
import type { HumanReview } from "@/api/knowledge";

export type StepState =
  "pending" | "running" | "retrying" | "review" | "done" | "failed" | "skipped" | "not_reached";

export interface LiveStep {
  /** The definition's step id, or the reported name for a step the definition does not know. */
  id: string;
  type: string | null;
  description: string | null;
  state: StepState;
  /** Every report for this step, oldest first — more than one means it was retried. */
  attempts: ExecutionStep[];
  /** The latest report, if the step has started. */
  latest: ExecutionStep | null;
  error: string | null;
  /** The review this step is waiting on. */
  review: HumanReview | null;
}

export interface LiveRun {
  steps: LiveStep[];
  total: number;
  finished: number;
  /** 0–100. */
  percent: number;
  current: LiveStep | null;
  failedStep: LiveStep | null;
  reviewStep: LiveStep | null;
  status: string;
  terminal: boolean;
  failed: boolean;
  /** The best explanation of why the run failed, if it did. */
  failure: string | null;
}

const FAILED = new Set(["FAILED", "TIMED_OUT", "TERMINATED", "CANCELED", "CANCELLED"]);
const TERMINAL = new Set([...FAILED, "COMPLETED", "CONTINUED_AS_NEW"]);

export const isFailedStatus = (s?: string | null) => FAILED.has((s ?? "").toUpperCase());
export const isTerminalStatus = (s?: string | null) => TERMINAL.has((s ?? "").toUpperCase());

/** Steps in the order a run meets them: from the entry step along every branch. */
export function orderedSteps(def: WorkflowDefinition): WorkflowStep[] {
  const byId = new Map(def.steps.map((s) => [s.id, s]));
  const seen = new Set<string>();
  const out: WorkflowStep[] = [];
  const queue = [def.entry_step, ...def.steps.map((s) => s.id)].filter(Boolean);
  // Breadth-first from the entry; anything unreachable is appended after.
  const visit = (start: string) => {
    const q = [start];
    while (q.length) {
      const id = q.shift()!;
      if (seen.has(id)) continue;
      const step = byId.get(id);
      if (!step) continue;
      seen.add(id);
      out.push(step);
      const cfg = step.config ?? {};
      const branches = [cfg["true_step"], cfg["false_step"], cfg["fallback_step"]].filter(
        (v): v is string => typeof v === "string" && v.length > 0,
      );
      q.push(...(step.next_steps ?? []), ...branches);
    }
  };
  for (const id of queue) visit(id);
  return out;
}

/** The definition step a reported step ran, if it can be told. */
export function definitionIdFor(
  reported: ExecutionStep,
  def: WorkflowDefinition | null | undefined,
): string | null {
  if (!def) return null;
  const ids = new Set(def.steps.map((s) => s.id));
  const attrs = reported.attributes ?? {};
  const prefix = `run_${def.name}_`.replace(/\W/g, "_");
  const candidates = [
    attrs["app.step.id"],
    attrs["step_id"],
    reported.name,
    reported.id.split(":")[0],
    reported.name?.startsWith(prefix) ? reported.name.slice(prefix.length) : null,
    reported.name?.replace(/^__parallel_/, "").replace(/:start$/, ""),
  ];
  for (const c of candidates) if (typeof c === "string" && ids.has(c)) return c;
  return null;
}

function stateOf(report: ExecutionStep): StepState {
  const s = String(report.status).toUpperCase();
  if (s === "COMPLETED") return "done";
  if (s === "RETRYING_AFTER_ERROR" || s === "RETRYING") return "retrying";
  if (FAILED.has(s)) return "failed";
  return "running";
}

export function buildLiveRun(
  detail: ExecutionDetail | null,
  def: WorkflowDefinition | null | undefined,
  reviews: HumanReview[] = [],
): LiveRun {
  const status = (detail?.status ?? "RUNNING").toUpperCase();
  const terminal = TERMINAL.has(status);
  const failed = FAILED.has(status);
  const reports = (detail?.steps ?? [])
    .filter((s) => !s.internal)
    .slice()
    .sort((a, b) => (a.start_time_ms ?? 0) - (b.start_time_ms ?? 0));

  const byStep = new Map<string, ExecutionStep[]>();
  const unmatched: ExecutionStep[] = [];
  for (const r of reports) {
    const id = definitionIdFor(r, def);
    if (id) byStep.set(id, [...(byStep.get(id) ?? []), r]);
    else if (!/^__parallel_/.test(r.name ?? "")) unmatched.push(r);
  }
  const pendingReview = new Map(
    reviews.filter((r) => r.status === "pending").map((r) => [r.step_id, r]),
  );

  const make = (
    id: string,
    type: string | null,
    description: string | null,
    attempts: ExecutionStep[],
  ): LiveStep => {
    const latest = attempts[attempts.length - 1] ?? null;
    const review = pendingReview.get(id) ?? null;
    let state: StepState;
    if (review && !terminal) state = "review";
    else if (latest) {
      state = stateOf(latest);
      // A run that ended cannot have a step still going.
      if (terminal && (state === "running" || state === "retrying"))
        state = failed ? "failed" : "done";
    } else state = terminal ? (failed ? "not_reached" : "skipped") : "pending";
    const error = [...attempts].reverse().find((a) => a.error)?.error ?? null;
    return { id, type, description, state, attempts, latest, error, review };
  };

  const steps: LiveStep[] = def
    ? orderedSteps(def).map((s) =>
        make(s.id, String(s.type), s.description ?? null, byStep.get(s.id) ?? []),
      )
    : [];
  // Reports the definition does not know (no definition, or a renamed step).
  const extra = new Map<string, ExecutionStep[]>();
  for (const r of unmatched) extra.set(r.name || r.id, [...(extra.get(r.name || r.id) ?? []), r]);
  for (const [name, attempts] of extra) steps.push(make(name, null, null, attempts));

  // A failed run whose failure no step carries: pin it on the step it stopped at.
  let failedStep = steps.find((s) => s.state === "failed") ?? null;
  if (failed && !failedStep) {
    const lastStarted = [...steps].reverse().find((s) => s.latest);
    if (lastStarted) {
      lastStarted.state = "failed";
      failedStep = lastStarted;
    }
  }
  if (failedStep && !failedStep.error && detail?.error) failedStep.error = detail.error;

  const finished = steps.filter((s) => s.state === "done" || s.state === "skipped").length;
  const total = steps.length;
  const percent =
    status === "COMPLETED" ? 100 : total ? Math.min(99, Math.round((finished / total) * 100)) : 0;
  const current =
    steps.find((s) => s.state === "review") ??
    steps.find((s) => s.state === "running" || s.state === "retrying") ??
    null;

  return {
    steps,
    total,
    finished,
    percent,
    current,
    failedStep,
    reviewStep: steps.find((s) => s.state === "review") ?? null,
    status,
    terminal,
    failed,
    failure: failed ? (failedStep?.error ?? detail?.error ?? null) : null,
  };
}

/** Pull the readable part out of a raw error: the last "Error: …" line, without the traceback. */
export function summariseError(error: string | null | undefined): {
  headline: string;
  details: string | null;
} {
  const text = (error ?? "").trim();
  if (!text) return { headline: "The step failed without an error message.", details: null };
  const lines = text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length === 1 && text.length <= 240) return { headline: text, details: null };
  const errorLine =
    [...lines].reverse().find((l) => /^[A-Za-z_.]*(Error|Exception)\b[:]/.test(l)) ??
    lines.find((l) => !/^(Traceback|File |\s*at )/.test(l)) ??
    lines[0]!;
  const headline = errorLine.length > 280 ? `${errorLine.slice(0, 277)}…` : errorLine;
  return { headline, details: text };
}
