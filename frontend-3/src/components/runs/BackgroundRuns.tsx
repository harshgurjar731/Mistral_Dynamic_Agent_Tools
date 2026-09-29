/**
 * App-level owner of background runs. Mounted once in the root layout, so it
 * outlives every page:
 *
 * - reattaches to runs that were still going when the page was last loaded,
 * - picks up runs started from another tab,
 * - refreshes the lists a finished run changed, and
 * - says when a run finishes, with a link back to it.
 */
import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { QK, runsApi } from "@/api";
import { connectRun, mergeServerRuns, onRunFinished } from "@/lib/runs/connections";
import { useRunsStore } from "@/stores/runs";
import { RUN_KIND_META, runOutputName, useOpenRun } from "./runMeta";

export function BackgroundRuns() {
  const qc = useQueryClient();
  const openRun = useOpenRun();
  const runningKey = useRunsStore((s) =>
    Object.values(s.runs)
      .filter((r) => r.status === "running")
      .map((r) => r.id)
      .sort()
      .join(","),
  );

  // Reattach to everything still running — after a reload the store remembers
  // the ids, and the stream replays what happened meanwhile.
  useEffect(() => {
    if (!runningKey) return;
    for (const id of runningKey.split(",")) connectRun(id);
  }, [runningKey]);

  const { data } = useQuery({
    queryKey: QK.runs(),
    queryFn: () => runsApi.list({ limit: 20 }),
    refetchInterval: runningKey ? 10_000 : 30_000,
    refetchOnWindowFocus: true,
    retry: false,
  });

  useEffect(() => {
    if (data?.runs) mergeServerRuns(data.runs);
  }, [data]);

  useEffect(
    () =>
      onRunFinished((run, { focused }) => {
        const meta = RUN_KIND_META[run.kind];
        const name = runOutputName(run);

        switch (run.kind) {
          case "workflow_plan":
            void qc.invalidateQueries({ queryKey: QK.workflows() });
            break;
          case "agent":
            void qc.invalidateQueries({ queryKey: QK.agents() });
            break;
          default:
            void qc.invalidateQueries({ queryKey: QK.tools() });
            void qc.invalidateQueries({ queryKey: QK.builderCatalog() });
            break;
        }

        // A dialog watching a synthesis reports its own outcome.
        const synthesis = run.kind === "tool_synthesis" || run.kind === "activity_synthesis";
        if (focused && synthesis) return;
        if (run.status === "cancelled") return;

        const action = focused ? undefined : { label: "Open", onClick: () => openRun(run) };
        if (run.status === "completed") {
          toast.success(name ? `${meta.noun} “${name}” is ready` : `${meta.label} finished`, {
            description: focused ? undefined : run.title,
            action,
          });
        } else {
          toast.error(
            run.status === "interrupted" ? `${meta.label} was interrupted` : `${meta.label} failed`,
            { description: run.error ?? run.title, action },
          );
        }
      }),
    [qc, openRun],
  );

  return null;
}
