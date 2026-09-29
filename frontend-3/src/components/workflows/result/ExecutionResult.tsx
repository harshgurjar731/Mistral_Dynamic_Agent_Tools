/**
 * The result of a workflow run, as its own section of the execution page.
 *
 * Shows the answer — the step output meant for a person — rendered: prose as
 * markdown, data as labelled figures and tables. Every other step's output is
 * one click away, and the raw payload is always available.
 */
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { toast } from "sonner";
import {
  AlertTriangle,
  Check,
  Clock,
  Copy,
  Download,
  FileText,
  Loader2,
  Server,
  Sparkles,
} from "lucide-react";
import type { LiveState } from "@/api/sse";
import type { ExecutionDetail, WorkflowDefinition } from "@/types";
import { Markdown } from "@/components/chat/Markdown";
import { GlassPanel } from "@/components/glass/GlassPanel";
import { StatusPill } from "@/components/ui/StatusPill";
import { BLOCK, blockForMode } from "@/lib/terminology";
import { executionStatusIdentity, formatDuration } from "@/lib/status";
import { cn } from "@/lib/utils";
import { asText, humaniseKey, peel, resolveResult } from "./resultModel";

/* ── Rendering one value ──────────────────────────────────────────────── */

const isRecord = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === "object" && !Array.isArray(v);
const isScalar = (v: unknown) => v === null || v === undefined || typeof v !== "object";

function formatScalar(v: unknown): string {
  if (v === null || v === undefined || v === "") return "—";
  if (typeof v === "number") return v.toLocaleString(undefined, { maximumFractionDigits: 4 });
  if (typeof v === "boolean") return v ? "Yes" : "No";
  return String(v);
}

