/**
 * The refine canvas: the workflow as it is, or a proposal previewed over it.
 *
 * Clicking a step opens a small action bar — focus the conversation on it, see
 * its details, or make a direct edit (remove it, start the workflow there).
 * A direct edit is still a proposal: it gets the same diff and review as one
 * typed in words, and nothing changes until it is applied.
 */
import { useMemo, useState } from "react";
import {
  Columns,
  Crosshair,
  Eye,
  Flag,
  Info,
  Minus,
  PencilLine,
  Plus,
  Rows,
  Trash2,
  X,
} from "lucide-react";
import { GraphCanvas } from "@/components/graph/GraphCanvas";
import { summarizeStep } from "@/components/graph/stepSummary";
import { StepDetailsDialog } from "@/components/workflows/StepDetailsDialog";
import { Button } from "@/components/ui/button";
import { STEP_TYPE_IDENTITY } from "@/lib/status";
import { cn } from "@/lib/utils";
import { revisionGraph } from "./revisionGraph";
import type { WorkflowRefine } from "./useWorkflowRefine";

export function RefineCanvas({
  refine,
  className,
}: {
  refine: WorkflowRefine;
  className?: string;
}) {
  const { definition, preview, focus, validation, catalog } = refine;
  const [direction, setDirection] = useState<"LR" | "TB">("LR");
  const [selected, setSelected] = useState<string | null>(null);
  const [detailsFor, setDetailsFor] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);

  const focusSet = useMemo(() => new Set(focus), [focus]);
  const graph = useMemo(
    () =>
      definition
        ? revisionGraph({
            current: definition,
            preview,
            issues: validation.data?.issues ?? [],
            direction,
            focus: focusSet,
          })
        : { nodes: [], edges: [] },
    [definition, preview, validation.data, direction, focusSet],
  );

  // While previewing, steps are those of the proposal; otherwise the workflow's.
  const shown = preview?.proposed_definition ?? definition;
  const selectedStep =
    shown?.steps.find((s) => s.id === selected) ??
    definition?.steps.find((s) => s.id === selected) ??
    null;
  const busy = refine.propose.isPending;

  const select = (id: string | null) => {
    setSelected(id);
    setConfirmRemove(false);
  };

  const removeSelected = () => {
    if (!selectedStep) return;
    if (!confirmRemove) {
      setConfirmRemove(true);
      return;
    }
    refine.propose.mutate({ operations: [{ op: "remove_step", step_id: selectedStep.id }] });
    select(null);
  };

  const stats = preview?.diff?.stats;

  return (
    <div className={cn("relative min-h-0", className)}>
      <GraphCanvas
        nodes={graph.nodes}
        edges={graph.edges}
        readOnly
        catalog={catalog}
        onNodeClick={(_, node) => select(node.id === selected ? null : node.id)}
        onPaneClick={() => select(null)}
        className="relative h-full w-full"
        overlay={
          <>
            {preview && stats ? (
              <div className="pointer-events-auto flex flex-wrap items-center gap-2 rounded-xl border border-primary/30 bg-background-elevated/90 px-3 py-1.5 text-[11px] shadow-sm backdrop-blur-sm">
                <Eye className="size-3.5 text-primary" />
                <span className="font-medium text-foreground">Previewing proposed change</span>
                <span className="flex items-center gap-1.5 text-[10px]">
                  {stats.added ? (
                    <span className="inline-flex items-center gap-0.5 text-emerald">
                      <Plus className="size-2.5" />
                      {stats.added}
                    </span>
                  ) : null}
                  {stats.removed ? (
                    <span className="inline-flex items-center gap-0.5 text-red">
                      <Minus className="size-2.5" />
                      {stats.removed}
                    </span>
                  ) : null}
                  {stats.modified ? (
                    <span className="inline-flex items-center gap-0.5 text-amber">
                      <PencilLine className="size-2.5" />
                      {stats.modified}
                    </span>
                  ) : null}
                </span>
                <button
                  type="button"
                  onClick={() => refine.setPreviewId(null)}
                  className="ml-1 rounded-md px-1.5 py-0.5 text-muted-foreground transition hover:bg-surface-hover hover:text-foreground"
                >
                  Show current
                </button>
              </div>
            ) : (
              <span className="pointer-events-auto rounded-xl border border-border/60 bg-background-elevated/80 px-3 py-1.5 text-[11px] text-muted-foreground backdrop-blur-sm">
                Current workflow
              </span>
            )}
            <div className="pointer-events-auto flex items-center gap-1 rounded-lg border border-border bg-background-elevated/90 p-1 shadow-sm backdrop-blur-sm">
              <Button
                size="sm"
                variant={direction === "LR" ? "secondary" : "ghost"}
                onClick={() => setDirection("LR")}
                title="Left to right"
                className="h-7 text-xs"
              >
                <Columns className="size-3" />
              </Button>
              <Button
                size="sm"
                variant={direction === "TB" ? "secondary" : "ghost"}
                onClick={() => setDirection("TB")}
                title="Top to bottom"
                className="h-7 text-xs"
              >
                <Rows className="size-3" />
              </Button>
            </div>
          </>
        }
      >
        {selectedStep ? (
          <div className="pointer-events-auto absolute inset-x-3 bottom-3 mx-auto flex max-w-xl flex-wrap items-center gap-1.5 rounded-xl border border-border bg-background-elevated/95 p-1.5 shadow-xl backdrop-blur-md">
            <div className="flex min-w-0 flex-1 items-center gap-2 px-1.5">
              <span
                className={cn(
                  "shrink-0 rounded-full border px-1.5 py-px text-[9px] font-medium",
                  STEP_TYPE_IDENTITY[selectedStep.type].bg,
                  STEP_TYPE_IDENTITY[selectedStep.type].border,
                  STEP_TYPE_IDENTITY[selectedStep.type].text,
                )}
              >
                {STEP_TYPE_IDENTITY[selectedStep.type].label}
              </span>
              <span
                className="truncate text-xs font-medium text-foreground"
                title={selectedStep.id}
              >
                {summarizeStep(selectedStep, catalog).title}
              </span>
            </div>
            <Button
              size="sm"
              variant={focus.includes(selectedStep.id) ? "secondary" : "ghost"}
              className="h-7 text-xs"
              onClick={() => refine.toggleFocus(selectedStep.id)}
              title="Make your next instruction about this step"
            >
              <Crosshair className="size-3" />
              {focus.includes(selectedStep.id) ? "Focused" : "Ask about it"}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-7 text-xs"
              onClick={() => setDetailsFor(selectedStep.id)}
            >
              <Info className="size-3" /> Details
            </Button>
            {!preview ? (
              <>
                {definition?.entry_step !== selectedStep.id ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 text-xs"
                    disabled={busy}
                    onClick={() =>
                      refine.propose.mutate({
                        operations: [{ op: "set_entry_step", step_id: selectedStep.id }],
                      })
                    }
                    title="Propose starting the workflow here"
                  >
                    <Flag className="size-3" /> Start here
                  </Button>
                ) : null}
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busy || (definition?.steps.length ?? 0) <= 1}
                  className={cn(
                    "h-7 text-xs text-red hover:bg-red/10 hover:text-red",
                    confirmRemove && "bg-red/10",
                  )}
                  onClick={removeSelected}
                  title="Propose removing this step — the steps around it are reconnected"
                >
                  <Trash2 className="size-3" />
                  {confirmRemove ? "Propose removal?" : "Remove"}
                </Button>
              </>
            ) : null}
            <Button
              size="sm"
              variant="ghost"
              className="size-7 p-0"
              onClick={() => select(null)}
              aria-label="Close step actions"
            >
              <X className="size-3" />
            </Button>
          </div>
        ) : null}
      </GraphCanvas>

      {shown ? (
        <StepDetailsDialog
          step={shown.steps.find((s) => s.id === detailsFor) ?? null}
          definition={shown}
          catalog={catalog}
          issues={(preview ? preview.validation?.issues : validation.data?.issues) ?? []}
          onOpenChange={(open) => !open && setDetailsFor(null)}
          onSelectStep={setDetailsFor}
        />
      ) : null}
    </div>
  );
}
