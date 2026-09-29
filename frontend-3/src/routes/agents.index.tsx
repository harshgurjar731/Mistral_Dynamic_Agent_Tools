import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bot, Layers, Plus, Search, Sparkles, X } from "lucide-react";
import { toast } from "sonner";
import { agentsApi, ontologyApi, QK } from "@/api";
import { errorMessage } from "@/api/client";
import type { AgentCreate } from "@/api/agents";
import type { Agent, AnnotationMap, Concept } from "@/types";
import { AgentCard, extractDomains } from "@/components/agents/AgentCard";
import { CreateAgentModal } from "@/components/agents/CreateAgentModal";
import { AgentClassificationModal } from "@/components/agents/AgentClassificationModal";
import { DomainFilterDropdown } from "@/components/ontology/DomainFilterDropdown";
import { CardGridSkeleton } from "@/components/ui/Skeletons";
import { ErrorState } from "@/components/ui/ErrorState";
import { SortSelect } from "@/components/shared/SortSelect";
import { useSortKey } from "@/lib/sorting";
import { BulkActionBar, SelectableItem } from "@/components/shared/BulkSelection";
import { useBulkDelete, useBulkSelection } from "@/lib/bulkSelection";

export const Route = createFileRoute("/agents/")({
  head: () => ({
    meta: [
      { title: "Agent Studio — Agentic AI Design Patterns" },
      { name: "description", content: "Create and manage specialized AI agents." },
      { property: "og:title", content: "Agent Studio — Agentic AI Design Patterns" },
      { property: "og:description", content: "Create and manage specialized AI agents." },
    ],
  }),
  component: AgentsIndexPage,
});

const PAGE_SIZE = 20;

/** Applied on the server across all agents, not just the visible page. */
const AGENT_SORTS = [
  { key: "newest", label: "Newest first" },
  { key: "oldest", label: "Oldest first" },
  { key: "name_asc", label: "Name A–Z" },
  { key: "name_desc", label: "Name Z–A" },
];

