import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { RefreshCw } from "lucide-react";
import { executionsApi, errorMessage } from "@/api";
import { GlassPanel, GlassPanelHeader } from "@/components/glass/GlassPanel";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { TableSkeleton } from "@/components/ui/Skeletons";
import { StatusPill } from "@/components/ui/StatusPill";
import { Input } from "@/components/ui/input";
import { Link } from "@tanstack/react-router";
import { EXECUTION_STATUSES } from "@/types";
import { executionStatusIdentity, formatDuration, formatTimestamp } from "@/lib/status";

export function ExecutionsDashboard() {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [workflow, setWorkflow] = useState("");
  const [pageSize, setPageSize] = useState(50);
  const [cursor, setCursor] = useState<string | undefined>(undefined);
  const [history, setHistory] = useState<string[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const params = {
    search: search || undefined,
    status: status || undefined,
    workflow_identifier: workflow || undefined,
    page_size: pageSize,
    next_page_token: cursor,
  };

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["executions-dashboard", params],
    queryFn: () => executionsApi.list(params),
  });

  async function batch(action: "cancel" | "terminate") {
    const ids = Array.from(selected);
    if (ids.length === 0) return;
    try {
      if (action === "cancel") await executionsApi.cancelMany(ids);
      else await executionsApi.terminateMany(ids);
      toast.success(`${action === "cancel" ? "Cancelled" : "Terminated"} ${ids.length} execution(s)`);
      setSelected(new Set());
      refetch();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }

  return (
    <div className="space-y-4 px-6 py-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">Executions</h1>
          <p className="mt-1 text-sm text-muted-foreground">Fleet view of every run, local and remote.</p>
        </div>
        <button
          onClick={() => qc.invalidateQueries({ queryKey: ["executions-dashboard"] })}
          className="inline-flex items-center gap-1.5 rounded-lg border border-border glass px-3 py-1.5 text-xs font-medium text-foreground hover:bg-surface-hover"
        >
          <RefreshCw className="size-3.5" /> Refresh
        </button>
      </div>

      {data && data.remote_available === false ? (
        <p className="rounded-xl border border-amber/25 bg-amber/10 px-3 py-2 text-xs text-amber">
          Remote executions are unavailable — showing local runs only.
        </p>
      ) : null}

      <GlassPanel className="flex flex-wrap items-center gap-2 p-3">
        <Input
          placeholder="Search by workflow or execution id…"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setCursor(undefined);
            setHistory([]);
          }}
          className="max-w-xs"
        />
        <select
          value={status}
          onChange={(e) => {
            setStatus(e.target.value);
            setCursor(undefined);
            setHistory([]);
          }}
          className="h-9 rounded-lg border border-border bg-background-elevated px-2 text-xs text-foreground"
        >
          <option value="">All statuses</option>
          {EXECUTION_STATUSES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <Input
          placeholder="Workflow name"
          value={workflow}
          onChange={(e) => {
            setWorkflow(e.target.value);
            setCursor(undefined);
            setHistory([]);
          }}
          className="max-w-[160px]"
        />
        <select
          value={pageSize}
          onChange={(e) => setPageSize(Number(e.target.value))}
          className="h-9 rounded-lg border border-border bg-background-elevated px-2 text-xs text-foreground"
        >
          {[25, 50, 100].map((n) => (
            <option key={n} value={n}>
              {n} / page
            </option>
          ))}
        </select>
        <div className="ml-auto flex items-center gap-2">
          <button
            disabled={selected.size === 0}
            onClick={() => batch("cancel")}
            className="rounded-lg border border-amber/30 bg-amber/10 px-2.5 py-1.5 text-xs text-amber disabled:opacity-40"
          >
            Cancel selected
          </button>
          <button
            disabled={selected.size === 0}
            onClick={() => batch("terminate")}
            className="rounded-lg border border-red/30 bg-red/10 px-2.5 py-1.5 text-xs text-red disabled:opacity-40"
          >
            Terminate selected
          </button>
        </div>
      </GlassPanel>

      <GlassPanel>
        <GlassPanelHeader title="Runs" description={data ? `${data.count} shown` : undefined} />
        <div className="p-3">
          {isLoading ? (
            <TableSkeleton />
          ) : error ? (
            <ErrorState error={error} onRetry={() => refetch()} />
          ) : !data || data.executions.length === 0 ? (
            <EmptyState title="No executions match this view." />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="text-[11px] text-muted-foreground uppercase">
                    <th className="w-8 py-2"></th>
                    <th className="py-2">Execution</th>
                    <th className="py-2">Workflow</th>
                    <th className="py-2">Status</th>
                    <th className="py-2">Started</th>
                    <th className="py-2">Duration</th>
                    <th className="py-2">Runtime</th>
                  </tr>
                </thead>
                <tbody>
                  {data.executions.map((e) => {
                    const identity = executionStatusIdentity(e.status);
                    return (
                      <tr key={e.execution_id} className="border-t border-border">
                        <td className="py-2">
                          <input
                            type="checkbox"
                            checked={selected.has(e.execution_id)}
                            onChange={(ev) => {
                              setSelected((prev) => {
                                const next = new Set(prev);
                                if (ev.target.checked) next.add(e.execution_id);
                                else next.delete(e.execution_id);
                                return next;
                              });
                            }}
                          />
                        </td>
                        <td className="py-2 pr-2">
                          <Link
                            to="/workflows/$workflowName/execute"
                            params={{ workflowName: e.workflow_name }}
                            search={{ execId: e.execution_id }}
                            className="font-mono text-xs text-foreground hover:text-primary"
                          >
                            {e.execution_id.slice(0, 12)}…
                          </Link>
                        </td>
                        <td className="py-2 pr-2 text-xs text-foreground">{e.workflow_name}</td>
                        <td className="py-2 pr-2">
                          <StatusPill identity={identity} size="xs" />
                        </td>
                        <td className="py-2 pr-2 text-xs text-muted-foreground">{formatTimestamp(e.start_time)}</td>
                        <td className="py-2 pr-2 text-xs text-muted-foreground">{formatDuration(e.total_duration_ms)}</td>
                        <td className="py-2 pr-2 text-xs text-muted-foreground">{e.source}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          <div className="mt-3 flex items-center justify-end gap-2">
            <button
              disabled={history.length === 0}
              onClick={() => {
                const prev = [...history];
                const last = prev.pop();
                setHistory(prev);
                setCursor(last);
              }}
              className="rounded-lg border border-border px-2.5 py-1 text-xs text-foreground disabled:opacity-40"
            >
              Previous
            </button>
            <button
              disabled={!data?.next_page_token}
              onClick={() => {
                if (data?.next_page_token) {
                  setHistory((h) => [...h, cursor ?? ""]);
                  setCursor(data.next_page_token);
                }
              }}
              className="rounded-lg border border-border px-2.5 py-1 text-xs text-foreground disabled:opacity-40"
            >
              Next
            </button>
          </div>
        </div>
      </GlassPanel>
    </div>
  );
}
