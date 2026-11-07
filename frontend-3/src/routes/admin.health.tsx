import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import {
  Activity,
  AlertTriangle,
  Box,
  Brain,
  CheckCircle2,
  Cpu,
  Database,
  KeyRound,
  ListTree,
  Network,
  RefreshCw,
  ScrollText,
  Server,
  ShieldCheck,
  XCircle,
  type LucideIcon,
} from "lucide-react";
import { useState } from "react";
import {
  adminApi,
  authKeys,
  type ComponentState,
  type HealthComponent,
  type SystemVerdict,
} from "@/api/auth";
import { AdminPage, KeyStatusBadge, PageHeader, Panel } from "@/components/admin/parts";
import { Button } from "@/components/ui/button";
import { ErrorState } from "@/components/ui/ErrorState";
import { Skeleton } from "@/components/ui/skeleton";
import { formatRelative } from "@/lib/status";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/admin/health")({
  head: () => ({ meta: [{ title: "System health — Admin console" }] }),
  component: AdminHealthPage,
});

const ICONS: Record<string, LucideIcon> = {
  api: Server,
  database: Database,
  mistral: Brain,
  tool_service: Box,
  knowledge_graph: Network,
  vault: ShieldCheck,
  observability: ScrollText,
  model_catalog: ListTree,
  workspace_keys: KeyRound,
  workers: Cpu,
};

const STATE: Record<ComponentState, { label: string; tone: string; dot: string }> = {
  ok: { label: "Healthy", tone: "text-emerald", dot: "bg-emerald" },
  degraded: { label: "Degraded", tone: "text-amber", dot: "bg-amber" },
  down: { label: "Down", tone: "text-red", dot: "bg-red" },
  off: { label: "Off", tone: "text-muted-foreground", dot: "bg-muted-foreground" },
};

const VERDICT: Record<SystemVerdict, { tone: string; icon: LucideIcon }> = {
  operational: { tone: "border-emerald/30 bg-emerald/10 text-emerald", icon: CheckCircle2 },
  degraded: { tone: "border-amber/30 bg-amber/10 text-amber", icon: AlertTriangle },
  outage: { tone: "border-red/30 bg-red/10 text-red", icon: XCircle },
};

function uptime(seconds: number): string {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return d ? `${d}d ${h}h` : h ? `${h}h ${m}m` : `${m}m`;
}

function formatDetail(key: string, value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  if (key === "uptime_seconds" && typeof value === "number") return uptime(value);
  if ((key === "fetched_at" || key === "supervisor_updated_at") && typeof value === "number")
    return formatRelative(new Date(value * 1000).toISOString());
  if (typeof value === "boolean") return value ? "yes" : "no";
  if (Array.isArray(value)) return value.length ? value.join(", ") : "—";
  return String(value);
}

