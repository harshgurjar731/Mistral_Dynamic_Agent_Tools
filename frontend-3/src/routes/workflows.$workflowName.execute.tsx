import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/workflows/$workflowName/execute")({
  head: () => ({
    meta: [
      { title: "Execute Workflow — Agentic AI Design Patterns" },
      { name: "description", content: "Run and monitor a workflow." },
      { property: "og:title", content: "Execute Workflow — Agentic AI Design Patterns" },
      { property: "og:description", content: "Run and monitor a workflow." },
    ],
  }),
  component: WorkflowsWorkflownameExecutePage,
});

function WorkflowsWorkflownameExecutePage() {
  return (
    <div className="px-6 py-8">
      <h1 className="text-2xl font-semibold tracking-tight text-foreground">Execute Workflow</h1>
      <p className="mt-2 text-sm text-muted-foreground">Run and monitor a workflow.</p>
    </div>
  );
}
