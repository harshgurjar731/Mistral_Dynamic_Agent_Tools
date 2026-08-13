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

export function layoutGraph(
  graph: OntologyGraph,
  options: {
    selectedId?: string | null;
    dimUnrelated?: boolean;
    expandable?: Set<string>;
    expandedIds?: Set<string>;
  } = {},
): LaidOutGraph {
  const { selectedId, dimUnrelated, expandable, expandedIds } = options;

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

  const positions = new Map(wrapWideRanks(placed).map((p) => [p.id, p]));

  const nodes: Node[] = graph.nodes.map((node) => {
    const position = positions.get(node.id);
    const box = boxFor(node);
    const dimmed = !!selectedId && dimUnrelated && !related.has(node.id);
    return {
      id: node.id,
      type: 'ontology',
      position: position ? { x: position.x, y: position.y } : { x: 0, y: 0 },
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
      type: 'smoothstep',
      animated: touchesSelection && edge.kind !== 'hierarchy',
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
