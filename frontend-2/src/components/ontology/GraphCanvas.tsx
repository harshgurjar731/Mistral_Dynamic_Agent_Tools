import { useMemo } from "react";
import dagre from "dagre";
import {
  Background,
  BackgroundVariant,
  Controls,
  ReactFlow,
  ReactFlowProvider,
  type Edge,
  type Node,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { cn } from "@/lib/utils";

const NODE_WIDTH = 200;
const NODE_HEIGHT = 64;

export interface SimpleNode {
  id: string;
  label: string;
  sublabel?: string;
  tone?: "indigo" | "amber" | "emerald" | "cyan" | "purple" | "slate" | "blue" | "orange";
}
export interface SimpleEdge {
  id: string;
  source: string;
  target: string;
  label?: string;
  dashed?: boolean;
}

const TONE_CLASS: Record<string, string> = {
  indigo: "border-indigo/40 bg-indigo/10 text-indigo",
  amber: "border-amber/40 bg-amber/10 text-amber",
  emerald: "border-emerald/40 bg-emerald/10 text-emerald",
  cyan: "border-cyan/40 bg-cyan/10 text-cyan",
  purple: "border-purple/40 bg-purple/10 text-purple",
  slate: "border-slate/40 bg-slate/10 text-slate",
  blue: "border-blue/40 bg-blue/10 text-blue",
  orange: "border-orange/40 bg-orange/10 text-orange",
};

function layout(nodes: SimpleNode[], edges: SimpleEdge[]): Node[] {
  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({ rankdir: "LR", nodesep: 36, ranksep: 90, marginx: 24, marginy: 24 });
  for (const n of nodes) g.setNode(n.id, { width: NODE_WIDTH, height: NODE_HEIGHT });
  for (const e of edges) {
    if (g.hasNode(e.source) && g.hasNode(e.target)) g.setEdge(e.source, e.target);
  }
  dagre.layout(g);
  return nodes.map((n) => {
    const pos = g.node(n.id);
    return {
      id: n.id,
      position: pos ? { x: pos.x - NODE_WIDTH / 2, y: pos.y - NODE_HEIGHT / 2 } : { x: 0, y: 0 },
      data: {
        label: (
          <div
            className={cn(
              "flex w-full flex-col gap-0.5 rounded-xl border px-3 py-2 text-left backdrop-blur",
              TONE_CLASS[n.tone ?? "slate"],
            )}
            title={n.label}
          >
            <span className="truncate text-xs font-semibold">{n.label}</span>
            {n.sublabel ? (
              <span className="truncate text-[10px] opacity-80">{n.sublabel}</span>
            ) : null}
          </div>
        ),
      },
      style: { width: NODE_WIDTH },
      className: "!border-0 !bg-transparent !p-0 !shadow-none",
      draggable: false,
      selectable: true,
      connectable: false,
    };
  });
}

export function GraphCanvas({
  nodes,
  edges,
  onNodeClick,
  className,
  empty,
}: {
  nodes: SimpleNode[];
  edges: SimpleEdge[];
  onNodeClick?: (id: string) => void;
  className?: string;
  empty?: React.ReactNode;
}) {
  const flowNodes = useMemo(() => layout(nodes, edges), [nodes, edges]);
  const flowEdges = useMemo<Edge[]>(
    () =>
      edges
        .filter((e) => nodes.some((n) => n.id === e.source) && nodes.some((n) => n.id === e.target))
        .map((e) => ({
          id: e.id,
          source: e.source,
          target: e.target,
          ...(e.label ? { label: e.label } : {}),
          animated: false,
          ...(e.dashed ? { style: { strokeDasharray: "4 4" } } : {}),
          labelStyle: { fill: "var(--muted-foreground)", fontSize: 10 },
        })),
    [nodes, edges],
  );

  if (nodes.length === 0) {
    return (
      <div className={cn("flex h-full min-h-[24rem] items-center justify-center", className)}>
        {empty}
      </div>
    );
  }

  return (
    <div className={cn("h-full min-h-[24rem] w-full overflow-hidden rounded-2xl border border-border", className)}>
      <ReactFlowProvider>
        <ReactFlow
          nodes={flowNodes}
          edges={flowEdges}
          fitView
          proOptions={{ hideAttribution: true }}
          {...(onNodeClick ? { onNodeClick: (_e: unknown, node: { id: string }) => onNodeClick(node.id) } : {})}
      nodesDraggable={false}
          nodesConnectable={false}
        >
          <Background variant={BackgroundVariant.Dots} gap={20} size={1} />
          <Controls showInteractive={false} />
        </ReactFlow>
      </ReactFlowProvider>
    </div>
  );
}
