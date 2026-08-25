import { create } from "zustand";
import { persist } from "zustand/middleware";

export interface PlannerRun {
  id: string;
  goal: string;
  workflowName?: string | null;
  status: "completed" | "failed" | "cancelled";
  createdAt: number;
  detail?: string;
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
