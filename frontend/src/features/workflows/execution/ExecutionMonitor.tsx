import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  Activity, AlertTriangle, Check, Clock, Cpu, FileJson, Gauge,
  Hash, History, Layers, Radar, RefreshCw, ScrollText, Server, SlidersHorizontal,
  Wifi, WifiOff, Zap,
} from 'lucide-react';
import { cn } from '../../../lib/utils';
import {
  executionDuration, executionsApi, formatDuration, formatTimestamp,
  isActive, isTerminal, type ExecutionDetail, type LogLine,
} from '../../../api/executions';
import ExecutionStatusBadge, { statusStyle } from './ExecutionStatusBadge';
import ExecutionStepTimeline from './ExecutionStepTimeline';
import ExecutionSpanWaterfall from './ExecutionSpanWaterfall';
import ExecutionEventLog from './ExecutionEventLog';
import ExecutionLogConsole from './ExecutionLogConsole';
import ExecutionControls from './ExecutionControls';
import { formatWorkflowResult, isEmptyResult } from './resultFormat';
import type { StreamPhase, WorkflowEvent } from './useExecutionStream';

/**
 * The execution console — everything about one run, in one panel.
 *
 * Tabs are lazy: the trace, history and log queries only fire once their tab is
 * opened, and only refetch while the execution is live. Watching a long run
 * with the Steps tab open should not be pulling an OTel payload every few
 * seconds in the background.
 */

type Tab = 'steps' | 'logs' | 'trace' | 'events' | 'history' | 'result' | 'control';

const TABS: Array<{ id: Tab; label: string; icon: typeof Layers }> = [
  { id: 'steps', label: 'Steps', icon: Layers },
  { id: 'logs', label: 'Logs', icon: ScrollText },
  { id: 'trace', label: 'Trace', icon: Radar },
  { id: 'events', label: 'Events', icon: Activity },
  { id: 'history', label: 'History', icon: History },
  { id: 'result', label: 'Result', icon: FileJson },
  { id: 'control', label: 'Control', icon: SlidersHorizontal },
];

function StatTile({
  icon: Icon, label, value, tone,
}: {
  icon: typeof Clock;
  label: string;
  value: string;
  tone?: string;
}) {
  return (
    <div className="min-w-0 rounded-lg border border-[var(--color-border-subtle)] bg-black/20 px-2.5 py-2">
      <div className="flex items-center gap-1 text-[9px] font-semibold uppercase tracking-wider text-[var(--color-text-muted)]">
        <Icon size={9} />
        {label}
      </div>
      <div className={cn('mt-0.5 truncate font-mono text-[12px] tabular-nums', tone ?? 'text-white')}>
        {value}
      </div>
    </div>
  );
}

function ConnectionPill({ phase, onRetry }: { phase: StreamPhase; onRetry: () => void }) {
  const map: Record<StreamPhase, { label: string; cls: string; icon: typeof Wifi }> = {
    idle: { label: 'Idle', cls: 'text-[var(--color-text-muted)]', icon: WifiOff },
    connecting: { label: 'Connecting', cls: 'text-amber-300', icon: Wifi },
    live: { label: 'Live', cls: 'text-emerald-300', icon: Wifi },
    reconnecting: { label: 'Reconnecting', cls: 'text-amber-300', icon: RefreshCw },
    closed: { label: 'Closed', cls: 'text-[var(--color-text-muted)]', icon: WifiOff },
    error: { label: 'Disconnected', cls: 'text-red-300', icon: WifiOff },
  };
  const { label, cls, icon: Icon } = map[phase];
  const canRetry = phase === 'error';

  return (
    <button
      type="button"
      onClick={canRetry ? onRetry : undefined}
      disabled={!canRetry}
      className={cn(
        'flex items-center gap-1 rounded-full border border-[var(--color-border-subtle)] bg-black/20 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wider',
        cls,
        canRetry && 'hover:border-red-400/40',
      )}
      title={canRetry ? 'Click to reconnect' : `Stream ${label.toLowerCase()}`}
    >
      <Icon size={9} className={phase === 'reconnecting' ? 'animate-spin' : undefined} />
      {canRetry ? 'Retry' : label}
    </button>
  );
}

