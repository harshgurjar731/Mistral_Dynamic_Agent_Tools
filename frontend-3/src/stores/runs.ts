import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { BackgroundRun } from "@/api/runs";

/**
 * Background runs this browser knows about.
 *
 * Only the summary is kept here (and persisted), so a reload still knows which
 * runs to reattach to. The event log behind each run lives in
 * `lib/runs/connections` — it is large, rebuilt by replay, and never persisted.
 */
export interface TrackedRun extends BackgroundRun {
  /** The user has seen how it ended. Unseen endings are badged in the indicator. */
  seen: boolean;
}

const MAX_TRACKED = 30;

interface RunsState {
  runs: Record<string, TrackedRun>;
  upsert: (run: BackgroundRun, opts?: { seen?: boolean }) => void;
  patch: (id: string, patch: Partial<TrackedRun>) => void;
  markSeen: (id: string) => void;
  remove: (id: string) => void;
  clearFinished: () => void;
}

function capped(runs: Record<string, TrackedRun>): Record<string, TrackedRun> {
  const list = Object.values(runs);
  if (list.length <= MAX_TRACKED) return runs;
  // Running runs are never evicted; the oldest finished ones go first.
  const keep = list
    .sort((a, b) => {
      if ((a.status === "running") !== (b.status === "running")) {
        return a.status === "running" ? -1 : 1;
      }
      return (b.created_at ?? "").localeCompare(a.created_at ?? "");
    })
    .slice(0, MAX_TRACKED);
  return Object.fromEntries(keep.map((r) => [r.id, r]));
}

export const useRunsStore = create<RunsState>()(
  persist(
    (set) => ({
      runs: {},
      upsert: (run, opts) =>
        set((s) => {
          const prev = s.runs[run.id];
          // A poll that raced a live `run_end` must not put a finished run back
          // to running.
          const status = prev && prev.status !== "running" ? prev.status : run.status;
          const next: TrackedRun = {
            ...prev,
            ...run,
            status,
            result: prev && prev.status !== "running" ? prev.result : run.result,
            error: prev && prev.status !== "running" ? prev.error : run.error,
            seen: opts?.seen ?? prev?.seen ?? false,
          };
          return { runs: capped({ ...s.runs, [run.id]: next }) };
        }),
      patch: (id, patch) =>
        set((s) => {
          const prev = s.runs[id];
          if (!prev) return s;
          return { runs: { ...s.runs, [id]: { ...prev, ...patch } } };
        }),
      markSeen: (id) =>
        set((s) => {
          const prev = s.runs[id];
          if (!prev || prev.seen || prev.status === "running") return s;
          return { runs: { ...s.runs, [id]: { ...prev, seen: true } } };
        }),
      remove: (id) =>
        set((s) => {
          if (!s.runs[id]) return s;
          const { [id]: _removed, ...rest } = s.runs;
          return { runs: rest };
        }),
      clearFinished: () =>
        set((s) => ({
          runs: Object.fromEntries(
            Object.entries(s.runs).filter(([, r]) => r.status === "running"),
          ),
        })),
    }),
    {
      name: "background_runs",
      version: 1,
      // The request can carry a pasted image or attachments — never needed to
      // reattach. The small fields that say what a synthesis / rebuild was
      // (its task, the tool it rebuilds) are kept so its dialog can reopen on it.
      partialize: (s) => ({
        runs: Object.fromEntries(
          Object.entries(s.runs).map(([id, r]) => [id, { ...r, request: slimRequest(r.request) }]),
        ),
      }),
    },
  ),
);

const PERSISTED_REQUEST_KEYS = [
  "mode",
  "tool_id",
  "purpose",
  "task",
  "error",
  "comment",
  "failing_input",
  "expected_output",
  "update_workflows",
] as const;

function slimRequest(request: Record<string, unknown> | undefined): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (!request) return out;
  for (const key of PERSISTED_REQUEST_KEYS) {
    if (request[key] !== undefined) out[key] = request[key];
  }
  return out;
}

/**
 * How runs are being looked at in this tab — never persisted.
 *
 * - `focused`: how many views show each run right now (a dialog, a page).
 * - `dismissed` / `minimized`: the user closed or shrank its progress notice.
 * - `openRequest`: a run the user asked to open (from a notice, a toast, the
 *   indicator). The page that can show it takes the request and opens its
 *   dialog on that run.
 */
interface RunUiState {
  focused: Record<string, number>;
  dismissed: Record<string, true>;
  minimized: Record<string, true>;
  openRequest: string | null;
  setFocusCount: (id: string, n: number) => void;
  dismiss: (id: string) => void;
  setMinimized: (id: string, minimized: boolean) => void;
  requestOpen: (id: string) => void;
  clearOpenRequest: (id: string) => void;
}

export const useRunUiStore = create<RunUiState>()((set) => ({
  focused: {},
  dismissed: {},
  minimized: {},
  openRequest: null,
  setFocusCount: (id, n) =>
    set((s) => {
      const focused = { ...s.focused };
      if (n > 0) focused[id] = n;
      else delete focused[id];
      return { focused };
    }),
  dismiss: (id) => set((s) => ({ dismissed: { ...s.dismissed, [id]: true } })),
  setMinimized: (id, minimized) =>
    set((s) => {
      const next = { ...s.minimized };
      if (minimized) next[id] = true;
      else delete next[id];
      return { minimized: next };
    }),
  // Opening a run also brings its notice back if it was closed.
  requestOpen: (id) =>
    set((s) => {
      const { [id]: _d, ...dismissed } = s.dismissed;
      return { openRequest: id, dismissed };
    }),
  clearOpenRequest: (id) => set((s) => (s.openRequest === id ? { openRequest: null } : s)),
}));

/** Bumped whenever new events land for a run, so views re-read its log. */
export const useRunLogVersion = create<{
  versions: Record<string, number>;
  bump: (ids: Iterable<string>) => void;
}>()((set) => ({
  versions: {},
  bump: (ids) =>
    set((s) => {
      const versions = { ...s.versions };
      for (const id of ids) versions[id] = (versions[id] ?? 0) + 1;
      return { versions };
    }),
}));
