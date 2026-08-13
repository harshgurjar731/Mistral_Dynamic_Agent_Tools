import { useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Ban, Clock, Cpu, GitBranch, Loader2, OctagonX, Play, Search, Server, X,
} from 'lucide-react';
import {
  EXECUTION_STATUSES, executionsApi, formatDuration, formatTimestamp, isActive,
  type ExecutionSummary,
} from '../../api/executions';
import ExecutionStatusBadge from './execution/ExecutionStatusBadge';
import { cn } from '../../lib/utils';

/**
 * Execution history for one workflow.
 *
 * Beyond listing runs it is the place to act on several at once — selecting a
 * few in-flight executions and cancelling them together is the common cleanup
 * after a bad publish, and doing that one-by-one through the detail view is the
 * kind of chore that makes people leave runs stranded.
 */
export default function WorkflowHistoryPanel({
  workflowName,
  onClose,
  onSelectExecution,
}: {
  workflowName: string;
  onClose: () => void;
  onSelectExecution: (id: string) => void;
}) {
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = useState('');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const queryKey = ['executions', workflowName, statusFilter, search];

  const { data, isLoading, isFetching } = useQuery({
    queryKey,
    queryFn: () =>
      executionsApi
        .list({
          workflow_identifier: workflowName,
          status: statusFilter || undefined,
          search: search.trim() || undefined,
          page_size: 100,
        })
        .then((r) => r.data),
    // Keep the list warm while runs are in flight, but not so often that a
    // panel left open hammers the API.
    refetchInterval: 6000,
  });

  const executions = useMemo<ExecutionSummary[]>(() => data?.executions ?? [], [data]);

  // Platform-side aggregates. Unavailable for workflows that have only ever run
  // locally, which is why the strip renders nothing rather than zeros.
  const { data: metrics } = useQuery({
    queryKey: ['workflow-metrics', workflowName],
    queryFn: () => executionsApi.metrics(workflowName).then((r) => r.data),
    staleTime: 60_000,
    retry: false,
  });
  const hasMetrics = metrics?.available !== false && metrics?.execution_count != null;
  const activeSelected = useMemo(
    () => executions.filter((e) => selected.has(e.execution_id) && isActive(e.status)),
    [executions, selected],
  );

  const batchMut = useMutation({
    mutationFn: (mode: 'cancel' | 'terminate') => {
      const ids = activeSelected.map((e) => e.execution_id);
      return mode === 'cancel'
        ? executionsApi.batchCancel(ids)
        : executionsApi.batchTerminate(ids);
    },
    onSettled: () => {
      setSelected(new Set());
      queryClient.invalidateQueries({ queryKey: ['executions'] });
    },
  });

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <>
      <motion.div
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
      />

      <motion.div
        initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }}
        transition={{ type: 'spring', stiffness: 300, damping: 30 }}
        className="fixed bottom-0 right-0 top-0 z-50 flex w-[440px] max-w-full flex-col border-l border-[var(--color-border-subtle)] bg-[var(--color-bg-base)] shadow-2xl"
      >
        <header className="flex shrink-0 items-center justify-between border-b border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] px-5 py-4">
          <div className="flex items-center gap-2">
            <Clock size={16} className="text-indigo-400" />
            <h2 className="text-sm font-semibold text-white">Execution history</h2>
            {isFetching && <Loader2 size={12} className="animate-spin text-[var(--color-text-muted)]" />}
          </div>
          <button
            onClick={onClose}
            className="rounded-md p-1.5 text-[var(--color-text-muted)] transition-colors hover:bg-white/5 hover:text-white"
          >
            <X size={16} />
          </button>
        </header>

        {/* Aggregate metrics */}
        {hasMetrics && (
          <div className="grid shrink-0 grid-cols-4 gap-px border-b border-[var(--color-border-subtle)] bg-[var(--color-border-subtle)]">
            {[
              { label: 'Runs', value: String(metrics!.execution_count ?? 0), tone: 'text-white' },
              { label: 'OK', value: String(metrics!.success_count ?? 0), tone: 'text-emerald-300' },
              { label: 'Errors', value: String(metrics!.error_count ?? 0), tone: 'text-red-300' },
              { label: 'Avg', value: formatDuration(metrics!.average_latency_ms), tone: 'text-indigo-300' },
            ].map(({ label, value, tone }) => (
              <div key={label} className="bg-[var(--color-bg-base)] px-2 py-2 text-center">
                <div className="text-[9px] uppercase tracking-wider text-[var(--color-text-muted)]">
                  {label}
                </div>
                <div className={cn('mt-0.5 truncate font-mono text-[13px] tabular-nums', tone)}>
                  {value}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Filters */}
        <div className="shrink-0 space-y-2 border-b border-[var(--color-border-subtle)] px-4 py-3">
          <div className="relative">
            <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)]" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search executions…"
              className="w-full rounded-lg border border-[var(--color-border-subtle)] bg-black/25 py-2 pl-8 pr-3 text-xs text-white placeholder:text-[var(--color-text-muted)] focus:border-indigo-500/50 focus:outline-none"
            />
          </div>
          <div className="flex gap-1.5 overflow-x-auto pb-1 custom-scrollbar">
            {['', ...EXECUTION_STATUSES].map((value) => (
              <button
                key={value || 'all'}
                onClick={() => setStatusFilter(value)}
                className={cn(
                  'shrink-0 rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider transition-colors',
                  statusFilter === value
                    ? 'border-indigo-400/50 bg-indigo-500/20 text-indigo-200'
                    : 'border-[var(--color-border-subtle)] text-[var(--color-text-muted)] hover:text-white',
                )}
              >
                {value ? value.replace(/_/g, ' ').toLowerCase() : 'all'}
              </button>
            ))}
          </div>
        </div>

        {/* Batch bar */}
        {activeSelected.length > 0 && (
          <div className="flex shrink-0 items-center gap-2 border-b border-[var(--color-border-subtle)] bg-indigo-500/10 px-4 py-2">
            <span className="flex-1 text-[11px] text-indigo-200">
              {activeSelected.length} running selected
            </span>
            <button
              onClick={() => batchMut.mutate('cancel')}
              disabled={batchMut.isPending}
              className="flex items-center gap-1 rounded-md border border-[var(--color-border-subtle)] px-2 py-1 text-[10px] font-semibold text-[var(--color-text-secondary)] hover:border-amber-400/40 hover:text-amber-300 disabled:opacity-40"
            >
              <Ban size={10} /> Cancel
            </button>
            <button
              onClick={() => batchMut.mutate('terminate')}
              disabled={batchMut.isPending}
              className="flex items-center gap-1 rounded-md border border-[var(--color-border-subtle)] px-2 py-1 text-[10px] font-semibold text-[var(--color-text-secondary)] hover:border-red-400/40 hover:text-red-300 disabled:opacity-40"
            >
              <OctagonX size={10} /> Terminate
            </button>
          </div>
        )}

        {/* List */}
        <div className="flex-1 space-y-2 overflow-y-auto p-4 custom-scrollbar">
          {isLoading ? (
            <div className="flex h-32 items-center justify-center">
              <Loader2 size={22} className="animate-spin text-[var(--color-text-muted)]" />
            </div>
          ) : executions.length === 0 ? (
            <div className="flex h-48 flex-col items-center justify-center px-6 text-center">
              <GitBranch size={22} className="mb-3 text-[var(--color-text-muted)]" />
              <p className="text-sm text-[var(--color-text-secondary)]">No executions found.</p>
              <p className="mt-1 text-xs text-[var(--color-text-muted)]">
                {statusFilter || search
                  ? 'Try clearing the filters.'
                  : 'Run this workflow to build up a history.'}
              </p>
            </div>
          ) : (
            executions.map((execution) => (
              <div
                key={execution.execution_id}
                className={cn(
                  'group rounded-xl border bg-[var(--color-bg-surface)] p-3 transition-colors',
                  selected.has(execution.execution_id)
                    ? 'border-indigo-400/50'
                    : 'border-[var(--color-border-subtle)] hover:border-indigo-500/40',
                )}
              >
                <div className="flex items-start gap-2.5">
                  {isActive(execution.status) && (
                    <input
                      type="checkbox"
                      checked={selected.has(execution.execution_id)}
                      onChange={() => toggle(execution.execution_id)}
                      className="mt-1 h-3 w-3 shrink-0 accent-indigo-500"
                      aria-label={`Select ${execution.execution_id}`}
                    />
                  )}

                  <button
                    onClick={() => { onSelectExecution(execution.execution_id); onClose(); }}
                    className="min-w-0 flex-1 text-left"
                  >
                    <div className="mb-1.5 flex items-center justify-between gap-2">
                      <span className="truncate font-mono text-[11px] text-[var(--color-text-secondary)]">
                        {execution.execution_id}
                      </span>
                      <ExecutionStatusBadge status={execution.status} size="sm" />
                    </div>

                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-[var(--color-text-muted)]">
                      <span>{formatTimestamp(execution.start_time)}</span>
                      <span className="font-mono tabular-nums">
                        {formatDuration(execution.total_duration_ms)}
                      </span>
                      <span className="flex items-center gap-1">
                        {execution.source === 'local' ? (
                          <><Cpu size={9} className="text-amber-400" /> local</>
                        ) : (
                          <><Server size={9} className="text-emerald-400" /> mistral</>
                        )}
                      </span>
                      <span className="ml-auto flex items-center gap-1 text-indigo-300 opacity-0 transition-opacity group-hover:opacity-100">
                        <Play size={9} /> Open
                      </span>
                    </div>
                  </button>
                </div>
              </div>
            ))
          )}
        </div>

        {data && !data.remote_available && (
          <p className="shrink-0 border-t border-[var(--color-border-subtle)] px-4 py-2 text-[10px] text-amber-300/80">
            Mistral is unreachable — showing local engine runs only.
          </p>
        )}
      </motion.div>
    </>
  );
}
