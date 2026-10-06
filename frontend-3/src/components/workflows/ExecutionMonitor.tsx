import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { toast } from "sonner";
import {
  Activity,
  AlertTriangle,
  ArrowDownToLine,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock,
  Copy,
  Download,
  FileJson,
  Hash,
  Layers,
  ScrollText,
  Search,
  Send,
  Server,
  XCircle,
} from "lucide-react";
import { executionsApi, errorMessage } from "@/api";
import { GlassPanel, GlassPanelHeader } from "@/components/glass/GlassPanel";
import { StatusPill } from "@/components/ui/StatusPill";
import { EmptyState } from "@/components/ui/EmptyState";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import {
  executionStatusIdentity,
  LIVE_STATE_IDENTITY,
  formatDuration,
  formatTimestamp,
} from "@/lib/status";
import { Markdown } from "@/components/chat/Markdown";
import { useExecutionStream, type ExecutionMonitorState } from "./useExecutionStream";
import { ExecutionStepTimeline } from "./ExecutionStepTimeline";
import { cn } from "@/lib/utils";

const TABS = ["steps", "result", "logs", "events", "trace", "history", "control"] as const;
type TabId = (typeof TABS)[number];

export function ExecutionMonitor({
  executionId,
  stream,
  hideResult = false,
  title,
}: {
  executionId: string | null;
  /** A stream the page already holds — avoids opening a second connection. */
  stream?: ExecutionMonitorState | undefined;
  /** The page shows the result in its own section. */
  hideResult?: boolean;
  title?: string | undefined;
}) {
  const own = useExecutionStream(stream ? null : executionId);
  const { detail, steps, events, phase, error, finalStatus, reconnect } = stream ?? own;
  const [tab, setTab] = useState<TabId>("steps");

  if (!executionId) {
    return (
      <GlassPanel className="flex h-full min-h-[320px] flex-col items-center justify-center gap-2 text-center">
        <Activity className="size-6 text-muted-foreground" />
        <p className="text-sm text-muted-foreground">Awaiting execution</p>
      </GlassPanel>
    );
  }

  const liveIdentity = LIVE_STATE_IDENTITY[phase] ?? LIVE_STATE_IDENTITY["idle"]!;
  const statusIdentity = executionStatusIdentity(detail?.status ?? finalStatus ?? undefined);

  return (
    <GlassPanel className="flex h-full flex-col overflow-hidden">
      <GlassPanelHeader
        title={title ?? `Execution ${executionId.slice(0, 8)}`}
        description={detail?.workflow_name}
        actions={
          <div className="flex items-center gap-2">
            <StatusPill identity={liveIdentity} />
            {detail ? <StatusPill identity={statusIdentity} /> : null}
            <Link
              to="/logs/execution/$executionId"
              params={{ executionId }}
              title="Every step, rule verdict, tool call and model call of this run, on Mistral"
              className="inline-flex items-center gap-1 rounded-lg border border-border px-2 py-1 text-xs text-muted-foreground hover:bg-surface-hover hover:text-foreground"
            >
              <ScrollText className="size-3.5" />
              Full trace
            </Link>
            {(phase === "disconnected" || phase === "closed") && detail && !finalStatus ? (
              <button
                onClick={reconnect}
                className="rounded-lg border border-border px-2 py-1 text-xs text-foreground hover:bg-surface-hover"
              >
                Reconnect
              </button>
            ) : null}
          </div>
        }
      />
      <div className="flex-1 overflow-hidden p-4">
        <Tabs
          value={tab}
          onValueChange={(v) => setTab(v as TabId)}
          className="flex h-full flex-col"
        >
          <TabsList className="w-full justify-start overflow-x-auto">
            <TabsTrigger value="steps">Steps</TabsTrigger>
            {hideResult ? null : <TabsTrigger value="result">Result</TabsTrigger>}
            <TabsTrigger value="logs">Logs</TabsTrigger>
            <TabsTrigger value="events">Events</TabsTrigger>
            <TabsTrigger value="trace">Trace</TabsTrigger>
            <TabsTrigger value="history">History</TabsTrigger>
            <TabsTrigger value="control">Control</TabsTrigger>
          </TabsList>
          <div className="mt-3 flex-1 overflow-auto custom-scrollbar">
            <TabsContent value="steps" className="h-full">
              <ExecutionStepTimeline
                steps={steps}
                emptyHint={
                  phase === "live" || phase === "connecting"
                    ? "Waiting for the first step to report…"
                    : "This run reported no step-level progress."
                }
              />
            </TabsContent>
            {hideResult ? null : (
              <TabsContent value="result" className="h-full">
                <ResultTab detail={detail} error={error} />
              </TabsContent>
            )}
            <TabsContent value="logs" className="h-full">
              <LogsTab executionId={executionId} />
            </TabsContent>
            <TabsContent value="events" className="h-full">
              <EventsTab events={events} />
            </TabsContent>
            <TabsContent value="trace" className="h-full">
              <TraceTab executionId={executionId} />
            </TabsContent>
            <TabsContent value="history" className="h-full">
              <HistoryTab executionId={executionId} />
            </TabsContent>
            <TabsContent value="control" className="h-full">
              <ControlTab executionId={executionId} />
            </TabsContent>
          </div>
        </Tabs>
      </div>
    </GlassPanel>
  );
}

