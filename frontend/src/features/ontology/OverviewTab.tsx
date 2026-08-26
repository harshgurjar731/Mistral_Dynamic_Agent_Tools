import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useQuery } from '@tanstack/react-query';
import {
  Info, Loader2, Maximize2, Minimize2, RotateCcw, Search, X,
} from 'lucide-react';
import {
  ontologyApi,
  type GraphNode,
  type OntologyGraph,
} from '../../api/ontology';
import { cn } from '../../lib/utils';
import OntologyGraphCanvas, { GraphLegend } from './graph/OntologyGraphCanvas';
import UnifiedGraphCanvas from './graph/UnifiedGraphCanvas';
import { ragApi } from '../../api/rag';
import { kindStyle, type LayoutKind } from './graph/graphLayout';

/**
 * Overview — the platform as one picture.
 *
 * The first version drew everything at once: 202 nodes across ten kinds, with
 * capability and tier edges criss-crossing the whole thing. Every node was
 * present and nothing was legible — the tier vocabulary alone put three hubs
 * in the middle joined to all 51 agents.
 *
 * So the default is now the *taxonomy only*, collapsed to industries, with
 * each concept reporting how many resources sit beneath it. That is a dozen
 * nodes in one row instead of a wall. You expand what you care about, and drop
 * to the full graph when you actually want the wiring.
 */

type Mode = 'taxonomy' | 'resources' | 'full' | 'content';

const MODES: { key: Mode; label: string; hint: string }[] = [
  {
    key: 'content',
    label: 'Content',
    hint: 'What is inside the libraries: documents and the entities extracted from them, grouped by type.',
  },
  {
    key: 'taxonomy',
    label: 'Taxonomy',
    hint: 'Industries, domains and subdomains only. Counts show what lives beneath each.',
  },
  {
    key: 'resources',
    label: 'Resources',
    hint:
      'Adds the workflows and agents under whatever you expand — and keeps going: '
      + 'expand a workflow for its agents, an agent for its tools and connectors.',
  },
  {
    key: 'full',
    label: 'Everything',
    hint: 'Every node and relation, including capabilities and tiers. Dense by nature.',
  },
];

/** Kinds each mode asks the API for. */
const MODE_KINDS: Record<Mode, string[] | undefined> = {
  taxonomy: ['industry', 'domain', 'subdomain'],
  resources: [
    'industry', 'domain', 'subdomain',
    'agent', 'workflow', 'tool', 'connector', 'library',
  ],
  full: undefined,
  // Served by Neo4j, not this query — see the content graph below.
  content: undefined,
};

