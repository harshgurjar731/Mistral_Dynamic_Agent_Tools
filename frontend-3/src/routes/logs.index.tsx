import { useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  ExternalLink,
  GitBranch,
  Loader2,
  RefreshCw,
  ScrollText,
  Search,
  ShieldCheck,
} from "lucide-react";
import { observabilityApi, QK } from "@/api";
import type { RuleQuery, RuleVerdict, TraceKind, TraceQuery, TraceRow } from "@/api/observability";
import {
  formatTokens,
  KindPill,
  TIME_RANGES,
  TRACE_KINDS,
  VerdictPill,
  VERDICT_META,
} from "@/components/observability/logMeta";
import { Pill } from "@/components/rules/RulePills";
import { PageHeader } from "@/components/shared/PageHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { TableSkeleton } from "@/components/ui/Skeletons";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatDuration, formatRelative, formatTimestamp } from "@/lib/status";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/logs/")({
  head: () => ({
    meta: [
      { title: "Logs — Agentic AI Design Patterns" },
      {
        name: "description",
        content:
          "Every action, workflow run, step, rule verdict and model call, traced on Mistral.",
      },
      { property: "og:title", content: "Logs — Agentic AI Design Patterns" },
      {
        property: "og:description",
        content:
          "Every action, workflow run, step, rule verdict and model call, traced on Mistral.",
      },
    ],
  }),
  component: LogsPage,
});

const selectClass =
  "rounded-lg border border-border bg-background-elevated px-2.5 py-2 text-xs text-foreground outline-none focus:border-primary/50";

