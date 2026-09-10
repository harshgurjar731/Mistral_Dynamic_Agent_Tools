import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Search } from "lucide-react";
import { toast } from "sonner";
import { agentsApi, ontologyApi, QK } from "@/api";
import { errorMessage } from "@/api/client";
import type { AgentCreate } from "@/api/agents";
import { AgentCard, extractDomains } from "@/components/agents/AgentCard";
import { CreateAgentModal } from "@/components/agents/CreateAgentModal";
import { CardGridSkeleton } from "@/components/ui/Skeletons";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import type { AnnotationMap } from "@/types";

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

function AgentsIndexPage() {
  const [page, setPage] = useState(0);
  const [search, setSearch] = useState("");
  const [tierFilter, setTierFilter] = useState<string>("all");
  const [createOpen, setCreateOpen] = useState(false);
  const qc = useQueryClient();

  const agentsQuery = useQuery({
    queryKey: QK.agentsPage(page, PAGE_SIZE),
    queryFn: () => agentsApi.list(page, PAGE_SIZE),
  });

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
    return true;
  });

  return (
    <div className="px-6 py-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">Agent Studio</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Create and manage specialized AI agents.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setCreateOpen(true)}
          className="inline-flex items-center gap-1.5 rounded-xl bg-gradient-brand px-4 py-2 text-sm font-medium text-primary-foreground transition hover:opacity-90"
        >
          <Plus className="size-4" />
          Create New Agent
        </button>
      </div>

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <div className="relative max-w-sm flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search agents…"
            className="w-full rounded-xl border border-border bg-background-elevated py-2 pr-3 pl-9 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </div>
        <select
          value={tierFilter}
          onChange={(e) => setTierFilter(e.target.value)}
          className="rounded-xl border border-border bg-background-elevated px-3 py-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
        >
          <option value="all">All tiers</option>
          <option value="foundation">Foundation</option>
          <option value="domain">Domain</option>
          <option value="use_case">Use Case</option>
        </select>
      </div>

      <div className="mt-6">
        {agentsQuery.isLoading ? (
          <CardGridSkeleton />
        ) : agentsQuery.isError ? (
          <ErrorState error={agentsQuery.error} onRetry={() => void agentsQuery.refetch()} />
        ) : filtered.length === 0 ? (
          <EmptyState
            title="No agents found"
            description="Create your first agent to get started."
            action={
              <button
                type="button"
                onClick={() => setCreateOpen(true)}
                className="inline-flex items-center gap-1.5 rounded-xl bg-gradient-brand px-4 py-2 text-sm font-medium text-primary-foreground transition hover:opacity-90"
              >
                <Plus className="size-4" />
                Create New Agent
              </button>
            }
          />
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {filtered.map((agent) => (
              <AgentCard
                key={agent.id}
                agent={agent}
                domains={extractDomains(annotationMap[agent.id])}
                hasKnowledgeTool={(agent.tools ?? []).some((t) =>
                  JSON.stringify(t).includes("knowledge"),
                )}
                onDelete={(a) =>
                  window.confirm(`Delete agent "${a.name}"?`) && deleteMutation.mutate(a.id)
                }
              />
            ))}
          </div>
        )}
      </div>

      {agentsQuery.data && agentsQuery.data.total_pages > 1 ? (
        <div className="mt-6 flex items-center justify-center gap-3 text-xs text-muted-foreground">
          <button
            type="button"
            disabled={page === 0}
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            className="rounded-lg border border-border px-3 py-1.5 disabled:opacity-40"
          >
            Previous
          </button>
          <span>
            Page {page + 1} of {agentsQuery.data.total_pages}
          </span>
          <button
            type="button"
            disabled={page + 1 >= agentsQuery.data.total_pages}
            onClick={() => setPage((p) => p + 1)}
            className="rounded-lg border border-border px-3 py-1.5 disabled:opacity-40"
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
    </div>
  );
}
