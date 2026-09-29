import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import { toast } from "sonner";
import { z } from "zod";
import {
  ArrowLeft,
  ArrowRight,
  GitBranch,
  History,
  Layers,
  Loader2,
  Plus,
  Sparkles,
  Square,
  Zap,
} from "lucide-react";
import { parseEventData, type SSEEvent } from "@/api/sse";
import { errorMessage, QK, runsApi, workflowsApi, type RunStatus } from "@/api";
import type { WorkflowDefinition } from "@/types";
import { usePlannerHistory } from "@/stores/plannerHistory";
import { useRunsStore } from "@/stores/runs";
import {
  LegacyPlannerTimeline,
  PLANNER_CARD_EVENTS,
  PLANNER_CARD_OWNER,
  plannerLayerCards,
  plannerLayerRaw,
  type PlannerStep,
  type PlannerStepType,
} from "@/components/workflows/PlannerCards";
import {
  PlannerHistorySheet,
  type PlannerHistoryEntry,
} from "@/components/workflows/PlannerHistorySheet";
import { PipelineTimeline } from "@/components/pipeline/PipelineTimeline";
import { BuildingBlockLegend } from "@/components/workflows/BuildingBlockLegend";
import {
  applyPipelineEvent,
  EMPTY_PIPELINE,
  failPipeline,
  settlePipeline,
  type PipelineRun,
} from "@/components/pipeline/usePipelineRun";
import { formatElapsed } from "@/components/runs/runMeta";
import { stopRun, trackStartedRun } from "@/lib/runs/connections";
import { useElapsed, useRunReducer, useRunView, useTrackedRun } from "@/lib/runs/useRun";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const searchSchema = z.object({
  /** The background planning run on screen. */
  run: z.string().optional(),
});

export const Route = createFileRoute("/workflows/new/ai")({
  validateSearch: searchSchema,
  head: () => ({
    meta: [
      { title: "Plan a workflow — Agentic AI Design Patterns" },
      {
        name: "description",
        content: "Describe an outcome and watch the planner design, compile and register the DAG.",
      },
      { property: "og:title", content: "Plan a workflow — Agentic AI Design Patterns" },
      {
        property: "og:description",
        content: "Describe an outcome and watch the planner design, compile and register the DAG.",
      },
    ],
  }),
  component: AiPlannerPage,
});

const EXAMPLES = [
  "Assess a commercial property insurance claim end to end and produce a settlement recommendation",
  "Screen a supplier for sanctions and financial risk, then draft an onboarding decision memo",
  "Triage an inbound support ticket, gather account context and draft a reply for review",
];

const isErrorStep = (s: PlannerStep) => s.type === "error" || s.type === "fatal_error";

/* ── Run → view ────────────────────────────────────────────────────────── */

interface PlannerView {
  pipeline: PipelineRun;
  steps: PlannerStep[];
  /** Set once the run's `run_end` has been replayed. */
  end: { status: RunStatus; error: string | null } | null;
}

const initPlannerView = (): PlannerView => ({ pipeline: EMPTY_PIPELINE, steps: [], end: null });

/**
 * The planner's event handling as a pure fold, so a run watched live, reopened
 * mid-way, or replayed after a reload renders the same timeline.
 */
function reducePlanner(view: PlannerView, event: SSEEvent): PlannerView {
  const pipeline = applyPipelineEvent(view.pipeline, event.type, event.data);
  if (pipeline) return { ...view, pipeline };

  const withStep = (type: PlannerStepType, content: unknown): PlannerStep[] => [
    ...view.steps,
    { id: `${view.steps.length}-${type}`, type, content },
  ];

  if (PLANNER_CARD_EVENTS.has(event.type)) {
    const parsed = parseEventData<unknown>(event);
    if (typeof parsed === "string") return view;
    return { ...view, steps: withStep(event.type as PlannerStepType, parsed) };
  }

  switch (event.type) {
    case "error":
      return {
        ...view,
        steps: withStep("error", event.data),
        pipeline: failPipeline(view.pipeline, event.data),
      };
    case "fatal_error": {
      const f = parseEventData<{ error?: string }>(event);
      return {
        ...view,
        steps: withStep("fatal_error", typeof f === "string" ? f : (f.error ?? "Planning failed")),
        pipeline: failPipeline(view.pipeline, "This step could not be completed."),
      };
    }
    case "run_end": {
      const end = parseEventData<{ status?: RunStatus; error?: string | null }>(event);
      const status: RunStatus = typeof end === "string" ? "completed" : (end.status ?? "completed");
      const error = typeof end === "string" ? null : (end.error ?? null);
      if (status === "completed") {
        return { ...view, end: { status, error }, pipeline: settlePipeline(view.pipeline) };
      }
      if (status === "cancelled") {
        return {
          ...view,
          end: { status, error },
          pipeline: failPipeline(view.pipeline, "Stopped before it finished."),
        };
      }
      // Failed or interrupted: make sure there is an error row to restart from.
      const message = error ?? "Planning failed";
      return {
        ...view,
        end: { status, error },
        pipeline: failPipeline(view.pipeline, message),
        steps: view.steps.some(isErrorStep) ? view.steps : withStep("error", message),
      };
    }
    default:
      return view;
  }
}

