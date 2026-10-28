import { useEffect, useMemo, useRef, useState } from "react";
import { FeatureDescription, FeatureTitle } from "@/components/layout/FeatureText";
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Activity,
  AlertTriangle,
  Box,
  Cpu,
  Database,
  Gauge,
  GitBranch,
  KeyRound,
  LayoutDashboard,
  LayoutTemplate,
  Loader2,
  MapPin,
  Monitor,
  Network,
  Palette,
  Plug,
  RefreshCw,
  RotateCcw,
  RotateCw,
  Route as RouteIcon,
  Save,
  Search,
  Server,
  ShieldAlert,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Trash2,
  Workflow,
  Wrench,
  X,
  type LucideIcon,
} from "lucide-react";
import { toast } from "sonner";
import { errorMessage, QK, settingsApi } from "@/api";
import type {
  CatalogIssue,
  CatalogModel,
  RefreshReport,
  SettingItem,
  SettingsChanges,
  SettingsPayload,
  SettingsSection,
  SettingTarget,
  SettingValue,
} from "@/api/settings";
import { ErrorState } from "@/components/ui/ErrorState";
import { CardGridSkeleton } from "@/components/ui/Skeletons";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { CleanupPanel } from "@/components/settings/CleanupPanel";
import { SettingTile } from "@/components/settings/SettingControls";
import { ProcessTemplatesPanel } from "@/components/settings/ProcessTemplatesPanel";
import { ToolSafetyPanel } from "@/components/settings/ToolSafetyPanel";
import { VaultPanel } from "@/components/settings/VaultPanel";
import {
  ModelCatalogBrowser,
  ModelUsageMap,
  RefreshReportCard,
} from "@/components/settings/ModelPanels";
import {
  draftKey,
  formatWhen,
  indexCatalog,
  matchesQuery,
  sameValue,
} from "@/components/settings/settingsModel";
import { cn } from "@/lib/utils";
import { LivePercent } from "@/components/activity/LiveProgress";

const searchSchema = z.object({
  /** Open on this category — e.g. "process" from the Processes page. */
  category: z.string().optional(),
  /** Process knowledge: the industry, domain or process whose template to show. */
  scope: z.string().optional(),
  /** Vault: the entry to show, or a name to add (from a prerequisite's action). */
  secret: z.string().optional(),
  create: z.string().optional(),
});

export const Route = createFileRoute("/settings")({
  validateSearch: searchSchema,
  head: () => ({
    meta: [
      { title: "Settings — Agentic AI Design Patterns" },
      {
        name: "description",
        content:
          "Every model and configuration value of the platform, the Tool Service and the interface.",
      },
    ],
  }),
  component: SettingsPage,
});

const SECTION_ICONS: Record<string, LucideIcon> = {
  cpu: Cpu,
  route: RouteIcon,
  refresh: RefreshCw,
  gauge: Gauge,
  workflow: GitBranch,
  plug: Plug,
  network: Network,
  activity: Activity,
  shield: ShieldCheck,
  wrench: Wrench,
  box: Box,
  palette: Palette,
  layout: LayoutTemplate,
  monitor: Monitor,
};

type CategoryId =
  | "overview"
  | "models"
  | "tool_service"
  | "platform"
  | "process"
  | "safety"
  | "vault"
  | "frontend"
  | "cleanup";

