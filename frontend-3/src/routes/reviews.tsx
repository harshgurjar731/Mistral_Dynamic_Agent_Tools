import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ArrowUpRight, Loader2, ShieldAlert } from "lucide-react";
import { QK, reviewsApi } from "@/api";
import type { HumanReview } from "@/api/knowledge";
import { FeatureDescription, FeatureTitle } from "@/components/layout/FeatureText";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { ReviewDecisionForm } from "@/components/reviews/ReviewDecisionForm";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/reviews")({
  head: () => ({
    meta: [
      { title: "Reviews — Agentic AI Design Patterns" },
      {
        name: "description",
        content: "Workflow steps waiting for a person to approve, correct or reject.",
      },
    ],
  }),
  component: ReviewsPage,
});

const FILTERS = [
  { value: "pending", label: "Waiting" },
  { value: "approved", label: "Approved" },
  { value: "edited", label: "Corrected" },
  { value: "rejected", label: "Rejected" },
  { value: "timed_out", label: "Timed out" },
] as const;

function ReviewsPage() {
  const [status, setStatus] = useState<string>("pending");
  const reviews = useQuery({
    queryKey: QK.reviews(status),
    queryFn: () => reviewsApi.list(status),
    refetchInterval: status === "pending" ? 10_000 : false,
  });

  return (
    <div className="px-6 py-8">
      <h1 className="text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
        <FeatureTitle route="/reviews">
          Human <span className="text-gradient-brand">reviews</span>
        </FeatureTitle>
      </h1>
      <p className="mt-1.5 max-w-3xl text-sm text-muted-foreground">
        <FeatureDescription route="/reviews">
          Steps a workflow is waiting on. The build placed them where the governance asks for a
          person — before a costly action, on exceptions, above a threshold or on a sample. Approve
          to continue, correct the values that are wrong, or reject to stop the run.
        </FeatureDescription>
      </p>
      <div className="mt-5 flex flex-wrap gap-1">
        {FILTERS.map((f) => (
          <button
            key={f.value}
            type="button"
            onClick={() => setStatus(f.value)}
            className={cn(
              "rounded-lg border px-3 py-1 text-xs",
              status === f.value
                ? "border-primary text-primary"
                : "border-border text-muted-foreground hover:text-foreground",
            )}
          >
            {f.label}
          </button>
        ))}
      </div>
      <div className="mt-4 space-y-3">
        {reviews.isError ? (
          <ErrorState error={reviews.error} />
        ) : reviews.isLoading ? (
          <p className="text-xs text-muted-foreground">
            <Loader2 className="inline size-3.5 animate-spin" /> Loading…
          </p>
        ) : (reviews.data?.reviews ?? []).length === 0 ? (
          <EmptyState
            icon={<ShieldAlert className="size-5" />}
            title="Nothing here"
            description={
              status === "pending"
                ? "No workflow is waiting for a person."
                : "No reviews with this outcome."
            }
          />
        ) : (
          reviews.data!.reviews.map((r) => <ReviewCard key={r.id} review={r} />)
        )}
      </div>
    </div>
  );
}

function ReviewCard({ review }: { review: HumanReview }) {
  const monitor = review.engine === "monitor";
  return (
    <div className="glass rounded-xl border border-border/60 p-4">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <p className="text-sm font-semibold text-foreground">{review.title}</p>
        <span className="rounded-full border border-border px-1.5 text-[10px] text-muted-foreground">
          {monitor ? "monitoring" : review.engine === "mistral" ? "Mistral Workflows" : "local run"}
        </span>
        <span className="ml-auto text-[11px] text-muted-foreground">
          {review.workflow_name ? (
            <Link
              to="/workflows/$workflowName/execute"
              params={{ workflowName: review.workflow_name }}
              search={{ execId: review.execution_id }}
              className="inline-flex items-center gap-1 hover:text-foreground hover:underline"
            >
              {review.workflow_name} · run {review.execution_id.slice(0, 8)}
              <ArrowUpRight className="size-3" />
            </Link>
          ) : (
            <>execution {review.execution_id.slice(0, 12)}</>
          )}
        </span>
      </div>
      <ReviewDecisionForm review={review} />
    </div>
  );
}
