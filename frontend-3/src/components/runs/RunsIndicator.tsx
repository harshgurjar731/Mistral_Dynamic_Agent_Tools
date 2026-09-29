/**
 * Header indicator for background runs — what is still going, and what
 * finished while the user was elsewhere.
 */
import { useMemo, useState } from "react";
import { ArrowUpRight, Layers, Loader2, X } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { forgetRun, stopRun } from "@/lib/runs/connections";
import { useElapsed } from "@/lib/runs/useRun";
import { formatRelative } from "@/lib/status";
import { cn } from "@/lib/utils";
import { useRunsStore, type TrackedRun } from "@/stores/runs";
import { RunProgressBar } from "./RunProgress";
import {
  formatElapsed,
  RUN_KIND_META,
  RUN_STATUS_META,
  runOutputName,
  useOpenRun,
} from "./runMeta";

function RunRow({ run, onOpen }: { run: TrackedRun; onOpen: (run: TrackedRun) => void }) {
  const running = run.status === "running";
  const kind = RUN_KIND_META[run.kind];
  const status = RUN_STATUS_META[run.status];
  const KindIcon = kind.icon;
  const elapsed = useElapsed(run.created_at, running, run.finished_at);
  const output = runOutputName(run);
  const { total, done, label, note } = run.progress ?? { total: 0, done: 0 };
  const unseen = !running && !run.seen;

  return (
    <div
      className={cn(
        "group relative rounded-lg border border-transparent px-3 py-2.5 transition hover:border-border hover:bg-surface-hover",
        unseen && "bg-surface/60",
      )}
    >
      {unseen ? (
        <span
          aria-label="New"
          className={cn("absolute top-3.5 left-1 size-1.5 rounded-full", status.bar)}
        />
      ) : null}
      <div className="flex items-start gap-2.5">
        <span
          className={cn(
            "mt-0.5 grid size-7 shrink-0 place-items-center rounded-md border",
            kind.chip,
          )}
        >
          <KindIcon className="size-3.5" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => onOpen(run)}
              className="min-w-0 flex-1 truncate text-left text-xs font-medium text-foreground hover:underline"
              title={run.title}
            >
              {output && run.status === "completed" ? output : run.title || kind.label}
            </button>
            <span
              className={cn(
                "inline-flex shrink-0 items-center gap-1 rounded-full border px-1.5 py-0.5 text-[9px] font-semibold tracking-wider uppercase",
                status.chip,
              )}
            >
              {running ? <Loader2 className="size-2.5 animate-spin" /> : null}
              {status.label}
            </span>
          </div>
          <p className="mt-0.5 flex items-center gap-1.5 text-[10px] text-muted-foreground">
            <span className={kind.text}>{kind.label}</span>
            <span aria-hidden>·</span>
            <span className="tabular-nums">
              {running
                ? formatElapsed(elapsed)
                : formatRelative(run.finished_at ?? run.created_at ?? undefined)}
            </span>
            {total > 0 && running ? (
              <>
                <span aria-hidden>·</span>
                <span className="tabular-nums">
                  step {Math.min(done + 1, total)} of {total}
                </span>
              </>
            ) : null}
          </p>

          {running ? (
            <>
              <RunProgressBar run={run} className="mt-2" />
              {label || note ? (
                <p className="mt-1.5 truncate text-[11px] text-muted-foreground" title={note ?? ""}>
                  {label ? <span className="text-foreground/80">{label}</span> : null}
                  {label && note ? " — " : null}
                  {note}
                </p>
              ) : null}
            </>
          ) : run.status !== "completed" && run.error ? (
            <p className="mt-1 line-clamp-2 text-[11px] text-muted-foreground">{run.error}</p>
          ) : null}

          <div className="mt-2 flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => onOpen(run)}
              className="inline-flex items-center gap-1 rounded-md border border-border/60 px-2 py-0.5 text-[10px] font-medium text-foreground transition hover:border-primary/40 hover:text-primary"
            >
              {running ? "Watch" : "Open"} <ArrowUpRight className="size-2.5" />
            </button>
            {running ? (
              <button
                type="button"
                onClick={() => void stopRun(run.id)}
                className="rounded-md px-2 py-0.5 text-[10px] text-muted-foreground transition hover:text-red"
              >
                Stop
              </button>
            ) : (
              <button
                type="button"
                aria-label="Dismiss"
                onClick={() => forgetRun(run.id)}
                className="ml-auto rounded-md p-1 text-muted-foreground opacity-0 transition group-hover:opacity-100 hover:text-foreground focus:opacity-100"
              >
                <X className="size-3" />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export function RunsIndicator({
  variant = "pill",
  collapsed = false,
}: {
  /** "rail" is a full-width row for the sidebar; "pill" sits in a header. */
  variant?: "pill" | "rail";
  collapsed?: boolean;
} = {}) {
  const [open, setOpen] = useState(false);
  const runsMap = useRunsStore((s) => s.runs);
  const clearFinished = useRunsStore((s) => s.clearFinished);
  const openRun = useOpenRun();

  const { running, finished, unseen, unseenFailed } = useMemo(() => {
    const all = Object.values(runsMap).sort((a, b) =>
      (b.created_at ?? "").localeCompare(a.created_at ?? ""),
    );
    const runningRuns = all.filter((r) => r.status === "running");
    const finishedRuns = all.filter((r) => r.status !== "running");
    const unseenRuns = finishedRuns.filter((r) => !r.seen);
    return {
      running: runningRuns,
      finished: finishedRuns.slice(0, 10),
      unseen: unseenRuns.length,
      unseenFailed: unseenRuns.some((r) => r.status === "failed" || r.status === "interrupted"),
    };
  }, [runsMap]);

  const handleOpen = (run: TrackedRun) => {
    setOpen(false);
    if (run.status !== "running") useRunsStore.getState().markSeen(run.id);
    openRun(run);
  };

  const railLabel = running.length
    ? `${running.length} running`
    : unseen
      ? `${unseen} finished`
      : "Background runs";
  const railTone = running.length
    ? "text-primary"
    : unseen
      ? unseenFailed
        ? "text-red"
        : "text-emerald"
      : "text-muted-foreground";

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        {variant === "rail" ? (
          <button
            type="button"
            aria-label={railLabel}
            title={collapsed ? railLabel : undefined}
            className={cn(
              "relative flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-xs font-medium transition hover:bg-surface-hover hover:text-foreground",
              collapsed && "justify-center",
              railTone,
            )}
          >
            {running.length ? (
              <Loader2 className="size-4 shrink-0 animate-spin" />
            ) : (
              <Layers className="size-4 shrink-0" />
            )}
            {collapsed ? null : <span className="truncate">{railLabel}</span>}
            {unseen > 0 ? (
              <span
                className={cn(
                  "size-1.5 shrink-0 rounded-full",
                  collapsed ? "absolute top-1.5 right-2.5" : "ml-auto",
                  unseenFailed ? "bg-red" : "bg-emerald",
                )}
              />
            ) : null}
          </button>
        ) : running.length > 0 ? (
          <button
            type="button"
            className="inline-flex items-center gap-1.5 rounded-full border border-primary/30 bg-primary/10 px-2.5 py-1 text-[11px] font-medium text-primary transition hover:bg-primary/15"
          >
            <Loader2 className="size-3 animate-spin" />
            {running.length} running
            {unseen > 0 ? (
              <span
                className={cn(
                  "ml-0.5 size-1.5 rounded-full",
                  unseenFailed ? "bg-red" : "bg-emerald",
                )}
              />
            ) : null}
          </button>
        ) : unseen > 0 ? (
          <button
            type="button"
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium transition",
              unseenFailed
                ? "border-red/30 bg-red/10 text-red hover:bg-red/15"
                : "border-emerald/30 bg-emerald/10 text-emerald hover:bg-emerald/15",
            )}
          >
            <span className={cn("size-1.5 rounded-full", unseenFailed ? "bg-red" : "bg-emerald")} />
            {unseen} finished
          </button>
        ) : (
          <button
            type="button"
            aria-label="Background runs"
            title="Background runs"
            className="grid size-7 place-items-center rounded-full border border-border/60 text-muted-foreground transition hover:border-border hover:text-foreground"
          >
            <Layers className="size-3.5" />
          </button>
        )}
      </PopoverTrigger>
      <PopoverContent
        align="end"
        side={variant === "rail" ? "right" : "bottom"}
        sideOffset={8}
        className="w-[380px] max-w-[calc(100vw-2rem)] p-0"
      >
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <div>
            <p className="text-sm font-semibold text-foreground">Background runs</p>
            <p className="text-[11px] text-muted-foreground">Keep going when you leave the page.</p>
          </div>
          {finished.length > 0 ? (
            <button
              type="button"
              onClick={clearFinished}
              className="rounded-md px-2 py-1 text-[11px] text-muted-foreground transition hover:bg-surface-hover hover:text-foreground"
            >
              Clear finished
            </button>
          ) : null}
        </div>

        <div className="custom-scrollbar max-h-[min(460px,70vh)] overflow-y-auto p-1.5">
          {running.length === 0 && finished.length === 0 ? (
            <div className="px-6 py-10 text-center">
              <div className="mx-auto grid size-10 place-items-center rounded-xl border border-border/60 bg-surface/40">
                <Layers className="size-4 text-muted-foreground" />
              </div>
              <p className="mt-3 text-xs font-medium text-foreground">Nothing running</p>
              <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
                Workflow plans, agents, agent tools and activities you create show up here, and keep
                running if you navigate away.
              </p>
            </div>
          ) : null}

          {running.length > 0 ? (
            <>
              <p className="technical-label px-2.5 pt-1.5 pb-1 text-muted-foreground">
                In progress
              </p>
              {running.map((run) => (
                <RunRow key={run.id} run={run} onOpen={handleOpen} />
              ))}
            </>
          ) : null}

          {finished.length > 0 ? (
            <>
              <p className="technical-label px-2.5 pt-2.5 pb-1 text-muted-foreground">Recent</p>
              {finished.map((run) => (
                <RunRow key={run.id} run={run} onOpen={handleOpen} />
              ))}
            </>
          ) : null}
        </div>
      </PopoverContent>
    </Popover>
  );
}
