import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowDownToLine, Check, Copy, Download, Search, ScrollText, X,
} from 'lucide-react';
import { cn } from '../../../lib/utils';
import type { LogLine } from '../../../api/executions';

/**
 * Live tail of the engine's narration for one execution.
 *
 * This is the view that answers "what is it doing *right now*" during a long
 * agent call, when the step list has been showing the same in-flight row for
 * thirty seconds. Lines arrive over the execution stream as they are written.
 */

const LEVEL_STYLES: Record<string, { text: string; badge: string }> = {
  DEBUG: { text: 'text-[var(--color-text-muted)]', badge: 'bg-white/5 text-[var(--color-text-muted)]' },
  INFO: { text: 'text-[var(--color-text-secondary)]', badge: 'bg-sky-500/15 text-sky-300' },
  WARNING: { text: 'text-amber-200', badge: 'bg-amber-500/15 text-amber-300' },
  ERROR: { text: 'text-red-200', badge: 'bg-red-500/15 text-red-300' },
  CRITICAL: { text: 'text-red-100', badge: 'bg-red-500/25 text-red-200' },
};

const LEVEL_ORDER = ['DEBUG', 'INFO', 'WARNING', 'ERROR', 'CRITICAL'];

function levelStyle(level: string) {
  return LEVEL_STYLES[level.toUpperCase()] ?? LEVEL_STYLES.INFO;
}

function clockOf(timestamp: string): string {
  const date = new Date(timestamp);
  return Number.isNaN(date.getTime())
    ? '--:--:--'
    : date.toLocaleTimeString(undefined, { hour12: false });
}

