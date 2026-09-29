import { useMemo, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Activity,
  ArrowLeft,
  CalendarClock,
  ChevronDown,
  ChevronRight,
  Copy,
  FileJson,
  FlaskConical,
  Loader2,
  Play,
  Plug,
  RefreshCw,
  Search,
  Server,
  Trash2,
  Unplug,
  Waypoints,
  Wrench,
} from "lucide-react";
import { mcpApi, QK, errorMessage } from "@/api";
import {
  HEALTH_LABEL,
  HEALTH_TONE,
  argumentSkeleton,
  healthState,
  serverList,
  toolList,
  toolSchema,
  type McpTool,
} from "@/components/mcp/servers";
import { HealthBadge } from "@/components/shared/ReachabilityBadge";
import { SectionCard, StatCard } from "@/components/shared/SectionCard";
import { timeAgo } from "@/components/remote-servers/status";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ErrorState } from "@/components/ui/ErrorState";
import { DetailSkeleton } from "@/components/ui/Skeletons";
import { CodeBlock } from "@/components/shared/CodeBlock";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/mcp/$serverName")({
  head: () => ({
    meta: [
      { title: "MCP Server — Agentic AI Design Patterns" },
      { name: "description", content: "MCP server detail." },
      { property: "og:title", content: "MCP Server — Agentic AI Design Patterns" },
      { property: "og:description", content: "MCP server detail." },
    ],
  }),
  component: McpServerPage,
});

