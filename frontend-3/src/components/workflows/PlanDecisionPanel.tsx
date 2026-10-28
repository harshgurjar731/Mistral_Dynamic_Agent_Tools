/**
 * The question a workflow plan stopped to ask, as a popup.
 *
 * Planning pauses when an activity or agent still cannot be built after every
 * automatic attempt, and again once the workflow is built so the user can test
 * it and decide whether to keep it. Nothing is rolled back or accepted until the
 * user answers.
 *
 * The question opens as a dialog the moment it arrives, because a panel at the
 * end of a long timeline went unnoticed and the plan sat waiting. Closing it
 * ("Decide later") leaves a banner pinned to the bottom of the page that
 * reopens it, and the tab title says an answer is needed.
 *
 * Choosing Retry lets the user say what to change first; that message goes to
 * the builder as guidance for the retried items.
 *
 * A "prerequisites" question — what a build needs from the user before it
 * starts — has its own form (`PrerequisitesForm`). It is also asked by agent
 * builds, so the paused banner's wording comes from the caller.
 */
import { useMutation } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  AlertTriangle,
  BellRing,
  CheckCircle2,
  ChevronDown,
  FlaskConical,
  Hand,
  Loader2,
  MessageSquareText,
  RefreshCw,
  Undo2,
  type LucideIcon,
} from "lucide-react";
import { errorMessage, runsApi, type RunDecision } from "@/api";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { PrerequisitesForm } from "@/components/vault/PrerequisitesForm";
import { cn } from "@/lib/utils";
import { LivePercent } from "@/components/activity/LiveProgress";

interface ChoiceMeta {
  label: string;
  /** Label on the confirm button once this choice is selected. */
  confirm: string;
  detail: string;
  icon: LucideIcon;
  destructive?: boolean;
}

const CHOICES: Record<string, ChoiceMeta> = {
  retry: {
    label: "Retry building",
    confirm: "Retry now",
    detail: "Build the failed items again. You will be asked again if they still fail.",
    icon: RefreshCw,
  },
  manual: {
    label: "Finish without them",
    confirm: "Finish the workflow",
    detail:
      "Complete the workflow now and build or write the missing pieces later. It is saved but not registered until they exist.",
    icon: Hand,
  },
  rollback: {
    label: "Roll back",
    confirm: "Roll back everything",
    detail: "Remove everything this plan has created so far, and stop.",
    icon: Undo2,
    destructive: true,
  },
  test: {
    label: "Test workflow",
    confirm: "Run the test",
    detail:
      "Run each activity against its worked examples and check every agent exists. Nothing is changed.",
    icon: FlaskConical,
  },
  accept: {
    label: "Accept & register",
    confirm: "Accept & register",
    detail: "Keep the workflow and register it so it can run.",
    icon: CheckCircle2,
  },
};

const ENTITY_NOUN: Record<string, string> = { activity: "activities", agent: "agents" };

/** What to suggest typing for a retry. */
const RETRY_PLACEHOLDER: Record<string, string> = {
  activity:
    "e.g. Take the tax rate as an input instead of hard-coding 18%, and return amounts rounded to 2 decimals.",
  agent: "e.g. Keep the instructions shorter and focus only on drafting the reminder email.",
};

export function PlanDecisionDialog({
  runId,
  decision,
  pausedText = "Planning is paused — your answer is needed",
}: {
  runId: string;
  decision: RunDecision;
  pausedText?: string | undefined;
}) {
  const [openFor, setOpenFor] = useState<string | null>(decision.id);
  const open = openFor === decision.id;

  // Each new question opens itself, and the tab title flags it while unanswered.
  useEffect(() => {
    setOpenFor(decision.id);
    const previous = document.title;
    document.title = `(Action needed) ${previous.replace(/^\(Action needed\) /, "")}`;
    return () => {
      document.title = previous.replace(/^\(Action needed\) /, "");
    };
  }, [decision.id]);

  return (
    <>
      <Dialog open={open} onOpenChange={(next) => setOpenFor(next ? decision.id : null)}>
        <DialogContent
          className="max-h-[88vh] max-w-2xl gap-0 overflow-hidden p-0"
          // A stray click outside must not dismiss a question the plan is waiting on.
          onInteractOutside={(e) => e.preventDefault()}
        >
          {decision.kind === "prerequisites" ? (
            <PrerequisitesForm
              key={decision.id}
              runId={runId}
              decision={decision}
              onLater={() => setOpenFor(null)}
            />
          ) : (
            <DecisionForm
              key={decision.id}
              runId={runId}
              decision={decision}
              onLater={() => setOpenFor(null)}
            />
          )}
        </DialogContent>
      </Dialog>

      {!open ? (
        <div className="fixed inset-x-4 bottom-4 z-40 mx-auto flex max-w-3xl items-center gap-3 rounded-2xl border border-amber/50 bg-background/95 px-4 py-3 shadow-2xl backdrop-blur">
          <BellRing className="size-4 shrink-0 animate-pulse text-amber" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-foreground">{pausedText}</p>
            <p className="truncate text-[11px] text-muted-foreground">{decision.title}</p>
          </div>
          <Button size="sm" onClick={() => setOpenFor(decision.id)}>
            Answer now
          </Button>
        </div>
      ) : null}
    </>
  );
}

