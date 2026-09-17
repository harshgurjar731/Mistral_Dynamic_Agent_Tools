import { useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Activity, Bot, GitBranch, Loader2, Plus, Search, ShieldCheck, X } from "lucide-react";
import { toast } from "sonner";
import { errorMessage, QK, rulesApi } from "@/api";
import { RuleCard } from "@/components/rules/RuleCard";
import { RuleEditorSheet } from "@/components/rules/RuleEditorSheet";
import { CATEGORY_META, CATEGORY_ORDER, OutcomePill } from "@/components/rules/RulePills";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { CardGridSkeleton, TableSkeleton } from "@/components/ui/Skeletons";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatRelative } from "@/lib/status";
import { cn } from "@/lib/utils";
import type { Rule, RuleEnforcement, RuleScope } from "@/types";

export const Route = createFileRoute("/rules/")({
  head: () => ({
    meta: [
      { title: "Rules — Agentic AI Design Patterns" },
      { name: "description", content: "Define the rules agents and workflows must follow." },
      { property: "og:title", content: "Rules — Agentic AI Design Patterns" },
      { property: "og:description", content: "Define the rules agents and workflows must follow." },
    ],
  }),
  component: RulesPage,
});

const WHEN: Record<RuleScope, string[]> = {
  agent: ["At creation", "On every message", "Before every tool call", "On every answer"],
  workflow: ["On save & publish", "When a run starts", "Before each step", "On step results"],
};

function RulesPage() {
  const qc = useQueryClient();
  const [tab, setTab] = useState<RuleScope | "activity">("agent");
  /** The sheet creates rules; editing an existing one happens on its own page. */
  const [editor, setEditor] = useState<{ open: boolean; scope: RuleScope }>({
    open: false,
    scope: "agent",
  });

  const typesQuery = useQuery({ queryKey: QK.ruleTypes(), queryFn: () => rulesApi.types() });
  const rulesQuery = useQuery({ queryKey: QK.rules(), queryFn: () => rulesApi.list() });
  const rules = rulesQuery.data?.rules ?? [];

  const toggle = useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) =>
      rulesApi.update(id, { enabled }),
    onSuccess: (r) => {
      toast.success(`${r.name} ${r.enabled ? "switched on" : "switched off"}`);
      qc.invalidateQueries({ queryKey: ["rules"] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const newScope: RuleScope = tab === "workflow" ? "workflow" : "agent";
  const counts = {
    agent: rules.filter((r) => r.scope === "agent").length,
    workflow: rules.filter((r) => r.scope === "workflow").length,
  };

  return (
    <div className="px-6 py-8">
      {/* ── Header ── */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
            Rules & <span className="text-gradient-brand">Gates</span>
          </h1>
          <p className="mt-1.5 max-w-2xl text-sm text-muted-foreground">
            The rules your agents and workflows must follow. Always-on rules apply everywhere; the
            orchestrator adds the others where they fit — and you can add them by hand.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setEditor({ open: true, scope: newScope })}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-xl bg-gradient-brand px-4 py-2.5 text-sm font-medium text-primary-foreground transition hover:opacity-90"
        >
          <Plus className="size-4" />
          New {newScope} rule
        </button>
      </div>

      <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)} className="mt-6">
        <TabsList>
          <TabsTrigger value="agent" className="gap-1.5">
            <Bot className="size-3.5" /> Agent rules
            <span className="rounded bg-surface-elevated px-1 text-[10px] tabular-nums">
              {counts.agent}
            </span>
          </TabsTrigger>
          <TabsTrigger value="workflow" className="gap-1.5">
            <GitBranch className="size-3.5" /> Workflow rules
            <span className="rounded bg-surface-elevated px-1 text-[10px] tabular-nums">
              {counts.workflow}
            </span>
          </TabsTrigger>
          <TabsTrigger value="activity" className="gap-1.5">
            <Activity className="size-3.5" /> Activity
          </TabsTrigger>
        </TabsList>

        {(["agent", "workflow"] as RuleScope[]).map((scope) => (
          <TabsContent key={scope} value={scope} className="mt-5">
            <ScopeRules
              scope={scope}
              rules={rules.filter((r) => r.scope === scope)}
              loading={rulesQuery.isLoading}
              error={rulesQuery.error}
              onRetry={() => rulesQuery.refetch()}
              onNew={() => setEditor({ open: true, scope })}
              onToggle={(rule, enabled) => toggle.mutate({ id: rule.id, enabled })}
              togglingId={toggle.isPending ? toggle.variables?.id : undefined}
            />
          </TabsContent>
        ))}

        <TabsContent value="activity" className="mt-5">
          <RuleActivity />
        </TabsContent>
      </Tabs>

      <RuleEditorSheet
        open={editor.open}
        onOpenChange={(open) => setEditor((s) => ({ ...s, open }))}
        scope={editor.scope}
        types={typesQuery.data?.types ?? []}
      />
    </div>
  );
}

