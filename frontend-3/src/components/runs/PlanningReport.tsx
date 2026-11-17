/**
 * The planning report of one run: when it started and ended, where the time
 * went layer by layer, every question it asked and how long it waited for the
 * answer, the model and tool calls it made, rewinds and errors.
 *
 * Built from GET /runs/{id}/report, refreshed while the run is live. Shared by
 * the workflow planner and the agent page.
 */
import { useMemo, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  Bot,
  CalendarClock,
  Check,
  ChevronDown,
  CircleSlash,
  Clock,
  Cpu,
  Hourglass,
  Layers,
  Loader2,
  MessageSquareMore,
  Minus,
  RotateCcw,
  Timer,
  Wrench,
} from "lucide-react";
import { QK, runsApi, type ReportLayer, type RunReport } from "@/api";
import { formatDuration, parseServerTime } from "@/lib/status";
import { cn } from "@/lib/utils";

/* ── Formatting ──────────────────────────────────────────────────────── */

const clock = (ms: number | null | undefined) =>
  ms
    ? new Date(ms).toLocaleTimeString(undefined, {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      })
    : "—";

const dateTime = (iso: string | null | undefined) => {
  if (!iso) return "—";
  const t = parseServerTime(iso);
  return Number.isNaN(t)
    ? iso
    : new Date(t).toLocaleString(undefined, {
        day: "numeric",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      });
};

/** A layer's time: measured, else elapsed while it runs. */
const layerMs = (l: ReportLayer) => l.ms ?? l.elapsed_ms ?? null;

/* ── Status of a layer — colour always paired with an icon and a word ── */

const LAYER_STATE: Record<
  string,
  { label: string; bar: string; text: string; icon: (c: string) => ReactNode }
> = {
  completed: {
    label: "Done",
    bar: "bg-emerald",
    text: "text-emerald",
    icon: (c) => <Check className={c} />,
  },
  failed: {
    label: "Failed",
    bar: "bg-red",
    text: "text-red",
    icon: (c) => <AlertTriangle className={c} />,
  },
  active: {
    label: "Running",
    bar: "bg-primary animate-pulse",
    text: "text-primary",
    icon: (c) => <Loader2 className={cn(c, "animate-spin")} />,
  },
  skipped: {
    label: "Skipped",
    bar: "bg-muted-foreground/40",
    text: "text-muted-foreground",
    icon: (c) => <CircleSlash className={c} />,
  },
  pending: {
    label: "Not run",
    bar: "bg-border",
    text: "text-muted-foreground",
    icon: (c) => <Minus className={c} />,
  },
};
const stateOf = (s: string) => LAYER_STATE[s] ?? LAYER_STATE["pending"]!;

/* ── Pieces ──────────────────────────────────────────────────────────── */

function Stat({
  icon,
  label,
  value,
  sub,
  tone,
}: {
  icon: ReactNode;
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  tone?: string | undefined;
}) {
  return (
    <div className="min-w-0 rounded-xl border border-border/60 bg-background-elevated/50 px-3 py-2.5">
      <p className="flex items-center gap-1.5 text-[10px] font-medium tracking-wider text-muted-foreground uppercase">
        {icon}
        {label}
      </p>
      <p
        className={cn(
          "mt-1 truncate font-mono text-base font-semibold text-foreground tabular-nums",
          tone,
        )}
      >
        {value}
      </p>
      {sub ? <p className="mt-0.5 truncate text-[10px] text-muted-foreground">{sub}</p> : null}
    </div>
  );
}

function Section({
  title,
  count,
  children,
  defaultOpen = true,
}: {
  title: string;
  count?: number | undefined;
  children: ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="border-t border-border/60 pt-3">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 text-left"
      >
        <span className="text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
          {title}
        </span>
        {count != null ? (
          <span className="rounded-full border border-border px-1.5 text-[10px] text-muted-foreground tabular-nums">
            {count}
          </span>
        ) : null}
        <ChevronDown
          className={cn(
            "ml-auto size-3.5 text-muted-foreground transition-transform",
            !open && "-rotate-90",
          )}
        />
      </button>
      {open ? <div className="mt-2.5">{children}</div> : null}
    </section>
  );
}

