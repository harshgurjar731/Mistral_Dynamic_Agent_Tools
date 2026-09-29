import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Archive, ArrowLeft, Search } from "lucide-react";
import { errorMessage, QK, workflowsApi } from "@/api";
import { PageHeader } from "@/components/shared/PageHeader";
import { WorkflowCard } from "@/components/workflows/WorkflowCard";
import { GlassPanel } from "@/components/glass/GlassPanel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { CardGridSkeleton } from "@/components/ui/Skeletons";
import type { WorkflowDefinition } from "@/types";
import { SortSelect } from "@/components/shared/SortSelect";
import { applySort, standardSorts, useSortKey } from "@/lib/sorting";
import { BulkActionBar, SelectableItem } from "@/components/shared/BulkSelection";
import { useBulkDelete, useBulkSelection } from "@/lib/bulkSelection";

export const Route = createFileRoute("/workflows/archived")({
  head: () => ({
    meta: [
      { title: "Archived workflows — Agentic AI Design Patterns" },
      { name: "description", content: "Workflows taken out of rotation, restorable at any time." },
      { property: "og:title", content: "Archived workflows — Agentic AI Design Patterns" },
      {
        property: "og:description",
        content: "Workflows taken out of rotation, restorable at any time.",
      },
    ],
  }),
  component: ArchivedWorkflowsPage,
});

const ARCHIVED_SORTS = standardSorts<WorkflowDefinition>(
  (w) => w.name,
  (w) => w.created_at,
);

function ArchivedWorkflowsPage() {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: QK.workflows(),
    queryFn: workflowsApi.list,
  });

  const unarchive = useMutation({
    mutationFn: (name: string) => workflowsApi.unarchive(name),
    onSuccess: () => {
      toast.success("Workflow restored.");
      qc.invalidateQueries({ queryKey: QK.workflows() });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const [sort, setSort] = useSortKey("workflows-archived", "name_asc");
  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    const rows = (data?.workflows ?? [])
      .filter((w) => w.archived)
      .filter((w) => !q || w.name.toLowerCase().includes(q));
    return applySort(rows, ARCHIVED_SORTS, sort);
  }, [data, search, sort]);

  const selection = useBulkSelection(
    visible,
    (w) => w.name,
    () => true,
    (w) => w.name,
  );
  const bulkDelete = useBulkDelete({
    noun: "workflow",
    deleteOne: (name) => workflowsApi.remove(name),
    invalidate: [QK.workflows()],
    selection,
  });

  return (
    <div className="space-y-6 px-6 py-8">
      <PageHeader
        eyebrow="Orchestration"
        title="Archived workflows"
        description="Archiving hides a workflow from the active list and archives it on the Mistral server too. Restoring puts it straight back."
        actions={
          <Button variant="outline" size="sm" asChild>
            <Link to="/workflows">
              <ArrowLeft className="size-3.5" /> Active workflows
            </Link>
          </Button>
        }
      />

      <GlassPanel className="flex flex-wrap items-center gap-2 p-3">
        <div className="relative min-w-[14rem] flex-1">
          <Search className="absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="pl-8"
            placeholder="Search archived workflows…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <SortSelect value={sort} onChange={setSort} options={ARCHIVED_SORTS} />
      </GlassPanel>

      {isLoading ? (
        <CardGridSkeleton count={3} />
      ) : isError ? (
        <ErrorState error={error} onRetry={() => refetch()} />
      ) : visible.length === 0 ? (
        <EmptyState
          icon={<Archive className="size-6" />}
          title="Nothing archived."
          description="Archived workflows show up here so they can be restored later."
        />
      ) : (
        <div>
          <BulkActionBar
            className="mb-4"
            selection={selection}
            noun="workflow"
            onDelete={bulkDelete.run}
            deleting={bulkDelete.running}
            warning="Deleted workflows cannot be restored. Only the workflows go — their agents, tools and activities are kept; their knowledge-graph links are removed."
          />
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {visible.map((w) => (
              <SelectableItem key={w.name} selection={selection} id={w.name} label={w.name}>
                <WorkflowCard
                  workflow={w}
                  busy={unarchive.isPending ? unarchive.variables : null}
                  onUnarchive={(n) => unarchive.mutate(n)}
                />
              </SelectableItem>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
