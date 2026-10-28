/**
 * Refine a saved workflow by conversation: say what to change, review the
 * proposal on the graph, apply it, undo it, publish when it is right.
 *
 * Used on its own page for any saved workflow, and inside the planner once a
 * plan has produced one — where `origin="planner"` marks the turns and
 * publishing is left to the planner's own Accept step.
 */
import { useState, type CSSProperties } from "react";
import { History, Loader2, Rocket, Undo2 } from "lucide-react";
import { ValidationSummary } from "@/components/workflows/ValidationPanel";
import { ResizeHandle, useResizablePanel } from "@/components/shared/ResizeHandle";
import { Button } from "@/components/ui/button";
import { ErrorState } from "@/components/ui/ErrorState";
import { cn } from "@/lib/utils";
import { RefineCanvas } from "./RefineCanvas";
import { RefineConversation } from "./RefineConversation";
import { useWorkflowRefine } from "./useWorkflowRefine";
import { VersionHistorySheet } from "./VersionHistorySheet";
import { LivePercent } from "@/components/activity/LiveProgress";

export function RefineWorkspace({
  workflowName,
  origin = "editor",
  allowPublish = true,
  className,
}: {
  workflowName: string;
  origin?: "editor" | "planner";
  /** False inside the planner, where Accept & register publishes. */
  allowPublish?: boolean;
  /** Sets the workspace height; the panes scroll inside it. */
  className?: string;
}) {
  const refine = useWorkflowRefine(workflowName, origin);
  const [versionsOpen, setVersionsOpen] = useState(false);
  const conversationPanel = useResizablePanel({
    storageKey: "refine-conversation",
    defaultWidth: 400,
    min: 320,
    max: 820,
    edge: "right",
  });
  const { definition, validation, versions } = refine;

  if (refine.workflow.isError) {
    return <ErrorState error={refine.workflow.error} onRetry={() => refine.workflow.refetch()} />;
  }
  if (!definition) {
    return (
      <div
        className={cn("shimmer rounded-2xl border border-border/50", className ?? "h-[640px]")}
      />
    );
  }

  const errors = validation.data?.error_count ?? 0;
  const dirty = definition.has_unpublished_changes || !definition.is_deployed;
  const versionCount = versions.data?.versions.length ?? 0;

  return (
    <div
      className={cn(
        "flex flex-col overflow-hidden rounded-2xl border border-border/50 bg-surface/40 backdrop-blur-sm",
        className ?? "h-[680px]",
      )}
    >
      {/* ── Toolbar ── */}
      <div className="flex flex-wrap items-center gap-2 border-b border-border/40 px-4 py-2.5">
        <ValidationSummary
          result={validation.data}
          pending={validation.isFetching && !validation.data}
        />
        {definition.is_deployed && !definition.has_unpublished_changes ? (
          <span className="inline-flex items-center gap-1 rounded border border-emerald/30 bg-emerald/10 px-2 py-1 font-mono text-[10px] font-bold text-emerald uppercase">
            <Rocket className="size-3" /> Live
          </span>
        ) : (
          <span
            className="inline-flex items-center gap-1 rounded border border-amber/30 bg-amber/10 px-2 py-1 font-mono text-[10px] font-bold text-amber uppercase"
            title={
              definition.is_deployed
                ? "The saved workflow differs from what is running. Publish to make it live."
                : "Saved locally — not published yet."
            }
          >
            {definition.is_deployed ? "Unpublished changes" : "Draft"}
          </span>
        )}

        <div className="ml-auto flex items-center gap-1.5">
          <Button
            size="sm"
            variant="ghost"
            className="h-8 text-xs"
            disabled={!versions.data?.can_undo || refine.undo.isPending}
            onClick={() => refine.undo.mutate()}
            title="Go back to the previous version"
          >
            {refine.undo.isPending ? (
              <>
                <Loader2 className="size-3.5 animate-spin" />
                <LivePercent />
              </>
            ) : (
              <Undo2 className="size-3.5" />
            )}
            Undo
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-8 text-xs"
            onClick={() => setVersionsOpen(true)}
          >
            <History className="size-3.5" />
            Versions{versionCount ? ` (${versionCount})` : ""}
          </Button>
          {allowPublish ? (
            <Button
              size="sm"
              disabled={refine.publish.isPending || errors > 0 || !dirty}
              onClick={() => refine.publish.mutate()}
              title={
                errors > 0
                  ? "Fix the errors before publishing"
                  : !dirty
                    ? "Everything saved is already live"
                    : "Compile and register the saved workflow so it runs"
              }
              className="h-8 rounded-lg bg-gradient-brand text-xs text-primary-foreground hover:opacity-90"
            >
              {refine.publish.isPending ? (
                <>
                  <Loader2 className="size-3.5 animate-spin" />
                  <LivePercent />
                </>
              ) : (
                <Rocket className="size-3.5" />
              )}
              {definition.is_deployed ? "Publish changes" : "Publish"}
            </Button>
          ) : null}
        </div>
      </div>

      {/* ── Conversation | Canvas ── */}
      <div
        className="grid min-h-0 flex-1 grid-rows-[minmax(280px,45%)_1fr] lg:grid-cols-[var(--refine-w)_minmax(0,1fr)] lg:grid-rows-1"
        style={{ "--refine-w": `${conversationPanel.width ?? 400}px` } as CSSProperties}
      >
        <div className="relative order-2 flex min-h-0 min-w-0 lg:order-1">
          <RefineConversation
            refine={refine}
            className="min-w-0 flex-1 border-t border-border/40 lg:border-t-0 lg:border-r"
          />
          <ResizeHandle
            panel={conversationPanel}
            label="Resize conversation"
            className="hidden lg:flex"
          />
        </div>
        <RefineCanvas refine={refine} className="order-1 min-w-0 lg:order-2" />
      </div>

      <VersionHistorySheet refine={refine} open={versionsOpen} onOpenChange={setVersionsOpen} />
    </div>
  );
}
