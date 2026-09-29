import { Loader2, Square } from "lucide-react";
import type { TrackedRun } from "@/stores/runs";
import { useElapsed } from "@/lib/runs/useRun";
import { cn } from "@/lib/utils";
import { formatElapsed, RUN_KIND_META, RUN_STATUS_META } from "./runMeta";

export function RunProgressBar({
  run,
  className,
}: {
  run: Pick<TrackedRun, "kind" | "status" | "progress">;
  className?: string | undefined;
}) {
  const { total, done } = run.progress ?? { total: 0, done: 0 };
  const running = run.status === "running";
  // Until a manifest arrives there is nothing to count — show motion instead.
  const pct = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : running ? 8 : 100;
  return (
    <div className={cn("h-1 w-full overflow-hidden rounded-full bg-border/60", className)}>
      <div
        className={cn(
          "h-full rounded-full transition-[width] duration-500 ease-out",
          running ? RUN_KIND_META[run.kind].bar : RUN_STATUS_META[run.status].bar,
          running && total === 0 && "animate-pulse",
        )}
        style={{ width: `${Math.max(pct, 4)}%` }}
      />
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
          <Loader2 className={cn("size-3.5 animate-spin", meta.text)} />
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
            {done}/{total}
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
      <RunProgressBar run={run} className="mt-2" />
      {running && note ? (
        <p className="mt-1.5 line-clamp-2 text-[11px] text-muted-foreground">{note}</p>
      ) : null}
    </div>
  );
}
