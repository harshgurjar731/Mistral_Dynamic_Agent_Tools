import { useEffect, useMemo, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Activity,
  ArrowLeft,
  Bot,
  GitBranch,
  Loader2,
  RotateCcw,
  Save,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { errorMessage, QK, rulesApi } from "@/api";
import { RuleParamsForm } from "@/components/rules/RuleParamsForm";
import {
  ENFORCEMENT_META,
  OutcomePill,
  Pill,
  RuleIcon,
  renderSummary,
} from "@/components/rules/RulePills";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { DetailSkeleton } from "@/components/ui/Skeletons";
import { Switch } from "@/components/ui/switch";
import { formatRelative } from "@/lib/status";
import { cn } from "@/lib/utils";
import type { Rule, RuleApplies, RuleEnforcement, RuleType } from "@/types";
import {
  AppliesPicker,
  CategoryBadge,
  CategoryPicker,
} from "@/components/rules/RuleScopingControls";
import { appliesOf, appliesToFields, useRuleCategories } from "@/components/rules/ruleScoping";

export const Route = createFileRoute("/rules/$id")({
  head: () => ({
    meta: [
      { title: "Rule Detail — Agentic AI Design Patterns" },
      {
        name: "description",
        content: "What one rule checks, how strict it is, and what it caught.",
      },
      { property: "og:title", content: "Rule Detail — Agentic AI Design Patterns" },
      {
        property: "og:description",
        content: "What one rule checks, how strict it is, and what it caught.",
      },
    ],
  }),
  component: RuleDetailPage,
});

function RuleDetailPage() {
  const { id } = Route.useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();

  const rulesQuery = useQuery({ queryKey: QK.rules(), queryFn: () => rulesApi.list() });
  const typesQuery = useQuery({ queryKey: QK.ruleTypes(), queryFn: () => rulesApi.types() });

  const rule = rulesQuery.data?.rules.find((r) => r.id === id) ?? null;
  const type = typesQuery.data?.types.find((t) => t.key === rule?.type) ?? null;

  if (rulesQuery.isError) {
    return (
      <div className="px-6 py-8">
        <ErrorState error={rulesQuery.error} onRetry={() => rulesQuery.refetch()} />
      </div>
    );
  }
  if (rulesQuery.isLoading || typesQuery.isLoading) {
    return (
      <div className="px-6 py-8">
        <DetailSkeleton />
      </div>
    );
  }
  if (!rule) {
    return (
      <div className="px-6 py-8">
        <ErrorState error="Rule not found" />
      </div>
    );
  }

  return (
    <RuleDetail
      key={rule.id}
      rule={rule}
      type={type}
      onDeleted={() => {
        void qc.invalidateQueries({ queryKey: ["rules"] });
        void navigate({ to: "/rules" });
      }}
    />
  );
}

function RuleDetail({
  rule,
  type,
  onDeleted,
}: {
  rule: Rule;
  type: RuleType | null;
  onDeleted: () => void;
}) {
  const qc = useQueryClient();
  const isAgent = rule.scope === "agent";
  const scopeWord = isAgent ? "agent" : "workflow";

  const [name, setName] = useState(rule.name);
  const [description, setDescription] = useState(rule.description ?? "");
  const [params, setParams] = useState<Record<string, unknown>>(rule.params ?? {});
  const [enforcement, setEnforcement] = useState<RuleEnforcement>(rule.enforcement);
  const [applies, setApplies] = useState<RuleApplies>(appliesOf(rule));
  const [targets, setTargets] = useState<string[]>(rule.targets ?? []);
  const [category, setCategory] = useState(rule.category);
  const { byId: categoriesById } = useRuleCategories();

  // Re-seed the form whenever the saved rule changes underneath us.
  useEffect(() => {
    setName(rule.name);
    setDescription(rule.description ?? "");
    setParams(rule.params ?? {});
    setEnforcement(rule.enforcement);
    setApplies(appliesOf(rule));
    setTargets(rule.targets ?? []);
    setCategory(rule.category);
  }, [rule]);

  const dirty =
    name !== rule.name ||
    description !== (rule.description ?? "") ||
    enforcement !== rule.enforcement ||
    applies !== appliesOf(rule) ||
    category !== rule.category ||
    (applies === "targeted" && JSON.stringify(targets) !== JSON.stringify(rule.targets ?? [])) ||
    JSON.stringify(params) !== JSON.stringify(rule.params ?? {});

  const invalidate = () => qc.invalidateQueries({ queryKey: ["rules"] });

  const save = useMutation({
    mutationFn: () =>
      rulesApi.update(rule.id, {
        name: name.trim(),
        description: description.trim(),
        params,
        enforcement,
        category,
        ...appliesToFields(applies, targets),
      }),
    onSuccess: () => {
      toast.success("Rule saved");
      invalidate();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const toggle = useMutation({
    mutationFn: (enabled: boolean) => rulesApi.update(rule.id, { enabled }),
    onSuccess: (r) => {
      toast.success(`${r.name} ${r.enabled ? "switched on" : "switched off"}`);
      invalidate();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const remove = useMutation({
    mutationFn: () => rulesApi.remove(rule.id),
    onSuccess: () => {
      toast.success("Rule deleted");
      onDeleted();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const restore = useMutation({
    mutationFn: () => rulesApi.restore(rule.id),
    onSuccess: () => {
      toast.success("Restored to the recommended settings");
      invalidate();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const optionLabels = useMemo(
    () =>
      Object.fromEntries(
        (type?.params ?? []).map((p) => [
          p.key,
          Object.fromEntries(p.options.map((o) => [o.value, o.label])),
        ]),
      ),
    [type],
  );

  const summary = type ? renderSummary(type.summary, params, optionLabels) : rule.summary;
  const savedApplies = appliesOf(rule);
  const targetCount = rule.targets?.length ?? 0;
  const checkpoints = type?.checkpoint_labels ?? rule.checkpoints;

  return (
    <div className="px-6 py-8">
      {/* ── Header ── */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 items-start gap-4">
          <Link
            to="/rules"
            aria-label="Back to rules"
            className="mt-1 grid size-9 shrink-0 place-items-center rounded-xl border border-border/60 bg-surface/30 text-muted-foreground transition hover:border-primary/30 hover:text-foreground"
          >
            <ArrowLeft className="size-4" />
          </Link>
          <div className="flex min-w-0 items-center gap-3">
            <div
              className={cn(
                "grid size-11 shrink-0 place-items-center rounded-xl border",
                isAgent
                  ? "border-primary/25 bg-primary/10 text-primary"
                  : "border-blue/25 bg-blue/10 text-blue",
              )}
            >
              <RuleIcon name={rule.icon} className="size-5" />
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="truncate text-2xl font-semibold tracking-tight text-foreground">
                  {rule.name}
                </h1>
                <Pill tone={isAgent ? "primary" : "blue"}>{scopeWord} rule</Pill>
                {rule.source === "recommended" ? <Pill tone="muted">Recommended</Pill> : null}
              </div>
              <p className="mt-0.5 text-sm text-muted-foreground">
                {rule.description || type?.description || "No description provided"}
              </p>
            </div>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <label className="flex items-center gap-2 rounded-xl border border-border/60 bg-surface/30 px-3 py-2 text-xs text-muted-foreground">
            <Switch
              checked={rule.enabled}
              disabled={toggle.isPending}
              onCheckedChange={(next) => toggle.mutate(next)}
              aria-label={rule.enabled ? "Switch off this rule" : "Switch on this rule"}
            />
            {rule.enabled ? "On" : "Off"}
          </label>
          {rule.source === "recommended" ? (
            <Button
              size="sm"
              variant="outline"
              onClick={() => restore.mutate()}
              disabled={restore.isPending}
            >
              <RotateCcw className="size-3.5" /> Restore default
            </Button>
          ) : (
            <Button
              size="sm"
              variant="outline"
              className="text-red hover:text-red"
              onClick={() => window.confirm(`Delete the rule "${rule.name}"?`) && remove.mutate()}
              disabled={remove.isPending}
            >
              <Trash2 className="size-3.5" /> Delete
            </Button>
          )}
          <Button
            size="sm"
            onClick={() => save.mutate()}
            disabled={
              !dirty ||
              save.isPending ||
              !name.trim() ||
              (applies === "targeted" && targets.length === 0)
            }
          >
            {save.isPending ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Save className="size-3.5" />
            )}
            Save
          </Button>
        </div>
      </div>

      {/* ── Body ── */}
      <div className="mt-6 grid gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          <Panel title="What this rule does">
            <p className="text-sm text-foreground">{summary}</p>
            {checkpoints.length ? (
              <p className="mt-2 text-[11px] text-muted-foreground">
                Checked {checkpoints.map((l) => l.toLowerCase()).join(" · ")}.
              </p>
            ) : null}
          </Panel>

          <Panel title="Basics">
            <div className="space-y-3">
              <div>
                <label className="eyebrow mb-1.5 block">Name</label>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                />
              </div>
              <div>
                <label className="eyebrow mb-1.5 block">Why this rule exists (optional)</label>
                <input
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder={type?.description ?? ""}
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                />
                <p className="mt-1 text-[11px] text-muted-foreground">
                  The orchestrator reads this when deciding where the rule is relevant.
                </p>
              </div>
            </div>
          </Panel>

          {type && type.params.length ? (
            <Panel title="Settings">
              <RuleParamsForm fields={type.params} value={params} onChange={setParams} />
            </Panel>
          ) : null}

          <Panel title="When it's violated">
            <div className="grid gap-2 sm:grid-cols-3">
              {(type?.enforcements ?? [rule.enforcement]).map((e) => {
                const meta = ENFORCEMENT_META[e];
                const on = enforcement === e;
                return (
                  <button
                    key={e}
                    type="button"
                    onClick={() => setEnforcement(e)}
                    className={cn(
                      "rounded-lg border px-3 py-2.5 text-left transition",
                      on
                        ? "border-primary/40 bg-primary/8"
                        : "border-border hover:border-border-strong",
                    )}
                  >
                    <span className="flex items-center gap-2 text-xs font-semibold text-foreground">
                      <span
                        className={cn(
                          "size-2 rounded-full",
                          e === "block" ? "bg-red" : e === "warn" ? "bg-amber" : "bg-cyan",
                        )}
                      />
                      {meta.label}
                    </span>
                    <span className="mt-0.5 block text-[11px] text-muted-foreground">
                      {type?.enforcement_help[e] ?? meta.hint}
                    </span>
                  </button>
                );
              })}
            </div>
          </Panel>

          <Panel title="Apply to">
            <AppliesPicker
              scope={rule.scope}
              applies={applies}
              targets={targets}
              onlyAlways={type?.key === "reviewed_tools_only"}
              onChange={(next) => {
                setApplies(next.applies);
                setTargets(next.targets);
              }}
            />
          </Panel>

          <Panel title="Category">
            <CategoryPicker value={category} onChange={setCategory} />
          </Panel>
        </div>

        <div className="space-y-5">
          <Panel title="Where it applies">
            <dl className="space-y-2.5 text-xs">
              <Row label="Kind">
                <CategoryBadge
                  category={categoriesById[rule.category]}
                  fallbackId={rule.category}
                />
              </Row>
              <Row label="Covers">
                <span className="text-foreground">
                  {savedApplies === "always"
                    ? `All ${scopeWord}s`
                    : savedApplies === "targeted"
                      ? `${targetCount} chosen ${scopeWord}${targetCount === 1 ? "" : "s"}`
                      : isAgent
                        ? `${rule.usage?.agents ?? 0} agent${(rule.usage?.agents ?? 0) === 1 ? "" : "s"} (picked by AI or by hand)`
                        : "Workflows it was added to"}
                </span>
              </Row>
              <Row label="Added by">
                <span className="text-foreground">
                  {rule.source === "recommended" ? "Recommended" : "You"}
                </span>
              </Row>
              {rule.updated_at ? (
                <Row label="Updated">
                  <span className="tabular-nums text-foreground">
                    {formatRelative(rule.updated_at)}
                  </span>
                </Row>
              ) : null}
            </dl>
          </Panel>

          <RuleEvents ruleId={rule.id} />
        </div>
      </div>
    </div>
  );
}

function RuleEvents({ ruleId }: { ruleId: string }) {
  const params = { rule_id: ruleId, include_passed: true, limit: 50 };
  const query = useQuery({
    queryKey: QK.ruleEvents(params),
    queryFn: () => rulesApi.events(params),
    refetchInterval: 15_000,
  });
  const events = query.data?.events ?? [];

  return (
    <Panel title="Recent activity">
      {query.isError ? (
        <ErrorState error={query.error} onRetry={() => query.refetch()} />
      ) : query.isLoading ? (
        <div className="flex items-center gap-2 py-4 text-xs text-muted-foreground">
          <Loader2 className="size-3.5 animate-spin" /> Loading…
        </div>
      ) : !events.length ? (
        <EmptyState
          icon={<Activity className="size-5" />}
          title="Nothing yet"
          description="Results appear here as this rule is checked."
          className="px-4 py-8"
        />
      ) : (
        <ul className="divide-y divide-border/40">
          {events.map((e) => (
            <li key={e.id} className="flex items-start gap-2.5 py-2.5 first:pt-0 last:pb-0">
              <OutcomePill outcome={e.outcome} />
              <div className="min-w-0 flex-1">
                <p className="text-xs text-foreground">{e.message}</p>
                <div className="mt-1 flex flex-wrap items-center gap-2 text-[10px] text-muted-foreground">
                  {e.scope === "agent" ? (
                    <Link
                      to="/agents/$id"
                      params={{ id: e.subject_id }}
                      className="inline-flex items-center gap-1 text-primary hover:underline"
                    >
                      <Bot className="size-2.5" /> {e.subject_id.slice(0, 14)}
                    </Link>
                  ) : (
                    <Link
                      to="/workflows/$workflowName"
                      params={{ workflowName: e.subject_id }}
                      className="inline-flex items-center gap-1 text-blue hover:underline"
                    >
                      <GitBranch className="size-2.5" /> {e.subject_id}
                    </Link>
                  )}
                  <span className="text-border">·</span>
                  <span className="tabular-nums">
                    {formatRelative(e.created_at ? `${e.created_at}Z` : null)}
                  </span>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-border/60 glass p-5">
      <h2 className="eyebrow mb-3">{title}</h2>
      {children}
    </section>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 text-right">{children}</dd>
    </div>
  );
}
