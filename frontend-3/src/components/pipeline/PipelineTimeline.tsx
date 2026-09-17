/**
 * PipelineTimeline — draws an orchestration run as the layer chain it is.
 *
 * Both orchestrators (agent creation and workflow planning) are a known,
 * ordered chain of single-decision layers, and the backend sends that chain as
 * a manifest before the run starts. The timeline therefore shows the whole
 * pipeline from the first frame, marks the current position, and attaches each
 * decision's evidence to the layer that made it.
 *
 * A row with evidence is expandable: collapsed it shows the decision and its
 * one-line reasoning, expanded it shows the card the layer produced and,
 * optionally, the raw JSON behind it. The running row opens itself so progress
 * is visible without a click.
 */
import { AnimatePresence, motion } from "framer-motion";
import { AlertTriangle, Check, ChevronRight, Code, GitMerge, Loader2, Minus } from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { formatDuration } from "@/lib/status";

export type LayerState = "pending" | "active" | "completed" | "skipped" | "failed";

export interface LayerManifestEntry {
  name: string;
  label: string;
  detail: string;
  hidden?: boolean | undefined;
  concurrent?: LayerManifestEntry[] | undefined;
}

export interface LayerRuntime {
  state: LayerState;
  ms?: number | undefined;
  summary?: string | undefined;
  error?: string | undefined;
}

interface Props {
  manifest: LayerManifestEntry[];
  runtime: Record<string, LayerRuntime>;
  /** Rendered evidence, keyed by the layer that produced it. */
  cards?: Record<string, ReactNode> | undefined;
  /** Raw decision payloads, keyed by layer, for the JSON view. */
  raw?: Record<string, unknown> | undefined;
  /** Free-text sub-progress from the layer currently running. */
  activeNote?: string | undefined;
}

const DOT: Record<LayerState, string> = {
  pending: "border-border bg-background text-muted-foreground",
  active: "border-primary/50 bg-primary/15 text-primary",
  completed: "border-emerald/40 bg-emerald/15 text-emerald",
  skipped: "border-border bg-background-elevated text-muted-foreground",
  failed: "border-red/40 bg-red/15 text-red",
};

const PENDING: LayerRuntime = { state: "pending" };

function StateIcon({ state, className }: { state: LayerState; className?: string }) {
  if (state === "active") return <Loader2 className={cn("size-3 animate-spin", className)} />;
  if (state === "completed") return <Check className={cn("size-3", className)} />;
  if (state === "failed") return <AlertTriangle className={cn("size-3", className)} />;
  if (state === "skipped") return <Minus className={cn("size-3", className)} />;
  return <span className="size-1.5 rounded-full bg-muted-foreground/40" />;
}

function Duration({ ms }: { ms?: number | undefined }) {
  if (ms === undefined) return null;
  return (
    <span className="font-mono text-[10px] tabular-nums text-muted-foreground">
      {formatDuration(ms)}
    </span>
  );
}

/** One branch of a concurrent block — compact, since several sit together. */
function Branch({ entry, run }: { entry: LayerManifestEntry; run: LayerRuntime }) {
  const dim = run.state === "pending" || run.state === "skipped";
  return (
    <li className="relative pl-7">
      <span
        className={cn(
          "absolute top-0 left-0 grid size-[18px] place-items-center rounded-full border",
          DOT[run.state],
        )}
      >
        <StateIcon state={run.state} className="size-2.5" />
      </span>
      <div className="flex flex-wrap items-baseline gap-2">
        <span
          className={cn(
            "text-xs font-medium transition-colors",
            dim ? "text-muted-foreground" : "text-foreground",
          )}
        >
          {entry.label}
        </span>
        <Duration ms={run.ms} />
      </div>
      <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">
        {run.summary || entry.detail}
      </p>
      {run.error ? <p className="mt-0.5 text-[11px] text-red">{run.error}</p> : null}
    </li>
  );
}

/** Overall progress across the drawn chain. */
function ProgressBar({ done, total, failed }: { done: number; total: number; failed: number }) {
  const pct = total ? Math.round((done / total) * 100) : 0;
  return (
    <div className="mb-5">
      <div className="mb-1.5 flex items-center justify-between">
        <span className="text-[10px] font-semibold tracking-wider text-muted-foreground uppercase">
          {done} of {total} decisions
          {failed > 0 ? <span className="text-red"> · {failed} failed</span> : null}
        </span>
        <span className="font-mono text-[10px] tabular-nums text-muted-foreground">{pct}%</span>
      </div>
      <div className="h-1 overflow-hidden rounded-full bg-border/60">
        <motion.div
          className={cn("h-full rounded-full", failed > 0 ? "bg-red" : "bg-gradient-brand")}
          initial={false}
          animate={{ width: `${pct}%` }}
          transition={{ duration: 0.4 }}
        />
      </div>
    </div>
  );
}

