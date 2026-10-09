/**
 * The question a workflow plan stopped to ask.
 *
 * Planning pauses when an activity or agent still cannot be built after every
 * automatic attempt, and again once the workflow is built so the user can test
 * it and decide whether to keep it. Nothing is rolled back or accepted until the
 * user answers here.
 */
import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { AlertTriangle, CheckCircle2, FlaskConical, Hand, RefreshCw, Undo2 } from "lucide-react";
import { errorMessage, runsApi, type RunDecision } from "@/api";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const CHOICES: Record<
  string,
  { label: string; detail: string; icon: typeof RefreshCw; destructive?: boolean }
> = {
  retry: {
    label: "Retry building",
    detail: "Try building the failed items again. You will be asked again if they still fail.",
    icon: RefreshCw,
  },
  manual: {
    label: "Finish without them",
    detail:
      "Complete the workflow now; build or write their code later. The workflow is saved but not registered until they exist.",
    icon: Hand,
  },
  rollback: {
    label: "Roll back",
    detail: "Remove everything this plan has created so far and stop.",
    icon: Undo2,
    destructive: true,
  },
  test: {
    label: "Test workflow",
    detail:
      "Run each activity against its worked examples and check every agent exists. Nothing is changed.",
    icon: FlaskConical,
  },
  accept: {
    label: "Accept & register",
    detail: "Keep the workflow and register it so it can run.",
    icon: CheckCircle2,
  },
};

export function PlanDecisionPanel({ runId, decision }: { runId: string; decision: RunDecision }) {
  const [confirming, setConfirming] = useState(false);
  const answer = useMutation({
    mutationFn: (choice: string) => runsApi.decide(runId, decision.id, choice),
    onError: (e) => toast.error(errorMessage(e)),
  });
  const created = decision.created ?? [];
  const failures = decision.failures ?? [];
  const busy = answer.isPending || answer.isSuccess;

  const choose = (choice: string) => {
    if (CHOICES[choice]?.destructive && !confirming) {
      setConfirming(true);
      return;
    }
    setConfirming(false);
    answer.mutate(choice);
  };

  return (
    <div className="rounded-2xl border border-amber/40 bg-amber/5 p-5">
      <p className="flex items-center gap-2 text-sm font-semibold text-foreground">
        <AlertTriangle className="size-4 text-amber" />
        {decision.title ?? "Planning is waiting for your decision"}
      </p>

      {decision.kind === "build_failed" ? (
        <div className="mt-3 space-y-2">
          {failures.map((f, i) => (
            <div
              key={`${f.id}-${i}`}
              className="rounded-lg border border-border bg-background-elevated/50 px-3 py-2 text-[11px]"
            >
              <span className="font-mono text-foreground">{f.name || f.id}</span>
              {f.step ? <span className="text-muted-foreground"> · step for {f.step}</span> : null}
              {f.rolled_back ? (
                <span className="ml-1.5 rounded border border-destructive/30 px-1 py-px text-[9px] text-destructive uppercase">
                  broken build rolled back
                </span>
              ) : null}
              {f.error ? <p className="mt-0.5 text-destructive">{f.error}</p> : null}
            </div>
          ))}
        </div>
      ) : null}

      {decision.kind === "review_workflow" ? (
        <p className="mt-2 text-[11px] text-muted-foreground">
          <span className="font-mono text-foreground">{decision.workflow_name}</span> is saved
          {decision.valid ? "" : " but has validation errors, so it will not be registered"}.{" "}
          {decision.last_test
            ? `Last test: ${decision.last_test.passed ? "passed" : "failed"} — ${decision.last_test.summary}. `
            : "It has not been tested. "}
          A failed activity can be rebuilt from the test results above before testing again.
        </p>
      ) : null}

      {created.length > 0 ? (
        <p className="mt-3 text-[10px] text-muted-foreground">
          Created by this plan so far ({created.length}):{" "}
          {created.map((c) => `${c.kind} ${c.name || c.id}`).join(", ")}
        </p>
      ) : null}

      <div className="mt-4 grid gap-2 sm:grid-cols-3">
        {decision.options.map((option) => {
          const meta = CHOICES[option] ?? { label: option, detail: "", icon: RefreshCw };
          const Icon = meta.icon;
          const armed = confirming && meta.destructive;
          return (
            <button
              key={option}
              type="button"
              disabled={busy}
              onClick={() => choose(option)}
              className={cn(
                "rounded-xl border px-3 py-2.5 text-left transition disabled:opacity-50",
                meta.destructive
                  ? "border-destructive/30 hover:bg-destructive/10"
                  : "border-border hover:border-primary/40 hover:bg-surface-hover",
                armed && "border-destructive bg-destructive/10",
              )}
            >
              <span
                className={cn(
                  "flex items-center gap-1.5 text-xs font-semibold",
                  meta.destructive ? "text-destructive" : "text-foreground",
                )}
              >
                <Icon className="size-3.5" />
                {armed ? "Click again to roll back" : meta.label}
              </span>
              <span className="mt-1 block text-[10px] leading-relaxed text-muted-foreground">
                {meta.detail}
              </span>
            </button>
          );
        })}
      </div>
      {confirming ? (
        <Button
          variant="ghost"
          size="sm"
          className="mt-2 h-6 text-[10px]"
          onClick={() => setConfirming(false)}
        >
          Cancel
        </Button>
      ) : null}
      {busy ? (
        <p className="mt-2 text-[10px] text-muted-foreground">Answer sent — continuing…</p>
      ) : null}
    </div>
  );
}
