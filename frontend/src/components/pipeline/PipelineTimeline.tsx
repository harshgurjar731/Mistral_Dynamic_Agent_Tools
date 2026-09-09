/**
 * PipelineTimeline — Draws an orchestration run as the layer chain it is.
 *
 * Both orchestrators are a known, ordered chain of single-decision layers, and
 * the backend sends that chain as a manifest before the run starts. So the
 * timeline shows the whole pipeline from the first frame, with the current
 * position marked and every decision's reasoning attached to the layer that
 * made it — rather than the append-only log of status strings that was all the
 * previous single-call design could produce.
 *
 * Interaction model: a row with evidence is expandable. Collapsed it shows the
 * decision and its one-line reasoning; expanded it shows the card the layer
 * produced, and optionally the raw JSON behind it. Rows collapse by default so
 * a fourteen-layer run stays readable, and the row that is currently running
 * opens itself so progress is visible without a click.
 */
import { AnimatePresence, motion } from 'framer-motion';
import { AlertCircle, Check, ChevronRight, Code, MinusCircle } from 'lucide-react';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { cn } from '../../lib/utils';

export type LayerState = 'pending' | 'active' | 'completed' | 'skipped' | 'failed';

export interface LayerManifestEntry {
  name: string;
  label: string;
  detail: string;
  hidden?: boolean;
  concurrent?: LayerManifestEntry[];
}

export interface LayerRuntime {
  state: LayerState;
  ms?: number;
  summary?: string;
  error?: string;
}

interface Props {
  manifest: LayerManifestEntry[];
  runtime: Record<string, LayerRuntime>;
  /** Rendered evidence, keyed by the layer that produced it. */
  cards?: Record<string, ReactNode>;
  /** Raw decision payloads, keyed by layer, for the JSON view. */
  raw?: Record<string, unknown>;
  /** Free-text sub-progress from the layer currently running. */
  activeNote?: string;
}

const DOT: Record<LayerState, string> = {
  pending: 'border-[var(--color-border-subtle)]',
  active: 'border-white',
  completed: 'border-[color:var(--color-accent-success)]',
  skipped: 'border-[var(--color-border-subtle)]',
  failed: 'border-[color:var(--color-accent-danger)]',
};

function StateDot({ state }: { state: LayerState }) {
  return (
    <div
      className={cn(
        'absolute left-[-9px] top-1 w-4 h-4 rounded-full bg-[var(--color-bg-base)] border-2',
        'flex items-center justify-center transition-colors duration-300',
        DOT[state],
      )}
    >
      {state === 'active' && (
        <motion.div
          className="w-1.5 h-1.5 rounded-full bg-white"
          animate={{ opacity: [1, 0.3, 1] }}
          transition={{ duration: 1.4, repeat: Infinity }}
        />
      )}
      {state === 'completed' && (
        <Check size={11} strokeWidth={3} className="text-[var(--color-accent-success)]" />
      )}
      {state === 'failed' && (
        <AlertCircle size={14} className="text-[var(--color-accent-danger)] bg-[var(--color-bg-base)] rounded-full" />
      )}
      {state === 'skipped' && <MinusCircle size={11} className="text-[var(--color-text-muted)]" />}
    </div>
  );
}

