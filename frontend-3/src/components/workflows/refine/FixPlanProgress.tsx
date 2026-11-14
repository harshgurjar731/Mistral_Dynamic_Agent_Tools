/**
 * Refine with AI, live: the fix plan and its progress while a turn runs.
 *
 * A turn is a background run (`workflow_refine`). It reads the failed run,
 * analyses it with the model chosen on the Settings page, publishes a plan —
 * one item per workflow edit and per activity code fix, then the checks — and
 * re-publishes the plan as each item moves along. This card folds the run's
 * events into that view, so a reload or a return to the page mid-run shows the
 * same progress.
 */
import { useState } from "react";
import {
  AlertTriangle,
  Check,
  ChevronDown,
  Code2,
  GitBranch,
  Loader2,
  Minus,
  ShieldCheck,
  Square,
  Stethoscope,
} from "lucide-react";
import { parseEventData, type SSEEvent } from "@/api/sse";
import type { FixPlanItem } from "@/types";
import {
  applyPipelineEvent,
  EMPTY_PIPELINE,
  failPipeline,
  type PipelineRun,
} from "@/components/pipeline/usePipelineRun";
import { PipelineTimeline } from "@/components/pipeline/PipelineTimeline";
import { formatElapsed } from "@/components/runs/runMeta";
import { Button } from "@/components/ui/button";
import { stopRun } from "@/lib/runs/connections";
import { useElapsed, useRunReducer, useRunView, useTrackedRun } from "@/lib/runs/useRun";
import { cn } from "@/lib/utils";
import { AssistantShell } from "./RevisionMessages";

interface Diagnosis {
  execution_id?: string | null;
  status?: string | null;
  error?: string | null;
}

interface RefineView {
  pipeline: PipelineRun;
  plan: FixPlanItem[];
  diagnosis: Diagnosis | null;
  error: string | null;
}

const initRefineView = (): RefineView => ({
  pipeline: EMPTY_PIPELINE,
  plan: [],
  diagnosis: null,
  error: null,
});

/** Pure fold over the run's events. */
function reduceRefine(view: RefineView, event: SSEEvent): RefineView {
  const pipeline = applyPipelineEvent(view.pipeline, event.type, event.data);
  if (pipeline) return { ...view, pipeline };
  switch (event.type) {
    case "fix_plan": {
      const data = parseEventData<{ items?: FixPlanItem[]; diagnosis?: Diagnosis | null }>(event);
      if (typeof data === "string") return view;
      return {
        ...view,
        plan: data.items ?? view.plan,
        diagnosis: data.diagnosis ?? view.diagnosis,
      };
    }
    case "error":
    case "fatal_error": {
      const data = parseEventData<{ error?: string }>(event);
      const message = typeof data === "string" ? data : (data.error ?? "The change failed");
      return { ...view, error: message, pipeline: failPipeline(view.pipeline, message) };
    }
    default:
      return view;
  }
}

const KIND_ICON = { workflow: GitBranch, code: Code2, check: ShieldCheck } as const;

function StatusIcon({ status }: { status: FixPlanItem["status"] }) {
  switch (status) {
    case "in_progress":
      return <Loader2 className="size-3 animate-spin text-primary" />;
    case "completed":
      return <Check className="size-3 text-emerald" />;
    case "failed":
      return <AlertTriangle className="size-3 text-red" />;
    case "skipped":
      return <Minus className="size-3 text-muted-foreground" />;
    default:
      return <span className="size-1.5 rounded-full bg-muted-foreground/40" />;
  }
}

