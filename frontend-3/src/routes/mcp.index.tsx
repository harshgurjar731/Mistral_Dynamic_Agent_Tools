import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Activity,
  Loader2,
  Plug,
  Plus,
  RefreshCw,
  Search,
  Server,
  Unplug,
  Wrench,
  X,
} from "lucide-react";
import { mcpApi, QK, errorMessage } from "@/api";
import { McpServerCard, RegisterMcpCard } from "@/components/mcp/McpServerCard";
import { RegisterMcpDialog } from "@/components/mcp/RegisterMcpDialog";
import { healthState, serverList, toolCount, type McpServer } from "@/components/mcp/servers";
import { StatCard } from "@/components/shared/SectionCard";
import { ErrorState } from "@/components/ui/ErrorState";
import { CardGridSkeleton } from "@/components/ui/Skeletons";
import { SortSelect } from "@/components/shared/SortSelect";
import { applySort, byDate, byText, useSortKey, type SortOption } from "@/lib/sorting";
import { cn } from "@/lib/utils";
import { BulkActionBar, SelectableItem } from "@/components/shared/BulkSelection";
import { useBulkDelete, useBulkSelection } from "@/lib/bulkSelection";

export const Route = createFileRoute("/mcp/")({
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

const HEALTH_RANK: Record<string, number> = { unreachable: 0, disconnected: 1, unknown: 2 };

const MCP_SORTS: SortOption<McpServer>[] = [
  { key: "name_asc", label: "Name A–Z", compare: byText((s) => s.name) },
  { key: "name_desc", label: "Name Z–A", compare: byText((s) => s.name, "desc") },
  { key: "newest", label: "Newest first", compare: byDate((s) => s.created_at) },
  { key: "oldest", label: "Oldest first", compare: byDate((s) => s.created_at, "asc") },
  {
    key: "attention",
    label: "Needs attention",
    compare: (a, b) => (HEALTH_RANK[healthState(a)] ?? 3) - (HEALTH_RANK[healthState(b)] ?? 3),
  },
  {
    key: "tools",
    label: "Most tools",
    compare: (a, b) => (toolCount(b) ?? 0) - (toolCount(a) ?? 0),
  },
];

type Filter = "all" | "healthy" | "unreachable" | "disconnected";

const FILTERS: { value: Filter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "healthy", label: "Healthy" },
  { value: "unreachable", label: "Unreachable" },
  { value: "disconnected", label: "Disconnected" },
];

function McpIndexPage() {
  const qc = useQueryClient();
  const [registerOpen, setRegisterOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [sort, setSort] = useSortKey("mcp", "name_asc");

  const query = useQuery({ queryKey: QK.mcpServers(), queryFn: () => mcpApi.servers() });
  const servers = useMemo(() => serverList(query.data), [query.data]);

  const counts = useMemo(() => {
    const c = { healthy: 0, unreachable: 0, disconnected: 0, tools: 0 };
    for (const s of servers) {
      const h = healthState(s);
      if (h === "healthy") c.healthy += 1;
      else if (h === "disconnected") c.disconnected += 1;
      else c.unreachable += 1;
      c.tools += toolCount(s) ?? 0;
    }
    return c;
  }, [servers]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const rows = servers.filter((s) => {
      const h = healthState(s);
      const matchesFilter =
        filter === "all" ||
        (filter === "unreachable" ? h !== "healthy" && h !== "disconnected" : h === filter);
      return (
        matchesFilter &&
        (!q || `${s.name} ${s.url ?? ""} ${s.description ?? ""}`.toLowerCase().includes(q))
      );
    });
    return applySort(rows, MCP_SORTS, sort);
  }, [servers, search, filter, sort]);

  const selection = useBulkSelection(
    filtered,
    (s) => s.name,
    () => true,
    (s) => s.name,
  );
  const bulkDelete = useBulkDelete({
    noun: "server",
    deleteOne: (name) => mcpApi.removeServer(name),
    invalidate: [QK.mcpServers()],
    selection,
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
    <div className="px-6 py-8">
      {/* ── Header ── */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
            MCP <span className="text-gradient-brand">Servers</span>
          </h1>
          <p className="mt-1.5 max-w-2xl text-sm text-muted-foreground">
            Model Context Protocol servers whose tools your agents can call. Register one, check its
            health, and try its tools before wiring them in.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setRegisterOpen(true)}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-xl bg-gradient-brand px-4 py-2.5 text-sm font-medium text-primary-foreground transition hover:opacity-90"
        >
          <Plus className="size-4" />
          Register Server
        </button>
      </div>

      {query.isLoading ? (
        <div className="mt-8">
          <CardGridSkeleton />
        </div>
      ) : query.isError ? (
        <div className="mt-8">
          <ErrorState error={query.error} onRetry={() => query.refetch()} />
        </div>
      ) : servers.length === 0 ? (
        <GetStarted onRegister={() => setRegisterOpen(true)} />
      ) : (
        <>
          {/* ── Stat cards ── */}
          <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard
              icon={Server}
              label="Servers"
              value={servers.length}
              hint="registered with the Tool Service"
            />
            <StatCard
              icon={Activity}
              label="Healthy"
              value={counts.healthy}
              valueClassName="text-emerald"
              hint={`${counts.unreachable} unreachable`}
            />
            <StatCard
              icon={Unplug}
              label="Disconnected"
              value={counts.disconnected}
              valueClassName={counts.disconnected ? "text-slate" : undefined}
              hint="registered but not in use"
            />
            <StatCard
              icon={Wrench}
              label="Tools discovered"
              value={counts.tools}
              valueClassName="text-pink"
              hint="across all servers"
            />
          </div>

          {/* ── Toolbar ── */}
          <div className="mt-6 flex flex-wrap items-center gap-3 rounded-xl border border-border/40 bg-surface/20 px-4 py-3 backdrop-blur-sm">
            <div className="relative max-w-sm flex-1">
              <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search by name, URL or description…"
                className="w-full rounded-lg border border-border/60 bg-background-elevated py-2 pr-3 pl-9 text-sm text-foreground placeholder:text-muted-foreground focus:ring-1 focus:ring-primary focus:outline-none"
              />
            </div>
            <div className="inline-flex h-9 items-center gap-1 rounded-lg bg-muted p-1 text-muted-foreground">
              {FILTERS.map((f) => (
                <button
                  key={f.value}
                  type="button"
                  onClick={() => setFilter(f.value)}
                  className={cn(
                    "rounded-md px-2.5 py-1 text-xs font-medium transition-all",
                    filter === f.value
                      ? "bg-background text-foreground shadow"
                      : "hover:text-foreground",
                  )}
                >
                  {f.label}
                </button>
              ))}
            </div>
            <SortSelect value={sort} onChange={setSort} options={MCP_SORTS} />
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
            <span className="ml-auto text-xs text-muted-foreground/60 tabular-nums">
              {filtered.length} of {servers.length} server{servers.length !== 1 ? "s" : ""}
            </span>
            <button
              type="button"
              onClick={() => healthCheck.mutate()}
              disabled={healthCheck.isPending}
              className="inline-flex items-center gap-1.5 rounded-lg border border-border/60 px-3 py-1.5 text-xs font-medium text-muted-foreground transition hover:bg-surface-hover hover:text-foreground disabled:opacity-50"
            >
              {healthCheck.isPending ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <RefreshCw className="size-3.5" />
              )}
              Health check all
            </button>
          </div>

          {/* ── Cards ── */}
          {filtered.length === 0 ? (
            <div className="mt-8 rounded-2xl border border-dashed border-border/60 py-16 text-center">
              <p className="text-sm font-medium text-foreground">No servers match</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Try a different search or status filter.
              </p>
            </div>
          ) : (
            <>
              <BulkActionBar
                className="mt-8"
                selection={selection}
                noun="server"
                onDelete={bulkDelete.run}
                deleting={bulkDelete.running}
                warning="Agents stop receiving the tools these MCP servers provide."
              />
              <div className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
                {filtered.map((s) => (
                  <SelectableItem key={s.name} selection={selection} id={s.name} label={s.name}>
                    <McpServerCard server={s} />
                  </SelectableItem>
                ))}
                {!search.trim() && filter === "all" ? (
                  <RegisterMcpCard onClick={() => setRegisterOpen(true)} />
                ) : null}
              </div>
            </>
          )}
        </>
      )}

      <RegisterMcpDialog open={registerOpen} onOpenChange={setRegisterOpen} />
    </div>
  );
}

/** First-run state: what MCP servers are for, and the one action to take. */
function GetStarted({ onRegister }: { onRegister: () => void }) {
  const steps = [
    {
      icon: Plug,
      title: "Register",
      text: "Point at any MCP endpoint — the Tool Service handshakes with it.",
    },
    {
      icon: Wrench,
      title: "Discover",
      text: "Its tools are listed automatically, with their input schemas.",
    },
    {
      icon: Activity,
      title: "Try & use",
      text: "Run a tool from the playground, then let agents call it.",
    },
  ];
  return (
    <div className="mt-10">
      <div className="mx-auto max-w-3xl text-center">
        <div className="mx-auto grid size-14 place-items-center rounded-2xl border border-border/60 glass">
          <Server className="size-6 text-primary" />
        </div>
        <h2 className="mt-4 text-lg font-semibold tracking-tight text-foreground">
          No MCP servers registered
        </h2>
        <p className="mt-1.5 text-sm text-muted-foreground">
          Register a Model Context Protocol server to use its tools.
        </p>
      </div>
      <div className="mx-auto mt-6 grid max-w-4xl gap-4 sm:grid-cols-3">
        {steps.map((s, i) => (
          <div
            key={s.title}
            className="rounded-2xl border border-border/60 p-5"
            style={{ background: "var(--surface)" }}
          >
            <div className="flex items-center gap-2">
              <span className="grid size-6 place-items-center rounded-full border border-primary/30 bg-primary/15 text-[11px] text-primary">
                {i + 1}
              </span>
              <s.icon className="size-4 text-muted-foreground" />
            </div>
            <p className="mt-3 text-sm font-semibold text-foreground">{s.title}</p>
            <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{s.text}</p>
          </div>
        ))}
      </div>
      <div className="mt-6 text-center">
        <button
          type="button"
          onClick={onRegister}
          className="inline-flex items-center gap-1.5 rounded-xl bg-gradient-brand px-4 py-2 text-sm font-medium text-primary-foreground transition hover:opacity-90"
        >
          <Plus className="size-4" />
          Register Server
        </button>
      </div>
    </div>
  );
}
