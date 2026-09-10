import { useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { z } from "zod";
import {
  ArrowRight,
  ChevronDown,
  Loader2,
  Plug,
  Plus,
  RefreshCw,
  Server,
  Trash2,
  Unplug,
} from "lucide-react";
import { mcpApi, remoteServersApi, QK, errorMessage } from "@/api";
import { GlassPanel, GlassPanelHeader } from "@/components/glass/GlassPanel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { CardGridSkeleton } from "@/components/ui/Skeletons";
import { HealthBadge, type HealthState } from "@/components/shared/ReachabilityBadge";
import { RemoteServersPanel } from "@/components/tools/RemoteServersPanel";
import { cn } from "@/lib/utils";

const searchSchema = z.object({
  tab: z.enum(["mcp", "remote"]).optional(),
});

export const Route = createFileRoute("/mcp/")({
  validateSearch: searchSchema,
  head: () => ({
    meta: [
      { title: "MCP Servers — Agentic AI Design Patterns" },
      { name: "description", content: "MCP registry." },
      { property: "og:title", content: "MCP Servers — Agentic AI Design Patterns" },
      { property: "og:description", content: "MCP registry." },
    ],
  }),
  component: McpIndexPage,
});

interface McpServer {
  name: string;
  url?: string;
  description?: string;
  status?: string;
  connected?: boolean;
  tool_count?: number;
  [k: string]: unknown;
}

function serverList(data: unknown): McpServer[] {
  if (Array.isArray(data)) return data as McpServer[];
  const obj = data as { servers?: McpServer[]; items?: McpServer[] } | undefined;
  return obj?.servers ?? obj?.items ?? [];
}

function healthState(server: McpServer): HealthState {
  const status = String(server.status ?? "").toLowerCase();
  if (status.includes("health")) return "healthy";
  if (status.includes("disconnect")) return "disconnected";
  if (status.includes("unreach") || status.includes("error")) return "unreachable";
  if (status.includes("check")) return "checking";
  if (server.connected === true) return "healthy";
  if (server.connected === false) return "disconnected";
  return "unknown";
}

function McpServerCard({ server }: { server: McpServer }) {
  const qc = useQueryClient();
  const [infoOpen, setInfoOpen] = useState(false);

  const disconnect = useMutation({
    mutationFn: () => mcpApi.disconnect(server.name),
    onSuccess: () => {
      toast.success(`Disconnected "${server.name}".`);
      qc.invalidateQueries({ queryKey: QK.mcpServers() });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const reconnect = useMutation({
    mutationFn: () => mcpApi.reconnect(server.name),
    onSuccess: () => {
      toast.success(`Reconnected "${server.name}".`);
      qc.invalidateQueries({ queryKey: QK.mcpServers() });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const remove = useMutation({
    mutationFn: () => mcpApi.removeServer(server.name),
    onSuccess: () => {
      toast.success(`Removed "${server.name}".`);
      qc.invalidateQueries({ queryKey: QK.mcpServers() });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  return (
    <GlassPanel className="flex flex-col p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-foreground">{server.name}</p>
          {server.url ? <p className="truncate text-xs text-muted-foreground">{server.url}</p> : null}
        </div>
        <HealthBadge state={healthState(server)} />
      </div>
      {server.description ? (
        <p className="mt-2 line-clamp-2 text-xs text-muted-foreground">{server.description}</p>
      ) : null}

      <button
        type="button"
        onClick={() => setInfoOpen((v) => !v)}
        className="mt-2 flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
      >
        <ChevronDown className={cn("size-3.5 transition-transform", infoOpen && "rotate-180")} />
        Server Health Info
      </button>
      {infoOpen ? (
        <pre className="mt-1 max-h-40 overflow-auto rounded-lg border border-border bg-background-elevated/60 p-2 text-[11px] text-muted-foreground">
          {JSON.stringify(server, null, 2)}
        </pre>
      ) : null}

      <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-border pt-3">
        <Button size="sm" variant="outline" asChild>
          <Link to="/mcp/$serverName" params={{ serverName: server.name }}>
            Open <ArrowRight className="size-3.5" />
          </Link>
        </Button>
        <Button size="sm" variant="outline" onClick={() => disconnect.mutate()} disabled={disconnect.isPending}>
          <Unplug className="size-3.5" /> Disconnect
        </Button>
        <Button size="sm" variant="outline" onClick={() => reconnect.mutate()} disabled={reconnect.isPending}>
          <RefreshCw className="size-3.5" /> Reconnect
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="ml-auto text-red hover:text-red"
          onClick={() => remove.mutate()}
          disabled={remove.isPending}
        >
          <Trash2 className="size-3.5" />
        </Button>
      </div>
    </GlassPanel>
  );
}

function McpServersTab() {
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [description, setDescription] = useState("");

  const query = useQuery({ queryKey: QK.mcpServers(), queryFn: () => mcpApi.servers() });
  const servers = serverList(query.data);

  const create = useMutation({
    mutationFn: () => mcpApi.addServer({ name, url, description }),
    onSuccess: () => {
      toast.success(`Registered "${name}".`);
      setName("");
      setUrl("");
      setDescription("");
      setShowForm(false);
      qc.invalidateQueries({ queryKey: QK.mcpServers() });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const healthCheck = useMutation({
    mutationFn: () => mcpApi.healthCheck(),
    onSuccess: () => {
      toast.success("Health check complete.");
      qc.invalidateQueries({ queryKey: QK.mcpServers() });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-end gap-2">
        <Button size="sm" variant="outline" onClick={() => healthCheck.mutate()} disabled={healthCheck.isPending}>
          {healthCheck.isPending ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
          Health check all
        </Button>
        <Button size="sm" onClick={() => setShowForm((s) => !s)}>
          <Plus className="size-3.5" /> Register Server
        </Button>
      </div>

      {showForm ? (
        <GlassPanel className="p-4">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (name.trim() && url.trim()) create.mutate();
            }}
            className="space-y-2"
          >
            <Input placeholder="Server Name (e.g. github-mcp)" value={name} onChange={(e) => setName(e.target.value)} />
            <Input
              placeholder="Endpoint URL (https://mcp.example.com)"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
            />
            <Textarea
              placeholder="What does this server provide?"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
            />
            <div className="flex justify-end gap-2">
              <Button type="button" size="sm" variant="ghost" onClick={() => setShowForm(false)}>
                Cancel
              </Button>
              <Button type="submit" size="sm" disabled={create.isPending}>
                {create.isPending ? "Registering…" : "Register"}
              </Button>
            </div>
          </form>
        </GlassPanel>
      ) : null}

      {query.isLoading ? (
        <CardGridSkeleton />
      ) : query.isError ? (
        <ErrorState error={query.error} onRetry={() => query.refetch()} />
      ) : servers.length === 0 ? (
        <EmptyState icon={<Server className="size-6" />} title="No MCP servers registered" />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {servers.map((s) => (
            <McpServerCard key={s.name} server={s} />
          ))}
        </div>
      )}
    </div>
  );
}

function McpIndexPage() {
  const { tab } = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const active = tab ?? "mcp";

  return (
    <div className="px-6 py-8">
      <h1 className="text-2xl font-semibold tracking-tight text-foreground">MCP</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Connect, manage, and test Model Context Protocol servers.
      </p>

      <div className="mt-6 inline-flex h-9 items-center gap-1 rounded-lg bg-muted p-1 text-muted-foreground">
        <button
          type="button"
          onClick={() => navigate({ search: { tab: "mcp" } })}
          className={cn(
            "rounded-md px-3 py-1 text-sm font-medium transition-all",
            active === "mcp" ? "bg-background text-foreground shadow" : "hover:text-foreground",
          )}
        >
          MCP Servers
        </button>
        <button
          type="button"
          onClick={() => navigate({ search: { tab: "remote" } })}
          className={cn(
            "rounded-md px-3 py-1 text-sm font-medium transition-all",
            active === "remote" ? "bg-background text-foreground shadow" : "hover:text-foreground",
          )}
        >
          Remote Servers
        </button>
      </div>

      <div className="mt-6">
        {active === "mcp" ? <McpServersTab /> : <RemoteServersPanel />}
      </div>
    </div>
  );
}
