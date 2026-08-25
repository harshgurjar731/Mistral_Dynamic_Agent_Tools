import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { X } from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Input } from "@/components/ui/input";
import { EmptyState } from "@/components/ui/EmptyState";
import { TableSkeleton } from "@/components/ui/Skeletons";
import { StatusPill } from "@/components/ui/StatusPill";
import { executionsApi, workflowsApi, errorMessage } from "@/api";
import { executionStatusIdentity, formatDuration, formatTimestamp } from "@/lib/status";
import { Link } from "@tanstack/react-router";

export function WorkflowHistoryPanel({
  workflowName,
  open,
  onOpenChange,
}: {
  workflowName: string | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const metrics = useQuery({
    queryKey: ["workflow-metrics", workflowName],
    queryFn: () => workflowsApi.metrics(workflowName as string),
    enabled: open && !!workflowName,
  });

  const executions = useQuery({
    queryKey: ["workflow-executions-panel", workflowName],
    queryFn: () => executionsApi.list({ workflow_identifier: workflowName }),
    enabled: open && !!workflowName,
  });

  const list = useMemo(
    () => (executions.data?.executions ?? []).filter((e) => e.execution_id.includes(search) || e.workflow_name.includes(search)),
    [executions.data, search],
  );

  async function batch(action: "cancel" | "terminate") {
    const ids = Array.from(selected);
    if (ids.length === 0) return;
    try {
      if (action === "cancel") await executionsApi.cancelMany(ids);
      else await executionsApi.terminateMany(ids);
      toast.success(`${action === "cancel" ? "Cancelled" : "Terminated"} ${ids.length} execution(s)`);
      setSelected(new Set());
      executions.refetch();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }

  const m = metrics.data;
  const tiles = [
    { label: "Runs", value: m?.available === false ? "—" : (m?.execution_count ?? "—") },
    { label: "OK", value: m?.available === false ? "—" : (m?.success_count ?? "—") },
    { label: "Errors", value: m?.available === false ? "—" : (m?.error_count ?? "—") },
    { label: "Avg", value: m?.available === false ? "—" : formatDuration(m?.average_latency_ms ?? null) },
  ];

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full overflow-y-auto custom-scrollbar sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>Execution history</SheetTitle>
        </SheetHeader>
        <div className="mt-4 space-y-4">
          <Input placeholder="Search executions…" value={search} onChange={(e) => setSearch(e.target.value)} />

          <div className="grid grid-cols-4 gap-2" title={m?.available === false ? m?.detail : undefined}>
            {tiles.map((t) => (
              <div key={t.label} className="rounded-xl border border-border bg-background-elevated/60 p-2.5 text-center">
                <p className="text-lg font-semibold text-foreground">{t.value}</p>
                <p className="text-[10px] text-muted-foreground uppercase">{t.label}</p>
              </div>
            ))}
          </div>

          <div className="flex items-center gap-2">
            <button
              disabled={selected.size === 0}
              onClick={() => batch("cancel")}
              className="rounded-lg border border-amber/30 bg-amber/10 px-2.5 py-1 text-xs text-amber disabled:opacity-40"
            >
              Cancel selected
            </button>
            <button
              disabled={selected.size === 0}
              onClick={() => batch("terminate")}
              className="rounded-lg border border-red/30 bg-red/10 px-2.5 py-1 text-xs text-red disabled:opacity-40"
            >
              Terminate selected
            </button>
          </div>

          {executions.isLoading ? (
            <TableSkeleton rows={5} />
          ) : list.length === 0 ? (
            <EmptyState title="No executions found." />
          ) : (
            <ul className="space-y-2">
              {list.map((e) => {
                const identity = executionStatusIdentity(e.status);
                return (
                  <li key={e.execution_id} className="flex items-center gap-2 rounded-xl border border-border bg-background-elevated/60 p-2.5">
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
                    <div className="min-w-0 flex-1">
                      <Link
                        to="/workflows/$workflowName/execute"
                        params={{ workflowName: e.workflow_name }}
                        search={{ execId: e.execution_id }}
                        className="block truncate text-xs font-medium text-foreground hover:text-primary"
                      >
                        {e.execution_id}
                      </Link>
                      <p className="text-[10px] text-muted-foreground">{formatTimestamp(e.start_time)}</p>
                    </div>
                    <StatusPill identity={identity} size="xs" />
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
