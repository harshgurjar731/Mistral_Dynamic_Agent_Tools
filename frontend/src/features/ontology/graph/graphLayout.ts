import dagre from 'dagre';
import type { Edge, Node } from '@xyflow/react';
import type { GraphEdge, GraphNode, OntologyGraph } from '../../../api/ontology';

/**
 * Turning the API's node/edge lists into a laid-out ReactFlow graph.
 *
 * Layout is dagre, left-to-right, because the graph is fundamentally
 * hierarchical: industries flow down to domains to subdomains, and resources
 * hang off whichever concept they are annotated against. A force-directed
 * layout would look organic and read as noise — you could not tell an industry
 * from a leaf at a glance.
 */

/** One visual identity per node kind, used by the node, the legend and filters. */
export interface KindStyle {
  label: string;
  /** Border and accent colour. */
  color: string;
  /** Background tint. */
  bg: string;
  /** Ordering in the legend and the layout ranks. */
  rank: number;
}

export const KIND_STYLES: Record<string, KindStyle> = {
  industry:   { label: 'Industry',   color: '#8B5CF6', bg: 'rgba(139,92,246,0.14)',  rank: 0 },
  domain:     { label: 'Domain',     color: '#6366F1', bg: 'rgba(99,102,241,0.13)',  rank: 1 },
  subdomain:  { label: 'Subdomain',  color: '#38BDF8', bg: 'rgba(56,189,248,0.12)',  rank: 2 },
  capability: { label: 'Capability', color: '#06B6D4', bg: 'rgba(6,182,212,0.12)',   rank: 3 },
  data_class: { label: 'Data class', color: '#F59E0B', bg: 'rgba(245,158,11,0.12)',  rank: 4 },
  agent_tier: { label: 'Tier',       color: '#94A3B8', bg: 'rgba(148,163,184,0.12)', rank: 5 },
  agent:      { label: 'Agent',      color: '#10B981', bg: 'rgba(16,185,129,0.12)',  rank: 6 },
  workflow:   { label: 'Workflow',   color: '#EC4899', bg: 'rgba(236,72,153,0.12)',  rank: 7 },
  tool:       { label: 'Tool',       color: '#FB923C', bg: 'rgba(251,146,60,0.12)',  rank: 8 },
  connector:  { label: 'Connector',  color: '#A3E635', bg: 'rgba(163,230,53,0.12)',  rank: 9 },
  // The synthetic tree root. Deliberately white so it reads as the origin
  // rather than as one more category.
  root:       { label: 'Platform',   color: '#F8FAFC', bg: 'rgba(248,250,252,0.10)', rank: -1 },
};

export const FALLBACK_STYLE: KindStyle = {
  label: 'Other', color: '#64748B', bg: 'rgba(100,116,139,0.12)', rank: 99,
};

export function kindStyle(kind: string): KindStyle {
  return KIND_STYLES[kind] ?? FALLBACK_STYLE;
}

/** Edge colours by predicate, so a relation type is readable without hovering. */
export const EDGE_COLORS: Record<string, string> = {
  hierarchy: '#334155',
  serves_domain: '#6366F1',
  has_tier: '#64748B',
  requires_capability: '#F59E0B',
  provides_capability: '#06B6D4',
  handles_data_class: '#EC4899',
  egresses_to: '#EF4444',
  // Composition. Brighter and solid (see below) — "this workflow calls that
  // agent" is a fact about the system, where an annotation is a claim about it.
  uses_agent: '#10B981',
  uses_tool: '#FB923C',
  uses_connector: '#A3E635',
};

/** Structural edges: what a thing is built from, not what it is about. */
export const COMPOSITION_KINDS = new Set(['uses_agent', 'uses_tool', 'uses_connector']);

export const isComposition = (kind: string) => COMPOSITION_KINDS.has(kind);

export function edgeColor(kind: string): string {
  return EDGE_COLORS[kind] ?? '#475569';
}

/**
 * Circular nodes, laid out top-to-bottom.
 *
 * A circle carries no implied direction, which suits a node that can sit at
 * either end of a relation. Size then becomes the only visual variable it
 * spends, so degree can use it: hubs read as hubs without any extra chrome.
 *
 * The label sits *below* the circle rather than inside it. Concept labels run
 * to three words and would either overflow a circle or force it large enough
 * to wreck the layout — so the circle stays a consistent glyph and the text
 * gets its own band.
 */
