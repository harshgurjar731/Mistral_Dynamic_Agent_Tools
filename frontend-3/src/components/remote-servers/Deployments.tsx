import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, ChevronRight, History } from "lucide-react";
import { QK } from "@/api";
import { remoteServersApi, type RemoteDeployment } from "@/api/remoteServers";
import { EmptyState } from "@/components/ui/EmptyState";
import { DeploymentStatusBadge, timeAgo } from "./status";
import { cn } from "@/lib/utils";

const ACTIVE = new Set(["queued", "running"]);

/** Live log of one deployment; polls while it is still running. */
export function DeploymentLog({
  deploymentId,
  className,
}: {
  deploymentId: number;
  className?: string;
}) {
  const { data } = useQuery({
    queryKey: QK.remoteDeployment(deploymentId),
    queryFn: () => remoteServersApi.deployment(deploymentId),
    refetchInterval: (q) => (!q.state.data || ACTIVE.has(q.state.data.status) ? 1500 : false),
  });
  const pre = useRef<HTMLPreElement>(null);
  useEffect(() => {
    if (pre.current) pre.current.scrollTop = pre.current.scrollHeight;
  }, [data?.log]);

  return (
    <div className={cn("space-y-2", className)}>
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        {data ? <DeploymentStatusBadge status={data.status} /> : null}
        <span className="font-mono">#{deploymentId}</span>
        {data?.error ? <span className="truncate text-red">{data.error}</span> : null}
      </div>
      <pre
        ref={pre}
        className="max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-lg border border-border/60 bg-black/40 p-3 font-mono text-[11px] leading-relaxed text-foreground/90"
      >
        {data?.log?.trim() || "Waiting for output…"}
      </pre>
    </div>
  );
}

/** A list of deployments, each expandable to its log. */
export function DeploymentHistory({
  deployments,
  showServer,
  showTarget = true,
  emptyTitle = "No deployments yet",
}: {
  deployments: RemoteDeployment[] | undefined;
  showServer?: boolean;
  showTarget?: boolean;
  emptyTitle?: string;
}) {
  const [open, setOpen] = useState<number | null>(null);
  if (!deployments || deployments.length === 0) {
    return <EmptyState icon={<History className="size-6" />} title={emptyTitle} className="py-8" />;
  }
  return (
    <ul className="divide-y divide-border/40 rounded-xl border border-border/60">
      {deployments.map((d) => {
        const expanded = open === d.id;
        return (
          <li key={d.id}>
            <button
              type="button"
              onClick={() => setOpen(expanded ? null : d.id)}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs transition hover:bg-surface-hover"
            >
              {expanded ? (
                <ChevronDown className="size-3.5 text-muted-foreground" />
              ) : (
                <ChevronRight className="size-3.5 text-muted-foreground" />
              )}
              <DeploymentStatusBadge status={d.status} />
              <span className="rounded border border-border/60 px-1 font-mono text-[10px] text-muted-foreground">
                {d.kind}
              </span>
              {showTarget ? (
                <span className="truncate font-medium text-foreground">{d.target}</span>
              ) : null}
              {showServer && d.server_name ? (
                <span className="truncate text-muted-foreground">→ {d.server_name}</span>
              ) : null}
              {typeof d.options?.["action"] === "string" ? (
                <span className="hidden text-muted-foreground sm:inline">
                  · {String(d.options["action"])}
                </span>
              ) : null}
              <span className="ml-auto shrink-0 text-muted-foreground">
                {timeAgo(d.created_at)}
              </span>
            </button>
            {expanded ? <DeploymentLog deploymentId={d.id} className="px-3 pb-3" /> : null}
          </li>
        );
      })}
    </ul>
  );
}
