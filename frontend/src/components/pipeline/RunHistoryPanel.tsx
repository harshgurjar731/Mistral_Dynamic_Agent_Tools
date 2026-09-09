/**
 * RunHistoryPanel — Past orchestration runs, replayable with their timelines.
 *
 * Selecting an entry re-hydrates the pipeline timeline exactly as it ran, so a
 * past run is inspected the same way a live one is watched, rather than through
 * a separate summary view that would drift from it.
 */
import { motion } from 'framer-motion';
import { AlertCircle, CheckCircle2, Clock, Trash2, X } from 'lucide-react';
import { cn } from '../../lib/utils';
import type { RunHistoryEntry } from './useRunHistory';

function relativeTime(ts: number): string {
  const secs = Math.floor((Date.now() - ts) / 1000);
  if (secs < 60) return 'just now';
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
  if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`;
  const days = Math.floor(secs / 86400);
  if (days < 7) return `${days}d ago`;
  return new Date(ts).toLocaleDateString();
}

export default function RunHistoryPanel({
  history,
  activeId,
  onClose,
  onSelect,
  onClear,
  emptyHint,
}: {
  history: RunHistoryEntry[];
  activeId?: string | null;
  onClose: () => void;
  onSelect: (entry: RunHistoryEntry) => void;
  onClear: () => void;
  emptyHint?: string;
}) {
  return (
    <motion.aside
      initial={{ x: 40, opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      exit={{ x: 40, opacity: 0 }}
      className="w-full md:w-80 shrink-0 border-l border-[var(--color-border-subtle)] flex flex-col h-full bg-[var(--color-bg-base)]"
    >
      <header className="h-14 px-4 flex items-center justify-between border-b border-[var(--color-border-subtle)] shrink-0">
        <div className="flex items-center gap-2">
          <Clock size={14} className="text-[var(--color-text-muted)]" />
          <span className="text-sm font-medium text-[var(--color-text-primary)]">History</span>
          <span className="text-[10px] font-mono text-[var(--color-text-muted)]">{history.length}</span>
        </div>
        <div className="flex items-center gap-1">
          {history.length > 0 && (
            <button
              onClick={onClear}
              title="Clear history"
              className="p-1.5 rounded-md text-[var(--color-text-muted)] hover:text-[var(--color-accent-danger)] hover:bg-[var(--color-bg-hover)] transition-colors"
            >
              <Trash2 size={14} />
            </button>
          )}
          <button
            onClick={onClose}
            className="p-1.5 rounded-md text-[var(--color-text-muted)] hover:text-white hover:bg-[var(--color-bg-hover)] transition-colors"
          >
            <X size={14} />
          </button>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {history.length === 0 && (
          <p className="text-xs text-[var(--color-text-muted)] text-center mt-8 px-4 leading-relaxed">
            {emptyHint ?? 'Runs you make will be kept here, timeline and all.'}
          </p>
        )}

        {history.map(entry => {
          const layerCount = entry.manifest?.filter(l => !l.hidden).length ?? 0;
          return (
            <button
              key={entry.id}
              onClick={() => onSelect(entry)}
              className={cn(
                'w-full text-left surface-card rounded-xl p-3 border transition-colors',
                entry.id === activeId
                  ? 'border-[var(--color-border-focus)] bg-[var(--color-bg-hover)]'
                  : 'border-[var(--color-border-subtle)] hover:border-[var(--color-border-focus)]',
              )}
            >
              <div className="flex items-start gap-2">
                {entry.failed ? (
                  <AlertCircle size={13} className="text-[var(--color-accent-danger)] shrink-0 mt-0.5" />
                ) : (
                  <CheckCircle2 size={13} className="text-[var(--color-accent-success)] shrink-0 mt-0.5" />
                )}
                <div className="min-w-0 flex-1">
                  {entry.title && (
                    <p className="text-xs font-semibold text-white truncate">{entry.title}</p>
                  )}
                  <p className="text-[11px] text-[var(--color-text-secondary)] line-clamp-2 leading-snug mt-0.5">
                    {entry.prompt}
                  </p>
                  <p className="text-[10px] text-[var(--color-text-muted)] mt-1.5">
                    {relativeTime(entry.timestamp)}
                    {layerCount > 0 && ` · ${layerCount} decisions`}
                  </p>
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </motion.aside>
  );
}
