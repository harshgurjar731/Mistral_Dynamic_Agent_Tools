import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/workflows/executions")({
  head: () => ({
    meta: [
      { title: "Executions — Agentic AI Design Patterns" },
      { name: "description", content: "Workflow execution history." },
      { property: "og:title", content: "Executions — Agentic AI Design Patterns" },
      { property: "og:description", content: "Workflow execution history." },
    ],
  }),
  component: WorkflowsExecutionsPage,
});

function WorkflowsExecutionsPage() {
  return (
    <div className="px-6 py-8">
      <h1 className="text-2xl font-semibold tracking-tight text-foreground">Executions</h1>
      <p className="mt-2 text-sm text-muted-foreground">Workflow execution history.</p>
    </div>
  );
}
