import { AlertTriangle, CheckCircle2, MinusCircle, XCircle } from "lucide-react";
import type { CheckReport, CheckStatus } from "@/api/remoteServers";
import { timeAgo } from "./status";
import { cn } from "@/lib/utils";

const ICON: Record<CheckStatus, { icon: typeof CheckCircle2; className: string }> = {
  pass: { icon: CheckCircle2, className: "text-emerald" },
  warn: { icon: AlertTriangle, className: "text-amber" },
  fail: { icon: XCircle, className: "text-red" },
  skip: { icon: MinusCircle, className: "text-muted-foreground" },
};

const SYSTEM_FACTS: { key: string; label: string; format?: (v: string) => string }[] = [
  { key: "os", label: "OS" },
  { key: "kernel", label: "Kernel" },
  { key: "arch", label: "Architecture" },
  { key: "cpus", label: "CPUs" },
  { key: "mem_total_mb", label: "Memory", format: (v) => `${(Number(v) / 1024).toFixed(1)} GB` },
  { key: "disk_free_mb", label: "Free disk", format: (v) => `${(Number(v) / 1024).toFixed(1)} GB` },
  { key: "load", label: "Load average" },
  { key: "uptime", label: "Uptime" },
  { key: "python", label: "Python" },
  { key: "docker", label: "Docker" },
  { key: "compose", label: "Compose" },
  { key: "deploy_path", label: "Deploy directory" },
];

/** A diagnostics run: a summary line, then one row per check. */
export function CheckReportView({
  report,
  showHost = false,
}: {
  report: CheckReport;
  /** Also render the host facts SSH servers report. */
  showHost?: boolean;
}) {
  const counts = report.checks.reduce<Record<string, number>>((acc, c) => {
    acc[c.status] = (acc[c.status] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
        <span className="text-emerald">{counts["pass"] ?? 0} passed</span>
        <span className="text-amber">{counts["warn"] ?? 0} warnings</span>
        <span className="text-red">{counts["fail"] ?? 0} failed</span>
        {report.duration_ms != null ? <span>{report.duration_ms} ms</span> : null}
        {report.checked_at ? <span className="ml-auto">{timeAgo(report.checked_at)}</span> : null}
      </div>

      <ul className="divide-y divide-border/40 rounded-xl border border-border/60 bg-background-elevated/40">
        {report.checks.map((c) => {
          const { icon: Icon, className } = ICON[c.status] ?? ICON.skip;
          return (
            <li key={c.id} className="flex items-start gap-2.5 px-3 py-2">
              <Icon className={cn("mt-0.5 size-4 shrink-0", className)} />
              <div className="min-w-0 flex-1">
                <p className="text-xs font-medium text-foreground">{c.label}</p>
                {c.detail ? (
                  <p className="break-words text-[11px] text-muted-foreground">{c.detail}</p>
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>

      {showHost ? <HostFacts system={report.system} /> : null}
    </div>
  );
}

/** What an SSH diagnostics run learned about the host. Renders nothing for HTTP servers. */
export function HostFacts({ system }: { system: Record<string, string> | undefined }) {
  const facts = SYSTEM_FACTS.filter((f) => system?.[f.key]);
  if (!system || facts.length === 0) return null;
  return (
    <dl className="divide-y divide-border/40 text-xs">
      {facts.map((f) => (
        <div key={f.key} className="flex min-w-0 items-center gap-3 py-1.5">
          <dt className="w-28 shrink-0 text-muted-foreground">{f.label}</dt>
          <dd className="truncate font-mono text-[11px] text-foreground" title={system[f.key]}>
            {f.format ? f.format(system[f.key] ?? "") : system[f.key]}
          </dd>
        </div>
      ))}
    </dl>
  );
}
