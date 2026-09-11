import { createFileRoute } from "@tanstack/react-router";
import { ToolDetail } from "@/components/tools/ToolDetail";

export const Route = createFileRoute("/workflows/activities/$id")({
  head: () => ({
    meta: [
      { title: "Activity Detail — Agentic AI Design Patterns" },
      { name: "description", content: "Activity configuration, source code, and testing." },
      { property: "og:title", content: "Activity Detail — Agentic AI Design Patterns" },
      { property: "og:description", content: "Activity configuration, source code, and testing." },
    ],
  }),
  component: ActivityDetailPage,
});

function ActivityDetailPage() {
  const { id } = Route.useParams();
  return <ToolDetail key={id} id={id} variant="activity" />;
}
