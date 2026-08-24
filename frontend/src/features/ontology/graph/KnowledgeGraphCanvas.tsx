import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import {
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  MiniMap,
  Position,
  ReactFlow,
  ReactFlowProvider,
  type Edge,
  type Node,
  type NodeProps,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import dagre from 'dagre';
import {
  Boxes, Building2, Cpu, FileText, Gauge, Landmark, MapPin, Package,
  Repeat, User,
} from 'lucide-react';
import type { GraphEdge, GraphNode, GraphSnapshot } from '../../../api/rag';

/**
 * The document knowledge graph.
 *
 * Deliberately not the ontology canvas. That one lays out a *hierarchy* —
 * industries above domains above subdomains, with a synthetic root — and its
 * layout logic follows containment edges to build a tree. A graph extracted
 * from documents has no root and no containment: "supplies_to" and "governs"
 * are peer relations, and forcing them into a tree would invent a hierarchy the
 * documents never stated.
 *
 * So: dagre left-to-right, which reads relations as flow, and the same
 * selection-fade interaction the ontology canvas uses — clicking a node dims
 * everything it is not connected to, which is the only way a dense graph stays
 * readable without filtering away the context that makes it meaningful.
 */

/** One visual identity per entity type, shared by the node and the legend. */
export const ENTITY_STYLES: Record<string, { color: string; bg: string; icon: typeof Boxes }> = {
  Person:       { color: '#F472B6', bg: 'rgba(244,114,182,0.13)', icon: User },
  Organization: { color: '#818CF8', bg: 'rgba(129,140,248,0.13)', icon: Building2 },
  Product:      { color: '#38BDF8', bg: 'rgba(56,189,248,0.12)',  icon: Package },
  Process:      { color: '#2DD4BF', bg: 'rgba(45,212,191,0.12)',  icon: Repeat },
  Metric:       { color: '#34D399', bg: 'rgba(52,211,153,0.12)',  icon: Gauge },
  Regulation:   { color: '#FBBF24', bg: 'rgba(251,191,36,0.12)',  icon: Landmark },
  System:       { color: '#A78BFA', bg: 'rgba(167,139,250,0.12)', icon: Cpu },
  Location:     { color: '#FB923C', bg: 'rgba(251,146,60,0.12)',  icon: MapPin },
  Event:        { color: '#F87171', bg: 'rgba(248,113,113,0.12)', icon: FileText },
  Concept:      { color: '#94A3B8', bg: 'rgba(148,163,184,0.12)', icon: Boxes },
};

const FALLBACK = ENTITY_STYLES.Concept;

export function entityStyle(type: string) {
  return ENTITY_STYLES[type] ?? FALLBACK;
}

const NODE_WIDTH = 190;
const NODE_HEIGHT = 56;

const EntityNode = memo(({ data }: NodeProps) => {
  const node = data.node as GraphNode;
  const dimmed = data.dimmed as boolean;
  const selected = data.selected as boolean;
  const style = entityStyle(node.type);
  const Icon = style.icon;

  return (
    <div
      style={{
        width: NODE_WIDTH,
        opacity: dimmed ? 0.15 : 1,
        borderColor: selected ? style.color : 'rgba(148,163,184,0.25)',
        background: style.bg,
        boxShadow: selected ? `0 0 0 2px ${style.color}66` : undefined,
      }}
      className="flex items-center gap-2 rounded-lg border px-2.5 py-2 transition-opacity"
      title={node.description || node.label}
    >
      <Handle type="target" position={Position.Left} className="!h-1.5 !w-1.5 !border-0 !bg-slate-500" />
      <span
        className="flex h-6 w-6 shrink-0 items-center justify-center rounded"
        style={{ background: `${style.color}22`, color: style.color }}
      >
        <Icon size={13} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[11px] font-medium leading-tight text-white">
          {node.label}
        </span>
        <span className="block truncate text-[9px] leading-tight" style={{ color: style.color }}>
          {node.type}
          {node.degree > 0 ? ` · ${node.degree}` : ''}
        </span>
      </span>
      <Handle type="source" position={Position.Right} className="!h-1.5 !w-1.5 !border-0 !bg-slate-500" />
    </div>
  );
});
EntityNode.displayName = 'EntityNode';

const NODE_TYPES = { entity: EntityNode };

/** Which nodes are within one hop of the selection, in either direction. */
function neighbourhood(id: string, edges: GraphEdge[]): Set<string> {
  const near = new Set<string>([id]);
  for (const edge of edges) {
    if (edge.source === id) near.add(edge.target);
    if (edge.target === id) near.add(edge.source);
  }
  return near;
}

function layout(
  snapshot: GraphSnapshot,
  selectedId: string | null,
): { nodes: Node[]; edges: Edge[] } {
  const dag = new dagre.graphlib.Graph();
  dag.setDefaultEdgeLabel(() => ({}));
  // Left to right: a relation reads as a sentence — subject, verb, object — and
  // horizontal flow is how that scans.
  dag.setGraph({ rankdir: 'LR', nodesep: 28, ranksep: 110, marginx: 40, marginy: 40 });

  for (const node of snapshot.nodes) {
    dag.setNode(node.id, { width: NODE_WIDTH, height: NODE_HEIGHT });
  }
  const present = new Set(snapshot.nodes.map((n) => n.id));
  const edges = snapshot.edges.filter((e) => present.has(e.source) && present.has(e.target));
  for (const edge of edges) {
    dag.setEdge(edge.source, edge.target);
  }
  dagre.layout(dag);

  const near = selectedId ? neighbourhood(selectedId, edges) : null;

  const laidOut: Node[] = snapshot.nodes.map((node) => {
    const position = dag.node(node.id);
    return {
      id: node.id,
      type: 'entity',
      position: {
        x: (position?.x ?? 0) - NODE_WIDTH / 2,
        y: (position?.y ?? 0) - NODE_HEIGHT / 2,
      },
      data: {
        node,
        dimmed: !!near && !near.has(node.id),
        selected: selectedId === node.id,
      },
      draggable: true,
    };
  });

  const flowEdges: Edge[] = edges.map((edge, index) => {
    const active = !near || (near.has(edge.source) && near.has(edge.target));
    const style = entityStyle(
      snapshot.nodes.find((n) => n.id === edge.source)?.type ?? 'Concept',
    );
    return {
      id: `${edge.source}->${edge.target}-${edge.predicate}-${index}`,
      source: edge.source,
      target: edge.target,
      label: edge.predicate.replace(/_/g, ' '),
      animated: active && !!near,
      style: {
        stroke: style.color,
        strokeWidth: active ? 1.4 : 1,
        opacity: active ? 0.75 : 0.08,
      },
      labelStyle: {
        fill: '#cbd5e1',
        fontSize: 9,
        opacity: active ? 1 : 0.1,
      },
      labelBgStyle: { fill: '#0f172a', fillOpacity: active ? 0.85 : 0 },
    };
  });

  return { nodes: laidOut, edges: flowEdges };
}

export function GraphLegend({ types }: { types: string[] }) {
  const shown = types.length ? types : Object.keys(ENTITY_STYLES);
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
      {shown.map((type) => {
        const style = entityStyle(type);
        return (
          <span key={type} className="flex items-center gap-1.5 text-[10px] text-[var(--color-text-muted)]">
            <span className="h-2 w-2 rounded-full" style={{ background: style.color }} />
            {type}
          </span>
        );
      })}
    </div>
  );
}