const ENFORCEMENT_FILTERS: { value: RuleEnforcement | "all"; label: string }[] = [
  { value: "all", label: "All enforcement" },
  { value: "block", label: "Block" },
  { value: "warn", label: "Warn" },
  { value: "fix", label: "Auto-fix" },
];

function ScopeRules({
  scope,
  rules,
  loading,
  error,
  onRetry,
  onNew,
  onToggle,
  togglingId,
}: {
  scope: RuleScope;
  rules: Rule[];
  loading: boolean;
  error: unknown;
  onRetry: () => void;
  onNew: () => void;
  onToggle: (rule: Rule, enabled: boolean) => void;
  togglingId?: string | undefined;
}) {
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("all");
  const [enforcement, setEnforcement] = useState<RuleEnforcement | "all">("all");

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rules.filter((r) => {
      if (q && !`${r.name} ${r.summary} ${r.description}`.toLowerCase().includes(q)) return false;
      if (category !== "all" && r.category !== category) return false;
      if (enforcement !== "all" && r.enforcement !== enforcement) return false;
      return true;
    });
  }, [rules, search, category, enforcement]);

  const total = rules.length;
  const hasFilters = Boolean(search) || category !== "all" || enforcement !== "all";
  const accent = scope === "agent" ? "text-primary" : "text-blue";

  return (
    <div>
      {/* ── When these rules are checked ── */}
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-border/40 bg-surface/30 px-4 py-2.5 backdrop-blur-sm">
        <div className="flex shrink-0 items-center gap-2">
          <ShieldCheck className={cn("size-4", accent)} />
          <span className="text-xs font-medium text-foreground">
            {scope === "agent"
              ? "Agent rules govern one agent"
              : "Workflow rules govern a whole workflow"}
          </span>
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-1.5">
          <span className="text-[10px] text-muted-foreground/60">Checked</span>
          {WHEN[scope].map((w) => (
            <span
              key={w}
              className="rounded-full border border-border/60 bg-background-elevated px-2 py-0.5 text-[10px] text-muted-foreground"
            >
              {w}
            </span>
          ))}
        </div>
      </div>

      {/* ── Filters ── */}
      <div className="mt-5 flex flex-wrap items-center gap-3 rounded-xl border border-border/40 bg-surface/20 px-4 py-3 backdrop-blur-sm">
        <div className="relative max-w-sm flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={`Search ${scope} rules…`}
            className="w-full rounded-lg border border-border/60 bg-background-elevated py-2 pr-3 pl-9 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </div>
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          className="rounded-lg border border-border/60 bg-background-elevated px-3 py-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
        >
          <option value="all">All categories</option>
          {CATEGORY_ORDER.map((c) => (
            <option key={c} value={c}>
              {CATEGORY_META[c]?.label ?? c}
            </option>
          ))}
        </select>
        <select
          value={enforcement}
          onChange={(e) => setEnforcement(e.target.value as RuleEnforcement | "all")}
          className="rounded-lg border border-border/60 bg-background-elevated px-3 py-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
        >
          {ENFORCEMENT_FILTERS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        {hasFilters && (
          <button
            type="button"
            onClick={() => {
              setSearch("");
              setCategory("all");
              setEnforcement("all");
            }}
            className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-muted-foreground transition hover:bg-surface-hover hover:text-foreground"
          >
            <X className="size-3" />
            Clear
          </button>
        )}

        {/* Summary */}
        {total > 0 && (
          <span className="ml-auto text-xs tabular-nums text-muted-foreground/60">
            {filtered.length} of {total} rule{total !== 1 ? "s" : ""}
          </span>
        )}
      </div>

      {/* ── Grid ── */}
      <div className="mt-8">
        {error ? (
          <ErrorState error={error} onRetry={onRetry} />
        ) : loading ? (
          <CardGridSkeleton count={6} />
        ) : !filtered.length ? (
          <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-border/60 py-20 text-center">
            <div className="relative mb-5">
              <div
                className="absolute -inset-8 rounded-full opacity-15 blur-2xl"
                style={{ background: "var(--gradient-brand)" }}
              />
              <div className="relative grid size-14 place-items-center rounded-2xl border border-border/60 glass">
                <ShieldCheck className={cn("size-6", accent)} />
              </div>
            </div>
            <h2 className="text-lg font-semibold tracking-tight text-foreground">
              {hasFilters ? "No rules match those filters" : `No ${scope} rules yet`}
            </h2>
            <p className="mt-1.5 max-w-sm text-xs text-muted-foreground">
              {hasFilters
                ? "Try adjusting your filters or search query."
                : `Create your first ${scope} rule to get started.`}
            </p>
            {!hasFilters && (
              <button
                type="button"
                onClick={onNew}
                className="mt-5 inline-flex items-center gap-1.5 rounded-xl bg-gradient-brand px-4 py-2 text-sm font-medium text-primary-foreground transition hover:opacity-90"
              >
                <Plus className="size-4" />
                New {scope} rule
              </button>
            )}
          </div>
        ) : (
          <div className="space-y-8">
            {CATEGORY_ORDER.map((c) => {
              const items = filtered.filter((r) => r.category === c);
              if (!items.length) return null;
              const meta = CATEGORY_META[c];
              const Icon = meta?.icon;
              return (
                <section key={c}>
                  <div className="mb-3 flex items-center gap-2">
                    <h2 className="eyebrow flex items-center gap-1.5">
                      {Icon ? <Icon className="size-3" /> : null}
                      {meta?.label ?? c}
                    </h2>
                    <span className="text-[10px] tabular-nums text-muted-foreground/50">
                      {items.length}
                    </span>
                    <div className="h-px flex-1 bg-border/40" />
                  </div>
                  <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                    {items.map((rule) => (
                      <RuleCard
                        key={rule.id}
                        rule={rule}
                        onToggle={(next) => onToggle(rule, next)}
                        toggling={togglingId === rule.id}
                      />
                    ))}
                  </div>
                </section>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

const OUTCOME_FILTERS = [
  { value: "", label: "Needs attention" },
  { value: "blocked", label: "Blocked" },
  { value: "fixed", label: "Fixed" },
  { value: "warned", label: "Warned" },
  { value: "all", label: "Everything" },
];

function RuleActivity() {
  const [scope, setScope] = useState<"" | RuleScope>("");
  const [outcome, setOutcome] = useState("");
  const params = {
    ...(scope ? { scope } : {}),
    ...(outcome && outcome !== "all" ? { outcome } : {}),
    include_passed: outcome === "all",
    limit: 200,
  };
  const query = useQuery({
    queryKey: QK.ruleEvents(params),
    queryFn: () => rulesApi.events(params),
    refetchInterval: 15_000,
  });
  const events = query.data?.events ?? [];

  return (
    <div>
      {/* ── Filters ── */}
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-border/40 bg-surface/20 px-4 py-3 backdrop-blur-sm">
        <Segmented
          value={scope}
          onChange={(v) => setScope(v as typeof scope)}
          options={[
            { value: "", label: "All" },
            { value: "agent", label: "Agents" },
            { value: "workflow", label: "Workflows" },
          ]}
        />
        <Segmented value={outcome} onChange={setOutcome} options={OUTCOME_FILTERS} />
        {query.isFetching ? (
          <Loader2 className="size-3.5 animate-spin text-muted-foreground" />
        ) : null}
        {events.length > 0 && (
          <span className="ml-auto text-xs tabular-nums text-muted-foreground/60">
            {events.length} event{events.length !== 1 ? "s" : ""}
          </span>
        )}
      </div>

      <div className="mt-8">
        {query.isError ? (
          <ErrorState error={query.error} onRetry={() => query.refetch()} />
        ) : query.isLoading ? (
          <TableSkeleton rows={6} />
        ) : !events.length ? (
          <EmptyState
            icon={<Activity className="size-5" />}
            title="Nothing to show"
            description="Rule outcomes appear here as agents answer and workflows run."
          />
        ) : (
          <div className="overflow-x-auto rounded-2xl border border-border/60 glass">
            <table className="w-full min-w-[720px] text-left text-xs">
              <thead className="border-b border-border/60 text-[10px] uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="px-4 py-2.5 font-semibold whitespace-nowrap">When</th>
                  <th className="px-4 py-2.5 font-semibold">Rule</th>
                  <th className="px-4 py-2.5 font-semibold">On</th>
                  <th className="px-4 py-2.5 font-semibold whitespace-nowrap">Outcome</th>
                  <th className="px-4 py-2.5 font-semibold">What happened</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/40">
                {events.map((e) => (
                  <tr key={e.id} className="align-top transition hover:bg-surface-hover/40">
                    <td className="px-4 py-2.5 whitespace-nowrap tabular-nums text-muted-foreground">
                      {formatRelative(e.created_at ? `${e.created_at}Z` : null)}
                    </td>
                    <td className="px-4 py-2.5 font-medium text-foreground">{e.rule_name}</td>
                    <td className="px-4 py-2.5">
                      {e.scope === "agent" ? (
                        <Link
                          to="/agents/$id"
                          params={{ id: e.subject_id }}
                          className="inline-flex items-center gap-1 text-primary hover:underline"
                        >
                          <Bot className="size-3" /> {e.subject_id.slice(0, 14)}
                        </Link>
                      ) : (
                        <Link
                          to="/workflows/$workflowName"
                          params={{ workflowName: e.subject_id }}
                          className="inline-flex items-center gap-1 text-blue hover:underline"
                        >
                          <GitBranch className="size-3" /> {e.subject_id}
                        </Link>
                      )}
                    </td>
                    <td className="px-4 py-2.5">
                      <OutcomePill outcome={e.outcome} />
                    </td>
                    <td className="px-4 py-2.5 text-muted-foreground">{e.message}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function Segmented({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <div className="inline-flex rounded-lg border border-border/60 bg-background-elevated p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={cn(
            "rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
            value === o.value
              ? "bg-primary/15 text-primary"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
