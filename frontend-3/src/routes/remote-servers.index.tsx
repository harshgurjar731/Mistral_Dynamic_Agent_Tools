import { useMemo, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { z } from "zod";
import {
  ArrowRight,
  Boxes,
  HardDrive,
  Loader2,
  Plus,
  RefreshCw,
  Search,
  Wrench,
  X,
  type LucideIcon,
} from "lucide-react";
import { QK, errorMessage } from "@/api";
import { remoteServersApi, type RemoteServer, type ServerPurpose } from "@/api/remoteServers";
import { AddServerCard, ServerCard } from "@/components/remote-servers/ServerCard";
import { STATE_TONE } from "@/components/remote-servers/status";
import { ErrorState } from "@/components/ui/ErrorState";
import { CardGridSkeleton } from "@/components/ui/Skeletons";
import { SortSelect } from "@/components/shared/SortSelect";
import { applySort, byDate, byText, useSortKey, type SortOption } from "@/lib/sorting";
import { cn } from "@/lib/utils";
import { BulkActionBar, SelectableItem } from "@/components/shared/BulkSelection";
import { useBulkDelete, useBulkSelection, type BulkSelection } from "@/lib/bulkSelection";

const searchSchema = z.object({
  purpose: z.enum(["tool", "workflow"]).optional(),
});

export const Route = createFileRoute("/remote-servers/")({
  validateSearch: searchSchema,
  head: () => ({
    meta: [
      { title: "Remote Servers — Agentic AI Design Patterns" },
      {
        name: "description",
        content: "Deployment targets for dynamic tools and workflow packages.",
      },
      { property: "og:title", content: "Remote Servers — Agentic AI Design Patterns" },
      {
        property: "og:description",
        content: "Deployment targets for dynamic tools and workflow packages.",
      },
    ],
  }),
  component: RemoteServersPage,
});

const STATUS_RANK: Record<string, number> = { unreachable: 0, degraded: 1, healthy: 3 };

const SORTS: SortOption<RemoteServer>[] = [
  { key: "name_asc", label: "Name A–Z", compare: byText((s) => s.name) },
  { key: "newest", label: "Newest first", compare: byDate((s) => s.created_at) },
  {
    key: "attention",
    label: "Needs attention",
    compare: (a, b) =>
      (STATUS_RANK[a.last_status ?? ""] ?? 2) - (STATUS_RANK[b.last_status ?? ""] ?? 2),
  },
];

interface PurposeMeta {
  value: ServerPurpose | undefined;
  title: string;
  description: string;
  icon: LucideIcon;
  accent: string;
}

const PURPOSES: PurposeMeta[] = [
  {
    value: undefined,
    title: "All servers",
    description: "Every deployment target",
    icon: HardDrive,
    accent: "text-primary bg-primary/10 border-primary/25",
  },
  {
    value: "workflow",
    title: "Workflow deployment",
    description: "VMs and endpoints that run workflow packages",
    icon: Boxes,
    accent: "text-cyan bg-cyan/10 border-cyan/25",
  },
  {
    value: "tool",
    title: "Tool deployment",
    description: "Endpoints that receive dynamic tool code",
    icon: Wrench,
    accent: "text-pink bg-pink/10 border-pink/25",
  },
];

type Health = { healthy: number; degraded: number; unreachable: number; unknown: number };

function healthOf(servers: RemoteServer[]): Health {
  const h: Health = { healthy: 0, degraded: 0, unreachable: 0, unknown: 0 };
  for (const s of servers) h[s.last_status ?? "unknown"] += 1;
  return h;
}

function RemoteServersPage() {
  const { purpose } = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [sort, setSort] = useSortKey("remote-servers", "name_asc");

  const query = useQuery({ queryKey: QK.remoteServers(), queryFn: () => remoteServersApi.list() });
  const all = useMemo(() => query.data ?? [], [query.data]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const rows = all.filter(
      (s) =>
        (!purpose || s.purpose === purpose) &&
        (!q || `${s.name} ${s.url} ${s.description} ${s.provider_label}`.toLowerCase().includes(q)),
    );
    return applySort(rows, SORTS, sort);
  }, [all, purpose, search, sort]);

  // One selection across every visible section.
  const selection = useBulkSelection(
    filtered,
    (s) => s.id,
    () => true,
    (s) => s.name,
  );
  const bulkDelete = useBulkDelete({
    noun: "server",
    deleteOne: (id) => remoteServersApi.remove(id),
    invalidate: [QK.remoteServers()],
    selection,
  });

  const checkAll = useMutation({
    mutationFn: () => remoteServersApi.checkAll(purpose),
    onSuccess: (r) => {
      const { healthy = 0, degraded = 0, unreachable = 0 } = r.summary;
      toast.success(
        `Checked: ${healthy} healthy, ${degraded} degraded, ${unreachable} unreachable.`,
      );
      qc.invalidateQueries({ queryKey: QK.remoteServers() });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  // With no filter and no search, group the grid by purpose.
  const sections: { purpose: ServerPurpose; title: string; rows: RemoteServer[] }[] =
    !purpose && !search.trim()
      ? (["workflow", "tool"] as const).map((p) => ({
          purpose: p,
          title: p === "workflow" ? "Workflow deployment" : "Tool deployment",
          rows: filtered.filter((s) => s.purpose === p),
        }))
      : [];

  return (
    <div className="px-6 py-8">
      {/* ── Header ── */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
            Remote <span className="text-gradient-brand">Servers</span>
          </h1>
          <p className="mt-1.5 max-w-2xl text-sm text-muted-foreground">
            Where dynamic tools and workflow packages get deployed. Add a VM or endpoint, check it,
            then deploy to it from a tool or a workflow.
          </p>
        </div>
        <Link
          to="/remote-servers/new"
          search={{ purpose }}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-xl bg-gradient-brand px-4 py-2.5 text-sm font-medium text-primary-foreground transition hover:opacity-90"
        >
          <Plus className="size-4" />
          Add Server
        </Link>
      </div>

      {query.isLoading ? (
        <div className="mt-8">
          <CardGridSkeleton />
        </div>
      ) : query.isError ? (
        <div className="mt-8">
          <ErrorState error={query.error} onRetry={() => query.refetch()} />
        </div>
      ) : all.length === 0 ? (
        <GetStarted />
      ) : (
        <>
          {/* ── Purpose cards (also the filter) ── */}
          <div className="mt-6 grid gap-4 md:grid-cols-3">
            {PURPOSES.map((p) => {
              const rows = all.filter((s) => !p.value || s.purpose === p.value);
              return (
                <PurposeCard
                  key={p.title}
                  meta={p}
                  count={rows.length}
                  health={healthOf(rows)}
                  selected={purpose === p.value}
                  onSelect={() => navigate({ search: { purpose: p.value } })}
                />
              );
            })}
          </div>

          {/* ── Toolbar ── */}
          <div className="mt-6 flex flex-wrap items-center gap-3 rounded-xl border border-border/40 bg-surface/20 px-4 py-3 backdrop-blur-sm">
            <div className="relative max-w-sm flex-1">
              <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search by name, address or provider…"
                className="w-full rounded-lg border border-border/60 bg-background-elevated py-2 pr-3 pl-9 text-sm text-foreground placeholder:text-muted-foreground focus:ring-1 focus:ring-primary focus:outline-none"
              />
            </div>
            <SortSelect value={sort} onChange={setSort} options={SORTS} />
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
              {filtered.length} of {all.length} server{all.length !== 1 ? "s" : ""}
            </span>
            <button
              type="button"
              onClick={() => checkAll.mutate()}
              disabled={checkAll.isPending}
              className="inline-flex items-center gap-1.5 rounded-lg border border-border/60 px-3 py-1.5 text-xs font-medium text-muted-foreground transition hover:bg-surface-hover hover:text-foreground disabled:opacity-50"
            >
              {checkAll.isPending ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <RefreshCw className="size-3.5" />
              )}
              Check {purpose ? "these" : "all"}
            </button>
          </div>

          {/* ── Cards ── */}
          <BulkActionBar
            className="mt-6"
            selection={selection}
            noun="server"
            onDelete={bulkDelete.run}
            deleting={bulkDelete.running}
            warning="Stored credentials for these servers are removed too."
          />
          {sections.length > 0 ? (
            <div className="mt-8 space-y-10">
              {sections.map((sec) => (
                <section key={sec.purpose}>
                  <div className="mb-4 flex items-center gap-3">
                    <h2 className="text-sm font-semibold text-foreground">{sec.title}</h2>
                    <span className="rounded-full border border-border/60 px-2 py-px text-[10px] text-muted-foreground tabular-nums">
                      {sec.rows.length}
                    </span>
                    <div className="h-px flex-1 bg-border/40" />
                    <button
                      type="button"
                      onClick={() => navigate({ search: { purpose: sec.purpose } })}
                      className="inline-flex items-center gap-1 text-[11px] text-muted-foreground transition hover:text-primary"
                    >
                      Only these <ArrowRight className="size-3" />
                    </button>
                  </div>
                  {sec.rows.length > 0 ? (
                    <CardGrid rows={sec.rows} addPurpose={sec.purpose} selection={selection} />
                  ) : (
                    <Link
                      to="/remote-servers/new"
                      search={{ purpose: sec.purpose }}
                      className="group flex items-center gap-3 rounded-2xl border border-dashed border-border/60 px-5 py-4 transition hover:border-primary/40 hover:bg-primary/5"
                    >
                      <div className="grid size-9 place-items-center rounded-lg border border-border/60 bg-background-elevated text-muted-foreground transition group-hover:text-primary">
                        <Plus className="size-4" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-foreground">
                          No {sec.title.toLowerCase()} servers yet
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {sec.purpose === "workflow"
                            ? "Add a VM or deploy endpoint to send workflow packages to."
                            : "Add an endpoint that receives dynamic tool code."}
                        </p>
                      </div>
                      <ArrowRight className="size-4 text-muted-foreground transition group-hover:translate-x-0.5 group-hover:text-primary" />
                    </Link>
                  )}
                </section>
              ))}
            </div>
          ) : filtered.length === 0 && search.trim() ? (
            <div className="mt-8 rounded-2xl border border-dashed border-border/60 py-16 text-center">
              <p className="text-sm font-medium text-foreground">No servers match</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Try a different name, address or provider.
              </p>
            </div>
          ) : (
            <div className="mt-8">
              <CardGrid
                rows={filtered}
                addPurpose={search.trim() ? null : purpose}
                selection={selection}
              />
            </div>
          )}
        </>
      )}
    </div>
  );
}

function CardGrid({
  rows,
  addPurpose,
  selection,
}: {
  rows: RemoteServer[];
  /** Purpose of the trailing "add" card; null hides it. */
  addPurpose: ServerPurpose | undefined | null;
  selection: BulkSelection;
}) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
      {rows.map((s) => (
        <SelectableItem key={s.id} selection={selection} id={s.id} label={s.name}>
          <ServerCard server={s} />
        </SelectableItem>
      ))}
      {addPurpose !== null ? <AddServerCard purpose={addPurpose} /> : null}
    </div>
  );
}

function PurposeCard({
  meta,
  count,
  health,
  selected,
  onSelect,
}: {
  meta: PurposeMeta;
  count: number;
  health: Health;
  selected: boolean;
  onSelect: () => void;
}) {
  const Icon = meta.icon;
  const segments = [
    { key: "healthy", n: health.healthy },
    { key: "degraded", n: health.degraded },
    { key: "unreachable", n: health.unreachable },
    { key: "unknown", n: health.unknown },
  ] as const;

  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={cn(
        "group relative flex flex-col rounded-2xl border p-5 text-left backdrop-blur-md transition-all duration-300",
        selected
          ? "border-primary/50 shadow-[0_0_28px_-10px_var(--primary)]"
          : "border-border/60 hover:border-primary/30",
      )}
      style={{ background: "var(--surface)" }}
    >
      <div className="flex items-start justify-between gap-3">
        <div className={cn("grid size-10 place-items-center rounded-xl border", meta.accent)}>
          <Icon className="size-5" />
        </div>
        <span className="text-3xl font-semibold text-foreground tabular-nums">{count}</span>
      </div>
      <p className="mt-3 text-sm font-semibold text-foreground">{meta.title}</p>
      <p className="mt-0.5 text-xs text-muted-foreground">{meta.description}</p>

      {/* Health bar */}
      <div className="mt-4 flex h-1.5 w-full gap-px overflow-hidden rounded-full bg-muted/50">
        {count > 0
          ? segments.map((seg) =>
              seg.n > 0 ? (
                <div
                  key={seg.key}
                  className={STATE_TONE[seg.key].dot}
                  style={{ width: `${(seg.n / count) * 100}%` }}
                />
              ) : null,
            )
          : null}
      </div>
      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-muted-foreground">
        {segments.map((seg) => (
          <span key={seg.key} className="inline-flex items-center gap-1">
            <span className={cn("size-1.5 rounded-full", STATE_TONE[seg.key].dot)} />
            {seg.n} {seg.key === "unknown" ? "not checked" : seg.key}
          </span>
        ))}
      </div>
    </button>
  );
}