function AgentsIndexPage() {
  const [page, setPage] = useState(0);
  const [search, setSearch] = useState("");
  const [tierFilter, setTierFilter] = useState<string>("all");
  const [domainFilter, setDomainFilter] = useState<Set<string>>(new Set());
  const [createOpen, setCreateOpen] = useState(false);
  const [classifyAgent, setClassifyAgent] = useState<Agent | null>(null);
  const qc = useQueryClient();

  const [sort, setSortKey] = useSortKey("agents");
  const setSort = (key: string) => {
    setSortKey(key);
    setPage(0);
  };
  const agentsQuery = useQuery({
    queryKey: QK.agentsPage(page, PAGE_SIZE, sort),
    queryFn: () => agentsApi.list(page, PAGE_SIZE, sort),
  });

  const domainConceptsQuery = useQuery({
    queryKey: QK.ontologyConcepts("domain"),
    queryFn: () => ontologyApi.concepts("domain"),
  });
  const domainConcepts: Concept[] = Array.isArray(domainConceptsQuery.data)
    ? domainConceptsQuery.data
    : (domainConceptsQuery.data?.concepts ?? []);
  const domainLabelById = new Map(domainConcepts.map((c) => [c.id, c.label]));

  const ids = useMemo(() => (agentsQuery.data?.items ?? []).map((a) => a.id), [agentsQuery.data]);

  const annotationsQuery = useQuery({
    queryKey: ["agents", "annotations", ids],
    queryFn: () => ontologyApi.annotationsBulk({ subject_type: "agent", subject_ids: ids }),
    enabled: ids.length > 0,
  });

  const createMutation = useMutation({
    mutationFn: (body: AgentCreate) => agentsApi.create(body),
    onSuccess: () => {
      toast.success("Agent created");
      setCreateOpen(false);
      void qc.invalidateQueries({ queryKey: QK.agents() });
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => agentsApi.remove(id),
    onSuccess: () => {
      toast.success("Agent deleted");
      void qc.invalidateQueries({ queryKey: QK.agents() });
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  const annotationMap = (annotationsQuery.data ?? {}) as Record<string, AnnotationMap>;

  const filtered = (agentsQuery.data?.items ?? []).filter((a) => {
    if (search && !a.name.toLowerCase().includes(search.toLowerCase())) return false;
    if (tierFilter !== "all" && (a.tier ?? "foundation") !== tierFilter) return false;
    if (domainFilter.size > 0) {
      const doms = extractDomains(annotationMap[a.id]);
      if (!doms.some((d) => domainFilter.has(d))) return false;
    }
    return true;
  });

  // Selection covers the agents on this page that pass the filters.
  const selection = useBulkSelection(
    filtered,
    (a) => a.id,
    () => true,
    (a) => a.name,
  );
  const bulkDelete = useBulkDelete({
    noun: "agent",
    deleteOne: (id) => agentsApi.remove(id),
    invalidate: [QK.agents()],
    selection,
  });

  const totalAgents = agentsQuery.data?.items?.length ?? 0;
  const classifiedCount = (agentsQuery.data?.items ?? []).filter(
    (a) => extractDomains(annotationMap[a.id]).length > 0,
  ).length;

  return (
    <div className="px-6 py-8">
      {/* ── Header ── */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
            Agent <span className="text-gradient-brand">Studio</span>
          </h1>
          <p className="mt-1.5 text-sm text-muted-foreground">
            Create, configure, and manage your AI agents.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setCreateOpen(true)}
          className="inline-flex items-center gap-1.5 rounded-xl bg-gradient-brand px-4 py-2.5 text-sm font-medium text-primary-foreground transition hover:opacity-90"
        >
          <Plus className="size-4" />
          New Agent
        </button>
      </div>

      {/* ── Stats Bar ── */}
      {totalAgents > 0 && (
        <div className="mt-5 flex items-center gap-4 rounded-xl border border-border/40 bg-surface/30 px-4 py-2.5 backdrop-blur-sm">
          <div className="flex items-center gap-2">
            <div className="grid size-6 place-items-center rounded-md bg-primary/10 text-primary">
              <Bot className="size-3" />
            </div>
            <span className="text-xs font-medium text-foreground">{totalAgents}</span>
            <span className="text-[10px] text-muted-foreground/60">agents</span>
          </div>
          <div className="h-4 w-px bg-border/40" />
          <div className="flex items-center gap-2">
            <div className="grid size-6 place-items-center rounded-md bg-emerald/10 text-emerald">
              <Sparkles className="size-3" />
            </div>
            <span className="text-xs font-medium text-foreground">{classifiedCount}</span>
            <span className="text-[10px] text-muted-foreground/60">classified</span>
          </div>
          <div className="h-4 w-px bg-border/40" />
          <div className="flex items-center gap-2">
            <div className="grid size-6 place-items-center rounded-md bg-amber/10 text-amber">
              <Layers className="size-3" />
            </div>
            <span className="text-xs font-medium text-foreground">
              {totalAgents - classifiedCount}
            </span>
            <span className="text-[10px] text-muted-foreground/60">unclassified</span>
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
            placeholder="Search agents…"
            className="w-full rounded-lg border border-border/60 bg-background-elevated py-2 pr-3 pl-9 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </div>
        <SortSelect value={sort} onChange={setSort} options={AGENT_SORTS} />
        <select
          value={tierFilter}
          onChange={(e) => setTierFilter(e.target.value)}
          className="rounded-lg border border-border/60 bg-background-elevated px-3 py-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
        >
          <option value="all">All tiers</option>
          <option value="foundation">Foundation</option>
          <option value="domain">Domain</option>
          <option value="use_case">Use Case</option>
        </select>
        <DomainFilterDropdown
          concepts={domainConcepts}
          selected={domainFilter}
          onChange={setDomainFilter}
        />
        {domainFilter.size > 0 && (
          <button
            type="button"
            onClick={() => setDomainFilter(new Set())}
            className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-muted-foreground transition hover:bg-surface-hover hover:text-foreground"
          >
            <X className="size-3" />
            Clear ({domainFilter.size})
          </button>
        )}

        {/* Summary */}
        {totalAgents > 0 && (
          <span className="ml-auto text-xs text-muted-foreground/60 tabular-nums">
            {filtered.length} of {totalAgents} agent{totalAgents !== 1 ? "s" : ""}
          </span>
        )}
      </div>

      {/* ── Grid ── */}
      <div className="mt-8">
        {agentsQuery.isLoading ? (
          <CardGridSkeleton />
        ) : agentsQuery.isError ? (
          <ErrorState error={agentsQuery.error} onRetry={() => void agentsQuery.refetch()} />
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-border/60 py-20 text-center">
            <div className="relative mb-5">
              <div
                className="absolute -inset-8 rounded-full opacity-15 blur-2xl"
                style={{ background: "var(--gradient-brand)" }}
              />
              <div className="relative grid size-14 place-items-center rounded-2xl border border-border/60 glass">
                <Bot className="size-6 text-primary" />
              </div>
            </div>
            <h2 className="text-lg font-semibold tracking-tight text-foreground">
              No agents found
            </h2>
            <p className="mt-1.5 max-w-sm text-xs text-muted-foreground">
              {search || tierFilter !== "all" || domainFilter.size > 0
                ? "Try adjusting your filters or search query."
                : "Create your first agent to get started."}
            </p>
            {!search && tierFilter === "all" && domainFilter.size === 0 && (
              <button
                type="button"
                onClick={() => setCreateOpen(true)}
                className="mt-5 inline-flex items-center gap-1.5 rounded-xl bg-gradient-brand px-4 py-2 text-sm font-medium text-primary-foreground transition hover:opacity-90"
              >
                <Plus className="size-4" />
                New Agent
              </button>
            )}
          </div>
        ) : (
          <>
            <BulkActionBar
              className="mb-4"
              selection={selection}
              noun="agent"
              onDelete={bulkDelete.run}
              deleting={bulkDelete.running}
              warning="Only the agents are deleted — their tools, libraries and connectors are detached and kept. Their knowledge-graph links are removed. Workflow steps bound to a deleted agent stop working until they are rebound."
            />
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {filtered.map((agent) => (
                <SelectableItem
                  key={agent.id}
                  selection={selection}
                  id={agent.id}
                  label={agent.name}
                >
                  <AgentCard
                    agent={agent}
                    domains={extractDomains(annotationMap[agent.id]).map(
                      (id) => domainLabelById.get(id) ?? id,
                    )}
                    hasKnowledgeTool={(agent.tools ?? []).some((t) =>
                      JSON.stringify(t).includes("knowledge"),
                    )}
                    onDelete={(a) =>
                      window.confirm(`Delete agent "${a.name}"?`) && deleteMutation.mutate(a.id)
                    }
                    onClassify={(a) => setClassifyAgent(a)}
                  />
                </SelectableItem>
              ))}
            </div>
          </>
        )}
      </div>

      {/* ── Pagination ── */}
      {agentsQuery.data && agentsQuery.data.total_pages > 1 ? (
        <div className="mt-8 flex items-center justify-center gap-3">
          <button
            type="button"
            disabled={page === 0}
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            className="rounded-xl border border-border/60 bg-surface/30 px-4 py-2 text-xs font-medium text-muted-foreground backdrop-blur-sm transition hover:border-primary/30 hover:bg-surface-hover hover:text-foreground disabled:opacity-40"
          >
            Previous
          </button>
          <span className="rounded-lg bg-surface-elevated/50 px-3 py-1.5 text-xs tabular-nums text-muted-foreground">
            Page {page + 1} of {agentsQuery.data.total_pages}
          </span>
          <button
            type="button"
            disabled={page + 1 >= agentsQuery.data.total_pages}
            onClick={() => setPage((p) => p + 1)}
            className="rounded-xl border border-border/60 bg-surface/30 px-4 py-2 text-xs font-medium text-muted-foreground backdrop-blur-sm transition hover:border-primary/30 hover:bg-surface-hover hover:text-foreground disabled:opacity-40"
          >
            Next
          </button>
        </div>
      ) : null}

      <CreateAgentModal
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreate={(body) => createMutation.mutate(body)}
        isCreating={createMutation.isPending}
      />

      {classifyAgent && (
        <AgentClassificationModal
          agentId={classifyAgent.id}
          agentName={classifyAgent.name}
          open={Boolean(classifyAgent)}
          onOpenChange={(open) => {
            if (!open) {
              setClassifyAgent(null);
              void qc.invalidateQueries({ queryKey: ["agents", "annotations"] });
            }
          }}
        />
      )}
    </div>
  );
}
