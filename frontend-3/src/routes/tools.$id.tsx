import { createFileRoute } from "@tanstack/react-router";
import { ToolDetail } from "@/components/tools/ToolDetail";

export const Route = createFileRoute("/tools/$id")({
  head: () => ({
    meta: [
      { title: "Tool Detail — Agentic AI Design Patterns" },
      { name: "description", content: "Tool configuration, source code, and testing." },
      { property: "og:title", content: "Tool Detail — Agentic AI Design Patterns" },
      { property: "og:description", content: "Tool configuration, source code, and testing." },
    ],
  }),
  component: ToolDetailPage,
});

function ToolDetailPage() {
  const { id } = Route.useParams();
  return <ToolDetail key={id} id={id} variant="tool" />;
}
