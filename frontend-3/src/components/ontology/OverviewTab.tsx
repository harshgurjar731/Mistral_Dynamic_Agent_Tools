import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
  Crosshair,
  ExternalLink,
  Eye,
  EyeOff,
  Filter,
  GitBranch,
  ListTree,
  Loader2,
  Network,
  Orbit,
  Search,
  Share2,
  X,
} from "lucide-react";
import { ontologyApi, QK } from "@/api";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { Skeleton } from "@/components/ui/Skeletons";
import { cn } from "@/lib/utils";
import type { OntologyGraphEdge, OntologyGraphNode } from "@/types";
import {
  CanvasCard,
  GraphCanvas,
  type GraphLayout,
  type SimpleEdge,
  type SimpleNode,
} from "./GraphCanvas";
import { kindColor, kindLabel } from "./graphTones";

const EMPTY_PARAMS = {};

/**
 * The levels this graph draws, outermost last: an industry holds domains, a
 * domain holds subdomains, and the agents and workflows that serve them hang
 * off whichever level they are annotated against. Tools, connectors,
 * libraries and the rest are left out — they belong to their own pages.
 */
const LEVELS = ["industry", "domain", "subdomain", "agent", "workflow"];

/** The radial layout colours by ring, innermost first, rather than by kind. */
const RING_COLORS = [
  "var(--blue)",
  "var(--emerald)",
  "var(--purple)",
  "var(--amber)",
  "var(--orange)",
];

interface HierarchyFilter {
  industry: string;
  domain: string;
  subdomain: string;
}
const NO_FILTER: HierarchyFilter = { industry: "", domain: "", subdomain: "" };

/** Which level a node sits on; anything unknown sorts last. */
const levelOf = (kind: string) => {
  const i = LEVELS.indexOf(kind);
  return i < 0 ? LEVELS.length : i;
};

