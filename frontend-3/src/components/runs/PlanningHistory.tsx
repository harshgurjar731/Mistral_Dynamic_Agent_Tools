/**
 * Planning history — every planning (or agent) run the server knows, not only
 * the ones this browser watched: when it started, how long it took, how far it
 * got, what it produced or why it failed. Search, filter by outcome, grouped
 * by day. Selecting a run reopens it, replayed from the server.
 *
 * Entries the server no longer has (it keeps the most recent runs) can be
 * passed in as ``older`` — this browser's own records, and for workflows the
 * saved workflows with no planning record.
 */
import { useMemo, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  BookOpenCheck,
  CalendarClock,
  Clock,
  History,
  Layers,
  Loader2,
  MessageSquareMore,
  Search,
  Trash2,
} from "lucide-react";
import { QK, runsApi, type BackgroundRun, type RunKind, type RunStatus } from "@/api";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatDuration, parseServerTime } from "@/lib/status";
import { cn } from "@/lib/utils";
import { RUN_STATUS_META, runOutputName } from "./runMeta";

/** A record kept elsewhere (this browser, a saved workflow) — shown under the server's runs. */
export interface OlderEntry {
  id: string;
  /** The server run it recorded, if any — hidden while the server still has that run. */
  runId?: string | undefined;
  title: string;
  status: "completed" | "failed" | "cancelled";
  createdAt: number;
  output?: string | null | undefined;
  detail?: string | undefined;
  note?: string | undefined;
}

const FILTERS: Array<{ value: "all" | RunStatus | "stopped"; label: string }> = [
  { value: "all", label: "All" },
  { value: "running", label: "Running" },
  { value: "completed", label: "Done" },
  { value: "failed", label: "Failed" },
  { value: "stopped", label: "Stopped" },
];

const matchesFilter = (status: string, filter: string) =>
  filter === "all" ||
  status === filter ||
  (filter === "stopped" && (status === "cancelled" || status === "interrupted"));

function dayLabel(t: number): string {
  const d = new Date(t);
  const today = new Date();
  const start = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((start(today) - start(d)) / 86_400_000);
  if (diff === 0) return "Today";
  if (diff === 1) return "Yesterday";
  return d.toLocaleDateString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: d.getFullYear() === today.getFullYear() ? undefined : "numeric",
  });
}

const timeOf = (t: number) =>
  new Date(t).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });

function runTimes(run: BackgroundRun) {
  const start = run.created_at ? parseServerTime(run.created_at) : NaN;
  const end = run.finished_at ? parseServerTime(run.finished_at) : NaN;
  const live = run.status === "running";
  const duration = Number.isNaN(start)
    ? null
    : (live ? Date.now() : Number.isNaN(end) ? NaN : end) - start;
  return { start, duration: duration != null && !Number.isNaN(duration) ? duration : null };
}

function processUsed(run: BackgroundRun): string | null {
  const pk = run.request?.["process_knowledge"] as
    { enabled?: boolean; document_ids?: unknown[] } | undefined;
  if (!pk?.enabled) return null;
  const docs = pk.document_ids?.length ?? 0;
  return docs ? `Process knowledge · ${docs} doc${docs === 1 ? "" : "s"}` : "Process knowledge";
}

function RunRow({
  run,
  active,
  onOpen,
}: {
  run: BackgroundRun;
  active: boolean;
  onOpen: () => void;
}) {
  const meta = RUN_STATUS_META[run.status] ?? RUN_STATUS_META.failed;
  const Icon = meta.icon;
  const { start, duration } = runTimes(run);
  const output = runOutputName(run);
  const { total, done } = run.progress ?? { total: 0, done: 0 };
  const pct = total ? Math.round((done / total) * 100) : run.status === "completed" ? 100 : 0;
  const pk = processUsed(run);
  const asked = run.progress?.note?.startsWith("Waiting for your decision");

  return (
    <button
      type="button"
      onClick={onOpen}
      className={cn(
        "group w-full rounded-xl border p-3 text-left transition-colors hover:border-primary/50 hover:bg-surface-hover/40",
        active ? "border-primary/50 bg-primary/5" : "border-border",
      )}
    >
      <div className="flex items-start gap-2">
        <p className="line-clamp-2 min-w-0 flex-1 text-[13px] leading-snug font-medium text-foreground">
          {run.title || "Untitled run"}
        </p>
        <span
          className={cn(
            "flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold",
            meta.chip,
          )}
        >
          <Icon className={cn("size-2.5", run.status === "running" && "animate-spin")} />
          {meta.label}
        </span>
      </div>

      {output ? <p className="mt-1 truncate font-mono text-[11px] text-primary">{output}</p> : null}
      {run.error && run.status !== "completed" ? (
        <p className="mt-1 line-clamp-2 text-[11px] leading-snug text-red/90">{run.error}</p>
      ) : null}
      {asked ? (
        <p className="mt-1 flex items-center gap-1 text-[11px] text-amber">
          <MessageSquareMore className="size-3" /> Waiting for your answer
        </p>
      ) : null}

      <div className="mt-2 flex items-center gap-2">
        <div className="h-1 flex-1 overflow-hidden rounded-full bg-border/60">
          <div
            className={cn("h-full rounded-full", meta.bar)}
            style={{ width: `${Math.max(pct, run.status === "running" ? 4 : 0)}%` }}
          />
        </div>
        <span className="flex shrink-0 items-center gap-1 text-[10px] text-muted-foreground tabular-nums">
          <Layers className="size-2.5" />
          {total ? `${done}/${total}` : "—"}
        </span>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-muted-foreground">
        {!Number.isNaN(start) ? (
          <span className="flex items-center gap-1 tabular-nums">
            <CalendarClock className="size-2.5" /> {timeOf(start)}
          </span>
        ) : null}
        {duration != null ? (
          <span className="flex items-center gap-1 tabular-nums">
            <Clock className="size-2.5" /> {formatDuration(duration)}
            {run.status === "running" ? " so far" : ""}
          </span>
        ) : null}
        {pk ? (
          <span className="flex items-center gap-1 text-indigo">
            <BookOpenCheck className="size-2.5" /> {pk}
          </span>
        ) : null}
        <span className="ml-auto font-mono opacity-0 transition-opacity group-hover:opacity-100">
          {run.id.slice(0, 8)}
        </span>
      </div>
    </button>
  );
}

