import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft } from "lucide-react";
import { z } from "zod";
import { QK, workflowsApi } from "@/api";
import { BuilderHeader, WorkflowBuilder } from "@/components/workflows/WorkflowBuilder";
import { emptyDefinition } from "@/components/workflows/builderModel";
import { Button } from "@/components/ui/button";
import { ErrorState } from "@/components/ui/ErrorState";
import { DetailSkeleton } from "@/components/ui/Skeletons";
import type { WorkflowDefinition } from "@/types";

const searchSchema = z.object({
  /** Start from a copy of this workflow instead of an empty canvas. */
  from: z.string().optional(),
});

export const Route = createFileRoute("/workflows/new/visual")({
  validateSearch: searchSchema,
  head: () => ({
    meta: [
      { title: "Workflow builder — Agentic AI Design Patterns" },
      { name: "description", content: "Assemble a workflow DAG step by step on a canvas." },
      { property: "og:title", content: "Workflow builder — Agentic AI Design Patterns" },
      {
        property: "og:description",
        content: "Assemble a workflow DAG step by step on a canvas.",
      },
    ],
  }),
  component: VisualBuilderPage,
});

/** A new draft with the source's steps, wiring and inputs, and none of its identity. */
function copyOf(source: WorkflowDefinition): WorkflowDefinition {
  const base = `${source.name}_copy`.slice(0, 64);
  return {
    ...emptyDefinition(),
    name: base,
    description: source.description ?? "",
    steps: source.steps,
    entry_step: source.entry_step,
    input_schema: source.input_schema ?? [],
    variables: source.variables ?? {},
    ui_layout: source.ui_layout ?? {},
    rules: source.rules ?? [],
  };
}

function VisualBuilderPage() {
  const { from } = Route.useSearch();
  const source = useQuery({
    queryKey: QK.workflow(from ?? ""),
    queryFn: () => workflowsApi.get(from!),
    enabled: Boolean(from),
  });

  return (
    <div className="flex h-[calc(100dvh-3.5rem)] flex-col gap-3 px-4 py-3 md:h-dvh">
      <BuilderHeader
        title={from ? `Copy of ${from}` : "New workflow"}
        description={
          from
            ? "A new draft with the original's steps, wiring and inputs. Rename it, change what differs, then save — the original is not touched."
            : "Add steps from the palette, drag between handles to wire them, and click a step to edit it. Validation runs as you edit."
        }
        back={
          <Button variant="outline" size="sm" className="size-8 shrink-0 p-0" title="Back" asChild>
            <Link to="/workflows/new">
              <ArrowLeft className="size-3.5" />
            </Link>
          </Button>
        }
      />
      <div className="min-h-0 flex-1">
        {!from ? (
          <WorkflowBuilder mode="create" initial={emptyDefinition()} />
        ) : source.isLoading ? (
          <DetailSkeleton />
        ) : source.isError || !source.data ? (
          <ErrorState error={source.error} onRetry={() => source.refetch()} />
        ) : (
          <WorkflowBuilder key={from} mode="create" initial={copyOf(source.data)} />
        )}
      </div>
    </div>
  );
}
