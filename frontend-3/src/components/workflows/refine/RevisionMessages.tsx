/**
 * The turns of a refine conversation: what the user asked, and what came of it.
 *
 * Every proposal is shown as a reviewable change — what it does in a sentence,
 * the counts, whether it fixes or introduces problems, the full list of
 * changes — with apply and discard right there. Nothing is applied without the
 * user pressing Apply.
 */
import { useState, type ReactNode } from "react";
import {
  AlertTriangle,
  ArrowRight,
  Check,
  ChevronDown,
  CircleSlash,
  Crosshair,
  Eye,
  EyeOff,
  GitCommitHorizontal,
  HelpCircle,
  Loader2,
  Minus,
  PencilLine,
  Plus,
  RotateCcw,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Workflow,
  X,
} from "lucide-react";
import type { RevisionDiff, RevisionValidation, WorkflowRevision } from "@/types";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Markdown } from "@/components/chat/Markdown";
import { formatRelative } from "@/lib/status";
import { cn } from "@/lib/utils";
import { LivePercent } from "@/components/activity/LiveProgress";

/* ── Shared bits ─────────────────────────────────────────────────────── */

/** Model-written prose (summaries, questions, errors) — it often carries Markdown. */
function Prose({ text, className }: { text: string; className?: string }) {
  return (
    <Markdown
      content={text}
      className={cn(
        "text-[13px] [&_li]:my-0.5 [&_p]:my-1.5 [&_ol]:my-1.5 [&_ul]:my-1.5",
        className,
      )}
    />
  );
}

function AssistantAvatar() {
  return (
    <span className="grid size-7 shrink-0 place-items-center rounded-xl bg-gradient-brand text-primary-foreground shadow-md">
      <Sparkles className="size-3.5" />
    </span>
  );
}

function AssistantShell({
  children,
  className,
  at,
}: {
  children: ReactNode;
  className?: string;
  at?: string | null | undefined;
}) {
  return (
    <div className="flex items-start gap-2.5">
      <AssistantAvatar />
      <div className="min-w-0 flex-1">
        <p className="mb-1 flex items-center gap-1.5 text-[11px] leading-7">
          <span className="font-medium text-foreground/90">Workflow assistant</span>
          {at ? <span className="text-muted-foreground/70">· {formatRelative(at)}</span> : null}
        </p>
        <div
          className={cn(
            "overflow-hidden rounded-2xl rounded-tl-md border border-border/60 bg-surface/60 shadow-sm backdrop-blur-sm",
            className,
          )}
        >
          {children}
        </div>
      </div>
    </div>
  );
}

function FocusChips({ ids }: { ids: string[] }) {
  if (!ids.length) return null;
  return (
    <div className="mt-1.5 flex flex-wrap justify-end gap-1">
      {ids.map((id) => (
        <span
          key={id}
          className="inline-flex max-w-full items-center gap-1 rounded-full border border-primary/25 bg-primary/5 px-1.5 py-px font-mono text-[9px] break-all text-primary"
        >
          <Crosshair className="size-2.5 shrink-0" /> {id}
        </span>
      ))}
    </div>
  );
}

export function UserTurn({
  instruction,
  focus,
  at,
}: {
  instruction: string;
  focus: string[];
  at?: string | null | undefined;
}) {
  return (
    <div className="flex flex-col items-end pl-8">
      <p className="mb-1 text-[11px] text-muted-foreground/80">
        <span className="font-medium text-foreground/90">You</span>
        {at ? <span> · {formatRelative(at)}</span> : null}
      </p>
      <div className="max-w-full rounded-2xl rounded-tr-md border border-primary/25 bg-primary/10 px-3.5 py-2.5 text-[13px] leading-relaxed break-words whitespace-pre-wrap text-foreground shadow-sm">
        {instruction}
      </div>
      <FocusChips ids={focus} />
    </div>
  );
}