const MIN_DIAMETER = 40;
const MAX_DIAMETER = 78;

/** Width reserved per node for its label. Also the effective column width. */
const LABEL_WIDTH = 104;
/** Two lines of label plus the gap under the circle. */
const LABEL_BAND = 30;
/** Horizontal gap between neighbours in a row. */
const NODE_GAP = 22;
/** Vertical gap between one rank and the next. */
const RANK_GAP = 92;

export function diameterFor(node: GraphNode): number {
  // sqrt, not linear: a 36-edge capability drawn proportionally against a
  // 1-edge leaf would be 36x the area and dwarf everything around it.
  const bump = Math.round(Math.sqrt(node.degree || 0) * 9);
  return Math.min(MAX_DIAMETER, MIN_DIAMETER + bump);
}

/** The box dagre reserves — wide enough for the label, tall enough for both. */
export function boxFor(node: GraphNode): { width: number; height: number } {
  const diameter = diameterFor(node);
  return {
    width: Math.max(LABEL_WIDTH, diameter),
    height: diameter + LABEL_BAND,
  };
}

export interface LaidOutGraph {
  nodes: Node[];
  edges: Edge[];
}

/** Widest a single row may get before it is wrapped, in px. */
const MAX_ROW_WIDTH = 1900;
/** Vertical gap between wrapped sub-rows inside one rank. */
const SUBROW_GAP = 24;

interface Placed {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  /**
   * dagre's rank centre.
   *
   * Ranks have to be grouped on this, not on ``y``. dagre centres each node
   * within its rank, so a 70px node and a 108px node on the same rank have
   * different *tops* — grouping by top split one rank into several and stacked
   * the whole graph into a column.
   */
  rankY: number;
}

/**
 * Wrap ranks that came out too wide, keeping the top-to-bottom hierarchy.
 *
 * A layered layout puts every node of a rank on one line. That is fine for a
 * tree and hopeless here: ~180 resources share a handful of ranks, so the
 * graph came out 22,000px wide and 400 tall. Fitting that to a viewport zooms
 * to 0.06 — every node a dot, nothing readable.
 *
 * So each over-wide rank is folded into several sub-rows. The rank order is
 * preserved (parents stay above children) and dagre's within-rank ordering is
 * preserved too — that ordering is the crossing-minimisation work, and
 * re-sorting would throw it away. Only the wrapping is ours.
 */
function wrapWideRanks(placed: Placed[]): Placed[] {
  if (!placed.length) return placed;

  // Bucket on the rank centre, tolerant of dagre's sub-pixel jitter.
  const ranks = new Map<number, Placed[]>();
  for (const node of placed) {
    const key = Math.round(node.rankY / 4) * 4;
    ranks.set(key, [...(ranks.get(key) ?? []), node]);
  }

  const orderedRanks = [...ranks.entries()].sort((a, b) => a[0] - b[0]);
  const out: Placed[] = [];
  let cursorY = 0;

  for (const [, members] of orderedRanks) {
    // Left-to-right as dagre ordered them.
    const row = [...members].sort((a, b) => a.x - b.x);

    const chunks: Placed[][] = [];
    let current: Placed[] = [];
    let width = 0;
    for (const node of row) {
      const next = width + node.width + (current.length ? NODE_GAP : 0);
      if (current.length && next > MAX_ROW_WIDTH) {
        chunks.push(current);
        current = [node];
        width = node.width;
      } else {
        current.push(node);
        width = next;
      }
    }
    if (current.length) chunks.push(current);

    for (const chunk of chunks) {
      const chunkWidth =
        chunk.reduce((sum, n) => sum + n.width, 0) + NODE_GAP * (chunk.length - 1);
      const tallest = Math.max(...chunk.map((n) => n.height));
      let x = -chunkWidth / 2;
      for (const node of chunk) {
        // Bottom-align within the sub-row so labels line up on one baseline
        // even when circles differ in size.
        out.push({ ...node, x, y: cursorY + (tallest - node.height) });
        x += node.width + NODE_GAP;
      }
      cursorY += tallest + SUBROW_GAP;
    }

    cursorY += RANK_GAP - SUBROW_GAP;
  }

  return out;
}

