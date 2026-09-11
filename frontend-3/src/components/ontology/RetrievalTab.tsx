import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import type { Concept } from "@/types";
import {
  AlertCircle,
  Database,
  FileText,
  Loader2,
  Network,
  Plug,
  Search,
  Sparkles,
} from "lucide-react";
import { errorMessage, ontologyApi, ragApi } from "@/api";
import { GlassPanel, GlassPanelHeader } from "@/components/glass/GlassPanel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { EmptyState } from "@/components/ui/EmptyState";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

export function RetrievalTab() {
  const [query, setQuery] = useState("");
  const [libraryId, setLibraryId] = useState("");
  const [domain, setDomain] = useState("");

  const { data: overview } = useQuery({
    queryKey: ["rag", "overview"],
    queryFn: ragApi.overview,
    staleTime: 30_000,
  });

  const { data: domainConcepts } = useQuery({
    queryKey: ["ontology", "concepts", "domain"],
    queryFn: () => ontologyApi.concepts("domain"),
    staleTime: 300_000,
  });

  const searchMutation = useMutation({
    mutationFn: () =>
      ragApi.search({
        query,
        ...(libraryId ? { library_ids: [libraryId] } : {}),
        hops: 2,
        limit: 12,
      }),
  });

  const syncAgentsMutation = useMutation({
    mutationFn: ragApi.syncAgents,
    onSuccess: (res) => {
      toast.success(
        res.synced !== undefined
          ? `Synced search_domain_knowledge tool to ${res.synced} agents`
          : "Sync complete",
      );
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const libraries = overview?.libraries ?? [];
  const concepts: Concept[] = useMemo(() => {
    if (!domainConcepts) return [];
    if (Array.isArray(domainConcepts)) return domainConcepts;
    return domainConcepts.concepts ?? [];
  }, [domainConcepts]);
  const searchData = searchMutation.data;

  return (
    <div className="space-y-4">
      <GlassPanel className="p-4">
        <div className="flex flex-wrap items-center justify-between gap-3 pb-3">
          <div>
            <span className="text-sm font-semibold text-foreground">
              Retrieval & Hybrid Search Bench
            </span>
            <p className="text-xs text-muted-foreground mt-0.5">
              Simulate the queries agents execute via <code>search_domain_knowledge</code> against
              the graph and document libraries.
            </p>
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={() => syncAgentsMutation.mutate()}
            disabled={syncAgentsMutation.isPending}
            className="flex items-center gap-1.5"
            title="Attach search_domain_knowledge tool to agents with libraries"
          >
            {syncAgentsMutation.isPending ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Plug className="size-3.5 text-cyan" />
            )}
            Sync Tool to Agents
          </Button>
        </div>

        <div className="flex flex-wrap gap-2.5">
          <div className="relative min-w-[280px] flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && query.trim() && searchMutation.mutate()}
              placeholder="Ask what an agent would ask (e.g., Which suppliers are bound to Contoso?)"
              className="pl-8 text-xs"
            />
          </div>

          <select
            value={libraryId}
            onChange={(e) => setLibraryId(e.target.value)}
            className="h-9 rounded-md border border-input bg-background-elevated/70 px-2.5 text-xs text-foreground"
          >
            <option value="">All libraries</option>
            {libraries.map((lib) => (
              <option key={lib.id} value={lib.id}>
                {lib.name}
              </option>
            ))}
          </select>

          <select
            value={domain}
            onChange={(e) => setDomain(e.target.value)}
            className="max-w-[200px] h-9 rounded-md border border-input bg-background-elevated/70 px-2.5 text-xs text-foreground"
          >
            <option value="">All domains</option>
            {concepts.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </select>

          <Button
            size="sm"
            onClick={() => searchMutation.mutate()}
            disabled={!query.trim() || searchMutation.isPending}
            className="flex items-center gap-1.5"
          >
            {searchMutation.isPending ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Search className="size-3.5" />
            )}
            Search
          </Button>
        </div>
      </GlassPanel>

      {searchMutation.isError && (
        <div className="flex items-start gap-2.5 rounded-xl border border-red/30 bg-red/10 p-3.5 text-xs text-red">
          <AlertCircle className="mt-0.5 size-4 shrink-0" />
          <div>
            <p className="font-semibold">Retrieval Error</p>
            <p className="mt-1 font-mono text-[11px]">{errorMessage(searchMutation.error)}</p>
          </div>
        </div>
      )}

      {searchData && (
        <div className="grid gap-4 md:grid-cols-2">
          {/* Graph results */}
          <GlassPanel>
            <GlassPanelHeader
              title="Graph Entities Matched"
              description={`${searchData.entities?.length ?? 0} entities found`}
            />
            <div className="custom-scrollbar max-h-[420px] space-y-2 overflow-y-auto p-4">
              {(!searchData.entities || searchData.entities.length === 0) ? (
                <EmptyState title="No graph entities matched" description="Try broadening your search query." />
              ) : (
                searchData.entities.map((e, idx) => (
                  <div
                    key={idx}
                    className="rounded-lg border border-border bg-background-elevated/50 p-3"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold text-xs text-foreground">{e.name}</span>
                      <span className="technical-label">{e.type}</span>
                    </div>
                    {e.description && (
                      <p className="mt-1 text-xs text-muted-foreground">{e.description}</p>
                    )}
                  </div>
                ))
              )}
            </div>
          </GlassPanel>

          {/* Text/passages matched */}
          <GlassPanel>
            <GlassPanelHeader
              title="Passages & Document Matches"
              description={`${searchData.passages?.length ?? 0} passages retrieved`}
            />
            <div className="custom-scrollbar max-h-[420px] space-y-2 overflow-y-auto p-4">
              {(!searchData.passages || searchData.passages.length === 0) ? (
                <EmptyState title="No text passages matched" />
              ) : (
                searchData.passages.map((p, idx) => (
                  <div
                    key={idx}
                    className="rounded-lg border border-border bg-background-elevated/50 p-3"
                  >
                    <div className="flex items-center justify-between gap-2 pb-1 text-[10px] text-muted-foreground">
                      <span className="truncate font-mono">{p.filename || p.doc_id}</span>
                      <span className="font-mono tabular-nums">Chunk {p.chunk_index}</span>
                    </div>
                    <p className="text-xs text-foreground leading-relaxed italic">
                      "{p.quote || p.description}"
                    </p>
                  </div>
                ))
              )}
            </div>
          </GlassPanel>
        </div>
      )}
    </div>
  );
}
