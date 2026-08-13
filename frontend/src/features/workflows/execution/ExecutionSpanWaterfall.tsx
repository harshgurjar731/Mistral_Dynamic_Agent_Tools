import { useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, Radar } from 'lucide-react';
import { cn } from '../../../lib/utils';
import { formatDuration, type TraceSpan } from '../../../api/executions';

/**
 * Waterfall view of the execution's OpenTelemetry span tree.
 *
 * Where the step timeline answers "what ran, in what state", this answers
 * "what nested inside what, and where did the wall clock actually go" — the
 * view you need to spot a slow child span hiding inside a fast-looking parent.
 *
 * Span times arrive in Unix nanoseconds; everything below works in milliseconds
 * relative to the root's start so the bars share one scale.
 */

interface FlatSpan {
  span: TraceSpan;
  depth: number;
  startMs: number;
  durationMs: number;
  hasChildren: boolean;
  path: string;
}

const NS_PER_MS = 1_000_000;

function flatten(
  span: TraceSpan,
  depth: number,
  originNs: number,
  nowNs: number,
  collapsed: Set<string>,
  path: string,
  out: FlatSpan[],
) {
  const startNs = span.start_time_unix_nano ?? originNs;
  const endNs = span.end_time_unix_nano ?? nowNs;
  const children = span.children ?? [];

  out.push({
    span,
    depth,
    startMs: (startNs - originNs) / NS_PER_MS,
    durationMs: Math.max(0, (endNs - startNs) / NS_PER_MS),
    hasChildren: children.length > 0,
    path,
  });

  if (collapsed.has(path)) return;
  children.forEach((child, i) =>
    flatten(child, depth + 1, originNs, nowNs, collapsed, `${path}/${child.span_id || i}`, out),
  );
}

/** Deepest end timestamp in the tree — the root's own end may be unset while live. */
function maxEndNs(span: TraceSpan, fallback: number): number {
  let max = span.end_time_unix_nano ?? span.start_time_unix_nano ?? fallback;
  for (const child of span.children ?? []) {
    max = Math.max(max, maxEndNs(child, fallback));
  }
  return max;
}

function spanTone(span: TraceSpan): string {
  const status = String(
    (span.attributes?.['status'] as string) ??
    (span.attributes?.['otel.status_code'] as string) ??
    '',
  ).toUpperCase();
  if (status.includes('ERROR') || status.includes('FAIL')) return 'bg-red-400';
  if (!span.end_time_unix_nano) return 'bg-amber-400 animate-pulse';
  return 'bg-indigo-400';
}

export default function ExecutionSpanWaterfall({
  root,
  isLoading,
  error,
}: {
  root?: TraceSpan | null;
  isLoading?: boolean;
  error?: string | null;
}) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const { rows, totalMs } = useMemo(() => {
    if (!root) return { rows: [] as FlatSpan[], totalMs: 0 };
    const nowNs = Date.now() * NS_PER_MS;
    const originNs = root.start_time_unix_nano ?? nowNs;
    const endNs = maxEndNs(root, nowNs);
    const out: FlatSpan[] = [];
    flatten(root, 0, originNs, nowNs, collapsed, root.span_id || 'root', out);
    return { rows: out, totalMs: Math.max(1, (endNs - originNs) / NS_PER_MS) };
  }, [root, collapsed]);

  const toggle = (path: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });

  if (isLoading) {
    return <p className="py-10 text-center text-xs text-[var(--color-text-muted)]">Loading trace…</p>;
  }

  if (error || !root) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-white/[0.03]">
          <Radar size={20} className="text-[var(--color-text-muted)] opacity-40" />
        </div>
        <p className="text-xs text-[var(--color-text-muted)]">
          {error ?? 'No trace spans recorded for this execution.'}
        </p>
        <p className="mt-1 text-[10px] text-[var(--color-text-muted)] opacity-60">
          Traces are collected for workflows running on Mistral.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between px-1 pb-1 text-[10px] uppercase tracking-wider text-[var(--color-text-muted)]">
        <span>{rows.length} spans</span>
        <span className="font-mono">{formatDuration(totalMs)} total</span>
      </div>

      {rows.map(({ span, depth, startMs, durationMs, hasChildren, path }) => {
        const leftPercent = Math.min(99, (startMs / totalMs) * 100);
        const widthPercent = Math.max(0.8, Math.min(100 - leftPercent, (durationMs / totalMs) * 100));

        return (
          <div
            key={path}
            className="group grid grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)_auto] items-center gap-2 rounded-md px-1 py-1 hover:bg-white/[0.03]"
          >
            <div className="flex min-w-0 items-center gap-1" style={{ paddingLeft: depth * 12 }}>
              {hasChildren ? (
                <button
                  type="button"
                  onClick={() => toggle(path)}
                  className="shrink-0 text-[var(--color-text-muted)] hover:text-white"
                >
                  {collapsed.has(path) ? <ChevronRight size={11} /> : <ChevronDown size={11} />}
                </button>
              ) : (
                <span className="w-[11px] shrink-0" />
              )}
              <span className="truncate text-[11px] text-[var(--color-text-secondary)]" title={span.name}>
                {span.name}
              </span>
            </div>

            <div className="relative h-2 rounded-full bg-white/[0.04]">
              <span
                className={cn('absolute top-0 h-full rounded-full', spanTone(span))}
                style={{ left: `${leftPercent}%`, width: `${widthPercent}%` }}
                title={`${span.name} · +${formatDuration(startMs)} · ${formatDuration(durationMs)}`}
              />
            </div>

            <span className="w-14 shrink-0 text-right font-mono text-[10px] tabular-nums text-[var(--color-text-muted)]">
              {formatDuration(durationMs)}
            </span>
          </div>
        );
      })}
    </div>
  );
}
