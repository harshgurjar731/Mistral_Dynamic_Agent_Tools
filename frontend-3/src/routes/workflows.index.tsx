import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Archive, GitBranch, Plus, RefreshCw, Search, X } from "lucide-react";
import { errorMessage, QK, workflowsApi, ontologyApi } from "@/api";
import type { AnnotationMap, Concept, WorkflowDefinition } from "@/types";
import { extractDomains } from "@/components/agents/AgentCard";
import { WorkflowCard } from "@/components/workflows/WorkflowCard";
import { WorkflowHistoryPanel } from "@/components/workflows/HistoryPanel";
import { DeployPackageModal } from "@/components/workflows/DeployPackageModal";
import { WorkflowClassificationModal } from "@/components/workflows/WorkflowClassificationModal";
import { WorkflowExecutionModal } from "@/components/workflows/WorkflowExecutionModal";
import { DomainFilterDropdown } from "@/components/ontology/DomainFilterDropdown";
import { buildDomainTree, expandedMatchSet, intersects } from "@/components/ontology/domainTree";
import { ErrorState } from "@/components/ui/ErrorState";
import { CardGridSkeleton } from "@/components/ui/Skeletons";
import { cn } from "@/lib/utils";

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

const secondaryButton =
  "inline-flex items-center gap-1.5 rounded-xl border border-border/60 px-3 py-2 text-xs font-medium text-muted-foreground transition hover:border-border hover:bg-surface-hover hover:text-foreground disabled:opacity-50";

