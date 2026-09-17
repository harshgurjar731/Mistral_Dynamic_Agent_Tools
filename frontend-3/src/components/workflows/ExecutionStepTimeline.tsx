import { useEffect, useMemo, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  Check,
  ChevronRight,
  GitMerge,
  Layers,
  Loader2,
  Minus,
  Tag,
} from "lucide-react";
import type { ExecutionStep } from "@/types";
import { executionStatusIdentity, formatDuration } from "@/lib/status";
import { cn } from "@/lib/utils";

/**
 * Live per-step timeline for a workflow execution.
 *
 * A step still RUNNING has no `duration_ms`, so its elapsed time is derived from
 * `start_time_ms` against one ticking clock shared by every row, keeping the
 * rows in step with each other. Steps sharing a `parallel_group` ran
 * concurrently and are drawn as one block — a flat list would imply an ordering
 * the runtime never had.
 */

type RowState = "running" | "done" | "failed" | "other";

function rowState(status: string): RowState {
  const s = status.toUpperCase();
  if (s === "RUNNING" || s === "RETRYING_AFTER_ERROR") return "running";
  if (s === "COMPLETED") return "done";
  if (s === "FAILED" || s === "TIMED_OUT" || s === "TERMINATED") return "failed";
  return "other";
}

const DOT: Record<RowState, string> = {
  running: "border-blue/50 bg-blue/15 text-blue",
  done: "border-emerald/40 bg-emerald/15 text-emerald",
  failed: "border-red/40 bg-red/15 text-red",
  other: "border-border bg-background-elevated text-muted-foreground",
};

const BAR: Record<RowState, string> = {
  running: "bg-blue animate-pulse",
  done: "bg-emerald",
  failed: "bg-red",
  other: "bg-muted-foreground/40",
};

function StateIcon({ state }: { state: RowState }) {
  if (state === "running") return <Loader2 className="size-3 animate-spin" />;
  if (state === "done") return <Check className="size-3" />;
  if (state === "failed") return <AlertTriangle className="size-3" />;
  return <Minus className="size-3" />;
}