/** The plan's items with their status — live during a run, final on a stored revision. */
export function FixPlanList({
  items,
  compact = false,
}: {
  items: FixPlanItem[];
  compact?: boolean;
}) {
  if (!items.length) return null;
  return (
    <ol className="space-y-1.5">
      {items.map((item) => {
        const Icon = KIND_ICON[item.kind] ?? GitBranch;
        return (
          <li
            key={item.id}
            className={cn(
              "flex gap-2 rounded-lg border px-2.5 py-1.5",
              item.status === "in_progress"
                ? "border-primary/30 bg-primary/5"
                : item.status === "failed"
                  ? "border-red/25 bg-red/5"
                  : "border-border/40 bg-background-elevated/30",
            )}
          >
            <span className="mt-0.5 grid size-4 shrink-0 place-items-center">
              <StatusIcon status={item.status} />
            </span>
            <div className="min-w-0 flex-1">
              <p className="flex items-center gap-1.5 text-[11px] font-medium text-foreground">
                <Icon className="size-3 shrink-0 text-muted-foreground" />
                <span className="min-w-0 break-words">{item.title}</span>
                {item.kind === "code" && item.version ? (
                  <span className="shrink-0 rounded border border-emerald/30 bg-emerald/10 px-1 font-mono text-[9px] text-emerald">
                    v{item.version}
                  </span>
                ) : null}
              </p>
              {!compact && item.detail ? (
                <p className="mt-0.5 text-[10px] leading-relaxed text-muted-foreground">
                  {item.detail}
                </p>
              ) : null}
              {item.note ? (
                <p
                  className={cn(
                    "mt-0.5 text-[10px] leading-relaxed",
                    item.status === "failed" ? "text-red" : "text-muted-foreground",
                  )}
                >
                  {item.note}
                </p>
              ) : null}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

/** The assistant's turn while a refine run is in progress. */
export function RefineRunTurn({ runId }: { runId: string }) {
  useRunView(runId);
  const run = useTrackedRun(runId);
  const view = useRunReducer(runId, reduceRefine, initRefineView);
  const live = run?.status === "running";
  const elapsed = useElapsed(run?.created_at, live, run?.finished_at);
  const [showLayers, setShowLayers] = useState(false);
  const { pipeline, plan, diagnosis } = view;

  const current = pipeline.manifest.find((l) => pipeline.runtime[l.name]?.state === "active");
  const done = plan.filter((i) => i.status === "completed").length;

  return (
    <AssistantShell className="border-primary/30">
      <div className="space-y-2.5 px-4 py-3">
        <div className="flex items-center gap-2">
          <Loader2 className={cn("size-3.5 text-primary", live && "animate-spin")} />
          <p className="min-w-0 flex-1 text-xs font-medium text-foreground">
            {current?.label ?? (plan.length ? "Carrying out the fix" : "Analysing")}
            {plan.length ? (
              <span className="font-normal text-muted-foreground">
                {" "}
                · {done} of {plan.length} done
              </span>
            ) : null}
          </p>
          {elapsed != null ? (
            <span className="font-mono text-[10px] text-muted-foreground">
              {formatElapsed(elapsed)}
            </span>
          ) : null}
          {live ? (
            <Button
              size="sm"
              variant="ghost"
              className="h-6 px-1.5 text-[10px] text-muted-foreground"
              onClick={() => void stopRun(runId)}
              title="Stop this change"
            >
              <Square className="size-2.5" /> Stop
            </Button>
          ) : null}
        </div>

        {diagnosis?.error ? (
          <p className="flex gap-1.5 rounded-lg border border-amber/20 bg-amber/5 px-2.5 py-1.5 text-[10px] leading-relaxed text-amber">
            <Stethoscope className="mt-0.5 size-3 shrink-0" />
            <span className="min-w-0 break-words">
              Fixing the run that failed: {diagnosis.error}
            </span>
          </p>
        ) : null}

        {plan.length ? (
          <FixPlanList items={plan} />
        ) : (
          <div className="space-y-1.5">
            <div className="shimmer h-2 w-2/3 rounded-full bg-surface-hover/60" />
            <div className="shimmer h-2 w-1/2 rounded-full bg-surface-hover/60" />
          </div>
        )}

        {pipeline.activeNote ? (
          <p className="truncate text-[10px] text-muted-foreground" title={pipeline.activeNote}>
            {pipeline.activeNote}
          </p>
        ) : null}

        {pipeline.manifest.length ? (
          <div className="rounded-xl border border-border/50 bg-background-elevated/40">
            <button
              type="button"
              onClick={() => setShowLayers((v) => !v)}
              className="flex w-full items-center gap-1.5 px-3 py-2 text-[10px] font-medium text-muted-foreground hover:text-foreground"
            >
              <ChevronDown className={cn("size-3 transition", showLayers && "rotate-180")} />
              Every step of the analysis
            </button>
            {showLayers ? (
              <div className="px-2 pb-2">
                <PipelineTimeline
                  manifest={pipeline.manifest}
                  runtime={pipeline.runtime}
                  activeNote={pipeline.activeNote}
                  activeFraction={pipeline.activeFraction}
                />
              </div>
            ) : null}
          </div>
        ) : null}

        <p className="text-[10px] text-muted-foreground">
          The workflow is not changed until you apply the proposal. A code fix builds and tests a
          new activity version; applying adopts it.
        </p>
      </div>
    </AssistantShell>
  );
}
