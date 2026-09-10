import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft } from "lucide-react";
import { QK, workflowsApi } from "@/api";
import { PageHeader } from "@/components/shared/PageHeader";
import { WorkflowBuilder } from "@/components/workflows/WorkflowBuilder";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { DetailSkeleton } from "@/components/ui/Skeletons";

export const Route = createFileRoute("/workflows/$workflowName/edit")({
  head: ({ params }) => ({
    meta: [
      { title: `Edit ${params.workflowName} — Agentic AI Design Patterns` },
      { name: "description", content: `Edit the ${params.workflowName} workflow definition.` },
      { property: "og:title", content: `Edit ${params.workflowName} — Agentic AI Design Patterns` },
      {
        property: "og:description",
        content: `Edit the ${params.workflowName} workflow definition.`,
      },
    ],
  }),
  component: EditWorkflowPage,
});

function EditWorkflowPage() {
  const { workflowName } = Route.useParams();
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: QK.workflow(workflowName),
    queryFn: () => workflowsApi.get(workflowName),
  });

  return (
    <div className="space-y-5 px-6 py-8">
      <PageHeader
        eyebrow="Builder"
        title={workflowName}
        description="Saving keeps the change local. Publishing recompiles the module and re-registers it with the worker."
        actions={
          <Button variant="outline" size="sm" asChild>
            <Link to="/workflows/$workflowName" params={{ workflowName }}>
              <ArrowLeft className="size-3.5" /> Overview
            </Link>
          </Button>
        }
      />

      {isLoading ? (
        <DetailSkeleton />
      ) : isError ? (
        <ErrorState error={error} onRetry={() => refetch()} />
      ) : !data ? (
        <EmptyState title="Workflow not found." />
      ) : (data.steps?.length ?? 0) === 0 ? (
        <EmptyState
          title="This workflow is registered remotely only."
          description="Its definition lives on the Mistral server, so there is nothing local to edit. You can still run it and watch its executions."
          action={
            <Button size="sm" asChild>
              <Link to="/workflows/$workflowName/execute" params={{ workflowName }}>
                Run it
              </Link>
            </Button>
          }
        />
      ) : (
        <WorkflowBuilder mode="edit" initial={data} />
      )}
    </div>
  );
}