/* ── Diff ────────────────────────────────────────────────────────────── */

function StatChip({
  n,
  label,
  tone,
  icon: Icon,
}: {
  n: number;
  label: string;
  tone: string;
  icon: typeof Plus;
}) {
  if (!n) return null;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium",
        tone,
      )}
    >
      <Icon className="size-2.5" />
      {n} {label}
    </span>
  );
}

export function DiffStats({ diff }: { diff: RevisionDiff }) {
  const s = diff.stats;
  return (
    <div className="flex flex-wrap gap-1.5">
      <StatChip
        n={s.added}
        label="added"
        icon={Plus}
        tone="border-emerald/30 bg-emerald/10 text-emerald"
      />
      <StatChip
        n={s.removed}
        label="removed"
        icon={Minus}
        tone="border-red/30 bg-red/10 text-red"
      />
      <StatChip
        n={s.modified}
        label="changed"
        icon={PencilLine}
        tone="border-amber/30 bg-amber/10 text-amber"
      />
      <StatChip
        n={s.edges}
        label="link changes"
        icon={GitCommitHorizontal}
        tone="border-border bg-background-elevated/60 text-muted-foreground"
      />
      <StatChip
        n={s.inputs}
        label="input changes"
        icon={ArrowRight}
        tone="border-cyan/30 bg-cyan/10 text-cyan"
      />
    </div>
  );
}

function show(value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "string") return value;
  return JSON.stringify(value, null, 2);
}

/** One side of a field change — wraps, and scrolls once it is long. */
function FieldValue({ value, tone }: { value: unknown; tone: "before" | "after" }) {
  return (
    <pre
      className={cn(
        "custom-scrollbar max-h-32 overflow-auto rounded-md border px-2 py-1 font-mono text-[10px] leading-relaxed break-words whitespace-pre-wrap",
        tone === "before"
          ? "border-red/15 bg-red/5 text-red/90 line-through decoration-red/40"
          : "border-emerald/15 bg-emerald/5 text-emerald/90",
      )}
    >
      {show(value)}
    </pre>
  );
}

function DiffRow({
  icon: Icon,
  tone,
  children,
}: {
  icon: typeof Plus;
  tone: string;
  children: ReactNode;
}) {
  return (
    <li className="flex items-start gap-2 text-[11px] leading-relaxed">
      <Icon className={cn("mt-0.5 size-3 shrink-0", tone)} />
      <div className="min-w-0 flex-1 break-words [&_code]:break-all">{children}</div>
    </li>
  );
}

