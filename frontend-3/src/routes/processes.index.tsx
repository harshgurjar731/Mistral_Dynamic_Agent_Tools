import { useMemo, useState } from "react";
import { FeatureDescription, FeatureTitle } from "@/components/layout/FeatureText";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  Building2,
  Cpu,
  Edit2,
  FileJson,
  GitBranch,
  Plus,
  RefreshCw,
  Search,
  Sparkles,
  Trash2,
  Workflow,
  X,
} from "lucide-react";
import { processesApi, QK } from "@/api";
import type { IndustryCard } from "@/api/processes";
import { Button } from "@/components/ui/button";
import { ErrorState } from "@/components/ui/ErrorState";
import { CardGridSkeleton } from "@/components/ui/Skeletons";
import { SortSelect } from "@/components/shared/SortSelect";
import { applySort, type SortOption, useSortKey } from "@/lib/sorting";
import { deleteNodeFlow, NodeFormDialog } from "@/components/processes/NodeFormDialog";
import { TemplateDownloadMenu } from "@/components/processes/shared";
import { formatRelative } from "@/lib/status";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/processes/")({
  head: () => ({
    meta: [
      { title: "Processes — Agentic AI Design Patterns" },
      {
        name: "description",
        content:
          "Business processes by industry, domain and subdomain — the knowledge agent and workflow design is grounded in.",
      },
      { property: "og:title", content: "Processes — Agentic AI Design Patterns" },
      {
        property: "og:description",
        content: "Business processes by industry, domain and subdomain.",
      },
    ],
  }),
  component: ProcessesIndexPage,
});

const SORTS: SortOption<IndustryCard>[] = [
  { key: "name_asc", label: "Name A–Z", compare: (a, b) => a.label.localeCompare(b.label) },
  {
    key: "processes",
    label: "Most processes",
    compare: (a, b) =>
      b.counts.processes + b.counts.subprocesses - (a.counts.processes + a.counts.subprocesses),
  },
  {
    key: "recent",
    label: "Recently used",
    compare: (a, b) => (b.last_used ?? "").localeCompare(a.last_used ?? ""),
  },
];