function AdminHealthPage() {
  const qc = useQueryClient();
  const [refreshing, setRefreshing] = useState(false);
  const q = useQuery({
    queryKey: authKeys.admin.health(),
    queryFn: () => adminApi.health(),
    refetchInterval: 30_000,
  });
  const d = q.data;

  async function refresh() {
    setRefreshing(true);
    try {
      qc.setQueryData(authKeys.admin.health(), await adminApi.health(true));
    } finally {
      setRefreshing(false);
    }
  }

  const problems = d?.components.filter((c) => c.state === "down" || c.state === "degraded") ?? [];

  return (
    <AdminPage>
      <PageHeader
        title="System health"
        description="Every part of the platform, checked live. Users see a plain-language version of this on their Status page."
        actions={
          <Button variant="outline" onClick={() => void refresh()} disabled={refreshing}>
            <RefreshCw className={cn(refreshing && "animate-spin")} /> Re-check now
          </Button>
        }
      />

      {q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : null}
      {q.isLoading ? <Skeleton className="h-24 rounded-lg" /> : null}

      {d ? (
        <>
          <div
            className={cn("flex items-start gap-4 rounded-lg border p-5", VERDICT[d.status].tone)}
          >
            {(() => {
              const Icon = VERDICT[d.status].icon;
              return <Icon className="mt-0.5 size-6 shrink-0" />;
            })()}
            <div className="min-w-0 flex-1">
              <p className="text-base font-semibold">{d.headline}</p>
              <p className="mt-1 text-sm text-foreground/80">
                {problems.length
                  ? `${problems.length} component${problems.length === 1 ? "" : "s"} need attention: ${problems.map((p) => p.name).join(", ")}.`
                  : "Nothing needs attention."}
              </p>
            </div>
            <p className="shrink-0 text-xs text-muted-foreground">
              {d.environment} · checked {new Date(d.checked_at * 1000).toLocaleTimeString()}
            </p>
          </div>

          <div className="mt-6 grid gap-4 md:grid-cols-2">
            {[...d.components]
              .sort((a, b) => rank(a) - rank(b))
              .map((c) => (
                <ComponentCard key={c.key} c={c} />
              ))}
          </div>

          <Panel
            className="mt-6"
            title="Workspaces"
            description="Each workspace's Mistral key, as Mistral last answered, and its workflow worker."
            bodyClassName="p-0"
          >
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                    <th className="px-5 py-2.5 font-medium">Workspace</th>
                    <th className="px-3 py-2.5 font-medium">Mistral key</th>
                    <th className="px-3 py-2.5 font-medium">Worker</th>
                    <th className="px-3 py-2.5 font-medium">Task queue</th>
                    <th className="px-5 py-2.5 text-right font-medium">Members</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {d.workspaces.map((w) => (
                    <tr key={w.id} className={cn(w.disabled && "opacity-60")}>
                      <td className="px-5 py-3">
                        <Link
                          to="/admin/workspaces/$id"
                          params={{ id: w.id }}
                          className="font-medium text-foreground hover:text-primary"
                        >
                          {w.name}
                        </Link>
                        {w.disabled ? (
                          <span className="ml-2 text-xs text-muted-foreground">disabled</span>
                        ) : null}
                      </td>
                      <td className="px-3 py-3">
                        <KeyStatusBadge status={w.key_status} />
                        <span className="ml-2 text-xs text-muted-foreground">
                          {formatRelative(w.key_checked_at)}
                        </span>
                      </td>
                      <td className="px-3 py-3 text-xs">
                        <span
                          className={cn(
                            w.worker.state === "running"
                              ? "text-emerald"
                              : w.worker.state === "idle"
                                ? "text-muted-foreground"
                                : "text-red",
                          )}
                        >
                          {w.worker.state === "idle" ? "idle (nothing published)" : w.worker.state}
                        </span>
                        {w.worker.published_workflows ? (
                          <span className="text-muted-foreground">
                            {" "}
                            · {w.worker.published_workflows} workflow
                            {w.worker.published_workflows === 1 ? "" : "s"}
                          </span>
                        ) : null}
                        {w.worker.last_error ? (
                          <p className="mt-0.5 text-red">{w.worker.last_error}</p>
                        ) : null}
                      </td>
                      <td className="px-3 py-3 font-mono text-xs text-muted-foreground">
                        {w.worker.deployment}
                      </td>
                      <td className="px-5 py-3 text-right text-muted-foreground">{w.members}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>
        </>
      ) : null}
    </AdminPage>
  );
}

function rank(c: HealthComponent): number {
  const state = { down: 0, degraded: 1, ok: 2, off: 3 }[c.state];
  const sev = { critical: 0, major: 1, minor: 2 }[c.severity];
  return state * 10 + sev;
}

function ComponentCard({ c }: { c: HealthComponent }) {
  const Icon = ICONS[c.key] ?? Activity;
  const s = STATE[c.state];
  const details = Object.entries(c.details ?? {}).filter(([, v]) => v !== null && v !== undefined);
  return (
    <div
      className={cn(
        "glass rounded-lg p-5",
        c.state === "down" && "border-red/30",
        c.state === "degraded" && "border-amber/30",
      )}
    >
      <div className="flex items-start gap-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-md border border-border bg-secondary">
          <Icon className="size-4 text-muted-foreground" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-semibold text-foreground">{c.name}</p>
            <span className="rounded-full border border-border px-1.5 py-px text-[10px] uppercase tracking-wide text-muted-foreground">
              {c.severity}
            </span>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">{c.message}</p>
        </div>
        <span className={cn("flex shrink-0 items-center gap-1.5 text-xs font-medium", s.tone)}>
          <span className={cn("size-2 rounded-full", s.dot, c.state === "ok" && "animate-pulse")} />
          {s.label}
        </span>
      </div>
      {c.impact && c.state !== "ok" ? (
        <p className="mt-3 rounded-md border border-border bg-background-elevated px-3 py-2 text-xs text-foreground">
          <span className="font-medium">Impact: </span>
          {c.impact}
        </p>
      ) : null}
      {details.length || c.latency_ms !== null ? (
        <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5 border-t border-border pt-3 text-xs">
          {c.latency_ms !== null ? (
            <>
              <dt className="text-muted-foreground">Response time</dt>
              <dd className="text-right font-mono text-foreground">{c.latency_ms} ms</dd>
            </>
          ) : null}
          {details.map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="text-muted-foreground">{k.replace(/_/g, " ")}</dt>
              <dd
                className="min-w-0 truncate text-right font-mono text-foreground"
                title={String(v)}
              >
                {formatDetail(k, v)}
              </dd>
            </div>
          ))}
        </dl>
      ) : null}
    </div>
  );
}
