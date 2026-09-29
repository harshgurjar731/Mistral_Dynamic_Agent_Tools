import { Link } from "@tanstack/react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowUpRight, Globe, Loader2, Plug, Plus, Server, Trash2, Unplug } from "lucide-react";
import { errorMessage, mcpApi, QK } from "@/api";
import {
  HEALTH_LABEL,
  HEALTH_TONE,
  healthState,
  hostOf,
  toolCount,
  type McpServer,
} from "@/components/mcp/servers";
import { timeAgo } from "@/components/remote-servers/status";
import { cn } from "@/lib/utils";

/** One MCP server on the MCP page — click anywhere to open its tools. */
export function McpServerCard({ server }: { server: McpServer }) {
  const qc = useQueryClient();
  const invalidate = () => qc.invalidateQueries({ queryKey: QK.mcpServers() });

  const disconnect = useMutation({
    mutationFn: () => mcpApi.disconnect(server.name),
    onSuccess: () => {
      toast.success(`Disconnected "${server.name}".`);
      invalidate();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const reconnect = useMutation({
    mutationFn: () => mcpApi.reconnect(server.name),
    onSuccess: () => {
      toast.success(`Reconnected "${server.name}".`);
      invalidate();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const remove = useMutation({
    mutationFn: () => mcpApi.removeServer(server.name),
    onSuccess: () => {
      toast.success(`Removed "${server.name}".`);
      invalidate();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const busy = disconnect.isPending || reconnect.isPending;
  const health = busy ? "checking" : healthState(server);
  const tone = HEALTH_TONE[health];
  const tools = toolCount(server);
  const connected = health !== "disconnected";

  return (
    <div
      className="group relative flex h-full flex-col overflow-hidden rounded-2xl border border-border/60 backdrop-blur-md transition-all duration-300 hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-[0_0_32px_-8px_var(--primary)]"
      style={{ background: "var(--surface)" }}
    >
      <div className={cn("h-1 w-full bg-gradient-to-r to-transparent", tone.stripe)} />

      <Link
        to="/mcp/$serverName"
        params={{ serverName: server.name }}
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
              <Server className="size-5" />
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
            <p className="mt-0.5 truncate font-mono text-[11px] text-muted-foreground">
              {server.protocol ?? "mcp"}
            </p>
          </div>
        </div>

        <p className="mt-3 line-clamp-2 min-h-[2.5rem] text-xs leading-relaxed text-muted-foreground/80">
          {server.description || "No description provided"}
        </p>

        {/* Address */}
        {server.url ? (
          <div
            title={server.url}
            className="mt-3 flex items-center gap-2 rounded-lg border border-border/50 bg-background-elevated/60 px-2.5 py-1.5"
          >
            <Globe className="size-3 shrink-0 text-muted-foreground" />
            <span className="truncate font-mono text-[11px] text-foreground/90">
              {hostOf(server.url)}
            </span>
          </div>
        ) : null}

        {/* Metrics */}
        <div className="mt-3 grid grid-cols-3 gap-2">
          <Metric label="Status">
            <span className={cn("inline-flex items-center gap-1", tone.text)}>
              <span className={cn("size-1.5 rounded-full", tone.dot)} />
              {HEALTH_LABEL[health]}
            </span>
          </Metric>
          <Metric label="Tools">{tools ?? "—"}</Metric>
          <Metric label="Registered">{server.created_at ? timeAgo(server.created_at) : "—"}</Metric>
        </div>

        <div className="min-h-4 flex-1" />

        {/* Footer */}
        <div
          data-card-footer
          className="pointer-events-auto relative z-10 flex items-center gap-2 border-t border-border/40 pt-3.5"
        >
          {connected ? (
            <FooterButton
              onClick={() => disconnect.mutate()}
              disabled={busy}
              icon={disconnect.isPending ? Loader2 : Unplug}
              spinning={disconnect.isPending}
            >
              Disconnect
            </FooterButton>
          ) : (
            <FooterButton
              onClick={() => reconnect.mutate()}
              disabled={busy}
              icon={reconnect.isPending ? Loader2 : Plug}
              spinning={reconnect.isPending}
            >
              Reconnect
            </FooterButton>
          )}
          <button
            type="button"
            onClick={() => window.confirm(`Remove the server "${server.name}"?`) && remove.mutate()}
            disabled={remove.isPending}
            aria-label={`Remove ${server.name}`}
            title="Remove"
            className="ml-auto grid size-7 place-items-center rounded-md text-muted-foreground transition hover:bg-red/10 hover:text-red disabled:opacity-50"
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
  );
}

function Metric({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0 rounded-lg border border-border/40 bg-background-elevated/40 px-2 py-1.5">
      <p className="text-[9px] font-medium tracking-wider text-muted-foreground/70 uppercase">
        {label}
      </p>
      <div className="mt-0.5 truncate text-xs font-medium text-foreground tabular-nums">
        {children}
      </div>
    </div>
  );
}

function FooterButton({
  onClick,
  disabled,
  icon: Icon,
  spinning,
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  icon: typeof Unplug;
  spinning?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="inline-flex items-center gap-1 rounded-md border border-border/60 px-2 py-1 text-[10px] font-medium text-muted-foreground transition hover:border-primary/30 hover:bg-surface-hover hover:text-foreground disabled:opacity-50"
    >
      <Icon className={cn("size-3", spinning && "animate-spin")} />
      {children}
    </button>
  );
}

/** Dashed placeholder card that opens the register dialog. */
export function RegisterMcpCard({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group flex h-full min-h-[16rem] flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-border/60 p-5 text-center transition hover:border-primary/40 hover:bg-primary/5"
    >
      <div className="grid size-12 place-items-center rounded-xl border border-border/60 bg-background-elevated text-muted-foreground transition group-hover:border-primary/30 group-hover:text-primary">
        <Plus className="size-5" />
      </div>
      <div>
        <p className="text-sm font-medium text-foreground">Register a server</p>
        <p className="mt-0.5 text-xs text-muted-foreground">Any Model Context Protocol endpoint</p>
      </div>
    </button>
  );
}
