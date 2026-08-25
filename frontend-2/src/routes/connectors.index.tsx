import { useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plug, Plus, Search, Trash2, ArrowRight, Loader2 } from "lucide-react";
import { connectorsApi, QK, errorMessage } from "@/api";
import type { Connector } from "@/types";
import { GlassPanel, GlassPanelHeader } from "@/components/glass/GlassPanel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { CardGridSkeleton } from "@/components/ui/Skeletons";
import { StatusPill } from "@/components/ui/StatusPill";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";

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
    <GlassPanel className="flex flex-col p-4">
      <div className="flex items-start gap-3">
        {connector.icon_url ? (
          <img
            src={connector.icon_url}
            alt=""
            className="size-9 shrink-0 rounded-lg border border-border object-cover"
          />
        ) : (
          <div className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-border bg-muted/30">
            <Plug className="size-4 text-muted-foreground" />
          </div>
        )}
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-foreground">
            {connector.title ?? connector.name}
          </p>
          <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
            {connector.description}
          </p>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        <span className="rounded-full border border-border bg-muted/30 px-2 py-0.5 text-[10px] text-muted-foreground">
          {connector.protocol}
        </span>
        <span className="rounded-full border border-border bg-muted/30 px-2 py-0.5 text-[10px] text-muted-foreground">
          {visibilityLabel(String(connector.visibility))}
        </span>
        {connector.is_directory ? (
          <StatusPill
            identity={{ label: "Directory", text: "text-cyan", bg: "bg-cyan/10", border: "border-cyan/30" }}
            size="xs"
          />
        ) : null}
        <StatusPill
          identity={
            connector.is_authenticated
              ? { label: "Authenticated", text: "text-emerald", bg: "bg-emerald/10", border: "border-emerald/30" }
              : { label: "Not authenticated", text: "text-amber", bg: "bg-amber/10", border: "border-amber/30" }
          }
          size="xs"
        />
        <StatusPill
          identity={
            connector.active
              ? { label: "Active", text: "text-emerald", bg: "bg-emerald/10", border: "border-emerald/30", pulse: true }
              : { label: "Inactive", text: "text-slate", bg: "bg-slate/10", border: "border-slate/30" }
          }
          size="xs"
        />
        {connector.tool_count != null ? (
          <span className="rounded-full border border-border bg-muted/30 px-2 py-0.5 text-[10px] text-muted-foreground">
            {connector.tool_count} tools
          </span>
        ) : null}
      </div>

      <div className="mt-4 flex items-center gap-2 border-t border-border pt-3">
        <Button size="sm" variant="outline" asChild>
          <Link to="/connectors/$id" params={{ id: connector.id }}>
            Open <ArrowRight className="size-3.5" />
          </Link>
        </Button>
        {!connector.is_directory ? (
          <Button
            size="sm"
            variant="ghost"
            className="ml-auto text-red hover:text-red"
            onClick={() => remove.mutate()}
            disabled={remove.isPending}
          >
            {remove.isPending ? <Loader2 className="size-3.5 animate-spin" /> : <Trash2 className="size-3.5" />}
          </Button>
        ) : null}
      </div>
    </GlassPanel>
  );
}

function CreateConnectorDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
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
          <Input placeholder="name (e.g. github_app)" value={name} onChange={(e) => setName(e.target.value)} />
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

  const filtered = useMemo(() => {
    const items = query.data?.items ?? [];
    return items.filter((c) => {
      const matchesSearch =
        !search.trim() ||
        c.name.toLowerCase().includes(search.toLowerCase()) ||
        (c.title ?? "").toLowerCase().includes(search.toLowerCase()) ||
        c.description.toLowerCase().includes(search.toLowerCase());
      const matchesVisibility = visibility === "all" || c.visibility === visibility;
      return matchesSearch && matchesVisibility;
    });
  }, [query.data, search, visibility]);

  const visibilities = useMemo(() => {
    const set = new Set((query.data?.items ?? []).map((c) => String(c.visibility)));
    return Array.from(set);
  }, [query.data]);

  return (
    <div className="px-6 py-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">Connectors</h1>
          <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
            Mistral Connectors — MCP servers registered with Mistral, which holds their
            credentials and runs their tools. Distinct from the MCP Servers registry; the two
            share no state.
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)}>
          <Plus className="size-3.5" /> New Connector
        </Button>
      </div>

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <div className="relative min-w-64 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search connectors…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        {visibilities.length > 1 ? (
          <div className="flex flex-wrap gap-1.5">
            <Button size="sm" variant={visibility === "all" ? "secondary" : "outline"} onClick={() => setVisibility("all")}>
              All
            </Button>
            {visibilities.map((v) => (
              <Button
                key={v}
                size="sm"
                variant={visibility === v ? "secondary" : "outline"}
                onClick={() => setVisibility(v)}
              >
                {visibilityLabel(v)}
              </Button>
            ))}
          </div>
        ) : null}
      </div>

      <div className="mt-6">
        {query.isLoading ? (
          <CardGridSkeleton />
        ) : query.isError ? (
          <ErrorState error={query.error} title="Could not load connectors." onRetry={() => query.refetch()} />
        ) : filtered.length === 0 ? (
          <EmptyState icon={<Plug className="size-6" />} title="No connectors found." />
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {filtered.map((c) => (
              <ConnectorCard key={c.id} connector={c} />
            ))}
          </div>
        )}
      </div>

      {query.data?.next_cursor || pageStack.length > 1 ? (
        <div className="mt-6 flex items-center justify-center gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={pageStack.length <= 1}
            onClick={() => {
              const next = pageStack.slice(0, -1);
              setPageStack(next);
              setCursor(next[next.length - 1]);
            }}
          >
            Previous
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={!query.data?.next_cursor}
            onClick={() => {
              const nc = query.data?.next_cursor ?? undefined;
              if (!nc) return;
              setPageStack((s) => [...s, nc]);
              setCursor(nc);
            }}
          >
            Next
          </Button>
        </div>
      ) : null}

      <CreateConnectorDialog open={createOpen} onOpenChange={setCreateOpen} />
    </div>
  );
}
