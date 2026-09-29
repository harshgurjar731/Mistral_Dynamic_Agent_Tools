import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { errorMessage, runsApi } from "@/api";
import type { TrackedRun } from "@/stores/runs";
import { focusRun, trackStartedRun } from "./connections";
import { useTrackedRun } from "./useRun";

/**
 * Agent tool / activity synthesis as a background run, for a dialog that starts
 * it. While `watching` (the dialog is open) the dialog reports the outcome
 * itself; close it and the run carries on, reported by the global toast.
 */
export function useSynthesisRun(
  purpose: "tool" | "activity",
  {
    watching,
    onFinished,
  }: { watching: boolean; onFinished?: ((run: TrackedRun, watching: boolean) => void) | undefined },
) {
  const [runId, setRunId] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const run = useTrackedRun(runId);

  const onFinishedRef = useRef(onFinished);
  onFinishedRef.current = onFinished;
  const watchingRef = useRef(watching);
  watchingRef.current = watching;
  const handledRef = useRef<string | null>(null);

  useEffect(() => {
    if (!watching || !runId) return;
    return focusRun(runId);
  }, [watching, runId]);

  useEffect(() => {
    if (!run || run.status === "running" || handledRef.current === run.id) return;
    handledRef.current = run.id;
    onFinishedRef.current?.(run, watchingRef.current);
  }, [run]);

  const start = useCallback(
    async (task: string) => {
      setStarting(true);
      try {
        const started = await runsApi.startSynthesis(task, purpose);
        trackStartedRun(started);
        setRunId(started.id);
        return started;
      } catch (err) {
        toast.error(`Could not start synthesis: ${errorMessage(err)}`);
        return null;
      } finally {
        setStarting(false);
      }
    },
    [purpose],
  );

  const clear = useCallback(() => setRunId(null), []);

  return {
    run,
    start,
    clear,
    starting,
    busy: starting || run?.status === "running",
  };
}