function OlderRow({
  entry,
  active,
  onOpen,
}: {
  entry: OlderEntry;
  active: boolean;
  onOpen: () => void;
}) {
  const meta =
    RUN_STATUS_META[entry.status === "cancelled" ? "cancelled" : entry.status] ??
    RUN_STATUS_META.failed;
  return (
    <button
      type="button"
      onClick={onOpen}
      className={cn(
        "w-full rounded-xl border p-3 text-left transition-colors hover:border-primary/50",
        active ? "border-primary/50 bg-primary/5" : "border-border/70",
      )}
    >
      <div className="flex items-start gap-2">
        <p className="line-clamp-2 min-w-0 flex-1 text-[12px] leading-snug text-foreground">
          {entry.title}
        </p>
        <span
          className={cn(
            "shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-semibold",
            meta.chip,
          )}
        >
          {meta.label}
        </span>
      </div>
      {entry.output ? (
        <p className="mt-1 truncate font-mono text-[11px] text-primary">{entry.output}</p>
      ) : null}
      <p className="mt-1.5 text-[10px] text-muted-foreground">
        {entry.note ?? (entry.createdAt ? new Date(entry.createdAt).toLocaleString() : "")}
      </p>
    </button>
  );
}

function Summary({ runs }: { runs: BackgroundRun[] }) {
  const finished = runs.filter((r) => r.status !== "running");
  const ok = finished.filter((r) => r.status === "completed").length;
  const durations = finished
    .map((r) => runTimes(r).duration)
    .filter((d): d is number => d != null)
    .sort((a, b) => a - b);
  const median = durations.length ? durations[Math.floor(durations.length / 2)] : null;
  const items: Array<[string, ReactNode]> = [
    ["Runs", runs.length],
    ["Succeeded", finished.length ? `${Math.round((ok / finished.length) * 100)}%` : "—"],
    ["Typical time", median != null ? formatDuration(median) : "—"],
  ];
  return (
    <div className="grid grid-cols-3 gap-2">
      {items.map(([label, value]) => (
        <div key={label} className="rounded-lg border border-border/60 px-2.5 py-1.5">
          <p className="text-[9px] font-medium tracking-wider text-muted-foreground uppercase">
            {label}
          </p>
          <p className="font-mono text-sm font-semibold text-foreground tabular-nums">{value}</p>
        </div>
      ))}
    </div>
  );
}

