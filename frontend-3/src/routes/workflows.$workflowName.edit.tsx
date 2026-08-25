import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/workflows/$workflowName/edit")({
  head: () => ({
    meta: [
      { title: "Edit Workflow — Agentic AI Design Patterns" },
      { name: "description", content: "Workflow builder." },
      { property: "og:title", content: "Edit Workflow — Agentic AI Design Patterns" },
      { property: "og:description", content: "Workflow builder." },
    ],
  }),
  component: WorkflowsWorkflownameEditPage,
});

function WorkflowsWorkflownameEditPage() {
  return (
    <div className="px-6 py-8">
      <h1 className="text-2xl font-semibold tracking-tight text-foreground">Edit Workflow</h1>
      <p className="mt-2 text-sm text-muted-foreground">Workflow builder.</p>
    </div>
  );
}
