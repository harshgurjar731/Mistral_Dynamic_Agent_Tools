import type { Concept } from "@/types";

export interface DomainTreeIndex {
  concepts: Concept[];
  byId: Map<string, Concept>;
  childrenOf: Map<string, Concept[]>;
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

export function expandedMatchSet(tree: DomainTreeIndex, selected: Iterable<string>): Set<string> {
  const out = new Set<string>();
  for (const id of selected) for (const member of subtreeOf(tree, id)) out.add(member);
  return out;
}

export function intersects(conceptIds: string[] | undefined, matchSet: Set<string>): boolean {
  if (!conceptIds?.length) return false;
  return conceptIds.some((id) => matchSet.has(id));
}

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
  return chain.length ? chain.join(" › ") : conceptId;
}