/** The synthetic root's node id. Not a real concept — never sent to the API. */
export const ROOT_ID = '__root__';

/**
 * Give the graph a single root.
 *
 * Without one the top rank is a row of disconnected circles — thirteen
 * industries floating side by side with nothing joining them, which reads as a
 * list rather than a structure. Anything with no incoming edge is attached to
 * one synthetic root, so the whole thing becomes a proper tree: one origin,
 * every node reachable from it.
 *
 * Purely presentational. It is added here rather than server-side so it cannot
 * leak into counts, filters or the annotation store.
 */
function withSyntheticRoot(
  graph: OntologyGraph,
  rootLabel: string,
): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const hasIncoming = new Set(graph.edges.map((e) => e.target));
  const orphans = graph.nodes.filter((n) => !hasIncoming.has(n.id));

  // A single node needs no root above it, and neither does an empty graph.
  if (graph.nodes.length < 2) return { nodes: graph.nodes, edges: graph.edges };

  const root: GraphNode = {
    id: ROOT_ID,
    kind: 'root',
    label: rootLabel,
    degree: orphans.length,
  };

  const rootEdges: GraphEdge[] = orphans.map((node) => ({
    id: `r:${node.id}`,
    source: ROOT_ID,
    target: node.id,
    kind: 'hierarchy',
    label: '',
    reveal: 'forward',
  }));

  return { nodes: [root, ...graph.nodes], edges: [...rootEdges, ...graph.edges] };
}

/** How the graph is arranged. Each answers a different question. */
export type LayoutKind = 'tree' | 'radial' | 'cluster';

export const LAYOUTS: { key: LayoutKind; label: string; hint: string }[] = [
  { key: 'tree', label: 'Tree', hint: 'Layered top-to-bottom. Best for reading depth and lineage.' },
  { key: 'radial', label: 'Radial', hint: 'Rings out from the root. Each branch becomes its own wedge.' },
  { key: 'cluster', label: 'Clusters', hint: 'One island per industry. Best for comparing coverage.' },
];

/** Children of each node, following only the containment direction. */
function childMap(nodes: GraphNode[], edges: GraphEdge[]): Map<string, string[]> {
  const present = new Set(nodes.map((n) => n.id));
  const children = new Map<string, string[]>();
  const claimed = new Set<string>();

  for (const edge of edges) {
    const direction = edge.reveal ?? (edge.kind === 'hierarchy' ? 'forward' : 'reverse');
    const [parent, child] =
      direction === 'forward' ? [edge.source, edge.target] : [edge.target, edge.source];
    if (!present.has(parent) || !present.has(child) || parent === child) continue;
    // One parent per node: a resource can be annotated against several
    // concepts, and letting it belong to all of them would put it in several
    // wedges at once. First claim wins, which is stable because edge order is.
    if (claimed.has(child)) continue;
    claimed.add(child);
    children.set(parent, [...(children.get(parent) ?? []), child]);
  }
  return children;
}

/** Leaves beneath each node — the weight a radial slice is shared out by. */
function leafWeights(roots: string[], children: Map<string, string[]>): Map<string, number> {
  const weights = new Map<string, number>();
  const visit = (id: string, seen: Set<string>): number => {
    if (weights.has(id)) return weights.get(id)!;
    if (seen.has(id)) return 1;
    const kids = children.get(id) ?? [];
    const weight = kids.length
      ? kids.reduce((sum, kid) => sum + visit(kid, new Set([...seen, id])), 0)
      : 1;
    weights.set(id, weight);
    return weight;
  };
  roots.forEach((root) => visit(root, new Set()));
  return weights;
}

/**
 * Concentric rings out from the root.
 *
 * Each subtree owns an angular wedge sized by how many leaves it has, so a
 * dense branch gets the room it needs and a sparse one does not waste any.
 * Depth becomes distance from the centre, which makes level legible at a glance
 * without reading a single label — the thing a flat force layout can never do.
 */
