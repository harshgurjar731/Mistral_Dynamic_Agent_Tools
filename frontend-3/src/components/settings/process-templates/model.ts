/**
 * The template map: the classification as one tree, each node carrying the
 * template that applies to it and where that template is set.
 *
 * Computed here from two cheap reads (the process tree and the scopes that set
 * a template of their own) so the whole map — every node, inherited or not — is
 * drawn without a request per node.
 */
import type { ProcessTree, TemplateScope } from "@/api/processes";
import { indexTree } from "@/components/processes/ProcessCascadePicker";

export type MapLevel = "global" | "industry" | "domain" | "subdomain" | "process" | "subprocess";

export interface MapNode {
  /** null: the global scope ("All industries"). */
  id: string | null;
  label: string;
  level: MapLevel;
  depth: number;
  children: MapNode[];
  /** Set when this node has a template of its own. */
  own: TemplateScope | null;
  /** The template in effect here, and the node that set it. */
  effective: { name: string; version: number; fromId: string | null; fromLabel: string } | null;
  /** Ancestors, root first — for breadcrumbs and search context. */
  path: string[];
}

export const GLOBAL_KEY = "__global__";
export const keyOf = (id: string | null) => id ?? GLOBAL_KEY;

export function buildMap(
  tree: ProcessTree | undefined,
  scopes: TemplateScope[] | undefined,
): MapNode {
  const idx = indexTree(tree);
  const ownBy = new Map((scopes ?? []).map((s) => [keyOf(s.concept_id), s]));

  const make = (
    id: string | null,
    label: string,
    level: MapLevel,
    depth: number,
    parent: MapNode | null,
  ): MapNode => {
    const own = ownBy.get(keyOf(id)) ?? null;
    const effective = own
      ? { name: own.template.name, version: own.template.version, fromId: id, fromLabel: label }
      : (parent?.effective ?? null);
    const node: MapNode = {
      id,
      label,
      level,
      depth,
      children: [],
      own,
      effective,
      path: parent ? [...parent.path, parent.label] : [],
    };
    return node;
  };

  const root = make(null, "All industries", "global", 0, null);

  const addProcesses = (parent: MapNode, ids: { id: string; label: string }[], level: MapLevel) => {
    for (const p of ids) {
      const node = make(p.id, p.label, level, parent.depth + 1, parent);
      parent.children.push(node);
      addProcesses(node, idx.subsByParent.get(p.id) ?? [], "subprocess");
    }
  };

  const addDomains = (parent: MapNode, parentId: string) => {
    for (const d of idx.domainsByParent.get(parentId) ?? []) {
      const level = (d.level_name as MapLevel) ?? "domain";
      const node = make(d.id, d.label, level, parent.depth + 1, parent);
      parent.children.push(node);
      addDomains(node, d.id);
      addProcesses(node, idx.rootsByDomain.get(d.id) ?? [], "process");
    }
  };

  addDomains(root, "");
  return root;
}

export function flatten(node: MapNode): MapNode[] {
  return [node, ...node.children.flatMap(flatten)];
}

export function find(root: MapNode, id: string | null): MapNode | null {
  return flatten(root).find((n) => n.id === id) ?? null;
}

/** Nodes below ``node`` that take their template from it. */
export function inheritors(node: MapNode): MapNode[] {
  return flatten(node)
    .slice(1)
    .filter((n) => !n.own && n.effective?.fromId === node.id);
}

export const LEVEL_LABEL: Record<MapLevel, string> = {
  global: "Global",
  industry: "Industry",
  domain: "Domain",
  subdomain: "Subdomain",
  process: "Process",
  subprocess: "Subprocess",
};
