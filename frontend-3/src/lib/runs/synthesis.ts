/**
 * Telling synthesis runs apart, and reopening their dialogs.
 *
 * A "Rebuild from an error" run is a `tool_synthesis` / `activity_synthesis`
 * run too (the backend tags its request with `mode: "rebuild"`), but it belongs
 * to the tool's detail page, not to the Synthesize dialog of the list page.
 */
import { useEffect, useRef } from "react";
import type { RunKind } from "@/api/runs";
import { useRunsStore, useRunUiStore, type TrackedRun } from "@/stores/runs";

type RunLike = Pick<TrackedRun, "kind" | "title" | "request">;

export const SYNTHESIS_KINDS: ReadonlySet<RunKind> = new Set([
  "tool_synthesis",
  "activity_synthesis",
]);

export const synthesisKind = (purpose: "tool" | "activity"): RunKind =>
  purpose === "activity" ? "activity_synthesis" : "tool_synthesis";

const REBUILD_TITLE = /^Rebuild (.+) \(v[^)]*\) from a failure$/;

export function isRebuildRun(run: RunLike): boolean {
  return run.request?.["mode"] === "rebuild" || REBUILD_TITLE.test(run.title ?? "");
}

/** The tool version a rebuild started from, when known. */
export function rebuildToolId(run: RunLike): number | null {
  const id = Number(run.request?.["tool_id"]);
  return Number.isFinite(id) && id > 0 ? id : null;
}

/** The tool a rebuild is for, by name (from its title). */
export function rebuildToolName(run: RunLike): string | null {
  return REBUILD_TITLE.exec(run.title ?? "")?.[1] ?? null;
}

/** What the synthesis was asked to build. */
export function synthesisTask(run: RunLike): string {
  const task = run.request?.["task"];
  return typeof task === "string" && task ? task : (run.title ?? "");
}

function newest(runs: Iterable<TrackedRun>, keep: (r: TrackedRun) => boolean): string | null {
  let best: TrackedRun | null = null;
  for (const r of runs) {
    if (!keep(r)) continue;
    if (!best || (r.created_at ?? "") > (best.created_at ?? "")) best = r;
  }
  return best?.id ?? null;
}

/** The newest synthesis (not rebuild) of this purpose that is still running. */
export function useRunningSynthesisId(purpose: "tool" | "activity", enabled = true) {
  const kind = synthesisKind(purpose);
  return useRunsStore((s) =>
    enabled
      ? newest(
          Object.values(s.runs),
          (r) => r.kind === kind && r.status === "running" && !isRebuildRun(r),
        )
      : null,
  );
}

/** Does this rebuild run belong to this tool (any of its versions)? */
export function isRebuildOf(run: RunLike, tool: { id: string | number; name: string }): boolean {
  if (!SYNTHESIS_KINDS.has(run.kind) || !isRebuildRun(run)) return false;
  return rebuildToolId(run) === Number(tool.id) || rebuildToolName(run) === tool.name;
}

/** The newest rebuild of this tool that is still running. */
export function useRunningRebuild(tool: { id: string | number; name: string } | undefined) {
  const id = useRunsStore((s) =>
    tool
      ? newest(Object.values(s.runs), (r) => r.status === "running" && isRebuildOf(r, tool))
      : null,
  );
  return useRunsStore((s) => (id ? s.runs[id] : undefined));
}

/**
 * Take an "open this run" request (see `useRunUiStore.requestOpen`) when this
 * page is the one that shows it. `accepts` decides; `open` shows it.
 */
export function useRunOpenRequest(
  accepts: (run: TrackedRun) => boolean,
  open: (run: TrackedRun) => void,
) {
  const requested = useRunUiStore((s) => s.openRequest);
  const run = useRunsStore((s) => (requested ? s.runs[requested] : undefined));
  // Evaluated each render, so a page whose data arrives after the request
  // (a detail page still loading its tool) takes it once it can.
  const accepted = run ? accepts(run) : false;
  const runRef = useRef(run);
  runRef.current = run;
  const openRef = useRef(open);
  openRef.current = open;

  useEffect(() => {
    const current = runRef.current;
    if (!accepted || !current) return;
    useRunUiStore.getState().clearOpenRequest(current.id);
    useRunsStore.getState().markSeen(current.id);
    openRef.current(current);
    // Only a new request re-runs this — not every progress tick of the run.
  }, [requested, accepted]);
}

/** The runs that should show a notice right now, oldest first. */
export function useRunNotices(): TrackedRun[] {
  const runs = useRunsStore((s) => s.runs);
  const focused = useRunUiStore((s) => s.focused);
  const dismissed = useRunUiStore((s) => s.dismissed);
  return Object.values(runs)
    .filter(
      (r) =>
        r.status === "running" && SYNTHESIS_KINDS.has(r.kind) && !focused[r.id] && !dismissed[r.id],
    )
    .sort((a, b) => (a.created_at ?? "").localeCompare(b.created_at ?? ""));
}
