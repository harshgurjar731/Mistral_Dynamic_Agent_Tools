/**
 * "Test with scenarios" in the builder — the planner's Verify stage for a
 * workflow built or edited by hand.
 *
 * The run (`workflow_verify`) designs scenarios, dry-runs each one with
 * connectors and reviews stubbed, and when one fails plans a fix with Refine
 * with AI. Each fix is put to the user before it is applied (the global
 * question dialog, with its countdown). This panel shows every step of that as
 * it happens: the run's progress, each sublayer (a scenario run, a repair and
 * its fix plan), the scenarios designed and the final result.
 */
import { useEffect, useMemo } from "react";
import { AlertCircle, CheckCircle2, Circle, Loader2, MinusCircle } from "lucide-react";
import { parseEventData } from "@/api/sse";
import {
  AgentEvaluationCard,
  type AgentEvaluationView,
} from "@/components/orchestrator/AgentDecisionCards";
import { RunProgressCard } from "@/components/runs/RunProgress";
import { getRunLog, stopRun } from "@/lib/runs/connections";
import { pendingQuestion } from "@/lib/runs/questionHosts";
import { useTrackedRun } from "@/lib/runs/useRun";
import { cn } from "@/lib/utils";
import { useRunLogVersion } from "@/stores/runs";
import { DryRunCard, ScenariosCard, type DryRunData, type ScenarioData } from "./PlannerCards";

interface SubLayer {
  parent: string;
  id: string;
  state: string;
  label?: string;
  summary?: string;
  error?: string;
}

const PARENTS: Record<string, string> = {
  scenario_design: "Design test scenarios",
  workflow_dry_run: "Dry-run and repair",
  agent_evaluation: "Test the agent",
};

function StateIcon({ state }: { state: string }) {
  if (state === "active") return <Loader2 className="size-3 shrink-0 animate-spin text-primary" />;
  if (state === "completed") return <CheckCircle2 className="size-3 shrink-0 text-emerald" />;
  if (state === "failed") return <AlertCircle className="size-3 shrink-0 text-red" />;
  if (state === "skipped") return <MinusCircle className="size-3 shrink-0 text-muted-foreground" />;
  return <Circle className="size-3 shrink-0 text-muted-foreground" />;
}

function useVerifyEvents(runId: string) {
  const version = useRunLogVersion((s) => s.versions[runId] ?? 0);
  return useMemo(() => {
    void version;
    const subs = new Map<string, SubLayer>();
    let scenarios: ScenarioData[] | null = null;
    let result: DryRunData | null = null;
    let evaluation: AgentEvaluationView | null = null;
    for (const event of getRunLog(runId).events) {
      if (event.type === "sublayer") {
        const p = parseEventData<SubLayer>(event);
        if (typeof p !== "string" && p.id) {
          const key = `${p.parent}/${p.id}`;
          subs.set(key, { ...subs.get(key), ...p });
        }
      } else if (event.type === "test_scenarios") {
        const p = parseEventData<ScenarioData[]>(event);
        if (Array.isArray(p)) scenarios = p;
      } else if (event.type === "agent_evaluation") {
        const p = parseEventData<AgentEvaluationView>(event);
        if (typeof p !== "string") evaluation = p;
      } else if (event.type === "dry_run") {
        const p = parseEventData<DryRunData>(event);
        if (typeof p !== "string") result = p;
      }
    }
    return { subs: [...subs.values()], scenarios, result, evaluation };
  }, [runId, version]);
}

const SCENARIO_INTRO =
  "Each scenario runs the saved workflow as a dry run: connectors and human reviews are stubbed, " +
  "so nothing is sent. When one fails, a fix is planned and you are asked before it is applied — " +
  "every applied fix is a version you can undo.";

export function ScenarioTestPanel({
  runId,
  onQuestion,
  intro = SCENARIO_INTRO,
}: {
  runId: string;
  /** What the test does, shown above its steps. */
  intro?: string | undefined;
  /** The run is asking something (apply a fix?): the global question dialog shows it. */
  onQuestion?: (() => void) | undefined;
}) {
  const run = useTrackedRun(runId);
  const { subs, scenarios, result, evaluation } = useVerifyEvents(runId);
  const version = useRunLogVersion((s) => s.versions[runId] ?? 0);
  const question = useMemo(() => {
    void version;
    return run?.status === "running" ? pendingQuestion(runId) : null;
  }, [runId, run?.status, version]);
  useEffect(() => {
    if (question) onQuestion?.();
  }, [question?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const groups = Object.keys(PARENTS)
    .map((parent) => ({ parent, items: subs.filter((s) => s.parent === parent) }))
    .filter((g) => g.items.length);

  return (
    <div className="space-y-3">
      {run ? (
        <RunProgressCard
          run={run}
          onStop={run.status === "running" ? () => void stopRun(run.id) : undefined}
        />
      ) : null}
      <p className="text-[11px] text-muted-foreground">{intro}</p>
      {groups.map((g) => (
        <section key={g.parent} className="space-y-1">
          <p className="eyebrow">{PARENTS[g.parent]}</p>
          <ul className="space-y-1">
            {g.items.map((s) => (
              <li
                key={`${s.parent}/${s.id}`}
                className="rounded-md border border-border/60 bg-background-elevated/50 px-2 py-1.5 text-[11px]"
              >
                <div className="flex items-center gap-1.5">
                  <StateIcon state={s.state} />
                  <span className="min-w-0 flex-1 truncate text-foreground">{s.label ?? s.id}</span>
                </div>
                {s.summary || s.error ? (
                  <p
                    className={cn(
                      "mt-0.5 ml-[18px] break-words",
                      s.error ? "text-red" : "text-muted-foreground",
                    )}
                  >
                    {s.error || s.summary}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ))}
      {scenarios && !result ? <ScenariosCard data={scenarios} /> : null}
      {result ? <DryRunCard data={result} /> : null}
      {evaluation ? <AgentEvaluationCard data={evaluation} /> : null}
    </div>
  );
}