function McpServerPage() {
  const { serverName } = Route.useParams();
  const qc = useQueryClient();
  const navigate = useNavigate();

  const toolsQuery = useQuery({
    queryKey: QK.mcpServerTools(serverName),
    queryFn: () => mcpApi.tools(serverName),
  });
  const tools = toolList(toolsQuery.data);
  const serversQuery = useQuery({ queryKey: QK.mcpServers(), queryFn: () => mcpApi.servers() });
  const server = serverList(serversQuery.data).find((s) => s.name === serverName) ?? null;

  const [selected, setSelected] = useState("");
  const [args, setArgs] = useState("{}");

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: QK.mcpServers() });
    qc.invalidateQueries({ queryKey: QK.mcpServerTools(serverName) });
  };
  const disconnect = useMutation({
    mutationFn: () => mcpApi.disconnect(serverName),
    onSuccess: () => {
      toast.success("Disconnected.");
      invalidate();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const reconnect = useMutation({
    mutationFn: () => mcpApi.reconnect(serverName),
    onSuccess: () => {
      toast.success("Reconnected.");
      invalidate();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const healthCheck = useMutation({
    mutationFn: () => mcpApi.healthCheck(),
    onSuccess: () => {
      toast.success("Health check complete.");
      invalidate();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const remove = useMutation({
    mutationFn: () => mcpApi.removeServer(serverName),
    onSuccess: () => {
      toast.success(`Removed "${serverName}".`);
      qc.invalidateQueries({ queryKey: QK.mcpServers() });
      navigate({ to: "/mcp" });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const selectTool = (tool: McpTool) => {
    setSelected(tool.name);
    setArgs(argumentSkeleton(tool));
    document.getElementById("mcp-playground")?.scrollIntoView({ behavior: "smooth" });
  };

  if (serversQuery.isLoading) {
    return (
      <div className="px-6 py-8">
        <DetailSkeleton />
      </div>
    );
  }

  const busy = disconnect.isPending || reconnect.isPending || healthCheck.isPending;
  const health = busy ? "checking" : server ? healthState(server) : "unknown";
  const tone = HEALTH_TONE[health];
  const connected = health !== "disconnected";
  const withSchema = tools.filter((t) => toolSchema(t)).length;

  return (
    <div className="px-6 py-8">
      <Button size="sm" variant="ghost" asChild className="mb-4">
        <Link to="/mcp">
          <ArrowLeft className="size-3.5" /> MCP Servers
        </Link>
      </Button>

      {/* ── Hero card ── */}
      <div
        className="relative overflow-hidden rounded-2xl border border-border/60 backdrop-blur-md"
        style={{ background: "var(--surface)" }}
      >
        <div className={cn("h-1 w-full bg-gradient-to-r to-transparent", tone.stripe)} />
        <div className="flex flex-wrap items-start gap-5 p-6">
          <div className="relative">
            <div className="grid size-16 place-items-center rounded-2xl border border-primary/25 bg-primary/10 text-primary">
              <Server className="size-7" />
            </div>
            <span
              className={cn(
                "absolute -right-1 -bottom-1 size-4 rounded-full ring-4 ring-[var(--surface)]",
                tone.dot,
              )}
            />
          </div>

          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2.5">
              <h1 className="truncate text-2xl font-semibold tracking-tight text-foreground">
                {serverName}
              </h1>
              <HealthBadge state={health} />
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <span className="rounded-md border border-border/60 px-1.5 py-0.5 font-mono text-[10px]">
                {server?.protocol ?? "mcp"}
              </span>
              <span className="rounded-md border border-pink/20 bg-pink/8 px-1.5 py-0.5 text-[10px] text-pink">
                Model Context Protocol
              </span>
            </div>
            {server?.url ? <CopyAddress value={server.url} /> : null}
            <p className="mt-3 max-w-3xl text-sm text-muted-foreground">
              {server?.description || "No description provided."}
            </p>
            {!server ? (
              <p className="mt-2 text-xs text-amber">
                This server isn't in the registry any more — it may have been removed.
              </p>
            ) : null}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" onClick={() => healthCheck.mutate()} disabled={busy}>
              {healthCheck.isPending ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <RefreshCw className="size-3.5" />
              )}
              Health check
            </Button>
            {connected ? (
              <Button
                size="sm"
                variant="outline"
                onClick={() => disconnect.mutate()}
                disabled={busy}
              >
                <Unplug className="size-3.5" /> Disconnect
              </Button>
            ) : (
              <Button
                size="sm"
                variant="outline"
                onClick={() => reconnect.mutate()}
                disabled={busy}
              >
                <Plug className="size-3.5" /> Reconnect
              </Button>
            )}
            <Button
              size="sm"
              variant="ghost"
              className="text-muted-foreground hover:bg-red/10 hover:text-red"
              onClick={() => window.confirm(`Remove "${serverName}"?`) && remove.mutate()}
              disabled={remove.isPending}
              aria-label="Remove server"
            >
              <Trash2 className="size-3.5" />
            </Button>
          </div>
        </div>
      </div>

      {/* ── Stat cards ── */}
      <div className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          icon={Activity}
          label="Health"
          value={HEALTH_LABEL[health]}
          valueClassName={tone.text}
          hint={
            health === "disconnected"
              ? "registered but not in use"
              : health === "healthy"
                ? "handshake succeeded"
                : "last handshake failed"
          }
        />
        <StatCard
          icon={Wrench}
          label="Tools"
          value={toolsQuery.isLoading ? "…" : tools.length}
          hint={`${withSchema} with an input schema`}
        />
        <StatCard
          icon={Waypoints}
          label="Protocol"
          value={server?.protocol ?? "mcp"}
          hint="JSON-RPC over HTTP"
        />
        <StatCard
          icon={CalendarClock}
          label="Registered"
          value={server?.created_at ? timeAgo(server.created_at) : "—"}
          hint={server?.created_at ? new Date(server.created_at).toLocaleDateString() : "unknown"}
        />
      </div>

      {/* ── Main grid ── */}
      <div className="mt-4 grid items-start gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <ToolsCard
            tools={tools}
            loading={toolsQuery.isLoading}
            error={toolsQuery.isError ? toolsQuery.error : null}
            onRetry={() => toolsQuery.refetch()}
            selected={selected}
            onTry={selectTool}
          />
          {server ? <RegistryCard record={server} /> : null}
        </div>

        <div id="mcp-playground" className="lg:sticky lg:top-6">
          <PlaygroundCard
            serverName={serverName}
            tools={tools}
            selected={selected}
            args={args}
            onSelect={(name) => {
              const tool = tools.find((t) => t.name === name);
              setSelected(name);
              setArgs(tool ? argumentSkeleton(tool) : "{}");
            }}
            onArgs={setArgs}
          />
        </div>
      </div>
    </div>
  );
}

function CopyAddress({ value }: { value: string }) {
  return (
    <button
      type="button"
      onClick={() => {
        void navigator.clipboard?.writeText(value);
        toast.success("URL copied.");
      }}
      title="Copy URL"
      className="group mt-3 inline-flex max-w-full items-center gap-2 rounded-lg border border-border/50 bg-background-elevated/60 px-2.5 py-1.5 transition hover:border-primary/30"
    >
      <span className="truncate font-mono text-xs text-foreground/90">{value}</span>
      <Copy className="size-3 shrink-0 text-muted-foreground group-hover:text-primary" />
    </button>
  );
}

function ToolsCard({
  tools,
  loading,
  error,
  onRetry,
  selected,
  onTry,
}: {
  tools: McpTool[];
  loading: boolean;
  error: unknown;
  onRetry: () => void;
  selected: string;
  onTry: (tool: McpTool) => void;
}) {
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q
      ? tools.filter((t) => `${t.name} ${t.description ?? ""}`.toLowerCase().includes(q))
      : tools;
  }, [tools, search]);

  return (
    <SectionCard
      icon={Wrench}
      title={`Tools${tools.length ? ` (${tools.length})` : ""}`}
      description="Discovered from the server during the handshake."
      actions={
        tools.length > 5 ? (
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Filter tools…"
              className="w-44 rounded-lg border border-border/60 bg-background-elevated py-1.5 pr-2 pl-8 text-xs text-foreground placeholder:text-muted-foreground focus:ring-1 focus:ring-primary focus:outline-none"
            />
          </div>
        ) : null
      }
    >
      {loading ? (
        <DetailSkeleton />
      ) : error ? (
        <ErrorState error={error} onRetry={onRetry} />
      ) : tools.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-8 text-center">
          <Wrench className="size-6 text-muted-foreground" />
          <p className="text-sm font-medium text-foreground">No tools discovered</p>
          <p className="text-xs text-muted-foreground">
            The server may be disconnected or unreachable — run a health check.
          </p>
        </div>
      ) : shown.length === 0 ? (
        <p className="py-6 text-center text-xs text-muted-foreground">No tools match.</p>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {shown.map((tool) => {
            const schema = toolSchema(tool);
            const props = Object.keys((schema?.["properties"] ?? {}) as object);
            const required = (schema?.["required"] ?? []) as string[];
            const expanded = open === tool.name;
            return (
              <div
                key={tool.name}
                className={cn(
                  "flex flex-col rounded-xl border bg-background-elevated/40 p-3.5 transition",
                  selected === tool.name
                    ? "border-primary/50 shadow-[0_0_20px_-10px_var(--primary)]"
                    : "border-border/60",
                )}
              >
                <div className="flex items-start gap-2.5">
                  <div className="grid size-8 shrink-0 place-items-center rounded-lg border border-pink/20 bg-pink/8 text-pink">
                    <Wrench className="size-3.5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-mono text-xs font-semibold text-foreground">
                      {tool.name}
                    </p>
                    <p className="mt-0.5 line-clamp-2 text-[11px] leading-relaxed text-muted-foreground">
                      {tool.description || "No description."}
                    </p>
                  </div>
                </div>
                {props.length > 0 ? (
                  <div className="mt-2.5 flex flex-wrap gap-1">
                    {props.slice(0, 6).map((p) => (
                      <span
                        key={p}
                        className="rounded border border-border/60 px-1 font-mono text-[10px] text-muted-foreground"
                      >
                        {p}
                        {required.includes(p) ? <span className="text-red">*</span> : null}
                      </span>
                    ))}
                    {props.length > 6 ? (
                      <span className="text-[10px] text-muted-foreground">+{props.length - 6}</span>
                    ) : null}
                  </div>
                ) : null}
                <div className="min-h-2 flex-1" />
                <div className="mt-3 flex items-center gap-2 border-t border-border/40 pt-2.5">
                  {schema ? (
                    <button
                      type="button"
                      onClick={() => setOpen(expanded ? null : tool.name)}
                      className="inline-flex items-center gap-1 text-[11px] text-muted-foreground transition hover:text-foreground"
                    >
                      {expanded ? (
                        <ChevronDown className="size-3" />
                      ) : (
                        <ChevronRight className="size-3" />
                      )}
                      Schema
                    </button>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => onTry(tool)}
                    className="ml-auto inline-flex items-center gap-1 rounded-md border border-border/60 px-2 py-0.5 text-[11px] font-medium text-muted-foreground transition hover:border-primary/30 hover:text-primary"
                  >
                    <Play className="size-3" /> Try it
                  </button>
                </div>
                {expanded && schema ? (
                  <div className="mt-2">
                    <CodeBlock code={JSON.stringify(schema, null, 2)} language="json" />
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      )}
    </SectionCard>
  );
}

function PlaygroundCard({
  serverName,
  tools,
  selected,
  args,
  onSelect,
  onArgs,
}: {
  serverName: string;
  tools: McpTool[];
  selected: string;
  args: string;
  onSelect: (name: string) => void;
  onArgs: (args: string) => void;
}) {
  const [result, setResult] = useState<unknown>(null);
  const [ms, setMs] = useState<number | null>(null);
  const execute = useMutation({
    mutationFn: async () => {
      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(args || "{}");
      } catch {
        throw new Error("Arguments must be valid JSON.");
      }
      const t0 = performance.now();
      const res = await mcpApi.execute(serverName, selected, parsed);
      setMs(Math.round(performance.now() - t0));
      return res;
    },
    onSuccess: (res) => setResult(res),
    onError: (e) => toast.error(errorMessage(e)),
  });

  let argsValid = true;
  try {
    JSON.parse(args || "{}");
  } catch {
    argsValid = false;
  }

  return (
    <SectionCard
      icon={FlaskConical}
      title="Playground"
      description="Call a tool with your own arguments."
      bodyClassName="space-y-3"
    >
      {tools.length === 0 ? (
        <p className="py-4 text-center text-xs text-muted-foreground">No tools to try yet.</p>
      ) : (
        <>
          <Select
            value={selected}
            onValueChange={(v) => {
              onSelect(v);
              setResult(null);
            }}
          >
            <SelectTrigger>
              <SelectValue placeholder="Select a tool…" />
            </SelectTrigger>
            <SelectContent>
              {tools.map((t) => (
                <SelectItem key={t.name} value={t.name}>
                  {t.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <p className="text-xs font-medium text-foreground">Arguments</p>
              <span className={cn("text-[10px]", argsValid ? "text-muted-foreground" : "text-red")}>
                {argsValid ? "JSON" : "invalid JSON"}
              </span>
            </div>
            <Textarea
              value={args}
              onChange={(e) => onArgs(e.target.value)}
              rows={8}
              spellCheck={false}
              className="font-mono text-xs"
            />
          </div>

          <Button
            className="w-full"
            onClick={() => execute.mutate()}
            disabled={!selected || !argsValid || execute.isPending}
          >
            {execute.isPending ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Play className="size-3.5" />
            )}
            Execute
          </Button>

          {result != null ? (
            <div>
              <div className="mb-1.5 flex items-center justify-between">
                <p className="text-xs font-medium text-foreground">Result</p>
                {ms != null ? (
                  <span className="text-[10px] text-muted-foreground">{ms} ms</span>
                ) : null}
              </div>
              <div className="max-h-80 overflow-auto rounded-lg">
                <CodeBlock code={JSON.stringify(result, null, 2)} language="json" />
              </div>
            </div>
          ) : null}
        </>
      )}
    </SectionCard>
  );
}

function RegistryCard({ record }: { record: Record<string, unknown> }) {
  const [open, setOpen] = useState(false);
  return (
    <SectionCard
      icon={FileJson}
      title="Registry record"
      description="Exactly what the Tool Service reports for this server."
      actions={
        <Button size="sm" variant="ghost" onClick={() => setOpen((o) => !o)}>
          {open ? "Hide" : "Show"}
        </Button>
      }
      bodyClassName={open ? "p-5" : "hidden"}
    >
      <CodeBlock code={JSON.stringify(record, null, 2)} language="json" />
    </SectionCard>
  );
}
