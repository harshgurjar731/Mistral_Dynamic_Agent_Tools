import type { GraphEdge, GraphNode, OntologyGraph } from '../../../api/ontology';
import type { UnifiedEdge, UnifiedGraph, UnifiedNode } from '../../../api/rag';

/**
 * Adapt the SQLite-backed ontology graph (taxonomy/resources/everything) into
 * the shape `Neo4jGraphCanvas` and the content graph both already speak.
 *
 * `Neo4jGraphCanvas` colours and captions nodes off `type`/`label`/`degree`
 * alone — it never reads `kind` — so the one thing this has to get right is
 * *what plays the role of a Neo4j label*. For the content graph that's a real
 * entity type; here it's the ontology node's own `kind` (industry, domain,
 * agent, workflow, tool, …), which is exactly the dimension a viewer wants
 * colour-coded when comparing an ad hoc slice of the platform to a Neo4j
 * Browser view of it. `kind` on `UnifiedNode` is fixed to `'entity'` because
 * nothing downstream reads it — it exists only to satisfy the shared type.
 */
export function toUnifiedGraph(graph: OntologyGraph): UnifiedGraph {
  const nodes: UnifiedNode[] = graph.nodes.map((n: GraphNode) => ({
    ...n,
    id: n.id,
    kind: 'entity',
    type: n.kind,
    label: n.label,
    degree: n.degree,
  }));

  const edges: UnifiedEdge[] = graph.edges.map((e: GraphEdge) => ({
    ...e,
    source: e.source,
    target: e.target,
    predicate: e.label || e.kind,
  }));

  return {
    available: true,
    nodes,
    edges,
    truncated: false,
    counts: graph.counts,
  };
}
