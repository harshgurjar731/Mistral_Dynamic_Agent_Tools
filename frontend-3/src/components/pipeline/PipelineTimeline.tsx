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
import {
  AlertTriangle,
  BookOpenCheck,
  Check,
  ChevronRight,
  Code,
  GitMerge,
  Loader2,
  Minus,
  Undo2,
} from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { ProcessUse } from "@/api/processes";
import { ProcessUseList } from "@/components/processes/shared";
import { cn } from "@/lib/utils";
import { formatDuration } from "@/lib/status";

export type LayerState = "pending" | "active" | "completed" | "skipped" | "failed";

export interface LayerManifestEntry {
  name: string;
  label: string;
  detail: string;
  hidden?: boolean | undefined;
  concurrent?: LayerManifestEntry[] | undefined;
  /** A stage: the layers it groups, run in order. */
  children?: LayerManifestEntry[] | undefined;
  stage?: boolean | undefined;
}

/** One atomic step inside a layer — decide, check, repair, a build, a scenario. */
export interface SubLayer {
  id: string;
  label: string;
  state: LayerState;
  summary?: string | undefined;
  detail?: string | undefined;
  error?: string | undefined;
  ms?: number | undefined;
}

/** A check sent the run back to an earlier layer to fix what it found. */
export interface RewindNote {
  to: string;
  from?: string | undefined;
  round: number;
  reason?: string | undefined;
  issues?: Record<string, string[]> | undefined;
}

export interface LayerRuntime {
  state: LayerState;
  ms?: number | undefined;
  summary?: string | undefined;
  error?: string | undefined;
  /** Elements of the run's process knowledge this layer used. */
  process?: ProcessUse[] | undefined;
  /** Its atomic steps, in the order they started. */
  subs?: SubLayer[] | undefined;
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
  /** How far the running layer is through its own work, 0–1. */
  activeFraction?: number | undefined;
  /** Times a check sent the run back to an earlier layer. */
  rewinds?: RewindNote[] | undefined;
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

/** "Process knowledge · 3" — shown on any row whose layer used some. */
function ProcessChip({ uses, onClick }: { uses: ProcessUse[]; onClick?: () => void }) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onClick?.();
      }}
      title="What this layer took from the process knowledge"
      className="inline-flex items-center gap-1 rounded-full border border-indigo/30 bg-indigo/10 px-1.5 py-px text-[9px] font-semibold tracking-wider text-indigo uppercase"
    >
      <BookOpenCheck className="size-2.5" /> Process · {uses.length}
    </button>
  );
}

function ProcessUsePanel({ uses }: { uses: ProcessUse[] }) {
  return (
    <div className="mt-2.5 rounded-xl border border-indigo/25 bg-indigo/5 p-3">
      <p className="eyebrow mb-2 text-indigo">Process knowledge used here</p>
      <ProcessUseList uses={uses} />
    </div>
  );
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
        {run.process?.length ? <ProcessChip uses={run.process} /> : null}
      </div>
      <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">
        {run.summary || entry.detail}
      </p>
      {run.error ? <p className="mt-0.5 text-[11px] text-red">{run.error}</p> : null}
      {run.process?.length ? (
        <div className="mt-1.5">
          <ProcessUseList uses={run.process} />
        </div>
      ) : null}
    </li>
  );
}

