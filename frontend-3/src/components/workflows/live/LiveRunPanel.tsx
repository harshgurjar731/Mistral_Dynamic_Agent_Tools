/**
 * A workflow run as it happens: overall progress, every step of the workflow
 * in order with its live state, where it failed and why, and when it is
 * paused for a person.
 */
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  Check,
  ChevronRight,
  CircleDashed,
  CircleSlash,
  Clock,
  Loader2,
  RefreshCw,
  Server,
  ShieldAlert,
  Square,
  Wifi,
  WifiOff,
} from "lucide-react";
import { errorMessage, executionsApi } from "@/api";
import type { HumanReview } from "@/api/knowledge";
import type { LiveState } from "@/api/sse";
import { Button } from "@/components/ui/button";
import { StatusPill } from "@/components/ui/StatusPill";
import { fixStepActions } from "@/components/workflows/FixStepButton";
import { BLOCK, blockForMode } from "@/lib/terminology";
import { executionStatusIdentity, formatDuration, parseServerTime } from "@/lib/status";
import { useCanCall } from "@/lib/policy";
import { cn } from "@/lib/utils";
import type { ExecutionDetail, WorkflowDefinition } from "@/types";
import { buildLiveRun, summariseError, type LiveStep, type StepState } from "./runModel";

function useNow(active: boolean, every = 500): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setNow(Date.now()), every);
    return () => clearInterval(t);
  }, [active, every]);
  return now;
}

const STATE: Record<
  StepState,
  { label: string; dot: string; text: string; icon: (p: { className?: string }) => ReactNode }
> = {
  pending: {
    label: "Waiting",
    dot: "border-border bg-background-elevated text-muted-foreground",
    text: "text-muted-foreground",
    icon: (p) => <CircleDashed {...p} />,
  },
  running: {
    label: "Running",
    dot: "border-blue/50 bg-blue/15 text-blue ring-4 ring-blue/10",
    text: "text-blue",
    icon: (p) => <Loader2 {...p} className={cn(p.className, "animate-spin")} />,
  },
  retrying: {
    label: "Retrying",
    dot: "border-amber/50 bg-amber/15 text-amber ring-4 ring-amber/10",
    text: "text-amber",
    icon: (p) => <RefreshCw {...p} className={cn(p.className, "animate-spin")} />,
  },
  review: {
    label: "Waiting for review",
    dot: "border-amber/50 bg-amber/15 text-amber ring-4 ring-amber/15",
    text: "text-amber",
    icon: (p) => <ShieldAlert {...p} />,
  },
  done: {
    label: "Done",
    dot: "border-emerald/40 bg-emerald/15 text-emerald",
    text: "text-emerald",
    icon: (p) => <Check {...p} />,
  },
  failed: {
    label: "Failed",
    dot: "border-red/50 bg-red/15 text-red ring-4 ring-red/10",
    text: "text-red",
    icon: (p) => <AlertTriangle {...p} />,
  },
  skipped: {
    label: "Not taken",
    dot: "border-border bg-background-elevated text-muted-foreground/60",
    text: "text-muted-foreground/70",
    icon: (p) => <CircleSlash {...p} />,
  },
  not_reached: {
    label: "Not reached",
    dot: "border-border bg-background-elevated text-muted-foreground/60",
    text: "text-muted-foreground/70",
    icon: (p) => <CircleSlash {...p} />,
  },
};

const TYPE_LABEL: Record<string, string> = {
  human_review: "Human review",
  condition: "Condition",
  transform: "Transform",
};

function TypeChip({ type }: { type: string | null }) {
  if (!type) return null;
  const block = blockForMode(type);
  return (
    <span
      className={cn(
        "shrink-0 rounded border px-1.5 py-0.5 text-[9px] font-medium",
        block
          ? BLOCK[block].chip
          : type === "human_review"
            ? "border-amber/25 bg-amber/10 text-amber"
            : "border-border text-muted-foreground",
      )}
    >
      {block ? BLOCK[block].label : (TYPE_LABEL[type] ?? type)}
    </span>
  );
}