function WorkflowsIndexPage() {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<Filter>("All");
  const [historyFor, setHistoryFor] = useState<string | null>(null);
  const [packageFor, setPackageFor] = useState<string | null>(null);
  const [classifyFor, setClassifyFor] = useState<string | null>(null);
  const [executeFor, setExecuteFor] = useState<string | null>(null);
  const [selectedDomains, setSelectedDomains] = useState<Set<string>>(new Set());

  const { data, isLoading, isError, error, refetch, isFetching } = useQuery({
    queryKey: QK.workflows(),
    queryFn: workflowsApi.list,
  });

  const domainConceptsQuery = useQuery({
    queryKey: QK.ontologyConcepts("domain"),
    queryFn: () => ontologyApi.concepts("domain"),
  });

  const domainConcepts: Concept[] = useMemo(() => {
    const d = domainConceptsQuery.data;
    if (Array.isArray(d)) return d;
    return d?.concepts ?? [];
  }, [domainConceptsQuery.data]);

  const domainLabelById = useMemo(
    () => new Map(domainConcepts.map((c) => [c.id, c.label])),
    [domainConcepts],
  );

  const tree = useMemo(() => buildDomainTree(domainConcepts), [domainConcepts]);
  const matchSet = useMemo(() => expandedMatchSet(tree, selectedDomains), [tree, selectedDomains]);

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

  const archivedCount = useMemo(
    () => (data?.workflows ?? []).filter((w) => w.archived).length,
    [data],
  );

  const names = useMemo(() => all.map((w) => w.name), [all]);

  const annotationsQuery = useQuery({
    // Keyed under ["ontology", "annotations"] so saving a classification refreshes the cards.
    queryKey: ["ontology", "annotations", "bulk", "workflow", names],
    queryFn: () => ontologyApi.annotationsBulk({ subject_type: "workflow", subject_ids: names }),
    enabled: names.length > 0,
  });

  const annotationMap = useMemo(
    () => (annotationsQuery.data ?? {}) as Record<string, AnnotationMap>,
    [annotationsQuery.data],
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
      .filter((w) => {
        if (selectedDomains.size === 0) return true;
        return intersects(extractDomains(annotationMap[w.name]), matchSet);
      })
      .filter(
        (w) =>
          !q || w.name.toLowerCase().includes(q) || (w.description ?? "").toLowerCase().includes(q),
      )
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [all, filter, search, selectedDomains, matchSet, annotationMap]);

  const busy = publish.isPending ? publish.variables : archive.isPending ? archive.variables : null;
  const filtersActive = Boolean(search.trim()) || filter !== "All" || selectedDomains.size > 0;

  return (
    <div className="px-6 py-8">
      {/* ── Header ── */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
            <span className="text-gradient-brand">Workflows</span>
          </h1>
          <p className="mt-1.5 max-w-2xl text-sm text-muted-foreground">
            Deterministic multi-step pipelines. Save keeps edits local; publish compiles the
            definition and registers it with the Mistral worker.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => refetch()}
            disabled={isFetching}
            className={secondaryButton}
          >
            <RefreshCw className={cn("size-3.5", isFetching && "animate-spin")} />
            Refresh
          </button>
          <Link to="/workflows/archived" className={secondaryButton}>
            <Archive className="size-3.5" />
            Archived{archivedCount ? ` (${archivedCount})` : ""}
          </Link>
          <Link
            to="/workflows/new"
            className="inline-flex items-center gap-1.5 rounded-xl bg-gradient-brand px-4 py-2.5 text-sm font-medium text-primary-foreground transition hover:opacity-90"
          >
            <Plus className="size-4" />
            New workflow
          </Link>
        </div>
      </div>

      {/* ── Filters ── */}
      <div className="mt-5 flex flex-wrap items-center gap-3 rounded-xl border border-border/40 bg-surface/20 px-4 py-3 backdrop-blur-sm">
        <div className="relative min-w-[220px] max-w-sm flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search workflows…"
            className="w-full rounded-lg border border-border/60 bg-background-elevated py-2 pr-3 pl-9 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </div>
        <DomainFilterDropdown
          concepts={domainConcepts}
          selected={selectedDomains}
          onChange={setSelectedDomains}
        />
        {selectedDomains.size > 0 && (
          <button
            type="button"
            onClick={() => setSelectedDomains(new Set())}
            className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-muted-foreground transition hover:bg-surface-hover hover:text-foreground"
          >
            <X className="size-3" />
            Clear ({selectedDomains.size})
          </button>
        )}
        <div className="flex flex-wrap items-center gap-1.5">
          {FILTERS.map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setFilter(f)}
              className={cn(
                "rounded-lg border px-3 py-1.5 text-xs font-medium transition",
                filter === f
                  ? "border-primary/40 bg-primary/10 text-primary"
                  : "border-border/60 text-muted-foreground hover:border-border hover:bg-surface-hover hover:text-foreground",
              )}
            >
              {f}
            </button>
          ))}
        </div>

        {all.length > 0 && (
          <span className="ml-auto text-xs text-muted-foreground/60 tabular-nums">
            {visible.length} of {all.length} workflow{all.length !== 1 ? "s" : ""}
          </span>
        )}
      </div>

      {/* ── Grid ── */}
      <div className="mt-8">
        {isLoading ? (
          <CardGridSkeleton />
        ) : isError ? (
          <ErrorState error={error} onRetry={() => refetch()} />
        ) : visible.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-border/60 py-20 text-center">
            <div className="relative mb-5">
              <div
                className="absolute -inset-8 rounded-full opacity-15 blur-2xl"
                style={{ background: "var(--gradient-brand)" }}
              />
              <div className="relative grid size-14 place-items-center rounded-2xl border border-border/60 glass">
                <GitBranch className="size-6 text-primary" />
              </div>
            </div>
            <h2 className="text-lg font-semibold tracking-tight text-foreground">
              {all.length === 0 ? "No workflows yet" : "Nothing matches this view"}
            </h2>
            <p className="mt-1.5 max-w-sm text-xs text-muted-foreground">
              {all.length === 0
                ? "Describe a goal and let the planner build one, or assemble the DAG by hand."
                : filtersActive
                  ? "Try a different filter or search term."
                  : "No active workflows."}
            </p>
            {all.length === 0 && (
              <Link
                to="/workflows/new"
                className="mt-5 inline-flex items-center gap-1.5 rounded-xl bg-gradient-brand px-4 py-2 text-sm font-medium text-primary-foreground transition hover:opacity-90"
              >
                <Plus className="size-4" />
                New workflow
              </Link>
            )}
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {visible.map((w) => (
              <WorkflowCard
                key={w.name}
                workflow={w}
                domains={extractDomains(annotationMap[w.name]).map(
                  (id) => domainLabelById.get(id) ?? id,
                )}
                busy={busy ?? null}
                onPublish={(n) => publish.mutate(n)}
                onArchive={(n) => archive.mutate(n)}
                onHistory={(n) => setHistoryFor(n)}
                onPackage={(n) => setPackageFor(n)}
                onClassify={(n) => setClassifyFor(n)}
                onExecuteModal={(n) => setExecuteFor(n)}
              />
            ))}
          </div>
        )}
      </div>

      <WorkflowHistoryPanel
        workflowName={historyFor}
        open={historyFor !== null}
        onOpenChange={(v) => !v && setHistoryFor(null)}
      />

      {packageFor && (
        <DeployPackageModal
          workflowName={packageFor}
          open={packageFor !== null}
          onOpenChange={(v) => !v && setPackageFor(null)}
        />
      )}

      {classifyFor && (
        <WorkflowClassificationModal
          workflowName={classifyFor}
          open={classifyFor !== null}
          onOpenChange={(v) => !v && setClassifyFor(null)}
        />
      )}

      {executeFor && (
        <WorkflowExecutionModal
          workflowName={executeFor}
          open={executeFor !== null}
          onOpenChange={(v) => !v && setExecuteFor(null)}
        />
      )}
    </div>
  );
}
