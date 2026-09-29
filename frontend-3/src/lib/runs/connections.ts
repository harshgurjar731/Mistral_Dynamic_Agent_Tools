/**
 * Connections to background runs — owned by the app, not by any page.
 *
 * A page that starts or views a run only reads from here. Leaving the page
 * never closes the stream, so progress keeps arriving and is still there when
 * the user comes back. After a reload the stream is reopened and the run's
 * events are replayed from the server, rebuilding the same timeline.
 *
 * Every event carries a sequence number. A dropped connection reconnects with
 * the last one it saw and receives only what it missed.
 */
import { toast } from "sonner";
import { errorMessage } from "@/api/client";
import { createSSEStream, type SSEEvent } from "@/api/sse";
import { eventsUrl, runsApi, type BackgroundRun, type RunStatus } from "@/api/runs";
import { useRunLogVersion, useRunsStore, type TrackedRun } from "@/stores/runs";

export interface RunLog {
  events: SSEEvent[];
  lastSeq: number;
  /** `run_end` has arrived — the log is complete. */
  ended: boolean;
}

interface Progress {
  visible: Map<string, string>;
  done: Set<string>;
}

const logs = new Map<string, RunLog>();
const connections = new Map<string, () => void>();
const retryCount = new Map<string, number>();
const retryTimers = new Map<string, ReturnType<typeof setTimeout>>();
const progress = new Map<string, Progress>();
const focusCount = new Map<string, number>();

export type RunFinishedListener = (run: TrackedRun, ctx: { focused: boolean }) => void;
const finishedListeners = new Set<RunFinishedListener>();

const isBrowser = () => typeof window !== "undefined";

/* ── Logs ─────────────────────────────────────────────────────────────── */

export function getRunLog(id: string): RunLog {
  let log = logs.get(id);
  if (!log) {
    log = { events: [], lastSeq: 0, ended: false };
    logs.set(id, log);
  }
  return log;
}

let pendingBumps = new Set<string>();
let bumpTimer: ReturnType<typeof setTimeout> | null = null;

/** Coalesce re-renders: a streamed answer is hundreds of events a second. */
function scheduleBump(id: string) {
  pendingBumps.add(id);
  if (bumpTimer) return;
  bumpTimer = setTimeout(() => {
    const ids = pendingBumps;
    pendingBumps = new Set();
    bumpTimer = null;
    useRunLogVersion.getState().bump(ids);
  }, 50);
}

/* ── Focus: is someone looking at this run right now? ─────────────────── */

/** Register a view of a run. Returns the release function. */
export function focusRun(id: string): () => void {
  focusCount.set(id, (focusCount.get(id) ?? 0) + 1);
  return () => {
    const n = (focusCount.get(id) ?? 1) - 1;
    if (n <= 0) focusCount.delete(id);
    else focusCount.set(id, n);
  };
}

export const isRunFocused = (id: string) => (focusCount.get(id) ?? 0) > 0;

export function onRunFinished(listener: RunFinishedListener): () => void {
  finishedListeners.add(listener);
  return () => finishedListeners.delete(listener);
}

/* ── Status ───────────────────────────────────────────────────────────── */

function parse(data: string): unknown {
  try {
    return JSON.parse(data);
  } catch {
    return data;
  }
}

/**
 * Record how a run ended. Notifies listeners only for a run this browser saw
 * running — replaying a run that finished long ago is not news.
 */
export function settleRun(
  id: string,
  end: { status: RunStatus; result?: unknown; error?: unknown; finished_at?: string | null },
) {
  const store = useRunsStore.getState();
  const prev = store.runs[id];
  if (!prev || prev.status !== "running") {
    if (prev && prev.status !== end.status && end.status !== "running") {
      store.patch(id, { status: end.status });
    }
    return;
  }
  const focused = isRunFocused(id);
  store.patch(id, {
    status: end.status,
    result: (end.result as Record<string, unknown> | null | undefined) ?? prev.result,
    error: typeof end.error === "string" ? end.error : null,
    finished_at: end.finished_at ?? new Date().toISOString(),
    seen: focused,
  });
  const run = useRunsStore.getState().runs[id];
  if (run) finishedListeners.forEach((l) => l(run, { focused }));
}

function trackProgress(id: string, e: SSEEvent) {
  let p = progress.get(id);
  if (e.type === "pipeline") {
    const parsed = parse(e.data) as {
      layers?: Array<{ name: string; label?: string; hidden?: boolean }>;
    };
    p = {
      visible: new Map(
        (parsed?.layers ?? []).filter((l) => !l.hidden).map((l) => [l.name, l.label ?? l.name]),
      ),
      done: new Set(),
    };
    progress.set(id, p);
    useRunsStore.getState().patch(id, {
      progress: { total: p.visible.size, done: 0, label: null, note: null },
    });
    return;
  }
  if (!p) return;
  const store = useRunsStore.getState();
  const current = store.runs[id]?.progress;
  if (e.type === "layer") {
    const layer = parse(e.data) as { name?: string; state?: string };
    if (!layer?.name || !p.visible.has(layer.name)) return;
    if (layer.state === "active") {
      store.patch(id, {
        progress: {
          total: p.visible.size,
          done: p.done.size,
          label: p.visible.get(layer.name) ?? null,
          note: null,
        },
      });
    } else if (
      layer.state === "completed" ||
      layer.state === "skipped" ||
      layer.state === "failed"
    ) {
      p.done.add(layer.name);
      store.patch(id, {
        progress: {
          total: p.visible.size,
          done: p.done.size,
          label: current?.label,
          note: current?.note,
        },
      });
    }
  } else if (e.type === "status") {
    store.patch(id, {
      progress: { total: p.visible.size, done: p.done.size, label: current?.label, note: e.data },
    });
  }
}

