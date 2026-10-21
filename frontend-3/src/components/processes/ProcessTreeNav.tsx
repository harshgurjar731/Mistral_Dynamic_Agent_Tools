/**
 * The tree of one industry: Domain › Subdomain › Process › Subprocess, with a
 * document status dot on every process and an add button at every level.
 */
import { useMemo, useState } from "react";
import {
  Building2,
  ChevronRight,
  FolderTree,
  GitBranch,
  Plus,
  Workflow,
  Waypoints,
} from "lucide-react";
import type { ProcessLevel, ProcessTree, TreeConcept, TreeProcess } from "@/api/processes";
import { cn } from "@/lib/utils";
import { indexTree } from "./ProcessCascadePicker";

export type AddRequest = { level: ProcessLevel; parent: TreeConcept };

const ICON = {
  industry: Building2,
  domain: GitBranch,
  subdomain: FolderTree,
  process: Workflow,
  subprocess: Waypoints,
} as const;

function levelOf(node: TreeConcept): ProcessLevel {
  return (node.level_name as ProcessLevel) ?? "domain";
}

function docDot(p: TreeProcess) {
  if (p.documents.active_id) return "bg-emerald";
  if (p.documents.invalid || p.documents.stale) return "bg-amber";
  return "bg-border";
}

export function ProcessTreeNav({
  tree,
  industryId,
  selected,
  onSelect,
  onAdd,
}: {
  tree: ProcessTree | undefined;
  industryId: string;
  selected: string;
  onSelect: (id: string) => void;
  onAdd: (req: AddRequest) => void;
}) {
  const idx = useMemo(() => indexTree(tree), [tree]);
  const root = idx.byId.get(industryId);
  const [closed, setClosed] = useState<Record<string, boolean>>({});

  if (!root) return null;

  const row = (
    node: TreeConcept,
    depth: number,
    children: React.ReactNode,
    addLevel?: ProcessLevel,
  ) => {
    const level = levelOf(node);
    const Icon = ICON[level] ?? GitBranch;
    const hasKids = Boolean(children);
    const isClosed = closed[node.id];
    const proc = (node as TreeProcess).documents ? (node as TreeProcess) : null;
    return (
      <li key={node.id}>
        <div
          className={cn(
            "group flex items-center gap-1 rounded-md py-1 pr-1 text-xs transition",
            selected === node.id
              ? "bg-primary/10 text-foreground"
              : "text-muted-foreground hover:bg-surface-hover hover:text-foreground",
          )}
          style={{ paddingLeft: `${depth * 14 + 4}px` }}
        >
          <button
            type="button"
            aria-label={isClosed ? "Expand" : "Collapse"}
            onClick={() => setClosed((c) => ({ ...c, [node.id]: !c[node.id] }))}
            className={cn("grid size-4 place-items-center", !hasKids && "invisible")}
          >
            <ChevronRight className={cn("size-3 transition-transform", !isClosed && "rotate-90")} />
          </button>
          <button
            type="button"
            onClick={() => onSelect(node.id)}
            className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
          >
            <Icon
              className={cn(
                "size-3.5 shrink-0",
                level === "process" || level === "subprocess" ? "text-indigo" : "text-pink",
              )}
            />
            <span className={cn("truncate", selected === node.id && "font-medium")}>
              {node.label}
            </span>
            {proc ? (
              <span
                className={cn("ml-auto size-1.5 shrink-0 rounded-full", docDot(proc))}
                title={
                  proc.documents.active_id
                    ? `v${proc.documents.active_version} active`
                    : proc.documents.total
                      ? "No valid document"
                      : "No document"
                }
              />
            ) : null}
          </button>
          {addLevel ? (
            <button
              type="button"
              title={`Add a ${addLevel}`}
              onClick={() => onAdd({ level: addLevel, parent: node })}
              className="grid size-5 shrink-0 place-items-center rounded opacity-0 transition group-hover:opacity-100 hover:bg-primary/15 hover:text-primary"
            >
              <Plus className="size-3" />
            </button>
          ) : null}
        </div>
        {hasKids && !isClosed ? <ul>{children}</ul> : null}
      </li>
    );
  };

  const subs = (p: TreeProcess, depth: number): React.ReactNode => {
    const kids = idx.subsByParent.get(p.id) ?? [];
    return kids.length ? kids.map((k) => row(k, depth, subs(k, depth + 1), "subprocess")) : null;
  };

  const processesOf = (domainId: string, depth: number): React.ReactNode[] =>
    (idx.rootsByDomain.get(domainId) ?? []).map((p) =>
      row(p, depth, subs(p, depth + 1), "subprocess"),
    );

  const domainBranch = (d: TreeConcept, depth: number): React.ReactNode => {
    const level = levelOf(d);
    const kids = idx.domainsByParent.get(d.id) ?? [];
    const children = [
      ...kids.map((k) => domainBranch(k, depth + 1)),
      ...processesOf(d.id, depth + 1),
    ];
    // A domain adds subdomains; a subdomain adds processes. A domain's own
    // processes are added from its panel.
    return row(
      d,
      depth,
      children.length ? children : null,
      level === "domain" ? "subdomain" : "process",
    );
  };

  const top = idx.domainsByParent.get(industryId) ?? [];
  return (
    <ul className="space-y-0.5">
      {row(root, 0, top.length ? top.map((d) => domainBranch(d, 1)) : null, "domain")}
    </ul>
  );
}
