import { createFileRoute } from "@tanstack/react-router";
import { ExecutionsDashboard } from "@/components/workflows/ExecutionsDashboard";

export const Route = createFileRoute("/executions")({
  head: () => ({
    meta: [
      { title: "Executions — Agentic AI Design Patterns" },
      { name: "description", content: "Fleet view of every workflow run, local and remote." },
      { property: "og:title", content: "Executions — Agentic AI Design Patterns" },
      {
        property: "og:description",
        content: "Fleet view of every workflow run, local and remote.",
      },
    ],
  }),
  component: ExecutionsDashboard,
});
