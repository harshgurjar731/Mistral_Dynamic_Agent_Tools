import { createFileRoute } from "@tanstack/react-router";
import { observabilityApi, QK } from "@/api";
import { TraceDetailPage } from "@/components/observability/TraceDetailPage";

/** A workflow execution's trace, addressed by execution id — linked from the run pages. */
export const Route = createFileRoute("/logs/execution/$executionId")({
  head: () => ({
    meta: [
      { title: "Execution Trace — Agentic AI Design Patterns" },
      {
        name: "description",
        content: "Every step, rule verdict, tool call and model call of one workflow run.",
      },
      { property: "og:title", content: "Execution Trace — Agentic AI Design Patterns" },
      {
        property: "og:description",
        content: "Every step, rule verdict, tool call and model call of one workflow run.",
      },
    ],
  }),
  component: ExecutionTracePage,
});

function ExecutionTracePage() {
  const { executionId } = Route.useParams();
  return (
    <TraceDetailPage
      queryKey={QK.executionTrace(executionId)}
      load={() => observabilityApi.executionTrace(executionId)}
      subtitle="workflow execution"
    />
  );
}
