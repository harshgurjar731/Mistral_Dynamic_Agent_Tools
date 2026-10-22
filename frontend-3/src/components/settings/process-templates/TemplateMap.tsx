/**
 * The classification as a tree, showing at a glance which nodes set their own
 * template (a filled badge with its name) and which inherit one (a quiet
 * "inherits" note) — the inheritance chain is the thing to understand here, so
 * it is drawn rather than explained.
 */
import { useEffect, useMemo, useState } from "react";
import {
  Building2,
  ChevronRight,
  FolderTree,
  GitBranch,
  Globe,
  Search,
  Waypoints,
  Workflow,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { flatten, keyOf, type MapLevel, type MapNode } from "./model";

const ICON: Record<MapLevel, typeof Globe> = {
  global: Globe,
  industry: Building2,
  domain: GitBranch,
  subdomain: FolderTree,
  process: Workflow,
  subprocess: Waypoints,
};

/** Open by default: the global row, and the way to the selection and to every
 * node with its own template — so the interesting rows show without hunting. */
function defaultOpen(root: MapNode, selected: string | null): Set<string> {
  const open = new Set<string>([keyOf(null)]);
  const all = flatten(root);
  const parent = new Map<string, MapNode>();
  for (const n of all) for (const c of n.children) parent.set(keyOf(c.id), n);
  for (const n of all) {
    if (!n.own && n.id !== selected) continue;
    let up = parent.get(keyOf(n.id));
    while (up) {
      open.add(keyOf(up.id));
      up = parent.get(keyOf(up.id));
    }
  }
  return open;
}

export function TemplateMap({
  root,
  selected,
  onSelect,
}: {
  root: MapNode;
  selected: string | null;
  onSelect: (id: string | null) => void;
}) {
  const [query, setQuery] = useState("");
  const [onlyOwn, setOnlyOwn] = useState(false);
  const [open, setOpen] = useState<Set<string>>(() => defaultOpen(root, selected));

  // Jumping to a node from the detail panel ("Set on BFSI") reveals its row.
  useEffect(() => {
    const parent = new Map<string, MapNode>();
    for (const n of flatten(root)) for (const c of n.children) parent.set(keyOf(c.id), n);
    setOpen((prev) => {
      const next = new Set(prev);
      let up = parent.get(keyOf(selected));
      while (up) {
        next.add(keyOf(up.id));
        up = parent.get(keyOf(up.id));
      }
      return next.size === prev.size ? prev : next;
    });
  }, [root, selected]);

  const q = query.trim().toLowerCase();
  /** Nodes to show when filtering: matches and every ancestor of a match. */
  const visible = useMemo(() => {
    if (!q && !onlyOwn) return null;
    const keep = new Set<string>();
    const walk = (n: MapNode, trail: MapNode[]): void => {
      const hit = (!q || n.label.toLowerCase().includes(q)) && (!onlyOwn || Boolean(n.own));
      if (hit) for (const x of [...trail, n]) keep.add(keyOf(x.id));
      n.children.forEach((c) => walk(c, [...trail, n]));
    };
    walk(root, []);
    return keep;
  }, [root, q, onlyOwn]);

  const toggle = (id: string | null) =>
    setOpen((prev) => {
      const next = new Set(prev);
      const k = keyOf(id);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });

  const row = (n: MapNode): React.ReactNode => {
    if (visible && !visible.has(keyOf(n.id))) return null;
    const Icon = ICON[n.level];
    const isOpen = visible ? true : open.has(keyOf(n.id));
    const isSel = n.id === selected;
    const kids = n.children.length > 0;
    return (
      <li key={keyOf(n.id)}>
        <div
          className={cn(
            "group flex items-center gap-1.5 rounded-lg py-1.5 pr-2 text-xs transition",
            isSel ? "bg-primary/10" : "hover:bg-surface-hover",
          )}
          style={{ paddingLeft: `${n.depth * 16 + 4}px` }}
        >
          <button
            type="button"
            aria-label={isOpen ? "Collapse" : "Expand"}
            onClick={() => toggle(n.id)}
            className={cn(
              "grid size-4 shrink-0 place-items-center text-muted-foreground",
              !kids && "invisible",
            )}
          >
            <ChevronRight className={cn("size-3 transition-transform", isOpen && "rotate-90")} />
          </button>
          <button
            type="button"
            onClick={() => onSelect(n.id)}
            className="flex min-w-0 flex-1 items-center gap-2 text-left"
          >
            <Icon
              className={cn(
                "size-3.5 shrink-0",
                n.level === "process" || n.level === "subprocess"
                  ? "text-indigo"
                  : n.level === "global"
                    ? "text-primary"
                    : "text-pink",
              )}
            />
            <span
              className={cn(
                "truncate",
                isSel ? "font-medium text-foreground" : "text-foreground/90",
              )}
            >
              {n.label}
            </span>
            <span className="ml-auto flex shrink-0 items-center">
              {n.own ? (
                <span
                  className="max-w-[9rem] truncate rounded-full border border-primary/30 bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary"
                  title={`Own template: ${n.own.template.name} v${n.own.template.version}`}
                >
                  {n.own.template.name} v{n.own.template.version}
                </span>
              ) : (
                <span
                  className="text-[10px] text-muted-foreground/60 group-hover:text-muted-foreground"
                  title={
                    n.effective
                      ? `Inherits ${n.effective.name} v${n.effective.version} from ${n.effective.fromLabel}`
                      : undefined
                  }
                >
                  inherits
                </span>
              )}
            </span>
          </button>
        </div>
        {kids && isOpen ? <ul>{n.children.map(row)}</ul> : null}
      </li>
    );
  };

  const ownCount = useMemo(() => flatten(root).filter((n) => n.own).length, [root]);

  return (
    <div className="flex min-h-0 flex-col">
      <div className="space-y-2 border-b border-border/50 p-3">
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Find an industry, domain or process…"
            className="h-8 w-full rounded-lg border border-border/60 bg-background-elevated pr-7 pl-8 text-xs focus:ring-1 focus:ring-primary focus:outline-none"
          />
          {query ? (
            <button
              type="button"
              aria-label="Clear search"
              onClick={() => setQuery("")}
              className="absolute top-1/2 right-2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              <X className="size-3" />
            </button>
          ) : null}
        </div>
        <div className="flex items-center justify-between text-[11px]">
          <label className="flex cursor-pointer items-center gap-1.5 text-muted-foreground">
            <input
              type="checkbox"
              checked={onlyOwn}
              onChange={(e) => setOnlyOwn(e.target.checked)}
              className="accent-[var(--primary)]"
            />
            Only with their own template ({ownCount})
          </label>
        </div>
      </div>
      <ul className="custom-scrollbar min-h-0 flex-1 overflow-y-auto p-2">{row(root)}</ul>
      {visible && visible.size === 0 ? (
        <p className="px-4 pb-4 text-center text-xs text-muted-foreground">Nothing matches.</p>
      ) : null}
    </div>
  );
}