function LogsPage() {
  const [tab, setTab] = useState<"actions" | "workflows" | "rules">("actions");
  const [hours, setHours] = useState(24);

  const status = useQuery({
    queryKey: QK.observabilityStatus(),
    queryFn: () => observabilityApi.status(),
    staleTime: 60_000,
  });
  const workflows = useQuery({
    queryKey: QK.tracedWorkflows(),
    queryFn: () => observabilityApi.workflows(),
    staleTime: 30_000,
  });
  const workflowNames = workflows.data?.workflows ?? [];

  return (
    <div className="px-6 py-8">
      <PageHeader
        eyebrow="Observability"
        title={
          <>
            Logs & <span className="text-gradient-brand">Traces</span>
          </>
        }
        description="Every action this platform takes — API calls, workflow runs and each of their steps, rule verdicts, tool calls, pipeline layers and model calls — is traced to Mistral Observability and read back here."
        actions={
          <>
            <select
              value={hours}
              onChange={(e) => setHours(Number(e.target.value))}
              className={selectClass}
              aria-label="Time range"
            >
              {TIME_RANGES.map((r) => (
                <option key={r.value} value={r.value}>
                  {r.label}
                </option>
              ))}
            </select>
            {status.data ? (
              <a
                href={status.data.console_url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 rounded-xl border border-border px-3.5 py-2 text-sm text-muted-foreground transition hover:bg-surface-hover hover:text-foreground"
              >
                <ExternalLink className="size-4" />
                Mistral console
              </a>
            ) : null}
          </>
        }
      />

      {status.data ? (
        <div className="mt-4 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <Pill tone={status.data.enabled ? "emerald" : "red"}>
            {status.data.enabled ? "Tracing on" : "Tracing off"}
          </Pill>
          <span>
            service <span className="font-mono text-foreground">{status.data.service_name}</span>
          </span>
          <span>·</span>
          <span>
            env <span className="font-mono text-foreground">{status.data.environment}</span>
          </span>
          <span>·</span>
          <span>
            {status.data.redaction ? "secrets & PII masked before export" : "redaction off"}
          </span>
          {!status.data.enabled ? (
            <span className="text-red">
              — set OBSERVABILITY_ENABLED=true and MISTRAL_API_KEY on the backend to record new
              traces.
            </span>
          ) : null}
        </div>
      ) : null}

      <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)} className="mt-6">
        <TabsList>
          <TabsTrigger value="actions" className="gap-1.5">
            <ScrollText className="size-3.5" /> All actions
          </TabsTrigger>
          <TabsTrigger value="workflows" className="gap-1.5">
            <GitBranch className="size-3.5" /> By workflow
          </TabsTrigger>
          <TabsTrigger value="rules" className="gap-1.5">
            <ShieldCheck className="size-3.5" /> Rule verdicts
          </TabsTrigger>
        </TabsList>

        <TabsContent value="actions" className="mt-5">
          <ActionsTab hours={hours} workflowNames={workflowNames} />
        </TabsContent>
        <TabsContent value="workflows" className="mt-5">
          <WorkflowsTab
            hours={hours}
            names={workflowNames}
            loading={workflows.isLoading}
            error={workflows.error}
          />
        </TabsContent>
        <TabsContent value="rules" className="mt-5">
          <RulesTab hours={hours} workflowNames={workflowNames} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

/* ── All actions ──────────────────────────────────────────────────────── */

function useTraces(query: TraceQuery, poll = true) {
  return useInfiniteQuery({
    queryKey: QK.traces(query),
    queryFn: ({ pageParam }) => observabilityApi.traces({ ...query, cursor: pageParam }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => (last.has_more && last.cursor ? last.cursor : undefined),
    refetchInterval: poll ? 15_000 : false,
  });
}

function ActionsTab({ hours, workflowNames }: { hours: number; workflowNames: string[] }) {
  const [kind, setKind] = useState<TraceKind | "">("");
  const [status, setStatus] = useState<"" | "error" | "ok">("");
  const [workflow, setWorkflow] = useState("");
  const [search, setSearch] = useState("");
  const [q, setQ] = useState("");

  const traces = useTraces({ kind, status, workflow, q, hours, page_size: 50 });
  const rows = traces.data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setQ(search.trim());
          }}
          className="relative min-w-[220px] flex-1"
        >
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onBlur={() => setQ(search.trim())}
            placeholder="Search actions (e.g. execute, claim_validation, POST /api/agents)…"
            className="w-full rounded-lg border border-border bg-background-elevated py-2 pl-8 pr-3 text-xs text-foreground outline-none focus:border-primary/50"
          />
        </form>
        <select
          value={kind}
          onChange={(e) => setKind(e.target.value as TraceKind | "")}
          className={selectClass}
        >
          {TRACE_KINDS.map((k) => (
            <option key={k.value} value={k.value}>
              {k.label}
            </option>
          ))}
        </select>
        <select
          value={workflow}
          onChange={(e) => setWorkflow(e.target.value)}
          className={selectClass}
        >
          <option value="">Any workflow</option>
          {workflowNames.map((w) => (
            <option key={w} value={w}>
              {w}
            </option>
          ))}
        </select>
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value as "" | "error" | "ok")}
          className={selectClass}
        >
          <option value="">Any status</option>
          <option value="error">With errors</option>
          <option value="ok">Without errors</option>
        </select>
        <RefreshButton fetching={traces.isFetching} onClick={() => traces.refetch()} />
      </div>

      <TraceTable
        rows={rows}
        loading={traces.isLoading}
        error={traces.error}
        onRetry={() => traces.refetch()}
        empty="No actions traced in this window. Run a workflow, chat with an agent or create something — it appears here a few seconds later."
      />

      {traces.hasNextPage ? (
        <div className="flex justify-center">
          <button
            type="button"
            onClick={() => traces.fetchNextPage()}
            disabled={traces.isFetchingNextPage}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs text-muted-foreground hover:bg-surface-hover hover:text-foreground"
          >
            {traces.isFetchingNextPage ? <Loader2 className="size-3.5 animate-spin" /> : null}
            Load more
          </button>
        </div>
      ) : null}
    </div>
  );
}

function RefreshButton({ fetching, onClick }: { fetching: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-2 text-xs text-muted-foreground transition hover:bg-surface-hover hover:text-foreground"
      aria-label="Refresh"
    >
      <RefreshCw className={cn("size-3.5", fetching && "animate-spin")} />
    </button>
  );
}