function radialPositions(
  nodes: GraphNode[],
  edges: GraphEdge[],
  boxes: Map<string, { width: number; height: number }>,
): Map<string, { x: number; y: number }> {
  const children = childMap(nodes, edges);
  const hasParent = new Set([...children.values()].flat());
  const roots = nodes.filter((n) => !hasParent.has(n.id)).map((n) => n.id);
  const weights = leafWeights(roots, children);

  const widthOf = (id: string) => (boxes.get(id)?.width ?? LABEL_WIDTH) + NODE_GAP;
  const tallest = Math.max(...nodes.map((n) => boxes.get(n.id)?.height ?? 0)) + NODE_GAP;

  // ── Pass 1: every node's depth and angular slice ─────────────────────
  const slices = new Map<string, { depth: number; start: number; sweep: number }>();

  const measure = (id: string, depth: number, start: number, sweep: number, seen: Set<string>) => {
    if (seen.has(id)) return;
    slices.set(id, { depth, start, sweep });
    const kids = children.get(id) ?? [];
    if (!kids.length) return;
    const total = kids.reduce((sum, kid) => sum + (weights.get(kid) ?? 1), 0) || 1;
    let cursor = start;
    for (const kid of kids) {
      const share = ((weights.get(kid) ?? 1) / total) * sweep;
      measure(kid, depth + 1, cursor, share, new Set([...seen, id]));
      cursor += share;
    }
  };

  if (roots.length === 1) {
    measure(roots[0], 0, 0, Math.PI * 2, new Set());
  } else {
    const total = roots.reduce((sum, r) => sum + (weights.get(r) ?? 1), 0) || 1;
    let cursor = 0;
    for (const root of roots) {
      const share = ((weights.get(root) ?? 1) / total) * Math.PI * 2;
      measure(root, 1, cursor, share, new Set());
      cursor += share;
    }
  }

  // ── Pass 2: ring radii derived from the slices ───────────────────────
  //
  // A fixed ring spacing was the bug: 48 domains sharing a ring of 300px have
  // 1,880px of circumference to fit 5,000px of node into. Each ring is instead
  // pushed out until the narrowest slice on it is wide enough for its node —
  // arc length (radius x angle) must clear the node's width.
  const byDepth = new Map<number, string[]>();
  for (const [id, slice] of slices) {
    byDepth.set(slice.depth, [...(byDepth.get(slice.depth) ?? []), id]);
  }

  const radii = new Map<number, number>();
  let previous = 0;
  for (const depth of [...byDepth.keys()].sort((a, b) => a - b)) {
    if (depth === 0) {
      radii.set(0, 0);
      previous = 0;
      continue;
    }
    let needed = previous + tallest;

    // Constrain on *adjacent pairs*, not on each node against its own slice.
    // Two neighbours are separated by the chord between their slice centres,
    // and each needs half of its own width — checking them independently let
    // a narrow slice sit next to a wide one and still collide.
    const ring = byDepth
      .get(depth)!
      .map((id) => ({ id, angle: slices.get(id)!.start + slices.get(id)!.sweep / 2 }))
      .sort((a, b) => a.angle - b.angle);

    for (let i = 0; i < ring.length; i += 1) {
      const current = ring[i];
      // Wrap around: the last node on a ring neighbours the first.
      const next = ring[(i + 1) % ring.length];
      if (ring.length < 2) break;
      let delta = next.angle - current.angle;
      if (delta <= 0) delta += Math.PI * 2;
      const half = Math.min(Math.PI / 2, delta / 2);
      const span = (widthOf(current.id) + widthOf(next.id)) / 2;
      needed = Math.max(needed, span / (2 * Math.sin(half)));
    }
    radii.set(depth, needed);
    previous = needed;
  }

  const positions = new Map<string, { x: number; y: number }>();
  for (const [id, slice] of slices) {
    const angle = slice.start + slice.sweep / 2 - Math.PI / 2;
    const radius = radii.get(slice.depth) ?? 0;
    positions.set(id, { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius });
  }

  // Anything the containment walk never reached (cross-linked only) goes on a
  // ring outside everything else.
  const outer = (Math.max(0, ...radii.values()) || tallest) + tallest * 1.5;
  const strays = nodes.filter((n) => !positions.has(n.id));
  strays.forEach((node, index) => {
    const angle = (index / Math.max(1, strays.length)) * Math.PI * 2;
    positions.set(node.id, { x: Math.cos(angle) * outer, y: Math.sin(angle) * outer });
  });

  return positions;
}

