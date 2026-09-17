import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Loader2, Search, Share2, X } from "lucide-react";
import { ontologyApi, QK } from "@/api";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { Skeleton } from "@/components/ui/Skeletons";
import { cn } from "@/lib/utils";
import type { OntologyGraphNode } from "@/types";
import { GraphCanvas, type SimpleEdge, type SimpleNode } from "./GraphCanvas";
import { TONE_VAR, type GraphTone } from "./graphTones";

const FILTERS = [
  { value: "all", label: "Everything", kinds: undefined },
  { value: "taxonomy", label: "Taxonomy", kinds: "scheme,concept" },
  { value: "resources", label: "Resources", kinds: "agent,tool,connector,workflow,library" },
] as const;

/** One colour per node kind, shared by the canvas, the legend and the inspector. */
const KIND_TONE: Record<string, GraphTone> = {
  scheme: "purple",
  concept: "indigo",
  agent: "emerald",
  tool: "amber",
  connector: "cyan",
  workflow: "blue",
  library: "orange",
};

const KIND_LABEL: Record<string, string> = {
  scheme: "Scheme",
  concept: "Concept",
  agent: "Agent",
  tool: "Tool",
  connector: "Connector",
  workflow: "Workflow",
  library: "Library",
};

const toneOf = (kind: string): GraphTone => KIND_TONE[kind] ?? "slate";

export function OverviewTab() {
  const [filter, setFilter] = useState<(typeof FILTERS)[number]["value"]>("all");
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const params = useMemo(() => {
    const p: Record<string, unknown> = {};
    const kinds = FILTERS.find((f) => f.value === filter)?.kinds;
    if (kinds) p["kinds"] = kinds;
    if (query) p["search"] = query;
    return p;
  }, [filter, query]);

  const { data, isLoading, isFetching, isError, error, refetch } = useQuery({
    queryKey: QK.ontologyGraph(params),
    queryFn: () => ontologyApi.graph(params),
  });

  const rawNodes = useMemo(() => data?.nodes ?? [], [data]);
  const rawEdges = useMemo(() => data?.edges ?? [], [data]);

  const nodes: SimpleNode[] = useMemo(
    () =>
      rawNodes.map((n) => ({
        id: n.id,
        label: n.label,
        sublabel: n.rollup_total
          ? `${KIND_LABEL[n.kind] ?? n.kind} · ${n.rollup_total} linked`
          : (KIND_LABEL[n.kind] ?? n.kind),
        tone: toneOf(n.kind),
      })),
    [rawNodes],
  );

  const edges: SimpleEdge[] = useMemo(
    () =>
      rawEdges.map((e) => ({
        id: e.id,
        source: e.source,
        target: e.target,
        label: e.label,
        dashed: e.reveal === "reverse",
      })),
    [rawEdges],
  );

  /** Only the kinds actually on screen get a legend swatch. */
  const presentKinds = useMemo(() => {
    const seen = new Set<string>();
    for (const n of rawNodes) seen.add(n.kind);
    return Object.keys(KIND_LABEL).filter((k) => seen.has(k));
  }, [rawNodes]);

  const selected = rawNodes.find((n) => n.id === selectedId) ?? null;
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setQuery(search.trim());
    setSelectedId(null);
  };

  if (isError) return <ErrorState error={error} onRetry={() => refetch()} />;

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
      {/* ── Canvas ── */}
      {isLoading ? (
        <Skeleton className="h-[38rem] rounded-2xl" />
      ) : nodes.length === 0 ? (
        <div className="flex h-[38rem] items-center justify-center rounded-2xl border border-dashed border-border/60">
          <EmptyState
            className="border-0 bg-transparent"
            icon={<Share2 className="size-5" />}
            title="Nothing to draw"
            description={
              query || filter !== "all"
                ? "No nodes match this filter or search."
                : "Seed or create a vocabulary and it will appear here."
            }
          />
        </div>
      ) : (
        <GraphCanvas
          nodes={nodes}
          edges={edges}
          selectedId={selectedId}
          onNodeClick={(id) => setSelectedId((cur) => (cur === id ? null : id))}
          onPaneClick={() => setSelectedId(null)}
          minimap
          className="h-[38rem]"
          toolbar={
            <div className="flex flex-wrap items-center gap-2">
              <form onSubmit={submit} className="relative">
                <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Find anything, then Enter…"
                  className="h-8 w-56 rounded-lg border border-border/60 bg-surface/80 pr-7 pl-8 text-xs text-foreground backdrop-blur-md placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                />
                {query ? (
                  <button
                    type="button"
                    onClick={() => {
                      setSearch("");
                      setQuery("");
                    }}
                    aria-label="Clear search"
                    className="absolute top-1/2 right-2 -translate-y-1/2 text-muted-foreground transition hover:text-foreground"
                  >
                    <X className="size-3" />
                  </button>
                ) : null}
              </form>

              <div className="inline-flex rounded-lg border border-border/60 bg-surface/80 p-0.5 backdrop-blur-md">
                {FILTERS.map((f) => (
                  <button
                    key={f.value}
                    type="button"
                    onClick={() => {
                      setFilter(f.value);
                      setSelectedId(null);
                    }}
                    className={cn(
                      "rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors",
                      filter === f.value
                        ? "bg-primary/15 text-primary"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {f.label}
                  </button>
                ))}
              </div>

              <span className="rounded-lg border border-border/60 bg-surface/80 px-2 py-1 text-[10px] tabular-nums text-muted-foreground backdrop-blur-md">
                {isFetching ? (
                  <Loader2 className="inline size-3 animate-spin" />
                ) : (
                  `${nodes.length} nodes · ${edges.length} links`
                )}
              </span>
            </div>
          }
          legend={
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-border/60 bg-surface/80 px-2.5 py-1.5 backdrop-blur-md">
              {presentKinds.map((k) => (
                <span
                  key={k}
                  className="flex items-center gap-1.5 text-[10px] text-muted-foreground"
                >
                  <span
                    className="size-1.5 rounded-full"
                    style={{ background: TONE_VAR[toneOf(k)] }}
                  />
                  {KIND_LABEL[k]}
                </span>
              ))}
              <span className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                <span className="inline-block h-px w-4 border-t border-dashed border-muted-foreground" />
                Reverse link
              </span>
            </div>
          }
        />
      )}

      {/* ── Inspector ── */}
      <NodeInspector
        node={selected}
        edges={rawEdges}
        nodes={rawNodes}
        onClose={() => setSelectedId(null)}
        onSelect={setSelectedId}
      />
    </div>
  );
}

