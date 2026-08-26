import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  MiniMap,
  Panel,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type Edge,
  type Node,
  type NodeProps,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import {
  Boxes, Building2, Cpu, FileText, Gauge, Landmark, Layers, Link2, MapPin,
  Maximize2, Minimize2, Package, Repeat, Shapes, User, X,
} from 'lucide-react';
import type { UnifiedEdge, UnifiedGraph, UnifiedNode } from '../../../api/rag';
import { cn } from '../../../lib/utils';

/**
 * The knowledge graph, drawn as clusters.
 *
 * A force or dagre layout over an extracted graph produces a hairball: every
 * node looks alike, and the one thing a reader wants — *what kinds of thing are
 * in here, and how do the kinds relate* — is exactly what gets lost. So nodes
 * are grouped into labelled clusters, one per entity type (or per level, in the
 * platform view), and laid out inside their cluster.
 *
 * Clusters are real ReactFlow parent nodes rather than a drawn background. That
 * means the group moves as a unit, children are positioned relative to it, and
 * edges between clusters route correctly without any of it being reimplemented.
 *
 * Clusters are packed in a rough spiral ordered by size: the biggest type lands
 * in the middle where there is room, and the long tail of one-node types sits
 * around the edge instead of pushing everything apart.
 */

/** One identity per entity type; the platform view maps levels onto the same set. */
export const NODE_STYLES: Record<string, { color: string; bg: string; icon: typeof Boxes }> = {
  // Content types
  Person: { color: '#F472B6', bg: 'rgba(244,114,182,0.13)', icon: User },
  Organization: { color: '#818CF8', bg: 'rgba(129,140,248,0.13)', icon: Building2 },
  Supplier: { color: '#818CF8', bg: 'rgba(129,140,248,0.13)', icon: Building2 },
  Purchaser: { color: '#22D3EE', bg: 'rgba(34,211,238,0.13)', icon: Building2 },
  Carrier: { color: '#FB923C', bg: 'rgba(251,146,60,0.12)', icon: Package },
  Subcontractor: { color: '#C084FC', bg: 'rgba(192,132,252,0.13)', icon: Building2 },
  Product: { color: '#38BDF8', bg: 'rgba(56,189,248,0.12)', icon: Package },
  Process: { color: '#2DD4BF', bg: 'rgba(45,212,191,0.12)', icon: Repeat },
  Metric: { color: '#34D399', bg: 'rgba(52,211,153,0.12)', icon: Gauge },
  Regulation: { color: '#FBBF24', bg: 'rgba(251,191,36,0.12)', icon: Landmark },
  Standard: { color: '#FBBF24', bg: 'rgba(251,191,36,0.12)', icon: Landmark },
  Obligation: { color: '#F59E0B', bg: 'rgba(245,158,11,0.12)', icon: Landmark },
  System: { color: '#A78BFA', bg: 'rgba(167,139,250,0.12)', icon: Cpu },
  Location: { color: '#FB923C', bg: 'rgba(251,146,60,0.12)', icon: MapPin },
  Facility: { color: '#FB923C', bg: 'rgba(251,146,60,0.12)', icon: MapPin },
  Event: { color: '#F87171', bg: 'rgba(248,113,113,0.12)', icon: FileText },
  Individual: { color: '#F472B6', bg: 'rgba(244,114,182,0.13)', icon: User },
  Concept: { color: '#94A3B8', bg: 'rgba(148,163,184,0.12)', icon: Boxes },
  // Platform levels
  Library: { color: '#A3E635', bg: 'rgba(163,230,53,0.12)', icon: Layers },
  Document: { color: '#60A5FA', bg: 'rgba(96,165,250,0.12)', icon: FileText },
  domain: { color: '#8B5CF6', bg: 'rgba(139,92,246,0.14)', icon: Shapes },
  capability: { color: '#06B6D4', bg: 'rgba(6,182,212,0.12)', icon: Shapes },
  data_class: { color: '#F59E0B', bg: 'rgba(245,158,11,0.12)', icon: Shapes },
  agent_tier: { color: '#94A3B8', bg: 'rgba(148,163,184,0.12)', icon: Shapes },
};

const FALLBACK = NODE_STYLES.Concept;

export function nodeStyle(type: string) {
  return NODE_STYLES[type] ?? FALLBACK;
}

/** How a node is grouped into a cluster. */
export type ClusterBy = 'type' | 'kind' | 'none';

const NODE_W = 168;
const NODE_H = 46;
const GAP_X = 14;
const GAP_Y = 12;
const CLUSTER_PAD = 34;
const CLUSTER_GAP = 60;

