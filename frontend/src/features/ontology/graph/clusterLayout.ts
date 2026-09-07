import type { UnifiedGraph, UnifiedNode } from '../../../api/rag';
import { nodeStyle } from './entityStyle';

/**
 * Deterministic per-type layout for the content graph.
 *
 * Ported from the React Flow canvas this replaced. It's plain arithmetic —
 * group nodes by cluster, pack each cluster's grid, pack the clusters
 * themselves into rows — so it stays fast at any node count. The thing that
 * couldn't scale in the old canvas was drawing a real DOM element per node,
 * not this math; Sigma renders from these same fixed coordinates with no
 * force simulation needed.
 */

/** How a node is grouped into a cluster. */
export type ClusterBy = 'type' | 'kind' | 'none';

export const KIND_LABELS: Record<string, string> = {
  concept: 'Taxonomy',
  library: 'Libraries',
  document: 'Documents',
  entity: 'Entities',
};

export function clusterKey(node: UnifiedNode, by: ClusterBy): string {
  if (by === 'none') return 'all';
  if (by === 'kind') return KIND_LABELS[node.kind] ?? node.kind;
  // Grouping the platform levels by their own name keeps concepts, libraries
  // and documents from being scattered through the content clusters.
  if (node.kind !== 'entity') return KIND_LABELS[node.kind] ?? node.kind;
  return node.type || 'Concept';
}

// Cell sizing tuned for small circular sigma nodes plus a label underneath —
// much tighter than the ~168x46 HTML cards the old canvas drew.
const CELL_W = 30;
const CELL_H = 26;
const GAP_X = 8;
const GAP_Y = 16;
const CLUSTER_PAD = 20;
const CLUSTER_GAP = 90;

export interface ClusterInfo {
  key: string;
  x: number;
  y: number;
  width: number;
  height: number;
  count: number;
  color: string;
}

export interface ClusterLayout {
  positions: Map<string, { x: number; y: number }>;
  clusters: ClusterInfo[];
}

interface Cell {
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
 * total area — keeps the aspect ratio close to the viewport's instead of one
 * long unreadable row.
 */
function packClusters(cells: Cell[]): void {
  const totalArea = cells.reduce((sum, c) => sum + c.width * c.height, 0);
  const targetWidth = Math.max(
    Math.sqrt(totalArea * 1.6),
    Math.max(...cells.map((c) => c.width), 0),
  );

  let x = 0;
  let y = 0;
  let rowHeight = 0;

  for (const cell of cells) {
    if (x > 0 && x + cell.width > targetWidth) {
      x = 0;
      y += rowHeight + CLUSTER_GAP;
      rowHeight = 0;
    }
    cell.x = x;
    cell.y = y;
    x += cell.width + CLUSTER_GAP;
    rowHeight = Math.max(rowHeight, cell.height);
  }
}

export function computeClusterLayout(graph: UnifiedGraph, clusterBy: ClusterBy): ClusterLayout {
  const grouped = new Map<string, UnifiedNode[]>();
  for (const node of graph.nodes) {
    const key = clusterKey(node, clusterBy);
    const list = grouped.get(key);
    if (list) list.push(node);
    else grouped.set(key, [node]);
  }

  const cells: Cell[] = [...grouped.entries()]
    .map(([key, nodes]) => {
      // Highest-degree nodes first, so hubs land top-left where the eye starts.
      const sorted = [...nodes].sort((a, b) => b.degree - a.degree);
      const cols = Math.max(1, Math.ceil(Math.sqrt(sorted.length * 1.4)));
      const rows = Math.ceil(sorted.length / cols);
      return {
        key,
        nodes: sorted,
        cols,
        width: cols * CELL_W + (cols - 1) * GAP_X + CLUSTER_PAD * 2,
        height: rows * CELL_H + (rows - 1) * GAP_Y + CLUSTER_PAD * 2,
        x: 0,
        y: 0,
      };
    })
    .sort((a, b) => b.nodes.length - a.nodes.length);

  packClusters(cells);

  const positions = new Map<string, { x: number; y: number }>();
  const clusters: ClusterInfo[] = [];

  for (const cell of cells) {
    cell.nodes.forEach((node, index) => {
      const col = index % cell.cols;
      const row = Math.floor(index / cell.cols);
      positions.set(node.id, {
        x: cell.x + CLUSTER_PAD + col * (CELL_W + GAP_X),
        y: cell.y + CLUSTER_PAD + row * (CELL_H + GAP_Y),
      });
    });

    clusters.push({
      key: cell.key,
      x: cell.x,
      y: cell.y,
      width: cell.width,
      height: cell.height,
      count: cell.nodes.length,
      color: nodeStyle(cell.nodes[0]?.type ?? 'Concept').color,
    });
  }

  return { positions, clusters };
}