function NodeInspector({
  node,
  nodes,
  edges,
  onClose,
  onSelect,
}: {
  node: OntologyGraphNode | null;
  nodes: OntologyGraphNode[];
  edges: { id: string; source: string; target: string; label: string }[];
  onClose: () => void;
  onSelect: (id: string) => void;
}) {
  const labelById = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);

  if (!node) {
    return (
      <aside className="hidden rounded-2xl border border-dashed border-border/60 p-5 xl:block">
        <p className="eyebrow mb-2">Inspector</p>
        <p className="text-xs leading-relaxed text-muted-foreground">
          Select a node to see how it is defined and everything it connects to. Selecting also fades
          the rest of the graph so its neighbourhood stands out.
        </p>
      </aside>
    );
  }

  const links = edges
    .filter((e) => e.source === node.id || e.target === node.id)
    .map((e) => {
      const otherId = e.source === node.id ? e.target : e.source;
      return {
        id: e.id,
        otherId,
        other: labelById.get(otherId),
        label: e.label,
        direction: e.source === node.id ? ("out" as const) : ("in" as const),
      };
    })
    .filter((l) => Boolean(l.other));

  const accent = TONE_VAR[toneOf(node.kind)];

  return (
    <aside className="flex max-h-[38rem] flex-col rounded-2xl border border-border/60 glass">
      <div className="flex items-start gap-2 border-b border-border/40 p-4">
        <span
          className="mt-1.5 size-2 shrink-0 rounded-full"
          style={{ background: accent, boxShadow: `0 0 8px -1px ${accent}` }}
        />
        <div className="min-w-0 flex-1">
          <p className="eyebrow" style={{ color: accent }}>
            {KIND_LABEL[node.kind] ?? node.kind}
          </p>
          <h3 className="mt-0.5 text-sm font-semibold break-words text-foreground">{node.label}</h3>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close inspector"
          className="grid size-6 shrink-0 place-items-center rounded-md text-muted-foreground transition hover:bg-surface-hover hover:text-foreground"
        >
          <X className="size-3.5" />
        </button>
      </div>

      <div className="custom-scrollbar min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
        {node.definition ? (
          <p className="text-xs leading-relaxed text-muted-foreground">{node.definition}</p>
        ) : null}

        {node.synonyms?.length ? (
          <div>
            <p className="eyebrow mb-1.5">Also known as</p>
            <div className="flex flex-wrap gap-1">
              {node.synonyms.map((s) => (
                <span
                  key={s}
                  className="rounded border border-border/60 bg-background-elevated px-1.5 py-0.5 text-[10px] text-muted-foreground"
                >
                  {s}
                </span>
              ))}
            </div>
          </div>
        ) : null}

        <dl className="space-y-1.5 text-xs">
          {node.tier ? <InspectorRow label="Tier" value={node.tier} /> : null}
          {node.model ? <InspectorRow label="Model" value={node.model} /> : null}
          {node.status ? <InspectorRow label="Status" value={node.status} /> : null}
          {typeof node.steps === "number" ? (
            <InspectorRow label="Steps" value={String(node.steps)} />
          ) : null}
          {typeof node.level === "number" ? (
            <InspectorRow label="Depth" value={String(node.level)} />
          ) : null}
          <InspectorRow label="Connections" value={String(node.degree)} />
        </dl>

        <div>
          <p className="eyebrow mb-2">Connected to ({links.length})</p>
          {links.length === 0 ? (
            <p className="text-[11px] text-muted-foreground">Nothing links to this node yet.</p>
          ) : (
            <ul className="space-y-1">
              {links.map((l) => (
                <li key={l.id}>
                  <button
                    type="button"
                    onClick={() => onSelect(l.otherId)}
                    className="flex w-full items-center gap-2 rounded-lg border border-border/40 px-2 py-1.5 text-left transition hover:border-primary/30 hover:bg-surface-hover"
                  >
                    <span
                      className="size-1.5 shrink-0 rounded-full"
                      style={{ background: TONE_VAR[toneOf(l.other!.kind)] }}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[11px] font-medium text-foreground">
                        {l.other!.label}
                      </span>
                      <span className="block truncate text-[10px] text-muted-foreground">
                        {l.direction === "out" ? "→ " : "← "}
                        {l.label}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </aside>
  );
}

function InspectorRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="truncate font-mono text-[11px] text-foreground">{value}</dd>
    </div>
  );
}
