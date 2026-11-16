/**
 * Deciding a human review: what to check, the values that may be corrected,
 * and the decision. Shared by the review inbox and the run page's review
 * window, so both behave the same.
 *
 * Each correctable field starts at the value the workflow produced, with a
 * control for its type. Only fields that were actually changed are sent as
 * corrections.
 */
import { useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Check, Clock, Loader2, Pencil, RotateCcw, ShieldCheck, X } from "lucide-react";
import { errorMessage, reviewsApi } from "@/api";
import type { HumanReview } from "@/api/knowledge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { DataView } from "@/components/workflows/result/ExecutionResult";
import { humaniseKey, normaliseValue } from "@/components/workflows/result/resultModel";
import { useCurrentUser } from "@/lib/auth";
import { useCanCall } from "@/lib/policy";
import { formatRelative, parseServerTime } from "@/lib/status";
import { cn } from "@/lib/utils";

type Decision = "approve" | "edit" | "reject";

const isRecord = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === "object" && !Array.isArray(v);

/** The produced value of a correctable field: at the top of the output, or one level in. */
function producedValue(payload: unknown, field: string): unknown {
  const v = normaliseValue(payload);
  if (!isRecord(v)) return undefined;
  if (field in v) return normaliseValue(v[field]);
  for (const inner of Object.values(v)) {
    const n = normaliseValue(inner);
    if (isRecord(n) && field in n) return normaliseValue(n[field]);
  }
  return undefined;
}

type Kind = "boolean" | "number" | "long" | "text" | "json";

function kindOf(value: unknown): Kind {
  if (typeof value === "boolean") return "boolean";
  if (typeof value === "number") return "number";
  if (value !== null && typeof value === "object") return "json";
  if (typeof value === "string" && (value.length > 80 || value.includes("\n"))) return "long";
  return "text";
}

function toDraft(value: unknown, kind: Kind): string | boolean {
  if (kind === "boolean") return value === true;
  if (value === undefined || value === null) return "";
  if (kind === "json") return JSON.stringify(value, null, 2);
  return String(value);
}

function fromDraft(draft: string | boolean, kind: Kind): { value?: unknown; error?: string } {
  if (kind === "boolean") return { value: draft === true };
  const text = String(draft);
  if (kind === "number") {
    if (text.trim() === "") return { error: "Enter a number" };
    const n = Number(text);
    return Number.isNaN(n) ? { error: "Enter a number" } : { value: n };
  }
  if (kind === "json") {
    try {
      return { value: JSON.parse(text) as unknown };
    } catch {
      return { error: "Invalid JSON" };
    }
  }
  return { value: text };
}

export function slaLeft(review: HumanReview): string | null {
  if (!review.sla_seconds || !review.created_at) return null;
  const due = parseServerTime(review.created_at) + review.sla_seconds * 1000;
  const left = due - Date.now();
  if (Number.isNaN(left)) return null;
  if (left <= 0) return "overdue";
  const h = Math.floor(left / 3_600_000);
  const m = Math.round((left % 3_600_000) / 60_000);
  return h >= 1 ? `${h}h ${m}m left` : `${m}m left`;
}

