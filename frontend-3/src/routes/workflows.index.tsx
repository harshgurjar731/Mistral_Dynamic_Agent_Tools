import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/workflows/")({
  head: () => ({
    meta: [
      { title: "Workflows — Agentic AI Design Patterns" },
      { name: "description", content: "Workflow dashboard." },
      { property: "og:title", content: "Workflows — Agentic AI Design Patterns" },
      { property: "og:description", content: "Workflow dashboard." },
    ],
  }),
  component: WorkflowsIndexPage,
});

function WorkflowsIndexPage() {
  return (
    <div className="px-6 py-8">
      <h1 className="text-2xl font-semibold tracking-tight text-foreground">Workflows</h1>
      <p className="mt-2 text-sm text-muted-foreground">Workflow dashboard.</p>
    </div>
  );
}
