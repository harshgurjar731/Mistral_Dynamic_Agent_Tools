import { useMemo, useState } from 'react';
import { Activity, Copy, Check, Filter, ScrollText } from 'lucide-react';
import { cn } from '../../../lib/utils';
import type { TraceEvent } from '../../../api/executions';
import type { WorkflowEvent } from './useExecutionStream';
import { statusStyle } from './ExecutionStatusBadge';

/**
 * Combined event log: trace events from the platform plus anything the workflow
 * published on its own stream.
 *
 * These arrive from two different channels and interleave in real time, so they
 * are merged onto one timestamp axis rather than shown as separate lists —
 * "the workflow emitted X right after step Y failed" is the thing you actually
 * want to read off this view.
 */

interface LogRow {
  key: string;
  at: number;              // epoch ms
  channel: 'trace' | 'workflow';
  name: string;
  status?: string;
  internal?: boolean;
  detail?: unknown;
}

function toRows(traceEvents: TraceEvent[], workflowEvents: WorkflowEvent[]): LogRow[] {
  const rows: LogRow[] = [];

  for (const event of traceEvents) {
    rows.push({
      key: `t:${event.id}:${event.timestamp_unix_nano}`,
      at: event.start_time_unix_ms ?? Math.round((event.timestamp_unix_nano ?? 0) / 1_000_000),
      channel: 'trace',
      name: event.name,
      status: event.status,
      internal: event.internal,
      detail: event.error ? { error: event.error, ...event.attributes } : event.attributes,
    });
  }

  for (const [index, event] of workflowEvents.entries()) {
    rows.push({
      key: `w:${event.id ?? index}`,
      at: event.receivedAt,
      channel: 'workflow',
      name: event.event || 'workflow event',
      detail: event.data,
    });
  }

  return rows.sort((a, b) => a.at - b.at);
}

function formatClock(at: number): string {
  if (!at) return '--:--:--';
  const date = new Date(at);
  return Number.isNaN(date.getTime())
    ? '--:--:--'
    : date.toLocaleTimeString(undefined, { hour12: false });
}

function Row({ row }: { row: LogRow }) {
  const [open, setOpen] = useState(false);
  const style = statusStyle(row.status);
  const detailText = useMemo(() => {
    if (row.detail == null) return '';
    if (typeof row.detail === 'string') return row.detail;
    try {
      const text = JSON.stringify(row.detail, null, 2);
      return text === '{}' ? '' : text;
    } catch {
      return String(row.detail);
    }
  }, [row.detail]);

  return (
    <div className="border-b border-[var(--color-border-subtle)]/60 last:border-b-0">
      <button
        type="button"
        onClick={() => detailText && setOpen((v) => !v)}
        className={cn(
          'flex w-full items-center gap-2 px-2 py-1.5 text-left',
          detailText ? 'hover:bg-white/[0.03]' : 'cursor-default',
        )}
      >
        <span className="shrink-0 font-mono text-[10px] tabular-nums text-[var(--color-text-muted)]">
          {formatClock(row.at)}
        </span>
        <span
          className={cn(
            'shrink-0 rounded px-1 py-px font-mono text-[9px] uppercase',
            row.channel === 'workflow'
              ? 'bg-purple-500/15 text-purple-300'
              : 'bg-white/5 text-[var(--color-text-muted)]',
          )}
        >
          {row.channel === 'workflow' ? 'emit' : 'trace'}
        </span>
        <span className="min-w-0 flex-1 truncate text-[11px] text-[var(--color-text-secondary)]">
          {row.name}
        </span>
        {row.status && (
          <span className={cn('shrink-0 font-mono text-[9px] uppercase', style.text)}>
            {row.status}
          </span>
        )}
      </button>
      {open && detailText && (
        <pre className="max-h-56 overflow-auto whitespace-pre-wrap break-words bg-black/40 px-3 py-2 font-mono text-[10px] leading-relaxed text-[var(--color-text-secondary)] custom-scrollbar">
          {detailText}
        </pre>
      )}
    </div>
  );
}

export default function ExecutionEventLog({
  traceEvents,
  workflowEvents,
  showInternal,
  onToggleInternal,
}: {
  traceEvents: TraceEvent[];
  workflowEvents: WorkflowEvent[];
  showInternal: boolean;
  onToggleInternal: (value: boolean) => void;
}) {
  const [copied, setCopied] = useState(false);
  const rows = useMemo(
    () => toRows(traceEvents, workflowEvents).filter((r) => showInternal || !r.internal),
    [traceEvents, workflowEvents, showInternal],
  );

  const copyAll = async () => {
    try {
      await navigator.clipboard.writeText(
        rows.map((r) => `${formatClock(r.at)} [${r.channel}] ${r.name}`).join('\n'),
      );
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable — nothing useful to say about it here */
    }
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between gap-2 pb-2">
        <label className="flex cursor-pointer select-none items-center gap-1.5 text-[10px] text-[var(--color-text-muted)]">
          <input
            type="checkbox"
            checked={showInternal}
            onChange={(e) => onToggleInternal(e.target.checked)}
            className="h-3 w-3 accent-indigo-500"
          />
          <Filter size={10} />
          Internal events
        </label>
        <button
          type="button"
          onClick={copyAll}
          disabled={!rows.length}
          className="flex items-center gap-1 rounded-md border border-[var(--color-border-subtle)] px-2 py-1 text-[10px] text-[var(--color-text-muted)] transition-colors hover:text-white disabled:opacity-40"
        >
          {copied ? <Check size={10} className="text-emerald-400" /> : <Copy size={10} />}
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>

      {rows.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center py-10 text-center">
          <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-white/[0.03]">
            <ScrollText size={20} className="text-[var(--color-text-muted)] opacity-40" />
          </div>
          <p className="text-xs text-[var(--color-text-muted)]">No events recorded yet.</p>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto rounded-lg border border-[var(--color-border-subtle)] bg-black/20 custom-scrollbar">
          {rows.map((row) => (
            <Row key={row.key} row={row} />
          ))}
        </div>
      )}

      <p className="flex items-center gap-1 pt-2 text-[10px] text-[var(--color-text-muted)] opacity-60">
        <Activity size={9} />
        {rows.length} events · trace + workflow stream
      </p>
    </div>
  );
}