export default function OverviewTab() {
  const [mode, setMode] = useState<Mode>('taxonomy');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState('');
  const [appliedSearch, setAppliedSearch] = useState('');
  const [selected, setSelected] = useState<GraphNode | null>(null);
  const [showUnlinked, setShowUnlinked] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [layout, setLayout] = useState<LayoutKind>('tree');

  // The content graph answers a different question from a different store:
  // what is *inside* the libraries, from Neo4j. Fetched only when that mode is
  // open, and its absence never blocks the resource view — which is why the
  // two are separate queries rather than one.
  const { data: contentGraph } = useQuery({
    queryKey: ['rag', 'graph', 'unified', 'overview'],
    queryFn: () => ragApi.unifiedGraph({ entity_limit: 400 }).then((r) => r.data),
    enabled: mode === 'content',
  });

  const { data: graph, isLoading, isFetching } = useQuery({
    queryKey: ['ontology', 'graph', mode, appliedSearch],
    queryFn: () =>
      ontologyApi
        .graph({
          kinds: MODE_KINDS[mode],
          search: appliedSearch || undefined,
          // Unconnected concepts are the point of the taxonomy view — an
          // industry with nothing under it yet is a finding, not noise.
          include_orphans: true,
          hops: 1,
        })
        .then((r) => r.data),
    staleTime: 30_000,
  });

  /**
   * What each node reveals when expanded.
   *
   * One map covers three different relationships, because the server tags every
   * edge with which end is the container: hierarchy (industry → domain),
   * composition (workflow → agent → tool) and annotation (a concept reveals the
   * resources tagged against it, so that edge is marked reversed).
   *
   * Doing it uniformly is what lets you drill from an industry all the way to a
   * tool in one gesture, without the view knowing anything about the kinds
   * involved.
   */
  const reveals = useMemo(() => {
    const map = new Map<string, Set<string>>();
    if (!graph) return map;
    const push = (from: string, to: string) => {
      const set = map.get(from) ?? new Set<string>();
      set.add(to);
      map.set(from, set);
    };
    for (const edge of graph.edges) {
      // Older payloads carry no `reveal`; hierarchy is forward by convention
      // and everything else pointed resource → concept.
      const direction = edge.reveal ?? (edge.kind === 'hierarchy' ? 'forward' : 'reverse');
      if (direction === 'forward') push(edge.source, edge.target);
      else push(edge.target, edge.source);
    }
    return map;
  }, [graph]);

  /**
   * Which nodes are drawn: the roots, plus whatever expansion has revealed.
   *
   * Full mode opts out — it is the escape hatch, so it shows everything.
   */
  const visible: OntologyGraph | undefined = useMemo(() => {
    if (!graph) return undefined;
    if (mode === 'full' || appliedSearch) return graph;

    // Industries only. Seeding unlinked resources here as well seemed helpful
    // — nothing else can reveal them — but it put 19 unattached connectors on
    // the collapsed canvas, which is the clutter this view exists to avoid.
    // They get their own opt-in toggle instead.
    const seeds = graph.nodes
      .filter((n) => !n.subject_type && !n.parent_id)
      .map((n) => n.id);
    if (showUnlinked) {
      seeds.push(...graph.nodes.filter((n) => n.subject_type && n.degree === 0).map((n) => n.id));
    }

    const kept = new Set(seeds);
    const frontier = [...seeds];
    while (frontier.length) {
      const current = frontier.pop()!;
      if (!expanded.has(current)) continue;
      for (const revealed of reveals.get(current) ?? []) {
        if (kept.has(revealed)) continue;
        kept.add(revealed);
        frontier.push(revealed);
      }
    }

    const nodes = graph.nodes.filter((n) => kept.has(n.id));
    const edges = graph.edges.filter((e) => kept.has(e.source) && kept.has(e.target));
    const counts: Record<string, number> = {};
    for (const n of nodes) counts[n.kind] = (counts[n.kind] ?? 0) + 1;

    return {
      ...graph,
      nodes,
      edges,
      counts,
      totals: { ...graph.totals, nodes: nodes.length, edges: edges.length },
    };
  }, [graph, mode, expanded, appliedSearch, reveals, showUnlinked]);

  /** Resources nothing references — a finding, but not the default view. */
  const unlinkedCount = useMemo(
    () => (graph?.nodes ?? []).filter((n) => n.subject_type && n.degree === 0).length,
    [graph],
  );

  /** Anything that reveals something is expandable — concept or resource. */
  const hasChildren = useMemo(
    () => new Set([...reveals.entries()].filter(([, v]) => v.size > 0).map(([k]) => k)),
    [reveals],
  );

  const onSelect = (node: GraphNode | null) => {
    setSelected(node);
    // Clicking is the expand gesture — a separate hit target on a node this
    // small would be fiddly. Applies to workflows and agents too, which is how
    // you walk down to the tools.
    if (node && hasChildren.has(node.id)) {
      setExpanded((prev) => {
        const next = new Set(prev);
        if (next.has(node.id)) next.delete(node.id);
        else next.add(node.id);
        return next;
      });
    }
  };

  const expandAll = () => setExpanded(new Set(hasChildren));

  // The app shell scrolls behind the overlay otherwise, and a stray wheel
  // event over a non-canvas area moves the page under it.
  useEffect(() => {
    if (!fullscreen) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = previous; };
  }, [fullscreen]);

  const modeHint = MODES.find((m) => m.key === mode)!.hint;

  const body = (
    <div
      className={cn(
        'flex flex-col gap-3',
        // Fullscreen is a fixed overlay rather than the browser Fullscreen API:
        // it keeps React state and the inspector intact, and Esc still exits.
        fullscreen
          ? 'fixed inset-0 z-[100] bg-[var(--color-bg-base)] p-4'
          : 'h-[calc(100vh-260px)] min-h-[520px]',
      )}
    >
      {/* ── Controls ───────────────────────────────────────────────────── */}
      <div className="shrink-0 space-y-2.5 rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] px-3 py-2.5">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex shrink-0 gap-0.5 rounded-lg border border-[var(--color-border-subtle)] bg-black/20 p-0.5">
            {MODES.map((m) => (
              <button
                key={m.key}
                onClick={() => { setMode(m.key); setSelected(null); }}
                className={cn(
                  'rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors',
                  mode === m.key
                    ? 'bg-indigo-500/25 text-indigo-100'
                    : 'text-[var(--color-text-muted)] hover:text-white',
                )}
              >
                {m.label}
              </button>
            ))}
          </div>

          <form
            className="relative min-w-[140px] flex-1 max-w-xs"
            onSubmit={(e) => { e.preventDefault(); setAppliedSearch(search.trim()); }}
          >
            <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)]" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Find anything, then Enter…"
              className="w-full rounded-lg border border-[var(--color-border-subtle)] bg-black/25 py-1.5 pl-7 pr-7 text-[11px] text-white placeholder:text-[var(--color-text-muted)] focus:border-indigo-500/50 focus:outline-none"
            />
            {appliedSearch && (
              <button
                type="button"
                onClick={() => { setSearch(''); setAppliedSearch(''); }}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)] hover:text-white"
              >
                <X size={11} />
              </button>
            )}
          </form>

          {mode !== 'full' && !appliedSearch && (
            <div className="flex items-center gap-1">
              <button
                onClick={expandAll}
                title="Expand every level"
                className="flex items-center gap-1 rounded-lg border border-[var(--color-border-subtle)] px-2 py-1 text-[10px] text-[var(--color-text-secondary)] hover:border-indigo-400/40 hover:text-white"
              >
                <Maximize2 size={10} /> Expand all
              </button>
              <button
                onClick={() => setExpanded(new Set())}
                title="Collapse back to industries"
                className="flex items-center gap-1 rounded-lg border border-[var(--color-border-subtle)] px-2 py-1 text-[10px] text-[var(--color-text-secondary)] hover:border-indigo-400/40 hover:text-white"
              >
                <Minimize2 size={10} /> Collapse
              </button>
              {mode !== 'taxonomy' && unlinkedCount > 0 && (
                <button
                  onClick={() => setShowUnlinked((v) => !v)}
                  title="Resources with no annotations and nothing referencing them"
                  className={cn(
                    'rounded-lg border px-2 py-1 text-[10px] transition-colors',
                    showUnlinked
                      ? 'border-amber-400/50 bg-amber-500/15 text-amber-300'
                      : 'border-[var(--color-border-subtle)] text-[var(--color-text-muted)] hover:text-white',
                  )}
                >
                  {unlinkedCount} unlinked
                </button>
              )}
            </div>
          )}

          <div className="ml-auto flex shrink-0 items-center gap-2">
            {visible && (
              <span className="font-mono text-[10px] tabular-nums text-[var(--color-text-muted)]">
                {visible.totals.nodes} of {graph?.nodes.length ?? 0} shown
              </span>
            )}
            {isFetching && <Loader2 size={12} className="animate-spin text-[var(--color-text-muted)]" />}
            {(appliedSearch || expanded.size > 0) && (
              <button
                onClick={() => {
                  setExpanded(new Set());
                  setSearch('');
                  setAppliedSearch('');
                  setSelected(null);
                }}
                className="flex items-center gap-1 rounded-lg border border-[var(--color-border-subtle)] px-2 py-1 text-[10px] text-[var(--color-text-secondary)] hover:border-indigo-400/40 hover:text-white"
              >
                <RotateCcw size={10} /> Reset
              </button>
            )}
          </div>
        </div>

        <p className="flex items-center gap-1.5 text-[10px] leading-relaxed text-[var(--color-text-muted)]">
          <Info size={10} className="shrink-0" />
          {modeHint}
          {mode !== 'full' && !appliedSearch && ' Click a circle to expand or collapse it.'}
        </p>

        {visible && (
          <div className="max-h-16 overflow-y-auto custom-scrollbar">
            <GraphLegend counts={visible.counts} />
          </div>
        )}
      </div>

      {/* ── Canvas + inspector ─────────────────────────────────────────── */}
      <div className="flex min-h-0 flex-1 gap-3">
        <div className="min-w-0 flex-1 overflow-hidden rounded-xl border border-[var(--color-border-subtle)]">
          {mode === 'content' ? (
            contentGraph ? (
              <UnifiedGraphCanvas
                graph={contentGraph}
                height={fullscreen ? window.innerHeight - 40 : 620}
                clusterBy="kind"
                title="Content across every library"
              />
            ) : (
              <div className="flex h-full items-center justify-center text-xs text-[var(--color-text-muted)]">
                Loading the content graph…
              </div>
            )
          ) : (
          <OntologyGraphCanvas
            graph={visible}
            isLoading={isLoading}
            selectedId={selected?.id ?? null}
            onSelect={onSelect}
            expandable={mode !== 'full' && !appliedSearch ? hasChildren : undefined}
            expandedIds={expanded}
            rootLabel="Platform"
            isFullscreen={fullscreen}
            onToggleFullscreen={() => setFullscreen((v) => !v)}
            layout={layout}
            onLayoutChange={setLayout}
            emptyHint={
              appliedSearch
                ? 'Nothing matched that search.'
                : 'The vocabulary is empty — add concepts in the Taxonomy tab.'
            }
          />
          )}
        </div>

        {selected && (
          <aside className="w-72 shrink-0 overflow-y-auto rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] p-4 custom-scrollbar">
            <NodeInspector node={selected} onClose={() => setSelected(null)} />
          </aside>
        )}
      </div>
    </div>
  );

  // Portalled to <body> when fullscreen.
  //
  // The app shell renders the sidebar at z-50 and wraps the routed content in
  // `relative z-10`. That z-index creates a stacking context, so *no* z-index
  // on a descendant can lift it above the sidebar — the overlay was covering
  // the window but the sidebar was painting over its left edge, hiding the
  // mode buttons and the layout switcher. A portal leaves that context
  // entirely; React state is unaffected because the component tree is unchanged.
  return fullscreen ? createPortal(body, document.body) : body;
}

