import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Search } from "lucide-react";
import { ontologyApi, QK, errorMessage } from "@/api";
import { GlassPanel, GlassPanelHeader } from "@/components/glass/GlassPanel";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { DetailSkeleton } from "@/components/ui/Skeletons";
import { GraphCanvas, type SimpleNode, type SimpleEdge } from "./GraphCanvas";

const FILTERS = ["Everything", "Taxonomy", "Resources"] as const;

export function OverviewTab() {
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>("Everything");
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");

  const params = useMemo(() => {
    const p: Record<string, unknown> = {};
    if (filter === "Taxonomy") p['kinds'] = "scheme,concept";
    if (filter === "Resources") p['kinds'] = "agent,tool,connector,workflow,library";
    if (query) p['search'] = query;
    return p;
  }, [filter, query]);

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: QK.ontologyGraph(params),
    queryFn: () => ontologyApi.graph(params),
  });

  const nodes: SimpleNode[] = (data?.nodes ?? []).map((n) => ({
    id: n.id,
    label: n.label,
    sublabel: n.rollup_total ? `${n.rollup_total} linked` : n.kind,
    tone:
      n.kind === "scheme"
        ? "purple"
        : n.kind === "concept"
          ? "indigo"
          : n.kind === "agent"
            ? "emerald"
            : "cyan",
  }));
  const edges: SimpleEdge[] = (data?.edges ?? []).map((e) => ({
    id: e.id,
    source: e.source,
    target: e.target,
    label: e.label,
    dashed: e.reveal === "reverse",
  }));

  return (
    <GlassPanel>
      <GlassPanelHeader
        title="Ontology overview"
        description="A knowledge-graph canvas of the whole ontology."
        actions={
          <div className="flex items-center gap-2">
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
        }
      />
      <div className="space-y-3 p-4">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setQuery(search.trim());
          }}
          className="relative"
        >
          <Search className="absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="pl-8"
            placeholder="Find anything, then Enter…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </form>
        {isLoading ? (
          <DetailSkeleton />
        ) : isError ? (
          <ErrorState error={error} onRetry={() => refetch()} />
        ) : !data || nodes.length === 0 ? (
          <EmptyState title="No vocabulary loaded." description="Try a different filter or search." />
        ) : (
          <GraphCanvas nodes={nodes} edges={edges} className="h-[32rem]" />
        )}
      </div>
    </GlassPanel>
  );
}
