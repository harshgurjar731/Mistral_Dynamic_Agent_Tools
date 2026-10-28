/**
 * Questions a background run stopped to ask (`decision_required`), on any page.
 *
 * The workflow planner and the agent orchestrator show their own run's
 * question in place, and say so with `useHostRunQuestions`. Every other run's
 * question — a tool or activity synthesis waiting on its prerequisites, or a
 * plan or agent build whose page you left — opens here, so a build never sits
 * waiting for an answer nobody can see.
 */
import { useMemo } from "react";
import { PlanDecisionDialog } from "@/components/workflows/PlanDecisionPanel";
import { isHosted, pendingQuestion, useHostedVersion } from "@/lib/runs/questionHosts";
import { useRunLogVersion, useRunsStore } from "@/stores/runs";

const PAUSED: Record<string, string> = {
  tool_synthesis: "Building the tool is paused — your answer is needed",
  activity_synthesis: "Building the activity is paused — your answer is needed",
  agent: "Agent creation is paused — your answer is needed",
  workflow_plan: "Planning is paused — your answer is needed",
};

export function RunQuestions() {
  const runs = useRunsStore((s) => s.runs);
  // Re-render as any run's log grows, and as pages start or stop hosting.
  const versions = useRunLogVersion((s) => s.versions);
  const hostedVersion = useHostedVersion();

  const waiting = useMemo(() => {
    void versions;
    void hostedVersion;
    for (const run of Object.values(runs)) {
      if (run.status !== "running" || isHosted(run.id)) continue;
      const question = pendingQuestion(run.id);
      if (question) return { run, question };
    }
    return null;
  }, [runs, versions, hostedVersion]);

  if (!waiting) return null;
  return (
    <PlanDecisionDialog
      key={`${waiting.run.id}:${waiting.question.id}`}
      runId={waiting.run.id}
      decision={waiting.question}
      pausedText={`${PAUSED[waiting.run.kind] ?? "A run is paused — your answer is needed"}: ${waiting.run.title}`}
    />
  );
}
