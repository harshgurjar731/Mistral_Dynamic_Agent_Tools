import { AlertCircle, CheckCircle2, Clock, GitBranch, Loader2, Trash2 } from "lucide-react";
import type { PlannerRun } from "@/stores/plannerHistory";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** A history row: a run kept in this browser, or one reconstructed from a saved workflow. */
export interface PlannerHistoryEntry extends PlannerRun {
  fromBackend?: boolean;
}

function HistorySkeleton() {
  return (
    <div className="space-y-3">
      {[0, 1, 2].map((i) => (
        <div key={i} className="animate-pulse rounded-xl border border-border p-4">
          <div className="mb-3 flex items-start justify-between gap-2">
            <div className="flex-1 space-y-2">
              <div className="h-4 w-4/5 rounded bg-surface-hover" />
              <div className="h-3 w-3/5 rounded bg-surface-hover" />
            </div>
            <div className="h-5 w-16 shrink-0 rounded-full bg-surface-hover" />
          </div>
          <div className="flex items-center justify-between border-t border-border pt-2">
            <div className="h-3 w-1/4 rounded bg-surface-hover" />
            <div className="h-3 w-1/5 rounded bg-surface-hover" />
          </div>
        </div>
      ))}
    </div>
  );
}

function outcome(entry: PlannerHistoryEntry) {
  if (entry.status === "failed") {
    return { label: "Failed", icon: AlertCircle, cls: "border-red/25 bg-red/10 text-red" };
  }
  if (entry.status === "cancelled") {
    return { label: "Stopped", icon: AlertCircle, cls: "border-slate/25 bg-slate/10 text-slate" };
  }
  if (entry.workflowName) {
    return {
      label: "Success",
      icon: CheckCircle2,
      cls: "border-emerald/25 bg-emerald/10 text-emerald",
    };
  }
  return {
    label: "Incomplete",
    icon: AlertCircle,
    cls: "border-border bg-background-elevated text-muted-foreground",
  };
}

export function PlannerHistorySheet({
  open,
  onOpenChange,
  history,
  activeId,
  isLoading,
  onSelect,
  onClear,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  history: PlannerHistoryEntry[];
  activeId: string | null;
  isLoading: boolean;
  onSelect: (entry: PlannerHistoryEntry) => void;
  onClear: () => void;
}) {
  const hasLocal = history.some((h) => !h.fromBackend);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="flex w-[400px] max-w-[100vw] flex-col gap-0 p-0 sm:max-w-[400px]">
        <div className="flex items-center gap-2 border-b border-border px-6 py-4">
          <Clock className="size-4 text-primary" />
          <SheetTitle className="text-sm font-semibold text-foreground">
            Planning History
          </SheetTitle>
          {isLoading ? <Loader2 className="size-3.5 animate-spin text-muted-foreground" /> : null}
          <SheetDescription className="sr-only">
            Past planner runs and saved workflows. Select one to view its timeline.
          </SheetDescription>
        </div>

        <div className="custom-scrollbar flex-1 space-y-3 overflow-y-auto p-4">
          {isLoading && history.length === 0 ? (
            <HistorySkeleton />
          ) : history.length === 0 ? (
            <div className="flex h-48 flex-col items-center justify-center px-4 text-center">
              <GitBranch className="mb-3 size-6 text-muted-foreground" />
              <p className="text-sm text-foreground">No planning history yet.</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Start planning a workflow to see its timeline here.
              </p>
            </div>
          ) : (
            history.map((entry) => {
              const o = outcome(entry);
              const Icon = o.icon;
              return (
                <button
                  key={entry.id}
                  type="button"
                  onClick={() => onSelect(entry)}
                  className={cn(
                    "group w-full rounded-xl border p-4 text-left glass transition-colors hover:border-primary/50",
                    entry.id === activeId ? "border-primary/50 bg-primary/5" : "border-border",
                  )}
                >
                  <div className="mb-2 flex items-start justify-between gap-2">
                    <p className="line-clamp-2 text-sm leading-snug font-medium text-foreground">
                      {entry.goal}
                    </p>
                    <span
                      className={cn(
                        "flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase",
                        o.cls,
                      )}
                    >
                      <Icon className="size-2.5" />
                      {o.label}
                    </span>
                  </div>
                  {entry.workflowName && entry.status !== "failed" ? (
                    <p className="mb-3 font-mono text-xs text-primary">{entry.workflowName}</p>
                  ) : null}
                  <div className="mt-2 flex items-center justify-between border-t border-border pt-2 text-[10px] text-muted-foreground">
                    <span>
                      {entry.fromBackend
                        ? "Saved workflow"
                        : new Date(entry.createdAt).toLocaleString()}
                    </span>
                    <span className="flex items-center gap-1 text-primary opacity-0 transition-opacity group-hover:opacity-100">
                      <Clock className="size-2.5" /> View timeline
                    </span>
                  </div>
                </button>
              );
            })
          )}
        </div>

        {hasLocal ? (
          <div className="border-t border-border p-4">
            <Button
              variant="ghost"
              onClick={onClear}
              className="w-full bg-red/10 text-red hover:bg-red/15 hover:text-red"
            >
              <Trash2 className="size-4" /> Clear History
            </Button>
          </div>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
