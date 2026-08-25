import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/workflows/new/")({
  head: () => ({
    meta: [
      { title: "New Workflow — Agentic AI Design Patterns" },
      { name: "description", content: "Choose how to create a workflow." },
      { property: "og:title", content: "New Workflow — Agentic AI Design Patterns" },
      { property: "og:description", content: "Choose how to create a workflow." },
    ],
  }),
  component: WorkflowsNewIndexPage,
});

function WorkflowsNewIndexPage() {
  return (
    <div className="px-6 py-8">
      <h1 className="text-2xl font-semibold tracking-tight text-foreground">New Workflow</h1>
      <p className="mt-2 text-sm text-muted-foreground">Choose how to create a workflow.</p>
    </div>
  );
}
