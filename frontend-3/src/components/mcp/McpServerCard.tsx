import { Link } from "@tanstack/react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Globe, Loader2, RefreshCw, Server, Trash2, Unplug, Wrench } from "lucide-react";
import { toast } from "sonner";
import { errorMessage, mcpApi, QK } from "@/api";
import { HealthBadge } from "@/components/shared/ReachabilityBadge";
import { healthState, type McpServer } from "@/components/mcp/servers";
import { cn } from "@/lib/utils";

/** Strip the scheme so the host reads cleanly in the small badge. */
function hostOf(url?: string): string {
  if (!url) return "";
  try {
    return new URL(url).host;
  } catch {
    return url.replace(/^https?:\/\//, "");
  }
}

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

  const health = healthState(server);
  const host = hostOf(server.url);
  const toolCount = typeof server.tool_count === "number" ? server.tool_count : null;

  return (
    <div
      className="group relative flex h-full flex-col rounded-2xl border border-border/60 backdrop-blur-md transition-all duration-300 hover:border-primary/30 hover:shadow-[0_0_32px_-8px_var(--primary)]"
      style={{ background: "var(--surface)" }}
    >
      {/* Hover glow accent */}
      <div
        className="pointer-events-none absolute -inset-px rounded-2xl opacity-0 transition-opacity duration-300 group-hover:opacity-100"
        style={{
          background:
            "linear-gradient(135deg, oklch(0.65 0.18 36 / 0.06), oklch(0.71 0.14 55 / 0.04), transparent 70%)",
        }}
      />

      <Link
        to="/mcp/$serverName"
        params={{ serverName: server.name }}
        className="absolute inset-0 z-0 rounded-2xl"
        aria-label={server.name}
      />

      <div className="pointer-events-none relative z-[1] flex flex-1 flex-col p-5">
        {/* Header */}
        <div className="flex items-start gap-3">
          <div
            className={cn(
              "grid size-11 shrink-0 place-items-center rounded-xl border transition-all duration-300",
              "border-border/60 bg-background-elevated text-muted-foreground",
              "group-hover:border-primary/30 group-hover:bg-primary/10 group-hover:text-primary group-hover:shadow-[0_0_12px_-4px_var(--primary)]",
            )}
          >
            <Server className="size-5" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h3 className="truncate text-sm font-semibold text-foreground">{server.name}</h3>
              <HealthBadge state={health} />
            </div>
            <p className="mt-0.5 line-clamp-2 text-xs leading-relaxed text-muted-foreground/70">
              {server.description || "No description provided"}
            </p>
          </div>
        </div>

        {/* Endpoint + capability badges */}
        <div className="mt-3.5 flex flex-wrap items-center gap-1.5">
          {host ? (
            <span
              title={server.url}
              className="inline-flex max-w-full items-center gap-1 rounded-md border border-blue/20 bg-blue/8 px-1.5 py-0.5 font-mono text-[10px] text-blue"
            >
              <Globe className="size-2.5 shrink-0" />
              <span className="truncate">{host}</span>
            </span>
          ) : null}
          {toolCount !== null ? (
            <span className="inline-flex items-center gap-1 rounded-md border border-pink/20 bg-pink/8 px-1.5 py-0.5 text-[10px] font-medium text-pink">
              <Wrench className="size-2.5" />
              {toolCount} tool{toolCount !== 1 ? "s" : ""}
            </span>
          ) : null}
        </div>

        {/* Footer — actions, pinned to the bottom so rows line up */}
        <div className="pointer-events-auto relative z-10 mt-auto flex items-center gap-1.5 border-t border-border/40 pt-3.5">
          <CardAction
            onClick={() => disconnect.mutate()}
            disabled={disconnect.isPending}
            icon={disconnect.isPending ? Loader2 : Unplug}
            spinning={disconnect.isPending}
          >
            Disconnect
          </CardAction>
          <CardAction
            onClick={() => reconnect.mutate()}
            disabled={reconnect.isPending}
            icon={reconnect.isPending ? Loader2 : RefreshCw}
            spinning={reconnect.isPending}
          >
            Reconnect
          </CardAction>
          <button
            type="button"
            onClick={() => window.confirm(`Remove the server "${server.name}"?`) && remove.mutate()}
            disabled={remove.isPending}
            aria-label={`Remove ${server.name}`}
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

function CardAction({
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