/**
 * A minimal timeline reconstructed from a saved workflow definition, for
 * workflows this browser never watched being planned. The planner's own
 * decomposition is not recoverable — dependency edges and stated purposes are
 * not persisted — so this shows what the steps became, not what was asked for.
 * A "tool"-type step is a standalone activity, never an agent capability.
 */
function historyFromWorkflow(wf: WorkflowDefinition): PlannerHistoryEntry {
  const text = (v: unknown) => (typeof v === "string" && v ? v : undefined);
  const wfSteps = wf.steps ?? [];
  const agentSteps = wfSteps.filter((s) => s.type === "agent");
  const activitySteps = wfSteps.filter((s) => s.type === "tool");
  const agentName = (s: (typeof wfSteps)[number]) =>
    text(s.config["agent_name"]) ?? text(s.config["agent_id"]) ?? s.id;

  const steps: PlannerStep[] = [
    {
      id: `${wf.name}-capabilities`,
      type: "capabilities",
      content: {
        description: wf.description ?? "",
        capabilities: wfSteps.map((s) => ({
          id: s.id,
          name: text(s.config["agent_name"]) ?? text(s.config["tool_name"]) ?? s.id,
          purpose: s.description ?? "",
          tier: s.tier ?? undefined,
          kind:
            s.type === "tool" ? "activity" : String(s.type) === "connector" ? "connector" : "agent",
          parallelisable: Boolean(s.parallel_group),
        })),
      },
    },
    ...activitySteps.map((s) => ({
      id: `${wf.name}-activity-${s.id}`,
      type: "activity_new" as const,
      content: { tool_name: text(s.config["tool_name"]) ?? s.id, status: "existing" },
    })),
    ...agentSteps.map((s) => ({
      id: `${wf.name}-agent-${s.id}`,
      type: "agent_exists" as const,
      content: {
        agent_name: agentName(s),
        model: text(s.config["model"]) ?? "",
        tools: Array.isArray(s.config["tools"]) ? s.config["tools"] : [],
        tier: s.tier ?? undefined,
      },
    })),
    {
      id: `${wf.name}-ready`,
      type: "workflow_ready",
      content: {
        workflow_name: wf.name,
        description: wf.description ?? "",
        step_count: wfSteps.length,
        agents: agentSteps.map(agentName),
        entry_step: wf.entry_step,
        dag: { steps: wfSteps },
      },
    },
  ];

  return {
    id: `backend-${wf.name}`,
    goal: wf.description || `Build the "${wf.name}" workflow`,
    workflowName: wf.name,
    status: "completed",
    createdAt: 0,
    steps,
    fromBackend: true,
  };
}

