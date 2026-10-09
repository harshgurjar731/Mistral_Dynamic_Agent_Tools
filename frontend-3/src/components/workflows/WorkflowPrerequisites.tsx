/**
 * What must be in place before a workflow can run, with how to fix each item.
 *
 * The backend refuses to start a run while anything blocking is unmet, so the
 * run controls use `useWorkflowPrerequisites` to stay disabled until `ready`.
 * The report is re-checked when the window regains focus — a user who left to
 * connect a connector or upload documents comes back to an up-to-date list.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  ChevronDown,
  Info,
  Loader2,
  RefreshCw,
  ShieldCheck,
  XCircle,
} from "lucide-react";
import { errorMessage, QK, toolsApi, workflowsApi } from "@/api";
import type { Prerequisite, PrerequisiteReport } from "@/types";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function useWorkflowPrerequisites(workflowName: string | null | undefined) {
  return useQuery({
    queryKey: QK.workflowPrerequisites(workflowName ?? ""),
    queryFn: () => workflowsApi.prerequisites(workflowName ?? ""),
    enabled: Boolean(workflowName),
    refetchOnWindowFocus: true,
    staleTime: 5_000,
  });
}

const STATUS = {
  unmet: { icon: XCircle, cls: "text-destructive", label: "Required" },
  warning: { icon: AlertTriangle, cls: "text-amber", label: "Recommended" },
  info: { icon: Info, cls: "text-primary", label: "Note" },
  met: { icon: CheckCircle2, cls: "text-emerald", label: "Done" },
} as const;

const ORDER: Prerequisite["status"][] = ["unmet", "warning", "info", "met"];

export function WorkflowPrerequisites({
  workflowName,
  className,
}: {
  workflowName: string;
  className?: string;
}) {
  const query = useWorkflowPrerequisites(workflowName);
  const [showMet, setShowMet] = useState(false);
  const report = query.data;

  if (query.isLoading) {
    return (
      <div className={cn("rounded-2xl border border-border/60 p-4 text-xs", className)}>
        <Loader2 className="mr-2 inline size-3.5 animate-spin" />
        Checking what this workflow needs before it can run…
      </div>
    );
  }
  if (query.isError || !report) {
    return (
      <div className={cn("rounded-2xl border border-destructive/30 p-4 text-xs", className)}>
        <p className="text-destructive">
          Could not check the prerequisites: {errorMessage(query.error)}
        </p>
        <Button size="sm" variant="outline" className="mt-2" onClick={() => void query.refetch()}>
          <RefreshCw className="size-3" /> Try again
        </Button>
      </div>
    );
  }

  const sorted = [...report.items].sort(
    (a, b) => ORDER.indexOf(a.status) - ORDER.indexOf(b.status),
  );
  const open = sorted.filter((i) => i.status !== "met");
  const met = sorted.filter((i) => i.status === "met");

  return (
    <div
      className={cn(
        "rounded-2xl border p-5",
        report.ready ? "border-emerald/30 bg-emerald/5" : "border-destructive/30 bg-destructive/5",
        className,
      )}
    >
      <div className="flex flex-wrap items-center gap-2">
        <ShieldCheck className={cn("size-4", report.ready ? "text-emerald" : "text-destructive")} />
        <p className="text-sm font-semibold text-foreground">
          {report.ready
            ? "Ready to run"
            : `${report.blocking_count} prerequisite${report.blocking_count === 1 ? "" : "s"} to complete before running`}
        </p>
        <Button
          size="sm"
          variant="ghost"
          className="ml-auto h-7 gap-1 text-[11px]"
          disabled={query.isFetching}
          onClick={() => void query.refetch()}
        >
          <RefreshCw className={cn("size-3", query.isFetching && "animate-spin")} />
          Check again
        </Button>
      </div>
      <p className="mt-1 text-[11px] text-muted-foreground">
        {report.ready
          ? report.warning_count
            ? `The run can start. ${report.warning_count} recommendation(s) below may affect the result.`
            : "Everything this workflow depends on is in place."
          : "The workflow will not start until every required item is done. Follow the steps on each one, then check again."}
      </p>

      <ol className="mt-4 space-y-2.5">
        {open.map((item, n) => (
          <PrerequisiteRow
            key={item.id}
            item={item}
            index={item.blocking ? n + 1 : null}
            report={report}
          />
        ))}
      </ol>

      {met.length > 0 ? (
        <div className="mt-3">
          <button
            type="button"
            onClick={() => setShowMet((v) => !v)}
            className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
          >
            <ChevronDown className={cn("size-3 transition", showMet && "rotate-180")} />
            {met.length} already in place
          </button>
          {showMet ? (
            <ol className="mt-2 space-y-1.5">
              {met.map((item) => (
                <PrerequisiteRow key={item.id} item={item} index={null} report={report} />
              ))}
            </ol>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function PrerequisiteRow({
  item,
  index,
  report,
}: {
  item: Prerequisite;
  index: number | null;
  report: PrerequisiteReport;
}) {
  const meta = STATUS[item.status];
  const Icon = meta.icon;
  const compact = item.status === "met";
  return (
    <li
      className={cn(
        "rounded-xl border bg-background-elevated/50 px-3 py-2.5 text-xs",
        item.blocking ? "border-destructive/30" : "border-border",
      )}
    >
      <div className="flex items-start gap-2">
        <Icon className={cn("mt-0.5 size-3.5 shrink-0", meta.cls)} />
        <div className="min-w-0 flex-1">
          <p className="font-medium text-foreground">
            {index != null ? <span className="mr-1 text-muted-foreground">{index}.</span> : null}
            {item.title}
            {!compact ? (
              <span className={cn("ml-2 text-[9px] tracking-wider uppercase", meta.cls)}>
                {meta.label}
              </span>
            ) : null}
          </p>
          {item.detail ? (
            <p className="mt-0.5 text-[11px] text-muted-foreground">{item.detail}</p>
          ) : null}
          {!compact && item.instructions.length > 0 ? (
            <ol className="mt-1.5 list-decimal space-y-0.5 pl-4 text-[11px] text-foreground/80">
              {item.instructions.map((line, i) => (
                <li key={i}>{line}</li>
              ))}
            </ol>
          ) : null}
        </div>
        {item.action ? <PrerequisiteAction item={item} report={report} /> : null}
      </div>
    </li>
  );
}

function PrerequisiteAction({ item, report }: { item: Prerequisite; report: PrerequisiteReport }) {
  const qc = useQueryClient();
  const action = item.action;
  const refresh = () =>
    qc.invalidateQueries({ queryKey: QK.workflowPrerequisites(report.workflow_name) });

  const run = useMutation({
    mutationFn: async () => {
      if (action?.type === "rebuild") {
        const r = await workflowsApi.rebuildActivity(report.workflow_name, action.step_id);
        if (!r.saved) {
          throw new Error(
            `${r.rolled_back ? "Built broken and rolled back" : "Could not be built"}: ${r.message}`,
          );
        }
        return `Built '${r.tool_name}'`;
      }
      if (action?.type === "approve") {
        await toolsApi.approve(action.tool_id);
        return "Approved";
      }
      return "";
    },
    onSuccess: (msg) => {
      if (msg) toast.success(msg);
      void refresh();
      void qc.invalidateQueries({ queryKey: QK.workflow(report.workflow_name) });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  if (!action) return null;
  if (action.type === "link") {
    return (
      <Button asChild size="sm" variant="outline" className="h-7 shrink-0 gap-1 text-[11px]">
        <Link to={action.to as never}>
          {action.label} <ArrowRight className="size-3" />
        </Link>
      </Button>
    );
  }
  return (
    <div className="flex shrink-0 flex-col items-end gap-1">
      <Button
        size="sm"
        variant={item.blocking ? "default" : "outline"}
        className="h-7 gap-1 text-[11px]"
        disabled={run.isPending}
        onClick={() => run.mutate()}
      >
        {run.isPending ? <Loader2 className="size-3 animate-spin" /> : null}
        {run.isPending
          ? action.type === "rebuild"
            ? "Building and testing…"
            : "Approving…"
          : action.label}
      </Button>
      {action.type === "approve" && action.to ? (
        <Link
          to={action.to as never}
          className="text-[10px] text-muted-foreground underline hover:text-foreground"
        >
          Review it first
        </Link>
      ) : null}
    </div>
  );
}
