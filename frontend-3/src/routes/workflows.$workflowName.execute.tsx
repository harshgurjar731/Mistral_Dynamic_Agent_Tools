import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { ArrowLeft, ChevronDown, Inbox, ListTree, Play } from "lucide-react";
import { errorMessage, QK, reviewsApi, workflowsApi } from "@/api";
import type { HumanReview } from "@/api/knowledge";
import { PageHeader } from "@/components/shared/PageHeader";
import { GlassPanel, GlassPanelHeader } from "@/components/glass/GlassPanel";
import { HumanReviewDialog } from "@/components/reviews/HumanReviewDialog";
import { ExecutionMonitor } from "@/components/workflows/ExecutionMonitor";
import { LiveRunPanel } from "@/components/workflows/live/LiveRunPanel";
import { isTerminalStatus } from "@/components/workflows/live/runModel";
import { ExecutionResult } from "@/components/workflows/result/ExecutionResult";
import { useExecutionStream } from "@/components/workflows/useExecutionStream";
import { DeployBadge } from "@/components/workflows/WorkflowCard";
import { Button } from "@/components/ui/button";
import { ErrorState } from "@/components/ui/ErrorState";
import { DetailSkeleton } from "@/components/ui/Skeletons";
import { rememberRunInput } from "@/components/workflows/runForm/fieldModel";
import { WorkflowRunForm } from "@/components/workflows/runForm/WorkflowRunForm";
import {
  useWorkflowPrerequisites,
  WorkflowPrerequisites,
} from "@/components/workflows/WorkflowPrerequisites";
import { useAllowed, useCanCall, ViewOnlyNote } from "@/lib/policy";
import { cn } from "@/lib/utils";
import { useExecutionWatch } from "@/stores/executionWatch";

interface ExecuteSearch {
  execId?: string;
  /** A review to open in the review window — set by notifications. */
  review?: number;
}

export const Route = createFileRoute("/workflows/$workflowName/execute")({
  validateSearch: (search: Record<string, unknown>): ExecuteSearch => {
    const out: ExecuteSearch = {};
    const execId = search["execId"];
    if (typeof execId === "string" && execId) out.execId = execId;
    const review = Number(search["review"]);
    if (Number.isInteger(review) && review > 0) out.review = review;
    return out;
  },
  head: ({ params }) => ({
    meta: [
      { title: `Run ${params.workflowName} — Agentic AI Design Patterns` },
      { name: "description", content: `Execute ${params.workflowName} and watch the run live.` },
      { property: "og:title", content: `Run ${params.workflowName} — Agentic AI Design Patterns` },
      {
        property: "og:description",
        content: `Execute ${params.workflowName} and watch the run live.`,
      },
    ],
  }),
  component: ExecuteWorkflowPage,
});

