import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/workflows/$workflowName/")({
  head: () => ({
    meta: [
      { title: "Workflow — Agentic AI Design Patterns" },
      { name: "description", content: "Workflow visualizer." },
      { property: "og:title", content: "Workflow — Agentic AI Design Patterns" },
      { property: "og:description", content: "Workflow visualizer." },
    ],
  }),
  component: WorkflowsWorkflownameIndexPage,
});

function WorkflowsWorkflownameIndexPage() {
  return (
    <div className="px-6 py-8">
      <h1 className="text-2xl font-semibold tracking-tight text-foreground">Workflow</h1>
      <p className="mt-2 text-sm text-muted-foreground">Workflow visualizer.</p>
    </div>
  );
}
