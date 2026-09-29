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
      // The request can carry a pasted image; it is never needed to reattach.
      partialize: (s) => ({
        runs: Object.fromEntries(
          Object.entries(s.runs).map(([id, r]) => [id, { ...r, request: {} }]),
        ),
      }),
    },
  ),
);

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