export function PipelineTimeline({ manifest, runtime, cards, raw, activeNote }: Props) {
  const visible = useMemo(() => manifest.filter((e) => !e.hidden), [manifest]);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [showRaw, setShowRaw] = useState<Record<string, boolean>>({});

  const stateOf = (name: string): LayerRuntime => runtime[name] ?? PENDING;

  // The running layer opens itself, only on the transition into `active`, so a
  // row the user closed by hand is not reopened underneath them.
  const activeName = visible.find((e) => stateOf(e.name).state === "active")?.name;
  useEffect(() => {
    if (activeName) setOpen((prev) => (prev[activeName] ? prev : { ...prev, [activeName]: true }));
  }, [activeName]);

  const { done, failed } = useMemo(() => {
    let d = 0;
    let f = 0;
    for (const e of visible) {
      const st = (runtime[e.name] ?? PENDING).state;
      if (st === "completed" || st === "skipped") d++;
      if (st === "failed") f++;
    }
    return { done: d + f, failed: f };
  }, [visible, runtime]);

  if (visible.length === 0) return null;

  const toggle = (name: string) => setOpen((p) => ({ ...p, [name]: !p[name] }));

  return (
    <div>
      <ProgressBar done={done} total={visible.length} failed={failed} />

      <ol className="relative space-y-4 pl-7">
        <span
          aria-hidden
          className="absolute top-2 bottom-2 left-[11px] w-px bg-gradient-to-b from-primary/50 via-border to-transparent"
        />
        {visible.map((entry) => {
          const run = stateOf(entry.name);
          const dim = run.state === "pending" || run.state === "skipped";
          const branches = (entry.concurrent ?? []).filter((b) => !b.hidden);
          const card = cards?.[entry.name];
          const rawPayload = raw?.[entry.name];
          const expandable = Boolean(card || branches.length > 0 || rawPayload !== undefined);
          const isOpen = open[entry.name] ?? false;

          return (
            <motion.li
              key={entry.name}
              layout
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              className="relative"
            >
              <span
                className={cn(
                  "absolute top-0.5 -left-7 grid size-[22px] place-items-center rounded-full border transition-colors duration-300",
                  DOT[run.state],
                )}
              >
                <StateIcon state={run.state} />
              </span>

              <div
                role={expandable ? "button" : undefined}
                tabIndex={expandable ? 0 : undefined}
                aria-expanded={expandable ? isOpen : undefined}
                onClick={() => expandable && toggle(entry.name)}
                onKeyDown={(e) => {
                  if (expandable && (e.key === "Enter" || e.key === " ")) {
                    e.preventDefault();
                    toggle(entry.name);
                  }
                }}
                className={cn(
                  "group -mx-2 rounded-lg px-2 py-0.5",
                  expandable && "cursor-pointer transition-colors hover:bg-surface-hover/60",
                )}
              >
                <div className="flex flex-wrap items-baseline gap-2">
                  <p
                    className={cn(
                      "text-sm transition-colors duration-300",
                      run.state === "active"
                        ? "font-medium text-foreground"
                        : run.state === "failed"
                          ? "font-medium text-red"
                          : dim
                            ? "text-muted-foreground"
                            : "text-foreground",
                    )}
                  >
                    {entry.label}
                  </p>
                  <Duration ms={run.ms} />
                  {run.state === "skipped" ? (
                    <span className="technical-label">not needed</span>
                  ) : null}
                  {branches.length > 0 ? (
                    <span className="inline-flex items-center gap-1 rounded-full border border-cyan/25 bg-cyan/10 px-1.5 py-px text-[9px] font-semibold tracking-wider text-cyan uppercase">
                      <GitMerge className="size-2.5" /> {branches.length} concurrent
                    </span>
                  ) : null}
                  {expandable ? (
                    <ChevronRight
                      className={cn(
                        "ml-auto size-3.5 shrink-0 self-center text-muted-foreground transition-transform",
                        isOpen && "rotate-90",
                      )}
                    />
                  ) : null}
                </div>

                <p
                  className={cn(
                    "mt-0.5 text-xs leading-relaxed",
                    run.summary ? "text-muted-foreground" : "text-muted-foreground/70",
                  )}
                >
                  {run.summary || entry.detail}
                </p>
              </div>

              {run.error ? <p className="mt-1 text-[11px] text-red">{run.error}</p> : null}

              <AnimatePresence>
                {run.state === "active" && activeNote ? (
                  <motion.p
                    initial={{ opacity: 0, y: -4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0 }}
                    className="mt-1.5 flex items-center gap-1.5 text-[11px] text-primary/80 italic"
                  >
                    <span className="size-1.5 animate-pulse rounded-full bg-primary" />
                    {activeNote}
                  </motion.p>
                ) : null}
              </AnimatePresence>

              <AnimatePresence initial={false}>
                {isOpen ? (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: "auto", opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.18 }}
                    className="overflow-hidden"
                  >
                    {branches.length > 0 ? (
                      <div
                        className={cn(
                          "mt-2.5 rounded-xl border p-3 transition-colors duration-300",
                          run.state === "active"
                            ? "border-primary/25 bg-primary/5"
                            : "border-border bg-background-elevated/40",
                        )}
                      >
                        <p className="eyebrow mb-2.5">Running concurrently</p>
                        <ul className="space-y-2.5">
                          {branches.map((b) => (
                            <Branch key={b.name} entry={b} run={stateOf(b.name)} />
                          ))}
                        </ul>
                      </div>
                    ) : null}

                    {card}

                    {rawPayload !== undefined ? (
                      <div className="mt-2">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setShowRaw((p) => ({ ...p, [entry.name]: !p[entry.name] }));
                          }}
                          className="inline-flex items-center gap-1.5 text-[10px] font-semibold tracking-wider text-muted-foreground uppercase transition-colors hover:text-foreground"
                        >
                          <Code className="size-3" />
                          {showRaw[entry.name] ? "Hide" : "Show"} raw decision
                        </button>
                        {showRaw[entry.name] ? (
                          <pre className="custom-scrollbar mt-2 max-h-72 overflow-auto rounded-lg border border-border bg-background-elevated p-3 font-mono text-[10px] text-muted-foreground">
                            {JSON.stringify(rawPayload, null, 2)}
                          </pre>
                        ) : null}
                      </div>
                    ) : null}
                  </motion.div>
                ) : null}
              </AnimatePresence>
            </motion.li>
          );
        })}
      </ol>
    </div>
  );
}