export function ReviewDecisionForm({
  review,
  onDecided,
  autoFocus = false,
}: {
  review: HumanReview;
  onDecided?: (settled: HumanReview) => void;
  autoFocus?: boolean;
}) {
  const canDecide = useCanCall("POST", "/api/reviews/x/decision");
  const me = useCurrentUser();
  const qc = useQueryClient();
  const [view, setView] = useState<"rendered" | "raw">("rendered");
  const [comment, setComment] = useState("");
  const [decidedBy, setDecidedBy] = useState(me?.name ?? "");

  const fields = useMemo(
    () =>
      (review.editable ?? []).map((name) => {
        const produced = producedValue(review.payload, name);
        const kind = kindOf(produced);
        return { name, produced, kind, initial: toDraft(produced, kind) };
      }),
    [review.editable, review.payload],
  );
  const [drafts, setDrafts] = useState<Record<string, string | boolean>>(() =>
    Object.fromEntries(fields.map((f) => [f.name, f.initial])),
  );

  const parsed = fields.map((f) => {
    const draft = drafts[f.name] ?? f.initial;
    const changed = draft !== f.initial;
    return { ...f, draft, changed, ...(changed ? fromDraft(draft, f.kind) : {}) };
  });
  const changed = parsed.filter((p) => p.changed);
  const invalid = changed.filter((p) => p.error);

  const decide = useMutation({
    mutationFn: (decision: Decision) => {
      const edits = Object.fromEntries(changed.map((p) => [p.name, p.value]));
      return reviewsApi.decide(review.id, {
        decision,
        comment: comment.trim(),
        decided_by: decidedBy.trim(),
        ...(decision === "edit" ? { edits } : {}),
      });
    },
    onSuccess: (settled) => {
      const words: Record<string, string> = {
        approved: "Approved — the run continues.",
        edited: "Corrected — the run continues with your values.",
        rejected: "Rejected — the run stops.",
      };
      toast.success(words[settled.status] ?? `Review ${settled.status}`);
      void qc.invalidateQueries({ queryKey: ["reviews"] });
      onDecided?.(settled);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const pending = review.status === "pending";
  const monitor = review.engine === "monitor";
  const sla = slaLeft(review);
  const busy = decide.isPending;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
        <span>
          Step <span className="font-mono text-foreground">{review.step_id}</span>
        </span>
        {review.reviewer_role ? <span>For {review.reviewer_role}</span> : null}
        {review.created_at ? <span>Opened {formatRelative(review.created_at)}</span> : null}
        {sla && pending ? (
          <span
            className={cn(
              "inline-flex items-center gap-1",
              sla === "overdue" ? "text-red" : "text-amber",
            )}
          >
            <Clock className="size-3" /> {sla === "overdue" ? "Past its deadline" : sla}
          </span>
        ) : null}
      </div>

      {review.instructions ? (
        <div className="flex gap-2 rounded-lg border border-primary/25 bg-primary/5 px-3 py-2.5 text-xs leading-relaxed text-foreground">
          <ShieldCheck className="mt-0.5 size-3.5 shrink-0 text-primary" />
          <p>{review.instructions}</p>
        </div>
      ) : null}

      <section>
        <div className="mb-1.5 flex items-center gap-2">
          <h3 className="text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
            What to check
          </h3>
          <div className="ml-auto flex rounded-md border border-border bg-background-elevated/60 p-0.5">
            {(["rendered", "raw"] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setView(m)}
                className={cn(
                  "rounded px-2 py-0.5 text-[10px] font-medium transition",
                  view === m
                    ? "bg-surface text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {m === "rendered" ? "Formatted" : "Raw JSON"}
              </button>
            ))}
          </div>
        </div>
        <div className="custom-scrollbar max-h-[42vh] overflow-auto rounded-lg border border-border/70 bg-background-elevated/50 p-3">
          {review.payload == null ? (
            <p className="text-xs text-muted-foreground">The step produced no output to show.</p>
          ) : view === "raw" ? (
            <pre className="font-mono text-[11px] leading-relaxed whitespace-pre-wrap text-foreground">
              {typeof review.payload === "string"
                ? review.payload
                : JSON.stringify(review.payload, null, 2)}
            </pre>
          ) : (
            <DataView value={review.payload} />
          )}
        </div>
      </section>

      {!pending ? (
        <p className="rounded-lg border border-border bg-secondary/50 px-3 py-2 text-xs text-muted-foreground">
          {humaniseKey(review.status)}
          {review.decided_by ? ` by ${review.decided_by}` : ""}
          {review.decided_at ? ` ${formatRelative(review.decided_at)}` : ""}
          {review.comment ? ` — “${review.comment}”` : ""}
        </p>
      ) : !canDecide ? (
        <p className="rounded-lg border border-border bg-secondary/60 px-3 py-2 text-xs text-muted-foreground">
          Waiting for a reviewer. Your role can see reviews but not decide them.
        </p>
      ) : (
        <>
          {parsed.length ? (
            <section className="space-y-2.5">
              <div className="flex items-center gap-2">
                <h3 className="text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
                  Correct if wrong
                </h3>
                {changed.length ? (
                  <span className="rounded-full border border-amber/30 bg-amber/10 px-1.5 text-[10px] text-amber">
                    {changed.length} changed
                  </span>
                ) : null}
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                {parsed.map((p) => {
                  const id = `review-${review.id}-${p.name}`;
                  const set = (v: string | boolean) => setDrafts((d) => ({ ...d, [p.name]: v }));
                  const wide = p.kind === "long" || p.kind === "json";
                  return (
                    <div key={p.name} className={cn(wide && "sm:col-span-2")}>
                      <div className="mb-1 flex items-center gap-1.5">
                        <label htmlFor={id} className="text-xs font-medium text-foreground">
                          {humaniseKey(p.name)}
                        </label>
                        {p.changed ? (
                          <button
                            type="button"
                            onClick={() => set(p.initial)}
                            className="ml-auto inline-flex items-center gap-0.5 text-[10px] text-muted-foreground hover:text-foreground"
                          >
                            <RotateCcw className="size-2.5" /> Undo
                          </button>
                        ) : null}
                      </div>
                      {p.kind === "boolean" ? (
                        <label htmlFor={id} className="flex h-9 items-center gap-2">
                          <Switch id={id} checked={p.draft === true} onCheckedChange={set} />
                          <span className="text-xs">{p.draft === true ? "Yes" : "No"}</span>
                        </label>
                      ) : p.kind === "long" || p.kind === "json" ? (
                        <Textarea
                          id={id}
                          rows={p.kind === "json" ? 5 : 3}
                          value={String(p.draft)}
                          spellCheck={p.kind !== "json"}
                          onChange={(e) => set(e.target.value)}
                          className={cn(
                            "text-xs",
                            p.kind === "json" && "font-mono",
                            p.changed && "border-amber/50",
                            p.error && "border-red/60",
                          )}
                        />
                      ) : (
                        <Input
                          id={id}
                          type={p.kind === "number" ? "number" : "text"}
                          step="any"
                          value={String(p.draft)}
                          placeholder={p.produced === undefined ? "Not in the output" : ""}
                          onChange={(e) => set(e.target.value)}
                          className={cn(
                            "h-9 text-xs",
                            p.kind === "number" && "tabular-nums",
                            p.changed && "border-amber/50",
                            p.error && "border-red/60",
                          )}
                        />
                      )}
                      {p.error ? <p className="mt-0.5 text-[10px] text-red">{p.error}</p> : null}
                    </div>
                  );
                })}
              </div>
            </section>
          ) : null}

          <section className="grid gap-3 sm:grid-cols-[1fr_200px]">
            <div>
              <label
                htmlFor={`review-${review.id}-comment`}
                className="mb-1 block text-xs font-medium text-foreground"
              >
                Comment{" "}
                <span className="font-normal text-muted-foreground">(required to reject)</span>
              </label>
              <Textarea
                id={`review-${review.id}-comment`}
                autoFocus={autoFocus && !parsed.length}
                rows={2}
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                placeholder="Why you decided this — kept with the run."
                className="text-xs"
              />
            </div>
            <div>
              <label
                htmlFor={`review-${review.id}-by`}
                className="mb-1 block text-xs font-medium text-foreground"
              >
                Decided by
              </label>
              <Input
                id={`review-${review.id}-by`}
                value={decidedBy}
                onChange={(e) => setDecidedBy(e.target.value)}
                placeholder="Your name"
                className="h-9 text-xs"
              />
            </div>
          </section>

          <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border pt-3">
            <Button
              size="sm"
              variant="ghost"
              className="text-red hover:bg-red/10 hover:text-red"
              disabled={busy || !comment.trim()}
              title={comment.trim() ? undefined : "Add a comment to reject"}
              onClick={() => decide.mutate("reject")}
            >
              <X className="size-3.5" /> Reject
            </Button>
            {parsed.length ? (
              <Button
                size="sm"
                variant="secondary"
                disabled={busy || changed.length === 0 || invalid.length > 0}
                onClick={() => decide.mutate("edit")}
              >
                <Pencil className="size-3.5" /> Correct and continue
              </Button>
            ) : null}
            <Button
              size="sm"
              disabled={busy || changed.length > 0}
              title={changed.length ? "You changed values — use Correct and continue" : undefined}
              onClick={() => decide.mutate("approve")}
            >
              {busy ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Check className="size-3.5" />
              )}
              {monitor ? "Mark reviewed" : "Approve"}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
