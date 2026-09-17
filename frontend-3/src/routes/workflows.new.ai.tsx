import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import { toast } from "sonner";
import {
  ArrowLeft,
  ArrowRight,
  GitBranch,
  History,
  Loader2,
  Sparkles,
  Square,
  Zap,
} from "lucide-react";
import { createSSEStream, parseEventData } from "@/api/sse";
import { QK, workflowsApi } from "@/api";
import type { WorkflowDefinition } from "@/types";
import { usePlannerHistory, type PlannerRun } from "@/stores/plannerHistory";
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
import { usePipelineRun } from "@/components/pipeline/usePipelineRun";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/workflows/new/ai")({
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
  const navigate = useNavigate();
  const qc = useQueryClient();
  const runs = usePlannerHistory((s) => s.runs);
  const addRun = usePlannerHistory((s) => s.addRun);
  const clearRuns = usePlannerHistory((s) => s.clear);

  const [goal, setGoal] = useState("");
  const [running, setRunning] = useState(false);
  const [steps, setSteps] = useState<PlannerStep[]>([]);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const { run, reset, restore, handleEvent, settle, failRunning } = usePipelineRun();

  const stopRef = useRef<(() => void) | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  /** The goal of the run on screen — the textarea keeps changing as the user types. */
  const goalRef = useRef("");
  /** Set when a run finishes so the save effect records it exactly once. */
  const pendingSaveRef = useRef<PlannerRun["status"] | null>(null);

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

  useEffect(() => () => stopRef.current?.(), []);
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [steps, run]);

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
    () => (run.manifest.length > 0 ? steps.filter((s) => !PLANNER_CARD_OWNER[s.type]) : steps),
    [steps, run.manifest.length],
  );

  // Record a finished run once React has flushed its last layer events.
  useEffect(() => {
    const status = pendingSaveRef.current;
    if (running || !status) return;
    pendingSaveRef.current = null;
    const failed = steps.find(isErrorStep);
    addRun({
      goal: goalRef.current,
      status: failed ? "failed" : status,
      detail: failed ? String(failed.content) : undefined,
      workflowName,
      manifest: run.manifest,
      runtime: run.runtime,
      steps,
    });
  }, [running, steps, run, workflowName, addRun]);

  const addStep = useCallback((type: PlannerStepType, content: unknown) => {
    setSteps((prev) => [...prev, { id: `${prev.length}-${type}`, type, content }]);
  }, []);

  const stop = useCallback(() => {
    stopRef.current?.();
    stopRef.current = null;
    pendingSaveRef.current = "cancelled";
    setRunning(false);
    settle();
  }, [settle]);

  const submit = useCallback(
    (override?: string) => {
      const value = (override ?? goal).trim();
      if (!value || running) return;

      stopRef.current?.();
      goalRef.current = value;
      setSteps([]);
      setActiveRunId(null);
      setRunning(true);
      reset();

      stopRef.current = createSSEStream("/api/workflows/plan", {
        method: "POST",
        body: { goal: value },
        onEvent: (event) => {
          // `pipeline`, `layer` and `status` drive the chain itself.
          if (handleEvent(event.type, event.data)) return;

          if (PLANNER_CARD_EVENTS.has(event.type)) {
            const parsed = parseEventData<unknown>(event);
            if (typeof parsed !== "string") addStep(event.type as PlannerStepType, parsed);
            return;
          }

          switch (event.type) {
            case "error":
              addStep("error", event.data);
              failRunning(event.data);
              break;
            case "fatal_error": {
              const f = parseEventData<{ error?: string }>(event);
              addStep("fatal_error", typeof f === "string" ? f : (f.error ?? "Planning failed"));
              failRunning("This step could not be completed.");
              break;
            }
            case "done": {
              const d = parseEventData<{ workflow_name?: string }>(event);
              const name = typeof d === "string" ? null : (d.workflow_name ?? null);
              qc.invalidateQueries({ queryKey: QK.workflows() });
              toast.success(name ? `Workflow "${name}" is ready.` : "Workflow planned.");
              break;
            }
            default:
              break;
          }
        },
        onDone: () => {
          pendingSaveRef.current = "completed";
          setRunning(false);
          settle();
        },
        onError: (err) => {
          const message = err instanceof Error ? err.message : "Planning stream failed";
          addStep("error", message);
          failRunning(message);
          pendingSaveRef.current = "failed";
          setRunning(false);
        },
      });
    },
    [addStep, failRunning, goal, handleEvent, qc, reset, running, settle],
  );

  const openHistoryEntry = (entry: PlannerHistoryEntry) => {
    if (running) return;
    setActiveRunId(entry.id);
    setGoal(entry.goal);
    goalRef.current = entry.goal;
    setSteps(entry.steps ?? []);
    // Entries without a manifest fall back to plain rows below the chain.
    restore(entry.manifest, entry.runtime);
    setHistoryOpen(false);
  };

  const started = running || run.started || steps.length > 0 || activeRunId !== null;
  const bareReplay = activeRunId !== null && !run.started && steps.length === 0;

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
          <button
            type="button"
            onClick={() => setHistoryOpen(true)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border/60 px-3 py-1.5 text-xs font-medium text-muted-foreground transition hover:border-border hover:bg-surface-hover hover:text-foreground"
          >
            <History className="size-3.5" />
            View History{runs.length > 0 ? ` (${runs.length})` : ""}
          </button>
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
                submit();
              }
            }}
            placeholder="e.g. Build a multi-step insurance claim processing pipeline that validates claims, queries the database, checks weather, and generates a report…"
            rows={6}
            disabled={running}
            className="custom-scrollbar min-h-[180px] w-full resize-none overflow-y-auto bg-transparent px-4 py-3 text-base text-foreground outline-none placeholder:text-muted-foreground disabled:opacity-60"
          />
          <div className="mt-2 flex items-center justify-between gap-3 border-t border-border/60 p-2">
            <span className="flex items-center gap-2 text-xs text-muted-foreground">
              <Sparkles className="size-3.5 text-primary" />
              <span className="hidden sm:inline">Enter to plan · Shift + Enter for a new line</span>
            </span>
            <div className="flex items-center gap-2">
              {running ? (
                <Button variant="outline" onClick={stop}>
                  <Square className="size-3.5" /> Stop
                </Button>
              ) : null}
              <button
                type="button"
                onClick={() => submit()}
                disabled={!goal.trim() || running}
                className="inline-flex items-center gap-2 rounded-xl bg-gradient-brand px-5 py-2.5 text-sm font-medium text-primary-foreground shadow-lg transition hover:opacity-90 disabled:opacity-50"
              >
                {running ? (
                  <>
                    <Loader2 className="size-4 animate-spin" /> Planning…
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
                {activeRunId && !running ? "Planning Timeline" : "Planning Pipeline"}
              </span>
              {running ? (
                <span className="ml-auto inline-flex items-center gap-1 rounded-full border border-primary/25 bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">
                  <span className="size-1.5 animate-pulse rounded-full bg-primary" />
                  Planning
                </span>
              ) : null}
            </div>

            <div className="space-y-5">
              {run.manifest.length > 0 ? (
                <PipelineTimeline
                  manifest={run.manifest}
                  runtime={run.runtime}
                  activeNote={run.activeNote}
                  cards={layerCards}
                  raw={layerRaw}
                />
              ) : running ? (
                <div className="shimmer h-16 rounded-xl border border-border/50" />
              ) : null}

              <LegacyPlannerTimeline
                steps={unowned}
                onRestart={() => submit(goalRef.current)}
                restartDisabled={running}
              />

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
        activeId={activeRunId}
        isLoading={loadingWorkflows && historyOpen}
        onSelect={openHistoryEntry}
        onClear={clearRuns}
      />
    </div>
  );
}