/** Overall progress across the drawn chain. */
function ProgressBar({
  done,
  total,
  failed,
  active,
}: {
  done: number;
  total: number;
  failed: number;
  /** The running layer's measured share of its own work, or null when none runs. */
  active: number | null;
}) {
  // Finished layers plus the running one's measured part. 100% only when all settled.
  const raw = total ? ((done + (active ?? 0)) / total) * 100 : 0;
  const pct = done >= total ? Math.round(raw) : Math.min(99, Math.floor(raw));
  return (
    <div className="mb-5">
      <div className="mb-1.5 flex items-center justify-between">
        <span className="text-[10px] font-semibold tracking-wider text-muted-foreground uppercase">
          {done} of {total} decisions
          {failed > 0 ? <span className="text-red"> · {failed} failed</span> : null}
        </span>
        <span className="font-mono text-sm font-semibold tabular-nums text-foreground">{pct}%</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-border/60">
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

/**
 * The running layer's own bar. It fills only as far as the backend has
 * measured; a layer that reports nothing measurable shows motion instead.
 */
function LayerProgress({ fraction }: { fraction: number }) {
  const measured = fraction > 0;
  const pct = Math.min(99, Math.floor(fraction * 100));
  return (
    <div className="mt-1.5 flex items-center gap-2">
      <div className="relative h-1 flex-1 overflow-hidden rounded-full bg-primary/10">
        {measured ? (
          <motion.div
            className="h-full rounded-full bg-primary"
            initial={false}
            animate={{ width: `${Math.max(pct, 2)}%` }}
            transition={{ duration: 0.4 }}
          />
        ) : (
          <div className="progress-indeterminate absolute inset-y-0 w-1/4 rounded-full bg-primary/70" />
        )}
      </div>
      <span className="w-9 shrink-0 text-right font-mono text-[10px] font-semibold text-primary tabular-nums">
        {measured ? `${pct}%` : "…"}
      </span>
    </div>
  );
}

/** The atomic steps of a layer, live. Long lists show the latest and a count. */
function SubLayers({ subs }: { subs: SubLayer[] }) {
  const [all, setAll] = useState(false);
  const LIMIT = 12;
  const shown = all ? subs : subs.slice(-LIMIT);
  return (
    <div className="mt-2 rounded-xl border border-border/60 bg-background-elevated/40 p-2.5">
      {subs.length > LIMIT ? (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setAll((v) => !v);
          }}
          className="mb-1.5 text-[10px] font-semibold tracking-wider text-muted-foreground uppercase hover:text-foreground"
        >
          {all ? "Show the latest" : `Show all ${subs.length} steps`}
        </button>
      ) : null}
      <ul className="space-y-1.5">
        {shown.map((sub) => (
          <li key={sub.id} className="flex gap-2">
            <span
              className={cn(
                "mt-0.5 grid size-4 shrink-0 place-items-center rounded-full border",
                DOT[sub.state],
              )}
            >
              <StateIcon state={sub.state} className="size-2" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="flex flex-wrap items-baseline gap-1.5 text-[11px] font-medium text-foreground">
                <span className="min-w-0 break-words">{sub.label}</span>
                <Duration ms={sub.ms} />
              </p>
              {sub.summary || sub.detail ? (
                <p className="text-[10px] leading-snug break-words text-muted-foreground">
                  {sub.summary || sub.detail}
                </p>
              ) : null}
              {sub.error ? <p className="text-[10px] break-words text-red">{sub.error}</p> : null}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

interface RowProps {
  entry: LayerManifestEntry;
  run: LayerRuntime;
  stateOf: (name: string) => LayerRuntime;
  card: ReactNode;
  rawPayload: unknown;
  isOpen: boolean;
  onToggle: () => void;
  onOpen: () => void;
  showRaw: boolean;
  onToggleRaw: () => void;
  activeNote?: string | undefined;
  activeFraction?: number | undefined;
}

/** One layer: its state, reasoning, live sublayers and evidence. */
function LayerRow({
  entry,
  run,
  stateOf,
  card,
  rawPayload,
  isOpen,
  onToggle,
  onOpen,
  showRaw,
  onToggleRaw,
  activeNote,
  activeFraction,
}: RowProps) {
  const dim = run.state === "pending" || run.state === "skipped";
  const branches = (entry.concurrent ?? []).filter((b) => !b.hidden);
  const uses = run.process ?? [];
  const subs = run.subs ?? [];
  const expandable = Boolean(
    card || branches.length > 0 || rawPayload !== undefined || uses.length > 0 || subs.length > 0,
  );

  return (
    <motion.li
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
        onClick={() => expandable && onToggle()}
        onKeyDown={(e) => {
          if (expandable && (e.key === "Enter" || e.key === " ")) {
            e.preventDefault();
            onToggle();
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
          {run.state === "skipped" ? <span className="technical-label">not needed</span> : null}
          {uses.length > 0 ? <ProcessChip uses={uses} onClick={onOpen} /> : null}
          {branches.length > 0 ? (
            <span className="inline-flex items-center gap-1 rounded-full border border-cyan/25 bg-cyan/10 px-1.5 py-px text-[9px] font-semibold tracking-wider text-cyan uppercase">
              <GitMerge className="size-2.5" /> {branches.length} concurrent
            </span>
          ) : null}
          {subs.length > 0 ? (
            <span className="inline-flex items-center gap-1 rounded-full border border-border bg-background-elevated px-1.5 py-px text-[9px] font-semibold tracking-wider text-muted-foreground uppercase">
              {subs.filter((x) => x.state === "completed").length}/{subs.length} steps
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

      {run.state === "active" ? <LayerProgress fraction={activeFraction ?? 0} /> : null}

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
            {subs.length > 0 ? <SubLayers subs={subs} /> : null}

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

            {uses.length > 0 ? <ProcessUsePanel uses={uses} /> : null}

            {rawPayload !== undefined ? (
              <div className="mt-2">
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onToggleRaw();
                  }}
                  className="inline-flex items-center gap-1.5 text-[10px] font-semibold tracking-wider text-muted-foreground uppercase transition-colors hover:text-foreground"
                >
                  <Code className="size-3" />
                  {showRaw ? "Hide" : "Show"} raw decision
                </button>
                {showRaw ? (
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
}

/** The layers a progress count is made of: every layer, with stages opened up. */
function leaves(entries: LayerManifestEntry[]): LayerManifestEntry[] {
  return entries
    .flatMap((e) => (e.children?.length ? leaves(e.children) : [e]))
    .filter((e) => !e.hidden);
}

export function PipelineTimeline({
  manifest,
  runtime,
  cards,
  raw,
  activeNote,
  activeFraction,
  rewinds,
}: Props) {
  const visible = useMemo(() => manifest.filter((e) => !e.hidden), [manifest]);
  const layers = useMemo(() => leaves(visible), [visible]);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [showRaw, setShowRaw] = useState<Record<string, boolean>>({});

  const stateOf = (name: string): LayerRuntime => runtime[name] ?? PENDING;

  // The running layer opens itself, only on the transition into `active`, so a
  // row the user closed by hand is not reopened underneath them.
  const activeName = layers.find((e) => stateOf(e.name).state === "active")?.name;
  useEffect(() => {
    if (activeName) setOpen((prev) => (prev[activeName] ? prev : { ...prev, [activeName]: true }));
  }, [activeName]);

  const { done, failed } = useMemo(() => {
    let d = 0;
    let f = 0;
    for (const e of layers) {
      const st = (runtime[e.name] ?? PENDING).state;
      if (st === "completed" || st === "skipped") d++;
      if (st === "failed") f++;
    }
    return { done: d + f, failed: f };
  }, [layers, runtime]);

  if (visible.length === 0) return null;

  const labelOf = (name: string) => layers.find((l) => l.name === name)?.label ?? name;

  const row = (entry: LayerManifestEntry) => (
    <LayerRow
      key={entry.name}
      entry={entry}
      run={stateOf(entry.name)}
      stateOf={stateOf}
      card={cards?.[entry.name]}
      rawPayload={raw?.[entry.name]}
      isOpen={open[entry.name] ?? false}
      onToggle={() => setOpen((p) => ({ ...p, [entry.name]: !p[entry.name] }))}
      onOpen={() => setOpen((p) => ({ ...p, [entry.name]: true }))}
      showRaw={showRaw[entry.name] ?? false}
      onToggleRaw={() => setShowRaw((p) => ({ ...p, [entry.name]: !p[entry.name] }))}
      activeNote={activeNote}
      activeFraction={activeFraction}
    />
  );

  return (
    <div>
      <ProgressBar
        done={done}
        total={layers.length}
        failed={failed}
        active={activeName ? (activeFraction ?? 0) : null}
      />

      {rewinds?.length ? (
        <ul className="mb-4 space-y-1.5">
          {rewinds.map((r) => (
            <li
              key={`${r.round}-${r.to}`}
              className="flex gap-2 rounded-lg border border-amber/25 bg-amber/5 px-3 py-2 text-[11px] text-amber"
            >
              <Undo2 className="mt-0.5 size-3 shrink-0" />
              <span className="min-w-0 break-words">
                Went back to <span className="font-semibold">{labelOf(r.to)}</span>
                {r.reason ? ` — ${r.reason}` : ""}
                {r.issues ? `: ${Object.values(r.issues).flat().slice(0, 2).join("; ")}` : ""}
              </span>
            </li>
          ))}
        </ul>
      ) : null}

      <ol className="relative space-y-4 pl-7">
        <span
          aria-hidden
          className="absolute top-2 bottom-2 left-[11px] w-px bg-gradient-to-b from-primary/50 via-border to-transparent"
        />
        {visible.map((entry) => {
          const children = (entry.children ?? []).filter((c) => !c.hidden);
          if (!children.length) return row(entry);
          const stage = stateOf(entry.name);
          const settled = children.filter((c) => {
            const st = stateOf(c.name).state;
            return st === "completed" || st === "skipped" || st === "failed";
          }).length;
          return (
            <li key={entry.name} className="relative">
              <span
                className={cn(
                  "absolute top-0.5 -left-7 grid size-[22px] place-items-center rounded-md border transition-colors duration-300",
                  DOT[stage.state],
                )}
              >
                <StateIcon state={stage.state} />
              </span>
              <div className="flex flex-wrap items-baseline gap-2">
                <p
                  className={cn(
                    "text-[11px] font-semibold tracking-wider uppercase",
                    stage.state === "pending" ? "text-muted-foreground" : "text-foreground",
                  )}
                >
                  {entry.label}
                </p>
                <span className="font-mono text-[10px] text-muted-foreground tabular-nums">
                  {settled}/{children.length}
                </span>
                <Duration ms={stage.ms} />
              </div>
              {entry.detail ? (
                <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground/80">
                  {entry.detail}
                </p>
              ) : null}
              <ol className="relative mt-3 space-y-4 border-l border-border/50 pl-7">
                {children.map(row)}
              </ol>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
