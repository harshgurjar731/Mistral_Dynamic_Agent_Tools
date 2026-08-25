import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/workflows/new/ai")({
  head: () => ({
    meta: [
      { title: "Workflow Planner — Agentic AI Design Patterns" },
      { name: "description", content: "Plan a workflow with AI." },
      { property: "og:title", content: "Workflow Planner — Agentic AI Design Patterns" },
      { property: "og:description", content: "Plan a workflow with AI." },
    ],
  }),
  component: WorkflowsNewAiPage,
});

function WorkflowsNewAiPage() {
  return (
    <div className="px-6 py-8">
      <h1 className="text-2xl font-semibold tracking-tight text-foreground">Workflow Planner</h1>
      <p className="mt-2 text-sm text-muted-foreground">Plan a workflow with AI.</p>
    </div>
  );
}
