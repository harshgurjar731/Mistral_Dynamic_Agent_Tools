/**
 * Progress notices for background syntheses and rebuilds, on every page.
 *
 * A run whose dialog is open (focused) shows its progress there; close the
 * dialog and its notice appears here instead, with a way straight back into
 * the dialog. Each notice can be minimised to one line or closed — closing
 * only hides the notice, the run keeps going (and stays in the runs indicator).
 */
import { ArrowUpRight, Maximize2, Minus, Square, X } from "lucide-react";
import { stopRun } from "@/lib/runs/connections";
import { useElapsed } from "@/lib/runs/useRun";
import { isRebuildRun } from "@/lib/runs/synthesis";
import { cn } from "@/lib/utils";
import { useRunUiStore, type TrackedRun } from "@/stores/runs";
import { RunProgressBar, runPercent } from "./RunProgress";
import { formatElapsed, RUN_KIND_META, useOpenRun } from "./runMeta";

const iconButton =
  "shrink-0 rounded p-0.5 text-muted-foreground transition hover:bg-surface-hover hover:text-foreground";

export function RunNotice({ run }: { run: TrackedRun }) {
  const openRun = useOpenRun();
  const minimized = useRunUiStore((s) => Boolean(s.minimized[run.id]));
  const { setMinimized, dismiss } = useRunUiStore.getState();
  const elapsed = useElapsed(run.created_at, true, run.finished_at);
  const meta = RUN_KIND_META[run.kind];
  const KindIcon = meta.icon;
  const rebuild = isRebuildRun(run);
  const heading = rebuild ? `Rebuilding ${meta.noun.toLowerCase()}` : `${meta.label}`;
  const pct = runPercent(run);
  const { label, note } = run.progress ?? { total: 0, done: 0 };

  const closeBtn = (
    <button
      type="button"
      onClick={() => dismiss(run.id)}
      aria-label="Close notification (the run keeps going)"
      title="Close — the run keeps going"
      className={iconButton}
    >
      <X className="size-3.5" />
    </button>
  );

  if (minimized) {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-border glass-elevated px-3 py-2 shadow-lg">
        <KindIcon className={cn("size-3.5 shrink-0", meta.text)} />
        <button
          type="button"
          onClick={() => openRun(run)}
          className="min-w-0 flex-1 truncate text-left text-xs font-medium text-foreground hover:underline"
          title={`Open — ${run.title}`}
        >
          {heading}
        </button>
        <span className="shrink-0 font-mono text-[10px] font-semibold text-foreground tabular-nums">
          {pct === null ? "…" : `${pct}%`}
        </span>
        <button
          type="button"
          onClick={() => setMinimized(run.id, false)}
          aria-label="Expand notification"
          title="Expand"
          className={iconButton}
        >
          <Maximize2 className="size-3" />
        </button>
        {closeBtn}
      </div>
    );
  }

  return (
    <div className={cn("rounded-xl border glass-elevated p-3 shadow-lg", meta.box)}>
      <div className="flex items-center gap-2 text-xs">
        <span
          className={cn("grid size-6 shrink-0 place-items-center rounded-md border", meta.chip)}
        >
          <KindIcon className="size-3" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium text-foreground">{heading}</p>
          <p className="truncate text-[10px] text-muted-foreground" title={run.title}>
            {run.title}
          </p>
        </div>
        <span className="shrink-0 font-mono text-[10px] text-muted-foreground tabular-nums">
          {formatElapsed(elapsed)}
        </span>
        <button
          type="button"
          onClick={() => setMinimized(run.id, true)}
          aria-label="Minimise notification"
          title="Minimise"
          className={iconButton}
        >
          <Minus className="size-3.5" />
        </button>
        {closeBtn}
      </div>

      <RunProgressBar run={run} showPercent className="mt-2" />
      <p className="mt-1.5 truncate text-[11px] text-muted-foreground" title={note ?? undefined}>
        {note ?? label ?? "Starting…"}
      </p>

      <div className="mt-2 flex items-center justify-end gap-1.5">
        <button
          type="button"
          onClick={() => void stopRun(run.id)}
          className="inline-flex items-center gap-1 rounded-md border border-border/60 px-2 py-1 text-[10px] text-muted-foreground transition hover:border-red/40 hover:text-red"
        >
          <Square className="size-2.5" /> Stop
        </button>
        <button
          type="button"
          onClick={() => openRun(run)}
          className="inline-flex items-center gap-1 rounded-md border border-border/60 bg-background-elevated px-2 py-1 text-[10px] font-medium text-foreground transition hover:border-primary/40 hover:text-primary"
        >
          <ArrowUpRight className="size-3" /> Open progress
        </button>
      </div>
    </div>
  );
}
