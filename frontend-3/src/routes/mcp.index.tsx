import { useMemo, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { z } from "zod";
import { Loader2, Plus, RefreshCw, Search, Server, X } from "lucide-react";
import { mcpApi, QK, errorMessage } from "@/api";
import { McpServerCard } from "@/components/mcp/McpServerCard";
import { serverList } from "@/components/mcp/servers";
import { GlassPanel } from "@/components/glass/GlassPanel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ErrorState } from "@/components/ui/ErrorState";
import { CardGridSkeleton } from "@/components/ui/Skeletons";
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

function McpServersTab({
  showForm,
  setShowForm,
}: {
  showForm: boolean;
  setShowForm: (open: boolean) => void;
}) {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [description, setDescription] = useState("");

  const query = useQuery({ queryKey: QK.mcpServers(), queryFn: () => mcpApi.servers() });
  const servers = serverList(query.data);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return servers;
    return servers.filter((s) =>
      `${s.name} ${s.url ?? ""} ${s.description ?? ""}`.toLowerCase().includes(q),
    );
  }, [servers, search]);

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
    <div>
      {/* ── Filters ── */}
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-border/40 bg-surface/20 px-4 py-3 backdrop-blur-sm">
        <div className="relative max-w-sm flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search servers…"
            className="w-full rounded-lg border border-border/60 bg-background-elevated py-2 pr-3 pl-9 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </div>
        {search ? (
          <button
            type="button"
            onClick={() => setSearch("")}
            className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-muted-foreground transition hover:bg-surface-hover hover:text-foreground"
          >
            <X className="size-3" />
            Clear
          </button>
        ) : null}
        <Button
          size="sm"
          variant="outline"
          onClick={() => healthCheck.mutate()}
          disabled={healthCheck.isPending}
        >
          {healthCheck.isPending ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <RefreshCw className="size-3.5" />
          )}
          Health check all
        </Button>
        {servers.length > 0 && (
          <span className="ml-auto text-xs tabular-nums text-muted-foreground/60">
            {filtered.length} of {servers.length} server{servers.length !== 1 ? "s" : ""}
          </span>
        )}
      </div>

      {showForm ? (
        <GlassPanel className="mt-4 p-4">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (name.trim() && url.trim()) create.mutate();
            }}
            className="space-y-2"
          >
            <Input
              placeholder="Server Name (e.g. github-mcp)"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
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

      {/* ── Grid ── */}
      <div className="mt-8">
        {query.isLoading ? (
          <CardGridSkeleton />
        ) : query.isError ? (
          <ErrorState error={query.error} onRetry={() => query.refetch()} />
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-border/60 py-20 text-center">
            <div className="relative mb-5">
              <div
                className="absolute -inset-8 rounded-full opacity-15 blur-2xl"
                style={{ background: "var(--gradient-brand)" }}
              />
              <div className="relative grid size-14 place-items-center rounded-2xl border border-border/60 glass">
                <Server className="size-6 text-primary" />
              </div>
            </div>
            <h2 className="text-lg font-semibold tracking-tight text-foreground">
              {search ? "No servers match that search" : "No MCP servers registered"}
            </h2>
            <p className="mt-1.5 max-w-sm text-xs text-muted-foreground">
              {search
                ? "Try a different name, URL, or description."
                : "Register a Model Context Protocol server to use its tools."}
            </p>
            {!search && !showForm && (
              <button
                type="button"
                onClick={() => setShowForm(true)}
                className="mt-5 inline-flex items-center gap-1.5 rounded-xl bg-gradient-brand px-4 py-2 text-sm font-medium text-primary-foreground transition hover:opacity-90"
              >
                <Plus className="size-4" />
                Register Server
              </button>
            )}
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {filtered.map((s) => (
              <McpServerCard key={s.name} server={s} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function McpIndexPage() {
  const { tab } = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const active = tab ?? "mcp";
  const [showForm, setShowForm] = useState(false);

  return (
    <div className="px-6 py-8">
      {/* ── Header ── */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
            MCP <span className="text-gradient-brand">Servers</span>
          </h1>
          <p className="mt-1.5 max-w-2xl text-sm text-muted-foreground">
            Connect, manage, and test Model Context Protocol servers.
          </p>
        </div>
        {active === "mcp" && (
          <button
            type="button"
            onClick={() => setShowForm(true)}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-xl bg-gradient-brand px-4 py-2.5 text-sm font-medium text-primary-foreground transition hover:opacity-90"
          >
            <Plus className="size-4" />
            Register Server
          </button>
        )}
      </div>

      {/* ── Tabs ── */}
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

      <div className="mt-5">
        {active === "mcp" ? (
          <McpServersTab showForm={showForm} setShowForm={setShowForm} />
        ) : (
          <RemoteServersPanel />
        )}
      </div>
    </div>
  );
}