export function DiffList({ diff }: { diff: RevisionDiff }) {
  return (
    <ul className="space-y-1.5">
      {diff.steps_added.map((id) => (
        <DiffRow key={`a-${id}`} icon={Plus} tone="text-emerald">
          New step <code className="font-mono text-foreground">{id}</code>
        </DiffRow>
      ))}
      {diff.steps_removed.map((id) => (
        <DiffRow key={`r-${id}`} icon={Minus} tone="text-red">
          Removes step{" "}
          <code className="font-mono text-foreground line-through decoration-red/60">{id}</code>
        </DiffRow>
      ))}
      {diff.steps_modified.map((m) => (
        <DiffRow key={`m-${m.step_id}`} icon={PencilLine} tone="text-amber">
          Changes <code className="font-mono text-foreground">{m.step_id}</code>
          <ul className="mt-1.5 space-y-2 border-l border-border/60 pl-2.5">
            {m.changes.map((c) => (
              <li key={c.field} className="text-[10px] text-muted-foreground">
                <span className="font-mono text-foreground/80">{c.field}</span>
                <div className="mt-1 grid gap-1">
                  <FieldValue value={c.before} tone="before" />
                  <FieldValue value={c.after} tone="after" />
                </div>
              </li>
            ))}
          </ul>
        </DiffRow>
      ))}
      {diff.entry_step ? (
        <DiffRow icon={ArrowRight} tone="text-primary">
          Starts at <code className="font-mono text-foreground">{diff.entry_step.after}</code>{" "}
          instead of <code className="font-mono">{diff.entry_step.before}</code>
        </DiffRow>
      ) : null}
      {diff.edges_added.map(([s, t]) => (
        <DiffRow key={`ea-${s}-${t}`} icon={GitCommitHorizontal} tone="text-emerald">
          <span className="font-mono text-foreground">{s}</span> →{" "}
          <span className="font-mono text-foreground">{t}</span>
        </DiffRow>
      ))}
      {diff.edges_removed.map(([s, t]) => (
        <DiffRow key={`er-${s}-${t}`} icon={GitCommitHorizontal} tone="text-red">
          <span className="font-mono line-through decoration-red/50">
            {s} → {t}
          </span>
        </DiffRow>
      ))}
      {diff.inputs.added.map((n) => (
        <DiffRow key={`ia-${n}`} icon={Plus} tone="text-cyan">
          New input <code className="font-mono text-foreground">{n}</code>
        </DiffRow>
      ))}
      {diff.inputs.removed.map((n) => (
        <DiffRow key={`ir-${n}`} icon={Minus} tone="text-cyan">
          Removes input <code className="font-mono text-foreground">{n}</code>
        </DiffRow>
      ))}
      {diff.inputs.modified.map((n) => (
        <DiffRow key={`im-${n}`} icon={PencilLine} tone="text-cyan">
          Changes input <code className="font-mono text-foreground">{n}</code>
        </DiffRow>
      ))}
      {diff.description ? (
        <DiffRow icon={PencilLine} tone="text-amber">
          Updates the workflow description
        </DiffRow>
      ) : null}
    </ul>
  );
}

function ValidationDelta({ validation }: { validation: RevisionValidation | null }) {
  if (!validation) return null;
  const introducedErrors = validation.introduced.filter((i) => i.severity === "error");
  const resolvedErrors = validation.resolved.filter((i) => i.severity === "error");
  return (
    <div className="flex flex-wrap items-center gap-1.5 text-[10px]">
      {validation.valid ? (
        <span className="inline-flex items-center gap-1 rounded-full border border-emerald/30 bg-emerald/10 px-2 py-0.5 font-medium text-emerald">
          <ShieldCheck className="size-3" /> Runs cleanly
        </span>
      ) : (
        <span className="inline-flex items-center gap-1 rounded-full border border-red/30 bg-red/10 px-2 py-0.5 font-medium text-red">
          <ShieldAlert className="size-3" /> {validation.error_count} error
          {validation.error_count === 1 ? "" : "s"} after this change
        </span>
      )}
      {resolvedErrors.length ? (
        <span className="text-emerald">
          fixes {resolvedErrors.length} problem{resolvedErrors.length === 1 ? "" : "s"}
        </span>
      ) : null}
      {introducedErrors.length ? (
        <span className="text-red">
          · introduces {introducedErrors.length} problem{introducedErrors.length === 1 ? "" : "s"}
        </span>
      ) : null}
    </div>
  );
}

function Disclosure({
  label,
  defaultOpen = false,
  children,
}: {
  label: string;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger className="flex w-full items-center gap-1 text-[10px] font-semibold tracking-wider text-muted-foreground uppercase transition hover:text-foreground">
        <ChevronDown className={cn("size-3 transition-transform", !open && "-rotate-90")} />
        {label}
      </CollapsibleTrigger>
      <CollapsibleContent className="pt-2">{children}</CollapsibleContent>
    </Collapsible>
  );
}

/* ── Assistant turns ─────────────────────────────────────────────────── */

export interface ProposalActions {
  previewing: boolean;
  onTogglePreview: () => void;
  onApply: (allowErrors: boolean) => void;
  onDiscard: () => void;
  onRetry: () => void;
  applying: boolean;
  discarding: boolean;
  /** The newest proposal opens its change list; older ones stay folded. */
  latest: boolean;
}

