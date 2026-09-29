import dagre from "dagre";
import type { LayoutDirection, StepFlowEdge, StepFlowNode } from "./types";

const NODE_WIDTH = 280;
const NODE_HEIGHT = 200;

/** Auto-layouts nodes with dagre; preserves any coordinates already present when `respectExisting` is true. */
export function layoutGraph(
  nodes: StepFlowNode[],
  edges: StepFlowEdge[],
  direction: LayoutDirection = "LR",
): StepFlowNode[] {
  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({ rankdir: direction, nodesep: 56, ranksep: 96, marginx: 40, marginy: 40 });

  for (const n of nodes) {
    g.setNode(n.id, { width: NODE_WIDTH, height: NODE_HEIGHT });
  }
  for (const e of edges) {
    if (g.hasNode(e.source) && g.hasNode(e.target)) g.setEdge(e.source, e.target);
  }

  dagre.layout(g);

  return nodes.map((n) => {
    const pos = g.node(n.id);
    if (!pos) return n;
    return {
      ...n,
      position: { x: pos.x - NODE_WIDTH / 2, y: pos.y - NODE_HEIGHT / 2 },
    };
  });
}

export { NODE_WIDTH, NODE_HEIGHT };
