/**
 * Actions in flight, on every page: what each is doing this moment, how far
 * it has measurably got, and how long it has taken. Sits above dialogs, so an
 * action started from one stays visible while it works.
 */
import { useEffect, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  CircleDashed,
  Loader2,
  MinusCircle,
  Radio,
} from "lucide-react";
import { formatElapsed } from "@/components/runs/runMeta";
import { opActivity, opCount, opDetail, opFraction } from "@/lib/ops/describe";
import { cn } from "@/lib/utils";
import { useOpsStore, type OpLayer, type OpStep, type TrackedOp } from "@/stores/ops";
import { LiveBar } from "./LiveBar";

/** Quicker actions finish before they would be worth a card. */
const SHOW_AFTER_MS = 500;
const MAX_CARDS = 4;

function useNow(live: boolean) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!live) return;
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, [live]);
  return now;
}

const STATE_ICON = {
  pending: CircleDashed,
  active: Loader2,
  completed: CheckCircle2,
  skipped: MinusCircle,
  failed: AlertCircle,
} as const;

const STATE_TONE = {
  pending: "text-muted-foreground/60",
  active: "text-primary animate-spin",
  completed: "text-emerald",
  skipped: "text-muted-foreground",
  failed: "text-red",
} as const;

type Row = { key: string; label: string; state: keyof typeof STATE_ICON; ms?: number | undefined };

function rows(op: TrackedOp): Row[] {
  if (op.layers.length) {
    return op.layers.map((l: OpLayer) => ({
      key: l.name,
      label: l.label,
      state: l.state,
      ms: l.ms,
    }));
  }
  return op.steps.slice(-8).map((s: OpStep) => ({
    key: String(s.id),
    label: s.kind === "model" ? `Model · ${s.name}` : s.name,
    state: s.state,
    ms: s.ms,
  }));
}

function OpCard({ op, now }: { op: TrackedOp; now: number }) {
  const [open, setOpen] = useState(false);
  const pending = op.status === "pending";
  const elapsed = (op.finishedAt ?? now) - op.startedAt;
  const detail = opDetail(op);
  const count = opCount(op);
  const list = rows(op);
  const tone =
    op.status === "failed" ? "bg-red" : op.status === "completed" ? "bg-emerald" : "bg-primary";

  return (
    <div className="rounded-xl border border-border glass-elevated p-3 shadow-lg">
      <div className="flex items-center gap-2 text-xs">
        {pending ? (
          <Loader2 className="size-3.5 shrink-0 animate-spin text-primary" />
        ) : op.status === "completed" ? (
          <CheckCircle2 className="size-3.5 shrink-0 text-emerald" />
        ) : (
          <AlertCircle className="size-3.5 shrink-0 text-red" />
        )}
        <span className="min-w-0 flex-1 truncate font-medium text-foreground" title={op.url}>
          {op.label}
        </span>
        {op.live && pending ? (
          <Radio
            className="size-3 shrink-0 text-emerald"
            aria-label="Live progress from the server"
          />
        ) : null}
        {count ? (
          <span className="shrink-0 font-mono text-[10px] text-muted-foreground tabular-nums">
            {count}
          </span>
        ) : null}
        <span className="shrink-0 font-mono text-[10px] text-muted-foreground tabular-nums">
          {formatElapsed(elapsed)}
        </span>
        {list.length ? (
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            aria-expanded={open}
            aria-label={open ? "Hide steps" : "Show steps"}
            className="shrink-0 rounded p-0.5 text-muted-foreground transition hover:bg-surface-hover hover:text-foreground"
          >
            <ChevronDown className={cn("size-3.5 transition-transform", open && "rotate-180")} />
          </button>
        ) : null}
      </div>

      <LiveBar value={opFraction(op)} tone={tone} className="mt-2" />

      <p
        className={cn(
          "mt-1.5 truncate text-[11px]",
          op.status === "failed" ? "text-red" : "text-muted-foreground",
        )}
        title={opActivity(op)}
      >
        {opActivity(op)}
      </p>
      {detail ? (
        <p className="line-clamp-2 text-[10px] text-muted-foreground/80" title={detail}>
          {detail}
        </p>
      ) : null}

      {open && list.length ? (
        <ol className="custom-scrollbar mt-2 max-h-48 space-y-1 overflow-y-auto border-t border-border/60 pt-2">
          {list.map((r) => {
            const Icon = STATE_ICON[r.state];
            return (
              <li key={r.key} className="flex items-center gap-2 text-[11px]">
                <Icon className={cn("size-3 shrink-0", STATE_TONE[r.state])} />
                <span
                  className={cn(
                    "min-w-0 flex-1 truncate",
                    r.state === "pending" ? "text-muted-foreground/70" : "text-foreground",
                  )}
                  title={r.label}
                >
                  {r.label}
                </span>
                {r.ms !== undefined ? (
                  <span className="shrink-0 font-mono text-[10px] text-muted-foreground tabular-nums">
                    {r.ms < 1000 ? `${r.ms}ms` : `${(r.ms / 1000).toFixed(1)}s`}
                  </span>
                ) : null}
              </li>
            );
          })}
        </ol>
      ) : null}
    </div>
  );
}

export function ActivityTray() {
  const ops = useOpsStore((s) => s.ops);
  const actions = Object.values(ops)
    .filter((o) => !o.background)
    .sort((a, b) => a.startedAt - b.startedAt);
  const now = useNow(actions.some((o) => o.status === "pending"));

  const visible = actions.filter((o) => (o.finishedAt ?? now) - o.startedAt >= SHOW_AFTER_MS);
  if (!visible.length) return null;
  const hidden = visible.length - MAX_CARDS;

  return (
    <div
      aria-live="polite"
      className="fixed bottom-4 left-4 z-[60] w-[min(360px,calc(100vw-2rem))] space-y-2 md:left-[calc(var(--nav-w)+1rem)]"
    >
      {hidden > 0 ? (
        <p className="px-1 text-[11px] text-muted-foreground">+{hidden} more in progress</p>
      ) : null}
      {visible.slice(-MAX_CARDS).map((op) => (
        <OpCard key={op.id} op={op} now={now} />
      ))}
    </div>
  );
}