function AiPlannerPage() {
  const navigate = useNavigate({ from: Route.fullPath });
  const { run: runId } = Route.useSearch();
  const runs = usePlannerHistory((s) => s.runs);
  const addRun = usePlannerHistory((s) => s.addRun);
  const clearRuns = usePlannerHistory((s) => s.clear);

  const [goal, setGoal] = useState("");
  const [starting, setStarting] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  /** A locally saved history entry being replayed, instead of a live run. */
  const [replay, setReplay] = useState<PlannerHistoryEntry | null>(null);

  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const tracked = useTrackedRun(runId);
  const { missing } = useRunView(runId);
  const view = useRunReducer(runId, reducePlanner, initPlannerView);

  // Until the run's summary loads, a run without a replayed ending counts as live.
  const running =
    Boolean(runId) && !missing && !view.end && (tracked ? tracked.status === "running" : true);
  const elapsed = useElapsed(tracked?.created_at, running, tracked?.finished_at);

  // Coming back to the planner lands on the run still in flight (or one that
  // finished while the user was away), rather than on an empty form.
  const attachedRef = useRef(false);
  useEffect(() => {
    if (attachedRef.current) return;
    attachedRef.current = true;
    if (runId) return;
    const candidate = Object.values(useRunsStore.getState().runs)
      .filter((r) => r.kind === "workflow_plan" && (r.status === "running" || !r.seen))
      .sort((a, b) => (b.created_at ?? "").localeCompare(a.created_at ?? ""))[0];
    if (candidate) void navigate({ search: { run: candidate.id }, replace: true });
  }, [navigate, runId]);

  // Show the goal of whichever run is on screen.
  useEffect(() => {
    if (runId && tracked?.title) setGoal(tracked.title);
  }, [runId, tracked?.title]);

  // Saved workflows fill in history for plans this browser never watched.
  const { data: savedWorkflows, isLoading: loadingWorkflows } = useQuery({
    queryKey: QK.workflows(),
    queryFn: workflowsApi.list,
    enabled: historyOpen,
  });

  const history = useMemo<PlannerHistoryEntry[]>(() => {
    const known = new Set(runs.map((r) => r.workflowName).filter(Boolean));
    const synthetic = (savedWorkflows?.workflows ?? [])
      .filter((wf) => !wf.archived && wf.name && !known.has(wf.name))
      .map(historyFromWorkflow);
    return [...runs, ...synthetic];
  }, [runs, savedWorkflows]);

  const steps = useMemo(() => (replay ? (replay.steps ?? []) : view.steps), [replay, view.steps]);
  const pipeline = useMemo<PipelineRun>(
    () =>
      replay
        ? {
            manifest: replay.manifest ?? [],
            runtime: replay.runtime ?? {},
            activeNote: "",
            started: (replay.manifest?.length ?? 0) > 0,
          }
        : view.pipeline,
    [replay, view.pipeline],
  );

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [steps.length, pipeline.runtime, pipeline.activeNote]);

  // Grow the goal box with its content, up to a cap.
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(Math.max(el.scrollHeight, 180), 320)}px`;
  }, [goal]);

  const workflowName = useMemo(() => {
    const step = steps.find((s) => s.type === "workflow_ready");
    return step ? ((step.content as { workflow_name?: string }).workflow_name ?? null) : null;
  }, [steps]);
  const hasFailure = useMemo(() => steps.some(isErrorStep), [steps]);
  const layerCards = useMemo(() => plannerLayerCards(steps), [steps]);
  const layerRaw = useMemo(() => plannerLayerRaw(steps), [steps]);
  // A live run leaves only errors outside the chain; a run replayed without a
  // manifest renders all its steps as plain rows.
  const unowned = useMemo(
    () => (pipeline.manifest.length > 0 ? steps.filter((s) => !PLANNER_CARD_OWNER[s.type]) : steps),
    [steps, pipeline.manifest.length],
  );

  // Record a finished run in local history, once per run.
  useEffect(() => {
    if (!runId || !view.end || replay) return;
    if (usePlannerHistory.getState().runs.some((r) => r.runId === runId)) return;
    const failed = view.steps.find(isErrorStep);
    const { status, error } = view.end;
    const name = view.steps.find((s) => s.type === "workflow_ready");
    addRun({
      runId,
      goal: tracked?.title ?? goal,
      status:
        status === "cancelled"
          ? "cancelled"
          : status === "completed" && !failed
            ? "completed"
            : "failed",
      detail: failed ? String(failed.content) : (error ?? undefined),
      workflowName: name
        ? ((name.content as { workflow_name?: string }).workflow_name ?? null)
        : null,
      manifest: view.pipeline.manifest,
      runtime: view.pipeline.runtime,
      steps: view.steps,
    });
  }, [runId, view, replay, tracked?.title, goal, addRun]);

  const submit = useCallback(
    async (override?: string) => {
      const value = (override ?? goal).trim();
      if (!value || running || starting) return;
      setStarting(true);
      try {
        const run = await runsApi.startWorkflowPlan(value);
        trackStartedRun(run);
        setReplay(null);
        setGoal(value);
        void navigate({ search: { run: run.id } });
      } catch (err) {
        toast.error(`Could not start planning: ${errorMessage(err)}`);
      } finally {
        setStarting(false);
      }
    },
    [goal, navigate, running, starting],
  );

  const newPlan = () => {
    setReplay(null);
    setGoal("");
    void navigate({ search: {} });
    textareaRef.current?.focus();
  };

  const openHistoryEntry = (entry: PlannerHistoryEntry) => {
    setHistoryOpen(false);
    setGoal(entry.goal);
    if (entry.runId && useRunsStore.getState().runs[entry.runId]) {
      // Still tracked: reopen the run itself, which replays from the server.
      setReplay(null);
      void navigate({ search: { run: entry.runId } });
      return;
    }
    setReplay(entry);
    void navigate({ search: {} });
  };

  const activeHistoryId =
    replay?.id ?? (runId ? (runs.find((r) => r.runId === runId)?.id ?? null) : null);
  const started = Boolean(runId) || replay !== null || starting;
  const bareReplay = replay !== null && !pipeline.started && steps.length === 0;
  const busy = running || starting;

  return (
    <div className="relative mx-auto flex min-h-[calc(100vh-6rem)] w-full max-w-3xl flex-col px-5 py-6">
      {/* ── Hero / goal ── */}
      <motion.div
        layout
        className={cn("w-full transition-all duration-500", started ? "mb-10" : "mt-[10vh]")}
      >
        <div className="mb-4 flex items-center justify-between">
          <Link
            to="/workflows/new"
            className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-muted-foreground transition hover:bg-surface-hover hover:text-foreground"
          >
            <ArrowLeft className="size-3.5" /> Back
          </Link>
          <div className="flex items-center gap-2">
            {started ? (
              <button
                type="button"
                onClick={newPlan}
                className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-muted-foreground transition hover:bg-surface-hover hover:text-foreground"
              >
                <Plus className="size-3.5" /> New plan
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => setHistoryOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-border/60 px-3 py-1.5 text-xs font-medium text-muted-foreground transition hover:border-border hover:bg-surface-hover hover:text-foreground"
            >
              <History className="size-3.5" />
              View History{runs.length > 0 ? ` (${runs.length})` : ""}
            </button>
          </div>
        </div>

        <div className="mb-8 text-center">
          <div className="relative mx-auto mb-6 w-fit">
            <div
              className="absolute -inset-10 rounded-full opacity-20 blur-3xl"
              style={{ background: "var(--gradient-brand)" }}
            />
            <div className="relative grid size-16 place-items-center rounded-2xl border border-border/60 glass">
              <GitBranch className="size-7 text-primary" />
            </div>
          </div>
          <h1 className="text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
            What <span className="text-gradient-brand">workflow</span> do you want to build?
          </h1>
          <p className="mt-3 text-sm text-muted-foreground">
            Describe your goal — agents, tools, and the entire pipeline will be assembled
            automatically.
          </p>
        </div>

        <div className="rounded-2xl border border-border/60 p-2 shadow-2xl glass transition focus-within:border-primary/40 focus-within:ring-2 focus-within:ring-primary/20">
          <textarea
            ref={textareaRef}
            value={goal}
            onChange={(e) => setGoal(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void submit();
              }
            }}
            placeholder="e.g. Build a multi-step insurance claim processing pipeline that validates claims, queries the database, checks weather, and generates a report…"
            rows={6}
            disabled={busy}
            className="custom-scrollbar min-h-[180px] w-full resize-none overflow-y-auto bg-transparent px-4 py-3 text-base text-foreground outline-none placeholder:text-muted-foreground disabled:opacity-60"
          />
          <div className="mt-2 flex items-center justify-between gap-3 border-t border-border/60 p-2">
            <span className="flex items-center gap-2 text-xs text-muted-foreground">
              <Sparkles className="size-3.5 text-primary" />
              <span className="hidden sm:inline">Enter to plan · Shift + Enter for a new line</span>
            </span>
            <div className="flex items-center gap-2">
              {running && runId ? (
                <Button variant="outline" onClick={() => void stopRun(runId)}>
                  <Square className="size-3.5" /> Stop
                </Button>
              ) : null}
              <button
                type="button"
                onClick={() => void submit()}
                disabled={!goal.trim() || busy}
                className="inline-flex items-center gap-2 rounded-xl bg-gradient-brand px-5 py-2.5 text-sm font-medium text-primary-foreground shadow-lg transition hover:opacity-90 disabled:opacity-50"
              >
                {busy ? (
                  <>
                    <Loader2 className="size-4 animate-spin" />{" "}
                    {starting ? "Starting…" : "Planning…"}
                  </>
                ) : (
                  <>
                    Plan Workflow <ArrowRight className="size-4" />
                  </>
                )}
              </button>
            </div>
          </div>
        </div>

        {!started ? (
          <div className="mt-6 grid gap-2 sm:grid-cols-3">
            {EXAMPLES.map((ex) => (
              <button
                key={ex}
                type="button"
                onClick={() => setGoal(ex)}
                className="rounded-xl border border-border/60 px-3 py-2.5 text-left text-xs leading-relaxed text-muted-foreground transition hover:border-primary/40 hover:bg-surface-hover hover:text-foreground"
              >
                {ex}
              </button>
            ))}
          </div>
        ) : null}
      </motion.div>

      {/* ── Timeline ── */}
      {started ? (
        <div className="space-y-5 pb-24">
          <div className="rounded-2xl border border-border/50 bg-surface/40 p-5 backdrop-blur-sm">
            <div className="mb-4 flex items-center gap-2">
              <Zap className="size-3.5 text-primary" />
              <span className="text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
                {replay ? "Planning Timeline" : "Planning Pipeline"}
              </span>
              {running ? (
                <span className="ml-auto inline-flex items-center gap-1.5 rounded-full border border-primary/25 bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">
                  <span className="size-1.5 animate-pulse rounded-full bg-primary" />
                  Planning
                  {elapsed != null ? (
                    <span className="font-mono tabular-nums opacity-80">
                      {formatElapsed(elapsed)}
                    </span>
                  ) : null}
                </span>
              ) : null}
            </div>

            {running ? (
              <p className="mb-4 flex items-start gap-2 rounded-lg border border-border/50 bg-background-elevated/40 px-3 py-2 text-[11px] leading-relaxed text-muted-foreground">
                <Layers className="mt-0.5 size-3 shrink-0 text-primary" />
                Planning runs in the background. You can leave this page — it keeps going, and this
                timeline picks up where it is when you come back.
              </p>
            ) : null}

            <div className="space-y-5">
              {missing ? (
                <p className="text-xs text-muted-foreground">
                  This planning run is no longer available — it may have been cleared from the
                  server’s run log.
                </p>
              ) : pipeline.manifest.length > 0 ? (
                <>
                  <BuildingBlockLegend />
                  <PipelineTimeline
                    manifest={pipeline.manifest}
                    runtime={pipeline.runtime}
                    activeNote={pipeline.activeNote}
                    cards={layerCards}
                    raw={layerRaw}
                  />
                </>
              ) : busy || (runId && !view.end) ? (
                <div className="shimmer h-16 rounded-xl border border-border/50" />
              ) : null}

              <LegacyPlannerTimeline
                steps={unowned}
                onRestart={() => void submit(tracked?.title ?? goal)}
                restartDisabled={busy}
              />

              {view.end?.status === "cancelled" && !replay ? (
                <p className="text-xs text-muted-foreground">
                  Planning was stopped before it finished. Anything already created is kept.
                </p>
              ) : null}

              {bareReplay ? (
                <p className="text-xs text-muted-foreground">
                  This run was recorded before timelines were kept, so only its outcome is
                  available.
                </p>
              ) : null}
            </div>
          </div>

          {/* ── Final CTA ── */}
          {workflowName && !running && !hasFailure ? (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="flex flex-wrap gap-3"
            >
              <button
                type="button"
                onClick={() =>
                  navigate({
                    to: "/workflows/$workflowName",
                    params: { workflowName },
                  })
                }
                className="inline-flex min-w-[160px] flex-1 items-center justify-center gap-2 rounded-xl bg-gradient-brand py-4 text-base font-semibold text-primary-foreground shadow-xl transition hover:opacity-90"
              >
                <GitBranch className="size-5" /> View Workflow DAG
              </button>
              <Button variant="outline" asChild className="h-auto rounded-xl px-5 py-4">
                <Link to="/workflows">Manage Workflows</Link>
              </Button>
            </motion.div>
          ) : null}

          <div ref={bottomRef} />
        </div>
      ) : null}

      <PlannerHistorySheet
        open={historyOpen}
        onOpenChange={setHistoryOpen}
        history={history}
        activeId={activeHistoryId}
        isLoading={loadingWorkflows && historyOpen}
        onSelect={openHistoryEntry}
        onClear={clearRuns}
      />
    </div>
  );
}