/* ── Result Tab ─────────────────────────────────────────────────────── */

/**
 * Peel common envelope wrappers like {result: {variables: …}} or {result: X}
 * so the UI shows the actual data the user cares about.
 */
function unwrapResult(value: unknown, depth = 3): unknown {
  for (let i = 0; i < depth; i++) {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      const keys = Object.keys(value as Record<string, unknown>);
      if (keys.length === 1 && (keys[0] === "result" || keys[0] === "output")) {
        value = (value as Record<string, unknown>)[keys[0]!];
        continue;
      }
    }
    break;
  }
  return value;
}

/**
 * A collapsible JSON tree node — renders objects/arrays as expandable sections
 * and primitives as styled values.
 */
function JsonNode({
  label,
  value,
  defaultOpen = true,
  depth = 0,
}: {
  label?: string;
  value: unknown;
  defaultOpen?: boolean;
  depth?: number;
}) {
  const [open, setOpen] = useState(defaultOpen && depth < 2);

  if (value === null || value === undefined) {
    return (
      <div className="flex items-baseline gap-1.5" style={{ paddingLeft: depth * 16 }}>
        {label && <span className="font-mono text-[11px] text-primary/70">{label}:</span>}
        <span className="font-mono text-[11px] text-muted-foreground italic">null</span>
      </div>
    );
  }

  if (typeof value === "boolean") {
    return (
      <div className="flex items-baseline gap-1.5" style={{ paddingLeft: depth * 16 }}>
        {label && <span className="font-mono text-[11px] text-primary/70">{label}:</span>}
        <span
          className={cn("font-mono text-[11px] font-medium", value ? "text-emerald" : "text-red")}
        >
          {String(value)}
        </span>
      </div>
    );
  }

  if (typeof value === "number") {
    return (
      <div className="flex items-baseline gap-1.5" style={{ paddingLeft: depth * 16 }}>
        {label && <span className="font-mono text-[11px] text-primary/70">{label}:</span>}
        <span className="font-mono text-[11px] text-amber font-medium">{value}</span>
      </div>
    );
  }

  if (typeof value === "string") {
    // Long strings get a multi-line box
    if (value.length > 120 || value.includes("\n")) {
      return (
        <div className="space-y-1" style={{ paddingLeft: depth * 16 }}>
          {label && <span className="font-mono text-[11px] text-primary/70">{label}:</span>}
          <div className="rounded-lg border border-border/60 bg-background-elevated/50 p-2.5">
            <p className="whitespace-pre-wrap font-mono text-[11px] leading-relaxed text-foreground/90">
              {value}
            </p>
          </div>
        </div>
      );
    }
    return (
      <div className="flex items-baseline gap-1.5" style={{ paddingLeft: depth * 16 }}>
        {label && <span className="font-mono text-[11px] text-primary/70">{label}:</span>}
        <span className="font-mono text-[11px] text-cyan">&quot;{value}&quot;</span>
      </div>
    );
  }

  if (Array.isArray(value)) {
    if (value.length === 0) {
      return (
        <div className="flex items-baseline gap-1.5" style={{ paddingLeft: depth * 16 }}>
          {label && <span className="font-mono text-[11px] text-primary/70">{label}:</span>}
          <span className="font-mono text-[11px] text-muted-foreground">[] (empty)</span>
        </div>
      );
    }
    return (
      <div style={{ paddingLeft: depth * 16 }}>
        <button
          type="button"
          onClick={() => setOpen(!open)}
          className="flex items-center gap-1 text-[11px] font-mono hover:text-primary transition-colors"
        >
          {open ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
          {label && <span className="text-primary/70">{label}:</span>}
          <span className="text-muted-foreground">Array[{value.length}]</span>
        </button>
        {open && (
          <div className="mt-1 space-y-1 border-l border-border/40 ml-1.5 pl-1">
            {value.map((item, idx) => (
              <JsonNode
                key={idx}
                label={`[${idx}]`}
                value={item}
                depth={depth + 1}
                defaultOpen={depth < 1}
              />
            ))}
          </div>
        )}
      </div>
    );
  }

  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length === 0) {
      return (
        <div className="flex items-baseline gap-1.5" style={{ paddingLeft: depth * 16 }}>
          {label && <span className="font-mono text-[11px] text-primary/70">{label}:</span>}
          <span className="font-mono text-[11px] text-muted-foreground">{"{}"} (empty)</span>
        </div>
      );
    }
    return (
      <div style={{ paddingLeft: depth * 16 }}>
        <button
          type="button"
          onClick={() => setOpen(!open)}
          className="flex items-center gap-1 text-[11px] font-mono hover:text-primary transition-colors"
        >
          {open ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
          {label && <span className="text-primary/70">{label}:</span>}
          <span className="text-muted-foreground">{`{${entries.length} keys}`}</span>
        </button>
        {open && (
          <div className="mt-1 space-y-1 border-l border-border/40 ml-1.5 pl-1">
            {entries.map(([k, v]) => (
              <JsonNode key={k} label={k} value={v} depth={depth + 1} defaultOpen={depth < 1} />
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="flex items-baseline gap-1.5" style={{ paddingLeft: depth * 16 }}>
      {label && <span className="font-mono text-[11px] text-primary/70">{label}:</span>}
      <span className="font-mono text-[11px] text-foreground">{String(value)}</span>
    </div>
  );
}

/**
 * Render flat key-value result objects as a grid of small info cards.
 */
function ResultCards({ data }: { data: Record<string, unknown> }) {
  const entries = Object.entries(data);
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {entries.map(([key, val]) => {
        const display =
          val === null || val === undefined
            ? "null"
            : typeof val === "string"
              ? val
              : JSON.stringify(val);
        const isLong = String(display).length > 80;
        return (
          <div
            key={key}
            className={cn(
              "rounded-xl border border-border/60 bg-background-elevated/50 p-3 transition-colors hover:border-primary/30",
              isLong && "sm:col-span-2",
            )}
          >
            <p className="mb-1 font-mono text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
              {key.replace(/_/g, " ")}
            </p>
            <p
              className={cn(
                "text-sm text-foreground/90 break-words",
                isLong && "font-mono text-xs whitespace-pre-wrap",
              )}
            >
              {display}
            </p>
          </div>
        );
      })}
    </div>
  );
}

/**
 * Check whether an object is "flat" — all values are primitives (no nested objects/arrays).
 */
function isFlat(obj: Record<string, unknown>): boolean {
  return Object.values(obj).every((v) => v === null || v === undefined || typeof v !== "object");
}

function ResultTab({
  detail,
  error,
}: {
  detail: import("@/types").ExecutionDetail | null;
  error: string | null;
}) {
  const [copied, setCopied] = useState(false);
  const [viewMode, setViewMode] = useState<"auto" | "json" | "raw">("auto");

  const copyResult = useCallback(async () => {
    if (!detail?.result) return;
    try {
      const text =
        typeof detail.result === "string" ? detail.result : JSON.stringify(detail.result, null, 2);
      await navigator.clipboard.writeText(text);
      setCopied(true);
      toast.success("Result copied to clipboard");
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* ignore */
    }
  }, [detail?.result]);

  const downloadResult = useCallback(() => {
    if (!detail?.result) return;
    const text =
      typeof detail.result === "string" ? detail.result : JSON.stringify(detail.result, null, 2);
    const blob = new Blob([text], {
      type: typeof detail.result === "string" ? "text/plain" : "application/json",
    });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${detail.execution_id.slice(0, 8)}_result.${typeof detail.result === "string" ? "txt" : "json"}`;
    a.click();
  }, [detail]);

  // ── Error states ──────────────────────────────────────────────────
  if (error) {
    return (
      <div className="rounded-xl border border-red/30 bg-red/5 p-4">
        <div className="flex items-start gap-2.5">
          <XCircle className="mt-0.5 size-4 shrink-0 text-red" />
          <div>
            <p className="text-sm font-medium text-red">Stream Error</p>
            <p className="mt-1 text-xs text-red/80 leading-relaxed">{error}</p>
          </div>
        </div>
      </div>
    );
  }

  if (!detail?.result && !detail?.error) {
    const isRunning = detail?.status === "RUNNING" || detail?.status === "PENDING";
    return (
      <EmptyState
        title={isRunning ? "Execution in progress…" : "No result yet"}
        description={
          isRunning
            ? "The workflow is still running. Results will appear here once it completes."
            : "Submit a run using the input form to see results."
        }
      />
    );
  }

  if (detail.error) {
    return (
      <div className="space-y-3">
        {/* Error banner */}
        <div className="rounded-xl border border-red/30 bg-red/5 p-4">
          <div className="flex items-start gap-2.5">
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-red" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-red">Execution Failed</p>
              <pre className="mt-2 whitespace-pre-wrap rounded-lg border border-red/20 bg-background-elevated/60 p-3 font-mono text-[11px] leading-relaxed text-red/90">
                {detail.error}
              </pre>
            </div>
          </div>
        </div>
        {/* Still show partial result if present alongside error */}
        {detail.result != null && (
          <div className="rounded-xl border border-border/60 bg-background-elevated/40 p-3">
            <p className="eyebrow mb-2 text-muted-foreground">Partial Result</p>
            <pre className="custom-scrollbar overflow-auto font-mono text-[11px] text-foreground/80">
              {typeof detail.result === "string"
                ? detail.result
                : JSON.stringify(detail.result, null, 2)}
            </pre>
          </div>
        )}
      </div>
    );
  }

  // ── Success result ──────────────────────────────────────────────────

  const statusIdentity = executionStatusIdentity(detail.status);
  const unwrapped = unwrapResult(detail.result);

  return (
    <div className="space-y-4">
      {/* ── Metadata strip ──────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border/60 bg-background-elevated/40 px-3 py-2">
        <StatusPill identity={statusIdentity} />

        {detail.total_duration_ms != null && (
          <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
            <Clock className="size-3" />
            <span className="font-mono font-medium text-foreground">
              {formatDuration(detail.total_duration_ms)}
            </span>
          </div>
        )}

        {detail.source && (
          <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
            <Server className="size-3" />
            <span className="capitalize">{detail.source}</span>
          </div>
        )}

        {detail.start_time && (
          <div className="hidden items-center gap-1 text-[11px] text-muted-foreground sm:flex">
            <span>{formatTimestamp(detail.start_time)}</span>
          </div>
        )}

        <div className="ml-auto flex items-center gap-1">
          {/* View mode toggle */}
          <div className="flex items-center gap-0.5 rounded-md border border-border bg-background-elevated p-0.5">
            {(["auto", "json", "raw"] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                onClick={() => setViewMode(mode)}
                className={cn(
                  "rounded px-2 py-0.5 text-[10px] font-mono font-medium transition-colors capitalize",
                  viewMode === mode
                    ? "bg-primary/20 text-primary font-bold"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {mode}
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={copyResult}
            className="rounded-lg border border-border p-1.5 text-muted-foreground hover:bg-surface-hover hover:text-foreground transition-colors"
            title="Copy result"
          >
            {copied ? <Check className="size-3.5 text-emerald" /> : <Copy className="size-3.5" />}
          </button>
          <button
            type="button"
            onClick={downloadResult}
            className="rounded-lg border border-border p-1.5 text-muted-foreground hover:bg-surface-hover hover:text-foreground transition-colors"
            title="Download result"
          >
            <Download className="size-3.5" />
          </button>
        </div>
      </div>

      {/* ── Result body ──────────────────────────────────────────────── */}
      {viewMode === "raw" ? (
        <pre className="custom-scrollbar overflow-auto rounded-xl border border-border bg-background-elevated p-4 font-mono text-xs leading-relaxed text-foreground">
          {typeof detail.result === "string"
            ? detail.result
            : JSON.stringify(detail.result, null, 2)}
        </pre>
      ) : viewMode === "json" ? (
        <div className="custom-scrollbar overflow-auto rounded-xl border border-border bg-background-elevated/70 p-4 max-h-[600px]">
          <JsonNode value={unwrapped} defaultOpen />
        </div>
      ) : (
        /* auto mode — pick the best renderer */
        <AutoResultView value={unwrapped} rawResult={detail.result} />
      )}
    </div>
  );
}

/**
 * Automatically choose the best rendering for the result shape:
 * - string → markdown
 * - flat object → card grid
 * - nested object / array → JSON tree
 */
function AutoResultView({ value, rawResult }: { value: unknown; rawResult: unknown }) {
  // String → render as markdown (may contain text, lists, code, etc.)
  if (typeof value === "string") {
    return (
      <div className="rounded-xl border border-border/60 bg-background-elevated/40 p-4">
        <Markdown content={value} />
      </div>
    );
  }

  // Primitive
  if (value === null || value === undefined || typeof value !== "object") {
    return (
      <div className="rounded-xl border border-border/60 bg-background-elevated/40 p-4">
        <p className="font-mono text-sm text-foreground">{String(value ?? "null")}</p>
      </div>
    );
  }

  // Array
  if (Array.isArray(value)) {
    // Array of strings → render as a list
    if (value.every((v) => typeof v === "string")) {
      return (
        <div className="space-y-1.5">
          <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <Layers className="size-3" />
            <span>{value.length} items</span>
          </div>
          <div className="space-y-1">
            {value.map((item, idx) => (
              <div
                key={idx}
                className="rounded-lg border border-border/50 bg-background-elevated/40 px-3 py-2"
              >
                <div className="flex items-start gap-2">
                  <span className="shrink-0 mt-0.5 flex items-center justify-center rounded bg-primary/10 text-primary font-mono text-[10px] font-bold size-5">
                    {idx + 1}
                  </span>
                  <p className="text-sm text-foreground/90 break-words">{item}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      );
    }

    // General array → tree view
    return (
      <div className="space-y-1.5">
        <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <Layers className="size-3" />
          <span>{value.length} items</span>
        </div>
        <div className="custom-scrollbar overflow-auto rounded-xl border border-border bg-background-elevated/70 p-4 max-h-[600px]">
          <JsonNode value={value} defaultOpen />
        </div>
      </div>
    );
  }

  // Object — flat → cards, nested → tree
  const obj = value as Record<string, unknown>;
  if (isFlat(obj) && Object.keys(obj).length > 0) {
    return <ResultCards data={obj} />;
  }

  return (
    <div className="custom-scrollbar overflow-auto rounded-xl border border-border bg-background-elevated/70 p-4 max-h-[600px]">
      <JsonNode value={value} defaultOpen />
    </div>
  );
}

function EventsTab({ events }: { events: Array<{ type: string; data: unknown; ts: number }> }) {
  if (events.length === 0) {
    return (
      <EmptyState
        title="No events yet"
        description="Live SSE events will appear here as the workflow runs."
      />
    );
  }
  return (
    <div className="custom-scrollbar max-h-[500px] space-y-1.5 overflow-auto">
      {events.map((e, idx) => (
        <div
          key={idx}
          className="rounded-lg border border-border bg-background-elevated/40 p-2 text-xs font-mono"
        >
          <div className="flex items-center justify-between text-[10px] text-muted-foreground">
            <span className="font-bold text-primary">{e.type}</span>
            <span>{new Date(e.ts).toLocaleTimeString()}</span>
          </div>
          <pre className="mt-1 whitespace-pre-wrap text-[11px] text-foreground">
            {typeof e.data === "string" ? e.data : JSON.stringify(e.data, null, 2)}
          </pre>
        </div>
      ))}
    </div>
  );
}

const LEVEL_ORDER = ["DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL"];

function LogsTab({ executionId }: { executionId: string }) {
  const [since, setSince] = useState(0);
  const [lines, setLines] = useState<import("@/types").LogLine[]>([]);
  const [filter, setFilter] = useState("");
  const [minLevel, setMinLevel] = useState<string>("ALL");
  const [follow, setFollow] = useState(true);
  const [copied, setCopied] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const { data } = useQuery({
    queryKey: ["execution-logs", executionId, since],
    queryFn: () => executionsApi.logs(executionId, since),
    refetchInterval: 3000,
  });

  useEffect(() => {
    if (data?.logs?.length) {
      setLines((prev) => [...prev, ...data.logs]);
      setSince(data.next_seq);
    }
  }, [data]);

  const visible = useMemo(() => {
    const floor = LEVEL_ORDER.indexOf(minLevel);
    const needle = filter.trim().toLowerCase();
    return lines.filter((l) => {
      if (minLevel !== "ALL") {
        const rank = LEVEL_ORDER.indexOf(l.level.toUpperCase());
        if (rank >= 0 && floor >= 0 && rank < floor) return false;
      }
      if (!needle) return true;
      return (
        l.message.toLowerCase().includes(needle) || (l.step_id ?? "").toLowerCase().includes(needle)
      );
    });
  }, [lines, minLevel, filter]);

  useLayoutEffect(() => {
    if (!follow || !scrollRef.current) return;
    scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [visible.length, follow]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onScroll = () => {
      const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
      setFollow(atBottom);
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, []);

  const levelColor = (lvl: string) => {
    const u = lvl.toUpperCase();
    if (u === "ERROR" || u === "CRITICAL") return "text-red";
    if (u === "WARNING") return "text-amber";
    if (u === "INFO") return "text-cyan";
    return "text-muted-foreground";
  };

  const copyAll = async () => {
    try {
      const text = visible.map((l) => `${l.timestamp} [${l.level}] ${l.message}`).join("\n");
      await navigator.clipboard.writeText(text);
      setCopied(true);
      toast.success("Logs copied to clipboard");
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* ignore */
    }
  };

  const download = () => {
    const blob = new Blob(
      [visible.map((l) => `${l.timestamp} [${l.level}] ${l.message}`).join("\n")],
      { type: "text/plain" },
    );
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${executionId}.log`;
    a.click();
  };

  return (
    <div className="flex h-full flex-col gap-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[160px]">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3 text-muted-foreground" />
          <Input
            placeholder="Filter logs…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="h-8 pl-7 text-xs"
          />
        </div>
        <div className="flex items-center gap-0.5 rounded-md border border-border bg-background-elevated p-0.5">
          {["ALL", "DEBUG", "INFO", "WARNING", "ERROR"].map((lvl) => (
            <button
              key={lvl}
              type="button"
              onClick={() => setMinLevel(lvl)}
              className={cn(
                "rounded px-2 py-1 text-[10px] font-mono font-medium transition-colors",
                minLevel === lvl
                  ? "bg-primary/20 text-primary font-bold"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {lvl}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={() => setFollow(!follow)}
          className={cn(
            "flex items-center gap-1 rounded-md border px-2 py-1 text-xs transition-colors",
            follow
              ? "border-primary/40 bg-primary/10 text-primary"
              : "border-border text-muted-foreground hover:bg-surface-hover",
          )}
          title={follow ? "Auto-scroll is ON" : "Auto-scroll is PAUSED"}
        >
          <ArrowDownToLine className="size-3" />
          <span className="text-[10px]">{follow ? "Following" : "Paused"}</span>
        </button>
        <button
          className="rounded-lg border border-border p-1.5 text-muted-foreground hover:bg-surface-hover hover:text-foreground"
          title="Copy visible lines"
          onClick={copyAll}
        >
          {copied ? <Check className="size-3.5 text-emerald" /> : <Copy className="size-3.5" />}
        </button>
        <button
          className="rounded-lg border border-border p-1.5 text-muted-foreground hover:bg-surface-hover hover:text-foreground"
          title="Download as .log"
          onClick={download}
        >
          <Download className="size-3.5" />
        </button>
      </div>

      {visible.length === 0 ? (
        <EmptyState title="No logs match filter" />
      ) : (
        <div
          ref={scrollRef}
          className="custom-scrollbar flex-1 overflow-auto rounded-xl border border-border bg-background-elevated/70 p-3 font-mono text-[11px] leading-relaxed"
        >
          {visible.map((l) => (
            <p key={l.seq} className={cn("whitespace-pre-wrap", levelColor(l.level))}>
              <span className="text-muted-foreground/50">{l.timestamp}</span>{" "}
              <span className="font-bold">[{l.level}]</span> {l.step_id ? `(${l.step_id}) ` : ""}
              {l.message}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}

interface FlatSpan {
  span: import("@/types").TraceSpan;
  depth: number;
  startMs: number;
  durationMs: number;
  hasChildren: boolean;
  path: string;
}

const NS_PER_MS = 1_000_000;

function flattenSpan(
  span: import("@/types").TraceSpan,
  depth: number,
  originNs: number,
  nowNs: number,
  collapsed: Set<string>,
  path: string,
  out: FlatSpan[],
) {
  const startNs = span.start_time_unix_nano ?? originNs;
  const endNs = span.end_time_unix_nano ?? nowNs;
  const children = span.children ?? [];

  out.push({
    span,
    depth,
    startMs: Math.max(0, (startNs - originNs) / NS_PER_MS),
    durationMs: Math.max(0, (endNs - startNs) / NS_PER_MS),
    hasChildren: children.length > 0,
    path,
  });

  if (collapsed.has(path)) return;
  children.forEach((child, i) =>
    flattenSpan(child, depth + 1, originNs, nowNs, collapsed, `${path}/${child.span_id || i}`, out),
  );
}

function maxSpanEndNs(span: import("@/types").TraceSpan, fallback: number): number {
  let max = span.end_time_unix_nano ?? span.start_time_unix_nano ?? fallback;
  for (const child of span.children ?? []) {
    max = Math.max(max, maxSpanEndNs(child, fallback));
  }
  return max;
}

function spanTone(span: import("@/types").TraceSpan): string {
  const status = String(
    (span.attributes?.["status"] as string) ??
      (span.attributes?.["otel.status_code"] as string) ??
      "",
  ).toUpperCase();
  if (status.includes("ERROR") || status.includes("FAIL")) return "bg-red";
  if (!span.end_time_unix_nano) return "bg-amber animate-pulse";
  return "bg-primary";
}

function TraceTab({ executionId }: { executionId: string }) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const { data, isLoading, error } = useQuery({
    queryKey: ["execution-trace", executionId],
    queryFn: () => executionsApi.traceSummary(executionId),
  });

  const { rows, totalMs } = useMemo(() => {
    const root = data?.span_tree;
    if (!root) return { rows: [] as FlatSpan[], totalMs: 0 };
    const nowNs = Date.now() * NS_PER_MS;
    const originNs = root.start_time_unix_nano ?? nowNs;
    const endNs = maxSpanEndNs(root, nowNs);
    const out: FlatSpan[] = [];
    flattenSpan(root, 0, originNs, nowNs, collapsed, root.span_id || "root", out);
    return { rows: out, totalMs: Math.max(1, (endNs - originNs) / NS_PER_MS) };
  }, [data?.span_tree, collapsed]);

  const toggle = (path: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });

  if (isLoading)
    return <p className="py-8 text-center text-xs text-muted-foreground">Loading trace…</p>;
  if (error) return <p className="py-8 text-center text-xs text-red">{errorMessage(error)}</p>;
  if (!data?.span_tree || rows.length === 0) {
    return (
      <EmptyState
        title="No trace spans"
        description="Traces are recorded when workflows execute."
      />
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between rounded-lg border border-border bg-background-elevated/40 px-3 py-1.5 text-[11px] text-muted-foreground">
        <span>{rows.length} spans</span>
        <span className="font-mono font-medium text-foreground">
          {formatDuration(totalMs)} total
        </span>
      </div>

      <div className="custom-scrollbar max-h-[500px] overflow-auto space-y-1">
        {rows.map(({ span, depth, startMs, durationMs, hasChildren, path }) => {
          const leftPercent = Math.min(99, (startMs / totalMs) * 100);
          const widthPercent = Math.max(
            0.8,
            Math.min(100 - leftPercent, (durationMs / totalMs) * 100),
          );

          return (
            <div
              key={path}
              className="group grid grid-cols-[minmax(0,1.2fr)_minmax(0,1.5fr)_auto] items-center gap-3 rounded-lg border border-border/40 bg-background-elevated/50 px-2.5 py-1.5 hover:bg-surface-hover transition-colors"
            >
              <div
                className="flex min-w-0 items-center gap-1.5"
                style={{ paddingLeft: depth * 14 }}
              >
                {hasChildren ? (
                  <button
                    type="button"
                    onClick={() => toggle(path)}
                    className="shrink-0 text-muted-foreground hover:text-foreground"
                  >
                    {collapsed.has(path) ? (
                      <ChevronRight className="size-3.5" />
                    ) : (
                      <ChevronDown className="size-3.5" />
                    )}
                  </button>
                ) : (
                  <span className="size-3.5 shrink-0" />
                )}
                <span
                  className="truncate font-mono text-xs font-medium text-foreground"
                  title={span.name}
                >
                  {span.name}
                </span>
              </div>

              <div className="relative h-2.5 rounded-full bg-border/40 overflow-hidden">
                <div
                  className={cn(
                    "absolute top-0 h-full rounded-full transition-all",
                    spanTone(span),
                  )}
                  style={{ left: `${leftPercent}%`, width: `${widthPercent}%` }}
                  title={`${span.name} · +${formatDuration(startMs)} · ${formatDuration(durationMs)}`}
                />
              </div>

              <span className="w-16 shrink-0 text-right font-mono text-[10px] tabular-nums text-muted-foreground">
                {formatDuration(durationMs)}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function HistoryTab({ executionId }: { executionId: string }) {
  const { data, isLoading, error } = useQuery({
    queryKey: ["execution-history", executionId],
    queryFn: () => executionsApi.history(executionId),
  });
  if (isLoading) return <p className="text-sm text-muted-foreground">Loading history…</p>;
  if (error) return <p className="text-sm text-red">{errorMessage(error)}</p>;
  return (
    <pre className="custom-scrollbar overflow-auto rounded-xl border border-border bg-background-elevated p-3 text-xs text-foreground">
      {JSON.stringify(data, null, 2)}
    </pre>
  );
}

function ControlTab({ executionId }: { executionId: string }) {
  const [handler, setHandler] = useState("user_message");
  const [input, setInput] = useState("{}");
  const [kind, setKind] = useState<"signals" | "queries" | "updates">("signals");
  const [eventId, setEventId] = useState("");

  async function submit() {
    try {
      const parsed = JSON.parse(input || "{}");
      if (kind === "signals")
        await executionsApi.signal(executionId, { name: handler, input: parsed });
      if (kind === "queries")
        await executionsApi.query(executionId, { name: handler, input: parsed });
      if (kind === "updates")
        await executionsApi.update(executionId, { name: handler, input: parsed });
      toast.success(`Sent ${kind.slice(0, -1)}: ${handler}`);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }

  return (
    <div className="space-y-5">
      <div className="rounded-xl border border-border bg-background-elevated/60 p-3">
        <p className="eyebrow mb-2">Signal / Query / Update</p>
        <div className="flex gap-2">
          {(["signals", "queries", "updates"] as const).map((k) => (
            <button
              key={k}
              onClick={() => setKind(k)}
              className={cn(
                "rounded-lg border px-2.5 py-1 text-xs capitalize",
                kind === k
                  ? "border-primary/50 bg-primary/10 text-primary"
                  : "border-border text-muted-foreground",
              )}
            >
              {k.slice(0, -1)}
            </button>
          ))}
        </div>
        <Input
          className="mt-2"
          placeholder="handler name"
          value={handler}
          onChange={(e) => setHandler(e.target.value)}
        />
        <Textarea
          className="mt-2 font-mono text-xs"
          rows={4}
          placeholder="JSON input"
          value={input}
          onChange={(e) => setInput(e.target.value)}
        />
        <button
          onClick={submit}
          className="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-gradient-brand px-3 py-1.5 text-xs font-medium text-primary-foreground"
        >
          <Send className="size-3.5" /> Send
        </button>
      </div>

      <div className="rounded-xl border border-border bg-background-elevated/60 p-3">
        <p className="eyebrow mb-2">Lifecycle</p>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={async () => {
              try {
                await executionsApi.cancel(executionId);
                toast.success("Cancel requested");
              } catch (e) {
                toast.error(errorMessage(e));
              }
            }}
            className="rounded-lg border border-amber/30 bg-amber/10 px-3 py-1.5 text-xs text-amber"
          >
            Cancel
          </button>
          <button
            onClick={async () => {
              try {
                await executionsApi.terminate(executionId);
                toast.success("Terminate requested");
              } catch (e) {
                toast.error(errorMessage(e));
              }
            }}
            className="rounded-lg border border-red/30 bg-red/10 px-3 py-1.5 text-xs text-red"
          >
            Terminate
          </button>
        </div>
        <div className="mt-3 flex items-center gap-2">
          <Input
            placeholder="event id"
            value={eventId}
            onChange={(e) => setEventId(e.target.value)}
            className="h-8 w-32 text-xs"
          />
          <button
            onClick={async () => {
              try {
                await executionsApi.reset(executionId, { event_id: Number(eventId) });
                toast.success("Reset requested");
              } catch (e) {
                toast.error(errorMessage(e));
              }
            }}
            className="rounded-lg border border-border px-3 py-1.5 text-xs text-foreground hover:bg-surface-hover"
          >
            Reset
          </button>
        </div>
      </div>
    </div>
  );
}