export default function ExecutionLogConsole({
  logs,
  isLive,
  emptyHint,
}: {
  logs: LogLine[];
  isLive: boolean;
  emptyHint?: string;
}) {
  const [minLevel, setMinLevel] = useState('INFO');
  const [filter, setFilter] = useState('');
  const [follow, setFollow] = useState(true);
  const [copied, setCopied] = useState(false);

  const scrollRef = useRef<HTMLDivElement>(null);

  const visible = useMemo(() => {
    const floor = LEVEL_ORDER.indexOf(minLevel);
    const needle = filter.trim().toLowerCase();
    return logs.filter((line) => {
      const rank = LEVEL_ORDER.indexOf(line.level.toUpperCase());
      if (rank >= 0 && floor >= 0 && rank < floor) return false;
      if (!needle) return true;
      return (
        line.message.toLowerCase().includes(needle) ||
        (line.step_id ?? '').toLowerCase().includes(needle)
      );
    });
  }, [logs, minLevel, filter]);

  // Pin to the bottom as lines arrive. Layout effect so the scroll happens in
  // the same frame as the paint — otherwise the tail visibly jumps.
  useLayoutEffect(() => {
    if (!follow || !scrollRef.current) return;
    scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [visible.length, follow]);

  // Scrolling up to read history turns following off; returning to the bottom
  // turns it back on. Fighting the user's scroll is the classic log-tail sin.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onScroll = () => {
      const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
      setFollow(atBottom);
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, []);

  const asText = () =>
    visible
      .map((l) => `${l.timestamp} [${l.level}] ${l.step_id ? `(${l.step_id}) ` : ''}${l.message}`)
      .join('\n');

  const copyAll = async () => {
    try {
      await navigator.clipboard.writeText(asText());
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable */
    }
  };

  const download = () => {
    const blob = new Blob([asText()], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `execution-logs-${Date.now()}.log`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Toolbar */}
      <div className="shrink-0 space-y-2 pb-2">
        <div className="relative">
          <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)]" />
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter lines…"
            className="w-full rounded-lg border border-[var(--color-border-subtle)] bg-black/30 py-1.5 pl-7 pr-7 text-[11px] text-white placeholder:text-[var(--color-text-muted)] focus:border-indigo-500/50 focus:outline-none"
          />
          {filter && (
            <button
              onClick={() => setFilter('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)] hover:text-white"
            >
              <X size={11} />
            </button>
          )}
        </div>

        <div className="flex items-center gap-1.5">
          <div className="flex flex-1 gap-0.5 rounded-lg border border-[var(--color-border-subtle)] bg-black/20 p-0.5">
            {['DEBUG', 'INFO', 'WARNING', 'ERROR'].map((level) => (
              <button
                key={level}
                onClick={() => setMinLevel(level)}
                title={`Show ${level} and above`}
                className={cn(
                  'flex-1 rounded-md py-0.5 text-[9px] font-bold uppercase tracking-wider transition-colors',
                  minLevel === level
                    ? 'bg-indigo-500/20 text-indigo-200'
                    : 'text-[var(--color-text-muted)] hover:text-white',
                )}
              >
                {level.slice(0, 4)}
              </button>
            ))}
          </div>

          <button
            onClick={() => setFollow((v) => !v)}
            title={follow ? 'Following the tail' : 'Jump to newest'}
            className={cn(
              'rounded-md border p-1.5 transition-colors',
              follow
                ? 'border-emerald-400/40 bg-emerald-500/10 text-emerald-300'
                : 'border-[var(--color-border-subtle)] text-[var(--color-text-muted)] hover:text-white',
            )}
          >
            <ArrowDownToLine size={11} />
          </button>
          <button
            onClick={copyAll}
            disabled={!visible.length}
            className="rounded-md border border-[var(--color-border-subtle)] p-1.5 text-[var(--color-text-muted)] transition-colors hover:text-white disabled:opacity-40"
            title="Copy visible lines"
          >
            {copied ? <Check size={11} className="text-emerald-400" /> : <Copy size={11} />}
          </button>
          <button
            onClick={download}
            disabled={!visible.length}
            className="rounded-md border border-[var(--color-border-subtle)] p-1.5 text-[var(--color-text-muted)] transition-colors hover:text-white disabled:opacity-40"
            title="Download as .log"
          >
            <Download size={11} />
          </button>
        </div>
      </div>

      {/* Tail */}
      {visible.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center py-10 text-center">
          <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-white/[0.03]">
            <ScrollText size={20} className="text-[var(--color-text-muted)] opacity-40" />
          </div>
          <p className="text-xs text-[var(--color-text-muted)]">
            {logs.length
              ? 'No lines match this filter.'
              : emptyHint ?? (isLive ? 'Waiting for the first log line…' : 'No logs captured for this run.')}
          </p>
          {!logs.length && !isLive && (
            <p className="mt-1 max-w-[260px] text-[10px] leading-relaxed text-[var(--color-text-muted)] opacity-60">
              Logs are held in memory per run, so they are lost when the backend restarts.
            </p>
          )}
        </div>
      ) : (
        <div
          ref={scrollRef}
          className="min-h-0 flex-1 overflow-y-auto rounded-lg border border-[var(--color-border-subtle)] bg-black/40 p-2 font-mono text-[10.5px] leading-[1.55] custom-scrollbar"
        >
          {visible.map((line) => {
            const style = levelStyle(line.level);
            return (
              <div key={line.seq} className="flex gap-1.5 px-1 py-[1px] hover:bg-white/[0.03]">
                <span className="shrink-0 tabular-nums text-[var(--color-text-muted)] opacity-70">
                  {clockOf(line.timestamp)}
                </span>
                <span className={cn('h-fit shrink-0 rounded px-1 text-[8.5px] font-bold uppercase leading-[1.5]', style.badge)}>
                  {line.level.slice(0, 4)}
                </span>
                {line.step_id && (
                  <span
                    className="max-w-[110px] shrink-0 truncate text-indigo-300/70"
                    title={line.step_id}
                  >
                    {line.step_id}
                  </span>
                )}
                <span className={cn('min-w-0 flex-1 whitespace-pre-wrap break-words', style.text)}>
                  {line.message}
                </span>
              </div>
            );
          })}
          {isLive && (
            <div className="flex items-center gap-1.5 px-1 py-1 text-[var(--color-text-muted)]">
              <span className="inline-block h-2 w-1.5 animate-pulse bg-emerald-400" />
              <span className="text-[10px] opacity-60">streaming…</span>
            </div>
          )}
        </div>
      )}

      <p className="shrink-0 pt-2 text-[10px] text-[var(--color-text-muted)] opacity-60">
        {visible.length} of {logs.length} lines{follow ? ' · following' : ' · paused'}
      </p>
    </div>
  );
}