interface ChartRowProps {
  id: string;
  label: ReactNode;
  left: number;
  width: number;
  bar: string;
  tip: ReactNode;
  value: string;
  hatched?: boolean;
  hover: string | null;
  onHover: (id: string | null) => void;
}

function ChartRow({
  id,
  label,
  left,
  width,
  bar,
  tip,
  value,
  hatched,
  hover,
  onHover,
}: ChartRowProps) {
  return (
    <div
      className="group grid grid-cols-[minmax(0,9.5rem)_1fr_3.5rem] items-center gap-2 py-[3px]"
      onMouseEnter={() => onHover(id)}
      onMouseLeave={() => onHover(null)}
    >
      <span className="truncate text-[11px] text-foreground/90">{label}</span>
      <div className="relative h-4 rounded-sm">
        <div
          className={cn(
            "absolute top-1 h-2 rounded-[4px] transition-[filter]",
            bar,
            hover === id && "brightness-110",
          )}
          style={{
            left: `${Math.min(99.5, left * 100)}%`,
            width: `max(3px, ${Math.min(100 - left * 100, width * 100)}%)`,
            ...(hatched
              ? {
                  backgroundImage:
                    "repeating-linear-gradient(45deg, transparent 0 3px, rgb(255 255 255 / 0.35) 3px 5px)",
                }
              : {}),
          }}
        />
        {hover === id ? (
          <div
            role="tooltip"
            className="pointer-events-none absolute bottom-full z-20 mb-1.5 w-max max-w-[18rem] rounded-lg border border-border-strong bg-popover px-2.5 py-1.5 text-[11px] leading-relaxed text-popover-foreground shadow-xl"
            style={{ left: `${Math.min(70, left * 100)}%` }}
          >
            {tip}
          </div>
        ) : null}
      </div>
      <span className="text-right font-mono text-[10px] text-muted-foreground tabular-nums">
        {value}
      </span>
    </div>
  );
}

/**
 * Where the time went: one row per layer on a shared time axis (or, for runs
 * recorded before start times were kept, bars sized by duration alone). Waits
 * for an answer sit on their own row, so working time and waiting time read
 * apart. Every bar has a hover card; the list under it is the table view.
 */