const KIND_LABELS: Record<string, string> = {
  concept: 'Taxonomy',
  library: 'Libraries',
  document: 'Documents',
  entity: 'Entities',
};

function clusterKey(node: UnifiedNode, by: ClusterBy): string {
  if (by === 'none') return 'all';
  if (by === 'kind') return KIND_LABELS[node.kind] ?? node.kind;
  // Grouping the platform levels by their own name keeps concepts, libraries
  // and documents from being scattered through the content clusters.
  if (node.kind !== 'entity') return KIND_LABELS[node.kind] ?? node.kind;
  return node.type || 'Concept';
}

// ── Nodes ──────────────────────────────────────────────────────────────────

const EntityNode = memo(({ data }: NodeProps) => {
  const node = data.node as UnifiedNode;
  const dimmed = data.dimmed as boolean;
  const selected = data.selected as boolean;
  const style = nodeStyle(node.kind === 'entity' ? node.type : node.type);
  const Icon = style.icon;

  return (
    <div
      style={{
        width: NODE_W,
        height: NODE_H,
        opacity: dimmed ? 0.12 : 1,
        borderColor: selected ? style.color : 'rgba(148,163,184,0.22)',
        background: selected ? style.bg : 'rgba(15,23,42,0.82)',
        boxShadow: selected ? `0 0 0 2px ${style.color}66` : undefined,
      }}
      className="flex items-center gap-2 rounded-lg border px-2 transition-opacity"
      title={node.description || node.label}
    >
      <Handle type="target" position={Position.Left} className="!h-1.5 !w-1.5 !border-0 !bg-slate-600" />
      <span
        className="flex h-6 w-6 shrink-0 items-center justify-center rounded"
        style={{ background: `${style.color}22`, color: style.color }}
      >
        <Icon size={12} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[11px] font-medium leading-tight text-white">
          {node.label}
        </span>
        <span className="block truncate text-[9px] leading-tight" style={{ color: style.color }}>
          {node.kind === 'entity' ? node.type : KIND_LABELS[node.kind] ?? node.kind}
          {node.degree > 0 ? ` · ${node.degree}` : ''}
        </span>
      </span>
      <Handle type="source" position={Position.Right} className="!h-1.5 !w-1.5 !border-0 !bg-slate-600" />
    </div>
  );
});
EntityNode.displayName = 'EntityNode';

const ClusterNode = memo(({ data }: NodeProps) => {
  const label = data.label as string;
  const count = data.count as number;
  const color = data.color as string;
  const dimmed = data.dimmed as boolean;

  return (
    <div
      style={{
        width: data.width as number,
        height: data.height as number,
        borderColor: `${color}55`,
        background: `${color}0d`,
        opacity: dimmed ? 0.35 : 1,
      }}
      className="rounded-2xl border-2 border-dashed transition-opacity"
    >
      <span
        className="absolute -top-2.5 left-4 rounded px-1.5 py-px text-[10px] font-medium"
        style={{ background: '#0b1120', color }}
      >
        {label} · {count}
      </span>
    </div>
  );
});
ClusterNode.displayName = 'ClusterNode';

const NODE_TYPES = { entity: EntityNode, cluster: ClusterNode };

// ── Layout ─────────────────────────────────────────────────────────────────

/** Nodes within one hop of the selection, either direction. */
function neighbourhood(id: string, edges: UnifiedEdge[]): Set<string> {
  const near = new Set<string>([id]);
  for (const edge of edges) {
    if (edge.source === id) near.add(edge.target);
    if (edge.target === id) near.add(edge.source);
  }
  return near;
}

interface Cluster {
  key: string;
  nodes: UnifiedNode[];
  cols: number;
  width: number;
  height: number;
  x: number;
  y: number;
}

/**
 * Pack clusters biggest-first into rows, wrapping at a width derived from the
 * total area. Not optimal packing — optimal packing of rectangles is not worth
 * solving here — but it keeps the aspect ratio close to the screen's, which is
 * what stops one long row from making everything unreadably small.
 */
function packClusters(clusters: Cluster[]): void {
  const totalArea = clusters.reduce((sum, c) => sum + c.width * c.height, 0);
  const targetWidth = Math.max(
    Math.sqrt(totalArea * 1.6),
    Math.max(...clusters.map((c) => c.width), 0),
  );

  let x = 0;
  let y = 0;
  let rowHeight = 0;

  for (const cluster of clusters) {
    if (x > 0 && x + cluster.width > targetWidth) {
      x = 0;
      y += rowHeight + CLUSTER_GAP;
      rowHeight = 0;
    }
    cluster.x = x;
    cluster.y = y;
    x += cluster.width + CLUSTER_GAP;
    rowHeight = Math.max(rowHeight, cluster.height);
  }
}