function DecisionForm({
  runId,
  decision,
  onLater,
}: {
  runId: string;
  decision: RunDecision;
  onLater: () => void;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [showCreated, setShowCreated] = useState(false);
  const answer = useMutation({
    mutationFn: ({ choice, text }: { choice: string; text?: string }) =>
      runsApi.decide(runId, decision.id, choice, text),
    onError: (e) => toast.error(errorMessage(e)),
  });

  const created = decision.created ?? [];
  const failures = decision.failures ?? [];
  const takesMessage = Boolean(selected && decision.message_options?.includes(selected));
  const meta = selected ? CHOICES[selected] : undefined;
  const busy = answer.isPending || answer.isSuccess;
  const entity = decision.entity ?? "activity";

  const submit = () => {
    if (!selected) return;
    const text = takesMessage ? message.trim() : "";
    answer.mutate(text ? { choice: selected, text } : { choice: selected });
  };

  return (
    <div className="flex max-h-[88vh] flex-col">
      <DialogHeader className="border-b border-border bg-amber/5 px-6 py-4 text-left">
        <DialogTitle className="flex items-center gap-2 text-base">
          <AlertTriangle className="size-4 shrink-0 text-amber" />
          {decision.title ?? "Planning is waiting for your decision"}
        </DialogTitle>
        <DialogDescription className="text-xs">
          {decision.kind === "build_failed"
            ? `Planning is paused. The ${ENTITY_NOUN[entity] ?? "items"} below still failed after ${
                decision.attempts ?? "every"
              } automatic attempt(s). Choose what to do — nothing changes until you confirm.`
            : "Planning is paused at review. Test it, then accept it or roll it back."}
        </DialogDescription>
      </DialogHeader>

      <div className="flex-1 space-y-4 overflow-y-auto px-6 py-4">
        {decision.kind === "build_failed" && failures.length > 0 ? (
          <section>
            <p className="mb-2 text-[10px] font-semibold tracking-wider text-muted-foreground uppercase">
              What failed
            </p>
            <div className="space-y-2">
              {failures.map((f, i) => (
                <div
                  key={`${f.id}-${i}`}
                  className="rounded-lg border border-destructive/25 bg-destructive/5 px-3 py-2 text-[11px]"
                >
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="font-mono font-medium text-foreground">{f.name || f.id}</span>
                    {f.step ? (
                      <span className="text-muted-foreground">· step for {f.step}</span>
                    ) : null}
                    {f.rolled_back ? (
                      <span className="rounded border border-destructive/30 px-1 py-px text-[9px] text-destructive uppercase">
                        broken build rolled back
                      </span>
                    ) : null}
                  </div>
                  {f.error ? (
                    <p className="mt-1 line-clamp-4 text-destructive/90">{f.error}</p>
                  ) : null}
                </div>
              ))}
            </div>
          </section>
        ) : null}

        {decision.kind === "review_workflow" ? (
          <section className="rounded-lg border border-border bg-background-elevated/50 px-3 py-2.5 text-[11px] text-muted-foreground">
            <p>
              <span className="font-mono text-foreground">{decision.workflow_name}</span> is saved
              {decision.valid ? "" : " but has validation errors, so it will not be registered"}.
            </p>
            <p className="mt-1">
              {decision.last_test ? (
                <>
                  Last test:{" "}
                  <span className={decision.last_test.passed ? "text-emerald" : "text-destructive"}>
                    {decision.last_test.passed ? "passed" : "failed"}
                  </span>{" "}
                  — {decision.last_test.summary}. The results are in the Review step on the page.
                </>
              ) : (
                "It has not been tested yet."
              )}
            </p>
            {decision.revisable ? (
              <p className="mt-1">
                To change the workflow itself, choose <em>Decide later</em> and describe the change
                in <em>Refine your workflow</em> on the page; accepting registers the latest
                version.
              </p>
            ) : null}
          </section>
        ) : null}

        <section>
          <p className="mb-2 text-[10px] font-semibold tracking-wider text-muted-foreground uppercase">
            Choose what to do
          </p>
          <div role="radiogroup" className="space-y-2">
            {decision.options.map((option) => {
              const m = CHOICES[option] ?? {
                label: option,
                confirm: option,
                detail: "",
                icon: RefreshCw,
              };
              const Icon = m.icon;
              const active = selected === option;
              return (
                <button
                  key={option}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  disabled={busy}
                  onClick={() => setSelected(option)}
                  className={cn(
                    "flex w-full items-start gap-3 rounded-xl border px-3 py-2.5 text-left transition disabled:opacity-50",
                    active
                      ? m.destructive
                        ? "border-destructive bg-destructive/10"
                        : "border-primary bg-primary/10"
                      : "border-border hover:border-primary/40 hover:bg-surface-hover",
                  )}
                >
                  <span
                    className={cn(
                      "mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border",
                      active
                        ? m.destructive
                          ? "border-destructive"
                          : "border-primary"
                        : "border-border",
                    )}
                  >
                    {active ? (
                      <span
                        className={cn(
                          "size-2 rounded-full",
                          m.destructive ? "bg-destructive" : "bg-primary",
                        )}
                      />
                    ) : null}
                  </span>
                  <span className="min-w-0">
                    <span
                      className={cn(
                        "flex items-center gap-1.5 text-xs font-semibold",
                        m.destructive ? "text-destructive" : "text-foreground",
                      )}
                    >
                      <Icon className="size-3.5" /> {m.label}
                      {option === decision.default ? (
                        <span className="text-[9px] font-normal text-muted-foreground">
                          (default if unanswered)
                        </span>
                      ) : null}
                    </span>
                    <span className="mt-0.5 block text-[11px] leading-relaxed text-muted-foreground">
                      {m.detail}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        </section>

        {takesMessage ? (
          <section>
            <label
              htmlFor={`decision-message-${decision.id}`}
              className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-foreground"
            >
              <MessageSquareText className="size-3.5 text-primary" />
              What should change before retrying?{" "}
              <span className="text-muted-foreground">(optional)</span>
            </label>
            <Textarea
              id={`decision-message-${decision.id}`}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              maxLength={2000}
              rows={4}
              autoFocus
              placeholder={RETRY_PLACEHOLDER[entity] ?? "Describe what to change."}
              className="text-xs"
            />
            <p className="mt-1 text-[10px] text-muted-foreground">
              {entity === "agent"
                ? "Added to each failed agent's instructions before it is created again."
                : "Given to the builder as instructions for the failed activities; it is still checked by the safety policy."}{" "}
              Leave empty to retry as is. {message.length}/2000
            </p>
          </section>
        ) : null}

        {meta?.destructive ? (
          <p className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-[11px] text-destructive">
            This removes {created.length || "everything"} item(s) this plan created and stops
            planning. It cannot be undone.
          </p>
        ) : null}

        {created.length > 0 ? (
          <section>
            <button
              type="button"
              onClick={() => setShowCreated((v) => !v)}
              className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
            >
              <ChevronDown className={cn("size-3 transition", showCreated && "rotate-180")} />
              Created by this plan so far ({created.length})
            </button>
            {showCreated ? (
              <ul className="mt-1.5 space-y-0.5 pl-4 text-[11px] text-muted-foreground">
                {created.map((c) => (
                  <li key={`${c.kind}-${c.id}`}>
                    <span className="text-foreground/80">{c.kind}</span>{" "}
                    <span className="font-mono">{c.name || c.id}</span>
                  </li>
                ))}
              </ul>
            ) : null}
          </section>
        ) : null}
      </div>

      <DialogFooter className="gap-2 border-t border-border px-6 py-3 sm:space-x-0">
        <Button variant="ghost" size="sm" onClick={onLater} disabled={answer.isPending}>
          Decide later
        </Button>
        <Button
          size="sm"
          variant={meta?.destructive ? "destructive" : "default"}
          disabled={!selected || busy}
          onClick={submit}
        >
          {answer.isPending ? (
            <>
              <Loader2 className="size-3.5 animate-spin" />
              <LivePercent />
            </>
          ) : null}
          {answer.isSuccess
            ? "Sent — continuing…"
            : meta
              ? takesMessage && message.trim()
                ? `${meta.confirm} with my changes`
                : meta.confirm
              : "Choose an option"}
        </Button>
      </DialogFooter>
    </div>
  );
}
