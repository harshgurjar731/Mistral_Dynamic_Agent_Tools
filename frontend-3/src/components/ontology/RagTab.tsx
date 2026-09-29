import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, Database, Loader2, Search, Tags } from "lucide-react";
import { ragApi } from "@/api";
import type { LibraryCard } from "@/types";
import { EmptyState } from "@/components/ui/EmptyState";
import { CreatedAt } from "@/components/shared/CreatedAt";
import { SortSelect } from "@/components/shared/SortSelect";
import { cn } from "@/lib/utils";
import { docCount, libraryState } from "./libraryMeta";

type Filter = "all" | "in_use" | "graphed";

const FILTERS: Array<{ value: Filter; label: string; test: (l: LibraryCard) => boolean }> = [
  { value: "all", label: "All", test: () => true },
  { value: "in_use", label: "In use", test: (l) => docCount(l) > 0 },
  { value: "graphed", label: "Graphed", test: (l) => l.entities > 0 },
];

const SORTS: Array<{
  key: string;
  label: string;
  compare: (a: LibraryCard, b: LibraryCard) => number;
}> = [
  {
    key: "graph",
    label: "Most graphed",
    compare: (a, b) => b.entities - a.entities || docCount(b) - docCount(a),
  },
  {
    key: "newest",
    label: "Newest first",
    compare: (a, b) => (b.created_at ?? "").localeCompare(a.created_at ?? ""),
  },
  { key: "name", label: "Name A–Z", compare: (a, b) => a.name.localeCompare(b.name) },
];

