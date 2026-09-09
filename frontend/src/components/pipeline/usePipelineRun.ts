/**
 * usePipelineRun — Tracks one orchestration run from its SSE stream.
 *
 * Both pipelines announce themselves the same way: a `pipeline` event carrying
 * the layer manifest, then `layer` events as each one changes state. This hook
 * owns that protocol so the agent screen and the workflow screen do not each
 * re-implement it, and so a layer added on the backend appears in both timelines
 * without a frontend change.
 */
import { useCallback, useRef, useState } from 'react';
import type { LayerManifestEntry, LayerRuntime, LayerState } from './PipelineTimeline';

export interface PipelineRun {
  manifest: LayerManifestEntry[];
  runtime: Record<string, LayerRuntime>;
  /** Free-text sub-progress from whichever layer is currently running. */
  activeNote: string;
  /** True once a manifest has arrived — i.e. there is a chain worth drawing. */
  started: boolean;
}

const EMPTY: PipelineRun = { manifest: [], runtime: {}, activeNote: '', started: false };

export function usePipelineRun() {
  const [run, setRun] = useState<PipelineRun>(EMPTY);

  // Layer events can arrive in the same tick as the manifest, so state updates
  // are always applied functionally rather than read back from `run`.
  const reset = useCallback(() => setRun(EMPTY), []);

  const handleEvent = useCallback((type: string, data: string): boolean => {
    if (type === 'pipeline') {
      try {
        const parsed = JSON.parse(data) as { layers: LayerManifestEntry[] };
        setRun({
          manifest: parsed.layers ?? [],
          runtime: {},
          activeNote: '',
          started: true,
        });
      } catch { /* a malformed manifest just leaves the timeline empty */ }
      return true;
    }

    if (type === 'layer') {
      try {
        const p = JSON.parse(data) as {
          name: string; state: LayerState; ms?: number; summary?: string; error?: string;
        };
        setRun(prev => ({
          ...prev,
          // A new layer going active clears the previous one's sub-progress,
          // so a stale note never sits under the wrong row.
          activeNote: p.state === 'active' ? '' : prev.activeNote,
          runtime: {
            ...prev.runtime,
            [p.name]: {
              state: p.state,
              ms: p.ms,
              // Keep an earlier summary if this update carries none.
              summary: p.summary || prev.runtime[p.name]?.summary,
              error: p.error,
            },
          },
        }));
      } catch { /* ignore */ }
      return true;
    }

    if (type === 'status') {
      setRun(prev => ({ ...prev, activeNote: data }));
      return true;
    }

    return false;
  }, []);

  /** Mark anything still running as finished, when the stream closes. */
  const settle = useCallback(() => {
    setRun(prev => ({
      ...prev,
      activeNote: '',
      runtime: Object.fromEntries(
        Object.entries(prev.runtime).map(([k, v]) =>
          [k, v.state === 'active' ? { ...v, state: 'completed' as LayerState } : v],
        ),
      ),
    }));
  }, []);

  const failRunning = useCallback((message: string) => {
    setRun(prev => ({
      ...prev,
      activeNote: '',
      runtime: Object.fromEntries(
        Object.entries(prev.runtime).map(([k, v]) =>
          [k, v.state === 'active' ? { ...v, state: 'failed' as LayerState, error: message } : v],
        ),
      ),
    }));
  }, []);

  /** Re-hydrate a finished run — used when replaying a history entry. */
  const restore = useCallback(
    (manifest: LayerManifestEntry[], runtime: Record<string, LayerRuntime>) => {
      setRun({ manifest: manifest ?? [], runtime: runtime ?? {}, activeNote: '', started: (manifest ?? []).length > 0 });
    },
    [],
  );

  const cardsRef = useRef<Record<string, unknown>>({});
  return { run, reset, restore, handleEvent, settle, failRunning, cardsRef };
}