function Preview({ label, value, tone }: { label: string; value: string; tone: "in" | "out" }) {
  return (
    <div
      className={cn(
        "min-w-0 rounded-lg border bg-background-elevated/60 p-2.5",
        tone === "in" ? "border-blue/20" : "border-emerald/20",
      )}
    >
      <p
        className={cn(
          "mb-1 flex items-center gap-1 text-[9px] font-bold tracking-wider uppercase",
          tone === "in" ? "text-blue" : "text-emerald",
        )}
      >
        {tone === "in" ? (
          <ArrowDownRight className="size-3" />
        ) : (
          <ArrowUpRight className="size-3" />
        )}
        {label}
      </p>
      <pre className="custom-scrollbar max-h-48 overflow-auto font-mono text-[11px] leading-relaxed break-words whitespace-pre-wrap text-foreground/90">
        {value}
      </pre>
    </div>
  );
}

function ErrorBox({ error }: { error: string | null }) {
  const [full, setFull] = useState(false);
  const { headline, details } = summariseError(error);
  return (
    <div className="rounded-lg border border-red/30 bg-red/5 p-3">
      <p className="text-xs leading-relaxed font-medium break-words text-red">{headline}</p>
      {details && details !== headline ? (
        <>
          <button
            type="button"
            onClick={() => setFull((f) => !f)}
            className="mt-1.5 text-[10px] text-red/80 underline-offset-2 hover:underline"
          >
            {full ? "Hide full error" : "Show full error"}
          </button>
          {full ? (
            <pre className="custom-scrollbar mt-1.5 max-h-64 overflow-auto font-mono text-[10.5px] leading-relaxed whitespace-pre-wrap text-red/90">
              {details}
            </pre>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

function StepRow({
  step,
  index,
  last,
  now,
  actions,
  onOpenReview,
}: {
  step: LiveStep;
  index: number;
  last: boolean;
  now: number;
  actions: ReactNode;
  onOpenReview: (r: HumanReview) => void;
}) {
  const meta = STATE[step.state];
  const auto = step.state === "failed" || step.state === "review";
  const [open, setOpen] = useState(auto);
  useEffect(() => {
    if (auto) setOpen(true);
  }, [auto]);

  const report = step.latest;
  const elapsed =
    report?.duration_ms ??
    (report?.start_time_ms &&
    (step.state === "running" || step.state === "retrying" || step.state === "review")
      ? Math.max(0, now - report.start_time_ms)
      : null);
  const expandable = Boolean(
    report?.input_preview ||
    report?.output_preview ||
    step.error ||
    step.review ||
    step.description,
  );

  return (
    <li id={`live-step-${step.id}`} className="relative scroll-mt-24 pl-10">
      {!last ? (
        <span
          aria-hidden
          className={cn(
            "absolute top-8 bottom-0 left-[15px] w-px",
            step.state === "done" || step.state === "skipped" ? "bg-emerald/30" : "bg-border",
          )}
        />
      ) : null}
      <span
        className={cn(
          "absolute top-1.5 left-0 grid size-[31px] place-items-center rounded-full border transition",
          meta.dot,
        )}
      >
        {meta.icon({ className: "size-3.5" })}
      </span>

      <div
        className={cn(
          "mb-2 rounded-xl border px-3 py-2.5 transition",
          step.state === "running" || step.state === "retrying"
            ? "border-blue/30 bg-blue/5"
            : step.state === "failed"
              ? "border-red/30 bg-red/5"
              : step.state === "review"
                ? "border-amber/35 bg-amber/5"
                : "border-transparent hover:border-border hover:bg-surface/40",
        )}
      >
        <button
          type="button"
          disabled={!expandable}
          onClick={() => setOpen((o) => !o)}
          className="flex w-full min-w-0 items-center gap-2 text-left"
        >
          <span className="w-5 shrink-0 text-[10px] text-muted-foreground tabular-nums">
            {index + 1}
          </span>
          <span
            className={cn(
              "min-w-0 truncate font-mono text-xs",
              step.state === "pending" || step.state === "skipped" || step.state === "not_reached"
                ? "text-muted-foreground"
                : "text-foreground",
            )}
          >
            {step.id}
          </span>
          <TypeChip type={step.type} />
          {step.attempts.length > 1 ? (
            <span className="shrink-0 rounded-full border border-amber/30 bg-amber/10 px-1.5 text-[9px] text-amber">
              {step.attempts.length} attempts
            </span>
          ) : null}
          <span className={cn("ml-auto shrink-0 text-[10px] font-medium", meta.text)}>
            {meta.label}
          </span>
          {elapsed != null ? (
            <span className="w-14 shrink-0 text-right font-mono text-[10px] text-muted-foreground tabular-nums">
              {formatDuration(elapsed)}
            </span>
          ) : (
            <span className="w-14 shrink-0" />
          )}
          {expandable ? (
            <ChevronRight
              className={cn(
                "size-3.5 shrink-0 text-muted-foreground transition-transform",
                open && "rotate-90",
              )}
            />
          ) : (
            <span className="size-3.5 shrink-0" />
          )}
        </button>

        {open && expandable ? (
          <div className="mt-2.5 space-y-2.5 pl-7">
            {step.description ? (
              <p className="text-[11px] leading-relaxed text-muted-foreground">
                {step.description}
              </p>
            ) : null}
            {step.review ? (
              <div className="flex flex-wrap items-center gap-2 rounded-lg border border-amber/30 bg-amber/10 px-3 py-2">
                <p className="min-w-0 flex-1 text-[11px] text-foreground">
                  The run is paused here until a person decides
                  {step.review.reviewer_role ? ` (${step.review.reviewer_role})` : ""}.
                </p>
                <Button
                  size="sm"
                  className="h-7 text-[11px]"
                  onClick={() => onOpenReview(step.review!)}
                >
                  <ShieldAlert className="size-3" /> Open review
                </Button>
              </div>
            ) : null}
            {step.error ? <ErrorBox error={step.error} /> : null}
            {report?.input_preview || report?.output_preview ? (
              <div className="grid gap-2 lg:grid-cols-2">
                {report?.input_preview ? (
                  <Preview label="Input" value={report.input_preview} tone="in" />
                ) : null}
                {report?.output_preview ? (
                  <Preview label="Output" value={report.output_preview} tone="out" />
                ) : null}
              </div>
            ) : null}
            {actions}
          </div>
        ) : null}
      </div>
    </li>
  );
}

const PHASE: Record<LiveState, { label: string; tone: string; live: boolean }> = {
  idle: { label: "Idle", tone: "text-muted-foreground", live: false },
  connecting: { label: "Connecting", tone: "text-muted-foreground", live: false },
  live: { label: "Live", tone: "text-emerald", live: true },
  reconnecting: { label: "Reconnecting", tone: "text-amber", live: false },
  disconnected: { label: "Disconnected", tone: "text-red", live: false },
  closed: { label: "Finished", tone: "text-muted-foreground", live: false },
  error: { label: "Connection error", tone: "text-red", live: false },
};

export function LiveRunPanel({
  executionId,
  detail,
  phase,
  streamError,
  definition,
  reviews,
  onOpenReview,
  onReconnect,
}: {
  executionId: string;
  detail: ExecutionDetail | null;
  phase: LiveState;
  streamError: string | null;
  definition: WorkflowDefinition | null | undefined;
  reviews: HumanReview[];
  onOpenReview: (r: HumanReview) => void;
  onReconnect: () => void;
}) {
  const run = useMemo(
    () => buildLiveRun(detail, definition, reviews),
    [detail, definition, reviews],
  );
  const now = useNow(!run.terminal);
  const canStop = useCanCall("POST", "/api/workflows/executions/x/cancel");
  const actionsFor = useMemo(
    () => fixStepActions(definition, { executionId }),
    [definition, executionId],
  );

  const stop = useMutation({
    mutationFn: () => executionsApi.cancel(executionId),
    onSuccess: () => toast.success("Stop requested — the run will end after its current step."),
    onError: (e) => toast.error(errorMessage(e)),
  });

  const started = detail?.start_time ? parseServerTime(detail.start_time) : null;
  const elapsed = run.terminal
    ? (detail?.total_duration_ms ??
      (detail?.end_time && started ? parseServerTime(detail.end_time) - started : null))
    : started && !Number.isNaN(started)
      ? Math.max(0, now - started)
      : null;
  const currentElapsed =
    run.current?.latest?.start_time_ms && !run.terminal
      ? Math.max(0, now - run.current.latest.start_time_ms)
      : null;

  const phaseMeta = PHASE[phase] ?? PHASE.idle;
  const completed = run.status === "COMPLETED";
  const barTone = run.failed
    ? "bg-red"
    : completed
      ? "bg-emerald"
      : run.reviewStep
        ? "bg-amber"
        : "bg-gradient-brand";

  const scrollTo = (id: string) =>
    document
      .getElementById(`live-step-${id}`)
      ?.scrollIntoView({ behavior: "smooth", block: "center" });

  return (
    <div className="glass overflow-hidden rounded-2xl border border-border/70">
      {/* Status strip */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-border px-5 py-3.5">
        <h2 className="text-sm font-semibold text-foreground">Run progress</h2>
        <StatusPill identity={executionStatusIdentity(detail?.status ?? "RUNNING")} size="xs" />
        <span className="font-mono text-[11px] text-muted-foreground">
          {executionId.slice(0, 8)}
        </span>
        {detail?.source ? (
          <span className="flex items-center gap-1 text-[11px] text-muted-foreground capitalize">
            <Server className="size-3" />{" "}
            {detail.source === "mistral" ? "Mistral Workflows" : "Local engine"}
          </span>
        ) : null}
        <span className="flex items-center gap-1 text-[11px] text-muted-foreground tabular-nums">
          <Clock className="size-3" /> {elapsed != null ? formatDuration(elapsed) : "—"}
        </span>
        <span className="ml-auto flex items-center gap-2">
          <span className={cn("flex items-center gap-1 text-[11px]", phaseMeta.tone)}>
            {phase === "disconnected" ? (
              <WifiOff className="size-3" />
            ) : phaseMeta.live ? (
              <span className="relative flex size-2">
                <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald opacity-60" />
                <span className="relative inline-flex size-2 rounded-full bg-emerald" />
              </span>
            ) : (
              <Wifi className="size-3" />
            )}
            {phaseMeta.label}
          </span>
          {(phase === "disconnected" || phase === "error") && !run.terminal ? (
            <Button size="sm" variant="outline" className="h-7 text-[11px]" onClick={onReconnect}>
              <RefreshCw className="size-3" /> Reconnect
            </Button>
          ) : null}
          {!run.terminal && canStop ? (
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-[11px] hover:border-red/40 hover:text-red"
              disabled={stop.isPending}
              onClick={() => {
                if (window.confirm("Stop this run? Steps already done are kept.")) stop.mutate();
              }}
            >
              {stop.isPending ? (
                <Loader2 className="size-3 animate-spin" />
              ) : (
                <Square className="size-3" />
              )}
              Stop
            </Button>
          ) : null}
        </span>
      </div>

      {/* Progress */}
      <div className="space-y-2 px-5 pt-4 pb-3">
        <div className="flex items-baseline gap-2">
          <span className="font-display text-2xl font-semibold text-foreground tabular-nums">
            {run.percent}%
          </span>
          <span className="text-xs text-muted-foreground">
            {run.total ? `${run.finished} of ${run.total} steps` : "Waiting for the first step…"}
          </span>
          {run.current && !run.terminal ? (
            <button
              type="button"
              onClick={() => scrollTo(run.current!.id)}
              className="ml-auto flex min-w-0 items-center gap-1.5 text-xs text-foreground hover:underline"
            >
              {run.current.state === "review" ? (
                <ShieldAlert className="size-3.5 shrink-0 text-amber" />
              ) : (
                <Loader2 className="size-3.5 shrink-0 animate-spin text-blue" />
              )}
              <span className="truncate">
                {run.current.state === "review" ? "Waiting for review at " : "Now running "}
                <span className="font-mono">{run.current.id}</span>
              </span>
              {currentElapsed != null ? (
                <span className="shrink-0 font-mono text-[10px] text-muted-foreground tabular-nums">
                  {formatDuration(currentElapsed)}
                </span>
              ) : null}
            </button>
          ) : null}
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-border/60">
          <div
            className={cn(
              "h-full rounded-full transition-[width] duration-500 ease-out",
              barTone,
              !run.terminal && !run.reviewStep && "animate-pulse",
            )}
            style={{ width: `${Math.max(run.percent, run.terminal ? 100 : 3)}%` }}
          />
        </div>
        {run.total ? (
          <div className="flex gap-0.5" aria-hidden>
            {run.steps.map((s) => (
              <button
                key={s.id}
                type="button"
                title={`${s.id} — ${STATE[s.state].label}`}
                onClick={() => scrollTo(s.id)}
                className={cn(
                  "h-1 flex-1 rounded-full transition",
                  s.state === "done"
                    ? "bg-emerald/70"
                    : s.state === "failed"
                      ? "bg-red"
                      : s.state === "review"
                        ? "bg-amber"
                        : s.state === "running" || s.state === "retrying"
                          ? "animate-pulse bg-blue"
                          : "bg-border",
                )}
              />
            ))}
          </div>
        ) : null}
      </div>

      {/* What needs attention */}
      <div className="space-y-3 px-5">
        {streamError && !detail ? (
          <div className="rounded-xl border border-red/30 bg-red/5 p-3 text-xs text-red">
            {streamError}
          </div>
        ) : null}

        {run.reviewStep?.review ? (
          <div className="flex flex-wrap items-center gap-3 rounded-xl border border-amber/40 bg-amber/10 p-3.5">
            <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-amber/20 text-amber">
              <ShieldAlert className="size-4.5" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-foreground">
                {run.reviewStep.review.title || "A person needs to review this run"}
              </p>
              <p className="mt-0.5 text-[11px] text-muted-foreground">
                Paused at <span className="font-mono text-foreground">{run.reviewStep.id}</span>.
                The run continues once it is approved or corrected, and stops if it is rejected.
              </p>
            </div>
            <Button size="sm" onClick={() => onOpenReview(run.reviewStep!.review!)}>
              Review now
            </Button>
          </div>
        ) : null}

        {run.failed ? (
          <div className="rounded-xl border border-red/35 bg-red/5 p-3.5">
            <div className="flex items-start gap-3">
              <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-red/15 text-red">
                <AlertTriangle className="size-4.5" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-red">
                  {run.status === "TIMED_OUT"
                    ? "The run timed out"
                    : run.status === "CANCELED" || run.status === "CANCELLED"
                      ? "The run was cancelled"
                      : run.status === "TERMINATED"
                        ? "The run was terminated"
                        : "The run failed"}
                  {run.failedStep ? (
                    <>
                      {" "}
                      at step{" "}
                      <button
                        type="button"
                        onClick={() => scrollTo(run.failedStep!.id)}
                        className="font-mono underline-offset-2 hover:underline"
                      >
                        {run.failedStep.id}
                      </button>
                    </>
                  ) : null}
                </p>
                <p className="mt-0.5 text-[11px] text-muted-foreground">
                  {run.failedStep
                    ? `Step ${run.steps.indexOf(run.failedStep) + 1} of ${run.total}. ${run.finished} step${run.finished === 1 ? "" : "s"} finished before it.`
                    : "No step reported the failure."}
                </p>
                <div className="mt-2.5">
                  <ErrorBox error={run.failure} />
                </div>
              </div>
            </div>
          </div>
        ) : null}

        {completed ? (
          <div className="flex items-center gap-2.5 rounded-xl border border-emerald/30 bg-emerald/5 px-3.5 py-2.5 text-xs text-foreground">
            <Check className="size-4 text-emerald" />
            Completed {run.total ? `all ${run.finished} steps` : ""}
            {elapsed != null ? ` in ${formatDuration(elapsed)}` : ""} — the result is below.
          </div>
        ) : null}
      </div>

      {/* Steps */}
      <div className="px-5 pt-4 pb-3">
        <p className="technical-label mb-2.5 text-muted-foreground">Steps</p>
        {run.steps.length === 0 ? (
          <div className="flex items-center gap-2 py-6 text-xs text-muted-foreground">
            <Loader2 className="size-3.5 animate-spin" /> Starting the run…
          </div>
        ) : (
          <ol>
            {run.steps.map((s, i) => (
              <StepRow
                key={s.id}
                step={s}
                index={i}
                last={i === run.steps.length - 1}
                now={now}
                onOpenReview={onOpenReview}
                actions={
                  s.state === "failed" && s.latest && actionsFor
                    ? actionsFor({
                        ...s.latest,
                        status: "FAILED",
                        error: s.error ?? s.latest.error ?? "failed",
                      })
                    : null
                }
              />
            ))}
          </ol>
        )}
      </div>
    </div>
  );
}
