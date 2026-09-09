/**
 * useRunHistory — Persists finished orchestration runs, timeline included.
 *
 * A run is worth keeping for the same reason the timeline is worth drawing:
 * it records which decisions were made and why. Keeping only the final agent
 * throws away the reasoning that produced it, which is exactly what someone
 * comes back to a past run to read.
 *
 * Stored in localStorage, matching the workflow planner's existing history.
 * The decisions are small JSON payloads, so an entry is a few kilobytes; the
 * cap keeps the whole store well inside a browser's quota.
 */
import { useCallback, useEffect, useState } from 'react';
import type { LayerManifestEntry, LayerRuntime } from './PipelineTimeline';

export interface RunHistoryEntry {
  id: string;
  timestamp: number;
  /** What the user asked for. */
  prompt: string;
  /** The chain that executed, and where each layer ended up. */
  manifest: LayerManifestEntry[];
  runtime: Record<string, LayerRuntime>;
  /** Decision payloads keyed by event name, for re-rendering the cards. */
  decisions: Record<string, unknown>;
  /** Whatever the caller wants to show in the list row. */
  title?: string | null;
  agentId?: string | null;
  response?: string;
  failed?: boolean;
}

const MAX_ENTRIES = 40;

export function useRunHistory(storageKey: string) {
  const [history, setHistory] = useState<RunHistoryEntry[]>([]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw) setHistory(JSON.parse(raw));
    } catch {
      // A corrupt or unreadable store is not worth failing the page over —
      // the history is a convenience, not the record of truth.
    }
  }, [storageKey]);

  const persist = useCallback(
    (next: RunHistoryEntry[]) => {
      setHistory(next);
      try {
        localStorage.setItem(storageKey, JSON.stringify(next));
      } catch {
        // Quota exceeded, or storage disabled. Losing the write is acceptable;
        // the in-memory list still works for this session.
      }
    },
    [storageKey],
  );

  const save = useCallback(
    (entry: Omit<RunHistoryEntry, 'id' | 'timestamp'>) => {
      const full: RunHistoryEntry = {
        ...entry,
        id: crypto.randomUUID(),
        timestamp: Date.now(),
      };
      setHistory(prev => {
        const next = [full, ...prev].slice(0, MAX_ENTRIES);
        try {
          localStorage.setItem(storageKey, JSON.stringify(next));
        } catch { /* see persist */ }
        return next;
      });
      return full;
    },
    [storageKey],
  );

  const remove = useCallback(
    (id: string) => persist(history.filter(h => h.id !== id)),
    [history, persist],
  );

  const clear = useCallback(() => persist([]), [persist]);

  return { history, save, remove, clear };
}
