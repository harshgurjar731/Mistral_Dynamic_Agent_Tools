import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Activity, Ban, ChevronRight, Cpu, Loader2, OctagonX, RefreshCw,
  Search, Server, WifiOff,
} from 'lucide-react';
import {
  EXECUTION_STATUSES, executionsApi, formatDuration, formatTimestamp,
  isActive, type ExecutionSummary,
} from '../../api/executions';
import ExecutionStatusBadge from './execution/ExecutionStatusBadge';
import { cn } from '../../lib/utils';

/**
 * Fleet view of every workflow execution.
 *
 * The per-workflow history panel answers "how has this workflow been doing";
 * this answers "what is happening right now, anywhere" — which is the view you
 * want when something is wrong and you do not yet know which workflow owns it.
 */

function SummaryTile({
  label, value, tone, icon: Icon,
}: {
  label: string;
  value: string | number;
  tone?: string;
  icon: typeof Activity;
}) {
  return (
    <div className="rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] p-4">
      <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--color-text-muted)]">
        <Icon size={11} />
        {label}
      </div>
      <div className={cn('mt-1.5 font-mono text-2xl tabular-nums', tone ?? 'text-white')}>
        {value}
      </div>
    </div>
  );
}

export default function ExecutionsDashboard() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [statusFilter, setStatusFilter] = useState('');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [pageTokens, setPageTokens] = useState<string[]>([]);

  const currentToken = pageTokens[pageTokens.length - 1];

  const { data, isLoading, isFetching, refetch } = useQuery({
    queryKey: ['executions', 'all', statusFilter, search, currentToken ?? ''],
    queryFn: () =>
      executionsApi
        .list({
          status: statusFilter || undefined,
          search: search.trim() || undefined,
          page_size: 50,
          next_page_token: currentToken,
        })
        .then((r) => r.data),
    refetchInterval: 8000,
  });

  const executions = useMemo<ExecutionSummary[]>(() => data?.executions ?? [], [data]);

  const counts = useMemo(() => {
    const running = executions.filter((e) => isActive(e.status)).length;
    const completed = executions.filter((e) => e.status === 'COMPLETED').length;
    const failed = executions.filter((e) =>
      ['FAILED', 'TIMED_OUT', 'TERMINATED'].includes(e.status),
    ).length;
    return { running, completed, failed, total: executions.length };
  }, [executions]);

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

  const openExecution = (execution: ExecutionSummary) => {
    if (!execution.workflow_name) return;
    navigate(
      `/workflows/${execution.workflow_name}/execute?execId=${encodeURIComponent(execution.execution_id)}`,
    );
  };

  const resetPaging = () => setPageTokens([]);

  return (
    <div className="flex h-full flex-col overflow-hidden bg-[var(--color-bg-base)] text-white">
      <header className="shrink-0 border-b border-[var(--color-border-subtle)] px-6 py-5">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold">Executions</h1>
            <p className="mt-0.5 text-xs text-[var(--color-text-muted)]">
              Every workflow run, live from Mistral and the local engine.
            </p>
          </div>
          <button
            onClick={() => refetch()}
            className="flex items-center gap-1.5 rounded-xl border border-[var(--color-border-subtle)] px-3 py-2 text-xs font-semibold text-[var(--color-text-secondary)] transition-colors hover:border-indigo-400/40 hover:text-white"
          >
            <RefreshCw size={13} className={isFetching ? 'animate-spin' : undefined} />
            Refresh
          </button>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <SummaryTile label="In flight" value={counts.running} tone="text-amber-300" icon={Activity} />
          <SummaryTile label="Completed" value={counts.completed} tone="text-emerald-300" icon={Activity} />
          <SummaryTile label="Failed" value={counts.failed} tone="text-red-300" icon={Activity} />
          <SummaryTile label="Listed" value={counts.total} icon={Activity} />
        </div>
      </header>

      {/* Filters */}
      <div className="shrink-0 space-y-2.5 border-b border-[var(--color-border-subtle)] px-6 py-3">
        <div className="relative max-w-md">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)]" />
          <input
            value={search}
            onChange={(e) => { setSearch(e.target.value); resetPaging(); }}
            placeholder="Search by workflow or execution id…"
            className="w-full rounded-lg border border-[var(--color-border-subtle)] bg-black/25 py-2 pl-8 pr-3 text-xs text-white placeholder:text-[var(--color-text-muted)] focus:border-indigo-500/50 focus:outline-none"
          />
        </div>
        <div className="flex flex-wrap gap-1.5">
          {['', ...EXECUTION_STATUSES].map((value) => (
            <button
              key={value || 'all'}
              onClick={() => { setStatusFilter(value); resetPaging(); }}
              className={cn(
                'rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider transition-colors',
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

      {activeSelected.length > 0 && (
        <div className="flex shrink-0 items-center gap-2 border-b border-[var(--color-border-subtle)] bg-indigo-500/10 px-6 py-2">
          <span className="flex-1 text-xs text-indigo-200">
            {activeSelected.length} in-flight execution{activeSelected.length > 1 ? 's' : ''} selected
          </span>
          <button
            onClick={() => batchMut.mutate('cancel')}
            disabled={batchMut.isPending}
            className="flex items-center gap-1.5 rounded-lg border border-[var(--color-border-subtle)] px-2.5 py-1.5 text-[11px] font-semibold text-[var(--color-text-secondary)] hover:border-amber-400/40 hover:text-amber-300 disabled:opacity-40"
          >
            <Ban size={11} /> Cancel all
          </button>
          <button
            onClick={() => batchMut.mutate('terminate')}
            disabled={batchMut.isPending}
            className="flex items-center gap-1.5 rounded-lg border border-[var(--color-border-subtle)] px-2.5 py-1.5 text-[11px] font-semibold text-[var(--color-text-secondary)] hover:border-red-400/40 hover:text-red-300 disabled:opacity-40"
          >
            <OctagonX size={11} /> Terminate all
          </button>
        </div>
      )}

      {/* Table */}
      <div className="flex-1 overflow-y-auto px-6 py-4 custom-scrollbar">
        {isLoading ? (
          <div className="flex h-40 items-center justify-center">
            <Loader2 size={24} className="animate-spin text-[var(--color-text-muted)]" />
          </div>
        ) : executions.length === 0 ? (
          <div className="flex h-56 flex-col items-center justify-center text-center">
            <Activity size={24} className="mb-3 text-[var(--color-text-muted)] opacity-40" />
            <p className="text-sm text-[var(--color-text-secondary)]">No executions match this view.</p>
            <p className="mt-1 text-xs text-[var(--color-text-muted)]">
              {statusFilter || search ? 'Try clearing the filters.' : 'Run a workflow to see it here.'}
            </p>
          </div>
        ) : (
          <div className="overflow-hidden rounded-xl border border-[var(--color-border-subtle)]">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-[var(--color-border-subtle)] bg-black/30 text-[10px] uppercase tracking-wider text-[var(--color-text-muted)]">
                <tr>
                  <th className="w-8 px-3 py-2.5" />
                  <th className="px-3 py-2.5">Workflow</th>
                  <th className="px-3 py-2.5">Execution</th>
                  <th className="px-3 py-2.5">Status</th>
                  <th className="px-3 py-2.5">Started</th>
                  <th className="px-3 py-2.5">Duration</th>
                  <th className="px-3 py-2.5">Runtime</th>
                  <th className="w-8 px-3 py-2.5" />
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--color-border-subtle)]">
                {executions.map((execution) => (
                  <tr
                    key={execution.execution_id}
                    className="group cursor-pointer bg-[var(--color-bg-surface)] transition-colors hover:bg-white/[0.03]"
                    onClick={() => openExecution(execution)}
                  >
                    <td className="px-3 py-2.5" onClick={(e) => e.stopPropagation()}>
                      {isActive(execution.status) && (
                        <input
                          type="checkbox"
                          checked={selected.has(execution.execution_id)}
                          onChange={() => toggle(execution.execution_id)}
                          className="h-3 w-3 accent-indigo-500"
                          aria-label={`Select ${execution.execution_id}`}
                        />
                      )}
                    </td>
                    <td className="max-w-[200px] truncate px-3 py-2.5 font-medium capitalize text-white">
                      {execution.workflow_name?.replace(/_/g, ' ') || '—'}
                    </td>
                    <td className="max-w-[180px] truncate px-3 py-2.5 font-mono text-[10px] text-[var(--color-text-muted)]">
                      {execution.execution_id}
                    </td>
                    <td className="px-3 py-2.5">
                      <ExecutionStatusBadge status={execution.status} size="sm" />
                    </td>
                    <td className="whitespace-nowrap px-3 py-2.5 text-[var(--color-text-secondary)]">
                      {formatTimestamp(execution.start_time)}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2.5 font-mono tabular-nums text-[var(--color-text-secondary)]">
                      {formatDuration(execution.total_duration_ms)}
                    </td>
                    <td className="px-3 py-2.5">
                      <span className="flex items-center gap-1 text-[10px] text-[var(--color-text-muted)]">
                        {execution.source === 'local' ? (
                          <><Cpu size={10} className="text-amber-400" /> local</>
                        ) : (
                          <><Server size={10} className="text-emerald-400" /> mistral</>
                        )}
                      </span>
                    </td>
                    <td className="px-3 py-2.5">
                      <ChevronRight
                        size={13}
                        className="text-[var(--color-text-muted)] opacity-0 transition-opacity group-hover:opacity-100"
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Paging — the API is cursor-based, so back is a token stack, not an offset. */}
        {(pageTokens.length > 0 || data?.next_page_token) && (
          <div className="mt-4 flex items-center justify-between">
            <button
              onClick={() => setPageTokens((prev) => prev.slice(0, -1))}
              disabled={pageTokens.length === 0}
              className="rounded-lg border border-[var(--color-border-subtle)] px-3 py-1.5 text-[11px] font-semibold text-[var(--color-text-secondary)] hover:text-white disabled:opacity-30"
            >
              Previous
            </button>
            <span className="text-[10px] text-[var(--color-text-muted)]">
              Page {pageTokens.length + 1}
            </span>
            <button
              onClick={() =>
                data?.next_page_token && setPageTokens((prev) => [...prev, data.next_page_token!])
              }
              disabled={!data?.next_page_token}
              className="rounded-lg border border-[var(--color-border-subtle)] px-3 py-1.5 text-[11px] font-semibold text-[var(--color-text-secondary)] hover:text-white disabled:opacity-30"
            >
              Next
            </button>
          </div>
        )}
      </div>

      {data && !data.remote_available && (
        <p className="flex shrink-0 items-center gap-1.5 border-t border-[var(--color-border-subtle)] px-6 py-2 text-[11px] text-amber-300/80">
          <WifiOff size={11} />
          Mistral is unreachable — showing local engine runs only.
        </p>
      )}
    </div>
  );
}
