import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  SigmaContainer,
  useCamera,
  useLoadGraph,
  useRegisterEvents,
  useSetSettings,
  useSigma,
} from '@react-sigma/core';
import '@react-sigma/core/lib/style.css';
import { MultiDirectedGraph } from 'graphology';
import { EdgeArrowProgram } from 'sigma/rendering';
import {
  ChevronDown, Link2, Maximize2, Minimize2, Search, SlidersHorizontal, X,
} from 'lucide-react';
import type { UnifiedEdge, UnifiedGraph, UnifiedNode } from '../../../api/rag';
import { cn } from '../../../lib/utils';
import { Switch } from '../../../components/ui/Switch';
import { nodeStyle } from './entityStyle';
import { computeClusterLayout, KIND_LABELS, type ClusterBy, type ClusterInfo } from './clusterLayout';

/**
 * The knowledge graph, rendered on Sigma (WebGL) instead of React Flow (DOM).
 *
 * This replaced a DOM-per-node canvas that capped out around a couple thousand
 * nodes. Sigma draws from a graphology graph on the GPU, so the same content
 * graph — now genuinely uncapped server-side — stays interactive at any size.
 * The one thing swapped is the renderer: node/edge styling, the entity-type
 * filter, and the per-type clustering all carry over from the old canvas.
 */

/** Structural edges are the skeleton (what belongs to what); they stay quiet
 *  unless selected. Everything else is an extracted relationship. */
const STRUCTURAL = new Set(['broader', 'serves_domain', 'in_library', 'mentioned_in']);

const TWEEN_DURATION = 550;
const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

function nodeSize(degree: number): number {
  return Math.min(14, 4 + Math.sqrt(degree || 0) * 1.8);
}

function withAlpha(hex: string, alpha: number): string {
  const clean = hex.replace('#', '');
  const value = parseInt(clean, 16);
  const r = (value >> 16) & 255;
  const g = (value >> 8) & 255;
  const b = value & 255;
  return `rgba(${r},${g},${b},${alpha})`;
}

const STATIC_SETTINGS = {
  defaultEdgeType: 'arrow',
  edgeProgramClasses: { arrow: EdgeArrowProgram },
  renderEdgeLabels: true,
  labelRenderedSizeThreshold: 8,
  labelDensity: 0.8,
  labelColor: { color: '#e2e8f0' },
  labelSize: 11,
  edgeLabelColor: { color: '#e2e8f0' },
  edgeLabelSize: 9,
  minCameraRatio: 0.02,
  maxCameraRatio: 3,
  zIndex: true,
};

// ── Legend / entity filter ──────────────────────────────────────────────────

/**
 * A row of toggle chips. Used for the entity-type filter (with per-type
 * colour dots) and reused, undecorated, for kind/relationship filters —
 * clicking a chip hides that group rather than just naming it.
 */
