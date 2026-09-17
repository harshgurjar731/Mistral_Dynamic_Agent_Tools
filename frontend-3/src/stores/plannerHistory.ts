import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { LayerManifestEntry, LayerRuntime } from "@/components/pipeline/PipelineTimeline";
import type { PlannerStep } from "@/components/workflows/PlannerCards";

export interface PlannerRun {
  id: string;
  goal: string;
  workflowName?: string | null | undefined;
  status: "completed" | "failed" | "cancelled";
  createdAt: number;
  detail?: string | undefined;
  /**
   * The layer chain the run executed, where each layer ended up, and the
   * decision payloads — kept so a past run reopens through the same timeline
   * that watched it. Absent on runs recorded before the layer timeline.
   */
  manifest?: LayerManifestEntry[] | undefined;
  runtime?: Record<string, LayerRuntime> | undefined;
  steps?: PlannerStep[] | undefined;
}

interface PlannerHistoryState {
  runs: PlannerRun[];
  addRun: (run: Omit<PlannerRun, "id" | "createdAt">) => void;
  clear: () => void;
}

export const usePlannerHistory = create<PlannerHistoryState>()(
  persist(
    (set) => ({
      runs: [],
      addRun: (run) =>
        set((s) => ({
          runs: [
            {
              ...run,
              id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
              createdAt: Date.now(),
            },
            ...s.runs,
          ].slice(0, 40),
        })),
      clear: () => set({ runs: [] }),
    }),
    { name: "agent_planner_history" },
  ),
);
