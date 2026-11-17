import type { PlannerRun } from "@/stores/plannerHistory";

/**
 * A planning run kept in this browser, or one reconstructed from a saved
 * workflow. The history itself is shown by `components/runs/PlanningHistory`,
 * from the server's runs; these entries fill in what the server no longer has.
 */
export interface PlannerHistoryEntry extends PlannerRun {
  fromBackend?: boolean;
}
