/**
 * Hooks for pages that show a background run.
 *
 * A page never owns a run's stream — it folds the run's event log (kept by
 * `connections`) into its own view state, so opening the page mid-run, after a
 * reload, or long after it finished all produce the same timeline.
 */
import { useEffect, useRef, useState } from "react";
import type { SSEEvent } from "@/api/sse";
import { useRunLogVersion, useRunsStore, type TrackedRun } from "@/stores/runs";
import { ensureRun, focusRun, getRunLog } from "./connections";

/** The run's summary, or undefined when this browser does not know it. */
export function useTrackedRun(id: string | null | undefined): TrackedRun | undefined {
  return useRunsStore((s) => (id ? s.runs[id] : undefined));
}

/**
 * Fold a run's events into view state, incrementally — only events that
 * arrived since the last render are applied.
 */
export function useRunReducer<S>(
  id: string | null | undefined,
  reduce: (state: S, event: SSEEvent) => S,
  init: () => S,
): S {
  // Subscribing to the version is what re-renders this view on new events.
  useRunLogVersion((s) => (id ? (s.versions[id] ?? 0) : 0));
  const ref = useRef<{ id: string | null; count: number; state: S } | null>(null);

  if (!ref.current || ref.current.id !== (id ?? null)) {
    ref.current = { id: id ?? null, count: 0, state: init() };
  }
  if (id) {
    const events = getRunLog(id).events;
    if (events.length < ref.current.count) {
      ref.current = { id, count: 0, state: init() };
    }
    let state = ref.current.state;
    for (let i = ref.current.count; i < events.length; i++) {
      const event = events[i];
      if (event) state = reduce(state, event);
    }
    ref.current.state = state;
    ref.current.count = events.length;
  }
  return ref.current.state;
}

/**
 * Show a run on this page: make sure it is loading, count this view as
 * watching it (which also mutes its completion toast), and mark its outcome
 * seen. Returns false once the server says the run does not exist.
 */
export function useRunView(id: string | null | undefined): { missing: boolean } {
  const [missing, setMissing] = useState(false);
  const status = useRunsStore((s) => (id ? s.runs[id]?.status : undefined));
  const markSeen = useRunsStore((s) => s.markSeen);

  useEffect(() => {
    setMissing(false);
    if (!id) return;
    const release = focusRun(id);
    let cancelled = false;
    void ensureRun(id).then((ok) => {
      if (!cancelled && !ok) setMissing(true);
    });
    return () => {
      cancelled = true;
      release();
    };
  }, [id]);

  useEffect(() => {
    if (id && status && status !== "running") markSeen(id);
  }, [id, status, markSeen]);

  return { missing };
}

/** Elapsed time since an ISO timestamp, re-rendering every second while live. */
export function useElapsed(since: string | null | undefined, live: boolean, until?: string | null) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!live) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [live]);
  if (!since) return null;
  const start = Date.parse(since);
  const end = !live && until ? Date.parse(until) : now;
  if (Number.isNaN(start) || Number.isNaN(end)) return null;
  return Math.max(0, end - start);
}