function prettyName(name: string): string {
  return name
    .replace(/^__parallel_/, "")
    .replace(/:start$/, "")
    .replace(/[_.]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function stepElapsed(step: ExecutionStep, now: number): number | null {
  if (step.duration_ms != null) return step.duration_ms;
  if (step.start_time_ms) return Math.max(0, now - step.start_time_ms);
  return null;
}

const HIDDEN_ATTRIBUTE_KEYS = new Set([
  "input",
  "output",
  "result",
  "query",
  "arguments",
  "response",
  "content",
]);

function PreviewBlock({
  label,
  tone,
  icon,
  value,
}: {
  label: string;
  tone: "blue" | "emerald";
  icon: ReactNode;
  value: string;
}) {
  return (
    <div
      className={cn(
        "rounded-lg border bg-background-elevated/60 p-2.5",
        tone === "blue" ? "border-blue/20" : "border-emerald/20",
      )}
    >
      <div
        className={cn(
          "mb-1.5 flex items-center gap-1.5 text-[9px] font-bold tracking-wider uppercase",
          tone === "blue" ? "text-blue" : "text-emerald",
        )}
      >
        {icon}
        {label}
      </div>
      <pre className="custom-scrollbar max-h-56 overflow-auto font-mono text-[11px] leading-relaxed break-words whitespace-pre-wrap text-foreground/90">
        {value}
      </pre>
    </div>
  );
}

function StepRow({
  step,
  index,
  now,
  maxDuration,
  defaultExpanded,
  dotSize = "size-[22px]",
  dotOffset = "-left-7",
}: {
  step: ExecutionStep;
  index: number;
  now: number;
  maxDuration: number;
  defaultExpanded: boolean;
  dotSize?: string;
  dotOffset?: string;
}) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const state = rowState(step.status);
  const identity = executionStatusIdentity(step.status);
  const elapsed = stepElapsed(step, now);

  const extraAttributes = useMemo(
    () =>
      Object.entries(step.attributes ?? {}).filter(
        ([key, value]) =>
          !HIDDEN_ATTRIBUTE_KEYS.has(key) &&
          value != null &&
          value !== "" &&
          typeof value !== "object",
      ),
    [step.attributes],
  );

  const hasDetail =
    !!step.input_preview || !!step.output_preview || !!step.error || extraAttributes.length > 0;

  // Relative bar width, so a 20s step reads as visibly longer than a 200ms one.
  const barPercent =
    maxDuration > 0 && elapsed != null ? Math.max(2, Math.round((elapsed / maxDuration) * 100)) : 0;

  return (
    <motion.li
      initial={{ opacity: 0, x: -8 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.2, delay: Math.min(index * 0.03, 0.3) }}
      className="relative"
    >
      <span
        className={cn(
          "absolute top-2 grid place-items-center rounded-full border",
          dotSize,
          dotOffset,
          DOT[state],
        )}
      >
        <StateIcon state={state} />
      </span>

      <div
        className={cn(
          "rounded-xl border bg-background-elevated/50 transition-colors",
          state === "running"
            ? "border-blue/30"
            : state === "failed"
              ? "border-red/25"
              : "border-border",
        )}
      >
        <button
          type="button"
          onClick={() => hasDetail && setExpanded((v) => !v)}
          aria-expanded={hasDetail ? expanded : undefined}
          className={cn(
            "flex w-full items-center gap-2.5 px-3 py-2.5 text-left",
            hasDetail ? "cursor-pointer hover:bg-surface-hover/60" : "cursor-default",
          )}
        >
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[13px] font-medium text-foreground capitalize">
              {prettyName(step.name || step.id)}
            </span>
            {barPercent > 0 ? (
              <span className="mt-1.5 block h-[3px] overflow-hidden rounded-full bg-border/50">
                <span
                  className={cn("block h-full rounded-full", BAR[state])}
                  style={{ width: `${barPercent}%` }}
                />
              </span>
            ) : null}
          </span>
          <span className="flex shrink-0 items-center gap-2">
            <span
              className={cn("text-[10px] font-semibold tracking-wider uppercase", identity.text)}
            >
              {identity.label}
            </span>
            <span className="font-mono text-[10px] tabular-nums text-muted-foreground">
              {elapsed != null ? formatDuration(elapsed) : "—"}
            </span>
            {hasDetail ? (
              <ChevronRight
                className={cn(
                  "size-3.5 text-muted-foreground transition-transform",
                  expanded && "rotate-90",
                )}
              />
            ) : null}
          </span>
        </button>

        <AnimatePresence initial={false}>
          {expanded && hasDetail ? (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.18 }}
              className="overflow-hidden"
            >
              <div className="space-y-2 px-3 pb-3">
                {step.error ? (
                  <p className="rounded-lg border border-red/25 bg-red/10 px-3 py-2 font-mono text-[11px] break-words text-red">
                    {step.error}
                  </p>
                ) : null}
                {step.input_preview ? (
                  <PreviewBlock
                    label="Input"
                    tone="blue"
                    icon={<ArrowDownRight className="size-2.5" />}
                    value={step.input_preview}
                  />
                ) : null}
                {step.output_preview ? (
                  <PreviewBlock
                    label="Output"
                    tone="emerald"
                    icon={<ArrowUpRight className="size-2.5" />}
                    value={step.output_preview}
                  />
                ) : null}
                {extraAttributes.length > 0 ? (
                  <div className="flex flex-wrap gap-1.5 pt-0.5">
                    {extraAttributes.slice(0, 12).map(([key, value]) => (
                      <span
                        key={key}
                        title={`${key}: ${String(value)}`}
                        className="inline-flex max-w-[220px] items-center gap-1 truncate rounded-md border border-border bg-background-elevated px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground"
                      >
                        <Tag className="size-2 shrink-0 opacity-60" />
                        {key}={String(value)}
                      </span>
                    ))}
                  </div>
                ) : null}
              </div>
            </motion.div>
          ) : null}
        </AnimatePresence>
      </div>
    </motion.li>
  );
}

