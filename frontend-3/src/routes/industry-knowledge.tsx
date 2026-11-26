import { useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Ban,
  BookOpen,
  Building2,
  Check,
  Code2,
  Eye,
  FileStack,
  Globe2,
  Plus,
  Search,
  Settings2,
  Upload,
  X,
} from "lucide-react";
import { z } from "zod";
import { errorMessage, industryApi, QK } from "@/api";
import type { IndustryCategory, IndustryItem } from "@/api/industry";
import { GlassPanel } from "@/components/glass/GlassPanel";
import { FeatureDescription, FeatureTitle } from "@/components/layout/FeatureText";
import {
  IndustryUploadDialog,
  IndustrySourcesPanel,
} from "@/components/industry/IndustryDocuments";
import {
  IndustryItemCard,
  IndustryItemDialog,
  IndustryUsageDialog,
} from "@/components/industry/IndustryItems";
import { IndustryPreviewPanel } from "@/components/industry/IndustryPreview";
import { IndustryTree } from "@/components/industry/IndustryTree";
import { buildIndex } from "@/components/industry/tree";
import { CATEGORY, CATEGORY_ORDER, nodePath, SELECT_CLASS } from "@/components/industry/labels";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { TableSkeleton } from "@/components/ui/Skeletons";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useCanCall } from "@/lib/policy";
import { cn } from "@/lib/utils";

const searchSchema = z.object({
  node: z.string().optional(),
  tab: z.string().optional(),
});

export const Route = createFileRoute("/industry-knowledge")({
  validateSearch: searchSchema,
  head: () => ({
    meta: [
      { title: "Industry knowledge — Agentic AI Design Patterns" },
      {
        name: "description",
        content:
          "Reviewed facts about each industry, domain and subdomain, used while planning agents and workflows and generating their code.",
      },
    ],
  }),
  component: IndustryKnowledgePage,
});

const STATUS_FILTERS = [
  { value: "active", label: "Approved" },
  { value: "review", label: "Waiting for review" },
  { value: "retired", label: "Retired" },
  { value: "all", label: "All" },
] as const;
type StatusFilter = (typeof STATUS_FILTERS)[number]["value"];

const RELATION_ORDER = { exact: 0, narrower: 1, inherited: 2 } as const;

