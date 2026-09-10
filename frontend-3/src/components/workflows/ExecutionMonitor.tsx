import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Activity, Copy, Download, Send } from "lucide-react";
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
              <StepsTab steps={steps} />
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

function StepsTab({ steps }: { steps: import("@/types").ExecutionStep[] }) {
  if (steps.length === 0) return <EmptyState title="No steps yet" description="Waiting for the first step to start." />;
  const groups = new Map<string, typeof steps>();
  for (const s of steps) {
    const key = s.parallel_group ?? "";
    groups.set(key, [...(groups.get(key) ?? []), s]);
  }
  return (
    <ol className="space-y-3">
      {Array.from(groups.entries()).map(([group, list]) => (
        <li key={group || "solo"}>
          {group ? <p className="eyebrow mb-1.5">Parallel · {group}</p> : null}
          <div className="space-y-2">
            {list.map((s) => {
              const identity = executionStatusIdentity(s.status);
              return (
                <div key={s.id} className="rounded-xl border border-border bg-background-elevated/60 p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-sm font-medium text-foreground">{s.name || s.id}</span>
                    <div className="flex items-center gap-2">
                      <span className="text-[11px] text-muted-foreground">{formatDuration(s.duration_ms)}</span>
                      <StatusPill identity={identity} size="xs" />
                    </div>
                  </div>
                  {s.input_preview ? (
                    <p className="mt-1.5 truncate font-mono text-[11px] text-muted-foreground">in: {s.input_preview}</p>
                  ) : null}
                  {s.output_preview ? (
                    <p className="mt-0.5 truncate font-mono text-[11px] text-muted-foreground">out: {s.output_preview}</p>
                  ) : null}
                  {s.error ? <p className="mt-1 text-[11px] text-red">{s.error}</p> : null}
                </div>
              );
            })}
          </div>
        </li>
      ))}
    </ol>
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

function LogsTab({ executionId }: { executionId: string }) {
  const [since, setSince] = useState(0);
  const [lines, setLines] = useState<import("@/types").LogLine[]>([]);
  const [filter, setFilter] = useState("");
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  const visible = lines.filter((l) => l.message.toLowerCase().includes(filter.toLowerCase()));
  const levelColor = (lvl: string) =>
    lvl === "ERROR" || lvl === "CRITICAL" ? "text-red" : lvl === "WARNING" ? "text-amber" : "text-muted-foreground";

  return (
    <div className="flex h-full flex-col gap-2">
      <div className="flex items-center gap-2">
        <Input placeholder="Filter lines…" value={filter} onChange={(e) => setFilter(e.target.value)} className="h-8 text-xs" />
        <button
          className="rounded-lg border border-border p-1.5 hover:bg-surface-hover"
          title="Copy visible lines"
          onClick={() => navigator.clipboard.writeText(visible.map((l) => l.message).join("\n"))}
        >
          <Copy className="size-3.5" />
        </button>
        <button
          className="rounded-lg border border-border p-1.5 hover:bg-surface-hover"
          title="Download as .log"
          onClick={() => {
            const blob = new Blob([visible.map((l) => `${l.timestamp} [${l.level}] ${l.message}`).join("\n")], {
              type: "text/plain",
            });
            const a = document.createElement("a");
            a.href = URL.createObjectURL(blob);
            a.download = `${executionId}.log`;
            a.click();
          }}
        >
          <Download className="size-3.5" />
        </button>
      </div>
      {visible.length === 0 ? (
        <EmptyState title="No logs yet" />
      ) : (
        <div className="custom-scrollbar flex-1 overflow-auto rounded-xl border border-border bg-background-elevated p-2 font-mono text-[11px]">
          {visible.map((l) => (
            <p key={l.seq} className={cn("whitespace-pre-wrap", levelColor(l.level))}>
              <span className="text-muted-foreground/60">{l.timestamp}</span> [{l.level}] {l.message}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}

function EventsTab({ events }: { events: Array<{ type: string; data: unknown; ts: number }> }) {
  if (events.length === 0) return <EmptyState title="No events recorded yet." />;
  return (
    <ul className="space-y-2">
      {events.map((e, i) => (
        <li key={i} className="rounded-xl border border-border bg-background-elevated/60 p-3">
          <p className="text-xs text-muted-foreground">{formatTimestamp(e.ts)}</p>
          <pre className="mt-1 overflow-auto text-xs text-foreground">{JSON.stringify(e.data, null, 2)}</pre>
        </li>
      ))}
    </ul>
  );
}

function TraceTab({ executionId }: { executionId: string }) {
  const { data, isLoading, error } = useQuery({
    queryKey: ["execution-trace", executionId],
    queryFn: () => executionsApi.traceSummary(executionId),
  });
  if (isLoading) return <p className="text-sm text-muted-foreground">Loading trace…</p>;
  if (error) return <p className="text-sm text-red">{errorMessage(error)}</p>;
  if (!data?.span_tree) return <EmptyState title="No trace available" />;
  return <SpanNode span={data.span_tree} depth={0} />;
}

function SpanNode({ span, depth }: { span: import("@/types").TraceSpan; depth: number }) {
  const durationNs = (span.end_time_unix_nano ?? span.start_time_unix_nano) - span.start_time_unix_nano;
  return (
    <div style={{ marginLeft: depth * 14 }} className="mb-1.5 rounded-lg border border-border bg-background-elevated/60 px-2.5 py-1.5">
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-xs font-medium text-foreground">{span.name}</span>
        <span className="text-[10px] text-muted-foreground">{formatDuration(durationNs / 1e6)}</span>
      </div>
      {span.children?.map((c) => <SpanNode key={c.span_id} span={c} depth={depth + 1} />)}
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
