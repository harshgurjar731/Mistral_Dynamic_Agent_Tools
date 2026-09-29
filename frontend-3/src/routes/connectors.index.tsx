import { useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plug, Plus, Search, Trash2, Loader2, Wrench, Shield, Eye, FolderOpen } from "lucide-react";
import { connectorsApi, QK, errorMessage } from "@/api";
import type { Connector } from "@/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { CardGridSkeleton } from "@/components/ui/Skeletons";
import { StatusPill } from "@/components/ui/StatusPill";
import { cn } from "@/lib/utils";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { CreatedAt } from "@/components/shared/CreatedAt";
import { SortSelect } from "@/components/shared/SortSelect";
import { applySort, byDate, standardSorts, useSortKey, type SortOption } from "@/lib/sorting";
import { BulkActionBar, SelectableItem } from "@/components/shared/BulkSelection";
import { useBulkDelete, useBulkSelection } from "@/lib/bulkSelection";

export const Route = createFileRoute("/connectors/")({
  head: () => ({
    meta: [
      { title: "Connectors — Agentic AI Design Patterns" },
      { name: "description", content: "Connector registry." },
      { property: "og:title", content: "Connectors — Agentic AI Design Patterns" },
      { property: "og:description", content: "Connector registry." },
    ],
  }),
  component: ConnectorsIndexPage,
});

function visibilityLabel(v: string): string {
  if (v === "shared_org") return "Organisation";
  if (v === "shared_workspace") return "Workspace";
  if (v === "shared_global") return "Global";
  if (v === "private") return "Private";
  return v;
}

const CONNECTOR_SORTS: SortOption<Connector>[] = [
  ...standardSorts<Connector>(
    (c) => c.title || c.name,
    (c) => c.created_at,
  ),
  { key: "modified", label: "Recently modified", compare: byDate((c) => c.modified_at) },
];