/* ── Connections ──────────────────────────────────────────────────────── */

/**
 * Make sure a run's events are flowing into its log. Safe to call repeatedly;
 * a run whose log is already complete is left alone.
 */
export function connectRun(id: string) {
  if (!isBrowser() || connections.has(id) || retryTimers.has(id)) return;
  const log = getRunLog(id);
  if (log.ended) return;

  const stop = createSSEStream(eventsUrl(id, log.lastSeq), {
    method: "GET",
    onEvent: (e) => {
      if (e.id !== undefined) {
        if (e.id <= log.lastSeq) return;
        log.lastSeq = e.id;
      }
      retryCount.delete(id);
      log.events.push(e);

      if (e.type === "run_end") {
        log.ended = true;
        const end = parse(e.data) as {
          status?: RunStatus;
          result?: unknown;
          error?: unknown;
        };
        settleRun(id, {
          status: end?.status ?? "completed",
          result: end?.result,
          error: end?.error,
        });
      } else if (e.type === "pipeline" || e.type === "layer" || e.type === "status") {
        trackProgress(id, e);
      }
      scheduleBump(id);
    },
    onDone: () => {
      connections.delete(id);
      if (!log.ended) scheduleRetry(id);
    },
    onError: () => {
      connections.delete(id);
      if (!log.ended) scheduleRetry(id);
    },
  });
  connections.set(id, stop);
}

function scheduleRetry(id: string) {
  const attempt = (retryCount.get(id) ?? 0) + 1;
  retryCount.set(id, attempt);
  const delay = Math.min(1000 * 2 ** (attempt - 1), 15_000);
  const timer = setTimeout(async () => {
    retryTimers.delete(id);
    try {
      // Confirms the run still exists before reopening — a pruned or unknown
      // run would otherwise be retried forever.
      const run = await runsApi.get(id);
      useRunsStore.getState().upsert(run);
    } catch (err) {
      const status = (err as { response?: { status?: number } })?.response?.status;
      if (status === 404) {
        forgetRun(id);
        return;
      }
    }
    connectRun(id);
  }, delay);
  retryTimers.set(id, timer);
}

export function disconnectRun(id: string) {
  connections.get(id)?.();
  connections.delete(id);
  const timer = retryTimers.get(id);
  if (timer) clearTimeout(timer);
  retryTimers.delete(id);
  retryCount.delete(id);
}

/** Stop following a run and drop everything held for it. */
export function forgetRun(id: string) {
  disconnectRun(id);
  logs.delete(id);
  progress.delete(id);
  useRunsStore.getState().remove(id);
}

/* ── Entry points for pages ───────────────────────────────────────────── */

/** Ask the server to stop a run. Its `run_end` arrives through the stream. */
export async function stopRun(id: string) {
  try {
    await runsApi.cancel(id);
  } catch (err) {
    toast.error(`Could not stop the run: ${errorMessage(err)}`);
  }
}

/** Track a run this browser just started, and start following it. */
export function trackStartedRun(run: BackgroundRun) {
  useRunsStore.getState().upsert(run, { seen: false });
  connectRun(run.id);
}

/**
 * Make sure a run is known and its log is loading — used when a page is opened
 * on a run it did not start (a link, a reload, the indicator). Resolves to
 * false when the server has never heard of it.
 */
export async function ensureRun(id: string): Promise<boolean> {
  if (!isBrowser()) return false;
  const known = useRunsStore.getState().runs[id];
  if (!known) {
    try {
      const run = await runsApi.get(id);
      useRunsStore.getState().upsert(run, { seen: run.status !== "running" });
    } catch {
      return false;
    }
  }
  connectRun(id);
  return true;
}

/** Fold the latest server listing into what this browser tracks. */
export function mergeServerRuns(runs: BackgroundRun[]) {
  const store = useRunsStore.getState();
  for (const run of runs) {
    const local = store.runs[run.id];
    if (!local) {
      // Started elsewhere (another tab or browser) and still going — show it.
      if (run.status === "running") {
        store.upsert(run, { seen: false });
        connectRun(run.id);
      }
      continue;
    }
    if (local.status === "running" && run.status !== "running") {
      // Finished while nothing here was listening (the tab was closed, or the
      // stream was between retries). The stream, if open, settles it too.
      if (!connections.has(run.id)) {
        settleRun(run.id, {
          status: run.status,
          result: run.result,
          error: run.error,
          finished_at: run.finished_at,
        });
      }
    } else if (local.status === "running" && !connections.has(run.id)) {
      store.upsert(run);
      connectRun(run.id);
    }
  }
}
