import { useMemo, useState } from "react";
import { Crosshair, Eye, EyeOff, Network, Quote, Search, Workflow, X } from "lucide-react";
import { EmptyState } from "@/components/ui/EmptyState";
import { cn } from "@/lib/utils";
import {
  CanvasCard,
  GraphCanvas,
  type GraphLayout,
  type SimpleEdge,
  type SimpleNode,
} from "./GraphCanvas";

/** One extracted entity, from a committed graph or a draft awaiting review. */
export interface EntityNode {
  id: string;
  label: string;
  type: string;
  description?: string | undefined;
  confidence?: number | null | undefined;
}
/** One extracted relation; `evidence` is the quote it was read from. */
export interface EntityEdge {
  source: string;
  target: string;
  predicate: string;
  evidence?: string | undefined;
  confidence?: number | null | undefined;
}

/**
 * Entity types are open-ended — each library's ontology names its own — so
 * colours are handed out by frequency from a fixed, theme-backed set rather
 * than looked up by name.
 */
const TYPE_PALETTE = [
  "var(--cyan)",
  "var(--amber)",
  "var(--purple)",
  "var(--emerald)",
  "var(--pink)",
  "var(--blue)",
  "var(--orange)",
  "var(--red)",
  "color-mix(in oklch, var(--cyan) 55%, var(--foreground))",
  "color-mix(in oklch, var(--amber) 55%, var(--foreground))",
  "color-mix(in oklch, var(--purple) 55%, var(--foreground))",
  "var(--slate)",
];

/** "RegulatedEntity" → "Regulated entity". */
const typeLabel = (t: string) =>
  t
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .toLowerCase()
    .replace(/^\w/, (c) => c.toUpperCase());

