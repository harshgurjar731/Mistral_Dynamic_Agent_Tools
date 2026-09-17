import { memo, useMemo, type ReactNode } from "react";
import dagre from "dagre";
import {
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  MarkerType,
  MiniMap,
  Panel,
  Position,
  ReactFlow,
  ReactFlowProvider,
  type Edge,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { cn } from "@/lib/utils";
import { TONE_VAR, type GraphTone } from "./graphTones";

const NODE_WIDTH = 212;
const NODE_HEIGHT = 62;

export type { GraphTone };

export interface SimpleNode {
  id: string;
  label: string;
  sublabel?: string;
  tone?: GraphTone;
}
export interface SimpleEdge {
  id: string;
  source: string;
  target: string;
  label?: string;
  dashed?: boolean;
}

interface NodeData extends Record<string, unknown> {
  label: string;
  sublabel?: string | undefined;
  tone: GraphTone;
  dimmed: boolean;
  focused: boolean;
}

const HANDLE_STYLE = { opacity: 0, width: 1, height: 1, border: 0 } as const;

const OntologyNode = memo(function OntologyNode({ data, selected }: NodeProps) {
  const { label, sublabel, tone, dimmed, focused } = data as NodeData;
  const accent = TONE_VAR[tone];
  return (
    <div
      title={label}
      className={cn(
        "group/node relative flex w-full flex-col justify-center gap-0.5 rounded-xl border px-3 py-2 text-left transition-all duration-200",
        "bg-background-elevated/90 backdrop-blur-sm",
        dimmed ? "opacity-25" : "opacity-100",
        selected || focused
          ? "shadow-[0_0_0_1px_var(--accent-color),0_8px_24px_-12px_var(--accent-color)]"
          : "",
      )}
      style={
        {
          "--accent-color": accent,
          borderColor: selected || focused ? accent : "var(--border)",
          height: NODE_HEIGHT,
        } as React.CSSProperties
      }
    >
      <Handle type="target" position={Position.Left} style={HANDLE_STYLE} isConnectable={false} />
      <div className="flex items-center gap-1.5">
        <span
          className="size-1.5 shrink-0 rounded-full"
          style={{ background: accent, boxShadow: `0 0 6px -1px ${accent}` }}
        />
        <span className="truncate text-xs font-semibold text-foreground">{label}</span>
      </div>
      {sublabel ? (
        <span className="truncate pl-3 text-[10px] text-muted-foreground">{sublabel}</span>
      ) : null}
      <Handle type="source" position={Position.Right} style={HANDLE_STYLE} isConnectable={false} />
    </div>
  );
});

const nodeTypes = { ontology: OntologyNode };

function layout(
  nodes: SimpleNode[],
  edges: SimpleEdge[],
  rankdir: "LR" | "TB",
): Record<string, { x: number; y: number }> {
  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({
    rankdir,
    nodesep: rankdir === "LR" ? 28 : 44,
    ranksep: rankdir === "LR" ? 120 : 84,
    marginx: 40,
    marginy: 40,
  });
  for (const n of nodes) g.setNode(n.id, { width: NODE_WIDTH, height: NODE_HEIGHT });
  for (const e of edges) {
    if (g.hasNode(e.source) && g.hasNode(e.target)) g.setEdge(e.source, e.target);
  }
  dagre.layout(g);
  const out: Record<string, { x: number; y: number }> = {};
  for (const n of nodes) {
    const pos = g.node(n.id);
    out[n.id] = pos ? { x: pos.x - NODE_WIDTH / 2, y: pos.y - NODE_HEIGHT / 2 } : { x: 0, y: 0 };
  }
  return out;
}

export function GraphCanvas({
  nodes,
  edges,
  onNodeClick,
  onPaneClick,
  selectedId,
  rankdir = "LR",
  toolbar,
  legend,
  minimap = false,
  className,
  empty,
}: {
  nodes: SimpleNode[];
  edges: SimpleEdge[];
  onNodeClick?: (id: string) => void;
  onPaneClick?: () => void;
  /** Highlights this node and fades everything not connected to it. */
  selectedId?: string | null;
  rankdir?: "LR" | "TB";
  /** Floating controls rendered over the top-left of the canvas. */
  toolbar?: ReactNode;
  /** Floating key rendered over the bottom-left of the canvas. */
  legend?: ReactNode;
  minimap?: boolean;
  className?: string;
  empty?: ReactNode;
}) {
  /** Ids one hop from the selection — the rest of the graph is faded out. */
  const neighbourhood = useMemo(() => {
    if (!selectedId) return null;
    const ids = new Set<string>([selectedId]);
    for (const e of edges) {
      if (e.source === selectedId) ids.add(e.target);
      if (e.target === selectedId) ids.add(e.source);
    }
    return ids;
  }, [selectedId, edges]);

  const positions = useMemo(() => layout(nodes, edges, rankdir), [nodes, edges, rankdir]);

  const flowNodes = useMemo<Node<NodeData>[]>(
    () =>
      nodes.map((n) => ({
        id: n.id,
        type: "ontology",
        position: positions[n.id] ?? { x: 0, y: 0 },
        data: {
          label: n.label,
          sublabel: n.sublabel,
          tone: n.tone ?? "slate",
          dimmed: Boolean(neighbourhood && !neighbourhood.has(n.id)),
          focused: n.id === selectedId,
        },
        style: { width: NODE_WIDTH, height: NODE_HEIGHT },
        draggable: false,
        connectable: false,
      })),
    [nodes, positions, neighbourhood, selectedId],
  );

  const flowEdges = useMemo<Edge[]>(() => {
    const present = new Set(nodes.map((n) => n.id));
    return edges
      .filter((e) => present.has(e.source) && present.has(e.target))
      .map((e) => {
        const active =
          !neighbourhood || (neighbourhood.has(e.source) && neighbourhood.has(e.target));
        const touchesSelection =
          Boolean(selectedId) && (e.source === selectedId || e.target === selectedId);
        const stroke = touchesSelection ? "var(--primary)" : "var(--border-strong)";
        return {
          id: e.id,
          source: e.source,
          target: e.target,
          type: "smoothstep",
          ...(e.label ? { label: e.label } : {}),
          style: {
            stroke,
            strokeWidth: touchesSelection ? 1.6 : 1,
            opacity: active ? 1 : 0.12,
            ...(e.dashed ? { strokeDasharray: "4 4" } : {}),
          },
          markerEnd: {
            type: MarkerType.ArrowClosed,
            width: 14,
            height: 14,
            color: stroke,
          },
          labelShowBg: true,
          labelBgPadding: [5, 2] as [number, number],
          labelBgBorderRadius: 4,
          labelBgStyle: { fill: "var(--background-elevated)", fillOpacity: active ? 0.92 : 0.1 },
          labelStyle: {
            fill: "var(--muted-foreground)",
            fontSize: 9,
            textTransform: "uppercase" as const,
            letterSpacing: "0.04em",
            opacity: active ? 1 : 0.12,
          },
        } satisfies Edge;
      });
  }, [nodes, edges, neighbourhood, selectedId]);

  if (nodes.length === 0) {
    return (
      <div className={cn("flex h-full min-h-[24rem] items-center justify-center", className)}>
        {empty}
      </div>
    );
  }

  return (
    <div
      className={cn(
        "ontology-canvas relative h-full min-h-[24rem] w-full overflow-hidden rounded-2xl border border-border/60",
        className,
      )}
      style={{ background: "var(--background)" }}
    >
      <ReactFlowProvider>
        <ReactFlow
          colorMode="dark"
          nodes={flowNodes}
          edges={flowEdges}
          nodeTypes={nodeTypes}
          fitView
          fitViewOptions={{ padding: 0.18, maxZoom: 1.1 }}
          minZoom={0.2}
          maxZoom={1.8}
          proOptions={{ hideAttribution: true }}
          nodesDraggable={false}
          nodesConnectable={false}
          elementsSelectable
          panOnScroll
          selectionOnDrag={false}
          {...(onNodeClick
            ? { onNodeClick: (_e: unknown, node: { id: string }) => onNodeClick(node.id) }
            : {})}
          {...(onPaneClick ? { onPaneClick } : {})}
        >
          <Background
            variant={BackgroundVariant.Dots}
            gap={22}
            size={1}
            color="var(--border-strong)"
          />
          <Controls
            showInteractive={false}
            className="!rounded-xl !border !border-border/60 !bg-surface/80 !shadow-none !backdrop-blur-md"
          />
          {minimap ? (
            <MiniMap
              pannable
              zoomable
              className="!rounded-xl !border !border-border/60 !bg-surface/80 !backdrop-blur-md"
              maskColor="oklch(0 0 0 / 0.55)"
              nodeColor={(n) => TONE_VAR[(n.data as NodeData)?.tone ?? "slate"]}
              nodeStrokeWidth={0}
              nodeBorderRadius={4}
            />
          ) : null}
          {toolbar ? (
            <Panel position="top-left" className="!m-3">
              {toolbar}
            </Panel>
          ) : null}
          {legend ? (
            <Panel position="bottom-left" className="!m-3 !ml-16">
              {legend}
            </Panel>
          ) : null}
        </ReactFlow>
      </ReactFlowProvider>
    </div>
  );
}