export function PlanningHistory({
  kind,
  title,
  open,
  onOpenChange,
  activeRunId,
  onOpenRun,
  older = [],
  activeOlderId,
  onOpenOlder,
  onClearOlder,
}: {
  kind: RunKind;
  title: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  activeRunId: string | null;
  onOpenRun: (runId: string) => void;
  older?: OlderEntry[];
  activeOlderId?: string | null;
  onOpenOlder?: (id: string) => void;
  onClearOlder?: () => void;
}) {
  const [filter, setFilter] = useState<(typeof FILTERS)[number]["value"]>("all");
  const [search, setSearch] = useState("");

  const q = useQuery({
    queryKey: QK.runHistory(kind),
    queryFn: () => runsApi.list({ kind, limit: 200 }),
    enabled: open,
    refetchInterval: (query) =>
      query.state.data?.runs.some((r) => r.status === "running") ? 4000 : false,
  });
  const runs = useMemo(() => q.data?.runs ?? [], [q.data]);

  const needle = search.trim().toLowerCase();
  const matches = (text: string | null | undefined) =>
    !needle || (text ?? "").toLowerCase().includes(needle);

  const shown = runs.filter(
    (r) =>
      matchesFilter(r.status, filter) &&
      (matches(r.title) || matches(runOutputName(r)) || matches(r.error)),
  );
  const groups = useMemo(() => {
    const out: Array<{ day: string; runs: BackgroundRun[] }> = [];
    for (const r of shown) {
      const t = r.created_at ? parseServerTime(r.created_at) : NaN;
      const day = Number.isNaN(t) ? "Earlier" : dayLabel(t);
      const last = out[out.length - 1];
      if (last && last.day === day) last.runs.push(r);
      else out.push({ day, runs: [r] });
    }
    return out;
  }, [shown]);

  const serverIds = new Set(runs.map((r) => r.id));
  const olderShown = older.filter(
    (e) =>
      !(e.runId && serverIds.has(e.runId)) &&
      matchesFilter(e.status, filter) &&
      (matches(e.title) || matches(e.output)),
  );

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        resizeKey={`planning-history-${kind}`}
        className="flex w-[440px] max-w-[100vw] flex-col gap-0 p-0 sm:max-w-[440px]"
      >
        <div className="space-y-3 border-b border-border px-5 py-4">
          <div className="flex items-center gap-2">
            <History className="size-4 text-primary" />
            <SheetTitle className="text-sm font-semibold text-foreground">{title}</SheetTitle>
            {q.isFetching ? (
              <Loader2 className="size-3.5 animate-spin text-muted-foreground" />
            ) : null}
            <SheetDescription className="sr-only">
              Past runs with their start time, duration, progress and outcome. Select one to open
              it.
            </SheetDescription>
          </div>
          {runs.length ? <Summary runs={runs} /> : null}
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search goals, outputs and errors"
              className="h-8 pl-8 text-xs"
            />
          </div>
          <div className="flex flex-wrap gap-1">
            {FILTERS.map((f) => {
              const n =
                f.value === "all"
                  ? runs.length
                  : runs.filter((r) => matchesFilter(r.status, f.value)).length;
              return (
                <button
                  key={f.value}
                  type="button"
                  onClick={() => setFilter(f.value)}
                  className={cn(
                    "rounded-md border px-2 py-0.5 text-[11px] transition",
                    filter === f.value
                      ? "border-primary/50 bg-primary/10 text-primary"
                      : "border-border text-muted-foreground hover:text-foreground",
                  )}
                >
                  {f.label}
                  <span className="ml-1 tabular-nums opacity-70">{n}</span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="custom-scrollbar flex-1 space-y-4 overflow-y-auto p-4">
          {q.isLoading ? (
            <div className="space-y-2">
              {[0, 1, 2].map((i) => (
                <div key={i} className="shimmer h-24 rounded-xl border border-border/50" />
              ))}
            </div>
          ) : q.isError ? (
            <p className="text-xs text-red">Could not load the history from the server.</p>
          ) : null}

          {groups.map((g) => (
            <section key={g.day} className="space-y-2">
              <h3 className="sticky top-0 z-10 bg-background/90 py-0.5 text-[10px] font-semibold tracking-wider text-muted-foreground uppercase backdrop-blur">
                {g.day}
              </h3>
              {g.runs.map((r) => (
                <RunRow
                  key={r.id}
                  run={r}
                  active={r.id === activeRunId}
                  onOpen={() => onOpenRun(r.id)}
                />
              ))}
            </section>
          ))}

          {!q.isLoading && !shown.length && !olderShown.length ? (
            <div className="flex h-40 flex-col items-center justify-center text-center">
              <History className="mb-2 size-5 text-muted-foreground" />
              <p className="text-sm text-foreground">
                {runs.length || older.length ? "Nothing matches" : "No runs yet"}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {runs.length || older.length
                  ? "Try another filter or search."
                  : "Runs you start appear here with their timings."}
              </p>
            </div>
          ) : null}

          {olderShown.length && onOpenOlder ? (
            <section className="space-y-2">
              <h3 className="text-[10px] font-semibold tracking-wider text-muted-foreground uppercase">
                Older — no longer on the server
              </h3>
              {olderShown.map((e) => (
                <OlderRow
                  key={e.id}
                  entry={e}
                  active={e.id === activeOlderId}
                  onOpen={() => onOpenOlder(e.id)}
                />
              ))}
            </section>
          ) : null}
        </div>

        {onClearOlder && older.some((e) => !e.note) ? (
          <div className="border-t border-border p-3">
            <Button
              variant="ghost"
              size="sm"
              onClick={onClearOlder}
              className="w-full text-xs text-muted-foreground hover:bg-red/10 hover:text-red"
            >
              <Trash2 className="size-3.5" /> Forget this browser’s older records
            </Button>
          </div>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