function Canvas({
  snapshot,
  onSelect,
}: {
  snapshot: GraphSnapshot;
  onSelect?: (node: GraphNode | null) => void;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // A new snapshot invalidates the selection: the node may not exist any more,
  // and a stale id would dim the entire graph against nothing.
  useEffect(() => {
    setSelectedId(null);
  }, [snapshot]);

  const { nodes, edges } = useMemo(() => layout(snapshot, selectedId), [snapshot, selectedId]);

  const handleNodeClick = useCallback(
    (_: unknown, node: Node) => {
      const next = selectedId === node.id ? null : node.id;
      setSelectedId(next);
      onSelect?.(next ? ((node.data as { node: GraphNode }).node) : null);
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
      minZoom={0.1}
      maxZoom={2}
      proOptions={{ hideAttribution: true }}
    >
      <Background variant={BackgroundVariant.Dots} gap={22} size={1} color="#1e293b" />
      <Controls showInteractive={false} className="!bg-black/40 !border-white/10" />
      <MiniMap
        pannable
        zoomable
        nodeColor={(node) => entityStyle((node.data as { node: GraphNode }).node.type).color}
        maskColor="rgba(2,6,23,0.75)"
        className="!bg-black/40 !border-white/10"
      />
    </ReactFlow>
  );
}

export default function KnowledgeGraphCanvas({
  snapshot,
  height = 520,
  onSelect,
}: {
  snapshot: GraphSnapshot;
  height?: number;
  onSelect?: (node: GraphNode | null) => void;
}) {
  if (!snapshot.available) {
    return (
      <div
        style={{ height }}
        className="flex items-center justify-center rounded-lg border border-dashed border-[var(--color-border-subtle)]"
      >
        <p className="max-w-sm text-center text-xs text-[var(--color-text-muted)]">
          The knowledge graph is unavailable. Start it with{' '}
          <code className="rounded bg-black/40 px-1 font-mono">docker compose up -d neo4j</code>.
        </p>
      </div>
    );
  }

  if (!snapshot.nodes.length) {
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

  return (
    <div
      style={{ height }}
      className="overflow-hidden rounded-lg border border-[var(--color-border-subtle)] bg-black/20"
    >
      <ReactFlowProvider>
        <Canvas snapshot={snapshot} onSelect={onSelect} />
      </ReactFlowProvider>
    </div>
  );
}