export function AssistantTurn({
  revision,
  actions,
}: {
  revision: WorkflowRevision;
  actions: ProposalActions;
}) {
  switch (revision.status) {
    case "needs_clarification":
      return (
        <AssistantShell className="border-primary/25" at={revision.created_at}>
          <div className="px-4 py-3">
            <p className="flex items-center gap-1.5 text-[10px] font-semibold tracking-wider text-primary uppercase">
              <HelpCircle className="size-3" /> Quick question
            </p>
            <Prose text={revision.clarification ?? ""} className="mt-1.5 text-foreground" />
            {actions.latest ? (
              <p className="mt-2 text-[10px] text-muted-foreground">Reply below to continue.</p>
            ) : null}
          </div>
        </AssistantShell>
      );
    case "failed":
      return (
        <AssistantShell className="border-red/25" at={revision.created_at}>
          <div className="px-4 py-3">
            <p className="flex items-center gap-1.5 text-[10px] font-semibold tracking-wider text-red uppercase">
              <AlertTriangle className="size-3" /> Couldn’t make that change
            </p>
            <Prose
              text={revision.error ?? "Something went wrong preparing the change."}
              className="mt-1.5 text-xs"
            />
            {revision.notes.length ? <Notes notes={revision.notes} /> : null}
            {actions.latest ? (
              <Button
                variant="outline"
                size="sm"
                className="mt-2.5 h-7 text-xs"
                onClick={actions.onRetry}
              >
                <RotateCcw className="size-3" /> Try again
              </Button>
            ) : null}
          </div>
        </AssistantShell>
      );
    default:
      return <ProposalCard revision={revision} actions={actions} />;
  }
}

function Notes({ notes }: { notes: string[] }) {
  return (
    <ul className="mt-2 space-y-1 rounded-lg border border-amber/20 bg-amber/5 px-2.5 py-2">
      {notes.map((n) => (
        <li key={n} className="flex gap-1.5 text-[10px] leading-relaxed text-amber">
          <AlertTriangle className="mt-0.5 size-2.5 shrink-0" />
          {n}
        </li>
      ))}
    </ul>
  );
}

const CLOSED_STATE: Record<string, { label: string; icon: typeof Check; tone: string }> = {
  applied: { label: "Applied", icon: Check, tone: "border-emerald/30 bg-emerald/10 text-emerald" },
  discarded: {
    label: "Discarded",
    icon: X,
    tone: "border-border bg-background-elevated/60 text-muted-foreground",
  },
  superseded: {
    label: "Out of date",
    icon: CircleSlash,
    tone: "border-border bg-background-elevated/60 text-muted-foreground",
  },
};

