import type { Concept } from '../../api/ontology';

/**
 * Tree helpers for the domain scheme (industry → domain → subdomain).
 *
 * Pure data, no React — `DomainCascadeSelect` renders from this, and the list
 * filters on `AgentStudio`/`WorkflowDashboard` reuse the same subtree
 * expansion so "filter by BFSI" also matches something tagged with the more
 * specific `domain.lending.mortgage`, without either place re-walking
 * `parent_id` on its own.
 */

export interface DomainTreeIndex {
  concepts: Concept[];
  byId: Map<string, Concept>;
  /** parent concept id → its direct children, in seed order. */
  childrenOf: Map<string, Concept[]>;
  /** Concepts with no parent within this set — the industries. */
  roots: Concept[];
}

export function buildDomainTree(concepts: Concept[]): DomainTreeIndex {
  const byId = new Map(concepts.map((c) => [c.id, c]));
  const childrenOf = new Map<string, Concept[]>();
  const roots: Concept[] = [];

  for (const concept of concepts) {
    if (concept.parent_id && byId.has(concept.parent_id)) {
      const list = childrenOf.get(concept.parent_id);
      if (list) list.push(concept);
      else childrenOf.set(concept.parent_id, [concept]);
    } else {
      roots.push(concept);
    }
  }

  return { concepts, byId, childrenOf, roots };
}

/** A concept plus everything beneath it — what "filter by this industry"
 *  should actually match, since a resource is usually tagged at a leaf. */
export function subtreeOf(tree: DomainTreeIndex, conceptId: string): Set<string> {
  const out = new Set<string>();
  const visit = (id: string) => {
    if (out.has(id)) return;
    out.add(id);
    for (const child of tree.childrenOf.get(id) ?? []) visit(child.id);
  };
  visit(conceptId);
  return out;
}

/** The union of every selected concept's subtree — the full match set for a
 *  multi-select domain filter. */
export function expandedMatchSet(tree: DomainTreeIndex, selected: Iterable<string>): Set<string> {
  const out = new Set<string>();
  for (const id of selected) for (const member of subtreeOf(tree, id)) out.add(member);
  return out;
}

/** True if any of `conceptIds` falls inside the (already expanded) match set. */
export function intersects(conceptIds: string[] | undefined, matchSet: Set<string>): boolean {
  if (!conceptIds?.length) return false;
  return conceptIds.some((id) => matchSet.has(id));
}

/** "Industry › Domain › Subdomain" — the ancestor chain's labels, so a
 *  selected chip still shows where in the hierarchy a pick sits without
 *  needing the tree open. */
export function breadcrumb(tree: DomainTreeIndex, conceptId: string): string {
  const chain: string[] = [];
  let cursor: string | null | undefined = conceptId;
  const seen = new Set<string>();
  while (cursor && !seen.has(cursor)) {
    seen.add(cursor);
    const concept = tree.byId.get(cursor);
    if (!concept) break;
    chain.unshift(concept.label);
    cursor = concept.parent_id;
  }
  return chain.length ? chain.join(' › ') : conceptId;
}