function layout(
  graph: UnifiedGraph,
  clusterBy: ClusterBy,
  selectedId: string | null,
): { nodes: Node[]; edges: Edge[] } {
  const present = new Set(graph.nodes.map((n) => n.id));
  const edges = graph.edges.filter((e) => present.has(e.source) && present.has(e.target));
  const near = selectedId ? neighbourhood(selectedId, edges) : null;

  // Group, then order each cluster by degree so hubs land top-left where the
  // eye starts.
  const grouped = new Map<string, UnifiedNode[]>();
  for (const node of graph.nodes) {
    const key = clusterKey(node, clusterBy);
    const list = grouped.get(key);
    if (list) list.push(node);
    else grouped.set(key, [node]);
  }

  const clusters: Cluster[] = [...grouped.entries()]
    .map(([key, nodes]) => {
      const sorted = [...nodes].sort((a, b) => b.degree - a.degree);
      const cols = Math.max(1, Math.ceil(Math.sqrt(sorted.length * 1.4)));
      const rows = Math.ceil(sorted.length / cols);
      return {
        key,
        nodes: sorted,
        cols,
        width: cols * NODE_W + (cols - 1) * GAP_X + CLUSTER_PAD * 2,
        height: rows * NODE_H + (rows - 1) * GAP_Y + CLUSTER_PAD * 2,
        x: 0,
        y: 0,
      };
    })
    .sort((a, b) => b.nodes.length - a.nodes.length);

  packClusters(clusters);

  const flowNodes: Node[] = [];

  for (const cluster of clusters) {
    const style = nodeStyle(cluster.nodes[0]?.type ?? 'Concept');
    const clusterDimmed =
      !!near && !cluster.nodes.some((n) => near.has(n.id));

    if (clusterBy !== 'none') {
      flowNodes.push({
        id: `cluster::${cluster.key}`,
        type: 'cluster',
        position: { x: cluster.x, y: cluster.y },
        data: {
          label: cluster.key,
          count: cluster.nodes.length,
          color: style.color,
          width: cluster.width,
          height: cluster.height,
          dimmed: clusterDimmed,
        },
        draggable: true,
        selectable: false,
        zIndex: 0,
      });
    }

    cluster.nodes.forEach((node, index) => {
      const col = index % cluster.cols;
      const row = Math.floor(index / cluster.cols);
      const position =
        clusterBy === 'none'
          ? {
              x: cluster.x + CLUSTER_PAD + col * (NODE_W + GAP_X),
              y: cluster.y + CLUSTER_PAD + row * (NODE_H + GAP_Y),
            }
          : {
              // Relative to the parent cluster, which is what makes the group
              // move as a unit.
              x: CLUSTER_PAD + col * (NODE_W + GAP_X),
              y: CLUSTER_PAD + row * (NODE_H + GAP_Y),
            };

      flowNodes.push({
        id: node.id,
        type: 'entity',
        position,
        ...(clusterBy !== 'none'
          ? { parentId: `cluster::${cluster.key}`, extent: 'parent' as const }
          : {}),
        data: {
          node,
          dimmed: !!near && !near.has(node.id),
          selected: selectedId === node.id,
        },
        zIndex: 1,
      });
    });
  }

  const flowEdges: Edge[] = edges.map((edge, index) => {
    const active = !near || (near.has(edge.source) && near.has(edge.target));
    const sourceNode = graph.nodes.find((n) => n.id === edge.source);
    const style = nodeStyle(sourceNode?.type ?? 'Concept');
    // Structural edges are the skeleton; they stay quiet unless selected.
    const structural = ['broader', 'serves_domain', 'in_library', 'mentioned_in']
      .includes(edge.predicate);

    return {
      id: `${edge.source}->${edge.target}-${edge.predicate}-${index}`,
      source: edge.source,
      target: edge.target,
      label: active && !structural ? edge.predicate.replace(/_/g, ' ') : undefined,
      animated: active && !!near && !structural,
      style: {
        stroke: structural ? '#475569' : style.color,
        strokeWidth: active ? (structural ? 1 : 1.4) : 0.8,
        opacity: active ? (structural ? 0.35 : 0.7) : 0.05,
        strokeDasharray: structural ? '4 3' : undefined,
      },
      labelStyle: { fill: '#cbd5e1', fontSize: 9 },
      labelBgStyle: { fill: '#0f172a', fillOpacity: 0.85 },
      zIndex: 2,
    };
  });

  return { nodes: flowNodes, edges: flowEdges };
}