/** One clock for every row, ticking only while something is still running. */
function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [active]);
  return now;
}

export function ExecutionStepTimeline({
  steps,
  emptyHint,
}: {
  steps: ExecutionStep[];
  emptyHint?: string;
}) {
  const anyRunning = steps.some((s) => rowState(s.status) === "running");
  const now = useNow(anyRunning);

  const groups = useMemo(() => {
    const ordered: Array<{ key: string; group: string | null; steps: ExecutionStep[] }> = [];
    const byGroup = new Map<string, number>();
    for (const step of steps) {
      const group = step.parallel_group || null;
      if (!group) {
        ordered.push({ key: `solo:${step.id}`, group: null, steps: [step] });
        continue;
      }
      const existing = byGroup.get(group);
      if (existing == null) {
        byGroup.set(group, ordered.length);
        ordered.push({ key: `group:${group}`, group, steps: [step] });
      } else {
        ordered[existing]?.steps.push(step);
      }
    }
    return ordered;
  }, [steps]);

  const maxDuration = useMemo(
    () => steps.reduce((max, step) => Math.max(max, stepElapsed(step, now) ?? 0), 0),
    [steps, now],
  );

  if (!steps.length) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <div className="mb-3 grid size-12 place-items-center rounded-2xl border border-border bg-background-elevated/60">
          <Layers className="size-5 text-muted-foreground/60" />
        </div>
        <p className="text-xs text-muted-foreground">
          {emptyHint ?? "No step activity reported yet."}
        </p>
      </div>
    );
  }

  const done = steps.filter((s) => rowState(s.status) === "done").length;
  const failed = steps.filter((s) => rowState(s.status) === "failed").length;
  let index = 0;

  return (
    <div>
      <div className="mb-4 flex items-center justify-between text-[10px] font-semibold tracking-wider text-muted-foreground uppercase">
        <span>
          {done} of {steps.length} steps complete
          {failed > 0 ? <span className="text-red"> · {failed} failed</span> : null}
        </span>
        {anyRunning ? (
          <span className="inline-flex items-center gap-1 text-blue normal-case">
            <span className="size-1.5 animate-pulse rounded-full bg-blue" /> running
          </span>
        ) : null}
      </div>

      <ol className="relative space-y-2.5 pl-7">
        <span
          aria-hidden
          className="absolute top-3 bottom-3 left-[11px] w-px bg-gradient-to-b from-primary/50 via-border to-transparent"
        />
        {groups.map(({ key, group, steps: groupSteps }) => {
          const first = groupSteps[0];
          if (!group && first) {
            return (
              <StepRow
                key={key}
                step={first}
                index={index++}
                now={now}
                maxDuration={maxDuration}
                defaultExpanded={rowState(first.status) === "failed"}
              />
            );
          }
          return (
            <li key={key} className="relative">
              <span className="absolute top-2 -left-7 grid size-[22px] place-items-center rounded-full border border-cyan/40 bg-cyan/15 text-cyan">
                <GitMerge className="size-3" />
              </span>
              <div className="rounded-xl border border-cyan/25 bg-cyan/5 p-2.5">
                <div className="mb-2 flex items-center gap-1.5 px-0.5">
                  <span className="text-[10px] font-bold tracking-wider text-cyan uppercase">
                    Parallel · {prettyName(group ?? "")}
                  </span>
                  <span className="text-[10px] text-cyan/60">{groupSteps.length} branches</span>
                </div>
                <ul className="relative space-y-2 border-l border-cyan/20 pl-6">
                  {groupSteps.map((step) => (
                    <StepRow
                      key={step.id}
                      step={step}
                      index={index++}
                      now={now}
                      maxDuration={maxDuration}
                      defaultExpanded={false}
                      dotSize="size-[18px]"
                      dotOffset="-left-[33px]"
                    />
                  ))}
                </ul>
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
