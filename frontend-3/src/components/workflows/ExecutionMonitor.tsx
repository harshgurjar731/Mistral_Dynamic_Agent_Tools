import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Activity,
  ArrowDownToLine,
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  Download,
  Search,
  Send,
} from "lucide-react";
import { executionsApi, errorMessage } from "@/api";
import { GlassPanel, GlassPanelHeader } from "@/components/glass/GlassPanel";
import { StatusPill } from "@/components/ui/StatusPill";
import { EmptyState } from "@/components/ui/EmptyState";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { executionStatusIdentity, LIVE_STATE_IDENTITY, formatDuration, formatTimestamp } from "@/lib/status";
import { Markdown } from "@/components/chat/Markdown";
import { useExecutionStream } from "./useExecutionStream";
import { ExecutionStepTimeline } from "./ExecutionStepTimeline";
import { cn } from "@/lib/utils";

const TABS = ["steps", "result", "logs", "events", "trace", "history", "control"] as const;
type TabId = (typeof TABS)[number];

export function ExecutionMonitor({ executionId }: { executionId: string | null }) {
  const { detail, steps, events, phase, error, finalStatus, reconnect } = useExecutionStream(executionId);
  const [tab, setTab] = useState<TabId>("steps");

  if (!executionId) {
    return (
      <GlassPanel className="flex h-full min-h-[320px] flex-col items-center justify-center gap-2 text-center">
        <Activity className="size-6 text-muted-foreground" />
        <p className="text-sm text-muted-foreground">Awaiting execution</p>
      </GlassPanel>
    );
  }

  const liveIdentity = LIVE_STATE_IDENTITY[phase] ?? LIVE_STATE_IDENTITY['idle']!;
  const statusIdentity = executionStatusIdentity(detail?.status ?? finalStatus ?? undefined);

  return (
    <GlassPanel className="flex h-full flex-col overflow-hidden">
      <GlassPanelHeader
        title={`Execution ${executionId.slice(0, 8)}`}
        description={detail?.workflow_name}
        actions={
          <div className="flex items-center gap-2">
            <StatusPill identity={liveIdentity} />
            {detail ? <StatusPill identity={statusIdentity} /> : null}
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
        <Tabs value={tab} onValueChange={(v) => setTab(v as TabId)} className="flex h-full flex-col">
          <TabsList className="w-full justify-start overflow-x-auto">
            <TabsTrigger value="steps">Steps</TabsTrigger>
            <TabsTrigger value="result">Result</TabsTrigger>
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
            <TabsContent value="result" className="h-full">
              <ResultTab detail={detail} error={error} />
            </TabsContent>
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

function ResultTab({ detail, error }: { detail: import("@/types").ExecutionDetail | null; error: string | null }) {
  if (error) return <p className="text-sm text-red">{error}</p>;
  if (!detail?.result && !detail?.error) return <EmptyState title="No result yet" />;
  if (detail.error) return <p className="text-sm text-red">{detail.error}</p>;
  const text = typeof detail.result === "string" ? detail.result : JSON.stringify(detail.result, null, 2);
  return typeof detail.result === "string" ? (
    <Markdown content={text} />
  ) : (
    <pre className="custom-scrollbar overflow-auto rounded-xl border border-border bg-background-elevated p-3 text-xs text-foreground">{text}</pre>
  );
}

function EventsTab({ events }: { events: Array<{ type: string; data: unknown; ts: number }> }) {
  if (events.length === 0) {
    return <EmptyState title="No events yet" description="Live SSE events will appear here as the workflow runs." />;
  }
  return (
    <div className="custom-scrollbar max-h-[500px] space-y-1.5 overflow-auto">
      {events.map((e, idx) => (
        <div key={idx} className="rounded-lg border border-border bg-background-elevated/40 p-2 text-xs font-mono">
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
        l.message.toLowerCase().includes(needle) ||
        (l.step_id ?? "").toLowerCase().includes(needle)
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

  if (isLoading) return <p className="py-8 text-center text-xs text-muted-foreground">Loading trace…</p>;
  if (error) return <p className="py-8 text-center text-xs text-red">{errorMessage(error)}</p>;
  if (!data?.span_tree || rows.length === 0) {
    return <EmptyState title="No trace spans" description="Traces are recorded when workflows execute." />;
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between rounded-lg border border-border bg-background-elevated/40 px-3 py-1.5 text-[11px] text-muted-foreground">
        <span>{rows.length} spans</span>
        <span className="font-mono font-medium text-foreground">{formatDuration(totalMs)} total</span>
      </div>

      <div className="custom-scrollbar max-h-[500px] overflow-auto space-y-1">
        {rows.map(({ span, depth, startMs, durationMs, hasChildren, path }) => {
          const leftPercent = Math.min(99, (startMs / totalMs) * 100);
          const widthPercent = Math.max(0.8, Math.min(100 - leftPercent, (durationMs / totalMs) * 100));

          return (
            <div
              key={path}
              className="group grid grid-cols-[minmax(0,1.2fr)_minmax(0,1.5fr)_auto] items-center gap-3 rounded-lg border border-border/40 bg-background-elevated/50 px-2.5 py-1.5 hover:bg-surface-hover transition-colors"
            >
              <div className="flex min-w-0 items-center gap-1.5" style={{ paddingLeft: depth * 14 }}>
                {hasChildren ? (
                  <button
                    type="button"
                    onClick={() => toggle(path)}
                    className="shrink-0 text-muted-foreground hover:text-foreground"
                  >
                    {collapsed.has(path) ? <ChevronRight className="size-3.5" /> : <ChevronDown className="size-3.5" />}
                  </button>
                ) : (
                  <span className="size-3.5 shrink-0" />
                )}
                <span className="truncate font-mono text-xs font-medium text-foreground" title={span.name}>
                  {span.name}
                </span>
              </div>

              <div className="relative h-2.5 rounded-full bg-border/40 overflow-hidden">
                <div
                  className={cn("absolute top-0 h-full rounded-full transition-all", spanTone(span))}
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
      if (kind === "signals") await executionsApi.signal(executionId, { name: handler, input: parsed });
      if (kind === "queries") await executionsApi.query(executionId, { name: handler, input: parsed });
      if (kind === "updates") await executionsApi.update(executionId, { name: handler, input: parsed });
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
                kind === k ? "border-primary/50 bg-primary/10 text-primary" : "border-border text-muted-foreground",
              )}
            >
              {k.slice(0, -1)}
            </button>
          ))}
        </div>
        <Input className="mt-2" placeholder="handler name" value={handler} onChange={(e) => setHandler(e.target.value)} />
        <Textarea className="mt-2 font-mono text-xs" rows={4} placeholder="JSON input" value={input} onChange={(e) => setInput(e.target.value)} />
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
          <Input placeholder="event id" value={eventId} onChange={(e) => setEventId(e.target.value)} className="h-8 w-32 text-xs" />
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
