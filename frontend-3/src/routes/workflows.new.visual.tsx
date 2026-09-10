import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { WorkflowBuilder } from "@/components/workflows/WorkflowBuilder";
import { emptyDefinition } from "@/components/workflows/builderModel";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/workflows/new/visual")({
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

function VisualBuilderPage() {
  return (
    <div className="space-y-5 px-6 py-8">
      <PageHeader
        eyebrow="Builder"
        title="New workflow"
        description="Add steps from the palette, drag between handles to wire them, and set an entry point. Validation runs as you edit."
        actions={
          <Button variant="outline" size="sm" asChild>
            <Link to="/workflows/new">
              <ArrowLeft className="size-3.5" /> Back
            </Link>
          </Button>
        }
      />
      <WorkflowBuilder mode="create" initial={emptyDefinition()} />
    </div>
  );
}