function Duration({ ms }: { ms?: number }) {
  if (ms === undefined) return null;
  const text = ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`;
  return <span className="text-[10px] font-mono text-[var(--color-text-muted)] tabular-nums">{text}</span>;
}

/** One branch of a concurrent block — compact, since several sit together. */
function Branch({ entry, run }: { entry: LayerManifestEntry; run: LayerRuntime }) {
  const dim = run.state === 'pending' || run.state === 'skipped';
  return (
    <div className="relative pl-5">
      <div className="absolute left-0 top-[5px]">
        {run.state === 'active' ? (
          <motion.div
            className="w-2 h-2 rounded-full bg-white"
            animate={{ opacity: [1, 0.3, 1] }}
            transition={{ duration: 1.4, repeat: Infinity }}
          />
        ) : run.state === 'completed' ? (
          <Check size={10} strokeWidth={3} className="text-[var(--color-accent-success)]" />
        ) : run.state === 'failed' ? (
          <AlertCircle size={10} className="text-[var(--color-accent-danger)]" />
        ) : (
          <div className="w-2 h-2 rounded-full border border-[var(--color-border-subtle)]" />
        )}
      </div>
      <div className="flex items-baseline gap-2 flex-wrap">
        <span className={cn('text-xs font-medium transition-colors',
          dim ? 'text-[var(--color-text-muted)]' : 'text-[var(--color-text-primary)]')}>
          {entry.label}
        </span>
        <Duration ms={run.ms} />
      </div>
      <p className="text-[11px] text-[var(--color-text-muted)] leading-snug mt-0.5">
        {run.summary || entry.detail}
      </p>
    </div>
  );
}

/** Overall progress across the drawn chain. */
function ProgressBar({ done, total, failed }: { done: number; total: number; failed: number }) {
  const pct = total ? Math.round((done / total) * 100) : 0;
  return (
    <div className="mb-6 ml-4 md:ml-8 pl-8 md:pl-12">
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-[10px] uppercase tracking-wider text-[var(--color-text-muted)]">
          {done} of {total} decisions
          {failed > 0 && <span className="text-[var(--color-accent-danger)]"> · {failed} failed</span>}
        </span>
        <span className="text-[10px] font-mono text-[var(--color-text-muted)] tabular-nums">{pct}%</span>
      </div>
      <div className="h-1 rounded-full bg-[var(--color-bg-hover)] overflow-hidden">
        <motion.div
          className={cn('h-full rounded-full',
            failed > 0 ? 'bg-[var(--color-accent-danger)]' : 'bg-[var(--color-accent-success)]')}
          animate={{ width: `${pct}%` }}
          transition={{ duration: 0.4 }}
        />
      </div>
    </div>
  );
}

export default function PipelineTimeline({ manifest, runtime, cards, raw, activeNote }: Props) {
  const visible = useMemo(() => manifest.filter(e => !e.hidden), [manifest]);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [showRaw, setShowRaw] = useState<Record<string, boolean>>({});

  const stateOf = (name: string): LayerRuntime => runtime[name] ?? { state: 'pending' };

  // The running layer opens itself, so progress is visible without a click.
  // Only on the transition into `active`, so a row the user closed by hand is
  // not reopened underneath them on the next render.
  const activeName = visible.find(e => stateOf(e.name).state === 'active')?.name;
  useEffect(() => {
    if (activeName) setOpen(prev => (prev[activeName] ? prev : { ...prev, [activeName]: true }));
  }, [activeName]);

  const { done, failed } = useMemo(() => {
    let d = 0, f = 0;
    for (const e of visible) {
      const st = stateOf(e.name).state;
      if (st === 'completed' || st === 'skipped') d++;
      if (st === 'failed') f++;
    }
    return { done: d + f, failed: f };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, runtime]);

  if (visible.length === 0) return null;

  return (
    <div>
      <ProgressBar done={done} total={visible.length} failed={failed} />

      <div className="relative border-l border-[var(--color-border-subtle)] ml-4 md:ml-8 space-y-6 pb-4">
        {visible.map(entry => {
          const run = stateOf(entry.name);
          const dim = run.state === 'pending' || run.state === 'skipped';
          const branches = entry.concurrent ?? [];
          const card = cards?.[entry.name];
          const rawPayload = raw?.[entry.name];
          const expandable = Boolean(card || branches.length > 0 || rawPayload);
          const isOpen = open[entry.name] ?? false;

          return (
            <motion.div
              key={entry.name}
              layout
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="relative pl-8 md:pl-12"
            >
              <StateDot state={run.state} />

              <div
                role={expandable ? 'button' : undefined}
                tabIndex={expandable ? 0 : undefined}
                onClick={() => expandable && setOpen(p => ({ ...p, [entry.name]: !isOpen }))}
                onKeyDown={e => {
                  if (expandable && (e.key === 'Enter' || e.key === ' ')) {
                    e.preventDefault();
                    setOpen(p => ({ ...p, [entry.name]: !isOpen }));
                  }
                }}
                className={cn('group -ml-1 px-1 rounded', expandable && 'cursor-pointer hover:bg-[var(--color-bg-hover)]/40')}
              >
                <div className="flex items-baseline gap-2 flex-wrap">
                  {expandable && (
                    <ChevronRight
                      size={12}
                      className={cn('text-[var(--color-text-muted)] transition-transform shrink-0',
                        isOpen && 'rotate-90')}
                    />
                  )}
                  <h4 className={cn('text-sm font-semibold transition-colors duration-300',
                    run.state === 'active' ? 'text-white'
                      : dim ? 'text-[var(--color-text-muted)]'
                      : 'text-[var(--color-text-primary)]')}>
                    {entry.label}
                  </h4>
                  <Duration ms={run.ms} />
                  {run.state === 'skipped' && (
                    <span className="text-[10px] uppercase tracking-wider text-[var(--color-text-muted)]">
                      not needed
                    </span>
                  )}
                  {expandable && !isOpen && (
                    <span className="text-[10px] text-[var(--color-text-muted)] opacity-0 group-hover:opacity-100 transition-opacity">
                      show detail
                    </span>
                  )}
                </div>

                <p className={cn('text-xs leading-relaxed mt-1',
                  run.summary ? 'text-[var(--color-text-secondary)]' : 'text-[var(--color-text-muted)]')}>
                  {run.summary || entry.detail}
                </p>
              </div>

              {run.error && (
                <p className="text-[11px] text-[var(--color-accent-danger)] mt-1">{run.error}</p>
              )}

              <AnimatePresence>
                {run.state === 'active' && activeNote && (
                  <motion.p
                    initial={{ opacity: 0, y: -4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0 }}
                    className="text-[11px] text-[var(--color-text-muted)] mt-1.5 italic"
                  >
                    {activeNote}
                  </motion.p>
                )}
              </AnimatePresence>

              <AnimatePresence initial={false}>
                {isOpen && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.18 }}
                    className="overflow-hidden"
                  >
                    {branches.length > 0 && (
                      <div className={cn('mt-3 pl-3 border-l-2 rounded-sm transition-colors duration-300',
                        run.state === 'active'
                          ? 'border-[rgba(255,255,255,0.25)]'
                          : 'border-[var(--color-border-subtle)]')}>
                        <p className="text-[10px] uppercase tracking-wider text-[var(--color-text-muted)] mb-2.5">
                          Running concurrently
                        </p>
                        <div className="space-y-2.5">
                          {branches.map(b => (
                            <Branch key={b.name} entry={b} run={stateOf(b.name)} />
                          ))}
                        </div>
                      </div>
                    )}

                    {card}

                    {rawPayload !== undefined && (
                      <div className="mt-2">
                        <button
                          onClick={e => {
                            e.stopPropagation();
                            setShowRaw(p => ({ ...p, [entry.name]: !p[entry.name] }));
                          }}
                          className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-[var(--color-text-muted)] hover:text-white transition-colors"
                        >
                          <Code size={10} />
                          {showRaw[entry.name] ? 'Hide' : 'Show'} raw decision
                        </button>
                        {showRaw[entry.name] && (
                          <pre className="mt-2 p-3 rounded-lg bg-black/40 border border-[var(--color-border-subtle)] text-[10px] font-mono text-[var(--color-text-secondary)] overflow-x-auto max-h-72 overflow-y-auto">
                            {JSON.stringify(rawPayload, null, 2)}
                          </pre>
                        )}
                      </div>
                    )}
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}
