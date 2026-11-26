/**
 * The industry › domain › subdomain tree, with how much knowledge each node holds.
 * Choosing a node shows what plans scoped to it would read: its own items and
 * everything filed above it.
 */
import { useMemo, useState } from "react";
import { Building2, ChevronRight, Layers, Search } from "lucide-react";
import type { IndustryNode } from "@/api/industry";
import { cn } from "@/lib/utils";
import { SELECT_CLASS } from "./labels";
import { ancestorsOf, type TreeIndex } from "./tree";

export type { TreeIndex } from "./tree";

export function IndustryTree({
  index,
  selected,
  onSelect,
}: {
  index: TreeIndex;
  selected: string | null;
  onSelect: (id: string | null) => void;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState<Set<string>>(() => ancestorsOf(index, selected));
  const q = query.trim().toLowerCase();

  // With a search, show matches and the path to them.
  const visible = useMemo(() => {
    if (!q) return null;
    const keep = new Set<string>();
    for (const n of index.byId.values()) {
      if (n.label.toLowerCase().includes(q) || n.id.toLowerCase().includes(q)) {
        keep.add(n.id);
        for (const a of ancestorsOf(index, n.id)) keep.add(a);
      }
    }
    return keep;
  }, [index, q]);

  const toggle = (id: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const row = (node: IndustryNode, depth: number) => {
    if (visible && !visible.has(node.id)) return null;
    const kids = index.children.get(node.id) ?? [];
    const expanded = Boolean(visible) || open.has(node.id);
    const c = node.counts;
    return (
      <li key={node.id}>
        <div
          className={cn(
            "group flex items-center gap-1 rounded-lg pr-2 transition",
            selected === node.id ? "bg-primary/12 text-foreground" : "hover:bg-surface-hover",
          )}
          style={{ paddingLeft: 4 + depth * 14 }}
        >
          {kids.length ? (
            <button
              type="button"
              onClick={() => toggle(node.id)}
              aria-label={expanded ? `Collapse ${node.label}` : `Expand ${node.label}`}
              className="grid size-6 shrink-0 place-items-center rounded text-muted-foreground hover:text-foreground"
            >
              <ChevronRight className={cn("size-3.5 transition", expanded && "rotate-90")} />
            </button>
          ) : (
            <span className="size-6 shrink-0" />
          )}
          <button
            type="button"
            onClick={() => onSelect(node.id)}
            className="flex min-w-0 flex-1 items-center gap-2 py-1.5 text-left"
            title={node.definition || node.label}
          >
            {depth === 0 ? (
              <Building2 className="size-3.5 shrink-0 text-primary" />
            ) : (
              <Layers className="size-3 shrink-0 text-muted-foreground" />
            )}
            <span className={cn("truncate text-xs", depth === 0 ? "font-semibold" : "")}>
              {node.label}
            </span>
            <span className="ml-auto flex shrink-0 items-center gap-1">
              {c.proposed + c.conflicting ? (
                <span
                  className="rounded border border-amber/25 bg-amber/10 px-1 font-mono text-[9px] text-amber tabular-nums"
                  title={`${c.proposed + c.conflicting} waiting for review`}
                >
                  {c.proposed + c.conflicting}
                </span>
              ) : null}
              <span
                className={cn(
                  "rounded px-1 font-mono text-[9px] tabular-nums",
                  c.active ? "bg-emerald/10 text-emerald" : "text-muted-foreground/60",
                )}
                title={`${c.active} approved here · ${c.below} below`}
              >
                {c.active}
                {c.below ? <span className="text-muted-foreground/70">+{c.below}</span> : null}
              </span>
            </span>
          </button>
        </div>
        {kids.length && expanded ? <ul>{kids.map((k) => row(k, depth + 1))}</ul> : null}
      </li>
    );
  };

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="relative mb-2">
        <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Find an industry or domain…"
          className="w-full rounded-lg border border-border/60 bg-background-elevated py-1.5 pr-2 pl-8 text-xs text-foreground placeholder:text-muted-foreground focus:ring-1 focus:ring-primary focus:outline-none"
        />
      </div>
      <button
        type="button"
        onClick={() => onSelect(null)}
        className={cn(
          "mb-1 flex items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs transition",
          selected === null
            ? "bg-primary/12 font-medium text-foreground"
            : "text-muted-foreground hover:bg-surface-hover",
        )}
      >
        <Layers className="size-3.5" /> All industries
      </button>
      <ul className="custom-scrollbar min-h-0 flex-1 overflow-x-hidden overflow-y-auto pr-1">
        {index.roots.map((r) => row(r, 0))}
      </ul>
      <p className="mt-2 border-t border-border/40 pt-2 text-[10px] leading-relaxed text-muted-foreground">
        Green: approved items on the node (+ below it). Amber: waiting for review. A plan scoped to
        a node reads its items and everything above it.
      </p>
    </div>
  );
}

/** Industry → domain → subdomain, one value: the deepest one chosen. */
export function NodeSelect({
  index,
  value,
  onChange,
  disabled,
}: {
  index: TreeIndex;
  value: string;
  onChange: (id: string) => void;
  disabled?: boolean;
}) {
  const chain = useMemo(() => {
    const out: string[] = [];
    let cursor: string | null = value || null;
    while (cursor && index.byId.has(cursor)) {
      out.unshift(cursor);
      cursor = index.byId.get(cursor)?.parent_id ?? null;
    }
    return out;
  }, [index, value]);

  const [industry = "", domain = "", subdomain = ""] = chain;
  const domains = industry ? (index.children.get(industry) ?? []) : [];
  const subdomains = domain ? (index.children.get(domain) ?? []) : [];

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <select
        className={SELECT_CLASS}
        value={industry}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        aria-label="Industry"
      >
        <option value="">Industry…</option>
        {index.roots.map((n) => (
          <option key={n.id} value={n.id}>
            {n.label}
          </option>
        ))}
      </select>
      {domains.length ? (
        <select
          className={SELECT_CLASS}
          value={domain}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value || industry)}
          aria-label="Domain"
        >
          <option value="">Whole industry</option>
          {domains.map((n) => (
            <option key={n.id} value={n.id}>
              {n.label}
            </option>
          ))}
        </select>
      ) : null}
      {subdomains.length ? (
        <select
          className={SELECT_CLASS}
          value={subdomain}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value || domain)}
          aria-label="Subdomain"
        >
          <option value="">Whole domain</option>
          {subdomains.map((n) => (
            <option key={n.id} value={n.id}>
              {n.label}
            </option>
          ))}
        </select>
      ) : null}
    </div>
  );
}