export function EntityGraph({
  nodes: entities,
  edges: relations,
  className,
  truncated,
}: {
  nodes: EntityNode[];
  edges: EntityEdge[];
  className?: string;
  /** The source capped how much it returned. */
  truncated?: boolean;
}) {
  const [layout, setLayout] = useState<GraphLayout>("network");
  const [hidden, setHidden] = useState<Set<string>>(() => new Set());
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [focusIds, setFocusIds] = useState<string[] | null>(null);

  const degree = useMemo(() => {
    const d = new Map<string, number>();
    for (const r of relations) {
      d.set(r.source, (d.get(r.source) ?? 0) + 1);
      d.set(r.target, (d.get(r.target) ?? 0) + 1);
    }
    return d;
  }, [relations]);

  const types = useMemo(() => {
    const counts = new Map<string, number>();
    for (const e of entities) counts.set(e.type, (counts.get(e.type) ?? 0) + 1);
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([type, count], i) => ({
        type,
        count,
        color: TYPE_PALETTE[i % TYPE_PALETTE.length]!,
      }));
  }, [entities]);
  const colorOf = useMemo(() => new Map(types.map((t) => [t.type, t.color])), [types]);
  const typeOrder = useMemo(() => types.map((t) => t.type), [types]);

  const visible = useMemo(() => entities.filter((e) => !hidden.has(e.type)), [entities, hidden]);

  const nodes = useMemo<SimpleNode[]>(
    () =>
      visible.map((e) => ({
        id: e.id,
        label: e.label,
        sublabel: typeLabel(e.type),
        color: colorOf.get(e.type) ?? "var(--slate)",
        group: e.type,
        weight: degree.get(e.id) ?? 0,
      })),
    [visible, colorOf, degree],
  );
  const edges = useMemo<SimpleEdge[]>(
    () =>
      relations.map((r, i) => ({
        id: `${r.source}->${r.target}#${i}`,
        source: r.source,
        target: r.target,
        label: r.predicate.replace(/_/g, " "),
      })),
    [relations],
  );

  const term = search.trim().toLowerCase();
  const matches = useMemo(
    () =>
      term
        ? visible.filter(
            (e) => e.label.toLowerCase().includes(term) || e.type.toLowerCase().includes(term),
          )
        : [],
    [visible, term],
  );
  const highlightIds = useMemo(
    () => (term ? new Set(matches.map((m) => m.id)) : null),
    [term, matches],
  );

  const neighbourhood = (id: string) => {
    const ids = new Set([id]);
    for (const r of relations) {
      if (r.source === id) ids.add(r.target);
      if (r.target === id) ids.add(r.source);
    }
    return [...ids];
  };

  const selected = entities.find((e) => e.id === selectedId) ?? null;

  if (entities.length === 0) {
    return (
      <div
        className={cn(
          "flex items-center justify-center rounded-2xl border border-dashed border-border/60",
          className,
        )}
      >
        <EmptyState
          className="border-0 bg-transparent"
          icon={<Network className="size-5" />}
          title="No entities yet"
          description="Commit a reviewed extraction and its entities and relations appear here."
        />
      </div>
    );
  }

  return (
    <GraphCanvas
      nodes={nodes}
      edges={edges}
      layout={layout}
      nodeStyle="dot"
      groupLabel={typeLabel}
      groupOrder={typeOrder}
      selectedId={selectedId}
      highlightIds={highlightIds}
      focusIds={focusIds}
      onNodeClick={(id) => setSelectedId((cur) => (cur === id ? null : id))}
      onNodeDoubleClick={(id) => {
        setSelectedId(id);
        setFocusIds(neighbourhood(id));
      }}
      onPaneClick={() => setSelectedId(null)}
      className={className}
      empty={
        <EmptyState
          className="border-0 bg-transparent"
          icon={<EyeOff className="size-5" />}
          title="Every type is hidden"
          description="Turn a type back on in the key."
        />
      }
      toolbar={
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && matches.length) {
                  e.preventDefault();
                  setFocusIds(matches.slice(0, 40).map((m) => m.id));
                }
              }}
              placeholder="Find an entity…"
              aria-label="Find an entity"
              className="h-8 w-52 rounded-lg border border-border/60 bg-background-elevated/90 pr-7 pl-8 text-xs text-foreground backdrop-blur-md placeholder:text-muted-foreground focus:ring-1 focus:ring-primary focus:outline-none"
            />
            {search ? (
              <button
                type="button"
                onClick={() => setSearch("")}
                aria-label="Clear search"
                className="absolute top-1/2 right-2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                <X className="size-3" />
              </button>
            ) : null}
          </div>
          <div className="inline-flex rounded-lg border border-border/60 bg-background-elevated/90 p-0.5 backdrop-blur-md">
            {(
              [
                { value: "network", label: "Network", icon: Network },
                { value: "hierarchy", label: "By type", icon: Workflow },
              ] as const
            ).map((l) => (
              <button
                key={l.value}
                type="button"
                onClick={() => setLayout(l.value)}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors",
                  layout === l.value
                    ? "bg-primary/15 text-primary"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                <l.icon className="size-3.5" />
                {l.label}
              </button>
            ))}
          </div>
          <span className="inline-flex h-8 items-center rounded-lg border border-border/60 bg-background-elevated/90 px-2.5 text-[11px] text-muted-foreground tabular-nums backdrop-blur-md">
            {term ? `${matches.length} match${matches.length === 1 ? "" : "es"} · ` : ""}
            {nodes.length} entities · {relations.length} relations
            {truncated ? " · capped" : ""}
          </span>
        </div>
      }
      legend={
        <CanvasCard title="Entity types" defaultOpen={false} className="w-56">
          <ul className="custom-scrollbar max-h-[36vh] space-y-0.5 overflow-y-auto">
            {types.map(({ type, count, color }) => {
              const off = hidden.has(type);
              return (
                <li key={type}>
                  <button
                    type="button"
                    aria-pressed={!off}
                    onClick={() => {
                      setHidden((h) => {
                        const next = new Set(h);
                        if (next.has(type)) next.delete(type);
                        else next.add(type);
                        return next;
                      });
                      setSelectedId(null);
                    }}
                    className={cn(
                      "flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-left text-[11px] transition hover:bg-surface-hover",
                      off ? "text-muted-foreground/50" : "text-foreground",
                    )}
                  >
                    <span
                      className="size-2.5 shrink-0 rounded-full border"
                      style={{ borderColor: color, background: off ? "transparent" : color }}
                    />
                    <span className="min-w-0 flex-1 truncate">{typeLabel(type)}</span>
                    <span className="font-mono text-[10px] text-muted-foreground tabular-nums">
                      {count}
                    </span>
                    {off ? <EyeOff className="size-3" /> : <Eye className="size-3 opacity-40" />}
                  </button>
                </li>
              );
            })}
          </ul>
          {hidden.size ? (
            <button
              type="button"
              onClick={() => setHidden(new Set())}
              className="mt-2 border-t border-border/50 pt-2 text-[10px] text-muted-foreground hover:text-foreground"
            >
              Show all
            </button>
          ) : null}
        </CanvasCard>
      }
      inspector={
        selected ? (
          <EntityInspector
            entity={selected}
            color={colorOf.get(selected.type) ?? "var(--slate)"}
            entities={entities}
            relations={relations}
            onClose={() => setSelectedId(null)}
            onFocus={() => setFocusIds(neighbourhood(selected.id))}
            onSelect={(id) => {
              setSelectedId(id);
              setFocusIds(neighbourhood(id));
            }}
          />
        ) : null
      }
    />
  );
}

