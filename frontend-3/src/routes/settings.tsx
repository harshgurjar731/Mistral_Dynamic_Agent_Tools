import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Activity,
  AlertTriangle,
  Box,
  Cpu,
  Database,
  Gauge,
  GitBranch,
  Loader2,
  MapPin,
  Network,
  Plug,
  RefreshCw,
  RotateCcw,
  RotateCw,
  Route as RouteIcon,
  Save,
  Server,
  ShieldCheck,
  SlidersHorizontal,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import { toast } from "sonner";
import { errorMessage, QK, settingsApi } from "@/api";
import type {
  CatalogIssue,
  RefreshReport,
  SettingItem,
  SettingsChanges,
  SettingsSection,
  SettingTarget,
  SettingValue,
} from "@/api/settings";
import { PageHeader } from "@/components/shared/PageHeader";
import { SectionCard, StatCard } from "@/components/shared/SectionCard";
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
import { SettingRow } from "@/components/settings/SettingControls";
import {
  ModelCatalogBrowser,
  ModelUsageMap,
  RefreshReportCard,
} from "@/components/settings/ModelPanels";
import {
  draftKey,
  formatWhen,
  indexCatalog,
  sameValue,
  supports,
} from "@/components/settings/settingsModel";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/settings")({
  head: () => ({
    meta: [
      { title: "Settings — Agentic AI Design Patterns" },
      {
        name: "description",
        content: "Every model and configuration value of the platform and the Tool Service.",
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
};

type ResetBody = { target?: SettingTarget; section?: string; keys?: string[] };

const CAPABILITY_LISTS = ["chat", "function_calling", "moderation"] as const;

function SettingsPage() {
  const qc = useQueryClient();
  const settingsQ = useQuery({ queryKey: QK.settings(), queryFn: settingsApi.get });
  const catalogQ = useQuery({ queryKey: QK.modelCatalog(), queryFn: settingsApi.catalog });

  const [draft, setDraft] = useState<Record<string, SettingValue>>({});
  const [report, setReport] = useState<RefreshReport | null>(null);
  const [confirm, setConfirm] = useState<{ title: string; body: string; reset: ResetBody } | null>(
    null,
  );

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
          ? "Some changes take effect after a restart."
          : "Applied immediately everywhere they are used.",
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
          ? `${issues} configured model${issues > 1 ? "s need" : " needs"} attention.`
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

  const jumpTo = (id: string) =>
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });

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
  const modelItems = items.filter((i) => i.type === "model" || i.type === "model_list");
  const customCount = items.filter((i) => i.source === "override").length;
  const nav = [
    { id: "model-usage", title: "Model usage map" },
    { id: "model-catalog", title: "Mistral model catalog" },
    ...sections.map((s) => ({ id: `section-${s.target}-${s.id}`, title: s.title })),
    ...(data.tool_service.reachable ? [] : [{ id: "tool-service-offline", title: "Tool Service" }]),
  ];

  return (
    <div className="px-4 py-6 pb-28 sm:px-6 sm:py-8">
      <PageHeader
        eyebrow="Configuration"
        title="Settings"
        description="Every model and configuration value of the backend and the Tool Service, in one place. Changes apply wherever the value is read — each setting lists those places."
        actions={
          <>
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
                  body: "All values changed on this page — backend and Tool Service — go back to their defaults (.env, else built-in).",
                  reset: {},
                })
              }
            >
              <RotateCcw className="size-3.5" />
              Reset all to defaults
            </Button>
          </>
        }
      />

      <div className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          icon={Database}
          label="Model catalog"
          value={data.catalog.model_count ? `${data.catalog.model_count} models` : "Not fetched"}
          hint={
            data.catalog.error
              ? `Last refresh failed: ${data.catalog.error}`
              : `Fetched ${formatWhen(data.catalog.fetched_at)}`
          }
          valueClassName={data.catalog.model_count ? undefined : "text-amber"}
        />
        <StatCard
          icon={Server}
          label="Tool Service"
          value={data.tool_service.reachable ? "Reachable" : "Unreachable"}
          hint={data.tool_service.url}
          valueClassName={data.tool_service.reachable ? "text-emerald" : "text-red"}
        />
        <StatCard
          icon={SlidersHorizontal}
          label="Custom values"
          value={customCount}
          hint={`${items.length} settings in total`}
        />
        <StatCard
          icon={RotateCw}
          label="Restart"
          value={data.restart_pending ? "Pending" : "Not needed"}
          hint={
            data.restart_pending ? "Some saved values wait for a restart" : "All values are live"
          }
          valueClassName={data.restart_pending ? "text-amber" : undefined}
        />
      </div>

      {data.restart_pending ? (
        <div className="mt-4 flex items-start gap-2 rounded-xl border border-amber/30 bg-amber/10 px-4 py-3 text-xs text-amber">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          Some saved values only take effect when their service restarts — they are marked “Restart
          pending” below.
        </div>
      ) : null}

      {/* Model id suggestions for every model input, by required capability. */}
      {CAPABILITY_LISTS.map((cap) => (
        <datalist key={cap} id={`models-${cap}`}>
          {[...catalog.entries()]
            .filter(([, card]) => supports(card, cap) && !card.deprecation)
            .map(([id]) => id)
            .sort()
            .map((id) => (
              <option key={id} value={id} />
            ))}
        </datalist>
      ))}

      <div className="mt-6 grid gap-6 lg:grid-cols-[210px_minmax(0,1fr)]">
        <nav className="hidden lg:block">
          <ul className="sticky top-6 space-y-0.5 text-xs">
            {nav.map((n) => (
              <li key={n.id}>
                <button
                  type="button"
                  onClick={() => jumpTo(n.id)}
                  className="w-full truncate rounded-md px-2.5 py-1.5 text-left text-muted-foreground hover:bg-accent hover:text-foreground"
                >
                  {n.title}
                </button>
              </li>
            ))}
          </ul>
        </nav>

        <div className="min-w-0 space-y-6">
          <div id="model-usage" className="scroll-mt-6">
            <SectionCard
              icon={MapPin}
              title="Model usage map"
              description="Every model setting on both services, what it is set to, and where in the code it is used."
            >
              <ModelUsageMap
                items={modelItems}
                valueOf={valueOf}
                onJump={(item) => jumpTo(`setting-${draftKey(item)}`)}
              />
            </SectionCard>
          </div>

          <div id="model-catalog" className="scroll-mt-6">
            <SectionCard
              icon={Database}
              title="Mistral model catalog"
              description={
                data.catalog.fetched_at
                  ? `Live list from ${data.catalog.source ?? "Mistral"} — fetched ${formatWhen(data.catalog.fetched_at)}. Refreshes automatically every ${data.catalog.refresh_hours || "—"} h.`
                  : "Not fetched yet — press Refresh from Mistral."
              }
              actions={
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => refresh.mutate()}
                  disabled={refresh.isPending}
                >
                  {refresh.isPending ? (
                    <Loader2 className="size-3.5 animate-spin" />
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
                  <RefreshReportCard report={report} onUseReplacement={useReplacement} />
                ) : null}
                <ModelCatalogBrowser models={models} />
              </div>
            </SectionCard>
          </div>

          {sections.map((section) => (
            <SettingsSectionCard
              key={`${section.target}-${section.id}`}
              section={section}
              valueOf={valueOf}
              dirty={(item) => dirtyKeys.includes(draftKey(item))}
              onChange={setValue}
              onResetOne={(item) => {
                const k = draftKey(item);
                if (item.source !== "override") {
                  setDraft((d) => {
                    const next = { ...d };
                    delete next[k];
                    return next;
                  });
                  return;
                }
                reset.mutate({ target: item.target, keys: [item.key] });
              }}
              onResetSection={() =>
                setConfirm({
                  title: `Reset “${section.title}” to defaults?`,
                  body: "Values changed on this page in this section go back to their defaults (.env, else built-in).",
                  reset: { target: section.target, section: section.id },
                })
              }
              catalog={catalog}
            />
          ))}

          {!data.tool_service.reachable ? (
            <div id="tool-service-offline" className="scroll-mt-6">
              <SectionCard
                icon={Server}
                title="Tool Service"
                description="Model routes, synthesis and sandbox settings of the Tool Service."
              >
                <p className="text-sm text-muted-foreground">
                  The Tool Service at <span className="font-mono">{data.tool_service.url}</span> is
                  not reachable, so its settings can’t be shown. Start it and reload this page.
                </p>
                {data.tool_service.error ? (
                  <p className="mt-2 font-mono text-[11px] text-red">{data.tool_service.error}</p>
                ) : null}
              </SectionCard>
            </div>
          ) : null}
        </div>
      </div>

      {dirtyKeys.length ? (
        <div className="fixed right-4 bottom-4 left-4 z-40 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-primary/30 bg-background/95 px-4 py-3 shadow-lg backdrop-blur-xl sm:left-auto sm:min-w-[380px]">
          <p className="text-sm text-foreground">
            {dirtyKeys.length} unsaved change{dirtyKeys.length > 1 ? "s" : ""}
          </p>
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
                <Loader2 className="size-3.5 animate-spin" />
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

function SettingsSectionCard({
  section,
  valueOf,
  dirty,
  onChange,
  onResetOne,
  onResetSection,
  catalog,
}: {
  section: SettingsSection;
  valueOf: (item: SettingItem) => SettingValue;
  dirty: (item: SettingItem) => boolean;
  onChange: (item: SettingItem, v: SettingValue) => void;
  onResetOne: (item: SettingItem) => void;
  onResetSection: () => void;
  catalog: ReturnType<typeof indexCatalog>;
}) {
  const Icon = SECTION_ICONS[section.icon] ?? SlidersHorizontal;
  const plain = section.settings.filter((s) => !s.group);
  const groups = new Map<string, SettingItem[]>();
  for (const s of section.settings) {
    if (s.group) groups.set(s.group, [...(groups.get(s.group) ?? []), s]);
  }
  const custom = section.settings.filter((s) => s.source === "override").length;

  /** A route asking for reasoning on a model that has none. */
  const effortHint = (rows: SettingItem[], row: SettingItem): string | null => {
    if (!row.key.endsWith("_EFFORT") || valueOf(row) !== "high") return null;
    const modelRow = rows.find((r) => r.key.endsWith("_MODEL"));
    const card = modelRow ? catalog.get(String(valueOf(modelRow))) : undefined;
    return card && !card.capabilities["reasoning"]
      ? `${card.id} has no reasoning capability — the client retries without it.`
      : null;
  };

  return (
    <div id={`section-${section.target}-${section.id}`} className="scroll-mt-6">
      <SectionCard
        icon={Icon}
        title={
          <span className="inline-flex items-center gap-2">
            {section.title}
            <span
              className={cn(
                "rounded border px-1.5 py-0.5 font-mono text-[9px] font-semibold uppercase",
                section.target === "tool_service"
                  ? "border-blue/30 bg-blue/10 text-blue"
                  : "border-border text-muted-foreground",
              )}
            >
              {section.target === "tool_service" ? "Tool Service" : "Backend"}
            </span>
          </span>
        }
        description={section.description}
        actions={
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
        }
        bodyClassName="py-1"
      >
        {plain.length ? (
          <div className="divide-y divide-border/40">
            {plain.map((item) => (
              <div key={item.key} id={`setting-${draftKey(item)}`} className="scroll-mt-24">
                <SettingRow
                  item={item}
                  value={valueOf(item)}
                  dirty={dirty(item)}
                  onChange={(v) => onChange(item, v)}
                  onReset={() => onResetOne(item)}
                  catalog={catalog}
                />
              </div>
            ))}
          </div>
        ) : null}
        {groups.size ? (
          <div
            className={cn(
              "grid gap-3 py-4 xl:grid-cols-2",
              plain.length && "border-t border-border/40",
            )}
          >
            {[...groups.entries()].map(([group, rows]) => (
              <div
                key={group}
                className="rounded-xl border border-border/60 bg-background-elevated/40 p-4"
              >
                <p className="text-sm font-semibold text-foreground">{group}</p>
                {rows[0]?.used_in.length ? (
                  <p className="mt-0.5 font-mono text-[10.5px] text-muted-foreground">
                    {rows[0].used_in[0]}
                  </p>
                ) : null}
                <div className="mt-3 grid gap-4 sm:grid-cols-2">
                  {rows.map((item) => (
                    <div key={item.key} id={`setting-${draftKey(item)}`} className="scroll-mt-24">
                      <SettingRow
                        item={item}
                        value={valueOf(item)}
                        dirty={dirty(item)}
                        onChange={(v) => onChange(item, v)}
                        onReset={() => onResetOne(item)}
                        catalog={catalog}
                        compact
                        hint={effortHint(rows, item)}
                      />
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        ) : null}
      </SectionCard>
    </div>
  );
}