const CATEGORIES: { id: CategoryId; title: string; blurb: string; icon: LucideIcon }[] = [
  {
    id: "overview",
    title: "Overview",
    blurb: "Where every model is used, and the live Mistral model catalog.",
    icon: LayoutDashboard,
  },
  {
    id: "models",
    title: "AI models",
    blurb:
      "Models for agents, chat, planning and the code pipeline, and how the catalog stays current.",
    icon: Cpu,
  },
  {
    id: "tool_service",
    title: "Tool Service",
    blurb:
      "Connection, model routes, synthesis and sandbox of the service that builds and runs tools.",
    icon: Wrench,
  },
  {
    id: "platform",
    title: "Platform",
    blurb: "Pacing, workflows, knowledge graph, observability and security.",
    icon: ShieldCheck,
  },
  {
    id: "process",
    title: "Process knowledge",
    blurb:
      "The template process documents must follow, and how documents are checked and matched to a request.",
    icon: Workflow,
  },
  {
    id: "safety",
    title: "Tool safety",
    blurb:
      "Which kinds of tool the AI may not design or build, how strictly, and where each rule applies. Off by default.",
    icon: ShieldAlert,
  },
  {
    id: "vault",
    title: "Vault & prerequisites",
    blurb:
      "Encrypted credentials and service URLs for the code that calls third-party services, and what a build must settle with you before it starts.",
    icon: KeyRound,
  },
  {
    id: "frontend",
    title: "Frontend & design",
    blurb:
      "Theme, typography, layout, branding and interface behaviour — applied as soon as you save.",
    icon: Palette,
  },
  {
    id: "cleanup",
    title: "Cleanup",
    blurb:
      "Delete agents, workflows, tools, data, images and history — by area, or everything at once to return the project to its starting point.",
    icon: Trash2,
  },
];

type ResetBody = { target?: SettingTarget; section?: string; keys?: string[] };

