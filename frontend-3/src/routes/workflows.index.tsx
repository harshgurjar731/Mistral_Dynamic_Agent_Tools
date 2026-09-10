import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Archive, GitBranch, Plus, RefreshCw, Search } from "lucide-react";
import { errorMessage, QK, workflowsApi } from "@/api";
import type { WorkflowDefinition } from "@/types";
import { PageHeader, StatTile } from "@/components/shared/PageHeader";
import { WorkflowCard } from "@/components/workflows/WorkflowCard";
import { WorkflowHistoryPanel } from "@/components/workflows/HistoryPanel";
import { GlassPanel } from "@/components/glass/GlassPanel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { CardGridSkeleton } from "@/components/ui/Skeletons";

export const Route = createFileRoute("/workflows/")({
  head: () => ({
    meta: [
      { title: "Workflows — Agentic AI Design Patterns" },
      {
        name: "description",
        content: "Every workflow definition, its publish state and its runs.",
      },
      { property: "og:title", content: "Workflows — Agentic AI Design Patterns" },
      {
        property: "og:description",
        content: "Every workflow definition, its publish state and its runs.",
      },
    ],
  }),
  component: WorkflowsIndexPage,
});

const FILTERS = ["All", "Published", "Draft", "Unpublished edits"] as const;
type Filter = (typeof FILTERS)[number];

function WorkflowsIndexPage() {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<Filter>("All");
  const [historyFor, setHistoryFor] = useState<string | null>(null);

  const { data, isLoading, isError, error, refetch, isFetching } = useQuery({
    queryKey: QK.workflows(),
    queryFn: workflowsApi.list,
  });

  const publish = useMutation({
    mutationFn: (name: string) => workflowsApi.publish(name),
    onSuccess: (res) => {
      toast.success(String(res["message"] ?? "Workflow published"));
      qc.invalidateQueries({ queryKey: QK.workflows() });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const archive = useMutation({
    mutationFn: (name: string) => workflowsApi.archive(name),
    onSuccess: () => {
      toast.success("Workflow archived.");
      qc.invalidateQueries({ queryKey: QK.workflows() });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const all: WorkflowDefinition[] = useMemo(
    () => (data?.workflows ?? []).filter((w) => !w.archived),
    [data],
  );

  const counts = useMemo(
    () => ({
      total: all.length,
      published: all.filter((w) => w.is_deployed && !w.has_unpublished_changes).length,
      draft: all.filter((w) => !w.is_deployed).length,
      dirty: all.filter((w) => w.has_unpublished_changes).length,
      archived: (data?.workflows ?? []).filter((w) => w.archived).length,
    }),
    [all, data],
  );

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return all
      .filter((w) => {
        if (filter === "Published") return w.is_deployed && !w.has_unpublished_changes;
        if (filter === "Draft") return !w.is_deployed;
        if (filter === "Unpublished edits") return Boolean(w.has_unpublished_changes);
        return true;
      })
      .filter(
        (w) =>
          !q || w.name.toLowerCase().includes(q) || (w.description ?? "").toLowerCase().includes(q),
      )
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [all, filter, search]);

  const busy = publish.isPending ? publish.variables : archive.isPending ? archive.variables : null;

  return (
    <div className="space-y-6 px-6 py-8">
      <PageHeader
        eyebrow="Orchestration"
        title="Workflows"
        description="Deterministic multi-step pipelines. Save keeps edits local; publish compiles the definition and registers it with the Mistral worker."
        actions={
          <>
            <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
              <RefreshCw className={isFetching ? "size-3.5 animate-spin" : "size-3.5"} /> Refresh
            </Button>
            <Button variant="outline" size="sm" asChild>
              <Link to="/workflows/archived">
                <Archive className="size-3.5" /> Archived
                {counts.archived ? ` (${counts.archived})` : ""}
              </Link>
            </Button>
            <Button size="sm" asChild>
              <Link to="/workflows/new">
                <Plus className="size-3.5" /> New workflow
              </Link>
            </Button>
          </>
        }
      />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatTile label="Workflows" value={counts.total} />
        <StatTile label="Published" value={counts.published} tone="emerald" />
        <StatTile label="Drafts" value={counts.draft} tone="blue" />
        <StatTile label="Unpublished edits" value={counts.dirty} tone="amber" />
      </div>

      <GlassPanel className="flex flex-wrap items-center gap-2 p-3">
        <div className="relative min-w-[220px] flex-1">
          <Search className="absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="pl-8"
            placeholder="Search workflows…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {FILTERS.map((f) => (
            <Button
              key={f}
              size="sm"
              variant={filter === f ? "default" : "outline"}
              onClick={() => setFilter(f)}
            >
              {f}
            </Button>
          ))}
        </div>
      </GlassPanel>

      {isLoading ? (
        <CardGridSkeleton />
      ) : isError ? (
        <ErrorState error={error} onRetry={() => refetch()} />
      ) : visible.length === 0 ? (
        <EmptyState
          icon={<GitBranch className="size-6" />}
          title={all.length === 0 ? "No workflows yet." : "Nothing matches this view."}
          description={
            all.length === 0
              ? "Describe a goal and let the planner build one, or assemble the DAG by hand."
              : "Try a different filter or search term."
          }
          action={
            all.length === 0 ? (
              <Button size="sm" asChild>
                <Link to="/workflows/new">
                  <Plus className="size-3.5" /> New workflow
                </Link>
              </Button>
            ) : undefined
          }
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {visible.map((w) => (
            <WorkflowCard
              key={w.name}
              workflow={w}
              busy={busy ?? null}
              onPublish={(n) => publish.mutate(n)}
              onArchive={(n) => archive.mutate(n)}
              onHistory={(n) => setHistoryFor(n)}
            />
          ))}
        </div>
      )}

      <WorkflowHistoryPanel
        workflowName={historyFor}
        open={historyFor !== null}
        onOpenChange={(v) => !v && setHistoryFor(null)}
      />
    </div>
  );
}
