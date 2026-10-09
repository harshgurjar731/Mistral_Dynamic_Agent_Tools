import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { ArrowLeft } from "lucide-react";
import { errorMessage, QK, workflowsApi } from "@/api";
import { PageHeader } from "@/components/shared/PageHeader";
import { GlassPanel, GlassPanelHeader } from "@/components/glass/GlassPanel";
import { ExecutionMonitor } from "@/components/workflows/ExecutionMonitor";
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

export const Route = createFileRoute("/workflows/$workflowName/execute")({
  validateSearch: (search: Record<string, unknown>): { execId?: string } => {
    const execId = search["execId"];
    return typeof execId === "string" && execId ? { execId } : {};
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
  const { workflowName } = Route.useParams();
  const { execId } = Route.useSearch();
  const navigate = useNavigate();

  const [activeExec, setActiveExec] = useState<string | null>(execId ?? null);

  useEffect(() => {
    if (execId) setActiveExec(execId);
  }, [execId]);

  // One live connection, shared by the result section and the execution details.
  const stream = useExecutionStream(activeExec);

  const wf = useQuery({
    queryKey: QK.workflow(workflowName),
    queryFn: () => workflowsApi.get(workflowName),
  });
  const prereq = useWorkflowPrerequisites(workflowName);
  const blockedReason = prereq.isLoading
    ? "Checking prerequisites…"
    : prereq.data && !prereq.data.ready
      ? `Complete ${prereq.data.blocking_count} prerequisite(s) above before running.`
      : null;

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
      setActiveExec(id);
      navigate({
        to: "/workflows/$workflowName/execute",
        params: { workflowName },
        search: { execId: id },
        replace: true,
      });
      toast.success(`Run started (${String(res["source"] ?? "mistral")}).`);
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
        description="A run starts on the Mistral server when the workflow is published, and falls back to the local DAG engine otherwise."
        actions={
          <Button variant="outline" size="sm" asChild>
            <Link to="/workflows/$workflowName" params={{ workflowName }}>
              <ArrowLeft className="size-3.5" /> Overview
            </Link>
          </Button>
        }
      />

      {!activeExec || (prereq.data && !prereq.data.ready) ? (
        <WorkflowPrerequisites workflowName={workflowName} />
      ) : null}

      <div className="grid gap-5 lg:grid-cols-[minmax(360px,440px)_minmax(0,1fr)]">
        <GlassPanel className="h-fit">
          <GlassPanelHeader
            title="Run inputs"
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

        <ExecutionResult
          executionId={activeExec}
          detail={stream.detail}
          phase={stream.phase}
          error={stream.error}
          definition={wf.data}
        />
      </div>

      {/* Execution details — steps, logs, events, trace, history, control. */}
      {activeExec ? (
        <section className="space-y-2">
          <h2 className="technical-label text-muted-foreground">Execution details</h2>
          <div className="h-[560px]">
            <ExecutionMonitor
              executionId={activeExec}
              stream={stream}
              hideResult
              title={`Run ${activeExec.slice(0, 8)}`}
            />
          </div>
        </section>
      ) : null}
    </div>
  );
}