export function GraphLegend({
  types,
  counts,
  active,
  onToggle,
  dotColor,
}: {
  types: string[];
  counts?: Record<string, number>;
  active?: Set<string>;
  onToggle?: (type: string) => void;
  dotColor?: (type: string) => string;
}) {
  if (!types.length) return null;
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
      {types.map((type) => {
        const color = dotColor ? dotColor(type) : nodeStyle(type).color;
        const on = !active || active.has(type);
        return (
          <button
            key={type}
            type="button"
            onClick={onToggle ? () => onToggle(type) : undefined}
            disabled={!onToggle}
            title={onToggle ? `Click to ${on ? 'hide' : 'show'} ${type}` : type}
            style={{
              borderColor: on ? `${color}66` : 'var(--color-border-subtle)',
              background: on ? `${color}1f` : 'transparent',
            }}
            className={cn(
              'flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] transition-opacity',
              onToggle && 'cursor-pointer hover:opacity-90',
              !on && 'opacity-45',
            )}
          >
            <span className="h-2 w-2 rounded-full" style={{ background: color }} />
            <span className="text-[var(--color-text-secondary)]">{type}</span>
            {counts && (
              <span className="font-mono tabular-nums text-[var(--color-text-muted)]">
                {counts[type] ?? 0}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

// ── Floating cluster labels ─────────────────────────────────────────────────

/**
 * One small heading per type cluster, replacing the old dashed cluster box.
 * Sigma has no compound/parent nodes, so grouping is communicated by spacing
 * (see `clusterLayout.ts`) plus this label — repositioned on every camera
 * move via `graphToViewport`, throttled to one recompute per frame.
 */
function ClusterLabels({ clusters }: { clusters: ClusterInfo[] }) {
  const sigma = useSigma();
  const registerEvents = useRegisterEvents();
  const [positions, setPositions] = useState<Map<string, { x: number; y: number }>>(new Map());
  const frame = useRef<number | null>(null);

  const recompute = useCallback(() => {
    const next = new Map<string, { x: number; y: number }>();
    for (const cluster of clusters) {
      next.set(
        cluster.key,
        sigma.graphToViewport({ x: cluster.x + cluster.width / 2, y: cluster.y }),
      );
    }
    setPositions(next);
  }, [clusters, sigma]);

  useEffect(() => { recompute(); }, [recompute]);

  useEffect(() => {
    registerEvents({
      afterRender: () => {
        if (frame.current) return;
        frame.current = requestAnimationFrame(() => {
          frame.current = null;
          recompute();
        });
      },
    });
  }, [registerEvents, recompute]);

  // A single cluster spans the whole canvas — a heading over it says nothing.
  if (clusters.length < 2) return null;

  return (
    <div className="pointer-events-none absolute inset-0 z-[5] overflow-hidden">
      {clusters.map((cluster) => {
        const pos = positions.get(cluster.key);
        if (!pos) return null;
        return (
          <div
            key={cluster.key}
            style={{
              left: pos.x,
              top: pos.y,
              color: cluster.color,
              borderColor: `${cluster.color}55`,
              background: `${cluster.color}14`,
            }}
            className="absolute -translate-x-1/2 -translate-y-full whitespace-nowrap rounded-full border px-2 py-0.5 text-[10px] font-medium backdrop-blur-sm transition-[left,top] duration-75"
          >
            {cluster.key} · {cluster.count}
          </div>
        );
      })}
    </div>
  );
}

// ── Graph content: builds the graphology graph, wires selection ────────────

interface GraphContentProps {
  graph: UnifiedGraph;
  clusterBy: ClusterBy;
  hiddenTypes: Set<string>;
  hiddenKinds: Set<string>;
  hiddenPredicates: Set<string>;
  hideIsolated: boolean;
  search: string;
  onSelect?: (node: UnifiedNode | null) => void;
}

function GraphContent({
  graph, clusterBy, hiddenTypes, hiddenKinds, hiddenPredicates, hideIsolated, search, onSelect,
}: GraphContentProps) {
  const loadGraph = useLoadGraph();
  const registerEvents = useRegisterEvents();
  const setSettings = useSetSettings();
  const sigma = useSigma();
  const { reset } = useCamera();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [clusters, setClusters] = useState<ClusterInfo[]>([]);
  const onSelectRef = useRef(onSelect);
  useEffect(() => { onSelectRef.current = onSelect; });
  // Which `graph` object (by reference) is currently loaded. React Query keeps
  // the same reference across refetches that returned identical data, so this
  // reliably tells "new data arrived" apart from "only the grouping changed".
  const loadedGraphRef = useRef<UnifiedGraph | null>(null);
  const tweenFrame = useRef<number | null>(null);

  // New data → rebuild the graphology graph from scratch. Same data, new
  // `clusterBy` → animate existing nodes to their new positions instead of
  // reloading, so the regrouping reads as motion rather than a jump cut.
  useEffect(() => {
    const { positions, clusters: laidOutClusters } = computeClusterLayout(graph, clusterBy);
    setClusters(laidOutClusters);

    const isNewData = loadedGraphRef.current !== graph;
    loadedGraphRef.current = graph;

    if (tweenFrame.current) {
      cancelAnimationFrame(tweenFrame.current);
      tweenFrame.current = null;
    }

    if (isNewData || sigma.getGraph().order === 0) {
      const g = new MultiDirectedGraph();
      for (const node of graph.nodes) {
        const pos = positions.get(node.id) ?? { x: 0, y: 0 };
        const style = nodeStyle(node.type);
        g.addNode(node.id, {
          x: pos.x,
          y: pos.y,
          size: nodeSize(node.degree),
          color: style.color,
          label: node.label,
          raw: node,
        });
      }
      graph.edges.forEach((edge: UnifiedEdge, index: number) => {
        if (!g.hasNode(edge.source) || !g.hasNode(edge.target)) return;
        const structural = STRUCTURAL.has(edge.predicate);
        const sourceType = (g.getNodeAttribute(edge.source, 'raw') as UnifiedNode).type;
        const color = structural ? withAlpha('#64748B', 0.45) : nodeStyle(sourceType).color;
        g.addEdgeWithKey(`e${index}`, edge.source, edge.target, {
          predicate: edge.predicate,
          structural,
          size: structural ? 1 : 1.6,
          color,
        });
      });

      loadGraph(g);
      setSelectedId(null);
      onSelectRef.current?.(null);
      // Fit the new graph rather than lingering on the previous camera position.
      setTimeout(() => reset(), 30);
      return;
    }

    // Same data, different grouping — tween positions on the live graph.
    const g = sigma.getGraph();
    const from = new Map<string, { x: number; y: number }>();
    g.forEachNode((node, attrs) => from.set(node, { x: attrs.x as number, y: attrs.y as number }));

    const start = performance.now();
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / TWEEN_DURATION);
      const k = ease(t);
      g.forEachNode((node) => {
        const f = from.get(node);
        const to = positions.get(node);
        if (!f || !to) return;
        g.setNodeAttribute(node, 'x', f.x + (to.x - f.x) * k);
        g.setNodeAttribute(node, 'y', f.y + (to.y - f.y) * k);
      });
      sigma.refresh();
      if (t < 1) {
        tweenFrame.current = requestAnimationFrame(step);
      } else {
        tweenFrame.current = null;
        setTimeout(() => reset(), 30);
      }
    };
    tweenFrame.current = requestAnimationFrame(step);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graph, clusterBy, loadGraph, sigma]);

  useEffect(() => () => {
    if (tweenFrame.current) cancelAnimationFrame(tweenFrame.current);
  }, []);

  // Click a node to isolate its neighbourhood; click empty space to clear.
  useEffect(() => {
    registerEvents({
      clickNode: ({ node }) => {
        setSelectedId((current) => {
          const next = current === node ? null : node;
          const raw = next
            ? (sigma.getGraph().getNodeAttribute(next, 'raw') as UnifiedNode)
            : null;
          onSelectRef.current?.(raw);
          return next;
        });
      },
      clickStage: () => {
        setSelectedId(null);
        onSelectRef.current?.(null);
      },
    });
  }, [registerEvents, sigma]);

  // Nodes excluded by the type/kind/isolation filters — recomputed only when
  // the filters or the graph change, not on every render.
  const hiddenNodeIds = useMemo(() => {
    if (!hiddenTypes.size && !hiddenKinds.size && !hideIsolated) return new Set<string>();
    const hidden = new Set<string>();
    for (const node of graph.nodes) {
      if (node.kind === 'entity' && hiddenTypes.has(node.type)) { hidden.add(node.id); continue; }
      if (hiddenKinds.has(KIND_LABELS[node.kind] ?? node.kind)) { hidden.add(node.id); continue; }
      if (hideIsolated && node.degree === 0) { hidden.add(node.id); continue; }
    }
    return hidden;
  }, [graph, hiddenTypes, hiddenKinds, hideIsolated]);

  // Nodes matching the search box, excluding anything already filtered out.
  // Acts as a "focus" set exactly like clicking a node does, just for a text
  // query instead of a neighbourhood — a click always takes precedence.
  const searchMatches = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return null;
    const matches = new Set<string>();
    for (const node of graph.nodes) {
      if (!hiddenNodeIds.has(node.id) && node.label.toLowerCase().includes(q)) matches.add(node.id);
    }
    return matches;
  }, [graph, search, hiddenNodeIds]);

  // A gentle pulse on the selected node — the same motif as the taxonomy
  // graph's `ontology-node-pulse`, redone here since Sigma paints on a canvas
  // rather than the DOM, so a CSS animation can't reach it. Only runs while
  // something is selected.
  const pulsePhase = useRef(0);
  useEffect(() => {
    if (!selectedId) return;
    let raf = 0;
    const loop = (t: number) => {
      pulsePhase.current = t;
      sigma.refresh();
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [selectedId, sigma]);

  // Reducers carry the filters, the search focus, and the selection
  // highlight. Sigma re-evaluates these per visible item per frame, which is
  // what lets a filter toggle skip rebuilding the graph entirely.
  useEffect(() => {
    const g = sigma.getGraph();
    let focus: Set<string> | null = null;
    if (selectedId) {
      focus = new Set<string>(g.neighbors(selectedId));
      focus.add(selectedId);
    } else if (searchMatches?.size) {
      focus = searchMatches;
    }

    setSettings({
      nodeReducer: (node, data) => {
        if (hiddenNodeIds.has(node)) return { ...data, hidden: true };
        if (node === selectedId) {
          const pulse = 1 + Math.sin(pulsePhase.current / 260) * 0.18;
          return { ...data, size: (data.size as number) * pulse, forceLabel: true, zIndex: 2 };
        }
        if (!focus) return data;
        if (focus.has(node)) return { ...data, forceLabel: true, zIndex: 1 };
        return { ...data, color: withAlpha(data.color as string, 0.12), label: null, zIndex: 0 };
      },
      edgeReducer: (edge, data) => {
        if (hiddenNodeIds.has(g.source(edge)) || hiddenNodeIds.has(g.target(edge))) {
          return { ...data, hidden: true };
        }
        if (hiddenPredicates.has(data.predicate as string)) return { ...data, hidden: true };
        if (!selectedId) {
          if (focus && !(focus.has(g.source(edge)) && focus.has(g.target(edge)))) {
            return { ...data, color: withAlpha('#334155', 0.06) };
          }
          return data;
        }
        const touches = g.source(edge) === selectedId || g.target(edge) === selectedId;
        if (!touches) return { ...data, hidden: true };
        return {
          ...data,
          size: data.structural ? 1.4 : 2.4,
          zIndex: 1,
          label: data.structural ? null : String(data.predicate).replace(/_/g, ' '),
        };
      },
    });
  }, [selectedId, hiddenNodeIds, hiddenPredicates, searchMatches, sigma, setSettings]);

  return (
    <>
      <ClusterLabels clusters={clusters} />
      {selectedId && (
        <div className="absolute bottom-3 right-3 z-10">
          <button
            onClick={() => { setSelectedId(null); onSelectRef.current?.(null); }}
            className="flex items-center gap-1 rounded-lg border border-[var(--color-border-subtle)] bg-black/70 px-2 py-1 text-[10px] text-[var(--color-text-secondary)] hover:text-white"
          >
            <X size={10} /> clear selection
          </button>
        </div>
      )}
    </>
  );
}

// ── Outer chrome: title, cluster-by, filters, fullscreen ───────────────────

export default function SigmaGraphCanvas({
  graph,
  height = 560,
  clusterBy: initialClusterBy = 'type',
  onSelect,
  title,
}: {
  graph: UnifiedGraph;
  height?: number;
  clusterBy?: ClusterBy;
  onSelect?: (node: UnifiedNode | null) => void;
  title?: string;
}) {
  const [clusterBy, setClusterBy] = useState<ClusterBy>(initialClusterBy);
  const [fullscreen, setFullscreen] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(true);
  const [search, setSearch] = useState('');
  // Every filter dimension is a drop set: what's named here is hidden. A
  // relation is dropped along with either endpoint it touches, or directly by
  // its own predicate — handled inside GraphContent's reducers.
  const [hiddenTypes, setHiddenTypes] = useState<Set<string>>(new Set());
  const [hiddenKinds, setHiddenKinds] = useState<Set<string>>(new Set());
  const [hiddenPredicates, setHiddenPredicates] = useState<Set<string>>(new Set());
  const [hideIsolated, setHideIsolated] = useState(false);
  const container = useRef<HTMLDivElement>(null);

  const toggleFullscreen = useCallback(async () => {
    const element = container.current;
    if (!element) return;
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await element.requestFullscreen();
    } catch {
      setFullscreen((v) => !v);
    }
  }, []);

  useEffect(() => {
    const onChange = () => setFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  const typeCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const node of graph.nodes) {
      if (node.kind === 'entity' && node.type) counts[node.type] = (counts[node.type] ?? 0) + 1;
    }
    return counts;
  }, [graph]);
  const types = useMemo(() => Object.keys(typeCounts).sort(), [typeCounts]);

  // Keyed by the friendly label (not the raw `kind`) since that's what the
  // legend displays and what a click toggles — `hiddenKinds` stores labels.
  const kindCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const node of graph.nodes) {
      const label = KIND_LABELS[node.kind] ?? node.kind;
      counts[label] = (counts[label] ?? 0) + 1;
    }
    return counts;
  }, [graph]);
  // Fixed, meaningful order rather than alphabetical — the levels read as a
  // stack from taxonomy down to entity.
  const kinds = useMemo(
    () =>
      (['concept', 'library', 'document', 'entity'] as const)
        .map((k) => KIND_LABELS[k] ?? k)
        .filter((label) => kindCounts[label]),
    [kindCounts],
  );

  const predicateCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const edge of graph.edges) counts[edge.predicate] = (counts[edge.predicate] ?? 0) + 1;
    return counts;
  }, [graph]);
  const predicates = useMemo(() => Object.keys(predicateCounts).sort(), [predicateCounts]);

  // A hidden value from the previous scope should not silently hide data in
  // the next — every filter resets when the underlying graph changes shape.
  useEffect(() => {
    setHiddenTypes(new Set());
    setHiddenKinds(new Set());
    setHiddenPredicates(new Set());
    setHideIsolated(false);
    setSearch('');
  }, [graph]);

  const toggleType = useCallback((type: string) => {
    setHiddenTypes((prev) => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return next;
    });
  }, []);
  const toggleKind = useCallback((kind: string) => {
    setHiddenKinds((prev) => {
      const next = new Set(prev);
      if (next.has(kind)) next.delete(kind);
      else next.add(kind);
      return next;
    });
  }, []);
  const togglePredicate = useCallback((predicate: string) => {
    setHiddenPredicates((prev) => {
      const next = new Set(prev);
      if (next.has(predicate)) next.delete(predicate);
      else next.add(predicate);
      return next;
    });
  }, []);

  const anyFilterActive =
    hiddenTypes.size > 0 || hiddenKinds.size > 0 || hiddenPredicates.size > 0 || hideIsolated;
  const activeFilterCount =
    hiddenTypes.size + hiddenKinds.size + hiddenPredicates.size + (hideIsolated ? 1 : 0);

  const resetFilters = useCallback(() => {
    setHiddenTypes(new Set());
    setHiddenKinds(new Set());
    setHiddenPredicates(new Set());
    setHideIsolated(false);
  }, []);

  // Only used for the "X of Y" badge — the actual filtering happens inside
  // GraphContent's reducers, not by rebuilding this object.
  const filteredCounts = useMemo(() => {
    if (!anyFilterActive) return { nodes: graph.nodes.length, edges: graph.edges.length };
    const nodeHidden = (n: UnifiedNode) =>
      (n.kind === 'entity' && hiddenTypes.has(n.type)) ||
      hiddenKinds.has(KIND_LABELS[n.kind] ?? n.kind) ||
      (hideIsolated && n.degree === 0);
    const nodes = graph.nodes.filter((n) => !nodeHidden(n));
    const present = new Set(nodes.map((n) => n.id));
    const edges = graph.edges.filter(
      (e) => present.has(e.source) && present.has(e.target) && !hiddenPredicates.has(e.predicate),
    );
    return { nodes: nodes.length, edges: edges.length };
  }, [graph, anyFilterActive, hiddenTypes, hiddenKinds, hideIsolated, hiddenPredicates]);

  if (!graph.available) {
    return (
      <div
        style={{ height }}
        className="flex items-center justify-center rounded-lg border border-dashed border-[var(--color-border-subtle)]"
      >
        <p className="max-w-sm text-center text-xs text-[var(--color-text-muted)]">
          The knowledge graph is unavailable
          {graph.reason ? ` (${graph.reason})` : ''}. Start it with{' '}
          <code className="rounded bg-black/40 px-1 font-mono">docker compose up -d neo4j</code>.
        </p>
      </div>
    );
  }

  if (!graph.nodes.length) {
    return (
      <div
        style={{ height }}
        className="flex items-center justify-center rounded-lg border border-dashed border-[var(--color-border-subtle)]"
      >
        <p className="max-w-sm text-center text-xs text-[var(--color-text-muted)]">
          Nothing graphed in this scope yet. Upload a document, review what was
          extracted, and commit it.
        </p>
      </div>
    );
  }

  const clusterOptions: { key: ClusterBy; label: string; hint: string }[] = [
    { key: 'type', label: 'By type', hint: 'One cluster per entity type' },
    { key: 'kind', label: 'By level', hint: 'Taxonomy, libraries, documents, entities' },
    { key: 'none', label: 'Flat', hint: 'No grouping' },
  ];

  return (
    <div
      ref={container}
      style={{ height: fullscreen ? '100vh' : height }}
      className="relative overflow-hidden rounded-lg border border-[var(--color-border-subtle)] bg-[#080d18]"
    >
      <div className="absolute left-3 top-3 z-10 flex flex-wrap items-center gap-2">
        {title && (
          <span className="rounded-lg bg-black/70 px-2 py-1 text-[11px] text-white">
            {title}
          </span>
        )}
        <div className="flex rounded-lg border border-[var(--color-border-subtle)] bg-black/70 p-0.5">
          {clusterOptions.map((option) => (
            <button
              key={option.key}
              onClick={() => setClusterBy(option.key)}
              title={option.hint}
              className={cn(
                'rounded px-2 py-1 text-[10px] transition-colors',
                clusterBy === option.key
                  ? 'bg-indigo-500/20 text-white'
                  : 'text-[var(--color-text-muted)] hover:text-white',
              )}
            >
              {option.label}
            </button>
          ))}
        </div>
        <span className="flex items-center gap-1.5 rounded-lg bg-black/70 px-2 py-1 text-[10px] text-[var(--color-text-muted)]">
          <Link2 size={10} />
          {anyFilterActive
            ? `${filteredCounts.nodes} of ${graph.nodes.length} nodes · ${filteredCounts.edges} of ${graph.edges.length} edges`
            : `${graph.nodes.length} nodes · ${graph.edges.length} edges`}
          {graph.truncated ? ' · truncated' : ''}
        </span>
      </div>

      <button
        onClick={toggleFullscreen}
        title={fullscreen ? 'Exit full screen' : 'Full screen'}
        className="absolute right-3 top-3 z-10 rounded-lg border border-[var(--color-border-subtle)] bg-black/70 p-1.5 text-[var(--color-text-secondary)] hover:text-white"
      >
        {fullscreen ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
      </button>

      <div className="absolute bottom-3 left-3 z-10 max-w-[min(420px,80%)] rounded-lg bg-black/70 px-2.5 py-1.5">
        <button
          onClick={() => setFiltersOpen((v) => !v)}
          className="flex w-full items-center justify-between gap-4 text-[9px] uppercase tracking-wide text-[var(--color-text-muted)] hover:text-white"
        >
          <span className="flex items-center gap-1.5">
            <SlidersHorizontal size={10} />
            Filters
            {anyFilterActive && (
              <span className="rounded-full bg-indigo-500/25 px-1.5 py-px font-mono text-[9px] normal-case text-indigo-200">
                {activeFilterCount}
              </span>
            )}
          </span>
          <ChevronDown size={11} className={cn('transition-transform', filtersOpen && 'rotate-180')} />
        </button>

        {filtersOpen && (
          <div className="mt-2 max-h-[45vh] space-y-3 overflow-y-auto pr-1">
            <div className="relative">
              <Search size={11} className="absolute left-2 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)]" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Find an entity by name…"
                className="w-full rounded border border-[var(--color-border-subtle)] bg-black/40 py-1 pl-6 pr-6 text-[10px] text-white placeholder:text-[var(--color-text-muted)] focus:border-indigo-400/50 focus:outline-none"
              />
              {search && (
                <button
                  onClick={() => setSearch('')}
                  className="absolute right-1.5 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)] hover:text-white"
                >
                  <X size={10} />
                </button>
              )}
            </div>

            <div className="flex items-center justify-between gap-1.5 text-[10px] text-[var(--color-text-secondary)]">
              <span>Hide isolated entities (no relations)</span>
              <Switch checked={hideIsolated} onChange={setHideIsolated} size="xs" />
            </div>

            {kinds.length > 1 && (
              <div>
                <p className="mb-1 text-[9px] uppercase tracking-wide text-[var(--color-text-muted)]">Show</p>
                <GraphLegend
                  types={kinds}
                  counts={kindCounts}
                  active={new Set(kinds.filter((k) => !hiddenKinds.has(k)))}
                  onToggle={toggleKind}
                  dotColor={() => '#94A3B8'}
                />
              </div>
            )}

            {types.length > 0 && (
              <div>
                <p className="mb-1 text-[9px] uppercase tracking-wide text-[var(--color-text-muted)]">Entity type</p>
                <GraphLegend
                  types={types}
                  counts={typeCounts}
                  active={new Set(types.filter((t) => !hiddenTypes.has(t)))}
                  onToggle={toggleType}
                />
              </div>
            )}

            {predicates.length > 0 && (
              <div>
                <p className="mb-1 text-[9px] uppercase tracking-wide text-[var(--color-text-muted)]">Relationship</p>
                <GraphLegend
                  types={predicates}
                  counts={predicateCounts}
                  active={new Set(predicates.filter((p) => !hiddenPredicates.has(p)))}
                  onToggle={togglePredicate}
                  dotColor={() => '#34D399'}
                />
              </div>
            )}

            {anyFilterActive && (
              <button
                onClick={resetFilters}
                className="text-[10px] font-medium text-indigo-300 hover:text-white"
              >
                Reset all filters
              </button>
            )}
          </div>
        )}
      </div>

      {filteredCounts.nodes > 0 ? (
        <SigmaContainer
          graph={MultiDirectedGraph}
          settings={STATIC_SETTINGS}
          style={{ width: '100%', height: '100%', background: '#080d18' }}
        >
          <GraphContent
            graph={graph}
            clusterBy={clusterBy}
            hiddenTypes={hiddenTypes}
            hiddenKinds={hiddenKinds}
            hiddenPredicates={hiddenPredicates}
            hideIsolated={hideIsolated}
            search={search}
            onSelect={onSelect}
          />
        </SigmaContainer>
      ) : (
        <div className="flex h-full items-center justify-center">
          <p className="max-w-sm text-center text-xs text-[var(--color-text-muted)]">
            Nothing matches the current filters.{' '}
            <button onClick={resetFilters} className="text-indigo-300 hover:text-white">
              Reset all filters
            </button>
          </p>
        </div>
      )}
    </div>
  );
}