function TraceTable({
  rows,
  loading,
  error,
  onRetry,
  empty,
  compact = false,
}: {
  rows: TraceRow[];
  loading: boolean;
  error: unknown;
  onRetry: () => void;
  empty: string;
  compact?: boolean;
}) {
  const navigate = useNavigate();
  if (loading) return <TableSkeleton rows={compact ? 3 : 8} />;
  if (error)
    return (
      <ErrorState error={error} onRetry={onRetry} title="Could not read traces from Mistral" />
    );
  if (rows.length === 0)
    return (
      <EmptyState
        icon={<ScrollText className="size-6" />}
        title="Nothing here yet"
        description={empty}
      />
    );

  return (
    <div className="overflow-x-auto rounded-xl border border-border">
      <table className="w-full min-w-[860px] text-xs">
        <thead className="bg-background-elevated/60 text-left">
          <tr className="technical-label">
            <th className="px-3 py-2 font-medium">Action</th>
            {!compact ? <th className="px-3 py-2 font-medium">Workflow</th> : null}
            <th className="px-3 py-2 font-medium">Started</th>
            <th className="px-3 py-2 text-right font-medium">Duration</th>
            <th className="px-3 py-2 text-right font-medium">Spans</th>
            <th className="px-3 py-2 text-right font-medium">Model calls</th>
            <th className="px-3 py-2 text-right font-medium">Tools</th>
            <th className="px-3 py-2 text-right font-medium">Tokens</th>
            <th className="px-3 py-2 text-right font-medium">Errors</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.map((t) => {
            const failed = t.error_count > 0;
            return (
              <tr
                key={t.trace_id}
                onClick={() => navigate({ to: "/logs/$traceId", params: { traceId: t.trace_id } })}
                className="cursor-pointer transition hover:bg-surface-hover"
              >
                <td className="max-w-[380px] px-3 py-2">
                  <div className="flex min-w-0 items-center gap-2">
                    <span
                      className={cn(
                        "size-1.5 shrink-0 rounded-full",
                        failed ? "bg-red" : "bg-emerald",
                      )}
                    />
                    <KindPill kind={t.kind} />
                    <span className="truncate font-medium text-foreground" title={t.name}>
                      {t.name}
                    </span>
                  </div>
                </td>
                {!compact ? (
                  <td className="px-3 py-2 text-muted-foreground">{t.workflow_name || "—"}</td>
                ) : null}
                <td
                  className="whitespace-nowrap px-3 py-2 text-muted-foreground"
                  title={formatTimestamp(t.start_time)}
                >
                  {formatRelative(t.start_time)}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {formatDuration(t.duration_ms)}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">{t.span_count}</td>
                <td className="px-3 py-2 text-right tabular-nums">{t.llm_call_count || "—"}</td>
                <td className="px-3 py-2 text-right tabular-nums">{t.tool_call_count || "—"}</td>
                <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                  {t.input_tokens || t.output_tokens
                    ? `${formatTokens(t.input_tokens)} / ${formatTokens(t.output_tokens)}`
                    : "—"}
                </td>
                <td
                  className={cn(
                    "px-3 py-2 text-right tabular-nums",
                    failed ? "font-semibold text-red" : "text-muted-foreground",
                  )}
                >
                  {failed ? t.error_count : "—"}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/* ── By workflow ──────────────────────────────────────────────────────── */

function WorkflowsTab({
  hours,
  names,
  loading,
  error,
}: {
  hours: number;
  names: string[];
  loading: boolean;
  error: unknown;
}) {
  const [filter, setFilter] = useState("");
  if (loading) return <TableSkeleton rows={4} />;
  if (error) return <ErrorState error={error} title="Could not list traced workflows" />;
  const shown = names.filter((n) => n.toLowerCase().includes(filter.toLowerCase()));
  if (names.length === 0)
    return (
      <EmptyState
        icon={<GitBranch className="size-6" />}
        title="No workflow runs traced yet"
        description="Each workflow execution becomes one trace, grouped under its workflow here, with every step, rule verdict and tool call inside it."
      />
    );
  return (
    <div className="space-y-4">
      <div className="relative max-w-sm">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter workflows…"
          className="w-full rounded-lg border border-border bg-background-elevated py-2 pl-8 pr-3 text-xs text-foreground outline-none focus:border-primary/50"
        />
      </div>
      {shown.map((name) => (
        <WorkflowGroup key={name} name={name} hours={hours} />
      ))}
    </div>
  );
}

function WorkflowGroup({ name, hours }: { name: string; hours: number }) {
  const [open, setOpen] = useState(false);
  // Run counts are read for every group; the table only once opened.
  const traces = useTraces({ kind: "workflow", workflow: name, hours, page_size: 25 }, open);
  const rows = traces.data?.pages.flatMap((p) => p.items) ?? [];
  const failed = rows.filter((r) => r.error_count > 0).length;

  return (
    <section className="rounded-xl border border-border bg-background-elevated/40">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full flex-wrap items-center justify-between gap-3 px-4 py-3 text-left"
      >
        <div className="flex min-w-0 items-center gap-2">
          <GitBranch className="size-4 text-blue" />
          <span className="truncate text-sm font-semibold text-foreground">{name}</span>
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          {traces.isLoading ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <>
              <span>
                {rows.length}
                {traces.hasNextPage ? "+" : ""} run{rows.length === 1 ? "" : "s"}
              </span>
              {failed ? (
                <Pill tone="red">
                  <AlertTriangle className="size-2.5" /> {failed} failed
                </Pill>
              ) : rows.length ? (
                <Pill tone="emerald">all clean</Pill>
              ) : null}
              {rows[0] ? <span>· last {formatRelative(rows[0].start_time)}</span> : null}
            </>
          )}
          <Link
            to="/workflows/$workflowName"
            params={{ workflowName: name }}
            onClick={(e) => e.stopPropagation()}
            className="text-primary hover:underline"
          >
            Open workflow
          </Link>
        </div>
      </button>
      {open ? (
        <div className="border-t border-border p-3">
          <TraceTable
            rows={rows}
            loading={traces.isLoading}
            error={traces.error}
            onRetry={() => traces.refetch()}
            empty="No runs of this workflow in the selected window."
            compact
          />
          {traces.hasNextPage ? (
            <button
              type="button"
              onClick={() => traces.fetchNextPage()}
              className="mt-2 text-xs text-primary hover:underline"
            >
              Load more runs
            </button>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

/* ── Rule verdicts ────────────────────────────────────────────────────── */

function RulesTab({ hours, workflowNames }: { hours: number; workflowNames: string[] }) {
  const [verdict, setVerdict] = useState<RuleVerdict | "">("");
  const [workflow, setWorkflow] = useState("");
  const [rule, setRule] = useState("");
  const [ruleQ, setRuleQ] = useState("");
  const query: RuleQuery = { verdict, workflow, rule: ruleQ, hours };

  const verdicts = useInfiniteQuery({
    queryKey: QK.ruleVerdicts(query),
    queryFn: ({ pageParam }) => observabilityApi.rules({ ...query, cursor: pageParam }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => (last.has_more && last.cursor ? last.cursor : undefined),
    refetchInterval: 15_000,
  });
  const rows = verdicts.data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex rounded-lg border border-border p-0.5">
          {(["", "fail", "warn", "fixed", "pass"] as const).map((v) => (
            <button
              key={v || "all"}
              type="button"
              onClick={() => setVerdict(v)}
              className={cn(
                "rounded-md px-2.5 py-1 text-xs transition",
                verdict === v
                  ? "bg-primary/15 text-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {v ? VERDICT_META[v].label : "All"}
            </button>
          ))}
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setRuleQ(rule.trim());
          }}
          className="relative min-w-[200px] flex-1"
        >
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            value={rule}
            onChange={(e) => setRule(e.target.value)}
            onBlur={() => setRuleQ(rule.trim())}
            placeholder="Rule name…"
            className="w-full rounded-lg border border-border bg-background-elevated py-2 pl-8 pr-3 text-xs text-foreground outline-none focus:border-primary/50"
          />
        </form>
        <select
          value={workflow}
          onChange={(e) => setWorkflow(e.target.value)}
          className={selectClass}
        >
          <option value="">Any workflow</option>
          {workflowNames.map((w) => (
            <option key={w} value={w}>
              {w}
            </option>
          ))}
        </select>
        <RefreshButton fetching={verdicts.isFetching} onClick={() => verdicts.refetch()} />
      </div>

      {verdicts.isLoading ? (
        <TableSkeleton rows={6} />
      ) : verdicts.error ? (
        <ErrorState
          error={verdicts.error}
          onRetry={() => verdicts.refetch()}
          title="Could not read rule verdicts"
        />
      ) : rows.length === 0 ? (
        <EmptyState
          icon={<ShieldCheck className="size-6" />}
          title="No rule verdicts in this window"
          description="Every time a rule is checked — at agent creation, on a message, before a tool call, on a step's input or result — its pass or fail is recorded here with the reason."
        />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border">
          <table className="w-full min-w-[900px] text-xs">
            <thead className="bg-background-elevated/60 text-left">
              <tr className="technical-label">
                <th className="px-3 py-2 font-medium">Verdict</th>
                <th className="px-3 py-2 font-medium">Rule</th>
                <th className="px-3 py-2 font-medium">Reason</th>
                <th className="px-3 py-2 font-medium">Where</th>
                <th className="px-3 py-2 font-medium">When</th>
                <th className="px-3 py-2 font-medium" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map((r) => (
                <tr key={`${r.trace_id}-${r.span_id}`} className="align-top">
                  <td className="px-3 py-2">
                    <VerdictPill verdict={r.verdict} />
                  </td>
                  <td className="px-3 py-2">
                    {r.rule_id ? (
                      <Link
                        to="/rules/$id"
                        params={{ id: r.rule_id }}
                        className="font-medium text-foreground hover:text-primary"
                      >
                        {r.rule_name}
                      </Link>
                    ) : (
                      <span className="font-medium text-foreground">{r.rule_name}</span>
                    )}
                    <p className="text-[11px] text-muted-foreground">
                      {[r.scope, r.checkpoint].filter(Boolean).join(" · ")}
                    </p>
                  </td>
                  <td className="max-w-[360px] px-3 py-2 text-muted-foreground">
                    <span className="line-clamp-3" title={r.message ?? ""}>
                      {r.message || "—"}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">
                    {r.workflow_name ? <p className="text-foreground">{r.workflow_name}</p> : null}
                    {r.step_id ? <p>step {r.step_id}</p> : null}
                    {!r.workflow_name && r.subject_id ? (
                      <p className="truncate font-mono text-[11px]" title={r.subject_id}>
                        {r.subject_id}
                      </p>
                    ) : null}
                  </td>
                  <td
                    className="whitespace-nowrap px-3 py-2 text-muted-foreground"
                    title={formatTimestamp(r.time)}
                  >
                    {formatRelative(r.time)}
                  </td>
                  <td className="px-3 py-2 text-right">
                    {r.trace_id ? (
                      <Link
                        to="/logs/$traceId"
                        params={{ traceId: r.trace_id }}
                        className="whitespace-nowrap text-primary hover:underline"
                      >
                        View trace
                      </Link>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {verdicts.hasNextPage ? (
        <div className="flex justify-center">
          <button
            type="button"
            onClick={() => verdicts.fetchNextPage()}
            className="rounded-lg border border-border px-3 py-1.5 text-xs text-muted-foreground hover:bg-surface-hover hover:text-foreground"
          >
            Load more
          </button>
        </div>
      ) : null}
    </div>
  );
}
