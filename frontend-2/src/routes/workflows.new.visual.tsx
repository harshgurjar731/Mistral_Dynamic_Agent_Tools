import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/workflows/new/visual")({
  head: () => ({
    meta: [
      { title: "Workflow Builder — Agentic AI Design Patterns" },
      { name: "description", content: "Design a workflow visually." },
      { property: "og:title", content: "Workflow Builder — Agentic AI Design Patterns" },
      { property: "og:description", content: "Design a workflow visually." },
    ],
  }),
  component: WorkflowsNewVisualPage,
});

function WorkflowsNewVisualPage() {
  return (
    <div className="px-6 py-8">
      <h1 className="text-2xl font-semibold tracking-tight text-foreground">Workflow Builder</h1>
      <p className="mt-2 text-sm text-muted-foreground">Design a workflow visually.</p>
    </div>
  );
}
