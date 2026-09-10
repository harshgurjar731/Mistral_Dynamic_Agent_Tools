import { createFileRoute } from "@tanstack/react-router";
import { ExecutionsDashboard } from "@/components/workflows/ExecutionsDashboard";

export const Route = createFileRoute("/workflows/executions")({
  head: () => ({
    meta: [
      { title: "Workflow executions — Agentic AI Design Patterns" },
      { name: "description", content: "Every workflow run, local and remote." },
      { property: "og:title", content: "Workflow executions — Agentic AI Design Patterns" },
      { property: "og:description", content: "Every workflow run, local and remote." },
    ],
  }),
  component: ExecutionsDashboard,
});