/**
 * One island per top-level branch.
 *
 * Industries become separate clusters laid out on a ring, each packed into its
 * own spiral. Reading across islands is the point: an industry with three
 * agents and one with twenty-three are immediately comparable by area, which a
 * single connected tree makes surprisingly hard.
 */
function clusterPositions(
  nodes: GraphNode[],
  edges: GraphEdge[],
  boxes: Map<string, { width: number; height: number }>,
): Map<string, { x: number; y: number }> {
  const children = childMap(nodes, edges);
  const hasParent = new Set([...children.values()].flat());

  // Cluster key = the top-level ancestor, skipping the synthetic root so the
  // industries themselves become the islands rather than one giant blob.
  const ownerOf = new Map<string, string>();
  const assign = (id: string, owner: string, seen: Set<string>) => {
    if (seen.has(id)) return;
    ownerOf.set(id, owner);
    for (const kid of children.get(id) ?? []) {
      assign(kid, owner, new Set([...seen, id]));
    }
  };

  const topLevel = nodes
    .filter((n) => !hasParent.has(n.id))
    .flatMap((n) => (n.id === ROOT_ID ? (children.get(ROOT_ID) ?? []) : [n.id]));
  topLevel.forEach((id) => assign(id, id, new Set()));

  const groups = new Map<string, string[]>();
  for (const node of nodes) {
    if (node.id === ROOT_ID) continue;
    const owner = ownerOf.get(node.id) ?? '__loose__';
    groups.set(owner, [...(groups.get(owner) ?? []), node.id]);
  }

  const cellW = Math.max(...nodes.map((n) => boxes.get(n.id)?.width ?? LABEL_WIDTH)) + NODE_GAP;
  const cellH = Math.max(...nodes.map((n) => boxes.get(n.id)?.height ?? 0)) + NODE_GAP;
  // Governing dimension for a spiral is the box's diagonal — two boxes at an
  // arbitrary relative angle can touch corner to corner.
  const cell = Math.hypot(cellW, cellH);

  const ordered = [...groups.entries()].sort((a, b) => b[1].length - a[1].length);
  const positions = new Map<string, { x: number; y: number }>();

  // Phyllotaxis spacing. The theoretical packing bound suggested ~0.62 of a
  // cell, but measuring the real graph showed 17 within-cluster collisions
  // there and none at 0.85 — the bound assumes points, and these are boxes
  // meeting at arbitrary angles. Measured, not derived.
  const SPIRAL_C = cell * 0.85;
  const radiusOf = (count: number) => SPIRAL_C * Math.sqrt(Math.max(1, count)) + cell * 0.5;

  // Ring circumference has to fit every cluster's diameter, or islands collide.
  const diameters = ordered.map(([, ids]) => radiusOf(ids.length) * 2 + cell * 0.5);
  const totalSpan = diameters.reduce((sum, d) => sum + d, 0) || 1;

  // Same chord correction as the radial rings: two clusters sitting `step`
  // apart are separated by 2*R*sin(step/2), which is shorter than the arc the
  // step was budgeted from.
  let ringRadius = 0;
  if (ordered.length > 1) {
    diameters.forEach((diameter) => {
      const step = (diameter / totalSpan) * Math.PI * 2;
      const half = Math.min(Math.PI / 2, step / 2);
      ringRadius = Math.max(ringRadius, diameter / (2 * Math.sin(half)));
    });
  }

  let angle = 0;
  ordered.forEach(([, ids], groupIndex) => {
    const step = (diameters[groupIndex] / totalSpan) * Math.PI * 2;
    const cx = Math.cos(angle + step / 2) * ringRadius;
    const cy = Math.sin(angle + step / 2) * ringRadius;
    angle += step;

    // The first member lands dead centre — which is the industry itself.
    ids.forEach((id, index) => {
      const r = index === 0 ? 0 : SPIRAL_C * Math.sqrt(index);
      const theta = index * 2.399963; // golden angle
      positions.set(id, { x: cx + Math.cos(theta) * r, y: cy + Math.sin(theta) * r });
    });
  });

  const root = nodes.find((n) => n.id === ROOT_ID);
  if (root) positions.set(ROOT_ID, { x: 0, y: 0 });

  return positions;
}

