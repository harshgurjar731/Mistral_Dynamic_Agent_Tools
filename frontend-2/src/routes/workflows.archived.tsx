import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/workflows/archived")({
  head: () => ({
    meta: [
      { title: "Archived Workflows — Agentic AI Design Patterns" },
      { name: "description", content: "Restore archived workflows." },
      { property: "og:title", content: "Archived Workflows — Agentic AI Design Patterns" },
      { property: "og:description", content: "Restore archived workflows." },
    ],
  }),
  component: WorkflowsArchivedPage,
});

function WorkflowsArchivedPage() {
  return (
    <div className="px-6 py-8">
      <h1 className="text-2xl font-semibold tracking-tight text-foreground">Archived Workflows</h1>
      <p className="mt-2 text-sm text-muted-foreground">Restore archived workflows.</p>
    </div>
  );
}
