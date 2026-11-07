import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Loader2, Pencil, ShieldAlert, X } from "lucide-react";
import { toast } from "sonner";
import { errorMessage, QK, reviewsApi } from "@/api";
import type { HumanReview } from "@/api/knowledge";
import { FeatureDescription, FeatureTitle } from "@/components/layout/FeatureText";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { formatRelative } from "@/lib/status";
import { cn } from "@/lib/utils";
import { useCanCall } from "@/lib/policy";
import { useCurrentUser } from "@/lib/auth";

export const Route = createFileRoute("/reviews")({
  head: () => ({
    meta: [
      { title: "Reviews — Agentic AI Design Patterns" },
      { name: "description", content: "Workflow steps waiting for a person to approve, correct or reject." },
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
          Steps a workflow is waiting on. The build placed them where the governance asks for a person — before a
          costly action, on exceptions, above a threshold or on a sample. Approve to continue, correct the values that
          are wrong, or reject to stop the run.
        </FeatureDescription>
      </p>
      <div className="mt-5 flex flex-wrap gap-1">
        {FILTERS.map((f) => (
          <button key={f.value} type="button" onClick={() => setStatus(f.value)}
            className={cn("rounded-lg border px-3 py-1 text-xs",
              status === f.value ? "border-primary text-primary" : "border-border text-muted-foreground hover:text-foreground")}>
            {f.label}
          </button>
        ))}
      </div>
      <div className="mt-4 space-y-3">
        {reviews.isError ? (
          <ErrorState error={reviews.error} />
        ) : reviews.isLoading ? (
          <p className="text-xs text-muted-foreground"><Loader2 className="inline size-3.5 animate-spin" /> Loading…</p>
        ) : (reviews.data?.reviews ?? []).length === 0 ? (
          <EmptyState icon={<ShieldAlert className="size-5" />} title="Nothing here"
            description={status === "pending" ? "No workflow is waiting for a person." : "No reviews with this outcome."} />
        ) : (
          reviews.data!.reviews.map((r) => <ReviewCard key={r.id} review={r} />)
        )}
      </div>
    </div>
  );
}

function ReviewCard({ review }: { review: HumanReview }) {
  const canDecide = useCanCall("POST", "/api/reviews/x/decision");
  const me = useCurrentUser();
  const qc = useQueryClient();
  const [comment, setComment] = useState("");
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [decidedBy, setDecidedBy] = useState(me?.name ?? "");
  const decide = useMutation({
    mutationFn: (decision: "approve" | "edit" | "reject") => {
      const parsed: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(edits)) {
        try {
          parsed[k] = JSON.parse(v);
        } catch {
          parsed[k] = v;
        }
      }
      return reviewsApi.decide(review.id, {
        decision,
        comment,
        decided_by: decidedBy,
        ...(decision === "edit" ? { edits: parsed } : {}),
      });
    },
    onSuccess: (r) => {
      toast.success(`Review ${r.status}`);
      void qc.invalidateQueries({ queryKey: ["reviews"] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const pending = review.status === "pending";
  const monitor = review.engine === "monitor";
  const hasEdits = Object.values(edits).some((v) => v.trim());

  return (
    <div className="glass rounded-xl border border-border/60 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-sm font-semibold text-foreground">{review.title}</p>
        <span className="rounded-full border border-border px-1.5 text-[10px] text-muted-foreground">
          {monitor ? "monitoring" : review.engine === "mistral" ? "Mistral Workflows" : "local run"}
        </span>
        {review.reviewer_role ? <span className="text-[11px] text-muted-foreground">for {review.reviewer_role}</span> : null}
        <span className="ml-auto text-[11px] text-muted-foreground">{review.created_at ? formatRelative(review.created_at) : ""}</span>
      </div>
      <p className="mt-0.5 text-[11px] text-muted-foreground">
        {review.workflow_name ? (
          <Link to="/workflows/$workflowName" params={{ workflowName: review.workflow_name }} className="hover:underline">
            {review.workflow_name}
          </Link>
        ) : "workflow"}{" "}
        · step {review.step_id} · execution {review.execution_id.slice(0, 12)}
        {review.sla_seconds ? ` · decide within ${Math.round(review.sla_seconds / 3600)}h` : ""}
      </p>
      {review.instructions ? <p className="mt-2 text-xs text-foreground">{review.instructions}</p> : null}
      <pre className="mt-2 max-h-64 overflow-auto rounded-lg border border-border/60 bg-background-elevated p-2 text-[11px] whitespace-pre-wrap">
        {typeof review.payload === "string" ? review.payload : JSON.stringify(review.payload, null, 2)}
      </pre>
      {pending && !canDecide ? (
        <p className="mt-3 rounded-md border border-border bg-secondary/60 px-3 py-2 text-xs text-muted-foreground">
          Waiting for a reviewer. Your role can see reviews but not decide them.
        </p>
      ) : pending ? (
        <div className="mt-3 space-y-2">
          {review.editable.length ? (
            <div className="grid gap-1.5 sm:grid-cols-2">
              {review.editable.map((field) => (
                <label key={field} className="text-[11px] text-muted-foreground">
                  Correct <span className="font-mono text-foreground">{field}</span>
                  <Input value={edits[field] ?? ""} onChange={(e) => setEdits((d) => ({ ...d, [field]: e.target.value }))}
                    className="mt-0.5 h-8 text-xs" placeholder="leave blank to keep" />
                </label>
              ))}
            </div>
          ) : null}
          <Textarea value={comment} onChange={(e) => setComment(e.target.value)} rows={2} placeholder="Comment (required to reject)" />
          <div className="flex flex-wrap items-center gap-2">
            <Input value={decidedBy} onChange={(e) => setDecidedBy(e.target.value)} placeholder="Your name" className="h-8 w-44 text-xs" />
            <span className="flex-1" />
            <Button size="sm" variant="ghost" disabled={decide.isPending || !comment.trim()} onClick={() => decide.mutate("reject")}>
              <X className="size-3.5" /> Reject
            </Button>
            {review.editable.length ? (
              <Button size="sm" variant="secondary" disabled={decide.isPending || !hasEdits} onClick={() => decide.mutate("edit")}>
                <Pencil className="size-3.5" /> Correct and continue
              </Button>
            ) : null}
            <Button size="sm" disabled={decide.isPending} onClick={() => decide.mutate("approve")}>
              {decide.isPending ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />}
              {monitor ? "Mark reviewed" : "Approve"}
            </Button>
          </div>
        </div>
      ) : (
        <p className="mt-2 text-xs text-muted-foreground">
          {review.status} {review.decided_by ? `by ${review.decided_by}` : ""}
          {review.comment ? ` — “${review.comment}”` : ""}
        </p>
      )}
    </div>
  );
}
