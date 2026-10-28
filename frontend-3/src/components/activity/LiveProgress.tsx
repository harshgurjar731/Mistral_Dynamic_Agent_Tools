/**
 * Live numbers for the app's loaders, so a spinner never sits there alone.
 *
 * - `LivePercent` sits beside a spinner's label: the page-data percentage for
 *   a "Loading…" spinner, or the newest action's percentage for a busy button.
 *   When the work cannot be measured it shows the seconds elapsed instead.
 * - `PageLoadProgress` is the header of the shared skeletons: a bar with the
 *   page-data percentage and what is still loading.
 */
import { useEffect, useState } from "react";
import { opActivity, opFraction } from "@/lib/ops/describe";
import { cn } from "@/lib/utils";
import { useOpsStore, type TrackedOp } from "@/stores/ops";
import { LiveBar } from "./LiveBar";
import { isLoading, loadPercent, usePageLoad } from "./usePageLoad";

function useTick(live: boolean, ms = 500) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!live) return;
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [live, ms]);
  return now;
}

/** The most recently started request of a kind that is still going. */
function useNewestPending(background: boolean): TrackedOp | undefined {
  return useOpsStore((s) => {
    let newest: TrackedOp | undefined;
    for (const op of Object.values(s.ops)) {
      if (op.background !== background || op.status !== "pending") continue;
      if (!newest || op.startedAt > newest.startedAt) newest = op;
    }
    return newest;
  });
}

const seconds = (ms: number) => `${Math.max(0, Math.floor(ms / 1000))}s`;

export function LivePercent({
  mode = "action",
  className,
}: {
  /** "load": page data. "action": the newest action (a button's work). */
  mode?: "load" | "action";
  className?: string | undefined;
}) {
  const load = usePageLoad();
  const action = useNewestPending(false);
  const read = useNewestPending(true);
  const loading = isLoading(load);
  const now = useTick(mode === "load" ? loading || !!read : !!action);

  let text: string | null = null;
  if (mode === "load") {
    const pct = loadPercent(load);
    if (pct !== null && load.started > 1) text = `${pct}%`;
    else if (read) text = seconds(now - read.startedAt);
    else if (loading && load.since) text = seconds(now - load.since);
  } else if (action) {
    const f = opFraction(action);
    text = f !== null ? `${Math.min(99, Math.round(f * 100))}%` : seconds(now - action.startedAt);
  }
  if (!text) return null;
  return (
    <span
      className={cn("ml-1 font-mono text-[0.9em] tabular-nums opacity-80", className)}
      title={mode === "action" && action ? opActivity(action) : undefined}
    >
      {text}
    </span>
  );
}

export function PageLoadProgress({ className }: { className?: string | undefined }) {
  const load = usePageLoad();
  const read = useNewestPending(true);
  const loading = isLoading(load);
  const now = useTick(loading);
  if (!loading) return null;
  const pct = loadPercent(load) ?? 0;
  const slow = read ? (read.stage || read.note ? opActivity(read) : read.label) : null;
  return (
    <div className={cn("mb-4 space-y-1.5", className)} role="status" aria-live="polite">
      <div className="flex items-center justify-between gap-3 text-[11px] text-muted-foreground">
        <span className="min-w-0 truncate">
          Loading page data
          {load.started ? (
            <span className="tabular-nums">
              {" "}
              · {load.settled} of {load.started} ready
            </span>
          ) : null}
          {slow ? <span> · {slow}</span> : null}
        </span>
        <span className="shrink-0 font-mono tabular-nums">
          {load.since ? `${seconds(now - load.since)} · ` : ""}
          <span className="font-semibold text-foreground">{pct}%</span>
        </span>
      </div>
      <LiveBar value={load.started ? pct / 100 : null} className="h-1.5" />
    </div>
  );
}
