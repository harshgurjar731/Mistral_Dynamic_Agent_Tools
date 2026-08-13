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
  applyNodeChanges,
  useReactFlow,
  type Node,
  type NodeChange,
  type NodeProps,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import {
  Boxes, Cpu, Database, GitBranch, Layers, Loader2, Minus, Network,
  Plug, Plus, ShieldCheck, Wrench,
} from 'lucide-react';
import { cn } from '../../../lib/utils';
import type { GraphNode, OntologyGraph } from '../../../api/ontology';
import { KIND_STYLES, kindStyle, layoutGraph } from './graphLayout';

/**
 * The interactive knowledge-graph surface.
 *
 * Selection is the primary interaction: clicking a node fades everything it is
 * not connected to and animates its edges, which is the only way a graph this
 * dense stays readable. The alternative — filtering the data on every click —
 * loses the surrounding context that makes the answer meaningful.
 */

const KIND_ICONS: Record<string, typeof Layers> = {
  industry: Boxes,
  domain: Layers,
  subdomain: Network,
  capability: ShieldCheck,
  data_class: Database,
  agent_tier: Layers,
  agent: Cpu,
  workflow: GitBranch,
  tool: Wrench,
  connector: Plug,
};

/**
 * One node: a circle with its label underneath.
 *
 * Both handles are pinned to the circle rather than the container, which also
 * spans the label — otherwise every edge would leave from below the text and
 * the arrows would visibly miss the shape they belong to.
 *
 * Memoised because hundreds mount at once and selection re-renders all of them.
 */
const OntologyNode = memo(({ data }: NodeProps) => {
  const node = data.node as GraphNode;
  const dimmed = data.dimmed as boolean;
  const selected = data.selected as boolean;
  const diameter = data.diameter as number;
  const width = data.width as number;
  const expandable = data.expandable as boolean;
  const isExpanded = data.isExpanded as boolean;
  const style = kindStyle(node.kind);
  const Icon = KIND_ICONS[node.kind] ?? Layers;

  // Icon scales with the circle so a hub does not end up mostly empty.
  const iconSize = Math.round(diameter * 0.36);

  // A concept advertises what is beneath it; a resource has nothing beneath it,
  // so it falls back to how many things reference it.
  const badge = node.subject_type ? (node.degree > 2 ? node.degree : 0) : (node.rollup_total ?? 0);

  return (
    <div
      style={{ width, opacity: dimmed ? 0.14 : 1 }}
      className="relative flex flex-col items-center transition-opacity"
      title={`${style.label}: ${node.label}${node.definition ? `\n\n${node.definition}` : ''}`}
    >
      <Handle
        type="target"
        position={Position.Top}
        style={{ top: 0, left: '50%', opacity: 0, width: 1, height: 1, border: 'none' }}
      />

      {/* The badge is anchored to the circle, not the container — the container
          is as wide as the label, so a small circle would leave it stranded. */}
      <div className="relative shrink-0" style={{ width: diameter, height: diameter }}>
        <div
          style={{
            width: diameter,
            height: diameter,
            background: style.bg,
            borderColor: selected ? style.color : `${style.color}70`,
            borderWidth: selected ? 3 : 2,
            boxShadow: selected
              ? `0 0 0 4px ${style.color}33, 0 8px 24px rgba(0,0,0,0.5)`
              : '0 2px 10px rgba(0,0,0,0.35)',
          }}
          className="flex h-full w-full items-center justify-center rounded-full border backdrop-blur-sm"
        >
          <Icon size={iconSize} style={{ color: style.color }} />
        </div>

        {/* For a concept, what lives beneath it is the useful number — edge
            count is an artefact of how it happens to be wired. */}
        {badge > 0 && (
          <span
            style={{ background: style.color }}
            className="pointer-events-none absolute -right-1 -top-1 min-w-[15px] rounded-full px-1 text-center font-mono text-[8px] font-bold leading-[15px] text-[var(--color-bg-base)]"
          >
            {badge > 99 ? '99+' : badge}
          </span>
        )}

        {/* Expand affordance: a collapsed node with children says so, rather
            than looking identical to a leaf you have already opened. */}
        {expandable && (
          <span
            style={{ borderColor: `${style.color}70`, color: style.color }}
            className="pointer-events-none absolute -bottom-0.5 -left-1 flex h-3.5 w-3.5 items-center justify-center rounded-full border bg-[var(--color-bg-base)]"
          >
            {isExpanded ? <Minus size={7} strokeWidth={3.5} /> : <Plus size={7} strokeWidth={3.5} />}
          </span>
        )}
      </div>

      <div
        className="mt-1.5 w-full text-center text-[10px] font-medium leading-[1.15] text-white"
        style={{
          // Two lines maximum: a third would push into the next rank's circles.
          display: '-webkit-box',
          WebkitLineClamp: 2,
          WebkitBoxOrient: 'vertical',
          overflow: 'hidden',
          // A dark outline keeps the label legible where an edge passes behind.
          textShadow: '0 1px 3px rgba(6,9,15,0.95), 0 0 2px rgba(6,9,15,0.9)',
        }}
      >
        {node.label}
      </div>

      <Handle
        type="source"
        position={Position.Bottom}
        style={{
          top: diameter,
          bottom: 'auto',
          left: '50%',
          opacity: 0,
          width: 1,
          height: 1,
          border: 'none',
        }}
      />
    </div>
  );
});
OntologyNode.displayName = 'OntologyNode';

const nodeTypes = { ontology: OntologyNode };