function SettingsPage() {
  const qc = useQueryClient();
  const settingsQ = useQuery({ queryKey: QK.settings(), queryFn: settingsApi.get });
  const catalogQ = useQuery({ queryKey: QK.modelCatalog(), queryFn: settingsApi.catalog });

  const search = Route.useSearch();
  const [category, setCategory] = useState<CategoryId>(() =>
    CATEGORIES.some((c) => c.id === search.category) ? (search.category as CategoryId) : "models",
  );
  useEffect(() => {
    if (search.category && CATEGORIES.some((c) => c.id === search.category)) {
      setCategory(search.category as CategoryId);
    }
  }, [search.category]);
  const [query, setQuery] = useState("");
  const [draft, setDraft] = useState<Record<string, SettingValue>>({});
  const [report, setReport] = useState<RefreshReport | null>(null);
  const [confirm, setConfirm] = useState<{ title: string; body: string; reset: ResetBody } | null>(
    null,
  );
  const searchRef = useRef<HTMLInputElement>(null);

  // "/" focuses search, Escape clears it.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = (e.target as HTMLElement)?.closest("input, textarea, [contenteditable]");
      if (e.key === "/" && !typing) {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const models = useMemo(() => catalogQ.data?.models ?? [], [catalogQ.data]);
  const catalog = useMemo(() => indexCatalog(models), [models]);
  const sections = useMemo(() => settingsQ.data?.sections ?? [], [settingsQ.data]);
  const items = useMemo(() => sections.flatMap((s) => s.settings), [sections]);
  const byKey = useMemo(() => new Map(items.map((i) => [draftKey(i), i])), [items]);

  const valueOf = (item: SettingItem): SettingValue => {
    const k = draftKey(item);
    return k in draft ? (draft[k] ?? null) : item.value;
  };
  const dirtyKeys = Object.keys(draft).filter((k) => {
    const item = byKey.get(k);
    return item && !sameValue(draft[k] ?? null, item.value);
  });
  const dirtySet = new Set(dirtyKeys);
  const setValue = (item: SettingItem, v: SettingValue) =>
    setDraft((d) => ({ ...d, [draftKey(item)]: v }));

  const afterWrite = () => qc.invalidateQueries({ queryKey: QK.settings() });

  const save = useMutation({
    mutationFn: () => {
      const changes: SettingsChanges = {};
      for (const k of dirtyKeys) {
        const item = byKey.get(k)!;
        (changes[item.target] ??= {})[item.key] = draft[k] ?? null;
      }
      return settingsApi.update(changes);
    },
    onSuccess: (res) => {
      qc.setQueryData(QK.settings(), res);
      setDraft({});
      const n = res.changed.backend.length + res.changed.tool_service.length;
      toast.success(`Saved ${n} setting${n === 1 ? "" : "s"}`, {
        description: res.restart_pending
          ? "Live settings are already in effect; ones marked “Restart pending” apply after a restart."
          : "In effect now on the backend, the Tool Service and this interface.",
      });
      afterWrite();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const reset = useMutation({
    mutationFn: (body: ResetBody) => settingsApi.reset(body),
    onSuccess: (res, body) => {
      qc.setQueryData(QK.settings(), res);
      setDraft((d) => {
        const next = { ...d };
        for (const k of Object.keys(next)) {
          const item = byKey.get(k);
          if (!item) continue;
          const hit =
            (body.keys ? body.keys.includes(item.key) : true) &&
            (body.section ? item.section === body.section : true) &&
            (body.target ? item.target === body.target : true);
          if (hit) delete next[k];
        }
        return next;
      });
      const n = res.reset.backend.length + res.reset.tool_service.length;
      toast.success(
        n ? `Restored ${n} setting${n === 1 ? "" : "s"} to default` : "Already at defaults",
      );
      afterWrite();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const refresh = useMutation({
    mutationFn: settingsApi.refreshModels,
    onSuccess: (res) => {
      setReport(res.report);
      const issues = res.report.issues.length;
      toast.success(`Model list refreshed — ${res.report.model_count} models`, {
        description: issues
          ? `${issues} configured model${issues > 1 ? "s need" : " needs"} attention — see Overview.`
          : "Every configured model is available.",
      });
      afterWrite();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const useReplacement = (issue: CatalogIssue) => {
    const item = byKey.get(`${issue.target}:${issue.key}`);
    if (item && issue.replacement) {
      setValue(item, issue.replacement);
      toast.info(`${item.label} set to ${issue.replacement} — save to apply`);
    }
  };

  const resetOne = (item: SettingItem) => {
    if (item.source !== "override") {
      setDraft((d) => {
        const next = { ...d };
        delete next[draftKey(item)];
        return next;
      });
      return;
    }
    reset.mutate({ target: item.target, keys: [item.key] });
  };

  if (settingsQ.isLoading) {
    return (
      <div className="px-6 py-8">
        <CardGridSkeleton />
      </div>
    );
  }
  if (settingsQ.isError || !settingsQ.data) {
    return (
      <div className="px-6 py-8">
        <ErrorState
          title="Settings didn't load"
          error={settingsQ.error}
          onRetry={() => settingsQ.refetch()}
        />
      </div>
    );
  }

  const data = settingsQ.data;
  const q = query.trim();
  const searching = q.length > 0;
  const matches = (s: SettingsSection) => s.settings.filter((i) => matchesQuery(i, s, q));
  const sectionsIn = (cat: CategoryId) => sections.filter((s) => s.category === cat);
  const customIn = (cat: CategoryId) =>
    sectionsIn(cat).reduce(
      (n, s) => n + s.settings.filter((i) => i.source === "override").length,
      0,
    );
  const hitsIn = (cat: CategoryId) => sectionsIn(cat).reduce((n, s) => n + matches(s).length, 0);
  const totalHits = searching ? sections.reduce((n, s) => n + matches(s).length, 0) : 0;
  const active = CATEGORIES.find((c) => c.id === category)!;

  const sectionProps = {
    valueOf,
    dirty: (item: SettingItem) => dirtySet.has(draftKey(item)),
    onChange: setValue,
    onResetOne: resetOne,
    models,
    catalog,
  };
  const askResetSection = (section: SettingsSection) =>
    setConfirm({
      title: `Reset “${section.title}” to defaults?`,
      body: "Values changed on this page in this section go back to their defaults (.env, else built-in).",
      reset: { target: section.target, section: section.id },
    });

  return (
    <div className="px-4 pt-6 pb-28 sm:px-6 lg:px-8">
      {/* ── Header ── */}
      <header className="flex flex-col gap-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="min-w-0">
            <p className="eyebrow mb-1">Configuration</p>
            <h1 className="text-2xl font-semibold tracking-tight text-foreground">
              <FeatureTitle route="/settings" gradient={false}>
                Settings
              </FeatureTitle>
            </h1>
            <p className="mt-1.5 max-w-2xl text-sm text-muted-foreground">
              <FeatureDescription route="/settings">
                Every model and configuration value of the backend, the Tool Service and this
                interface. Saved values take effect immediately wherever they are used.
              </FeatureDescription>
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => refresh.mutate()}
              disabled={refresh.isPending}
            >
              <RefreshCw className={cn("size-3.5", refresh.isPending && "animate-spin")} />
              Refresh from Mistral
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="text-red hover:text-red"
              disabled={reset.isPending}
              onClick={() =>
                setConfirm({
                  title: "Reset every setting to default?",
                  body: "All values changed on this page — backend, Tool Service and interface — go back to their defaults (.env, else built-in).",
                  reset: {},
                })
              }
            >
              <RotateCcw className="size-3.5" />
              Reset all
            </Button>
          </div>
        </div>

        <div className="flex flex-col gap-3 xl:flex-row xl:items-center">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-muted-foreground" />
            <input
              ref={searchRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === "Escape" && setQuery("")}
              placeholder="Search settings — name, key, description, impacted area or code location"
              className="h-11 w-full rounded-xl border border-border bg-background-elevated/70 pr-20 pl-10 text-sm text-foreground shadow-sm transition outline-none placeholder:text-muted-foreground focus:border-primary/50 focus:ring-2 focus:ring-primary/20"
            />
            {searching ? (
              <button
                type="button"
                onClick={() => setQuery("")}
                aria-label="Clear search"
                className="absolute top-1/2 right-3 -translate-y-1/2 rounded p-1 text-muted-foreground hover:text-foreground"
              >
                <X className="size-4" />
              </button>
            ) : (
              <kbd className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 rounded border border-border bg-secondary px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                /
              </kbd>
            )}
          </div>
          <StatusStrip
            data={data}
            customCount={items.filter((i) => i.source === "override").length}
          />
        </div>

        {data.restart_pending ? (
          <div className="flex items-start gap-2 rounded-xl border border-amber/30 bg-amber/10 px-4 py-2.5 text-xs text-amber">
            <AlertTriangle className="mt-px size-4 shrink-0" />
            Some saved values only take effect when their service restarts — they are marked
            “Restart pending”.
          </div>
        ) : null}
      </header>

      {/* ── Body ── */}
      <div className="mt-6 grid gap-6 lg:grid-cols-[236px_minmax(0,1fr)]">
        {/* Category rail */}
        <nav aria-label="Settings categories" className="lg:sticky lg:top-6 lg:self-start">
          <ul className="flex gap-1.5 overflow-x-auto pb-1 lg:flex-col lg:overflow-visible lg:pb-0">
            {CATEGORIES.map((c) => {
              const Icon = c.icon;
              const isActive = !searching && category === c.id;
              const count = searching ? hitsIn(c.id) : customIn(c.id);
              return (
                <li key={c.id} className="shrink-0">
                  <button
                    type="button"
                    onClick={() => {
                      setQuery("");
                      setCategory(c.id);
                    }}
                    className={cn(
                      "flex w-full items-center gap-2.5 rounded-lg border px-3 py-2 text-left text-sm transition",
                      isActive
                        ? "border-primary/40 bg-primary/10 text-foreground"
                        : "border-transparent text-muted-foreground hover:bg-accent hover:text-foreground",
                    )}
                  >
                    <Icon className={cn("size-4 shrink-0", isActive && "text-primary")} />
                    <span className="truncate">{c.title}</span>
                    {c.id !== "overview" && count > 0 ? (
                      <span
                        className={cn(
                          "ml-auto rounded-full px-1.5 font-mono text-[10px]",
                          searching ? "bg-blue/15 text-blue" : "bg-primary/15 text-primary",
                        )}
                        title={searching ? "Matches" : "Custom values"}
                      >
                        {count}
                      </span>
                    ) : null}
                  </button>
                  {isActive && c.id !== "overview" ? (
                    <ul className="mt-1 ml-5 hidden space-y-0.5 border-l border-border/60 pl-2 lg:block">
                      {sectionsIn(c.id).map((s) => (
                        <li key={`${s.target}-${s.id}`}>
                          <button
                            type="button"
                            onClick={() =>
                              document
                                .getElementById(`section-${s.target}-${s.id}`)
                                ?.scrollIntoView({ behavior: "smooth", block: "start" })
                            }
                            className="w-full truncate rounded px-2 py-1 text-left text-xs text-muted-foreground hover:text-foreground"
                          >
                            {s.title}
                          </button>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </nav>

        {/* Content */}
        <div className="min-w-0 space-y-6">
          {searching ? (
            <>
              <p className="text-sm text-muted-foreground">
                {totalHits} setting{totalHits === 1 ? "" : "s"} match{" "}
                <span className="text-foreground">“{q}”</span>
              </p>
              {totalHits === 0 ? (
                <div className="rounded-2xl border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
                  Nothing matches. Try a model name, a page (e.g. “Playground”) or a key such as
                  <span className="font-mono"> TOOL_SERVICE_URL</span>.
                </div>
              ) : null}
              {sections.map((s) => {
                const hits = matches(s);
                return hits.length ? (
                  <SectionCard
                    key={`${s.target}-${s.id}`}
                    section={s}
                    items={hits}
                    onResetSection={() => askResetSection(s)}
                    {...sectionProps}
                  />
                ) : null;
              })}
            </>
          ) : category === "overview" ? (
            <Overview
              data={data}
              items={items}
              models={models}
              report={report}
              refreshing={refresh.isPending}
              onRefresh={() => refresh.mutate()}
              onUseReplacement={useReplacement}
              valueOf={valueOf}
              onJump={(item) => {
                const cat = sections.find((s) => s.id === item.section && s.target === item.target)
                  ?.category as CategoryId | undefined;
                if (cat) setCategory(cat);
                setTimeout(
                  () =>
                    document
                      .getElementById(`setting-${draftKey(item)}`)
                      ?.scrollIntoView({ behavior: "smooth", block: "center" }),
                  50,
                );
              }}
            />
          ) : (
            <>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="flex items-center gap-2 text-lg font-semibold text-foreground">
                    <active.icon className="size-5 text-primary" />
                    {active.title}
                  </h2>
                  <p className="mt-0.5 text-sm text-muted-foreground">{active.blurb}</p>
                </div>
              </div>
              {category === "tool_service" && !data.tool_service.reachable ? (
                <div className="flex items-start gap-3 rounded-2xl border border-red/30 bg-red/5 p-4 text-sm">
                  <Server className="mt-0.5 size-4 shrink-0 text-red" />
                  <div>
                    <p className="font-medium text-foreground">Tool Service unreachable</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      Its model routes, synthesis and sandbox settings appear here once{" "}
                      <span className="font-mono">{data.tool_service.url}</span> answers. Start or
                      rebuild the container, then reload.
                    </p>
                    {data.tool_service.error ? (
                      <p className="mt-1.5 font-mono text-[11px] text-red">
                        {data.tool_service.error}
                      </p>
                    ) : null}
                  </div>
                </div>
              ) : null}
              {category === "process" ? (
                <ProcessTemplatesPanel initialScope={search.scope} />
              ) : null}
              {category === "safety" ? <ToolSafetyPanel /> : null}
              {category === "cleanup" ? <CleanupPanel /> : null}
              {category === "vault" ? (
                <VaultPanel focusId={search.secret} createName={search.create} />
              ) : null}
              {sectionsIn(category).map((s) => (
                <SectionCard
                  key={`${s.target}-${s.id}`}
                  section={s}
                  items={s.settings}
                  onResetSection={() => askResetSection(s)}
                  {...sectionProps}
                />
              ))}
            </>
          )}
        </div>
      </div>

      {/* ── Save bar ── */}
      {dirtyKeys.length ? (
        <div className="fixed right-4 bottom-4 left-4 z-40 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-primary/30 bg-background/95 px-4 py-3 shadow-lg backdrop-blur-xl sm:left-auto sm:min-w-[420px]">
          <div>
            <p className="text-sm font-medium text-foreground">
              {dirtyKeys.length} unsaved change{dirtyKeys.length > 1 ? "s" : ""}
            </p>
            <p className="text-[11px] text-muted-foreground">Applied immediately when saved.</p>
          </div>
          <div className="flex gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setDraft({})}
              disabled={save.isPending}
            >
              Discard
            </Button>
            <Button size="sm" onClick={() => save.mutate()} disabled={save.isPending}>
              {save.isPending ? (
                <>
                  <Loader2 className="size-3.5 animate-spin" />
                  <LivePercent />
                </>
              ) : (
                <Save className="size-3.5" />
              )}
              Save changes
            </Button>
          </div>
        </div>
      ) : null}

      <AlertDialog open={confirm != null} onOpenChange={(o) => !o && setConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{confirm?.title}</AlertDialogTitle>
            <AlertDialogDescription>{confirm?.body}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (confirm) reset.mutate(confirm.reset);
                setConfirm(null);
              }}
            >
              Reset to defaults
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/* ── Status strip ───────────────────────────────────────────────────── */

function StatusStrip({ data, customCount }: { data: SettingsPayload; customCount: number }) {
  const pill =
    "flex items-center gap-2 rounded-lg border border-border/60 bg-background-elevated/50 px-3 py-2 text-xs";
  return (
    <div className="flex flex-wrap gap-2">
      <div className={pill} title={data.catalog.error ?? data.catalog.source ?? ""}>
        <Database className="size-3.5 text-muted-foreground" />
        <span className={data.catalog.model_count ? "text-foreground" : "text-amber"}>
          {data.catalog.model_count ? `${data.catalog.model_count} models` : "Catalog not fetched"}
        </span>
        <span className="text-muted-foreground">· {formatWhen(data.catalog.fetched_at)}</span>
      </div>
      <div className={pill} title={data.tool_service.error ?? data.tool_service.url}>
        <span
          className={cn(
            "size-2 rounded-full",
            data.tool_service.reachable ? "bg-emerald" : "bg-red",
          )}
        />
        <span className="text-foreground">Tool Service</span>
        <span className="text-muted-foreground">
          {data.tool_service.reachable ? "online" : "offline"}
        </span>
      </div>
      <div className={pill}>
        <SlidersHorizontal className="size-3.5 text-muted-foreground" />
        <span className="text-foreground">{customCount}</span>
        <span className="text-muted-foreground">custom</span>
      </div>
      {data.restart_pending ? (
        <div className={cn(pill, "border-amber/30 text-amber")}>
          <RotateCw className="size-3.5" /> Restart pending
        </div>
      ) : null}
    </div>
  );
}

/* ── Overview ───────────────────────────────────────────────────────── */

function Overview({
  data,
  items,
  models,
  report,
  refreshing,
  onRefresh,
  onUseReplacement,
  valueOf,
  onJump,
}: {
  data: SettingsPayload;
  items: SettingItem[];
  models: CatalogModel[];
  report: RefreshReport | null;
  refreshing: boolean;
  onRefresh: () => void;
  onUseReplacement: (issue: CatalogIssue) => void;
  valueOf: (item: SettingItem) => SettingValue;
  onJump: (item: SettingItem) => void;
}) {
  const modelItems = items.filter((i) => i.type === "model" || i.type === "model_list");
  const problems = modelItems.filter((i) =>
    Object.values(i.model_status ?? {}).some((s) => s.status !== "ok" && s.status !== "unchecked"),
  );
  return (
    <div className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi
          icon={Cpu}
          label="Model settings"
          value={modelItems.length}
          hint="across both services"
        />
        <Kpi
          icon={AlertTriangle}
          label="Need attention"
          value={problems.length}
          hint={problems.length ? "unknown, deprecated or unsuited" : "all models available"}
          tone={problems.length ? "amber" : "emerald"}
        />
        <Kpi
          icon={Database}
          label="Mistral models"
          value={data.catalog.model_count || "—"}
          hint={`fetched ${formatWhen(data.catalog.fetched_at)}`}
        />
        <Kpi
          icon={RefreshCw}
          label="Auto refresh"
          value={data.catalog.refresh_hours ? `${data.catalog.refresh_hours} h` : "Off"}
          hint="Model catalog sync"
        />
      </div>

      <Panel
        icon={Database}
        title="Mistral model catalog"
        description={
          data.catalog.fetched_at
            ? `Live list from Mistral's /v1/models — fetched ${formatWhen(data.catalog.fetched_at)}.`
            : "Not fetched yet — press Refresh."
        }
        actions={
          <Button variant="outline" size="sm" onClick={onRefresh} disabled={refreshing}>
            {refreshing ? (
              <>
                <Loader2 className="size-3.5 animate-spin" />
                <LivePercent />
              </>
            ) : (
              <RefreshCw className="size-3.5" />
            )}
            Refresh
          </Button>
        }
      >
        <div className="space-y-4">
          {data.catalog.error ? (
            <p className="rounded-lg border border-red/30 bg-red/10 px-3 py-2 text-xs text-red">
              Last refresh failed ({formatWhen(data.catalog.error_at)}): {data.catalog.error}
            </p>
          ) : null}
          {report ? (
            <RefreshReportCard report={report} onUseReplacement={onUseReplacement} />
          ) : null}
          <ModelCatalogBrowser models={models} />
        </div>
      </Panel>

      <Panel
        icon={MapPin}
        title="Model usage map"
        description="Every model setting on both services, its current model, and where in the product and code it is used. Click a setting to edit it."
      >
        <ModelUsageMap items={modelItems} valueOf={valueOf} onJump={onJump} />
      </Panel>
    </div>
  );
}

function Kpi({
  icon: Icon,
  label,
  value,
  hint,
  tone,
}: {
  icon: LucideIcon;
  label: string;
  value: React.ReactNode;
  hint: string;
  tone?: "amber" | "emerald";
}) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-border/60 bg-background-elevated/50 p-4">
      <div className="grid size-9 place-items-center rounded-lg border border-border/60 bg-background text-muted-foreground">
        <Icon className="size-4" />
      </div>
      <div className="min-w-0">
        <p className="text-[10px] tracking-wider text-muted-foreground uppercase">{label}</p>
        <p
          className={cn(
            "text-lg leading-tight font-semibold",
            tone === "amber"
              ? "text-amber"
              : tone === "emerald"
                ? "text-emerald"
                : "text-foreground",
          )}
        >
          {value}
        </p>
        <p className="truncate text-[11px] text-muted-foreground">{hint}</p>
      </div>
    </div>
  );
}

function Panel({
  icon: Icon,
  title,
  description,
  actions,
  children,
}: {
  icon: LucideIcon;
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section
      className="rounded-2xl border border-border/60 backdrop-blur-md"
      style={{ background: "var(--surface)" }}
    >
      <header className="flex flex-wrap items-start gap-3 border-b border-border/40 px-5 py-4">
        <div className="grid size-9 shrink-0 place-items-center rounded-lg border border-border/60 bg-background-elevated text-muted-foreground">
          <Icon className="size-4" />
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold text-foreground">{title}</h3>
          {description ? (
            <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
          ) : null}
        </div>
        {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
      </header>
      <div className="p-5">{children}</div>
    </section>
  );
}

/* ── One section ────────────────────────────────────────────────────── */

function SectionCard({
  section,
  items,
  valueOf,
  dirty,
  onChange,
  onResetOne,
  onResetSection,
  models,
  catalog,
}: {
  section: SettingsSection;
  items: SettingItem[];
  valueOf: (item: SettingItem) => SettingValue;
  dirty: (item: SettingItem) => boolean;
  onChange: (item: SettingItem, v: SettingValue) => void;
  onResetOne: (item: SettingItem) => void;
  onResetSection: () => void;
  models: CatalogModel[];
  catalog: ReturnType<typeof indexCatalog>;
}) {
  const Icon = SECTION_ICONS[section.icon] ?? SlidersHorizontal;
  const plain = items.filter((s) => !s.group);
  const groups = new Map<string, SettingItem[]>();
  for (const s of items) if (s.group) groups.set(s.group, [...(groups.get(s.group) ?? []), s]);
  const custom = section.settings.filter((s) => s.source === "override").length;

  /** A route asking for reasoning on a model that has none. */
  const effortHint = (rows: SettingItem[], row: SettingItem): string | null => {
    if (!row.key.endsWith("_EFFORT") || valueOf(row) !== "high") return null;
    const modelRow = rows.find((r) => r.key.endsWith("_MODEL"));
    const card = modelRow ? catalog.get(String(valueOf(modelRow))) : undefined;
    return card && !card.capabilities["reasoning"]
      ? `${card.id} has no reasoning capability — the call is retried without it.`
      : null;
  };

  const tile = (item: SettingItem, compact = false, hint: string | null = null) => (
    <SettingTile
      key={item.key}
      anchorId={`setting-${draftKey(item)}`}
      item={item}
      value={valueOf(item)}
      dirty={dirty(item)}
      onChange={(v) => onChange(item, v)}
      onReset={() => onResetOne(item)}
      models={models}
      catalog={catalog}
      compact={compact}
      hint={hint}
    />
  );

  return (
    <section
      id={`section-${section.target}-${section.id}`}
      className="scroll-mt-6 rounded-2xl border border-border/60 backdrop-blur-md"
      style={{ background: "var(--surface)" }}
    >
      <header className="flex flex-wrap items-start gap-3 border-b border-border/40 px-5 py-4">
        <div className="grid size-9 shrink-0 place-items-center rounded-lg border border-border/60 bg-background-elevated text-muted-foreground">
          <Icon className="size-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-semibold text-foreground">{section.title}</h3>
            <span
              className={cn(
                "rounded border px-1.5 py-px font-mono text-[9px] font-semibold uppercase",
                section.category === "frontend"
                  ? "border-purple/30 bg-purple/10 text-purple"
                  : section.target === "tool_service"
                    ? "border-blue/30 bg-blue/10 text-blue"
                    : "border-border text-muted-foreground",
              )}
            >
              {section.category === "frontend"
                ? "Interface"
                : section.target === "tool_service"
                  ? "Tool Service"
                  : "Backend"}
            </span>
            {custom ? (
              <span className="rounded-full bg-primary/15 px-1.5 font-mono text-[10px] text-primary">
                {custom} custom
              </span>
            ) : null}
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground">{section.description}</p>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={onResetSection}
          disabled={custom === 0}
          title={custom ? `${custom} custom value(s)` : "Nothing to reset"}
        >
          <RotateCcw className="size-3.5" />
          Reset section
        </Button>
      </header>

      <div className="space-y-4 p-4 sm:p-5">
        {plain.length ? (
          <div className="grid gap-3 xl:grid-cols-2">{plain.map((item) => tile(item))}</div>
        ) : null}
        {groups.size ? (
          <div className="grid gap-3 2xl:grid-cols-2">
            {[...groups.entries()].map(([group, rows]) => {
              const lead = rows.find((r) => r.key.endsWith("_MODEL")) ?? rows[0]!;
              const custom = rows.filter((r) => r.source === "override").length;
              return (
                <div
                  key={group}
                  className="rounded-xl border border-border/50 bg-background-elevated/40 p-4"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <Sparkles className="size-3.5 text-primary" />
                    <p className="text-sm font-semibold text-foreground">{group}</p>
                    {custom ? (
                      <span className="rounded-full bg-primary/15 px-1.5 font-mono text-[10px] text-primary">
                        {custom} custom
                      </span>
                    ) : null}
                  </div>
                  {lead.description && lead.key.endsWith("_MODEL") ? (
                    <p className="mt-1 text-xs text-muted-foreground">{lead.description}</p>
                  ) : null}
                  {lead.impact.length ? (
                    <div className="mt-2 flex flex-wrap items-center gap-1">
                      <span className="mr-0.5 text-[10px] tracking-wider text-muted-foreground uppercase">
                        Impacts
                      </span>
                      {lead.impact.map((a) => (
                        <span
                          key={a}
                          className="rounded border border-border/70 bg-secondary/60 px-1.5 py-0.5 text-[10.5px] text-foreground/85"
                        >
                          {a}
                        </span>
                      ))}
                    </div>
                  ) : null}
                  <div className="mt-3 grid gap-x-4 gap-y-4 border-t border-border/40 pt-3 sm:grid-cols-2">
                    {rows.map((item) =>
                      tile(
                        {
                          ...item,
                          description: item.key.endsWith("_MODEL") ? "" : item.description,
                        },
                        true,
                        effortHint(rows, item),
                      ),
                    )}
                  </div>
                  {lead.used_in.length ? (
                    <p className="mt-3 font-mono text-[10px] text-muted-foreground">
                      {lead.used_in[0]}
                    </p>
                  ) : null}
                </div>
              );
            })}
          </div>
        ) : null}
      </div>
    </section>
  );
}
