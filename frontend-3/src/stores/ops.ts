import { create } from "zustand";

/**
 * Requests in flight, and what each is doing — the live state behind the
 * activity bar and tray. Filled by `lib/ops/tracker`; never persisted (a
 * reload ends every request anyway).
 */
export type OpStatus = "pending" | "completed" | "failed";

export interface OpStep {
  id: number;
  /** stage · tool · step · model */
  kind: string;
  name: string;
  state: "active" | "completed" | "failed";
  ms?: number | undefined;
  error?: string | undefined;
}

export interface OpLayer {
  name: string;
  label: string;
  state: "pending" | "active" | "completed" | "skipped" | "failed";
  ms?: number | undefined;
}

export interface Bytes {
  loaded: number;
  total: number;
}

export interface TrackedOp {
  id: string;
  method: string;
  url: string;
  /** What the user did, in words — "Running diagnostics". */
  label: string;
  /** A read (page data) rather than an action. Shown only when slow. */
  background: boolean;
  startedAt: number;
  finishedAt?: number | undefined;
  status: OpStatus;
  error?: string | undefined;
  upload?: Bytes | undefined;
  download?: Bytes | undefined;
  /** The latest stage the server reported. */
  stage?: { label: string; done?: number; total?: number; detail?: string } | undefined;
  /** The latest stage that came with a count — kept while unmeasured stages pass. */
  measured?: { done: number; total: number } | undefined;
  steps: OpStep[];
  layers: OpLayer[];
  /** The latest free-text line: a log line, a pipeline status, a note. */
  note?: string | undefined;
  /** The server's progress stream is open. */
  live: boolean;
}

interface OpsState {
  ops: Record<string, TrackedOp>;
  add: (op: TrackedOp) => void;
  patch: (id: string, fn: (op: TrackedOp) => Partial<TrackedOp>) => void;
  remove: (id: string) => void;
}

export const useOpsStore = create<OpsState>((set) => ({
  ops: {},
  add: (op) => set((s) => ({ ops: { ...s.ops, [op.id]: op } })),
  patch: (id, fn) =>
    set((s) => {
      const op = s.ops[id];
      if (!op) return s;
      return { ops: { ...s.ops, [id]: { ...op, ...fn(op) } } };
    }),
  remove: (id) =>
    set((s) => {
      if (!s.ops[id]) return s;
      const { [id]: _, ...rest } = s.ops;
      return { ops: rest };
    }),
}));