function ProposalCard({
  revision,
  actions,
}: {
  revision: WorkflowRevision;
  actions: ProposalActions;
}) {
  const [confirmErrors, setConfirmErrors] = useState(false);
  const open = revision.status === "proposed";
  const closed = CLOSED_STATE[revision.status];
  const diff = revision.diff;
  const errors =
    revision.validation && !revision.validation.valid ? revision.validation.error_count : 0;

  const apply = () => {
    if (errors && !confirmErrors) {
      setConfirmErrors(true);
      return;
    }
    setConfirmErrors(false);
    actions.onApply(errors > 0);
  };

  return (
    <AssistantShell
      at={revision.created_at}
      className={cn(
        open && actions.previewing && "border-primary/40 ring-1 ring-primary/20",
        !open && "opacity-80",
      )}
    >
      <div className="space-y-3 px-4 py-3">
        <div className="flex items-start justify-between gap-2">
          <Prose
            text={revision.summary || "Here is the change."}
            className="min-w-0 flex-1 text-foreground"
          />
          {closed ? (
            <span
              className={cn(
                "inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium",
                closed.tone,
              )}
              title={
                revision.status === "superseded"
                  ? "The workflow changed after this was proposed, so it can no longer be applied."
                  : undefined
              }
            >
              <closed.icon className="size-2.5" />
              {closed.label}
              {revision.status === "applied" && revision.applied_version
                ? ` · v${revision.applied_version}`
                : ""}
            </span>
          ) : null}
        </div>

        {diff ? <DiffStats diff={diff} /> : null}
        {open ? <ValidationDelta validation={revision.validation} /> : null}
        {open && revision.notes.length ? <Notes notes={revision.notes} /> : null}

        {diff ? (
          <div className="rounded-xl border border-border/50 bg-background-elevated/40 px-3 py-2.5">
            <Disclosure label="What changes" defaultOpen={open && actions.latest}>
              <DiffList diff={diff} />
            </Disclosure>
          </div>
        ) : null}

        {revision.trace.length ? (
          <Disclosure label="How this was worked out">
            <ol className="space-y-1">
              {revision.trace
                .filter((t) => t.state !== "skipped")
                .map((t) => (
                  <li key={t.name} className="flex gap-2 text-[10px] leading-relaxed">
                    <Workflow className="mt-0.5 size-2.5 shrink-0 text-primary/70" />
                    <span>
                      <span className="font-medium text-foreground/90">{t.label}</span>
                      {t.summary ? (
                        <span className="text-muted-foreground"> — {t.summary}</span>
                      ) : null}
                    </span>
                  </li>
                ))}
            </ol>
          </Disclosure>
        ) : null}
      </div>

      {open ? (
        <div className="flex flex-wrap items-center gap-2 border-t border-border/50 bg-background-elevated/30 px-4 py-2.5">
          <Button
            size="sm"
            onClick={apply}
            disabled={actions.applying}
            className={cn(
              "h-8 rounded-lg text-xs",
              confirmErrors
                ? "bg-destructive text-destructive-foreground hover:bg-destructive/90"
                : "bg-gradient-brand text-primary-foreground hover:opacity-90",
            )}
          >
            {actions.applying ? (
              <>
                <Loader2 className="size-3.5 animate-spin" />
                <LivePercent />
              </>
            ) : (
              <Check className="size-3.5" />
            )}
            {confirmErrors
              ? `Apply with ${errors} error${errors === 1 ? "" : "s"}?`
              : "Apply change"}
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={actions.onTogglePreview}
            className="h-8 rounded-lg text-xs"
            aria-pressed={actions.previewing}
          >
            {actions.previewing ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
            {actions.previewing ? "Hide preview" : "Preview"}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setConfirmErrors(false);
              actions.onDiscard();
            }}
            disabled={actions.discarding}
            className="ml-auto h-8 rounded-lg text-xs text-muted-foreground"
          >
            <X className="size-3.5" /> Discard
          </Button>
          {confirmErrors ? (
            <p className="w-full text-[10px] leading-relaxed text-muted-foreground">
              The workflow will be saved with errors and cannot be published until they are fixed —
              you can keep refining it.{" "}
              <button
                type="button"
                className="underline hover:text-foreground"
                onClick={() => setConfirmErrors(false)}
              >
                Cancel
              </button>
            </p>
          ) : null}
        </div>
      ) : null}
    </AssistantShell>
  );
}

export function PendingTurn() {
  return (
    <AssistantShell>
      <div className="space-y-2 px-4 py-3">
        <p className="flex items-center gap-2 text-xs text-foreground">
          <Loader2 className="size-3.5 animate-spin text-primary" />
          Working out what to change… <LivePercent />
        </p>
        <div className="shimmer h-2 w-2/3 rounded-full bg-surface-hover/60" />
        <div className="shimmer h-2 w-1/2 rounded-full bg-surface-hover/60" />
        <p className="text-[10px] text-muted-foreground">
          Nothing is changed until you apply it. This usually takes a few seconds.
        </p>
      </div>
    </AssistantShell>
  );
}
