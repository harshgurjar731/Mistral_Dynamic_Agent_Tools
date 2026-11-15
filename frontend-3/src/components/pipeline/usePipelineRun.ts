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
import type { ProcessUse } from "@/api/processes";
import type {
  LayerManifestEntry,
  LayerRuntime,
  LayerState,
  RewindNote,
  SubLayer,
} from "./PipelineTimeline";

export interface PipelineRun {
  manifest: LayerManifestEntry[];
  runtime: Record<string, LayerRuntime>;
  /** Free-text sub-progress from whichever layer is currently running. */
  activeNote: string;
  /** How far the running layer is through its own work, 0–1, as the backend measured it. */
  activeFraction?: number | undefined;
  /** True once a manifest has arrived — i.e. there is a chain worth drawing. */
  started: boolean;
  /** Each time a check sent the run back to an earlier layer to fix what it found. */
  rewinds?: RewindNote[] | undefined;
}

export const EMPTY_PIPELINE: PipelineRun = {
  manifest: [],
  runtime: {},
  activeNote: "",
  activeFraction: 0,
  started: false,
  rewinds: [],
};

interface SubLayerEvent extends Partial<SubLayer> {
  parent: string;
  id: string;
}

/** Insert or update one sublayer of ``parent``, keeping the order they first appeared in. */
function upsertSub(prev: PipelineRun, p: SubLayerEvent): PipelineRun {
  const layer = prev.runtime[p.parent] ?? { state: "active" as LayerState };
  const subs = [...(layer.subs ?? [])];
  const i = subs.findIndex((x) => x.id === p.id);
  const before = i >= 0 ? subs[i] : undefined;
  const next: SubLayer = {
    id: p.id,
    label: p.label || before?.label || p.id,
    state: p.state ?? before?.state ?? "active",
    summary: p.summary || before?.summary,
    detail: p.detail || before?.detail,
    error: p.error || (p.state === "failed" ? before?.error : undefined),
    ms: p.ms ?? before?.ms,
  };
  if (i >= 0) subs[i] = next;
  else subs.push(next);
  return { ...prev, runtime: { ...prev.runtime, [p.parent]: { ...layer, subs } } };
}

interface LayerEvent {
  name: string;
  state: LayerState;
  ms?: number;
  summary?: string;
  error?: string;
  /** What this layer used from the run's process knowledge. */
  process?: ProcessUse[];
}

const STEP_VERB: Record<string, string> = {
  model: "Calling model",
  tool: "Running tool",
  step: "Workflow step",
};

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
      return {
        manifest: parsed.layers ?? [],
        runtime: {},
        activeNote: "",
        activeFraction: 0,
        started: true,
      };
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
        // Each layer measures its own work from zero.
        activeFraction: p.state === "active" ? 0 : prev.activeFraction,
        runtime: {
          ...prev.runtime,
          [p.name]: {
            state: p.state,
            ms: p.ms,
            // Keep an earlier summary if this update carries none.
            summary: p.summary || prev.runtime[p.name]?.summary,
            error: p.error,
            process: p.process ?? prev.runtime[p.name]?.process,
            // Sublayers arrive on their own events; a state change keeps them.
            subs: prev.runtime[p.name]?.subs,
          },
        },
      };
    } catch {
      return prev;
    }
  }

  if (type === "status") return { ...prev, activeNote: data };

  // One atomic step inside a layer: decide / check / repair, each build, each scenario.
  if (type === "sublayer") {
    try {
      const p = JSON.parse(data) as SubLayerEvent;
      return p.parent && p.id ? upsertSub(prev, p) : prev;
    } catch {
      return prev;
    }
  }

  // A check sent the run back: the layers it re-runs start again from pending.
  if (type === "rewind") {
    try {
      const p = JSON.parse(data) as RewindNote & { reset?: string[] };
      const runtime = { ...prev.runtime };
      for (const name of p.reset ?? []) delete runtime[name];
      return {
        ...prev,
        runtime,
        activeNote: "",
        rewinds: [
          ...(prev.rewinds ?? []),
          { to: p.to, from: p.from, round: p.round, reason: p.reason, issues: p.issues },
        ],
      };
    } catch {
      return prev;
    }
  }

  // Progress inside the running layer (``app.progress`` on the backend).
  if (type === "stage") {
    try {
      const p = JSON.parse(data) as { label?: string; fraction?: number };
      return {
        ...prev,
        activeNote: p.label || prev.activeNote,
        activeFraction:
          typeof p.fraction === "number"
            ? Math.max(prev.activeFraction ?? 0, p.fraction)
            : prev.activeFraction,
      };
    } catch {
      return prev;
    }
  }
  if (type === "step") {
    try {
      const p = JSON.parse(data) as { kind?: string; name?: string; state?: string };
      if (p.state !== "active" || !p.name) return prev;
      const verb = STEP_VERB[p.kind ?? ""];
      return { ...prev, activeNote: verb ? `${verb} · ${p.name}` : p.name };
    } catch {
      return prev;
    }
  }
  // Log lines are for the run log, not the timeline.
  if (type === "log") return prev;

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

const PIPELINE_EVENTS = new Set([
  "pipeline",
  "layer",
  "status",
  "stage",
  "step",
  "log",
  "sublayer",
  "rewind",
]);

export function usePipelineRun() {
  const [run, setRun] = useState<PipelineRun>(EMPTY_PIPELINE);

  const reset = useCallback(() => setRun(EMPTY_PIPELINE), []);

  /**
   * Feed one SSE frame. Returns true when the frame belonged to the pipeline
   * protocol, so callers only handle their own payloads. Layer events can
   * arrive in the same tick as the manifest, so updates are always functional.
   */
  const handleEvent = useCallback((type: string, data: string): boolean => {
    if (!PIPELINE_EVENTS.has(type)) return false;
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