// ── Canvas ─────────────────────────────────────────────────────────────────

export function GraphLegend({ types }: { types: string[] }) {
  if (!types.length) return null;
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
      {types.map((type) => (
        <span key={type} className="flex items-center gap-1.5 text-[10px] text-[var(--color-text-muted)]">
          <span className="h-2 w-2 rounded-full" style={{ background: nodeStyle(type).color }} />
          {type}
        </span>
      ))}
    </div>
  );
}

function Canvas({
  graph,
  clusterBy,
  onSelect,
}: {
  graph: UnifiedGraph;
  clusterBy: ClusterBy;
  onSelect?: (node: UnifiedNode | null) => void;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const { fitView } = useReactFlow();

  // A new graph invalidates the selection: the node may be gone, and a stale
  // id would dim everything against nothing.
  useEffect(() => {
    setSelectedId(null);
  }, [graph]);

  const { nodes, edges } = useMemo(
    () => layout(graph, clusterBy, selectedId),
    [graph, clusterBy, selectedId],
  );

  // Re-fit when the grouping changes, since the whole layout moves.
  useEffect(() => {
    const timer = setTimeout(() => fitView({ duration: 400, padding: 0.12 }), 60);
    return () => clearTimeout(timer);
  }, [clusterBy, graph, fitView]);

  const handleNodeClick = useCallback(
    (_: unknown, node: Node) => {
      if (node.type === 'cluster') return;
      const next = selectedId === node.id ? null : node.id;
      setSelectedId(next);
      onSelect?.(next ? ((node.data as { node: UnifiedNode }).node) : null);
    },
    [selectedId, onSelect],
  );

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={NODE_TYPES}
      onNodeClick={handleNodeClick}
      onPaneClick={() => {
        setSelectedId(null);
        onSelect?.(null);
      }}
      fitView
      minZoom={0.04}
      maxZoom={2.5}
      proOptions={{ hideAttribution: true }}
    >
      <Background variant={BackgroundVariant.Dots} gap={24} size={1} color="#1e293b" />
      <Controls showInteractive={false} className="!border-white/10 !bg-black/50" />
      <MiniMap
        pannable
        zoomable
        nodeColor={(node) =>
          node.type === 'cluster'
            ? 'transparent'
            : nodeStyle((node.data as { node: UnifiedNode }).node.type).color
        }
        maskColor="rgba(2,6,23,0.78)"
        className="!border-white/10 !bg-black/50"
      />
      {selectedId && (
        <Panel position="top-left">
          <button
            onClick={() => { setSelectedId(null); onSelect?.(null); }}
            className="flex items-center gap-1 rounded-lg border border-[var(--color-border-subtle)] bg-black/70 px-2 py-1 text-[10px] text-[var(--color-text-secondary)] hover:text-white"
          >
            <X size={10} /> clear selection
          </button>
        </Panel>
      )}
    </ReactFlow>
  );
}

export default function UnifiedGraphCanvas({
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
  const container = useRef<HTMLDivElement>(null);

  // The real Fullscreen API, not a fixed-position div: a graph is the one thing
  // in this app worth giving the whole screen, and the browser's own control
  // (and Escape) should work the way the user expects.
  const toggleFullscreen = useCallback(async () => {
    const element = container.current;
    if (!element) return;
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await element.requestFullscreen();
    } catch {
      // Denied or unsupported — fall back to the in-page expansion, which is
      // most of the benefit anyway.
      setFullscreen((v) => !v);
    }
  }, []);

  useEffect(() => {
    const onChange = () => setFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  const types = useMemo(
    () => Array.from(new Set(graph.nodes.map((n) => (n.kind === 'entity' ? n.type : ''))))
      .filter(Boolean).sort(),
    [graph],
  );

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
          {graph.nodes.length} nodes · {graph.edges.length} edges
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

      {types.length > 0 && (
        <div className="absolute bottom-3 left-3 z-10 max-w-[60%] rounded-lg bg-black/70 px-2.5 py-1.5">
          <GraphLegend types={types} />
        </div>
      )}

      <ReactFlowProvider>
        <Canvas graph={graph} clusterBy={clusterBy} onSelect={onSelect} />
      </ReactFlowProvider>
    </div>
  );
}
