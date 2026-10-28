/**
 * Every saved state of a workflow, newest first, with restore.
 *
 * A version is recorded whenever the definition changes — an applied revision,
 * a save in the visual builder, a restore — so going back is always possible,
 * and restoring is itself a version that can be undone.
 */
import { useState } from "react";
import {
  Flag,
  History,
  Loader2,
  PencilRuler,
  RotateCcw,
  Rocket,
  Sparkles,
  Undo2,
} from "lucide-react";
import type { WorkflowVersion } from "@/types";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { formatRelative, formatTimestamp } from "@/lib/status";
import { cn } from "@/lib/utils";
import type { WorkflowRefine } from "./useWorkflowRefine";
import { LivePercent } from "@/components/activity/LiveProgress";

const SOURCE = {
  baseline: { icon: Flag, label: "Original" },
  revision: { icon: Sparkles, label: "AI revision" },
  builder: { icon: PencilRuler, label: "Visual builder" },
  restore: { icon: Undo2, label: "Restore" },
} as const;

export function VersionHistorySheet({
  refine,
  open,
  onOpenChange,
}: {
  refine: WorkflowRefine;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [armed, setArmed] = useState<number | null>(null);
  const versions = refine.versions.data?.versions ?? [];

  const restore = (v: WorkflowVersion) => {
    if (armed !== v.version_no) {
      setArmed(v.version_no);
      return;
    }
    setArmed(null);
    refine.restore.mutate(v.version_no);
  };

  return (
    <Sheet
      open={open}
      onOpenChange={(o) => {
        setArmed(null);
        onOpenChange(o);
      }}
    >
      <SheetContent
        resizeKey="version-history"
        className="flex w-full flex-col gap-0 border-border bg-background-elevated/95 p-0 backdrop-blur-xl sm:max-w-md"
      >
        <div className="border-b border-border/60 px-5 py-4">
          <SheetTitle className="flex items-center gap-2 text-base">
            <History className="size-4 text-primary" /> Version history
          </SheetTitle>
          <SheetDescription className="mt-1 text-xs">
            Every change is saved as a version. Restoring one keeps everything after it, so it can
            be undone too.
          </SheetDescription>
        </div>

        <div className="custom-scrollbar flex-1 space-y-2 overflow-y-auto p-4">
          {refine.versions.isLoading ? (
            [0, 1, 2].map((i) => (
              <div key={i} className="shimmer h-16 rounded-xl border border-border/50" />
            ))
          ) : versions.length === 0 ? (
            <p className="rounded-xl border border-dashed border-border/60 px-4 py-6 text-center text-xs text-muted-foreground">
              No versions yet. The first change you apply records the original alongside it.
            </p>
          ) : (
            versions.map((v) => {
              const meta = SOURCE[v.source] ?? SOURCE.revision;
              const isArmed = armed === v.version_no;
              const restoring =
                refine.restore.isPending && refine.restore.variables === v.version_no;
              return (
                <div
                  key={v.version_no}
                  className={cn(
                    "rounded-xl border px-3.5 py-3 transition",
                    v.is_current
                      ? "border-primary/40 bg-primary/5"
                      : "border-border/60 bg-surface/30",
                  )}
                >
                  <div className="flex items-start gap-2.5">
                    <span className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-lg border border-border/60 bg-background-elevated/70">
                      <meta.icon className="size-3.5 text-primary" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="font-mono text-xs font-semibold text-foreground">
                          v{v.version_no}
                        </span>
                        <span className="text-[10px] text-muted-foreground">{meta.label}</span>
                        {v.is_current ? (
                          <span className="rounded-full border border-primary/30 bg-primary/10 px-1.5 py-px text-[9px] font-semibold text-primary uppercase">
                            Current
                          </span>
                        ) : null}
                        {v.is_published ? (
                          <span className="inline-flex items-center gap-0.5 rounded-full border border-emerald/30 bg-emerald/10 px-1.5 py-px text-[9px] font-semibold text-emerald uppercase">
                            <Rocket className="size-2.5" /> Live
                          </span>
                        ) : null}
                      </div>
                      <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-foreground/90">
                        {v.label || "Saved"}
                      </p>
                      <p
                        className="mt-1 text-[10px] text-muted-foreground"
                        title={formatTimestamp(v.created_at)}
                      >
                        {formatRelative(v.created_at)} · {v.step_count} step
                        {v.step_count === 1 ? "" : "s"}
                      </p>
                    </div>
                    {!v.is_current ? (
                      <Button
                        size="sm"
                        variant={isArmed ? "default" : "outline"}
                        className="h-7 shrink-0 text-[11px]"
                        disabled={refine.restore.isPending}
                        onClick={() => restore(v)}
                      >
                        {restoring ? (
                          <>
                            <Loader2 className="size-3 animate-spin" />
                            <LivePercent />
                          </>
                        ) : (
                          <RotateCcw className="size-3" />
                        )}
                        {isArmed ? "Confirm" : "Restore"}
                      </Button>
                    ) : null}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