interface CanvasProps {
  graph?: OntologyGraph;
  isLoading?: boolean;
  selectedId: string | null;
  onSelect: (node: GraphNode | null) => void;
  emptyHint?: string;
  /** Ids that have children. Omit to hide the expand affordance entirely. */
  expandable?: Set<string>;
  expandedIds?: Set<string>;
}

function Canvas({
  graph,
  isLoading,
  selectedId,
  onSelect,
  emptyHint,
  expandable,
  expandedIds,
}: CanvasProps) {
  const { fitView } = useReactFlow();

  const laidOut = useMemo(
    () =>
      graph
        ? layoutGraph(graph, { selectedId, dimUnrelated: true, expandable, expandedIds })
        : { nodes: [], edges: [] },
    [graph, selectedId, expandable, expandedIds],
  );

  // Local node state so dragging works; re-seeded whenever the layout changes.
  const [nodes, setNodes] = useState<Node[]>(laidOut.nodes);
  useEffect(() => setNodes(laidOut.nodes), [laidOut.nodes]);

  const onNodesChange = useCallback(
    (changes: NodeChange[]) => setNodes((current) => applyNodeChanges(changes, current)),
    [],
  );

  // Re-frame when the data changes shape, not on every selection — refitting on
  // click would yank the viewport away from whatever the user was looking at.
  //
  // `minZoom` matters more than it looks: the full graph is ~1900x5200px, and
  // an honest fit of that into a 700px-tall panel lands at 0.14 scale, where
  // every node is an unreadable dot. Better to show the top of it at a legible
  // size and let the user pan — the minimap and the filters are how you get
  // around a graph this size, not zooming out until it is meaningless.
  const nodeCount = graph?.nodes.length ?? 0;
  useEffect(() => {
    if (!nodeCount) return;
    const timer = setTimeout(
      () => fitView({ padding: 0.12, duration: 400, minZoom: 0.32, maxZoom: 1.1 }),
      60,
    );
    return () => clearTimeout(timer);
  }, [nodeCount, fitView]);

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center gap-2 text-sm text-[var(--color-text-muted)]">
        <Loader2 size={16} className="animate-spin" />
        Building the graph…
      </div>
    );
  }

  if (!graph || !graph.nodes.length) {
    return (
      <div className="flex h-full flex-col items-center justify-center px-6 text-center">
        <Network size={26} className="mb-3 text-[var(--color-text-muted)] opacity-40" />
        <p className="text-sm text-[var(--color-text-secondary)]">Nothing to show</p>
        <p className="mt-1 max-w-sm text-xs text-[var(--color-text-muted)]">
          {emptyHint ?? 'No nodes match these filters. Try widening them.'}
        </p>
      </div>
    );
  }

  return (
    <ReactFlow
      nodes={nodes}
      edges={laidOut.edges}
      nodeTypes={nodeTypes}
      onNodesChange={onNodesChange}
      onNodeClick={(_, node) => onSelect((node.data as any).node as GraphNode)}
      onPaneClick={() => onSelect(null)}
      minZoom={0.05}
      maxZoom={2.5}
      proOptions={{ hideAttribution: true }}
      nodesConnectable={false}
      elementsSelectable
      className="bg-[var(--color-bg-base)]"
    >
      <Background variant={BackgroundVariant.Dots} gap={22} size={1} color="#1E293B" />
      <Controls
        showInteractive={false}
        className="!border-[var(--color-border-subtle)] !bg-[var(--color-bg-surface)] [&>button]:!border-[var(--color-border-subtle)] [&>button]:!bg-[var(--color-bg-surface)] [&>button]:!fill-white [&>button:hover]:!bg-[var(--color-bg-hover)]"
      />
      <MiniMap
        pannable
        zoomable
        nodeColor={(n) => kindStyle(((n.data as any).node as GraphNode).kind).color}
        maskColor="rgba(6,9,15,0.75)"
        className="!border !border-[var(--color-border-subtle)] !bg-[var(--color-bg-surface)]"
      />
    </ReactFlow>
  );
}

export default function OntologyGraphCanvas(props: CanvasProps) {
  return (
    <ReactFlowProvider>
      <Canvas {...props} />
    </ReactFlowProvider>
  );
}

/** Legend + per-kind counts. Doubles as the kind filter when handlers passed. */
export function GraphLegend({
  counts,
  active,
  onToggle,
}: {
  counts: Record<string, number>;
  active?: Set<string>;
  onToggle?: (kind: string) => void;
}) {
  const kinds = Object.keys(KIND_STYLES).filter((k) => counts[k]);

  return (
    <div className="flex flex-wrap gap-1.5">
      {kinds.map((kind) => {
        const style = KIND_STYLES[kind];
        const on = !active || active.has(kind);
        return (
          <button
            key={kind}
            type="button"
            onClick={onToggle ? () => onToggle(kind) : undefined}
            disabled={!onToggle}
            style={{
              borderColor: on ? `${style.color}66` : 'var(--color-border-subtle)',
              background: on ? style.bg : 'transparent',
            }}
            className={cn(
              'flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] transition-opacity',
              onToggle && 'cursor-pointer hover:opacity-90',
              !on && 'opacity-45',
            )}
          >
            <span
              className="h-1.5 w-1.5 rounded-full"
              style={{ background: style.color }}
            />
            <span className="text-[var(--color-text-secondary)]">{style.label}</span>
            <span className="font-mono tabular-nums text-[var(--color-text-muted)]">
              {counts[kind]}
            </span>
          </button>
        );
      })}
    </div>
  );
}