/** First-run state: one card per kind of server to add. */
function GetStarted() {
  return (
    <div className="mt-10">
      <div className="mx-auto max-w-3xl text-center">
        <div className="mx-auto grid size-14 place-items-center rounded-2xl border border-border/60 glass">
          <HardDrive className="size-6 text-primary" />
        </div>
        <h2 className="mt-4 text-lg font-semibold tracking-tight text-foreground">
          No remote servers yet
        </h2>
        <p className="mt-1.5 text-sm text-muted-foreground">Choose what the first server is for.</p>
      </div>
      <div className="mx-auto mt-6 grid max-w-3xl gap-4 sm:grid-cols-2">
        {PURPOSES.filter((p) => p.value).map((p) => {
          const Icon = p.icon;
          return (
            <Link
              key={p.title}
              to="/remote-servers/new"
              search={{ purpose: p.value }}
              className="group flex flex-col rounded-2xl border border-border/60 p-5 transition hover:border-primary/40 hover:shadow-[0_0_28px_-10px_var(--primary)]"
              style={{ background: "var(--surface)" }}
            >
              <div className={cn("grid size-10 place-items-center rounded-xl border", p.accent)}>
                <Icon className="size-5" />
              </div>
              <p className="mt-3 text-sm font-semibold text-foreground">{p.title}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">{p.description}</p>
              <span className="mt-4 inline-flex items-center gap-1 text-xs font-medium text-primary">
                Add server <ArrowRight className="size-3 transition group-hover:translate-x-0.5" />
              </span>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