/**
 * Nudge apart any pair the geometric layouts left touching.
 *
 * Both radial and cluster size their spacing analytically, which handles the
 * general case but not the degenerate ones — chiefly two nodes landing on the
 * same angle, where no increase in radius separates them. Rather than special
 * casing each, a few relaxation passes push overlapping pairs apart along the
 * line between them. Cheap (only runs on real overlaps) and it makes the
 * "no collisions" property hold by construction rather than by argument.
 */
function relaxOverlaps(
  positions: Map<string, { x: number; y: number }>,
  boxes: Map<string, { width: number; height: number }>,
  passes = 12,
): Map<string, { x: number; y: number }> {
  const ids = [...positions.keys()];

  for (let pass = 0; pass < passes; pass += 1) {
    let moved = false;

    for (let i = 0; i < ids.length; i += 1) {
      for (let j = i + 1; j < ids.length; j += 1) {
        const a = positions.get(ids[i])!;
        const b = positions.get(ids[j])!;
        const boxA = boxes.get(ids[i]) ?? { width: LABEL_WIDTH, height: LABEL_WIDTH };
        const boxB = boxes.get(ids[j]) ?? { width: LABEL_WIDTH, height: LABEL_WIDTH };

        const minX = (boxA.width + boxB.width) / 2;
        const minY = (boxA.height + boxB.height) / 2;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const overlapX = minX - Math.abs(dx);
        const overlapY = minY - Math.abs(dy);
        if (overlapX <= 0 || overlapY <= 0) continue;

        moved = true;
        // Separate along the cheaper axis — it keeps the arrangement's shape,
        // where pushing along the diagonal would visibly distort a ring.
        if (overlapX < overlapY) {
          const shift = (overlapX / 2 + 1) * (dx < 0 ? -1 : 1);
          a.x -= shift;
          b.x += shift;
        } else {
          const shift = (overlapY / 2 + 1) * (dy < 0 ? -1 : 1);
          a.y -= shift;
          b.y += shift;
        }
      }
    }

    if (!moved) break;
  }

  return positions;
}