function ProcessesIndexPage() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const [onlyWithProcesses, setOnlyWithProcesses] = useState(false);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<IndustryCard | null>(null);
  const [sort, setSort] = useSortKey("processes", "name_asc");

  const cards = useQuery({ queryKey: QK.processIndustries(), queryFn: processesApi.industries });
  const all = useMemo(() => cards.data ?? [], [cards.data]);
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const rows = all.filter(
      (c) =>
        (!onlyWithProcesses || c.counts.processes > 0) &&
        (!q ||
          c.label.toLowerCase().includes(q) ||
          (c.definition ?? "").toLowerCase().includes(q) ||
          c.synonyms.some((s) => s.toLowerCase().includes(q))),
    );
    return applySort(rows, SORTS, sort);
  }, [all, search, onlyWithProcesses, sort]);

  const totals = useMemo(
    () =>
      all.reduce(
        (t, c) => ({
          processes: t.processes + c.counts.processes + c.counts.subprocesses,
          documents: t.documents + c.counts.valid_documents,
          attention: t.attention + c.counts.needs_attention,
        }),
        { processes: 0, documents: 0, attention: 0 },
      ),
    [all],
  );

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: QK.processes() });
    void qc.invalidateQueries({ queryKey: QK.ontology() });
  };

  return (
    <div className="px-6 py-8">
      {/* ── Header ── */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
            <FeatureTitle route="/processes">
              <span className="text-gradient-brand">Processes</span>
            </FeatureTitle>
          </h1>
          <p className="mt-1.5 max-w-2xl text-sm text-muted-foreground">
            <FeatureDescription route="/processes">
              The business processes each industry runs, filed by domain and subdomain like the
              ontology, with a process and subprocess level below. A process document attached here
              grounds agent and workflow design when Process knowledge is turned on.
            </FeatureDescription>
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <TemplateDownloadMenu />
          <button
            type="button"
            onClick={() => setCreating(true)}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-xl bg-gradient-brand px-4 py-2.5 text-sm font-medium text-primary-foreground transition hover:opacity-90"
          >
            <Plus className="size-4" />
            New industry
          </button>
        </div>
      </div>

      {/* ── Filters ── */}
      <div className="mt-5 flex flex-wrap items-center gap-3 rounded-xl border border-border/40 bg-surface/20 px-4 py-3 backdrop-blur-sm">
        <div className="relative max-w-sm flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search industries…"
            className="w-full rounded-lg border border-border/60 bg-background-elevated py-2 pr-3 pl-9 text-sm text-foreground placeholder:text-muted-foreground focus:ring-1 focus:ring-primary focus:outline-none"
          />
        </div>
        <SortSelect value={sort} onChange={setSort} options={SORTS} />
        <label className="flex cursor-pointer items-center gap-1.5 text-xs text-muted-foreground">
          <input
            type="checkbox"
            checked={onlyWithProcesses}
            onChange={(e) => setOnlyWithProcesses(e.target.checked)}
            className="accent-[var(--primary)]"
          />
          With processes only
        </label>
        {search ? (
          <button
            type="button"
            onClick={() => setSearch("")}
            className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-muted-foreground transition hover:bg-surface-hover hover:text-foreground"
          >
            <X className="size-3" />
            Clear
          </button>
        ) : null}
        <Button
          size="sm"
          variant="outline"
          onClick={() => cards.refetch()}
          disabled={cards.isFetching}
        >
          <RefreshCw className={cards.isFetching ? "size-3.5 animate-spin" : "size-3.5"} />
          Refresh
        </Button>
        {all.length > 0 ? (
          <span className="ml-auto text-xs text-muted-foreground/70 tabular-nums">
            {totals.processes} processes · {totals.documents} with a valid document
            {totals.attention ? (
              <span className="text-amber"> · {totals.attention} need attention</span>
            ) : null}
          </span>
        ) : null}
      </div>

      {/* ── Grid ── */}
      <div className="mt-8">
        {cards.isLoading ? (
          <CardGridSkeleton />
        ) : cards.isError ? (
          <ErrorState error={cards.error} onRetry={() => cards.refetch()} />
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-border/60 py-20 text-center">
            <div className="relative mb-5 grid size-14 place-items-center rounded-2xl border border-border/60 glass">
              <Building2 className="size-6 text-primary" />
            </div>
            <h2 className="text-lg font-semibold tracking-tight text-foreground">
              {search || onlyWithProcesses ? "No industries match" : "No industries yet"}
            </h2>
            <p className="mt-1.5 max-w-sm text-xs text-muted-foreground">
              {search || onlyWithProcesses
                ? "Try a different search, or show every industry."
                : "Create an industry, then its domains, and the processes they run."}
            </p>
            {!search && !onlyWithProcesses ? (
              <button
                type="button"
                onClick={() => setCreating(true)}
                className="mt-5 inline-flex items-center gap-1.5 rounded-xl bg-gradient-brand px-4 py-2 text-sm font-medium text-primary-foreground transition hover:opacity-90"
              >
                <Plus className="size-4" />
                New industry
              </button>
            ) : null}
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {filtered.map((card) => (
              <IndustryCardView
                key={card.id}
                card={card}
                onEdit={() => setEditing(card)}
                onDelete={() => void deleteNodeFlow(card, refresh)}
              />
            ))}
          </div>
        )}
      </div>

      <NodeFormDialog
        open={creating}
        onOpenChange={setCreating}
        level="industry"
        onSaved={(n) =>
          void navigate({ to: "/processes/$industryId", params: { industryId: n.id } })
        }
      />
      <NodeFormDialog
        open={Boolean(editing)}
        onOpenChange={(o) => !o && setEditing(null)}
        level="industry"
        node={editing}
      />
    </div>
  );
}