function EntityInspector({
  entity,
  color,
  entities,
  relations,
  onClose,
  onFocus,
  onSelect,
}: {
  entity: EntityNode;
  color: string;
  entities: EntityNode[];
  relations: EntityEdge[];
  onClose: () => void;
  onFocus: () => void;
  onSelect: (id: string) => void;
}) {
  const byId = useMemo(() => new Map(entities.map((e) => [e.id, e])), [entities]);
  const links = relations
    .filter((r) => r.source === entity.id || r.target === entity.id)
    .map((r, i) => {
      const out = r.source === entity.id;
      const otherId = out ? r.target : r.source;
      return { key: `${otherId}-${i}`, out, otherId, other: byId.get(otherId), relation: r };
    });

  return (
    <aside className="flex max-h-full min-h-0 flex-col rounded-2xl border border-border/60 bg-background-elevated/95 shadow-[var(--shadow-panel)] backdrop-blur-xl">
      <div className="flex items-start gap-2 border-b border-border/40 p-4">
        <span
          className="mt-1.5 size-2.5 shrink-0 rounded-full"
          style={{ background: color, boxShadow: `0 0 8px -1px ${color}` }}
        />
        <div className="min-w-0 flex-1">
          <p className="eyebrow" style={{ color }}>
            {typeLabel(entity.type)}
          </p>
          <h3 className="mt-0.5 text-sm font-semibold break-words text-foreground">
            {entity.label}
          </h3>
        </div>
        <button
          type="button"
          onClick={onFocus}
          aria-label="Zoom to neighbourhood"
          title="Zoom to neighbourhood"
          className="grid size-6 shrink-0 place-items-center rounded-md text-muted-foreground transition hover:bg-surface-hover hover:text-foreground"
        >
          <Crosshair className="size-3.5" />
        </button>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close details"
          className="grid size-6 shrink-0 place-items-center rounded-md text-muted-foreground transition hover:bg-surface-hover hover:text-foreground"
        >
          <X className="size-3.5" />
        </button>
      </div>
      <div className="custom-scrollbar min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
        {entity.description ? (
          <p className="text-xs leading-relaxed text-muted-foreground">{entity.description}</p>
        ) : null}
        {typeof entity.confidence === "number" ? (
          <p className="text-[11px] text-muted-foreground">
            Extraction confidence{" "}
            <span className="font-mono text-foreground">
              {Math.round(entity.confidence * 100)}%
            </span>
          </p>
        ) : null}
        <div>
          <p className="eyebrow mb-2">Relations ({links.length})</p>
          {links.length === 0 ? (
            <p className="text-[11px] text-muted-foreground">No relations recorded.</p>
          ) : (
            <ul className="space-y-1.5">
              {links.map((l) => (
                <li key={l.key}>
                  <button
                    type="button"
                    onClick={() => onSelect(l.otherId)}
                    className="w-full rounded-lg border border-border/40 px-2.5 py-2 text-left transition hover:border-primary/30 hover:bg-surface-hover"
                  >
                    <span className="block text-[10px] font-semibold text-primary uppercase">
                      {l.out ? "→ " : "← "}
                      {l.relation.predicate.replace(/_/g, " ")}
                    </span>
                    <span className="block truncate text-[11px] font-medium text-foreground">
                      {l.other?.label ?? l.otherId}
                    </span>
                    {l.relation.evidence ? (
                      <span className="mt-1 flex gap-1 text-[10px] leading-snug text-muted-foreground italic">
                        <Quote className="mt-0.5 size-2.5 shrink-0" />
                        <span className="line-clamp-3">{l.relation.evidence}</span>
                      </span>
                    ) : null}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </aside>
  );
}