function ExecuteWorkflowPage() {
  const allowed = useAllowed();
  const { workflowName } = Route.useParams();
  const canRun = allowed("POST", `/api/workflows/${encodeURIComponent(workflowName)}/execute`);
  const canSeeReviews = useCanCall("GET", "/api/reviews");
  const { execId, review: reviewParam } = Route.useSearch();
  const navigate = useNavigate();
  const qc = useQueryClient();

  const [activeExec, setActiveExec] = useState<string | null>(execId ?? null);
  const [showDetails, setShowDetails] = useState(false);

  useEffect(() => {
    if (execId) setActiveExec(execId);
  }, [execId]);

  // One live connection, shared by the progress, the result and the details.
  const stream = useExecutionStream(activeExec);
  const status = stream.detail?.status ?? null;
  const terminal = isTerminalStatus(status) || stream.finalStatus != null;

  const wf = useQuery({
    queryKey: QK.workflow(workflowName),
    queryFn: () => workflowsApi.get(workflowName),
  });
  const hasReviewSteps = wf.data ? wf.data.steps.some((s) => s.type === "human_review") : true;

  const prereq = useWorkflowPrerequisites(workflowName);
  const blockedReason = prereq.isLoading
    ? "Checking prerequisites…"
    : prereq.data && !prereq.data.ready
      ? `Complete ${prereq.data.blocking_count} prerequisite(s) above before running.`
      : null;

  /* ── Watch the run app-wide, so its end is announced wherever the user is ── */
  useEffect(() => {
    if (!activeExec || !stream.detail || stream.detail.execution_id !== activeExec) return;
    const store = useExecutionWatch.getState();
    if (!store.watched[activeExec])
      store.watch({
        execution_id: activeExec,
        workflow_name: workflowName,
        status: stream.detail.status,
      });
  }, [activeExec, stream.detail, workflowName]);

  /* ── Reviews this run is waiting on ─────────────────────────────────── */
  const reviews = useQuery({
    queryKey: QK.executionReviews(activeExec ?? ""),
    queryFn: () => reviewsApi.list(null, activeExec),
    enabled: Boolean(activeExec) && canSeeReviews && hasReviewSteps,
    refetchInterval: terminal ? false : 3000,
  });
  const runReviews = useMemo(() => reviews.data?.reviews ?? [], [reviews.data]);
  const pending = useMemo(() => runReviews.filter((r) => r.status === "pending"), [runReviews]);

  // A review named in the link (from a notification), even one already decided.
  const linked = useQuery({
    queryKey: QK.review(reviewParam ?? 0),
    queryFn: () => reviewsApi.get(reviewParam!),
    enabled: reviewParam != null && canSeeReviews,
  });

  const [dialogReview, setDialogReview] = useState<HumanReview | null>(null);
  const autoOpened = useRef(new Set<number>());

  useEffect(() => {
    if (linked.data && !autoOpened.current.has(linked.data.id)) {
      autoOpened.current.add(linked.data.id);
      setDialogReview(linked.data);
    }
  }, [linked.data]);

  // A run that pauses for a person opens the review window, once per review.
  useEffect(() => {
    const next = pending.find((r) => !autoOpened.current.has(r.id));
    if (!next || dialogReview) return;
    autoOpened.current.add(next.id);
    setDialogReview(next);
    useExecutionWatch.getState().announceReview(next.id);
  }, [pending, dialogReview]);

  const closeReview = () => {
    setDialogReview(null);
    if (reviewParam != null)
      void navigate({
        to: "/workflows/$workflowName/execute",
        params: { workflowName },
        search: activeExec ? { execId: activeExec } : {},
        replace: true,
      });
  };

  /* ── Starting a run ─────────────────────────────────────────────────── */
  const run = useMutation({
    mutationFn: async (input: Record<string, unknown>) =>
      workflowsApi.execute(workflowName, { input, wait_for_result: false }),
    onSuccess: (res, input) => {
      rememberRunInput(workflowName, input);
      const id = String(res["execution_id"] ?? "");
      if (!id) {
        toast.error("The backend accepted the run but returned no execution id.");
        return;
      }
      useExecutionWatch.getState().watch({ execution_id: id, workflow_name: workflowName });
      setActiveExec(id);
      autoOpened.current = new Set();
      navigate({
        to: "/workflows/$workflowName/execute",
        params: { workflowName },
        search: { execId: id },
        replace: true,
      });
      toast.success(
        `Run started on ${String(res["source"] ?? "mistral") === "local" ? "the local engine" : "Mistral Workflows"}.`,
        {
          description:
            "You'll be notified when it finishes or needs a review, wherever you are in the app.",
        },
      );
    },
    onError: (e) => {
      toast.error(errorMessage(e));
      // A 409 carries the latest prerequisite report; show it.
      void prereq.refetch();
    },
  });

  return (
    <div className="space-y-5 px-6 py-8">
      <PageHeader
        eyebrow="Execution"
        title={
          <span className="flex flex-wrap items-center gap-2.5">
            <span className="break-all">{workflowName}</span>
            {wf.data ? <DeployBadge workflow={wf.data} /> : null}
          </span>
        }
        description="Fill in the inputs and run. Progress shows live, step by step; a step that needs a person opens a review window, and you are notified when the run finishes or fails."
        actions={
          <div className="flex items-center gap-2">
            {canSeeReviews && hasReviewSteps ? (
              <Button variant="outline" size="sm" asChild>
                <Link to="/reviews">
                  <Inbox className="size-3.5" /> Reviews
                </Link>
              </Button>
            ) : null}
            <Button variant="outline" size="sm" asChild>
              <Link to="/workflows/$workflowName" params={{ workflowName }}>
                <ArrowLeft className="size-3.5" /> Overview
              </Link>
            </Button>
          </div>
        }
      />

      {canRun && (!activeExec || (prereq.data && !prereq.data.ready)) ? (
        <WorkflowPrerequisites workflowName={workflowName} />
      ) : null}
      {!canRun ? (
        <ViewOnlyNote what="start runs of this workflow — you can follow existing runs" />
      ) : null}

      <div
        className={cn(
          "grid items-start gap-5",
          canRun && "lg:grid-cols-[minmax(360px,440px)_minmax(0,1fr)]",
        )}
      >
        {canRun ? (
          <GlassPanel className="h-fit lg:sticky lg:top-18">
            <GlassPanelHeader
              title={activeExec ? "Run again" : "Run inputs"}
              description={
                wf.data?.description
                  ? wf.data.description
                  : "What this workflow needs to start. Each field says which steps read it."
              }
            />
            {wf.isLoading ? (
              <div className="p-4">
                <DetailSkeleton />
              </div>
            ) : wf.isError ? (
              <div className="p-4">
                <ErrorState error={wf.error} onRetry={() => wf.refetch()} />
              </div>
            ) : wf.data ? (
              <WorkflowRunForm
                definition={wf.data}
                running={run.isPending}
                onRun={(input) => run.mutate(input)}
                blockedReason={blockedReason}
              />
            ) : null}
          </GlassPanel>
        ) : null}

        <div className="min-w-0 space-y-5">
          {activeExec ? (
            <LiveRunPanel
              executionId={activeExec}
              detail={stream.detail?.execution_id === activeExec ? stream.detail : null}
              phase={stream.phase}
              streamError={stream.error}
              definition={wf.data}
              reviews={runReviews}
              onOpenReview={(r) => {
                autoOpened.current.add(r.id);
                setDialogReview(r);
              }}
              onReconnect={stream.reconnect}
            />
          ) : (
            <GlassPanel className="p-8">
              <div className="mx-auto max-w-md text-center">
                <span className="mx-auto grid size-11 place-items-center rounded-xl border border-primary/25 bg-primary/10 text-primary">
                  <Play className="size-5" />
                </span>
                <p className="mt-3 text-sm font-semibold text-foreground">Ready when you are</p>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                  The form is filled with an example run. Replace the values with real ones, or run
                  it as is to see how the workflow behaves. Each of its{" "}
                  {wf.data ? `${wf.data.steps.length} ` : ""}steps will show here as it runs.
                </p>
              </div>
            </GlassPanel>
          )}

          {activeExec ? (
            <ExecutionResult
              executionId={activeExec}
              detail={stream.detail}
              phase={stream.phase}
              error={stream.error}
              definition={wf.data}
            />
          ) : null}
        </div>
      </div>

      {/* Execution details — logs, events, trace, history, control. */}
      {activeExec ? (
        <section className="space-y-2">
          <button
            type="button"
            onClick={() => setShowDetails((s) => !s)}
            className="flex w-full items-center gap-2 rounded-lg border border-border/70 bg-surface/40 px-4 py-2.5 text-left transition hover:bg-surface-hover"
          >
            <ListTree className="size-4 text-muted-foreground" />
            <span className="text-xs font-medium text-foreground">Execution details</span>
            <span className="text-[11px] text-muted-foreground">
              Logs, events, trace, history and controls
            </span>
            <ChevronDown
              className={cn(
                "ml-auto size-4 text-muted-foreground transition-transform",
                !showDetails && "-rotate-90",
              )}
            />
          </button>
          {showDetails ? (
            <div className="h-[560px]">
              <ExecutionMonitor
                executionId={activeExec}
                stream={stream}
                hideResult
                title={`Run ${activeExec.slice(0, 8)}`}
              />
            </div>
          ) : null}
        </section>
      ) : null}

      <HumanReviewDialog
        review={dialogReview}
        open={Boolean(dialogReview)}
        onOpenChange={(o) => {
          if (!o) closeReview();
        }}
        onDecided={() => {
          void qc.invalidateQueries({ queryKey: QK.executionReviews(activeExec ?? "") });
          useExecutionWatch.getState().markExecutionRead(activeExec ?? "", "review");
        }}
      />
    </div>
  );
}
