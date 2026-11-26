/** The industry › domain › subdomain tree as an index — built once per load, read by every panel. */
import type { IndustryNode } from "@/api/industry";

export interface TreeIndex {
  byId: Map<string, IndustryNode>;
  children: Map<string | null, IndustryNode[]>;
  roots: IndustryNode[];
}

export function buildIndex(nodes: IndustryNode[]): TreeIndex {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const children = new Map<string | null, IndustryNode[]>();
  for (const n of nodes) {
    const parent = n.parent_id && byId.has(n.parent_id) ? n.parent_id : null;
    children.set(parent, [...(children.get(parent) ?? []), n]);
  }
  return { byId, children, roots: children.get(null) ?? [] };
}

/** Every node above ``id``. */
export function ancestorsOf(index: TreeIndex, id: string | null): Set<string> {
  const out = new Set<string>();
  let cursor = id ? (index.byId.get(id)?.parent_id ?? null) : null;
  while (cursor && !out.has(cursor)) {
    out.add(cursor);
    cursor = index.byId.get(cursor)?.parent_id ?? null;
  }
  return out;
}