function ConnectorCard({ connector }: { connector: Connector }) {
  const qc = useQueryClient();
  const remove = useMutation({
    mutationFn: () => connectorsApi.remove(connector.id),
    onSuccess: () => {
      toast.success(`Deleted connector "${connector.name}".`);
      qc.invalidateQueries({ queryKey: QK.connectors() });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  return (
    <div
      className="group relative flex flex-col rounded-2xl border border-border/60 backdrop-blur-md transition-all duration-300 hover:border-primary/30 hover:shadow-[0_0_32px_-8px_var(--primary)]"
      style={{ background: "var(--surface)" }}
    >
      {/* Hover glow accent */}
      <div
        className="pointer-events-none absolute -inset-px rounded-2xl opacity-0 transition-opacity duration-300 group-hover:opacity-100"
        style={{
          background:
            "linear-gradient(135deg, oklch(0.65 0.18 200 / 0.06), oklch(0.71 0.14 220 / 0.04), transparent 70%)",
        }}
      />

      {/* Full-card clickable link */}
      <Link
        to="/connectors/$id"
        params={{ id: connector.id }}
        className="absolute inset-0 z-0 rounded-2xl"
        aria-label={connector.title ?? connector.name}
      />

      <div className="pointer-events-none relative z-[1] flex flex-col p-5">
        {/* Header */}
        <div className="flex items-start gap-3">
          {connector.icon_url ? (
            <img
              src={connector.icon_url}
              alt=""
              className="size-11 shrink-0 rounded-xl border border-border/60 object-cover transition-all duration-300 group-hover:border-primary/30 group-hover:shadow-[0_0_12px_-4px_var(--primary)]"
            />
          ) : (
            <div
              className={cn(
                "grid size-11 shrink-0 place-items-center rounded-xl border transition-all duration-300",
                "border-border/60 bg-background-elevated text-muted-foreground",
                "group-hover:border-primary/30 group-hover:bg-primary/10 group-hover:text-primary group-hover:shadow-[0_0_12px_-4px_var(--primary)]",
              )}
            >
              <Plug className="size-5" />
            </div>
          )}
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h3 className="truncate text-sm font-semibold text-foreground">
                {connector.title ?? connector.name}
              </h3>
              <StatusPill
                identity={
                  connector.active
                    ? {
                        label: "Active",
                        text: "text-emerald",
                        bg: "bg-emerald/10",
                        border: "border-emerald/30",
                        pulse: true,
                      }
                    : {
                        label: "Inactive",
                        text: "text-slate",
                        bg: "bg-slate/10",
                        border: "border-slate/30",
                      }
                }
                size="xs"
              />
            </div>
            <p className="mt-0.5 line-clamp-2 text-xs leading-relaxed text-muted-foreground/70">
              {connector.description || "No description provided"}
            </p>
          </div>
        </div>

        {/* Badges */}
        <div className="mt-3.5 flex flex-wrap items-center gap-1.5">
          <span className="inline-flex items-center gap-1 rounded-md border border-blue/20 bg-blue/8 px-1.5 py-0.5 font-mono text-[10px] text-blue uppercase">
            {connector.protocol}
          </span>
          <span className="inline-flex items-center gap-1 rounded-md border border-indigo/20 bg-indigo/8 px-1.5 py-0.5 text-[10px] font-medium text-indigo">
            <Eye className="size-2.5" />
            {visibilityLabel(String(connector.visibility))}
          </span>
          <StatusPill
            identity={
              connector.is_authenticated
                ? {
                    label: "Authenticated",
                    text: "text-emerald",
                    bg: "bg-emerald/10",
                    border: "border-emerald/30",
                  }
                : {
                    label: "Not authenticated",
                    text: "text-amber",
                    bg: "bg-amber/10",
                    border: "border-amber/30",
                  }
            }
            size="xs"
          />
          {connector.is_directory && (
            <span className="inline-flex items-center gap-1 rounded-md border border-cyan/20 bg-cyan/8 px-1.5 py-0.5 text-[10px] font-medium text-cyan">
              <FolderOpen className="size-2.5" />
              Directory
            </span>
          )}
          {connector.tool_count != null && (
            <span className="inline-flex items-center gap-1 rounded-md border border-pink/20 bg-pink/8 px-1.5 py-0.5 text-[10px] font-medium text-pink">
              <Wrench className="size-2.5" />
              {connector.tool_count} tool{connector.tool_count !== 1 ? "s" : ""}
            </span>
          )}
        </div>

        {/* Footer */}
        <div className="mt-3.5 flex items-center border-t border-border/40 pt-3.5">
          <CreatedAt value={connector.created_at} />
          {!connector.is_directory && (
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                if (window.confirm(`Delete connector "${connector.name}"?`)) {
                  remove.mutate();
                }
              }}
              className="pointer-events-auto ml-auto rounded-md px-1.5 py-0.5 text-[10px] font-medium text-red/50 opacity-0 transition hover:bg-red/10 hover:text-red group-hover:opacity-100"
            >
              {remove.isPending ? (
                <Loader2 className="size-3 animate-spin" />
              ) : (
                <Trash2 className="size-3" />
              )}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function CreateConnectorDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [server, setServer] = useState("");
  const [iconUrl, setIconUrl] = useState("");

  const create = useMutation({
    mutationFn: () =>
      connectorsApi.create({
        name,
        description,
        server,
        ...(iconUrl ? { icon_url: iconUrl } : {}),
      }),
    onSuccess: () => {
      toast.success(`Connector "${name}" created.`);
      setName("");
      setDescription("");
      setServer("");
      setIconUrl("");
      onOpenChange(false);
      qc.invalidateQueries({ queryKey: QK.connectors() });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New Connector</DialogTitle>
        </DialogHeader>
        <div className="space-y-2">
          <Input
            placeholder="name (e.g. github_app)"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <Textarea
            placeholder="Read and write GitHub issues and pull requests."
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={2}
          />
          <Input
            placeholder="server (https://mcp.example.com/sse)"
            value={server}
            onChange={(e) => setServer(e.target.value)}
          />
          <Input
            placeholder="icon_url (optional)"
            value={iconUrl}
            onChange={(e) => setIconUrl(e.target.value)}
          />
        </div>
        <DialogFooter>
          <Button
            onClick={() => create.mutate()}
            disabled={!name.trim() || !description.trim() || !server.trim() || create.isPending}
          >
            {create.isPending ? <Loader2 className="size-3.5 animate-spin" /> : null}
            Create
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ConnectorsIndexPage() {
  const [search, setSearch] = useState("");
  const [visibility, setVisibility] = useState<string>("all");
  const [createOpen, setCreateOpen] = useState(false);
  const [cursor, setCursor] = useState<string | undefined>(undefined);
  const [pageStack, setPageStack] = useState<Array<string | undefined>>([undefined]);

  const query = useQuery({
    queryKey: [...QK.connectors(), cursor ?? "first"],
    queryFn: () => connectorsApi.list({ page_size: 200, ...(cursor ? { cursor } : {}) }),
  });

  const [sort, setSort] = useSortKey("connectors");
  const filtered = useMemo(() => {
    const items = query.data?.items ?? [];
    const rows = items.filter((c) => {
      const matchesSearch =
        !search.trim() ||
        c.name.toLowerCase().includes(search.toLowerCase()) ||
        (c.title ?? "").toLowerCase().includes(search.toLowerCase()) ||
        c.description.toLowerCase().includes(search.toLowerCase());
      const matchesVisibility = visibility === "all" || c.visibility === visibility;
      return matchesSearch && matchesVisibility;
    });
    return applySort(rows, CONNECTOR_SORTS, sort);
  }, [query.data, search, visibility, sort]);

  // Directory connectors belong to the Mistral catalogue and cannot be deleted.
  const selection = useBulkSelection(
    filtered,
    (c) => c.id,
    (c) => !c.is_directory,
    (c) => c.name,
  );
  const bulkDelete = useBulkDelete({
    noun: "connector",
    deleteOne: (id) => connectorsApi.remove(id),
    invalidate: [QK.connectors()],
    selection,
  });

  const visibilities = useMemo(() => {
    const set = new Set((query.data?.items ?? []).map((c) => String(c.visibility)));
    return Array.from(set);
  }, [query.data]);

  const totalConnectors = (query.data?.items ?? []).length;
  const activeCount = (query.data?.items ?? []).filter((c) => c.active).length;

  return (
    <div className="px-6 py-8">
      {/* ── Header ── */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
            Connector <span className="text-gradient-brand">Registry</span>
          </h1>
          <p className="mt-1.5 text-sm text-muted-foreground">
            Manage MCP connectors registered with Mistral.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setCreateOpen(true)}
          className="inline-flex items-center gap-1.5 rounded-xl bg-gradient-brand px-4 py-2.5 text-sm font-medium text-primary-foreground transition hover:opacity-90"
        >
          <Plus className="size-4" />
          New Connector
        </button>
      </div>

      {/* ── Stats Bar ── */}
      {totalConnectors > 0 && (
        <div className="mt-5 flex items-center gap-4 rounded-xl border border-border/40 bg-surface/30 px-4 py-2.5 backdrop-blur-sm">
          <div className="flex items-center gap-2">
            <div className="grid size-6 place-items-center rounded-md bg-primary/10 text-primary">
              <Plug className="size-3" />
            </div>
            <span className="text-xs font-medium text-foreground">{totalConnectors}</span>
            <span className="text-[10px] text-muted-foreground/60">connectors</span>
          </div>
          <div className="h-4 w-px bg-border/40" />
          <div className="flex items-center gap-2">
            <div className="grid size-6 place-items-center rounded-md bg-emerald/10 text-emerald">
              <Shield className="size-3" />
            </div>
            <span className="text-xs font-medium text-foreground">{activeCount}</span>
            <span className="text-[10px] text-muted-foreground/60">active</span>
          </div>
        </div>
      )}

      {/* ── Filters ── */}
      <div className="mt-5 flex flex-wrap items-center gap-3 rounded-xl border border-border/40 bg-surface/20 px-4 py-3 backdrop-blur-sm">
        <div className="relative max-w-sm flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search connectors…"
            className="w-full rounded-lg border border-border/60 bg-background-elevated py-2 pr-3 pl-9 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </div>
        <SortSelect value={sort} onChange={setSort} options={CONNECTOR_SORTS} />
        {visibilities.length > 1 && (
          <div className="flex flex-wrap gap-1.5">
            <button
              type="button"
              onClick={() => setVisibility("all")}
              className={cn(
                "rounded-lg border px-3 py-1.5 text-xs font-medium transition",
                visibility === "all"
                  ? "border-primary/30 bg-primary/10 text-primary"
                  : "border-border/60 bg-background-elevated text-muted-foreground hover:border-primary/20 hover:text-foreground",
              )}
            >
              All
            </button>
            {visibilities.map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => setVisibility(v)}
                className={cn(
                  "rounded-lg border px-3 py-1.5 text-xs font-medium transition",
                  visibility === v
                    ? "border-primary/30 bg-primary/10 text-primary"
                    : "border-border/60 bg-background-elevated text-muted-foreground hover:border-primary/20 hover:text-foreground",
                )}
              >
                {visibilityLabel(v)}
              </button>
            ))}
          </div>
        )}

        {totalConnectors > 0 && (
          <span className="ml-auto text-xs text-muted-foreground/60 tabular-nums">
            {filtered.length} of {totalConnectors} connector{totalConnectors !== 1 ? "s" : ""}
          </span>
        )}
      </div>

      {/* ── Grid ── */}
      <div className="mt-8">
        {query.isLoading ? (
          <CardGridSkeleton />
        ) : query.isError ? (
          <ErrorState
            error={query.error}
            title="Could not load connectors."
            onRetry={() => query.refetch()}
          />
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-border/60 py-20 text-center">
            <div className="relative mb-5">
              <div
                className="absolute -inset-8 rounded-full opacity-15 blur-2xl"
                style={{ background: "var(--gradient-brand)" }}
              />
              <div className="relative grid size-14 place-items-center rounded-2xl border border-border/60 glass">
                <Plug className="size-6 text-primary" />
              </div>
            </div>
            <h2 className="text-lg font-semibold tracking-tight text-foreground">
              No connectors found
            </h2>
            <p className="mt-1.5 max-w-sm text-xs text-muted-foreground">
              {search || visibility !== "all"
                ? "Try adjusting your filters or search query."
                : "Register your first connector to get started."}
            </p>
            {!search && visibility === "all" && (
              <button
                type="button"
                onClick={() => setCreateOpen(true)}
                className="mt-5 inline-flex items-center gap-1.5 rounded-xl bg-gradient-brand px-4 py-2 text-sm font-medium text-primary-foreground transition hover:opacity-90"
              >
                <Plus className="size-4" />
                New Connector
              </button>
            )}
          </div>
        ) : (
          <>
            <BulkActionBar
              className="mb-4"
              selection={selection}
              noun="connector"
              onDelete={bulkDelete.run}
              deleting={bulkDelete.running}
              warning="Agents and workflow steps using these connectors lose access to them. Their knowledge-graph links are removed. Directory connectors cannot be selected."
            />
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {filtered.map((c) => (
                <SelectableItem key={c.id} selection={selection} id={c.id} label={c.name}>
                  <ConnectorCard connector={c} />
                </SelectableItem>
              ))}
            </div>
          </>
        )}
      </div>

      {/* ── Pagination ── */}
      {query.data?.next_cursor || pageStack.length > 1 ? (
        <div className="mt-8 flex items-center justify-center gap-3">
          <button
            type="button"
            disabled={pageStack.length <= 1}
            onClick={() => {
              const next = pageStack.slice(0, -1);
              setPageStack(next);
              setCursor(next[next.length - 1]);
            }}
            className="rounded-xl border border-border/60 bg-surface/30 px-4 py-2 text-xs font-medium text-muted-foreground backdrop-blur-sm transition hover:border-primary/30 hover:bg-surface-hover hover:text-foreground disabled:opacity-40"
          >
            Previous
          </button>
          <button
            type="button"
            disabled={!query.data?.next_cursor}
            onClick={() => {
              const nc = query.data?.next_cursor ?? undefined;
              if (!nc) return;
              setPageStack((s) => [...s, nc]);
              setCursor(nc);
            }}
            className="rounded-xl border border-border/60 bg-surface/30 px-4 py-2 text-xs font-medium text-muted-foreground backdrop-blur-sm transition hover:border-primary/30 hover:bg-surface-hover hover:text-foreground disabled:opacity-40"
          >
            Next
          </button>
        </div>
      ) : null}

      <CreateConnectorDialog open={createOpen} onOpenChange={setCreateOpen} />
    </div>
  );
}
