import { createFileRoute } from "@tanstack/react-router";
import { observabilityApi, QK } from "@/api";
import { TraceDetailPage } from "@/components/observability/TraceDetailPage";

export const Route = createFileRoute("/logs/$traceId")({
  head: () => ({
    meta: [
      { title: "Trace — Agentic AI Design Patterns" },
      {
        name: "description",
        content: "Every span of one action: steps, rule verdicts, tool calls and model calls.",
      },
      { property: "og:title", content: "Trace — Agentic AI Design Patterns" },
      {
        property: "og:description",
        content: "Every span of one action: steps, rule verdicts, tool calls and model calls.",
      },
    ],
  }),
  component: TracePage,
});

function TracePage() {
  const { traceId } = Route.useParams();
  return (
    <TraceDetailPage queryKey={QK.trace(traceId)} load={() => observabilityApi.trace(traceId)} />
  );
}