function IndustryKnowledgePage() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const qc = useQueryClient();
  const canManage = useCanCall("POST", "/api/industry-knowledge/items");
  const node = search.node ?? null;
  const tab = ["entries", "documents", "preview"].includes(search.tab ?? "")
    ? search.tab!
    : "entries";
  const go = (next: { node?: string | null; tab?: string }) =>
    void navigate({
      search: (prev) => ({
        ...prev,
        ...("node" in next ? { node: next.node ?? undefined } : {}),
        ...(next.tab ? { tab: next.tab } : {}),
      }),
      replace: true,
    });

  const config = useQuery({ queryKey: QK.industryConfig(), queryFn: industryApi.config });
  const tree = useQuery({ queryKey: QK.industryTree(), queryFn: industryApi.tree });
  const index = useMemo(() => buildIndex(tree.data?.nodes ?? []), [tree.data]);

  const [status, setStatus] = useState<StatusFilter>("active");
  const [category, setCategory] = useState<IndustryCategory | "">("");
  const [query, setQuery] = useState("");
  const [inherit, setInherit] = useState(true);
  const [below, setBelow] = useState(false);
  const [sourceId, setSourceId] = useState<number | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [editing, setEditing] = useState<IndustryItem | null>(null);
  const [creating, setCreating] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [usageOf, setUsageOf] = useState<number | null>(null);

  const params = useMemo(
    () => ({
      ...(node ? { concept_id: node, inherit, below } : {}),
      ...(status === "active" || status === "retired" ? { status } : {}),
      ...(category ? { category } : {}),
      ...(sourceId ? { source_id: sourceId } : {}),
    }),
    [node, inherit, below, status, category, sourceId],
  );
  const items = useQuery({
    queryKey: QK.industryItems(params),
    queryFn: () => industryApi.items(params),
  });

  const visible = useMemo(() => {
    let rows = items.data?.items ?? [];
    if (status === "review")
      rows = rows.filter((i) => i.status === "proposed" || i.status === "conflicting");
    const q = query.trim().toLowerCase();
    if (q)
      rows = rows.filter(
        (i) =>
          i.title.toLowerCase().includes(q) ||
          i.body.toLowerCase().includes(q) ||
          i.tags.some((t) => t.toLowerCase().includes(q)),
      );
    return [...rows].sort(
      (a, b) =>
        (RELATION_ORDER[a.relation ?? "exact"] ?? 0) -
          (RELATION_ORDER[b.relation ?? "exact"] ?? 0) ||
        CATEGORY_ORDER.indexOf(a.category) - CATEGORY_ORDER.indexOf(b.category) ||
        a.title.localeCompare(b.title),
    );
  }, [items.data, status, query]);

  const bulk = useMutation({
    mutationFn: (next: "active" | "retired") => industryApi.setStatus([...selected], next),
    onSuccess: (r, next) => {
      toast.success(`${r.updated} item(s) ${next === "active" ? "approved" : "retired"}.`);
      setSelected(new Set());
      void qc.invalidateQueries({ queryKey: QK.industry() });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const toggle = (id: number) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const totals = tree.data?.totals;
  const cfg = config.data;
  const nodeLabel = node ? nodePath(index.byId, node) : "";

  return (
    <div className="px-6 py-8">
      {/* ── Header ── */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
            <FeatureTitle route="/industry-knowledge">
              <span className="text-gradient-brand">Industry knowledge</span>
            </FeatureTitle>
          </h1>
          <p className="mt-1.5 max-w-3xl text-sm text-muted-foreground">
            <FeatureDescription route="/industry-knowledge">
              The reviewed facts about each industry, domain and subdomain — regulations, standards,
              business rules, metrics, risks and definitions. Plans in that industry follow them,
              and the tools and activities built for those plans are generated against them.
            </FeatureDescription>
          </p>
        </div>
        {canManage ? (
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <Button
              variant="outline"
              onClick={() => setCreating(true)}
              disabled={!index.roots.length}
            >
              <Plus className="size-4" /> New entry
            </Button>
            <button
              type="button"
              onClick={() => setUploading(true)}
              disabled={!index.roots.length}
              className="inline-flex shrink-0 items-center gap-1.5 rounded-xl bg-gradient-brand px-4 py-2.5 text-sm font-medium text-primary-foreground transition hover:opacity-90 disabled:opacity-50"
            >
              <Upload className="size-4" /> Upload document
            </button>
          </div>
        ) : null}
      </div>

      {/* ── How it is used right now (Settings) ── */}
      <div className="mt-4 flex flex-wrap items-center gap-2 rounded-xl border border-border/40 bg-surface/20 px-4 py-2.5 text-[11px] text-muted-foreground backdrop-blur-sm">
        {cfg ? (
          <>
            <span
              className={cn(
                "inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 font-medium",
                cfg.mode === "auto"
                  ? "border-emerald/25 bg-emerald/10 text-emerald"
                  : "border-amber/25 bg-amber/10 text-amber",
              )}
            >
              <Eye className="size-3" /> Planning: {cfg.mode === "auto" ? "on" : "off"}
            </span>
            <span className="inline-flex items-center gap-1">
              <Code2 className="size-3" /> Code generation:{" "}
              {cfg.in_codegen ? `on, ${cfg.code_items} per tool` : "off"}
            </span>
            <span>
              · {cfg.pack_size} per build, {cfg.view_size} per decision
            </span>
            <span className="inline-flex items-center gap-1">
              · <Globe2 className="size-3" />{" "}
              {cfg.jurisdictions.length
                ? `${cfg.jurisdictions.join(", ")} + global`
                : "every jurisdiction"}
            </span>
            <span>· narrower nodes {cfg.include_narrower ? "included" : "excluded"}</span>
            <span>
              · extracted facts{" "}
              {cfg.auto_approve ? "auto-approved when confident" : "wait for review"}
            </span>
          </>
        ) : (
          <span>Loading settings…</span>
        )}
        <Link
          to="/settings"
          search={{ category: "industry" }}
          className="ml-auto inline-flex items-center gap-1 text-primary hover:underline"
        >
          <Settings2 className="size-3" /> Change in Settings
        </Link>
        {totals ? (
          <span className="w-full text-muted-foreground/80 tabular-nums sm:w-auto">
            {totals.active ?? 0} approved · {(totals.proposed ?? 0) + (totals.conflicting ?? 0)}{" "}
            waiting for review · {tree.data?.sources ?? 0} document(s)
          </span>
        ) : null}
      </div>

      {tree.isError ? (
        <div className="mt-6">
          <ErrorState error={tree.error} onRetry={() => tree.refetch()} />
        </div>
      ) : (
        <div className="mt-6 grid gap-5 lg:grid-cols-[300px_minmax(0,1fr)]">
          <GlassPanel className="h-fit p-3 lg:sticky lg:top-4 lg:max-h-[calc(100vh-6rem)]">
            {tree.isLoading ? (
              <TableSkeleton rows={8} />
            ) : index.roots.length ? (
              <IndustryTree
                key={tree.dataUpdatedAt ? "ready" : "loading"}
                index={index}
                selected={node}
                onSelect={(id) => {
                  setSelected(new Set());
                  go({ node: id });
                }}
              />
            ) : (
              <EmptyState
                icon={<Building2 className="size-5" />}
                title="No industries yet."
                description="Industries, domains and subdomains are created on the Processes page."
              />
            )}
          </GlassPanel>

          <div className="min-w-0">
            <Tabs value={tab} onValueChange={(v) => go({ tab: v })}>
              <TabsList>
                <TabsTrigger value="entries">
                  <BookOpen className="mr-1 size-3.5" /> Entries
                </TabsTrigger>
                <TabsTrigger value="documents">
                  <FileStack className="mr-1 size-3.5" /> Documents
                </TabsTrigger>
                <TabsTrigger value="preview">
                  <Eye className="mr-1 size-3.5" /> Planning preview
                </TabsTrigger>
              </TabsList>

              <TabsContent value="entries" className="space-y-3 pt-4">
                <div className="flex flex-wrap items-center gap-2">
                  <div className="flex rounded-lg border border-border/60 p-0.5">
                    {STATUS_FILTERS.map((f) => (
                      <button
                        key={f.value}
                        type="button"
                        onClick={() => setStatus(f.value)}
                        className={cn(
                          "rounded-md px-2.5 py-1 text-[11px] transition",
                          status === f.value
                            ? "bg-primary/15 font-medium text-foreground"
                            : "text-muted-foreground hover:text-foreground",
                        )}
                      >
                        {f.label}
                      </button>
                    ))}
                  </div>
                  <select
                    className={SELECT_CLASS}
                    value={category}
                    onChange={(e) => setCategory(e.target.value as IndustryCategory | "")}
                  >
                    <option value="">Every category</option>
                    {CATEGORY_ORDER.map((c) => (
                      <option key={c} value={c}>
                        {CATEGORY[c].label}
                      </option>
                    ))}
                  </select>
                  <div className="relative min-w-[180px] flex-1">
                    <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
                    <input
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      placeholder="Search titles, text and tags…"
                      className="h-9 w-full rounded-md border border-input bg-background-elevated/70 pr-2 pl-8 text-xs text-foreground focus:ring-1 focus:ring-primary focus:outline-none"
                    />
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-3 text-[11px] text-muted-foreground">
                  {node ? (
                    <>
                      <span>
                        Showing <span className="font-medium text-foreground">{nodeLabel}</span>
                      </span>
                      <label className="flex cursor-pointer items-center gap-1.5">
                        <input
                          type="checkbox"
                          checked={inherit}
                          onChange={(e) => setInherit(e.target.checked)}
                          className="accent-[var(--primary)]"
                        />
                        with what it inherits from above
                      </label>
                      <label className="flex cursor-pointer items-center gap-1.5">
                        <input
                          type="checkbox"
                          checked={below}
                          onChange={(e) => setBelow(e.target.checked)}
                          className="accent-[var(--primary)]"
                        />
                        and what is filed below
                      </label>
                    </>
                  ) : (
                    <span>
                      Every industry — choose a node on the left to see what a plan scoped to it
                      reads.
                    </span>
                  )}
                  {sourceId ? (
                    <button
                      type="button"
                      onClick={() => setSourceId(null)}
                      className="inline-flex items-center gap-1 rounded-md border border-primary/30 bg-primary/10 px-1.5 py-0.5 text-primary"
                    >
                      From document #{sourceId} <X className="size-3" />
                    </button>
                  ) : null}
                  {canManage && selected.size ? (
                    <span className="ml-auto flex items-center gap-1.5">
                      {selected.size} selected
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 px-2 text-[11px]"
                        onClick={() => bulk.mutate("active")}
                        disabled={bulk.isPending}
                      >
                        <Check className="size-3.5" /> Approve
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 px-2 text-[11px]"
                        onClick={() => bulk.mutate("retired")}
                        disabled={bulk.isPending}
                      >
                        <Ban className="size-3.5" /> Retire
                      </Button>
                      <button
                        type="button"
                        onClick={() => setSelected(new Set())}
                        className="text-muted-foreground hover:text-foreground"
                      >
                        clear
                      </button>
                    </span>
                  ) : null}
                </div>

                {items.isLoading ? (
                  <TableSkeleton rows={6} />
                ) : items.isError ? (
                  <ErrorState error={items.error} onRetry={() => items.refetch()} />
                ) : visible.length === 0 ? (
                  <EmptyState
                    icon={<BookOpen className="size-6" />}
                    title={
                      status === "review"
                        ? "Nothing waiting for review."
                        : "No industry knowledge here yet."
                    }
                    description={
                      canManage
                        ? "Upload a regulation, standard, policy manual or KPI handbook, or add an entry by hand."
                        : "Nothing is filed on this node with these filters."
                    }
                  />
                ) : (
                  <ul className="space-y-2">
                    {visible.map((item) => (
                      <IndustryItemCard
                        key={item.id}
                        item={item}
                        selected={selected.has(item.id)}
                        onToggle={() => toggle(item.id)}
                        canManage={canManage}
                        onEdit={() => setEditing(item)}
                        onUsage={() => setUsageOf(item.id)}
                      />
                    ))}
                  </ul>
                )}
              </TabsContent>

              <TabsContent value="documents" className="pt-4">
                <IndustrySourcesPanel
                  canManage={canManage}
                  onShowItems={(id) => {
                    setSourceId(id);
                    setStatus("all");
                    go({ node: null, tab: "entries" });
                  }}
                />
              </TabsContent>

              <TabsContent value="preview" className="pt-4">
                <IndustryPreviewPanel key={node ?? "all"} index={index} defaultNode={node} />
              </TabsContent>
            </Tabs>
          </div>
        </div>
      )}

      <IndustryUploadDialog
        open={uploading}
        onOpenChange={setUploading}
        index={index}
        config={cfg}
        defaultNode={node}
      />
      <IndustryItemDialog
        open={creating}
        onOpenChange={setCreating}
        index={index}
        defaultNode={node}
      />
      <IndustryItemDialog
        open={Boolean(editing)}
        onOpenChange={(o) => !o && setEditing(null)}
        index={index}
        item={editing}
      />
      <IndustryUsageDialog itemId={usageOf} onClose={() => setUsageOf(null)} />
    </div>
  );
}