export function layoutGraph(
  graph: OntologyGraph,
  options: {
    selectedId?: string | null;
    dimUnrelated?: boolean;
    expandable?: Set<string>;
    expandedIds?: Set<string>;
    /** Label for the synthetic root. Omit to leave the graph as a forest. */
    rootLabel?: string;
    layout?: LayoutKind;
  } = {},
): LaidOutGraph {
  const { selectedId, dimUnrelated, expandable, expandedIds, rootLabel } = options;
  const layout = options.layout ?? 'tree';

  const source = rootLabel ? withSyntheticRoot(graph, rootLabel) : graph;
  graph = { ...graph, nodes: source.nodes, edges: source.edges };

  const dag = new dagre.graphlib.Graph();
  dag.setDefaultEdgeLabel(() => ({}));
  dag.setGraph({
    // Top to bottom: the graph is a hierarchy — industries above domains above
    // subdomains — and reading a tree downward is the convention everywhere
    // else this shape appears (org charts, file trees, taxonomies).
    rankdir: 'TB',
    // Separation is what keeps this from becoming a hairball. `nodesep` has to
    // clear the label band, not just the circle, or sibling labels collide.
    nodesep: NODE_GAP,
    ranksep: RANK_GAP,
    marginx: 48,
    marginy: 48,
  });

  for (const node of graph.nodes) {
    dag.setNode(node.id, boxFor(node));
  }
  for (const edge of graph.edges) {
    // dagre throws on an edge whose endpoints it has not seen.
    if (dag.hasNode(edge.source) && dag.hasNode(edge.target)) {
      dag.setEdge(edge.source, edge.target);
    }
  }

  dagre.layout(dag);

  // Which nodes touch the selection — used to fade everything else.
  const related = new Set<string>();
  if (selectedId) {
    related.add(selectedId);
    for (const edge of graph.edges) {
      if (edge.source === selectedId) related.add(edge.target);
      if (edge.target === selectedId) related.add(edge.source);
    }
  }

  // dagre reports centres; ReactFlow positions by top-left corner.
  const placed: Placed[] = graph.nodes.map((node) => {
    const positioned = dag.node(node.id);
    const box = boxFor(node);
    return {
      id: node.id,
      x: positioned ? positioned.x - box.width / 2 : 0,
      y: positioned ? positioned.y - box.height / 2 : 0,
      rankY: positioned ? positioned.y : 0,
      width: box.width,
      height: box.height,
    };
  });

  const boxes = new Map(graph.nodes.map((n) => [n.id, boxFor(n)]));

  // dagre is the layered engine. The other two are geometric and do not need
  // it — but it still runs, because `placed` is also what the tree layout uses
  // and branching before it would duplicate the whole node-mapping block.
  let positions: Map<string, { x: number; y: number }>;
  if (layout === 'radial') {
    positions = relaxOverlaps(radialPositions(graph.nodes, graph.edges, boxes), boxes);
  } else if (layout === 'cluster') {
    positions = relaxOverlaps(clusterPositions(graph.nodes, graph.edges, boxes), boxes);
  } else {
    positions = new Map(wrapWideRanks(placed).map((p) => [p.id, { x: p.x, y: p.y }]));
  }

  const nodes: Node[] = graph.nodes.map((node) => {
    const position = positions.get(node.id);
    const box = boxFor(node);
    const dimmed = !!selectedId && dimUnrelated && !related.has(node.id);
    const centred = layout !== 'tree';
    return {
      id: node.id,
      type: 'ontology',
      position: position
        ? centred
          ? { x: position.x - box.width / 2, y: position.y - box.height / 2 }
          : { x: position.x, y: position.y }
        : { x: 0, y: 0 },
      data: {
        node,
        dimmed,
        selected: node.id === selectedId,
        diameter: diameterFor(node),
        width: box.width,
        expandable: !!expandable?.has(node.id),
        isExpanded: !!expandedIds?.has(node.id),
      },
      draggable: true,
    } as Node;
  });

  const edges: Edge[] = graph.edges.map((edge: GraphEdge) => {
    const touchesSelection =
      !!selectedId && (edge.source === selectedId || edge.target === selectedId);
    const dimmed = !!selectedId && dimUnrelated && !touchesSelection;
    const color = edgeColor(edge.kind);

    // Labels only on the selection's own edges. Rendering all several hundred
    // at once produced a wall of text denser than the graph underneath it —
    // and the relation type is already carried by the edge colour.
    const showLabel = touchesSelection && edge.kind !== 'hierarchy';

    return {
      id: edge.id,
      source: edge.source,
      target: edge.target,
      type: layout === 'tree' ? 'smoothstep' : 'straight',
      // The flowing dash marks direction of use. Restricted to composition and
      // the selection: animating all 400 edges is a screensaver, not a signal.
      className: !dimmed && (touchesSelection || isComposition(edge.kind))
        ? 'ontology-flow'
        : undefined,
      label: showLabel ? edge.label : undefined,
      labelStyle: { fill: color, fontSize: 9, fontWeight: 700 },
      labelBgStyle: { fill: '#06090F', fillOpacity: 0.9 },
      labelBgPadding: [4, 2] as [number, number],
      labelBgBorderRadius: 3,
      style: {
        stroke: color,
        strokeWidth: touchesSelection ? 2.2 : isComposition(edge.kind) ? 1.6 : 1.2,
        opacity: dimmed
          ? 0.06
          : isComposition(edge.kind)
            ? 0.85
            : edge.kind === 'hierarchy'
              ? 0.45
              : 0.55,
        // Solid means "is made of" — hierarchy and composition. Dashed means
        // "is described as" — the annotations. One glance separates the wiring
        // from the labelling.
        strokeDasharray:
          edge.kind === 'hierarchy' || isComposition(edge.kind) ? undefined : '4 3',
      },
    } as Edge;
  });

  return { nodes, edges };
}
