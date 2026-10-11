import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, PencilRuler, Play, Sparkles } from "lucide-react";
import { QK, workflowsApi } from "@/api";
import { RefineWorkspace } from "@/components/workflows/refine/RefineWorkspace";
import { DeployBadge, SourceBadge } from "@/components/workflows/WorkflowCard";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { DetailSkeleton } from "@/components/ui/Skeletons";

export const Route = createFileRoute("/workflows/$workflowName/refine")({
  head: ({ params }) => ({
    meta: [
      { title: `Refine ${params.workflowName} — Agentic AI Design Patterns` },
      {
        name: "description",
        content: `Change the ${params.workflowName} workflow by describing what should be different.`,
      },
      {
        property: "og:title",
        content: `Refine ${params.workflowName} — Agentic AI Design Patterns`,
      },
      {
        property: "og:description",
        content: `Change the ${params.workflowName} workflow by describing what should be different.`,
      },
    ],
  }),
  component: RefineWorkflowPage,
});

const secondaryButton =
  "inline-flex items-center gap-1.5 rounded-xl border border-border/60 px-3 py-2 text-xs font-medium text-muted-foreground transition hover:border-border hover:bg-surface-hover hover:text-foreground";

function RefineWorkflowPage() {
  const { workflowName } = Route.useParams();
  const wf = useQuery({
    queryKey: QK.workflow(workflowName),
    queryFn: () => workflowsApi.get(workflowName),
  });

  return (
    <div className="flex min-h-[calc(100dvh-3.5rem)] flex-col gap-4 px-6 py-6 md:min-h-dvh">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <Link
            to="/workflows/$workflowName"
            params={{ workflowName }}
            className="-ml-2 mb-2 inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs font-medium text-muted-foreground transition hover:bg-surface-hover hover:text-foreground"
          >
            <ArrowLeft className="size-3" /> Overview
          </Link>
          <h1 className="flex flex-wrap items-center gap-2 text-2xl font-semibold tracking-tight">
            <Sparkles className="size-5 text-primary" />
            Refine <span className="text-gradient-brand break-all">{workflowName}</span>
          </h1>
          <p className="mt-1.5 max-w-2xl text-sm text-muted-foreground">
            Say what should change. Each request becomes a proposal you can preview on the graph,
            apply, or discard — and every applied change can be undone.
          </p>
          {wf.data ? (
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <SourceBadge source={wf.data.source} />
              <DeployBadge workflow={wf.data} />
            </div>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link
            to="/workflows/$workflowName/edit"
            params={{ workflowName }}
            className={secondaryButton}
          >
            <PencilRuler className="size-3.5" /> Visual builder
          </Link>
          <Link
            to="/workflows/$workflowName/execute"
            params={{ workflowName }}
            className={secondaryButton}
          >
            <Play className="size-3.5" /> Run
          </Link>
        </div>
      </div>

      {wf.isLoading ? (
        <DetailSkeleton />
      ) : wf.isError ? (
        <ErrorState error={wf.error} onRetry={() => wf.refetch()} />
      ) : !wf.data ? (
        <EmptyState title="Workflow not found." />
      ) : (wf.data.steps?.length ?? 0) === 0 ? (
        <EmptyState
          title="This workflow is registered remotely only."
          description="Its definition lives on the Mistral server, so there is nothing local to refine."
          action={
            <Button size="sm" asChild>
              <Link to="/workflows/$workflowName/execute" params={{ workflowName }}>
                Run it
              </Link>
            </Button>
          }
        />
      ) : (
        <RefineWorkspace
          workflowName={workflowName}
          className="h-[calc(100dvh-12rem)] min-h-[560px]"
        />
      )}
    </div>
  );
}
