import { useMemo, useState, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { AlertTriangle, ChevronDown, ChevronRight, ExternalLink, ShieldCheck } from "lucide-react";
import type { RuleVerdictRow, SpanRow, TraceDetail } from "@/api/observability";
import { StatTile } from "@/components/shared/PageHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { formatDuration, formatTimestamp } from "@/lib/status";
import { cn } from "@/lib/utils";
import { formatTokens, isErrorSpan, KindPill, kindMeta, pretty, VerdictPill } from "./logMeta";

/*
 * One trace from Mistral: totals, the rule verdicts reached in it, the span
 * tree as a waterfall, and everything recorded on the selected span.
 */

interface Node {
  span: SpanRow;
  depth: number;
  children: Node[];
}

function buildTree(spans: SpanRow[]): Node[] {
  const byId = new Map<string, Node>();
  for (const span of spans) byId.set(span.span_id, { span, depth: 0, children: [] });
  const roots: Node[] = [];
  for (const node of byId.values()) {
    const parent = node.span.parent_span_id ? byId.get(node.span.parent_span_id) : undefined;
    if (parent) parent.children.push(node);
    else roots.push(node);
  }
  const order = (a: Node, b: Node) =>
    (a.span.start_time ?? "").localeCompare(b.span.start_time ?? "");
  const walk = (nodes: Node[], depth: number) => {
    nodes.sort(order);
    for (const n of nodes) {
      n.depth = depth;
      walk(n.children, depth + 1);
    }
  };
  walk(roots, 0);
  return roots;
}

function flatten(nodes: Node[], collapsed: Set<string>, out: Node[] = []): Node[] {
  for (const n of nodes) {
    out.push(n);
    if (!collapsed.has(n.span.span_id)) flatten(n.children, collapsed, out);
  }
  return out;
}

const ms = (iso: string | null) => (iso ? Date.parse(iso) : NaN);

export function TraceView({ detail }: { detail: TraceDetail }) {
  const { trace, spans, rules, rule_counts } = detail;
  const tree = useMemo(() => buildTree(spans), [spans]);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [selectedId, setSelectedId] = useState<string | null>(
    () => (detail.root ?? spans[0])?.span_id ?? null,
  );
  const [onlyProblems, setOnlyProblems] = useState(false);

  const rows = useMemo(() => {
    const all = flatten(tree, collapsed);
    if (!onlyProblems) return all;
    return all.filter(
      (n) =>
        isErrorSpan(n.span) ||
        (n.span.kind === "rule" &&
          ["fail", "warn"].includes(n.span.attributes["app.rule.verdict"] ?? "")),
    );
  }, [tree, collapsed, onlyProblems]);

  const t0 = Math.min(...spans.map((s) => ms(s.start_time)).filter((v) => !Number.isNaN(v)));
  const t1 = Math.max(...spans.map((s) => ms(s.end_time)).filter((v) => !Number.isNaN(v)));
  const total = Math.max(1, t1 - t0);
  const selected = spans.find((s) => s.span_id === selectedId) ?? null;
  const errorSpans = spans.filter(isErrorSpan);
  const ruleTotal = rule_counts.pass + rule_counts.fixed + rule_counts.warn + rule_counts.fail;

  const toggle = (id: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <div className="space-y-5">
      {/* ── Totals ── */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-8">
        <StatTile label="Duration" value={formatDuration(trace.duration_ms)} />
        <StatTile label="Spans" value={trace.span_count} />
        <StatTile label="Model calls" value={trace.llm_call_count} tone="blue" />
        <StatTile label="Tool calls" value={trace.tool_call_count} tone="amber" />
        <StatTile
          label="Tokens in / out"
          value={`${formatTokens(trace.input_tokens)} / ${formatTokens(trace.output_tokens)}`}
        />
        <StatTile
          label="Rules passed"
          value={rule_counts.pass + rule_counts.fixed}
          tone="emerald"
        />
        <StatTile
          label="Rules failed"
          value={rule_counts.fail}
          tone={rule_counts.fail ? "red" : "default"}
        />
        <StatTile
          label="Errors"
          value={trace.error_count}
          tone={trace.error_count ? "red" : "default"}
        />
      </div>

      {errorSpans.length > 0 ? (
        <div className="rounded-lg border border-red/25 bg-red/5 px-4 py-3">
          <p className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <AlertTriangle className="size-4 text-red" />
            {errorSpans.length} span{errorSpans.length === 1 ? "" : "s"} failed
          </p>
          <ul className="mt-2 space-y-1">
            {errorSpans.slice(0, 6).map((s) => (
              <li key={s.span_id}>
                <button
                  type="button"
                  onClick={() => setSelectedId(s.span_id)}
                  className="text-left text-xs text-muted-foreground hover:text-foreground"
                >
                  <span className="font-medium text-red">{s.name}</span>
                  {s.status_message ? ` — ${s.status_message.slice(0, 220)}` : ""}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {ruleTotal > 0 ? (
        <RuleVerdicts rules={rules} onSelect={setSelectedId} selectedId={selectedId} />
      ) : null}

      {/* ── Waterfall + detail ── */}
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
        <section className="min-w-0 rounded-xl border border-border bg-background-elevated/40">
          <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-2.5">
            <p className="technical-label">Timeline · {spans.length} spans</p>
            <label className="flex cursor-pointer items-center gap-1.5 text-xs text-muted-foreground">
              <input
                type="checkbox"
                checked={onlyProblems}
                onChange={(e) => setOnlyProblems(e.target.checked)}
                className="accent-red"
              />
              Only failures & warnings
            </label>
          </div>
          {detail.truncated ? (
            <p className="border-b border-border px-4 py-2 text-xs text-amber">
              Very large trace — only the first spans are shown. Open it in Mistral for all of them.
            </p>
          ) : null}
          <div className="max-h-[70vh] overflow-auto py-1">
            {rows.length === 0 ? (
              <p className="px-4 py-6 text-center text-xs text-muted-foreground">
                Nothing failed or warned in this trace.
              </p>
            ) : null}
            {rows.map((node) => {
              const s = node.span;
              const meta = kindMeta(s.kind);
              const Icon = meta.icon;
              const start = ms(s.start_time) - t0;
              const width = Math.max(0.4, ((s.duration_ms ?? 0) / total) * 100);
              const verdict = s.kind === "rule" ? s.attributes["app.rule.verdict"] : undefined;
              const failed = isErrorSpan(s);
              const hasChildren = node.children.length > 0;
              return (
                <div
                  key={s.span_id}
                  role="button"
                  tabIndex={0}
                  onClick={() => setSelectedId(s.span_id)}
                  onKeyDown={(e) => e.key === "Enter" && setSelectedId(s.span_id)}
                  className={cn(
                    "grid cursor-pointer grid-cols-[minmax(0,1fr)_minmax(90px,38%)] items-center gap-3 px-3 py-1 text-xs transition",
                    s.span_id === selectedId ? "bg-primary/10" : "hover:bg-surface-hover",
                  )}
                >
                  <div
                    className="flex min-w-0 items-center gap-1.5"
                    style={{ paddingLeft: Math.min(node.depth, 10) * 14 }}
                  >
                    {hasChildren && !onlyProblems ? (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          toggle(s.span_id);
                        }}
                        className="text-muted-foreground hover:text-foreground"
                        aria-label={collapsed.has(s.span_id) ? "Expand" : "Collapse"}
                      >
                        {collapsed.has(s.span_id) ? (
                          <ChevronRight className="size-3.5" />
                        ) : (
                          <ChevronDown className="size-3.5" />
                        )}
                      </button>
                    ) : (
                      <span className="w-3.5" />
                    )}
                    <Icon
                      className={cn(
                        "size-3.5 shrink-0",
                        failed || verdict === "fail" ? "text-red" : "text-muted-foreground",
                      )}
                    />
                    <span
                      className={cn(
                        "truncate",
                        failed ? "text-red" : "text-foreground",
                        verdict === "warn" && "text-amber",
                      )}
                      title={s.name}
                    >
                      {s.name}
                    </span>
                    {verdict ? <VerdictPill verdict={verdict} /> : null}
                  </div>
                  <div className="relative h-4">
                    <div
                      className={cn(
                        "absolute top-1 h-2 rounded-sm",
                        failed ? "bg-red/70" : verdict ? "bg-emerald/60" : "bg-primary/50",
                      )}
                      style={{ left: `${(start / total) * 100}%`, width: `${width}%` }}
                    />
                    <span className="absolute right-0 top-0 text-[10px] tabular-nums text-muted-foreground">
                      {formatDuration(s.duration_ms)}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        <section className="min-w-0">
          {selected ? (
            <SpanDetail span={selected} />
          ) : (
            <EmptyState
              title="Select a span"
              description="Pick a row to see everything recorded on it."
            />
          )}
        </section>
      </div>
    </div>
  );
}

function RuleVerdicts({
  rules,
  onSelect,
  selectedId,
}: {
  rules: RuleVerdictRow[];
  onSelect: (id: string) => void;
  selectedId: string | null;
}) {
  const rank = { fail: 0, warn: 1, fixed: 2, pass: 3 } as Record<string, number>;
  const sorted = [...rules].sort(
    (a, b) => (rank[a.verdict ?? "pass"] ?? 9) - (rank[b.verdict ?? "pass"] ?? 9),
  );
  return (
    <section className="rounded-xl border border-border bg-background-elevated/40">
      <p className="technical-label flex items-center gap-1.5 border-b border-border px-4 py-2.5">
        <ShieldCheck className="size-3.5" /> Rule verdicts · {rules.length}
      </p>
      <div className="max-h-64 divide-y divide-border overflow-auto">
        {sorted.map((r) => (
          <button
            key={r.span_id}
            type="button"
            onClick={() => onSelect(r.span_id)}
            className={cn(
              "grid w-full grid-cols-[72px_minmax(0,1.2fr)_minmax(0,2fr)_auto] items-center gap-3 px-4 py-2 text-left text-xs transition",
              r.span_id === selectedId ? "bg-primary/10" : "hover:bg-surface-hover",
            )}
          >
            <VerdictPill verdict={r.verdict} />
            <span className="truncate font-medium text-foreground" title={r.rule_name}>
              {r.rule_name}
            </span>
            <span className="truncate text-muted-foreground" title={r.message ?? ""}>
              {r.message || "—"}
            </span>
            <span className="whitespace-nowrap text-[11px] text-muted-foreground">
              {[r.checkpoint, r.step_id ? `step ${r.step_id}` : null].filter(Boolean).join(" · ")}
            </span>
          </button>
        ))}
      </div>
    </section>
  );
}

/* ── One span ─────────────────────────────────────────────────────────── */

function Block({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div>
      <p className="technical-label mb-1.5">{title}</p>
      {children}
    </div>
  );
}

function Pre({ value, tone }: { value: unknown; tone?: "red" | undefined }) {
  const text = pretty(value);
  if (!text) return null;
  return (
    <pre
      className={cn(
        "max-h-80 overflow-auto whitespace-pre-wrap break-words rounded-lg border border-border bg-background px-3 py-2 font-mono text-[11px] leading-relaxed",
        tone === "red" ? "border-red/30 text-red" : "text-foreground",
      )}
    >
      {text}
    </pre>
  );
}

/** Attributes shown in their own sections, so not repeated in the table. */
const PROMOTED = new Set([
  "app.logs",
  "app.step.input",
  "app.step.output",
  "app.step.error",
  "app.step.variables",
  "app.step.config",
  "app.error",
  "app.rule.message",
  "app.rule.detail",
  "app.workflow.input",
  "app.workflow.output",
  "app.request.body",
  "app.agent.prompt",
  "app.agent.answer",
  "app.pipeline.response",
  "app.pipeline.result",
  "app.run.request",
  "app.run.result",
  "gen_ai.tool.call.arguments",
  "gen_ai.tool.call.result",
]);

function SpanDetail({ span }: { span: SpanRow }) {
  const a = span.attributes;
  const failed = isErrorSpan(span);
  const executionId = a["app.execution.id"];
  const workflow = span.workflow_name || a["app.workflow.name"];
  const rest = Object.entries(a)
    .filter(([k]) => !PROMOTED.has(k))
    .sort(([x], [y]) => x.localeCompare(y));

  return (
    <div className="space-y-4 rounded-xl border border-border bg-background-elevated/40 p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <KindPill kind={span.kind} />
            {span.kind === "rule" ? <VerdictPill verdict={a["app.rule.verdict"]} /> : null}
            {failed ? (
              <span className="rounded border border-red/30 bg-red/10 px-1.5 text-[10px] font-medium text-red">
                Error
              </span>
            ) : null}
          </div>
          <h3 className="mt-1.5 break-words text-sm font-semibold text-foreground">{span.name}</h3>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            {formatTimestamp(span.start_time)} · {formatDuration(span.duration_ms)}
            {a["app.component"] ? ` · ${a["app.component"]}` : ""}
          </p>
        </div>
      </div>

      {workflow || executionId ? (
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
          {workflow ? (
            <span>
              Workflow{" "}
              <Link
                to="/workflows/$workflowName"
                params={{ workflowName: workflow }}
                className="font-medium text-primary hover:underline"
              >
                {workflow}
              </Link>
            </span>
          ) : null}
          {executionId ? (
            <span>
              Execution <span className="font-mono text-foreground">{executionId}</span>
            </span>
          ) : null}
          {a["app.step.id"] && span.kind !== "step" ? (
            <span>
              Step <span className="font-mono text-foreground">{a["app.step.id"]}</span>
            </span>
          ) : null}
        </div>
      ) : null}

      {failed && (span.status_message || a["app.error"]) ? (
        <Block title="Error">
          <Pre value={a["app.error"] || span.status_message} tone="red" />
        </Block>
      ) : null}

      {span.kind === "rule" ? (
        <>
          <dl className="grid grid-cols-[110px_minmax(0,1fr)] gap-x-3 gap-y-1 text-xs">
            {[
              ["Rule", a["app.rule.name"]],
              ["Outcome", a["app.rule.outcome"]],
              ["Checkpoint", a["app.rule.checkpoint"]],
              ["Scope", a["app.rule.scope"]],
              ["Applies to", a["app.rule.subject_id"]],
            ]
              .filter(([, v]) => v)
              .map(([k, v]) => (
                <div key={k} className="contents">
                  <dt className="text-muted-foreground">{k}</dt>
                  <dd className="break-words text-foreground">{v}</dd>
                </div>
              ))}
          </dl>
          {a["app.rule.id"] ? (
            <Link
              to="/rules/$id"
              params={{ id: a["app.rule.id"] }}
              className="inline-flex text-xs text-primary hover:underline"
            >
              Open rule
            </Link>
          ) : null}
          {a["app.rule.message"] ? (
            <Block title="Message">
              <Pre value={a["app.rule.message"]} />
            </Block>
          ) : null}
          {a["app.rule.detail"] ? (
            <Block title="Detail">
              <Pre value={a["app.rule.detail"]} />
            </Block>
          ) : null}
        </>
      ) : null}

      {span.model || span.input_messages || span.output_messages ? (
        <>
          <dl className="grid grid-cols-[110px_minmax(0,1fr)] gap-x-3 gap-y-1 text-xs">
            {[
              ["Model", span.model],
              ["Operation", span.operation_name],
              ["Agent", span.agent_name || span.agent_id],
              [
                "Tokens",
                span.usage.input_tokens || span.usage.output_tokens
                  ? `${span.usage.input_tokens} in · ${span.usage.output_tokens} out`
                  : null,
              ],
              ["Finish", span.finish_reasons.join(", ") || null],
            ]
              .filter(([, v]) => v)
              .map(([k, v]) => (
                <div key={k} className="contents">
                  <dt className="text-muted-foreground">{k}</dt>
                  <dd className="break-words text-foreground">{v}</dd>
                </div>
              ))}
          </dl>
          {span.system_instructions ? (
            <Block title="System instructions">
              <Pre value={span.system_instructions} />
            </Block>
          ) : null}
          {span.input_messages ? (
            <Block title="Input messages">
              <Pre value={span.input_messages} />
            </Block>
          ) : null}
          {span.output_messages ? (
            <Block title="Output messages">
              <Pre value={span.output_messages} />
            </Block>
          ) : null}
        </>
      ) : null}

      {span.tool_call_arguments || a["gen_ai.tool.call.arguments"] ? (
        <Block title="Tool arguments">
          <Pre value={span.tool_call_arguments || a["gen_ai.tool.call.arguments"]} />
        </Block>
      ) : null}
      {span.tool_call_result || a["gen_ai.tool.call.result"] ? (
        <Block title="Tool result">
          <Pre value={span.tool_call_result || a["gen_ai.tool.call.result"]} />
        </Block>
      ) : null}

      {[
        ["Request body", a["app.request.body"]],
        ["Workflow input", a["app.workflow.input"]],
        ["Run request", a["app.run.request"]],
        ["Agent prompt", a["app.agent.prompt"]],
        ["Step input", a["app.step.input"]],
        ["Step output", a["app.step.output"]],
        ["Step error", a["app.step.error"]],
        ["Agent answer", a["app.agent.answer"]],
        ["Workflow output", a["app.workflow.output"]],
        ["Pipeline response", a["app.pipeline.response"]],
        ["Pipeline result", a["app.pipeline.result"]],
        ["Run result", a["app.run.result"]],
        ["Step config", a["app.step.config"]],
        ["Variables at step start", a["app.step.variables"]],
      ]
        .filter(([, v]) => v)
        .map(([title, v]) => (
          <Block key={title} title={title!}>
            <Pre value={v} tone={title === "Step error" ? "red" : undefined} />
          </Block>
        ))}

      {a["app.logs"] ? (
        <Block title="Logs">
          <pre className="max-h-80 overflow-auto whitespace-pre rounded-lg border border-border bg-background px-3 py-2 font-mono text-[11px] leading-relaxed text-muted-foreground">
            {a["app.logs"]}
          </pre>
        </Block>
      ) : null}

      <details className="group">
        <summary className="technical-label cursor-pointer select-none">
          All attributes · {rest.length}
        </summary>
        <dl className="mt-2 grid grid-cols-[minmax(120px,38%)_minmax(0,1fr)] gap-x-3 gap-y-1 text-[11px]">
          {rest.map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="break-all font-mono text-muted-foreground">{k}</dt>
              <dd className="max-h-40 overflow-auto whitespace-pre-wrap break-words font-mono text-foreground">
                {v}
              </dd>
            </div>
          ))}
          <div className="contents">
            <dt className="font-mono text-muted-foreground">span_id</dt>
            <dd className="font-mono text-foreground">{span.span_id}</dd>
          </div>
        </dl>
      </details>
    </div>
  );
}

export function OpenInMistral({ url }: { url: string }) {
  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      className="inline-flex items-center gap-1.5 rounded-xl border border-border px-3.5 py-2 text-sm text-muted-foreground transition hover:bg-surface-hover hover:text-foreground"
    >
      <ExternalLink className="size-4" />
      Open in Mistral
    </a>
  );
}
