/**
 * The review window: a run is waiting for a person at one of its steps.
 */
import { ShieldAlert } from "lucide-react";
import type { HumanReview } from "@/api/knowledge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ReviewDecisionForm } from "./ReviewDecisionForm";

export function HumanReviewDialog({
  review,
  open,
  onOpenChange,
  onDecided,
}: {
  review: HumanReview | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDecided?: (settled: HumanReview) => void;
}) {
  return (
    <Dialog open={open && Boolean(review)} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl gap-5">
        {review ? (
          <>
            <DialogHeader>
              <div className="flex items-start gap-3">
                <span className="grid size-9 shrink-0 place-items-center rounded-lg border border-amber/30 bg-amber/10 text-amber">
                  <ShieldAlert className="size-4.5" />
                </span>
                <div className="min-w-0">
                  <DialogTitle className="text-base leading-snug">
                    {review.title || `Review: ${review.step_id}`}
                  </DialogTitle>
                  <DialogDescription className="mt-1 text-xs">
                    {review.status === "pending"
                      ? `${review.workflow_name ?? "The workflow"} is paused until you decide. Approve to continue, correct the values that are wrong, or reject to stop the run.`
                      : "This review has been decided."}
                  </DialogDescription>
                </div>
              </div>
            </DialogHeader>
            <ReviewDecisionForm
              key={review.id}
              review={review}
              autoFocus
              onDecided={(settled) => {
                onDecided?.(settled);
                onOpenChange(false);
              }}
            />
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