export default function ExecutionMonitor({
  executionId,
  detail,
  phase,
  streamError,
  workflowEvents,
  logs,
  onReconnect,
  onNotice,
}: {
  executionId: string | null;
  detail: ExecutionDetail | null;
  phase: StreamPhase;
  streamError: string | null;
  workflowEvents: WorkflowEvent[];
  logs: LogLine[];
  onReconnect: () => void;
  onNotice?: (message: string) => void;
}) {
  const [tab, setTab] = useState<Tab>('steps');
  const [showInternal, setShowInternal] = useState(false);
  const [copied, setCopied] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  const live = isActive(detail?.status);

  // One ticking clock for the whole panel — every elapsed readout below derives
  // from it, so they can never drift apart mid-render.
  useEffect(() => {
    if (!live) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [live]);

  const traceQuery = useQuery({
    queryKey: ['execution', executionId, 'trace-summary'],
    queryFn: () => executionsApi.traceSummary(executionId!).then((r) => r.data),
    enabled: !!executionId && tab === 'trace',
    refetchInterval: live ? 5000 : false,
    retry: false,
  });

  const eventsQuery = useQuery({
    queryKey: ['execution', executionId, 'trace-events', showInternal],
    queryFn: () =>
      executionsApi
        .traceEvents(executionId!, { includeInternal: showInternal })
        .then((r) => r.data),
    enabled: !!executionId && tab === 'events',
    refetchInterval: live ? 3000 : false,
    retry: false,
  });

  // Fallback for when the stream never delivered logs — a connection that
  // failed outright, or a tab opened against a run the stream has since closed.
  const logsFallbackQuery = useQuery({
    queryKey: ['execution', executionId, 'logs'],
    queryFn: () => executionsApi.logs(executionId!).then((r) => r.data),
    enabled: !!executionId && tab === 'logs' && logs.length === 0,
    refetchInterval: live && logs.length === 0 ? 2000 : false,
    retry: false,
  });

  const visibleLogs = logs.length ? logs : logsFallbackQuery.data?.logs ?? [];

  const historyQuery = useQuery({
    queryKey: ['execution', executionId, 'history'],
    queryFn: () => executionsApi.history(executionId!).then((r) => r.data),
    enabled: !!executionId && tab === 'history',
    refetchInterval: live ? 8000 : false,
    retry: false,
  });

  const steps = detail?.steps ?? [];
  const completedSteps = steps.filter((s) => s.status.toUpperCase() === 'COMPLETED').length;
  const failedSteps = steps.filter((s) => s.status.toUpperCase() === 'FAILED').length;
  const runningSteps = steps.filter((s) => s.status.toUpperCase() === 'RUNNING').length;
  const progressPercent = steps.length
    ? Math.round(((completedSteps + failedSteps) / steps.length) * 100)
    : 0;

  const duration = detail ? executionDuration(detail, now) : null;
  const style = statusStyle(detail?.status);

  const resultMarkdown = useMemo(
    () => (detail && !isEmptyResult(detail.result) ? formatWorkflowResult(detail.result) : ''),
    [detail?.result],
  );

  const historyJson = useMemo(() => {
    if (!historyQuery.data) return '';
    try {
      return JSON.stringify(historyQuery.data.history, null, 2);
    } catch {
      return String(historyQuery.data.history);
    }
  }, [historyQuery.data]);

  const copyId = async () => {
    if (!executionId) return;
    try {
      await navigator.clipboard.writeText(executionId);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable */
    }
  };

  if (!executionId) {
    return (
      <div className="flex h-full flex-col items-center justify-center px-6 text-center">
        <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-white/[0.03]">
          <Clock size={24} className="text-[var(--color-text-muted)] opacity-30" />
        </div>
        <p className="text-sm font-medium text-[var(--color-text-secondary)]">Awaiting execution</p>
        <p className="mt-1 text-xs text-[var(--color-text-muted)]">
          Steps, traces and controls appear once the workflow starts.
        </p>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* ── Summary header ───────────────────────────────────────────── */}
      <div className="shrink-0 space-y-3 border-b border-[var(--color-border-subtle)] px-4 py-3">
        <div className="flex items-center justify-between gap-2">
          <ExecutionStatusBadge status={detail?.status} size="sm" />
          <div className="flex items-center gap-1.5">
            <ConnectionPill phase={phase} onRetry={onReconnect} />
            <button
              type="button"
              onClick={copyId}
              title={executionId}
              className="flex items-center gap-1 rounded-full border border-[var(--color-border-subtle)] bg-black/20 px-2 py-0.5 font-mono text-[9px] text-[var(--color-text-muted)] hover:text-white"
            >
              {copied ? <Check size={9} className="text-emerald-400" /> : <Hash size={9} />}
              {executionId.slice(0, 8)}
            </button>
          </div>
        </div>

        {/* Progress bar — indeterminate until at least one step is reported. */}
        <div>
          <div className="mb-1 flex items-center justify-between text-[10px] text-[var(--color-text-muted)]">
            <span>
              {steps.length
                ? `${completedSteps + failedSteps}/${steps.length} steps`
                : live ? 'Initialising…' : 'No steps reported'}
            </span>
            <span className="font-mono tabular-nums">{formatDuration(duration)}</span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-white/[0.05]">
            {steps.length ? (
              <div
                className={cn('h-full rounded-full transition-[width] duration-500', style.dot)}
                style={{ width: `${Math.max(progressPercent, live ? 4 : 0)}%` }}
              />
            ) : live ? (
              <div className="h-full w-1/3 animate-pulse rounded-full bg-amber-400/60" />
            ) : null}
          </div>
        </div>

        <div className="grid grid-cols-3 gap-1.5">
          <StatTile
            icon={Check}
            label="Done"
            value={String(completedSteps)}
            tone="text-emerald-300"
          />
          <StatTile
            icon={Zap}
            label="Active"
            value={String(runningSteps)}
            tone={runningSteps ? 'text-amber-300' : undefined}
          />
          <StatTile
            icon={AlertTriangle}
            label="Failed"
            value={String(failedSteps)}
            tone={failedSteps ? 'text-red-300' : undefined}
          />
        </div>

        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-[var(--color-text-muted)]">
          <span className="flex items-center gap-1">
            {detail?.source === 'local' ? (
              <><Cpu size={9} className="text-amber-400" /> Local engine</>
            ) : (
              <><Server size={9} className="text-emerald-400" /> Mistral</>
            )}
          </span>
          <span>Started {formatTimestamp(detail?.start_time)}</span>
          {detail?.run_id && <span className="font-mono">run {detail.run_id.slice(0, 8)}</span>}
        </div>

        {(streamError || detail?.error) && (
          <p className="rounded-lg border border-red-500/20 bg-red-500/10 px-2.5 py-2 text-[11px] text-red-300">
            {detail?.error ?? streamError}
          </p>
        )}
      </div>

      {/* ── Tabs ─────────────────────────────────────────────────────── */}
      <div className="shrink-0 overflow-x-auto border-b border-[var(--color-border-subtle)] px-2 custom-scrollbar">
        <div className="flex gap-0.5">
          {TABS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              onClick={() => setTab(id)}
              className={cn(
                'flex shrink-0 items-center gap-1.5 border-b-2 px-2.5 py-2 text-[11px] font-medium transition-colors',
                tab === id
                  ? 'border-indigo-400 text-white'
                  : 'border-transparent text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]',
              )}
            >
              <Icon size={12} />
              {label}
              {id === 'events' && workflowEvents.length > 0 && (
                <span className="rounded-full bg-purple-500/20 px-1.5 text-[9px] text-purple-300">
                  {workflowEvents.length}
                </span>
              )}
              {id === 'logs' && logs.length > 0 && (
                <span
                  className={cn(
                    'rounded-full px-1.5 text-[9px]',
                    live ? 'bg-emerald-500/20 text-emerald-300' : 'bg-white/10 text-[var(--color-text-muted)]',
                  )}
                >
                  {logs.length}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* ── Tab body ─────────────────────────────────────────────────── */}
      {/* The log console manages its own scroll so it can pin to the tail;
          every other tab scrolls as one block. */}
      <div
        className={cn(
          'min-h-0 flex-1 p-4 custom-scrollbar',
          tab === 'logs' ? 'overflow-hidden' : 'overflow-y-auto',
        )}
      >
        {tab === 'steps' && (
          <ExecutionStepTimeline
            steps={steps}
            now={now}
            emptyHint={
              live
                ? 'Waiting for the first step to report…'
                : 'This run reported no step-level progress.'
            }
          />
        )}

        {tab === 'logs' && (
          <ExecutionLogConsole logs={visibleLogs} isLive={live} />
        )}

        {tab === 'trace' && (
          <ExecutionSpanWaterfall
            root={traceQuery.data?.span_tree ?? null}
            isLoading={traceQuery.isLoading}
            error={
              traceQuery.isError
                ? 'Trace data is not available for this execution.'
                : null
            }
          />
        )}

        {tab === 'events' && (
          <ExecutionEventLog
            traceEvents={eventsQuery.data?.events ?? []}
            workflowEvents={workflowEvents}
            showInternal={showInternal}
            onToggleInternal={setShowInternal}
          />
        )}

        {tab === 'history' && (
          historyQuery.isLoading ? (
            <p className="py-10 text-center text-xs text-[var(--color-text-muted)]">
              Loading history…
            </p>
          ) : historyQuery.isError ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <History size={20} className="mb-3 text-[var(--color-text-muted)] opacity-40" />
              <p className="text-xs text-[var(--color-text-muted)]">
                Event history is only available for executions running on Mistral.
              </p>
            </div>
          ) : (
            <pre className="overflow-auto whitespace-pre-wrap break-words rounded-lg border border-[var(--color-border-subtle)] bg-black/30 p-3 font-mono text-[10px] leading-relaxed text-[var(--color-text-secondary)] custom-scrollbar">
              {historyJson || 'No history events.'}
            </pre>
          )
        )}

        {tab === 'result' && (
          resultMarkdown ? (
            <div className="prose prose-invert prose-sm max-w-none prose-headings:text-white prose-strong:text-white prose-code:rounded prose-code:bg-black/40 prose-code:px-1 prose-code:text-indigo-300 prose-pre:border prose-pre:border-[var(--color-border-subtle)] prose-pre:bg-black/40">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{resultMarkdown}</ReactMarkdown>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <FileJson size={20} className="mb-3 text-[var(--color-text-muted)] opacity-40" />
              <p className="text-xs text-[var(--color-text-muted)]">
                {isTerminal(detail?.status)
                  ? 'This execution finished without returning output.'
                  : 'The result appears once the execution finishes.'}
              </p>
            </div>
          )
        )}

        {tab === 'control' && detail && (
          <ExecutionControls
            executionId={executionId}
            status={detail.status}
            source={detail.source}
            onActed={onNotice}
          />
        )}

        {tab === 'control' && !detail && (
          <p className="py-10 text-center text-xs text-[var(--color-text-muted)]">
            Waiting for execution details…
          </p>
        )}
      </div>

      {/* ── Footer ───────────────────────────────────────────────────── */}
      <div className="shrink-0 border-t border-[var(--color-border-subtle)] px-4 py-2">
        <p className="flex items-center gap-1.5 text-[10px] text-[var(--color-text-muted)] opacity-70">
          <Gauge size={9} />
          {detail?.end_time
            ? `Finished ${formatTimestamp(detail.end_time)}`
            : live
              ? 'Streaming live updates'
              : 'Stream closed'}
        </p>
      </div>
    </div>
  );
}
