import { Loader2, Square } from "lucide-react";
import type { TrackedRun } from "@/stores/runs";
import { useElapsed } from "@/lib/runs/useRun";
import { cn } from "@/lib/utils";
import { formatElapsed, RUN_KIND_META, RUN_STATUS_META } from "./runMeta";
import { LivePercent } from "@/components/activity/LiveProgress";

/**
 * How far a run has got, 0–100: finished layers plus the running layer's
 * measured share. Null while there is nothing to count yet (no manifest).
 */
export function runPercent(run: Pick<TrackedRun, "status" | "progress">): number | null {
  if (run.status !== "running") return 100;
  const { total, done, fraction } = run.progress ?? { total: 0, done: 0 };
  if (!total) return null;
  const f = typeof fraction === "number" ? fraction : done / total;
  return Math.min(99, Math.max(0, Math.round(f * 100)));
}

export function RunProgressBar({
  run,
  showPercent = false,
  className,
}: {
  run: Pick<TrackedRun, "kind" | "status" | "progress">;
  /** Print the percentage beside the bar. */
  showPercent?: boolean;
  className?: string | undefined;
}) {
  const running = run.status === "running";
  const pct = runPercent(run);
  const bar = (
    <div
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={pct ?? undefined}
      className={cn(
        "relative h-1.5 w-full overflow-hidden rounded-full bg-border/60",
        !showPercent && className,
      )}
    >
      {pct === null ? (
        // Until a manifest arrives there is nothing to count — show motion instead.
        <div
          className={cn(
            "progress-indeterminate absolute inset-y-0 w-1/4 rounded-full",
            RUN_KIND_META[run.kind].bar,
          )}
        />
      ) : (
        <div
          className={cn(
            "h-full rounded-full transition-[width] duration-500 ease-out",
            running ? RUN_KIND_META[run.kind].bar : RUN_STATUS_META[run.status].bar,
          )}
          style={{ width: `${Math.max(pct, 2)}%` }}
        />
      )}
    </div>
  );
  if (!showPercent) return bar;
  return (
    <div className={cn("flex items-center gap-2", className)}>
      <div className="min-w-0 flex-1">{bar}</div>
      <span className="w-9 shrink-0 text-right font-mono text-[11px] font-semibold text-foreground tabular-nums">
        {pct === null ? "…" : `${pct}%`}
      </span>
    </div>
  );
}

/**
 * A compact live status block for a run — used inside dialogs that start one,
 * so closing the dialog visibly hands the work to the background.
 */
export function RunProgressCard({
  run,
  onStop,
  className,
}: {
  run: TrackedRun;
  onStop?: (() => void) | undefined;
  className?: string | undefined;
}) {
  const running = run.status === "running";
  const elapsed = useElapsed(run.created_at, running, run.finished_at);
  const meta = RUN_KIND_META[run.kind];
  const { total, done, label, note } = run.progress ?? { total: 0, done: 0 };
  return (
    <div className={cn("rounded-lg border p-3", meta.box, className)}>
      <div className="flex items-center gap-2 text-xs font-medium">
        {running ? (
          <>
            <Loader2 className={cn("size-3.5 animate-spin", meta.text)} />
            <LivePercent />
          </>
        ) : (
          (() => {
            const Icon = RUN_STATUS_META[run.status].icon;
            return <Icon className={cn("size-3.5", RUN_STATUS_META[run.status].text)} />;
          })()
        )}
        <span className="min-w-0 flex-1 truncate text-foreground">
          {running ? (label ?? "Starting…") : RUN_STATUS_META[run.status].label}
        </span>
        {total > 0 ? (
          <span className="font-mono text-[10px] text-muted-foreground tabular-nums">
            step {Math.min(done + 1, total)}/{total}
          </span>
        ) : null}
        <span className="font-mono text-[10px] text-muted-foreground tabular-nums">
          {formatElapsed(elapsed)}
        </span>
        {running && onStop ? (
          <button
            type="button"
            onClick={onStop}
            className="inline-flex items-center gap-1 rounded-md border border-border/60 px-1.5 py-0.5 text-[10px] text-muted-foreground transition hover:border-red/40 hover:text-red"
          >
            <Square className="size-2.5" /> Stop
          </button>
        ) : null}
      </div>
      <RunProgressBar run={run} showPercent className="mt-2" />
      {running && note ? (
        <p className="mt-1.5 line-clamp-2 text-[11px] text-muted-foreground">{note}</p>
      ) : null}
    </div>
  );
}
