/**
 * The refine conversation: each instruction the user gave and what came of it,
 * with the composer underneath.
 *
 * The composer knows which steps are in focus (picked on the canvas) and offers
 * one-click prompts drawn from what is wrong with the workflow right now.
 */
import { useEffect, useRef, useState } from "react";
import { ArrowUp, Crosshair, Lightbulb, Loader2, MessageSquareText, Wrench, X } from "lucide-react";
import type { RevisionSuggestion, WorkflowRevision } from "@/types";
import { cn } from "@/lib/utils";
import { AssistantTurn, PendingTurn, UserTurn } from "./RevisionMessages";
import type { WorkflowRefine } from "./useWorkflowRefine";

const STARTERS = [
  "Remove the step that isn’t needed",
  "Add a human review step before the final output",
  "Run the independent checks in parallel",
  "Rename the steps so they describe what they do",
];

export function RefineConversation({
  refine,
  className,
}: {
  refine: WorkflowRefine;
  className?: string;
}) {
  const [draft, setDraft] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const { revisions, pending, propose, apply, discard, focus, toggleFocus, suggestions } = refine;

  const last = revisions[revisions.length - 1];
  const awaitingAnswer = !pending && last?.status === "needs_clarification";
  const busy = propose.isPending;

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [revisions.length, pending, last?.status]);

  // Grow with the text, up to a cap.
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(Math.max(el.scrollHeight, 44), 160)}px`;
  }, [draft]);

  // Picking a step on the canvas means "I want to talk about this one".
  useEffect(() => {
    if (focus.length) textareaRef.current?.focus();
  }, [focus.length]);

  const send = (text?: string) => {
    const instruction = (text ?? draft).trim();
    if (!instruction || busy) return;
    propose.mutate({ instruction });
    setDraft("");
  };

  const retry = (rev: WorkflowRevision) => send(rev.instruction);

  const placeholder = awaitingAnswer
    ? "Answer the question…"
    : focus.length
      ? `What should change about ${focus.join(", ")}?`
      : "Describe what to change — e.g. “drop the weather check and send the report to legal first”";

  return (
    <div className={cn("flex min-h-0 flex-col", className)}>
      <div
        ref={scrollRef}
        className="custom-scrollbar min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4"
      >
        {refine.revisionsLoading ? (
          <div className="space-y-3">
            <div className="shimmer ml-auto h-10 w-3/4 rounded-2xl border border-border/50" />
            <div className="shimmer h-24 w-full rounded-2xl border border-border/50" />
          </div>
        ) : revisions.length === 0 && !pending ? (
          <EmptyConversation suggestions={suggestions} onPick={(p) => setDraft(p)} />
        ) : (
          revisions.map((rev, i) => (
            <div key={rev.id} className="space-y-3">
              <UserTurn
                instruction={rev.instruction}
                focus={rev.focus_step_ids}
                at={rev.created_at}
              />
              <AssistantTurn
                revision={rev}
                actions={{
                  latest: i === revisions.length - 1,
                  previewing: refine.previewId === rev.id,
                  onTogglePreview: () =>
                    refine.setPreviewId(refine.previewId === rev.id ? null : rev.id),
                  onApply: (allowErrors) => apply.mutate({ id: rev.id, allowErrors }),
                  onDiscard: () => discard.mutate(rev.id),
                  onRetry: () => retry(rev),
                  applying: apply.isPending && apply.variables?.id === rev.id,
                  discarding: discard.isPending && discard.variables === rev.id,
                }}
              />
            </div>
          ))
        )}
        {pending ? (
          <div className="space-y-3">
            <UserTurn instruction={pending.instruction} focus={pending.focus} />
            <PendingTurn />
          </div>
        ) : null}
      </div>

      {/* ── Composer ── */}
      <div className="border-t border-border/50 p-3">
        {!draft && !busy && revisions.length > 0 && suggestions.length ? (
          <SuggestionChips
            suggestions={suggestions.slice(0, 3)}
            onPick={(p) => setDraft(p)}
            compact
          />
        ) : null}

        <div className="rounded-xl border border-border/60 bg-background-elevated/50 transition focus-within:border-primary/40 focus-within:ring-2 focus-within:ring-primary/15">
          {focus.length ? (
            <div className="flex flex-wrap items-center gap-1 border-b border-border/40 px-2.5 py-1.5">
              <span className="text-[10px] text-muted-foreground">About</span>
              {focus.map((id) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => toggleFocus(id)}
                  className="group inline-flex items-center gap-1 rounded-full border border-primary/30 bg-primary/10 px-1.5 py-px font-mono text-[10px] text-primary transition hover:border-primary/60"
                  title="Remove from focus"
                >
                  <Crosshair className="size-2.5" /> {id}
                  <X className="size-2.5 opacity-60 group-hover:opacity-100" />
                </button>
              ))}
            </div>
          ) : null}
          <div className="flex items-end gap-2 p-1.5">
            <textarea
              ref={textareaRef}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  send();
                }
              }}
              rows={1}
              disabled={busy}
              placeholder={placeholder}
              aria-label="Describe the change to make"
              className="custom-scrollbar min-h-[44px] flex-1 resize-none bg-transparent px-2 py-2.5 text-sm text-foreground outline-none placeholder:text-muted-foreground/80 disabled:opacity-60"
            />
            <button
              type="button"
              onClick={() => send()}
              disabled={!draft.trim() || busy}
              aria-label="Send"
              className="mb-1 grid size-9 shrink-0 place-items-center rounded-lg bg-gradient-brand text-primary-foreground shadow-md transition hover:opacity-90 disabled:opacity-40"
            >
              {busy ? <Loader2 className="size-4 animate-spin" /> : <ArrowUp className="size-4" />}
            </button>
          </div>
        </div>
        <p className="mt-1.5 px-1 text-[10px] text-muted-foreground/80">
          Enter to send · Shift + Enter for a new line · click a step on the graph to focus on it
        </p>
      </div>
    </div>
  );
}

function SuggestionChips({
  suggestions,
  onPick,
  compact = false,
}: {
  suggestions: RevisionSuggestion[];
  onPick: (prompt: string) => void;
  compact?: boolean;
}) {
  return (
    <div className={cn("flex flex-wrap gap-1.5", compact && "mb-2")}>
      {suggestions.map((s) => (
        <button
          key={s.prompt}
          type="button"
          onClick={() => onPick(s.prompt)}
          title={s.title ?? s.prompt}
          className={cn(
            "inline-flex max-w-full items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-left text-[11px] leading-snug transition",
            s.kind === "fix"
              ? s.severity === "error"
                ? "border-red/25 bg-red/5 text-foreground/90 hover:border-red/50"
                : "border-amber/25 bg-amber/5 text-foreground/90 hover:border-amber/50"
              : "border-border/60 text-muted-foreground hover:border-primary/40 hover:bg-surface-hover hover:text-foreground",
          )}
        >
          {s.kind === "fix" ? (
            <Wrench
              className={cn("size-3 shrink-0", s.severity === "error" ? "text-red" : "text-amber")}
            />
          ) : (
            <Lightbulb className="size-3 shrink-0 text-primary" />
          )}
          <span className={cn(compact && "line-clamp-1")}>{s.prompt}</span>
        </button>
      ))}
    </div>
  );
}

function EmptyConversation({
  suggestions,
  onPick,
}: {
  suggestions: RevisionSuggestion[];
  onPick: (prompt: string) => void;
}) {
  const fixes = suggestions.filter((s) => s.kind === "fix");
  return (
    <div className="flex h-full flex-col justify-center py-4">
      <div className="mx-auto mb-4 grid size-11 place-items-center rounded-2xl border border-border/60 glass">
        <MessageSquareText className="size-5 text-primary" />
      </div>
      <h3 className="text-center text-sm font-semibold text-foreground">Tell me what to change</h3>
      <p className="mx-auto mt-1.5 max-w-xs text-center text-xs leading-relaxed text-muted-foreground">
        Add, remove, reorder or rewrite steps in plain words. You’ll see exactly what changes on the
        graph before anything is saved.
      </p>
      {fixes.length ? (
        <div className="mt-5">
          <p className="mb-2 text-[10px] font-semibold tracking-wider text-muted-foreground uppercase">
            Fix what’s wrong
          </p>
          <SuggestionChips suggestions={fixes.slice(0, 4)} onPick={onPick} />
        </div>
      ) : null}
      <div className="mt-5">
        <p className="mb-2 text-[10px] font-semibold tracking-wider text-muted-foreground uppercase">
          Try
        </p>
        <SuggestionChips
          suggestions={STARTERS.map((prompt) => ({
            kind: "improve",
            severity: null,
            code: null,
            step_id: null,
            title: null,
            prompt,
          }))}
          onPick={onPick}
        />
      </div>
    </div>
  );
}