function Badge({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-medium",
        className,
      )}
    >
      {children}
    </span>
  );
}

function IndustryCardView({
  card,
  onEdit,
  onDelete,
}: {
  card: IndustryCard;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const c = card.counts;
  return (
    <div
      className="group relative flex h-full flex-col rounded-2xl border border-border/60 backdrop-blur-md transition-all duration-300 hover:border-primary/30 hover:shadow-[0_0_32px_-8px_var(--primary)]"
      style={{ background: "var(--surface)" }}
    >
      <Link
        to="/processes/$industryId"
        params={{ industryId: card.id }}
        className="absolute inset-0 z-0 rounded-2xl"
        aria-label={card.label}
      />
      <div className="pointer-events-none relative z-[1] flex flex-1 flex-col p-5">
        <div className="flex items-start gap-3">
          <div className="grid size-11 shrink-0 place-items-center rounded-xl border border-border/60 bg-background-elevated text-muted-foreground transition-all duration-300 group-hover:border-primary/30 group-hover:bg-primary/10 group-hover:text-primary">
            <Building2 className="size-5" />
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="truncate text-sm font-semibold text-foreground">{card.label}</h3>
            <p className="mt-0.5 line-clamp-2 text-xs leading-relaxed text-muted-foreground/70">
              {card.definition || "No definition provided"}
            </p>
          </div>
        </div>

        <div className="mt-3.5 flex flex-wrap items-center gap-1.5">
          <Badge className="border-pink/20 bg-pink/8 text-pink">
            <GitBranch className="size-2.5" />
            {c.domains} domain{c.domains === 1 ? "" : "s"} · {c.subdomains} sub
          </Badge>
          <Badge className="border-indigo/20 bg-indigo/8 text-indigo">
            <Workflow className="size-2.5" />
            {c.processes} process{c.processes === 1 ? "" : "es"}
            {c.subprocesses ? ` · ${c.subprocesses} sub` : ""}
          </Badge>
          <Badge className="border-emerald/20 bg-emerald/8 text-emerald">
            <FileJson className="size-2.5" />
            {c.valid_documents} valid document{c.valid_documents === 1 ? "" : "s"}
          </Badge>
          {c.needs_attention ? (
            <Badge className="border-amber/25 bg-amber/10 text-amber">
              <AlertTriangle className="size-2.5" />
              {c.needs_attention} to fix
            </Badge>
          ) : null}
          {c.agents || c.workflows ? (
            <Badge className="border-cyan/20 bg-cyan/8 text-cyan">
              <Cpu className="size-2.5" />
              used by {c.agents} agent{c.agents === 1 ? "" : "s"}, {c.workflows} workflow
              {c.workflows === 1 ? "" : "s"}
            </Badge>
          ) : null}
        </div>

        <div className="mt-auto flex items-center gap-1.5 border-t border-border/40 pt-3.5">
          <div className="pointer-events-auto relative z-10 flex items-center gap-1.5">
            <button
              type="button"
              onClick={onEdit}
              className="inline-flex items-center gap-1 rounded-md border border-border/60 px-2 py-1 text-[10px] font-medium text-muted-foreground transition hover:border-primary/30 hover:bg-surface-hover hover:text-foreground"
            >
              <Edit2 className="size-3" />
              Edit
            </button>
            <button
              type="button"
              onClick={onDelete}
              aria-label={`Delete ${card.label}`}
              className="grid size-7 place-items-center rounded-md text-muted-foreground transition hover:bg-red/10 hover:text-red"
            >
              <Trash2 className="size-3.5" />
            </button>
          </div>
          <span className="ml-auto flex items-center gap-1 text-[10px] text-muted-foreground/70">
            {card.last_used ? (
              <>
                <Sparkles className="size-2.5" /> used {formatRelative(card.last_used)}
              </>
            ) : (
              "not used yet"
            )}
          </span>
        </div>
      </div>
    </div>
  );
}