/** Every library as a card; each opens its own page. */
export function RagTab() {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [sort, setSort] = useState("graph");

  const { data: overview, isLoading } = useQuery({
    queryKey: ["rag", "overview"],
    queryFn: ragApi.overview,
    refetchInterval: 15_000,
  });

  const libraries = useMemo(() => overview?.libraries ?? [], [overview]);
  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    const test = FILTERS.find((f) => f.value === filter)!.test;
    const compare = SORTS.find((s) => s.key === sort)?.compare ?? SORTS[0]!.compare;
    return libraries
      .filter(
        (l) =>
          test(l) &&
          (!q ||
            l.name.toLowerCase().includes(q) ||
            (l.description ?? "").toLowerCase().includes(q)),
      )
      .sort((a, b) => compare(a, b) || a.name.localeCompare(b.name));
  }, [libraries, search, filter, sort]);

  const totals = overview?.totals ?? {};
  const graphUp = overview?.graph?.available;

  return (
    <div className="space-y-4">
      {/* ── Totals ── */}
      <div className="flex flex-wrap items-stretch gap-2">
        {(
          [
            ["Libraries", libraries.length, "text-foreground"],
            ["Documents graphed", totals["documents"] ?? 0, "text-emerald"],
            ["Entities", totals["entities"] ?? 0, "text-cyan"],
            ["Relations", totals["relations"] ?? 0, "text-purple"],
          ] as const
        ).map(([label, value, tone]) => (
          <div
            key={label}
            className="min-w-[8rem] flex-1 rounded-xl border border-border/60 bg-background-elevated/60 px-4 py-3"
          >
            <p className={cn("font-display text-xl font-bold tabular-nums", tone)}>{value}</p>
            <p className="text-[10px] font-semibold text-muted-foreground uppercase">{label}</p>
          </div>
        ))}
        <div
          className={cn(
            "flex min-w-[12rem] flex-1 items-center gap-2.5 rounded-xl border px-4 py-3",
            graphUp ? "border-emerald/30 bg-emerald/5" : "border-amber/30 bg-amber/5",
          )}
        >
          <span
            className={cn("size-2 rounded-full", graphUp ? "bg-emerald" : "animate-pulse bg-amber")}
          />
          <div>
            <p className={cn("text-xs font-semibold", graphUp ? "text-emerald" : "text-amber")}>
              {overview ? (graphUp ? "Knowledge graph online" : "Knowledge graph offline") : "…"}
            </p>
            <p className="text-[10px] text-muted-foreground">
              {graphUp ? "Neo4j is connected" : "Start it with docker compose up -d neo4j"}
            </p>
          </div>
        </div>
      </div>

      {/* ── Toolbar ── */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[14rem] flex-1 sm:max-w-sm">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Find a library…"
            aria-label="Find a library"
            className="h-9 w-full rounded-lg border border-border/60 bg-background-elevated pr-3 pl-9 text-xs text-foreground placeholder:text-muted-foreground focus:ring-1 focus:ring-primary focus:outline-none"
          />
        </div>
        <div className="inline-flex rounded-lg border border-border/60 bg-background-elevated p-0.5">
          {FILTERS.map((f) => (
            <button
              key={f.value}
              type="button"
              onClick={() => setFilter(f.value)}
              aria-pressed={filter === f.value}
              className={cn(
                "rounded-md px-3 py-1.5 text-xs font-medium transition",
                filter === f.value
                  ? "bg-primary/15 text-primary"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {f.label}
              <span className="ml-1.5 font-mono text-[10px] opacity-70 tabular-nums">
                {libraries.filter(f.test).length}
              </span>
            </button>
          ))}
        </div>
        <SortSelect
          value={sort}
          onChange={setSort}
          options={SORTS.map((s) => ({ key: s.key, label: s.label }))}
          className="ml-auto"
        />
      </div>

      {/* ── Cards ── */}
      {isLoading ? (
        <div className="py-16 text-center text-xs text-muted-foreground">
          <Loader2 className="mx-auto mb-2 size-5 animate-spin" /> Loading libraries…
        </div>
      ) : shown.length === 0 ? (
        <EmptyState
          icon={<Database className="size-5" />}
          title={libraries.length ? "No library matches" : "No libraries yet"}
          description={
            libraries.length
              ? "Try another search or filter."
              : "Libraries group documents and seed domain knowledge."
          }
        />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
          {shown.map((lib) => (
            <LibraryTile key={lib.id} library={lib} />
          ))}
        </div>
      )}
    </div>
  );
}

function LibraryTile({ library: lib }: { library: LibraryCard }) {
  const state = libraryState(lib);
  const docs = docCount(lib);
  const domains = lib.serves_domain ?? [];
  const tracked = lib.tracked_documents || 0;
  const bar = tracked
    ? [
        { w: lib.graphed_documents / tracked, cls: "bg-emerald" },
        { w: lib.pending_documents / tracked, cls: "bg-amber" },
        { w: lib.failed_documents / tracked, cls: "bg-red" },
      ]
    : [];

  return (
    <Link
      to="/ontology/libraries/$libraryId"
      params={{ libraryId: lib.id }}
      className="group glass relative flex flex-col overflow-hidden rounded-2xl p-4 transition duration-200 hover:-translate-y-0.5 hover:border-cyan/40"
    >
      <span
        className="pointer-events-none absolute -top-16 -right-16 size-40 rounded-full bg-cyan opacity-0 blur-2xl transition duration-300 group-hover:opacity-15"
        aria-hidden
      />
      <div className="flex items-start justify-between gap-2">
        <span className="grid size-10 shrink-0 place-items-center rounded-xl border border-cyan/30 bg-cyan/10 text-cyan">
          <Database className="size-5" />
        </span>
        <span
          className={cn(
            "inline-flex items-center gap-1.5 rounded-full border border-border/60 px-2 py-0.5 text-[10px] font-medium",
            state.text,
          )}
        >
          <span className={cn("size-1.5 rounded-full", state.dot)} />
          {state.label}
        </span>
      </div>

      <h3
        className="mt-3 line-clamp-2 text-sm font-semibold break-all text-foreground"
        title={lib.name}
      >
        {lib.name}
      </h3>
      <p className="mt-1 line-clamp-2 min-h-[2rem] text-xs text-muted-foreground">
        {lib.description || "No description."}
      </p>

      {domains.length ? (
        <div className="mt-2 flex flex-wrap gap-1">
          {domains.slice(0, 2).map((d) => (
            <span
              key={d}
              className="inline-flex max-w-full items-center gap-1 truncate rounded-full border border-purple/30 bg-purple/10 px-2 py-0.5 font-mono text-[10px] text-purple"
            >
              <Tags className="size-2.5 shrink-0" />
              {d}
            </span>
          ))}
          {domains.length > 2 ? (
            <span className="rounded-full border border-border/60 px-2 py-0.5 text-[10px] text-muted-foreground">
              +{domains.length - 2}
            </span>
          ) : null}
        </div>
      ) : null}

      {/* Where this library's documents are in the pipeline. */}
      <div
        className="mt-3 flex h-1.5 overflow-hidden rounded-full bg-muted/40"
        title={
          tracked
            ? `${lib.graphed_documents} graphed · ${lib.pending_documents} pending · ${lib.failed_documents} failed`
            : "Nothing ingested yet"
        }
      >
        {bar.map((b, i) => (
          <span key={i} className={b.cls} style={{ width: `${b.w * 100}%` }} />
        ))}
      </div>

      <dl className="mt-3 grid grid-cols-3 gap-2 text-center">
        {(
          [
            ["Docs", docs],
            ["Entities", lib.entities],
            ["Relations", lib.relations],
          ] as const
        ).map(([label, value]) => (
          <div key={label} className="rounded-lg bg-background/50 py-1.5">
            <dd
              className={cn(
                "font-display text-sm font-bold tabular-nums",
                value ? "text-foreground" : "text-muted-foreground/50",
              )}
            >
              {value}
            </dd>
            <dt className="text-[9px] font-semibold text-muted-foreground uppercase">{label}</dt>
          </div>
        ))}
      </dl>

      <div className="mt-3 flex items-center justify-between border-t border-border/50 pt-3">
        <CreatedAt value={lib.created_at} />
        <span className="inline-flex items-center gap-1 text-[11px] font-medium text-cyan opacity-70 transition group-hover:opacity-100">
          Open <ArrowRight className="size-3 transition group-hover:translate-x-0.5" />
        </span>
      </div>
    </Link>
  );
}