export function OverviewTab() {
  const [layout, setLayout] = useState<GraphLayout>("network");
  const [hidden, setHidden] = useState<Set<string>>(() => new Set());
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [focusIds, setFocusIds] = useState<string[] | null>(null);
  /** When set, only this node's branch — its parents and everything under it — is drawn. */
  const [branch, setBranch] = useState<string | null>(null);
  /** Cascading filter; an empty string means "All" at that level. */
  const [filter, setFilter] = useState<HierarchyFilter>(NO_FILTER);

  const { data, isLoading, isFetching, isError, error, refetch } = useQuery({
    queryKey: QK.ontologyGraph(EMPTY_PARAMS),
    queryFn: () => ontologyApi.graph(EMPTY_PARAMS),
  });

  const rawNodes = useMemo(
    () => (data?.nodes ?? []).filter((n) => LEVELS.includes(n.kind)),
    [data],
  );
  const rawEdges = useMemo(() => {
    const ids = new Set(rawNodes.map((n) => n.id));
    return (data?.edges ?? []).filter((e) => ids.has(e.source) && ids.has(e.target));
  }, [data, rawNodes]);

  /** Parent per node — the neighbour one level up — and its children. */
  const tree = useMemo(() => {
    const byId = new Map(rawNodes.map((n) => [n.id, n]));
    const neighbours = new Map<string, string[]>();
    for (const e of rawEdges) {
      neighbours.set(e.source, [...(neighbours.get(e.source) ?? []), e.target]);
      neighbours.set(e.target, [...(neighbours.get(e.target) ?? []), e.source]);
    }
    const parent = new Map<string, string | null>();
    const children = new Map<string, string[]>();
    for (const n of rawNodes) {
      const level = levelOf(n.kind);
      let best: { id: string; level: number } | null = null;
      for (const id of neighbours.get(n.id) ?? []) {
        const other = byId.get(id);
        if (!other) continue;
        const otherLevel = levelOf(other.kind);
        if (
          otherLevel < level &&
          (!best || otherLevel > best.level || (otherLevel === best.level && id < best.id))
        ) {
          best = { id, level: otherLevel };
        }
      }
      parent.set(n.id, best?.id ?? null);
      if (best) children.set(best.id, [...(children.get(best.id) ?? []), n.id]);
    }
    return { parent, children };
  }, [rawNodes, rawEdges]);

  /** A node, everything under it, and the line of parents above it. */
  const branchOf = (id: string) => {
    const ids = new Set<string>([id]);
    const walkDown = (from: string) => {
      for (const child of tree.children.get(from) ?? []) {
        if (ids.has(child)) continue;
        ids.add(child);
        walkDown(child);
      }
    };
    walkDown(id);
    let up = tree.parent.get(id) ?? null;
    while (up && !ids.has(up)) {
      ids.add(up);
      up = tree.parent.get(up) ?? null;
    }
    return ids;
  };

  /** The levels present, top of the hierarchy first, with how many nodes each holds. */
  const kinds = useMemo(() => {
    const counts = new Map<string, number>();
    for (const n of rawNodes) counts.set(n.kind, (counts.get(n.kind) ?? 0) + 1);
    return LEVELS.filter((kind) => counts.has(kind)).map((kind) => ({
      kind,
      count: counts.get(kind) ?? 0,
    }));
  }, [rawNodes]);

  /** A kind's colour on the canvas: by kind, or by ring when drawn radially. */
  const colorFor = useMemo(() => {
    if (layout !== "radial") return kindColor;
    const shown = kinds.map((k) => k.kind).filter((kind) => !hidden.has(kind));
    return (kind: string) => {
      const ring = shown.indexOf(kind);
      return ring < 0 ? kindColor(kind) : RING_COLORS[ring % RING_COLORS.length]!;
    };
  }, [layout, kinds, hidden]);

  /** True when `ancestor` sits somewhere above `id` in the tree. */
  const isUnder = (id: string, ancestor: string) => {
    let up = tree.parent.get(id) ?? null;
    while (up) {
      if (up === ancestor) return true;
      up = tree.parent.get(up) ?? null;
    }
    return false;
  };

  /**
   * The choices for each dropdown, each narrowed by the ones above it: pick
   * an industry and only its domains are offered, and so on down.
   */
  const filterOptions = useMemo(() => {
    const ofKind = (kind: string, keep: (id: string) => boolean) =>
      rawNodes
        .filter((n) => n.kind === kind && keep(n.id))
        .sort((a, b) => a.label.localeCompare(b.label))
        .map((n) => ({ id: n.id, label: n.label }));
    const inIndustry = (id: string) => !filter.industry || isUnder(id, filter.industry);
    return {
      industry: ofKind("industry", () => true),
      domain: ofKind("domain", inIndustry),
      subdomain: ofKind("subdomain", (id) =>
        filter.domain ? isUnder(id, filter.domain) : inIndustry(id),
      ),
    };
    // isUnder reads `tree`, which is derived from the same nodes and edges.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rawNodes, tree, filter.industry, filter.domain]);

  /** The most specific filter picked; the graph shrinks to its branch. */
  const filterRoot = filter.subdomain || filter.domain || filter.industry;

  const visible = useMemo(() => {
    const inBranch = branch ? branchOf(branch) : null;
    const inFilter = filterRoot ? branchOf(filterRoot) : null;
    return rawNodes.filter(
      (n) =>
        !hidden.has(n.kind) &&
        (!inBranch || inBranch.has(n.id)) &&
        (!inFilter || inFilter.has(n.id)),
    );
    // branchOf reads `tree`, which is derived from the same nodes and edges.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rawNodes, hidden, branch, filterRoot, tree]);

  const nodes: SimpleNode[] = useMemo(
    () =>
      visible.map((n) => ({
        id: n.id,
        label: n.label,
        sublabel: (() => {
          const kids = tree.children.get(n.id)?.length ?? 0;
          return kids ? `${kindLabel(n.kind)} · ${kids} below` : kindLabel(n.kind);
        })(),
        color: colorFor(n.kind),
        group: n.kind,
        weight: n.degree,
      })),
    [visible, tree, colorFor],
  );

  const edges: SimpleEdge[] = useMemo(
    () =>
      rawEdges.map((e) => {
        const from = rawNodes.find((n) => n.id === e.source);
        return {
          id: e.id,
          source: e.source,
          target: e.target,
          label: e.label,
          dashed: e.reveal === "reverse",
          // Coloured by where the link starts, so a line reads at a glance.
          color: from ? `color-mix(in oklch, ${kindColor(from.kind)} 70%, transparent)` : undefined,
        };
      }),
    [rawEdges, rawNodes],
  );

  const visibleEdgeCount = useMemo(() => {
    const ids = new Set(visible.map((n) => n.id));
    return rawEdges.filter((e) => ids.has(e.source) && ids.has(e.target)).length;
  }, [visible, rawEdges]);

  const term = search.trim().toLowerCase();
  const matches = useMemo(() => {
    if (!term) return [];
    return visible.filter(
      (n) =>
        n.label.toLowerCase().includes(term) ||
        n.id.toLowerCase().includes(term) ||
        n.synonyms?.some((s) => s.toLowerCase().includes(term)),
    );
  }, [visible, term]);
  const highlightIds = useMemo(
    () => (term ? new Set(matches.map((m) => m.id)) : null),
    [term, matches],
  );

  const select = (id: string | null, zoom = false) => {
    setSelectedId(id);
    if (!id) return;
    if (hidden.size) {
      const kind = rawNodes.find((n) => n.id === id)?.kind;
      if (kind && hidden.has(kind)) {
        setHidden((h) => {
          const next = new Set(h);
          next.delete(kind);
          return next;
        });
      }
    }
    if (zoom) setFocusIds(neighbourhood(id, rawEdges));
  };

  const toggleKind = (kind: string) => {
    setHidden((h) => {
      const next = new Set(h);
      if (next.has(kind)) next.delete(kind);
      else next.add(kind);
      return next;
    });
    setSelectedId(null);
  };

  const selected = rawNodes.find((n) => n.id === selectedId) ?? null;

  if (isError) return <ErrorState error={error} onRetry={() => refetch()} />;
  if (isLoading) return <Skeleton className="h-full min-h-[24rem] rounded-2xl" />;
  if (rawNodes.length === 0) {
    return (
      <div className="flex h-full min-h-[24rem] items-center justify-center rounded-2xl border border-dashed border-border/60">
        <EmptyState
          className="border-0 bg-transparent"
          icon={<Share2 className="size-5" />}
          title="Nothing to draw"
          description="Seed or create a vocabulary and it will appear here."
        />
      </div>
    );
  }

  return (
    <GraphCanvas
      nodes={nodes}
      edges={edges}
      layout={layout}
      nodeStyle="dot"
      wheelZoom
      elastic
      groupLabel={kindLabel}
      groupOrder={LEVELS}
      selectedId={selectedId}
      highlightIds={highlightIds}
      focusIds={focusIds}
      onNodeClick={(id) => select(selectedId === id ? null : id)}
      onNodeDoubleClick={(id) => select(id, true)}
      onPaneClick={() => setSelectedId(null)}
      className="h-full flex-1"
      empty={
        <EmptyState
          className="border-0 bg-transparent"
          icon={<EyeOff className="size-5" />}
          title="Every kind is hidden"
          description="Turn a kind back on in the key to draw it."
        />
      }
      toolbar={
        <div className="flex flex-wrap items-start gap-2">
          <SearchBox
            value={search}
            onChange={setSearch}
            matches={matches}
            onPick={(id) => {
              select(id, true);
            }}
            onSubmit={() => {
              if (matches.length) setFocusIds(matches.slice(0, 40).map((m) => m.id));
            }}
          />
          <div className="inline-flex rounded-lg border border-border/60 bg-background-elevated/90 p-0.5 backdrop-blur-md">
            {(
              [
                { value: "network", label: "Network", icon: Network },
                { value: "hierarchy", label: "Levels", icon: ListTree },
                { value: "radial", label: "Radial", icon: Orbit },
              ] as const
            ).map((l) => (
              <button
                key={l.value}
                type="button"
                onClick={() => setLayout(l.value)}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors",
                  layout === l.value
                    ? "bg-primary/15 text-primary"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                <l.icon className="size-3.5" />
                {l.label}
              </button>
            ))}
          </div>
          <HierarchyFilterBar
            value={filter}
            options={filterOptions}
            onChange={(next) => {
              setFilter(next);
              setSelectedId(null);
            }}
          />
          <span className="inline-flex h-8 items-center rounded-lg border border-border/60 bg-background-elevated/90 px-2.5 text-[11px] text-muted-foreground tabular-nums backdrop-blur-md">
            {isFetching ? (
              <Loader2 className="size-3 animate-spin" />
            ) : (
              `${nodes.length} nodes · ${visibleEdgeCount} links`
            )}
          </span>
          {branch ? (
            <span className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-primary/40 bg-primary/10 py-0.5 pr-1 pl-2.5 text-[11px] text-primary backdrop-blur-md">
              <GitBranch className="size-3" />
              <span className="max-w-[12rem] truncate">
                {rawNodes.find((n) => n.id === branch)?.label ?? branch}
              </span>
              <button
                type="button"
                onClick={() => setBranch(null)}
                aria-label="Show the whole graph"
                title="Show the whole graph"
                className="grid size-5 place-items-center rounded-md hover:bg-primary/20"
              >
                <X className="size-3" />
              </button>
            </span>
          ) : null}
        </div>
      }
      legend={
        <CanvasCard title="Kinds" defaultOpen={false} className="w-52">
          <ul className="custom-scrollbar max-h-[40vh] space-y-0.5 overflow-y-auto">
            {kinds.map(({ kind, count }) => {
              const off = hidden.has(kind);
              return (
                <li key={kind}>
                  <button
                    type="button"
                    onClick={() => toggleKind(kind)}
                    aria-pressed={!off}
                    title={off ? `Show ${kindLabel(kind)}` : `Hide ${kindLabel(kind)}`}
                    className={cn(
                      "flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-left text-[11px] transition hover:bg-surface-hover",
                      off ? "text-muted-foreground/50" : "text-foreground",
                    )}
                  >
                    <span
                      className="size-2.5 shrink-0 rounded-full border"
                      style={{
                        borderColor: colorFor(kind),
                        background: off ? "transparent" : colorFor(kind),
                      }}
                    />
                    <span className="min-w-0 flex-1 truncate">{kindLabel(kind)}</span>
                    <span className="font-mono text-[10px] text-muted-foreground tabular-nums">
                      {count}
                    </span>
                    {off ? <EyeOff className="size-3" /> : <Eye className="size-3 opacity-40" />}
                  </button>
                </li>
              );
            })}
          </ul>
          <div className="mt-2 flex items-center gap-2 border-t border-border/50 pt-2 text-[10px]">
            <button
              type="button"
              onClick={() => setHidden(new Set())}
              className="text-muted-foreground hover:text-foreground"
            >
              Show all
            </button>
            <span className="ml-auto flex items-center gap-1.5 text-muted-foreground">
              <span className="inline-block h-px w-4 border-t border-dashed border-muted-foreground" />
              Reverse link
            </span>
          </div>
        </CanvasCard>
      }
      inspector={
        selected ? (
          <NodeInspector
            node={selected}
            edges={rawEdges}
            nodes={rawNodes}
            tree={tree}
            onClose={() => setSelectedId(null)}
            onSelect={(id) => select(id, true)}
            onFocus={() => setFocusIds(neighbourhood(selected.id, rawEdges))}
            branched={branch === selected.id}
            onBranch={() => setBranch((current) => (current === selected.id ? null : selected.id))}
            below={tree.children.get(selected.id)?.length ?? 0}
          />
        ) : null
      }
    />
  );
}

function neighbourhood(id: string, edges: OntologyGraphEdge[]): string[] {
  const ids = new Set([id]);
  for (const e of edges) {
    if (e.source === id) ids.add(e.target);
    if (e.target === id) ids.add(e.source);
  }
  return [...ids];
}

type FilterOption = { id: string; label: string };

/**
 * Industry → domain → subdomain dropdowns. Changing a level clears the ones
 * below it, since their choices depend on it; "All" leaves a level open.
 */
function HierarchyFilterBar({
  value,
  options,
  onChange,
}: {
  value: HierarchyFilter;
  options: Record<keyof HierarchyFilter, FilterOption[]>;
  onChange: (next: HierarchyFilter) => void;
}) {
  const levels: {
    key: keyof HierarchyFilter;
    label: string;
    all: string;
    clears: (keyof HierarchyFilter)[];
  }[] = [
    { key: "industry", label: "industry", all: "All industries", clears: ["domain", "subdomain"] },
    { key: "domain", label: "domain", all: "All domains", clears: ["subdomain"] },
    { key: "subdomain", label: "subdomain", all: "All subdomains", clears: [] },
  ];
  const active = Boolean(value.industry || value.domain || value.subdomain);
  return (
    <div
      className={cn(
        "inline-flex h-8 items-center gap-0.5 rounded-lg border bg-background-elevated/90 p-0.5 backdrop-blur-md",
        active ? "border-primary/40" : "border-border/60",
      )}
    >
      <Filter className="mx-1.5 size-3.5 text-muted-foreground" aria-hidden />
      {levels.map(({ key, label, all, clears }) => {
        const list = options[key];
        return (
          <select
            key={key}
            value={value[key]}
            aria-label={`Filter by ${label}`}
            title={`Filter by ${label}`}
            disabled={list.length === 0 && !value[key]}
            onChange={(e) => {
              const next = { ...value, [key]: e.target.value };
              for (const below of clears) next[below] = "";
              onChange(next);
            }}
            className={cn(
              "h-7 max-w-[10rem] truncate rounded-md border-0 bg-transparent px-1.5 text-[11px] focus:ring-1 focus:ring-primary focus:outline-none disabled:opacity-40",
              value[key] ? "font-medium text-primary" : "text-foreground",
            )}
          >
            <option value="">{all}</option>
            {list.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </select>
        );
      })}
      {active ? (
        <button
          type="button"
          onClick={() => onChange(NO_FILTER)}
          aria-label="Clear filters"
          title="Clear filters"
          className="grid size-6 place-items-center rounded-md text-muted-foreground transition hover:bg-surface-hover hover:text-foreground"
        >
          <X className="size-3" />
        </button>
      ) : null}
    </div>
  );
}

function SearchBox({
  value,
  onChange,
  matches,
  onPick,
  onSubmit,
}: {
  value: string;
  onChange: (v: string) => void;
  matches: OntologyGraphNode[];
  onPick: (id: string) => void;
  onSubmit: () => void;
}) {
  const [open, setOpen] = useState(false);
  const shown = matches.slice(0, 8);
  return (
    <div className="relative">
      <Search className="pointer-events-none absolute top-1/2 left-2.5 z-10 size-3.5 -translate-y-1/2 text-muted-foreground" />
      <input
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => window.setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            onSubmit();
            setOpen(false);
          }
          if (e.key === "Escape") setOpen(false);
        }}
        placeholder="Find a node…"
        aria-label="Find a node"
        className="h-8 w-60 rounded-lg border border-border/60 bg-background-elevated/90 pr-7 pl-8 text-xs text-foreground backdrop-blur-md placeholder:text-muted-foreground focus:ring-1 focus:ring-primary focus:outline-none"
      />
      {value ? (
        <button
          type="button"
          onClick={() => onChange("")}
          aria-label="Clear search"
          className="absolute top-1/2 right-2 -translate-y-1/2 text-muted-foreground transition hover:text-foreground"
        >
          <X className="size-3" />
        </button>
      ) : null}
      {open && value.trim() ? (
        <div className="absolute top-full left-0 z-20 mt-1 w-72 overflow-hidden rounded-lg border border-border-strong bg-popover/95 shadow-[var(--shadow-panel)] backdrop-blur-xl">
          {shown.length === 0 ? (
            <p className="px-3 py-2 text-[11px] text-muted-foreground">No node matches.</p>
          ) : (
            <>
              {shown.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => {
                    onPick(m.id);
                    setOpen(false);
                  }}
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-left transition hover:bg-surface-hover"
                >
                  <span
                    className="size-2 shrink-0 rounded-full"
                    style={{ background: kindColor(m.kind) }}
                  />
                  <span className="min-w-0 flex-1 truncate text-xs text-foreground">{m.label}</span>
                  <span className="text-[10px] text-muted-foreground">{kindLabel(m.kind)}</span>
                </button>
              ))}
              <p className="border-t border-border/50 px-3 py-1.5 text-[10px] text-muted-foreground">
                {matches.length} match{matches.length === 1 ? "" : "es"} · Enter zooms to all
              </p>
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}

function NodeInspector({
  node,
  nodes,
  edges,
  tree,
  onClose,
  onSelect,
  onFocus,
  onBranch,
  branched,
  below,
}: {
  node: OntologyGraphNode;
  nodes: OntologyGraphNode[];
  edges: OntologyGraphEdge[];
  tree: { parent: Map<string, string | null>; children: Map<string, string[]> };
  onClose: () => void;
  onSelect: (id: string) => void;
  onFocus: () => void;
  onBranch: () => void;
  branched: boolean;
  below: number;
}) {
  const byId = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);

  /** The chain above this node, outermost level first. */
  const ancestors = useMemo(() => {
    const chain: OntologyGraphNode[] = [];
    let up = tree.parent.get(node.id) ?? null;
    while (up) {
      const parent = byId.get(up);
      if (!parent) break;
      chain.unshift(parent);
      up = tree.parent.get(up) ?? null;
    }
    return chain;
  }, [node.id, tree, byId]);

  const children = useMemo(
    () =>
      (tree.children.get(node.id) ?? [])
        .map((id) => byId.get(id))
        .filter((n): n is OntologyGraphNode => Boolean(n))
        .sort((a, b) => levelOf(a.kind) - levelOf(b.kind) || a.label.localeCompare(b.label)),
    [node.id, tree, byId],
  );

  const links = edges
    .filter((e) => e.source === node.id || e.target === node.id)
    .map((e) => {
      const otherId = e.source === node.id ? e.target : e.source;
      return {
        id: e.id,
        otherId,
        other: byId.get(otherId),
        label: e.label,
        direction: e.source === node.id ? ("out" as const) : ("in" as const),
      };
    })
    .filter((l) => Boolean(l.other));

  /** Everything the hierarchy sections do not already show. */
  const shown = new Set([...ancestors.map((a) => a.id), ...children.map((c) => c.id)]);
  const others = links.filter((l) => !shown.has(l.otherId));

  const accent = kindColor(node.kind);

  return (
    <aside className="flex max-h-full min-h-0 flex-col rounded-2xl border border-border/60 bg-background-elevated/95 shadow-[var(--shadow-panel)] backdrop-blur-xl">
      <div className="flex items-start gap-2 border-b border-border/40 p-4">
        <span
          className="mt-1.5 size-2.5 shrink-0 rounded-full"
          style={{ background: accent, boxShadow: `0 0 8px -1px ${accent}` }}
        />
        <div className="min-w-0 flex-1">
          <p className="eyebrow" style={{ color: accent }}>
            {kindLabel(node.kind)}
          </p>
          <h3 className="mt-0.5 text-sm font-semibold break-words text-foreground">{node.label}</h3>
        </div>
        {below ? (
          <button
            type="button"
            onClick={onBranch}
            aria-label={branched ? "Show the whole graph" : "Show only this branch"}
            title={branched ? "Show the whole graph" : `Show only this branch (${below} below)`}
            className={cn(
              "grid size-6 shrink-0 place-items-center rounded-md transition hover:bg-surface-hover",
              branched ? "text-primary" : "text-muted-foreground hover:text-foreground",
            )}
          >
            <GitBranch className="size-3.5" />
          </button>
        ) : null}
        <button
          type="button"
          onClick={onFocus}
          aria-label="Zoom to neighbourhood"
          title="Zoom to neighbourhood"
          className="grid size-6 shrink-0 place-items-center rounded-md text-muted-foreground transition hover:bg-surface-hover hover:text-foreground"
        >
          <Crosshair className="size-3.5" />
        </button>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close details"
          className="grid size-6 shrink-0 place-items-center rounded-md text-muted-foreground transition hover:bg-surface-hover hover:text-foreground"
        >
          <X className="size-3.5" />
        </button>
      </div>

      {node.subject_type === "agent" || node.subject_type === "workflow" ? (
        <div className="border-b border-border/40 px-4 py-2.5">
          <Link
            to={node.subject_type === "agent" ? "/agents/$id" : "/workflows/$workflowName"}
            params={
              node.subject_type === "agent"
                ? { id: node.subject_id ?? "" }
                : { workflowName: node.subject_id ?? "" }
            }
            className="inline-flex items-center gap-1.5 text-[11px] font-medium text-primary transition hover:underline"
          >
            <ExternalLink className="size-3" />
            Open this {node.subject_type}
          </Link>
        </div>
      ) : null}

      <div className="custom-scrollbar min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
        {node.definition || node.description ? (
          <p className="text-xs leading-relaxed text-muted-foreground">
            {node.definition ?? node.description}
          </p>
        ) : null}

        {node.synonyms?.length ? (
          <div>
            <p className="eyebrow mb-1.5">Also known as</p>
            <div className="flex flex-wrap gap-1">
              {node.synonyms.map((s) => (
                <span
                  key={s}
                  className="rounded border border-border/60 bg-background px-1.5 py-0.5 text-[10px] text-muted-foreground"
                >
                  {s}
                </span>
              ))}
            </div>
          </div>
        ) : null}

        {ancestors.length ? (
          <div>
            <p className="eyebrow mb-1.5">Sits under</p>
            <ol className="space-y-1">
              {ancestors.map((a, i) => (
                <li key={a.id} style={{ paddingLeft: `${i * 10}px` }}>
                  <button
                    type="button"
                    onClick={() => onSelect(a.id)}
                    className="flex w-full items-center gap-1.5 rounded-md px-1.5 py-1 text-left transition hover:bg-surface-hover"
                  >
                    <span
                      className="size-1.5 shrink-0 rounded-full"
                      style={{ background: kindColor(a.kind) }}
                    />
                    <span className="min-w-0 flex-1 truncate text-[11px] text-foreground">
                      {a.label}
                    </span>
                    <span className="text-[10px] text-muted-foreground">{kindLabel(a.kind)}</span>
                  </button>
                </li>
              ))}
            </ol>
          </div>
        ) : null}

        {children.length ? (
          <div>
            <p className="eyebrow mb-1.5">Directly below ({children.length})</p>
            <ul className="space-y-1">
              {children.map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    onClick={() => onSelect(c.id)}
                    className="flex w-full items-center gap-2 rounded-lg border border-border/40 px-2 py-1.5 text-left transition hover:border-primary/30 hover:bg-surface-hover"
                  >
                    <span
                      className="size-1.5 shrink-0 rounded-full"
                      style={{ background: kindColor(c.kind) }}
                    />
                    <span className="min-w-0 flex-1 truncate text-[11px] font-medium text-foreground">
                      {c.label}
                    </span>
                    <span className="text-[10px] text-muted-foreground">{kindLabel(c.kind)}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        <dl className="space-y-1.5 text-xs">
          <InspectorRow label="Level" value={kindLabel(node.kind)} />
          {node.tier ? <InspectorRow label="Tier" value={node.tier} /> : null}
          {node.model ? <InspectorRow label="Model" value={node.model} /> : null}
          {node.status ? <InspectorRow label="Status" value={node.status} /> : null}
          {typeof node.steps === "number" ? (
            <InspectorRow label="Steps" value={String(node.steps)} />
          ) : null}
          {typeof node.level === "number" ? (
            <InspectorRow label="Depth" value={String(node.level)} />
          ) : null}
          <InspectorRow label="Links here" value={String(links.length)} />
          <InspectorRow label="Id" value={node.id} />
        </dl>

        <div>
          <p className="eyebrow mb-2">Also linked ({others.length})</p>
          {others.length === 0 ? (
            <p className="text-[11px] text-muted-foreground">
              Nothing beyond the hierarchy above and below.
            </p>
          ) : (
            <ul className="space-y-1">
              {others.map((l) => (
                <li key={l.id}>
                  <button
                    type="button"
                    onClick={() => onSelect(l.otherId)}
                    className="flex w-full items-center gap-2 rounded-lg border border-border/40 px-2 py-1.5 text-left transition hover:border-primary/30 hover:bg-surface-hover"
                  >
                    <span
                      className="size-1.5 shrink-0 rounded-full"
                      style={{ background: kindColor(l.other!.kind) }}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[11px] font-medium text-foreground">
                        {l.other!.label}
                      </span>
                      <span className="block truncate text-[10px] text-muted-foreground">
                        {l.direction === "out" ? "→ " : "← "}
                        {l.label || kindLabel(l.other!.kind)}
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
