import { useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  ArrowDownRight, ArrowUpRight, ChevronDown, ChevronRight,
  GitMerge, Layers, Tag,
} from 'lucide-react';
import { cn } from '../../../lib/utils';
import { formatDuration, type ExecutionStep } from '../../../api/executions';
import { statusStyle } from './ExecutionStatusBadge';

/**
 * Live per-step timeline.
 *
 * Steps come from the execution's `EVENT_PROGRESS` trace events server-side and
 * from the DAG engine's step results locally, normalised to the same shape by
 * the backend. A step that is still RUNNING has no `duration_ms`, so its
 * elapsed time is derived from `start_time_ms` against the caller's clock —
 * `now` is passed in rather than read here so one ticking parent drives every
 * row and the rows stay in step with each other.
 */

function prettyName(name: string): string {
  return name
    .replace(/^__parallel_/, '')
    .replace(/:start$/, '')
    .replace(/[_.]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function stepElapsed(step: ExecutionStep, now: number): number | null {
  if (step.duration_ms != null) return step.duration_ms;
  if (step.start_time_ms) return Math.max(0, now - step.start_time_ms);
  return null;
}

const HIDDEN_ATTRIBUTE_KEYS = new Set([
  'input', 'output', 'result', 'query', 'arguments', 'response', 'content',
]);

function StepRow({
  step,
  index,
  now,
  maxDuration,
  defaultExpanded,
}: {
  step: ExecutionStep;
  index: number;
  now: number;
  maxDuration: number;
  defaultExpanded: boolean;
}) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const style = statusStyle(step.status);
  const { Icon } = style;
  const elapsed = stepElapsed(step, now);
  const running = step.status.toUpperCase() === 'RUNNING';

  const extraAttributes = useMemo(
    () =>
      Object.entries(step.attributes ?? {}).filter(
        ([key, value]) =>
          !HIDDEN_ATTRIBUTE_KEYS.has(key) &&
          value != null &&
          value !== '' &&
          typeof value !== 'object',
      ),
    [step.attributes],
  );

  const hasDetail =
    !!step.input_preview || !!step.output_preview || !!step.error || extraAttributes.length > 0;

  // Relative bar width, so a 20s step reads as visibly longer than a 200ms one.
  const barPercent = maxDuration > 0 && elapsed != null
    ? Math.max(2, Math.round((elapsed / maxDuration) * 100))
    : 0;

  return (
    <motion.li
      initial={{ opacity: 0, x: -8 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.2, delay: Math.min(index * 0.03, 0.3) }}
      className="relative"
    >
      <span
        className={cn(
          'absolute -left-[26px] top-3 w-2.5 h-2.5 rounded-full ring-4 ring-[var(--color-bg-surface)]',
          style.dot,
          running && 'animate-pulse',
        )}
      />

      <div
        className={cn(
          'rounded-xl border bg-black/20 transition-colors',
          running ? 'border-amber-400/25' : 'border-[var(--color-border-subtle)]',
        )}
      >
        <button
          type="button"
          onClick={() => hasDetail && setExpanded((v) => !v)}
          className={cn(
            'w-full flex items-center gap-2.5 px-3 py-2.5 text-left',
            hasDetail ? 'cursor-pointer hover:bg-white/[0.03]' : 'cursor-default',
          )}
        >
          <Icon
            size={13}
            className={cn(style.text, 'shrink-0', style.spin && 'animate-spin')}
          />
          <span className="flex-1 min-w-0">
            <span className="block text-[13px] font-medium text-white truncate capitalize">
              {prettyName(step.name)}
            </span>
            {barPercent > 0 && (
              <span className="mt-1.5 block h-[3px] rounded-full bg-white/5 overflow-hidden">
                <span
                  className={cn('block h-full rounded-full', style.dot, running && 'animate-pulse')}
                  style={{ width: `${barPercent}%` }}
                />
              </span>
            )}
          </span>
          <span className="shrink-0 flex items-center gap-2">
            <span className="font-mono text-[10px] text-[var(--color-text-muted)] tabular-nums">
              {elapsed != null ? formatDuration(elapsed) : '—'}
            </span>
            {hasDetail &&
              (expanded ? (
                <ChevronDown size={13} className="text-[var(--color-text-muted)]" />
              ) : (
                <ChevronRight size={13} className="text-[var(--color-text-muted)]" />
              ))}
          </span>
        </button>

        <AnimatePresence initial={false}>
          {expanded && hasDetail && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.18 }}
              className="overflow-hidden"
            >
              <div className="px-3 pb-3 space-y-2">
                {step.error && (
                  <p className="rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-[11px] font-mono text-red-300 break-words">
                    {step.error}
                  </p>
                )}

                {step.input_preview && (
                  <PreviewBlock
                    label="Input"
                    tone="blue"
                    icon={<ArrowDownRight size={10} />}
                    value={step.input_preview}
                  />
                )}

                {step.output_preview && (
                  <PreviewBlock
                    label="Output"
                    tone="emerald"
                    icon={<ArrowUpRight size={10} />}
                    value={step.output_preview}
                  />
                )}

                {extraAttributes.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 pt-0.5">
                    {extraAttributes.slice(0, 12).map(([key, value]) => (
                      <span
                        key={key}
                        title={`${key}: ${String(value)}`}
                        className="inline-flex items-center gap-1 rounded-md border border-[var(--color-border-subtle)] bg-white/[0.03] px-1.5 py-0.5 font-mono text-[10px] text-[var(--color-text-muted)] max-w-[220px] truncate"
                      >
                        <Tag size={8} className="shrink-0 opacity-60" />
                        {key}={String(value)}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </motion.li>
  );
}

function PreviewBlock({
  label, tone, icon, value,
}: {
  label: string;
  tone: 'blue' | 'emerald';
  icon: React.ReactNode;
  value: string;
}) {
  const toneClasses =
    tone === 'blue'
      ? { border: 'border-blue-500/15', text: 'text-blue-300', body: 'text-[var(--color-text-secondary)]' }
      : { border: 'border-emerald-500/15', text: 'text-emerald-300', body: 'text-emerald-200/80' };

  return (
    <div className={cn('rounded-lg border bg-black/30 p-2.5', toneClasses.border)}>
      <div className={cn('mb-1.5 flex items-center gap-1.5 text-[9px] font-bold uppercase tracking-wider', toneClasses.text)}>
        {icon}
        {label}
      </div>
      <pre className={cn('max-h-56 overflow-auto whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed custom-scrollbar', toneClasses.body)}>
        {value}
      </pre>
    </div>
  );
}

export default function ExecutionStepTimeline({
  steps,
  now,
  emptyHint,
}: {
  steps: ExecutionStep[];
  now: number;
  emptyHint?: string;
}) {
  // Steps that share a `parallel_group` ran concurrently; rendering them as a
  // flat list would imply an ordering the runtime never had.
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
        ordered[existing].steps.push(step);
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
        <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-white/[0.03]">
          <Layers size={20} className="text-[var(--color-text-muted)] opacity-40" />
        </div>
        <p className="text-xs text-[var(--color-text-muted)]">
          {emptyHint ?? 'No step activity reported yet.'}
        </p>
      </div>
    );
  }

  let index = 0;

  return (
    <ul className="ml-[10px] space-y-2.5 border-l border-[var(--color-border-subtle)] pl-6">
      {groups.map(({ key, group, steps: groupSteps }) =>
        group ? (
          <li key={key} className="relative">
            <span className="absolute -left-[26px] top-3 flex h-2.5 w-2.5 items-center justify-center rounded-full bg-cyan-400 ring-4 ring-[var(--color-bg-surface)]" />
            <div className="rounded-xl border border-cyan-500/25 bg-cyan-500/[0.06] p-2.5">
              <div className="mb-2 flex items-center gap-1.5 px-0.5">
                <GitMerge size={11} className="text-cyan-300" />
                <span className="text-[10px] font-bold uppercase tracking-wider text-cyan-300">
                  Parallel · {prettyName(group)}
                </span>
                <span className="text-[10px] text-cyan-300/50">
                  {groupSteps.length} branches
                </span>
              </div>
              <ul className="space-y-2 pl-4 border-l border-cyan-500/20">
                {groupSteps.map((step) => (
                  <StepRow
                    key={step.id}
                    step={step}
                    index={index++}
                    now={now}
                    maxDuration={maxDuration}
                    defaultExpanded={false}
                  />
                ))}
              </ul>
            </div>
          </li>
        ) : (
          <StepRow
            key={key}
            step={groupSteps[0]}
            index={index++}
            now={now}
            maxDuration={maxDuration}
            defaultExpanded={groupSteps[0].status.toUpperCase() === 'FAILED'}
          />
        ),
      )}
    </ul>
  );
}
