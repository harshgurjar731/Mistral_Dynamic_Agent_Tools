/**
 * usePipelineRun — tracks one orchestration run from its SSE stream.
 *
 * Both pipelines announce themselves the same way: a `pipeline` event carrying
 * the layer manifest, then `layer` events as each one changes state. This hook
 * owns that protocol so the agent screen and the workflow planner do not each
 * re-implement it, and a layer added on the backend appears in both timelines
 * without a frontend change.
 *
 * The protocol itself is also exported as pure functions, so a background run
 * can rebuild the same state by replaying its event log.
 */
import { useCallback, useState } from "react";
import type { LayerManifestEntry, LayerRuntime, LayerState } from "./PipelineTimeline";

export interface PipelineRun {
  manifest: LayerManifestEntry[];
  runtime: Record<string, LayerRuntime>;
  /** Free-text sub-progress from whichever layer is currently running. */
  activeNote: string;
  /** True once a manifest has arrived — i.e. there is a chain worth drawing. */
  started: boolean;
}

export const EMPTY_PIPELINE: PipelineRun = {
  manifest: [],
  runtime: {},
  activeNote: "",
  started: false,
};

interface LayerEvent {
  name: string;
  state: LayerState;
  ms?: number;
  summary?: string;
  error?: string;
}

function mapRunning(
  runtime: Record<string, LayerRuntime>,
  update: (v: LayerRuntime) => LayerRuntime,
): Record<string, LayerRuntime> {
  return Object.fromEntries(
    Object.entries(runtime).map(([k, v]) => [k, v.state === "active" ? update(v) : v]),
  );
}

/**
 * Apply one SSE frame. Returns null when the frame is not part of the pipeline
 * protocol, so callers only handle their own payloads.
 */
export function applyPipelineEvent(
  prev: PipelineRun,
  type: string,
  data: string,
): PipelineRun | null {
  if (type === "pipeline") {
    try {
      const parsed = JSON.parse(data) as { layers?: LayerManifestEntry[] };
      return { manifest: parsed.layers ?? [], runtime: {}, activeNote: "", started: true };
    } catch {
      /* a malformed manifest just leaves the timeline empty */
      return prev;
    }
  }

  if (type === "layer") {
    try {
      const p = JSON.parse(data) as LayerEvent;
      return {
        ...prev,
        // A new layer going active clears the previous one's sub-progress,
        // so a stale note never sits under the wrong row.
        activeNote: p.state === "active" ? "" : prev.activeNote,
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
      };
    } catch {
      return prev;
    }
  }

  if (type === "status") return { ...prev, activeNote: data };

  return null;
}

/** Mark anything still running as finished. */
export function settlePipeline(prev: PipelineRun): PipelineRun {
  return {
    ...prev,
    activeNote: "",
    runtime: mapRunning(prev.runtime, (v) => ({ ...v, state: "completed" })),
  };
}

/** Mark anything still running as failed. */
export function failPipeline(prev: PipelineRun, message: string): PipelineRun {
  return {
    ...prev,
    activeNote: "",
    runtime: mapRunning(prev.runtime, (v) => ({ ...v, state: "failed", error: message })),
  };
}

export function usePipelineRun() {
  const [run, setRun] = useState<PipelineRun>(EMPTY_PIPELINE);

  const reset = useCallback(() => setRun(EMPTY_PIPELINE), []);

  /**
   * Feed one SSE frame. Returns true when the frame belonged to the pipeline
   * protocol, so callers only handle their own payloads. Layer events can
   * arrive in the same tick as the manifest, so updates are always functional.
   */
  const handleEvent = useCallback((type: string, data: string): boolean => {
    if (type !== "pipeline" && type !== "layer" && type !== "status") return false;
    setRun((prev) => applyPipelineEvent(prev, type, data) ?? prev);
    return true;
  }, []);

  /** Mark anything still running as finished, when the stream closes. */
  const settle = useCallback(() => setRun(settlePipeline), []);

  const failRunning = useCallback((message: string) => {
    setRun((prev) => failPipeline(prev, message));
  }, []);

  /** Re-hydrate a finished run — used when replaying a history entry. */
  const restore = useCallback(
    (manifest?: LayerManifestEntry[] | null, runtime?: Record<string, LayerRuntime> | null) => {
      const m = manifest ?? [];
      setRun({ manifest: m, runtime: runtime ?? {}, activeNote: "", started: m.length > 0 });
    },
    [],
  );

  return { run, reset, restore, handleEvent, settle, failRunning };
}