function Table({ rows }: { rows: Record<string, unknown>[] }) {
  const columns = [...new Set(rows.flatMap((r) => Object.keys(r)))];
  // A column empty in every row is noise ("description": "").
  const shown = columns.filter((c) => rows.some((r) => r[c] !== "" && r[c] != null));
  return (
    <div className="custom-scrollbar overflow-x-auto rounded-lg border border-border">
      <table className="w-full border-collapse text-xs">
        <thead>
          <tr className="bg-surface">
            <th className="w-10 px-3 py-2 text-left font-medium text-muted-foreground">#</th>
            {shown.map((c) => (
              <th
                key={c}
                className="px-3 py-2 text-left font-medium whitespace-nowrap text-muted-foreground"
              >
                {humaniseKey(c)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-t border-border/60">
              <td className="px-3 py-2 text-muted-foreground tabular-nums">{i + 1}</td>
              {shown.map((c) => {
                const v = r[c];
                return (
                  <td
                    key={c}
                    className={cn(
                      "px-3 py-2 align-top text-foreground/90",
                      typeof v === "number" && "text-right font-mono tabular-nums",
                    )}
                  >
                    {isScalar(v) ? (
                      formatScalar(v)
                    ) : (
                      <code className="text-[11px]">{JSON.stringify(v)}</code>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-2">
      <h3 className="text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
        {title}
      </h3>
      {children}
    </section>
  );
}

/** Structured data, laid out: figures as cards, record lists as tables, prose as markdown. */
function DataView({ value, depth = 0 }: { value: unknown; depth?: number }) {
  const v = peel(value);
  if (typeof v === "string") return <Markdown content={v} className="text-[14px] leading-7" />;
  if (isScalar(v)) {
    return <p className="font-mono text-2xl font-semibold text-foreground">{formatScalar(v)}</p>;
  }
  if (Array.isArray(v)) {
    if (v.length === 0) return <p className="text-xs text-muted-foreground">Empty list</p>;
    if (v.every(isRecord)) return <Table rows={v} />;
    if (v.every(isScalar)) {
      return (
        <ul className="list-disc space-y-1 pl-5 text-sm text-foreground/90">
          {v.map((x, i) => (
            <li key={i}>{formatScalar(x)}</li>
          ))}
        </ul>
      );
    }
    return (
      <div className="space-y-3">
        {v.map((x, i) => (
          <DataView key={i} value={x} depth={depth + 1} />
        ))}
      </div>
    );
  }
  if (depth > 3) {
    return (
      <pre className="custom-scrollbar overflow-auto rounded-lg border border-border bg-background-elevated/60 p-3 font-mono text-[11px]">
        {JSON.stringify(v, null, 2)}
      </pre>
    );
  }

  const entries = Object.entries(v as Record<string, unknown>);
  const figures = entries.filter(
    ([, x]) => isScalar(x) && !(typeof x === "string" && x.length > 120),
  );
  const rest = entries.filter((e) => !figures.includes(e));
  return (
    <div className="space-y-5">
      {figures.length > 0 ? (
        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {figures.map(([k, x]) => (
            <div
              key={k}
              className="rounded-lg border border-border/60 bg-background-elevated/50 px-3 py-2.5"
            >
              <p className="text-[10px] font-medium tracking-wider text-muted-foreground uppercase">
                {humaniseKey(k)}
              </p>
              <p
                className={cn(
                  "mt-0.5 break-words text-foreground",
                  typeof x === "number"
                    ? "font-mono text-lg font-semibold tabular-nums"
                    : "text-sm",
                )}
              >
                {formatScalar(x)}
              </p>
            </div>
          ))}
        </div>
      ) : null}
      {rest.map(([k, x]) => (
        <Section key={k} title={humaniseKey(k)}>
          <DataView value={x} depth={depth + 1} />
        </Section>
      ))}
    </div>
  );
}

/* ── Section ──────────────────────────────────────────────────────────── */

const RUNNING = new Set(["RUNNING", "PENDING", "QUEUED"]);

export function ExecutionResult({
  detail,
  phase,
  error,
  definition,
  executionId,
}: {
  detail: ExecutionDetail | null;
  phase: LiveState;
  error: string | null;
  definition?: WorkflowDefinition | null | undefined;
  executionId: string | null;
}) {
  const [view, setView] = useState<"rendered" | "raw">("rendered");
  const [selected, setSelected] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // A new run starts on its own answer, not on the step picked for the last one.
  useEffect(() => setSelected(null), [executionId]);

  const resolved = useMemo(
    () => (detail?.result != null ? resolveResult(detail.result, definition) : null),
    [detail?.result, definition],
  );
  const stepId = selected ?? resolved?.stepId ?? null;
  const shown = resolved
    ? stepId && resolved.steps.length
      ? (resolved.steps.find((s) => s.id === stepId)?.value ?? resolved.value)
      : resolved.value
    : null;

  const status = detail?.status ?? null;
  const running = Boolean(executionId) && (!detail || RUNNING.has(status ?? "")) && !error;
  const failed = status === "FAILED" || status === "TIMED_OUT" || status === "TERMINATED";
  const current = detail?.steps?.filter((s) => !s.internal) ?? [];
  const active = current.find((s) => s.status === "RUNNING");
  const doneCount = current.filter((s) => s.status === "COMPLETED").length;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(
        view === "raw" ? JSON.stringify(detail?.result, null, 2) : asText(shown).text,
      );
      setCopied(true);
      toast.success("Result copied");
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error("Could not copy");
    }
  };
  const download = () => {
    const out = view === "raw" ? asText(detail?.result ?? null) : asText(shown);
    const blob = new Blob([view === "raw" ? JSON.stringify(detail?.result, null, 2) : out.text], {
      type: view === "raw" ? "application/json" : out.mime,
    });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${detail?.workflow_name ?? "result"}_${(executionId ?? "").slice(0, 8)}${
      stepId && stepId !== resolved?.stepId ? `_${stepId}` : ""
    }.${view === "raw" ? "json" : out.ext}`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const hasResult = detail?.result != null;
  const stepType = (id: string) => resolved?.steps.find((s) => s.id === id)?.type ?? null;

  return (
    <GlassPanel className="flex min-h-[420px] flex-col overflow-hidden">
      {/* Header */}
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-5 py-3.5">
        <FileText className="size-4 text-primary" />
        <h2 className="text-sm font-semibold text-foreground">Result</h2>
        {detail ? (
          <StatusPill identity={executionStatusIdentity(status ?? undefined)} size="xs" />
        ) : null}
        {detail?.total_duration_ms != null ? (
          <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
            <Clock className="size-3" /> {formatDuration(detail.total_duration_ms)}
          </span>
        ) : null}
        {detail?.source ? (
          <span className="flex items-center gap-1 text-[11px] text-muted-foreground capitalize">
            <Server className="size-3" /> {detail.source}
          </span>
        ) : null}
        {hasResult ? (
          <div className="ml-auto flex items-center gap-1">
            <div className="flex rounded-md border border-border bg-background-elevated/60 p-0.5">
              {(["rendered", "raw"] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setView(m)}
                  className={cn(
                    "rounded px-2.5 py-1 text-[11px] font-medium capitalize transition",
                    view === m
                      ? "bg-surface text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {m === "raw" ? "Raw JSON" : "Rendered"}
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={() => void copy()}
              title="Copy"
              className="rounded-md border border-border p-1.5 text-muted-foreground transition hover:bg-surface-hover hover:text-foreground"
            >
              {copied ? <Check className="size-3.5 text-emerald" /> : <Copy className="size-3.5" />}
            </button>
            <button
              type="button"
              onClick={download}
              title="Download"
              className="rounded-md border border-border p-1.5 text-muted-foreground transition hover:bg-surface-hover hover:text-foreground"
            >
              <Download className="size-3.5" />
            </button>
          </div>
        ) : null}
      </div>

      {/* Which step's output is on screen */}
      {hasResult && view === "rendered" && resolved && resolved.steps.length > 1 ? (
        <div className="custom-scrollbar flex items-center gap-1.5 overflow-x-auto border-b border-border/60 px-5 py-2">
          <span className="shrink-0 text-[10px] text-muted-foreground">Output of</span>
          {resolved.steps.map((s) => {
            const block = blockForMode(s.type);
            const on = s.id === stepId;
            return (
              <button
                key={s.id}
                type="button"
                onClick={() => setSelected(s.id)}
                className={cn(
                  "inline-flex shrink-0 items-center gap-1 rounded-md border px-2 py-1 font-mono text-[10px] transition",
                  on
                    ? block
                      ? BLOCK[block].chip
                      : "border-primary/40 bg-primary/10 text-primary"
                    : "border-border text-muted-foreground hover:border-border-strong hover:text-foreground",
                )}
              >
                {s.id === resolved.stepId ? <Sparkles className="size-2.5" /> : null}
                {s.id}
              </button>
            );
          })}
        </div>
      ) : null}

      {/* Body */}
      <div className="custom-scrollbar flex-1 overflow-auto px-5 py-5">
        {!executionId ? (
          <div className="flex h-full min-h-[300px] flex-col items-center justify-center gap-2 text-center">
            <FileText className="size-7 text-muted-foreground/60" />
            <p className="text-sm font-medium text-foreground">No result yet</p>
            <p className="max-w-sm text-xs text-muted-foreground">
              Fill in the inputs and run the workflow. Its output appears here, formatted.
            </p>
          </div>
        ) : error && !hasResult ? (
          <div className="rounded-xl border border-red/30 bg-red/5 p-4 text-xs text-red">
            {error}
          </div>
        ) : running && !hasResult ? (
          <div className="space-y-4">
            <div className="flex items-center gap-2 text-sm text-foreground">
              <Loader2 className="size-4 animate-spin text-primary" />
              {active ? (
                <span>
                  Running <span className="font-mono text-primary">{active.name || active.id}</span>
                  {current.length ? (
                    <span className="text-muted-foreground">
                      {" "}
                      · {doneCount} of {current.length} steps done
                    </span>
                  ) : null}
                </span>
              ) : (
                <span>{phase === "connecting" ? "Connecting…" : "Starting the run…"}</span>
              )}
            </div>
            <div className="space-y-2.5">
              {[92, 78, 85, 60].map((w, i) => (
                <div key={i} className="shimmer h-3.5 rounded" style={{ width: `${w}%` }} />
              ))}
            </div>
            <p className="text-[11px] text-muted-foreground">
              The result appears here when the run finishes. Step-by-step progress is in the
              execution details below.
            </p>
          </div>
        ) : (
          <div className="space-y-5">
            {failed || detail?.error ? (
              <div className="flex items-start gap-2.5 rounded-xl border border-red/30 bg-red/5 p-4">
                <AlertTriangle className="mt-0.5 size-4 shrink-0 text-red" />
                <div className="min-w-0">
                  <p className="text-sm font-medium text-red">The run failed</p>
                  {detail?.error ? (
                    <pre className="mt-1.5 whitespace-pre-wrap font-mono text-[11px] leading-relaxed text-red/90">
                      {detail.error}
                    </pre>
                  ) : null}
                  {hasResult ? (
                    <p className="mt-1.5 text-[11px] text-muted-foreground">
                      Showing what the steps that finished produced.
                    </p>
                  ) : null}
                </div>
              </div>
            ) : null}

            {hasResult ? (
              view === "raw" ? (
                <pre className="custom-scrollbar overflow-auto rounded-xl border border-border bg-background-elevated/70 p-4 font-mono text-xs leading-relaxed text-foreground">
                  {JSON.stringify(detail?.result, null, 2)}
                </pre>
              ) : (
                <>
                  {stepId && resolved?.steps.length ? (
                    <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                      {stepId === resolved.stepId ? (
                        <Sparkles className="size-3 text-primary" />
                      ) : null}
                      {stepId === resolved.stepId ? "Final output, from " : "Output of "}
                      <span className="font-mono text-foreground">{stepId}</span>
                      {(() => {
                        const block = blockForMode(stepType(stepId));
                        return block ? (
                          <span
                            className={cn(
                              "rounded border px-1 py-0.5 text-[9px]",
                              BLOCK[block].chip,
                            )}
                          >
                            {BLOCK[block].label}
                          </span>
                        ) : null;
                      })()}
                    </p>
                  ) : null}
                  <article className="max-w-4xl">
                    <DataView value={shown} />
                  </article>
                </>
              )
            ) : !failed && !detail?.error ? (
              <p className="text-sm text-muted-foreground">
                The run finished without returning a result.
              </p>
            ) : null}
          </div>
        )}
      </div>
    </GlassPanel>
  );
}