function NodeInspector({ node, onClose }: { node: GraphNode; onClose: () => void }) {
  const style = kindStyle(node.kind);
  const rollup = Object.entries(node.rollup ?? {}).filter(([, n]) => n > 0);

  return (
    <div className="space-y-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <span
            className="inline-block rounded-full border px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider"
            style={{ color: style.color, borderColor: `${style.color}55`, background: style.bg }}
          >
            {style.label}
          </span>
          <h3 className="mt-1.5 break-words text-sm font-semibold text-white">{node.label}</h3>
        </div>
        <button onClick={onClose} className="shrink-0 text-[var(--color-text-muted)] hover:text-white">
          <X size={14} />
        </button>
      </div>

      <code className="block break-all rounded bg-black/30 px-2 py-1 font-mono text-[9px] text-[var(--color-text-muted)]">
        {node.subject_id ?? node.id}
      </code>

      {(node.definition || node.description) && (
        <p className="text-[11px] leading-relaxed text-[var(--color-text-secondary)]">
          {node.definition || node.description}
        </p>
      )}

      {rollup.length > 0 && (
        <div className="rounded-lg border border-[var(--color-border-subtle)] bg-black/20 p-2.5">
          <p className="mb-1.5 text-[9px] font-bold uppercase tracking-wider text-[var(--color-text-muted)]">
            Beneath this node
          </p>
          <div className="space-y-1">
            {rollup.map(([kind, count]) => (
              <div key={kind} className="flex items-center justify-between text-[11px]">
                <span className="capitalize text-[var(--color-text-secondary)]">{kind}s</span>
                <span className="font-mono tabular-nums" style={{ color: kindStyle(kind).color }}>
                  {count}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      <dl className="space-y-1.5 border-t border-[var(--color-border-subtle)] pt-3 text-[10px]">
        <Row label="Direct links" value={String(node.degree)} />
        {node.tier && <Row label="Tier" value={node.tier} />}
        {node.model && <Row label="Model" value={node.model} />}
        {node.steps != null && <Row label="Steps" value={String(node.steps)} />}
      </dl>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <dt className="text-[var(--color-text-muted)]">{label}</dt>
      <dd className="truncate font-mono text-[var(--color-text-secondary)]">{value}</dd>
    </div>
  );
}