function TimeChart({ report }: { report: RunReport }) {
  const [hover, setHover] = useState<string | null>(null);
  const layers = report.layers.filter((l) => !l.stage && (layerMs(l) != null || l.started_at));
  const total =
    report.duration_ms ?? Math.max(1, ...layers.map((l) => (l.offset_ms ?? 0) + (layerMs(l) ?? 0)));
  const timed = report.timed && layers.some((l) => l.offset_ms != null);
  const longest = Math.max(1, ...layers.map((l) => layerMs(l) ?? 0));
  const waits = report.decisions.filter((d) => d.offset_ms != null && d.waited_ms);

  if (!layers.length) {
    return <p className="text-xs text-muted-foreground">No layer has run yet.</p>;
  }

  const ticks = timed ? [0, 0.25, 0.5, 0.75, 1] : [];

  return (
    <div>
      {timed ? (
        <div className="grid grid-cols-[minmax(0,9.5rem)_1fr_3.5rem] gap-2 pb-1">
          <span />
          <div className="relative h-3.5">
            {ticks.map((t) => (
              <span
                key={t}
                className="absolute -translate-x-1/2 font-mono text-[9px] text-muted-foreground/80 tabular-nums first:translate-x-0 last:-translate-x-full"
                style={{ left: `${t * 100}%` }}
              >
                {formatDuration(t * total)}
              </span>
            ))}
          </div>
          <span />
        </div>
      ) : (
        <p className="mb-1.5 text-[10px] text-muted-foreground">
          This run was recorded before start times were kept — bars show each layer’s duration.
        </p>
      )}
      <div
        className={cn(
          "relative",
          timed &&
            "bg-[linear-gradient(to_right,var(--border)_1px,transparent_1px)] bg-[length:25%_100%]",
        )}
      >
        {layers.map((l) => {
          const ms = layerMs(l) ?? 0;
          const st = stateOf(l.state);
          return (
            <ChartRow
              key={l.name}
              id={l.name}
              hover={hover}
              onHover={setHover}
              label={
                <span className="flex items-center gap-1.5">
                  <span className={st.text}>{st.icon("size-3 shrink-0")}</span>
                  <span className="truncate">{l.label}</span>
                </span>
              }
              left={timed ? (l.offset_ms ?? 0) / total : 0}
              width={timed ? ms / total : ms / longest}
              bar={st.bar}
              value={formatDuration(ms)}
              tip={
                <>
                  <p className="font-medium">{l.label}</p>
                  <p className="text-muted-foreground">
                    {st.label} · {formatDuration(ms)}
                    {l.runs > 1 ? ` · ran ${l.runs}×` : ""}
                  </p>
                  {l.started_at ? (
                    <p className="text-muted-foreground">
                      {clock(l.started_at)} → {l.ended_at ? clock(l.ended_at) : "now"}
                    </p>
                  ) : null}
                  {l.summary ? <p className="mt-0.5">{l.summary}</p> : null}
                </>
              }
            />
          );
        })}
        {timed && waits.length ? (
          <div className="mt-1 border-t border-dashed border-border/70 pt-1">
            {waits.map((d) => (
              <ChartRow
                key={d.id}
                id={`wait-${d.id}`}
                hover={hover}
                onHover={setHover}
                label={
                  <span className="flex items-center gap-1.5 text-amber">
                    <Hourglass className="size-3 shrink-0" />
                    <span className="truncate">Waiting for you</span>
                  </span>
                }
                left={(d.offset_ms ?? 0) / total}
                width={(d.waited_ms ?? 0) / total}
                bar="bg-amber/80"
                hatched
                value={formatDuration(d.waited_ms)}
                tip={
                  <>
                    <p className="font-medium">{d.title ?? "A question"}</p>
                    <p className="text-muted-foreground">
                      Waited {formatDuration(d.waited_ms)}
                      {d.choice
                        ? ` · ${d.by === "timeout" ? "deadline took" : "answered"} “${d.choice}”`
                        : " · still waiting"}
                    </p>
                  </>
                }
              />
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function LayerTable({ report }: { report: RunReport }) {
  return (
    <ol className="space-y-1">
      {report.layers.map((l) => {
        const st = stateOf(l.state);
        if (l.stage) {
          return (
            <li
              key={l.name}
              className="pt-1.5 text-[10px] font-semibold tracking-wider text-muted-foreground uppercase"
            >
              {l.label}
            </li>
          );
        }
        return (
          <li
            key={l.name}
            className={cn(
              "rounded-lg border px-2.5 py-1.5",
              l.state === "failed" ? "border-red/30 bg-red/5" : "border-border/50",
            )}
            style={{ marginLeft: l.depth ? 10 : 0 }}
          >
            <div className="flex items-center gap-2 text-[11px]">
              <span className={cn("flex items-center gap-1", st.text)}>
                {st.icon("size-3")}
                <span className="sr-only">{st.label}</span>
              </span>
              <span className="min-w-0 flex-1 truncate font-medium text-foreground">{l.label}</span>
              {l.runs > 1 ? (
                <span className="shrink-0 rounded-full border border-amber/30 bg-amber/10 px-1.5 text-[9px] text-amber">
                  ran {l.runs}×
                </span>
              ) : null}
              {l.started_at ? (
                <span className="shrink-0 font-mono text-[10px] text-muted-foreground tabular-nums">
                  {clock(l.started_at)}
                </span>
              ) : null}
              <span className="w-14 shrink-0 text-right font-mono text-[10px] text-foreground tabular-nums">
                {formatDuration(layerMs(l))}
              </span>
            </div>
            {l.summary ? (
              <p className="mt-0.5 pl-5 text-[10.5px] leading-snug text-muted-foreground">
                {l.summary}
              </p>
            ) : null}
            {l.error ? (
              <p className="mt-0.5 pl-5 text-[10.5px] leading-snug break-words text-red">
                {l.error}
              </p>
            ) : null}
            {l.subs.length ? (
              <div className="mt-1 flex flex-wrap gap-1 pl-5">
                {l.subs.map((s) => {
                  const ss = stateOf(s.state);
                  return (
                    <span
                      key={s.id}
                      title={s.error ?? s.summary ?? undefined}
                      className="inline-flex items-center gap-1 rounded border border-border/60 px-1.5 py-0.5 text-[10px] text-muted-foreground"
                    >
                      <span className={ss.text}>{ss.icon("size-2.5")}</span>
                      {s.label}
                      {s.ms != null ? (
                        <span className="font-mono tabular-nums">{formatDuration(s.ms)}</span>
                      ) : null}
                    </span>
                  );
                })}
              </div>
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}

/* ── The report ──────────────────────────────────────────────────────── */

export function PlanningReport({
  runId,
  live,
  className,
}: {
  runId: string;
  /** Refresh while the run is going. */
  live: boolean;
  className?: string;
}) {
  const q = useQuery({
    queryKey: QK.runReport(runId),
    queryFn: () => runsApi.report(runId),
    refetchInterval: live ? 3000 : false,
    retry: 1,
  });
  const report = q.data;

  const calls = useMemo(() => {
    const by = Object.fromEntries((report?.calls ?? []).map((c) => [c.kind, c]));
    return { model: by["model"], tool: by["tool"] };
  }, [report?.calls]);

  if (q.isLoading) {
    return (
      <div className={cn("grid gap-2 sm:grid-cols-4", className)}>
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="shimmer h-16 rounded-xl border border-border/50" />
        ))}
      </div>
    );
  }
  if (!report) {
    return (
      <p className={cn("text-xs text-muted-foreground", className)}>
        The run’s details could not be loaded.
      </p>
    );
  }

  const answered = report.decisions.filter((d) => d.choice != null);
  const byDeadline = answered.filter((d) => d.by === "timeout").length;
  const lc = report.layer_counts;

  return (
    <div className={cn("space-y-3", className)}>
      {/* Headline numbers */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat
          icon={<CalendarClock className="size-3" />}
          label="Started"
          value={<span className="text-sm">{dateTime(report.started_at)}</span>}
          sub={
            report.finished_at
              ? `Ended ${dateTime(report.finished_at)}`
              : live
                ? "Still running"
                : "No end recorded"
          }
        />
        <Stat
          icon={<Timer className="size-3" />}
          label={live ? "Elapsed" : "Total time"}
          value={formatDuration(report.duration_ms)}
          sub={
            report.waiting_ms
              ? `${formatDuration(report.working_ms)} working · ${formatDuration(report.waiting_ms)} waiting for you`
              : "No waiting for answers"
          }
        />
        <Stat
          icon={<Layers className="size-3" />}
          label="Layers"
          value={`${lc.completed}/${lc.total}`}
          tone={lc.failed ? "text-red" : undefined}
          sub={
            [
              lc.failed ? `${lc.failed} failed` : null,
              lc.skipped ? `${lc.skipped} skipped` : null,
              report.rewinds.length
                ? `${report.rewinds.length} rewind${report.rewinds.length === 1 ? "" : "s"}`
                : null,
            ]
              .filter(Boolean)
              .join(" · ") || "None failed"
          }
        />
        <Stat
          icon={<MessageSquareMore className="size-3" />}
          label="Questions"
          value={report.decisions.length}
          sub={
            report.decisions.length
              ? `${answered.length - byDeadline} by you${byDeadline ? ` · ${byDeadline} by deadline` : ""}`
              : "None asked"
          }
        />
        <Stat
          icon={<Cpu className="size-3" />}
          label="Model calls"
          value={calls.model?.count ?? 0}
          sub={
            calls.model
              ? `${formatDuration(calls.model.ms)} in models${calls.model.failed ? ` · ${calls.model.failed} failed` : ""}`
              : "—"
          }
        />
        <Stat
          icon={<Wrench className="size-3" />}
          label="Tool calls"
          value={calls.tool?.count ?? 0}
          sub={
            calls.tool
              ? `${formatDuration(calls.tool.ms)}${calls.tool.failed ? ` · ${calls.tool.failed} failed` : ""}`
              : "—"
          }
        />
        <Stat
          icon={<AlertTriangle className="size-3" />}
          label="Errors"
          value={report.errors.length}
          tone={report.errors.length ? "text-red" : undefined}
          sub={report.errors.length ? clock(report.errors[0]?.at) : "None reported"}
        />
        <Stat
          icon={<Clock className="size-3" />}
          label="Events"
          value={Object.values(report.event_counts).reduce((a, b) => a + b, 0)}
          sub={`${report.event_counts["log"] ?? 0} log lines`}
        />
      </div>

      <Section title="Where the time went">
        <TimeChart report={report} />
      </Section>

      <Section title="Layers" count={lc.total} defaultOpen={false}>
        <LayerTable report={report} />
      </Section>

      {report.decisions.length ? (
        <Section title="Questions asked" count={report.decisions.length}>
          <ul className="space-y-1.5">
            {report.decisions.map((d) => (
              <li key={d.id} className="rounded-lg border border-border/50 px-2.5 py-2 text-[11px]">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                  <span className="min-w-0 flex-1 font-medium text-foreground">
                    {d.title ?? d.kind}
                  </span>
                  <span className="font-mono text-[10px] text-muted-foreground tabular-nums">
                    asked {clock(d.asked_at)}
                  </span>
                </div>
                <p className="mt-0.5 text-muted-foreground">
                  {d.choice != null ? (
                    <>
                      {d.by === "timeout" ? "The deadline took " : "Answered "}
                      <span className="font-medium text-foreground">“{d.choice}”</span>
                      {d.recommended && d.choice === d.recommended ? " (recommended)" : ""}
                      {d.answered_at ? ` at ${clock(d.answered_at)}` : ""}
                    </>
                  ) : (
                    <span className="text-amber">Waiting for an answer</span>
                  )}
                  {d.waited_ms != null ? ` · waited ${formatDuration(d.waited_ms)}` : ""}
                  {d.extended
                    ? ` · kept waiting ${d.extended} time${d.extended === 1 ? "" : "s"}`
                    : ""}
                </p>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      {report.models.length ? (
        <Section title="Models used" count={report.models.length} defaultOpen={false}>
          <ul className="space-y-1">
            {report.models.map((m) => (
              <li key={m.name} className="flex items-center gap-2 text-[11px]">
                <Bot className="size-3 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1 truncate font-mono text-foreground">{m.name}</span>
                <span className="text-muted-foreground tabular-nums">
                  {m.count} call{m.count === 1 ? "" : "s"}
                </span>
                <span className="w-16 text-right font-mono text-[10px] text-foreground tabular-nums">
                  {formatDuration(m.ms)}
                </span>
                {m.failed ? <span className="text-[10px] text-red">{m.failed} failed</span> : null}
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      {report.rewinds.length ? (
        <Section title="Rewinds" count={report.rewinds.length} defaultOpen={false}>
          <ul className="space-y-1">
            {report.rewinds.map((r, i) => (
              <li key={i} className="flex items-start gap-2 text-[11px] text-muted-foreground">
                <RotateCcw className="mt-0.5 size-3 shrink-0 text-amber" />
                <span className="min-w-0">
                  Round {r.round ?? i + 1}: back to{" "}
                  <span className="font-mono text-foreground">{r.to}</span>
                  {r.from ? (
                    <>
                      {" "}
                      from <span className="font-mono text-foreground">{r.from}</span>
                    </>
                  ) : null}
                  {r.at ? ` at ${clock(r.at)}` : ""}
                  {r.reason ? ` — ${r.reason}` : ""}
                </span>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      {report.errors.length ? (
        <Section title="Errors" count={report.errors.length}>
          <ul className="space-y-1">
            {report.errors.map((e, i) => (
              <li
                key={i}
                className="rounded-lg border border-red/30 bg-red/5 px-2.5 py-1.5 text-[11px] break-words text-red"
              >
                {e.at ? (
                  <span className="mr-1.5 font-mono text-[10px] text-red/70">{clock(e.at)}</span>
                ) : null}
                {e.message}
              </li>
            ))}
          </ul>
        </Section>
      ) : null}
    </div>
  );
}
