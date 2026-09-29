import { Link } from "@tanstack/react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowUpRight, Globe, Loader2, Plus, RefreshCw, Terminal, Trash2 } from "lucide-react";
import { errorMessage, QK } from "@/api";
import { remoteServersApi, type RemoteServer, type ServerPurpose } from "@/api/remoteServers";
import {
  PurposeBadge,
  STATE_TONE,
  ServerStatusBadge,
  providerIconFor,
  timeAgo,
  type ServerState,
} from "./status";
import { cn } from "@/lib/utils";

/** Strip the scheme so the address reads cleanly on one line. */
function shortAddress(url: string): string {
  return url.replace(/^(https?|ssh):\/\//, "").replace(/\/$/, "");
}

/** One remote server on the Remote Servers page — click to open it. */
export function ServerCard({ server }: { server: RemoteServer }) {
  const qc = useQueryClient();
  const invalidate = () => qc.invalidateQueries({ queryKey: QK.remoteServers() });

  const check = useMutation({
    mutationFn: () => remoteServersApi.check(server.id),
    onSuccess: (r) => {
      const failed = r.checks.filter((c) => c.status === "fail").length;
      if (r.status === "healthy") toast.success(`${server.name} is healthy.`);
      else
        toast.warning(`${server.name}: ${r.status}${failed ? ` (${failed} failed checks)` : ""}.`);
      invalidate();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const remove = useMutation({
    mutationFn: () => remoteServersApi.remove(server.id),
    onSuccess: () => {
      toast.success(`Removed "${server.name}".`);
      invalidate();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const Icon = providerIconFor(server.provider);
  const AddressIcon = server.transport === "ssh" ? Terminal : Globe;
  const state: ServerState = check.isPending ? "checking" : (server.last_status ?? "unknown");
  const tone = STATE_TONE[state];
  const checks = server.last_check?.checks ?? [];
  const passed = checks.filter((c) => c.status === "pass").length;
  const issues = checks.filter((c) => c.status !== "pass" && c.status !== "skip");

  return (
    <div
      className="group relative flex h-full flex-col overflow-hidden rounded-2xl border border-border/60 backdrop-blur-md transition-all duration-300 hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-[0_0_32px_-8px_var(--primary)]"
      style={{ background: "var(--surface)" }}
    >
      {/* Status stripe */}
      <div className={cn("h-1 w-full bg-gradient-to-r to-transparent", tone.stripe)} />

      <Link
        to="/remote-servers/$id"
        params={{ id: String(server.id) }}
        className="absolute inset-0 z-0 rounded-2xl"
        aria-label={server.name}
      />

      <div className="pointer-events-none relative z-[1] flex flex-1 flex-col p-5">
        {/* Header */}
        <div className="flex items-start gap-3">
          <div className="relative">
            <div
              className={cn(
                "grid size-12 shrink-0 place-items-center rounded-xl border transition-all duration-300",
                "border-border/60 bg-background-elevated text-muted-foreground",
                "group-hover:border-primary/30 group-hover:bg-primary/10 group-hover:text-primary",
              )}
            >
              <Icon className="size-5" />
            </div>
            <span
              className={cn(
                "absolute -right-0.5 -bottom-0.5 size-3 rounded-full ring-2 ring-[var(--surface)]",
                tone.dot,
              )}
            />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-start justify-between gap-2">
              <h3 className="truncate text-sm font-semibold text-foreground">{server.name}</h3>
              <ArrowUpRight className="size-4 shrink-0 text-muted-foreground/40 transition group-hover:text-primary" />
            </div>
            <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
              {server.provider_label}
            </p>
          </div>
        </div>

        <p className="mt-3 line-clamp-2 min-h-[2.5rem] text-xs leading-relaxed text-muted-foreground/80">
          {server.description || "No description provided"}
        </p>

        {/* Address */}
        <div
          title={server.url}
          className="mt-3 flex items-center gap-2 rounded-lg border border-border/50 bg-background-elevated/60 px-2.5 py-1.5"
        >
          <AddressIcon className="size-3 shrink-0 text-muted-foreground" />
          <span className="truncate font-mono text-[11px] text-foreground/90">
            {shortAddress(server.url)}
          </span>
        </div>

        {/* Metrics */}
        <div className="mt-3 grid grid-cols-3 gap-2">
          <Metric label="Status">
            <ServerStatusBadge state={state} size="xs" />
          </Metric>
          <Metric label="Latency">
            {server.last_check?.latency_ms != null ? `${server.last_check.latency_ms} ms` : "—"}
          </Metric>
          <Metric label="Checks">
            {checks.length ? (
              <span className={issues.length ? "text-amber" : "text-emerald"}>
                {passed}/{checks.length}
              </span>
            ) : (
              "—"
            )}
          </Metric>
        </div>

        {issues.length > 0 ? (
          <p className="mt-2.5 truncate text-[11px] text-amber" title={issues[0]?.detail}>
            {issues[0]?.label}: {issues[0]?.detail}
          </p>
        ) : null}

        <div className="min-h-4 flex-1" />

        {/* Footer */}
        <div
          data-card-footer
          className="pointer-events-auto relative z-10 flex items-center gap-2 border-t border-border/40 pt-3.5"
        >
          <PurposeBadge purpose={server.purpose} />
          <span className="text-[10px] text-muted-foreground/70">
            checked {timeAgo(server.last_checked_at)}
          </span>
          <div className="ml-auto flex items-center gap-1">
            <button
              type="button"
              onClick={() => check.mutate()}
              disabled={check.isPending}
              title="Run diagnostics"
              className="grid size-7 place-items-center rounded-md text-muted-foreground transition hover:bg-surface-hover hover:text-foreground disabled:opacity-50"
            >
              {check.isPending ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <RefreshCw className="size-3.5" />
              )}
            </button>
            <button
              type="button"
              onClick={() =>
                window.confirm(`Remove the server "${server.name}"?`) && remove.mutate()
              }
              disabled={remove.isPending}
              aria-label={`Remove ${server.name}`}
              title="Remove"
              className="grid size-7 place-items-center rounded-md text-muted-foreground transition hover:bg-red/10 hover:text-red disabled:opacity-50"
            >
              {remove.isPending ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Trash2 className="size-3.5" />
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Metric({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-border/40 bg-background-elevated/40 px-2 py-1.5">
      <p className="text-[9px] font-medium tracking-wider text-muted-foreground/70 uppercase">
        {label}
      </p>
      <div className="mt-0.5 truncate text-xs font-medium text-foreground tabular-nums">
        {children}
      </div>
    </div>
  );
}

/** Dashed placeholder card that starts adding a server of a purpose. */
export function AddServerCard({ purpose }: { purpose?: ServerPurpose | undefined }) {
  return (
    <Link
      to="/remote-servers/new"
      search={{ purpose }}
      className="group flex h-full min-h-[16rem] flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-border/60 p-5 text-center transition hover:border-primary/40 hover:bg-primary/5"
    >
      <div className="grid size-12 place-items-center rounded-xl border border-border/60 bg-background-elevated text-muted-foreground transition group-hover:border-primary/30 group-hover:text-primary">
        <Plus className="size-5" />
      </div>
      <div>
        <p className="text-sm font-medium text-foreground">Add a server</p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {purpose === "tool"
            ? "An endpoint that receives tool code"
            : purpose === "workflow"
              ? "A VM or endpoint for workflow packages"
              : "VM, cloud instance or HTTP endpoint"}
        </p>
      </div>
    </Link>
  );
}
