import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { ArrowLeft, ArrowRight, History, Sparkles, Square, Trash2 } from "lucide-react";
import { createSSEStream, parseEventData } from "@/api/sse";
import { QK } from "@/api";
import { usePlannerHistory } from "@/stores/plannerHistory";
import { PageHeader } from "@/components/shared/PageHeader";
import { GlassPanel, GlassPanelHeader } from "@/components/glass/GlassPanel";
import {
  ArtifactList,
  PlannerPhases,
  type PlannerArtifact,
  type PlannerPhase,
} from "@/components/workflows/PlannerStream";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { EmptyState } from "@/components/ui/EmptyState";
import { formatRelative } from "@/lib/status";

export const Route = createFileRoute("/workflows/new/ai")({
  head: () => ({
    meta: [
      { title: "Plan a workflow — Agentic AI Design Patterns" },
      {
        name: "description",
        content: "Describe an outcome and watch the planner design, compile and register the DAG.",
      },
      { property: "og:title", content: "Plan a workflow — Agentic AI Design Patterns" },
      {
        property: "og:description",
        content: "Describe an outcome and watch the planner design, compile and register the DAG.",
      },
    ],
  }),
  component: AiPlannerPage,
});

const EXAMPLES = [
  "Assess a commercial property insurance claim end to end and produce a settlement recommendation",
  "Screen a supplier for sanctions and financial risk, then draft an onboarding decision memo",
  "Triage an inbound support ticket, gather account context and draft a reply for review",
];

interface WorkflowReady {
  workflow_name: string;
  description?: string;
  step_count?: number;
  entry_step?: string;
  agents?: string[];
}

function AiPlannerPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const runs = usePlannerHistory((s) => s.runs);
  const addRun = usePlannerHistory((s) => s.addRun);
  const clearRuns = usePlannerHistory((s) => s.clear);

  const [goal, setGoal] = useState("");
  const [running, setRunning] = useState(false);
  const [phases, setPhases] = useState<PlannerPhase[]>([]);
  const [artifacts, setArtifacts] = useState<PlannerArtifact[]>([]);
  const [requirements, setRequirements] = useState<string | null>(null);
  const [ready, setReady] = useState<WorkflowReady | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  const stopRef = useRef<(() => void) | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  /** The goal of the run in flight — the textarea is cleared on submit. */
  const goalRef = useRef("");

  useEffect(() => () => stopRef.current?.(), []);
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [phases, ready]);

  const pushPhase = useCallback((label: string, state: PlannerPhase["state"] = "active") => {
    setPhases((prev) => [
      ...prev.map((p) => (p.state === "active" ? { ...p, state: "completed" as const } : p)),
      { id: `${prev.length}-${label.slice(0, 32)}`, label, state },
    ]);
  }, []);

  const settle = useCallback(() => {
    setPhases((prev) =>
      prev.map((p) => (p.state === "active" ? { ...p, state: "completed" as const } : p)),
    );
  }, []);

  const addArtifact = useCallback((a: Omit<PlannerArtifact, "id">) => {
    setArtifacts((prev) =>
      prev.some((x) => x.kind === a.kind && x.name === a.name)
        ? prev
        : [...prev, { ...a, id: `${a.kind}-${a.name}-${prev.length}` }],
    );
  }, []);

  const stop = useCallback(() => {
    stopRef.current?.();
    stopRef.current = null;
    setRunning(false);
    settle();
  }, [settle]);

  const submit = useCallback(() => {
    const value = goal.trim();
    if (!value || running) return;

    goalRef.current = value;
    setGoal("");
    setPhases([]);
    setArtifacts([]);
    setRequirements(null);
    setReady(null);
    setFailure(null);
    setRunning(true);

    let readySnapshot: WorkflowReady | null = null;

    const fail = (message: string) => {
      setFailure(message);
      setPhases((prev) => [
        ...prev.map((p) => (p.state === "active" ? { ...p, state: "completed" as const } : p)),
        { id: `err-${prev.length}`, label: message, state: "error" },
      ]);
      setRunning(false);
      addRun({
        goal: goalRef.current,
        status: "failed",
        detail: message,
        workflowName: readySnapshot?.workflow_name ?? null,
      });
      stopRef.current?.();
      stopRef.current = null;
    };

    stopRef.current = createSSEStream("/api/workflows/plan", {
      method: "POST",
      body: { goal: value },
      onEvent: (event) => {
        switch (event.type) {
          case "status":
            pushPhase(String(parseEventData<string>(event)));
            break;
          case "requirements": {
            const r = parseEventData<{
              tools_needed?: string[];
              agents_needed?: string[];
              description?: string;
            }>(event);
            if (typeof r === "string") break;
            setRequirements(r.description ?? null);
            break;
          }
          case "tool_exists":
          case "tool_new": {
            const t = parseEventData<{ tool_name?: string; status?: string }>(event);
            if (typeof t === "string" || !t.tool_name) break;
            addArtifact({
              kind: "tool",
              name: t.tool_name,
              reused: event.type === "tool_exists",
              ...(t.status ? { detail: t.status } : {}),
            });
            break;
          }
          case "agent_exists":
          case "agent_new": {
            const a = parseEventData<{ agent_name?: string; name?: string; tier?: string }>(event);
            if (typeof a === "string") break;
            const name = a.agent_name ?? a.name;
            if (!name) break;
            addArtifact({
              kind: "agent",
              name,
              reused: event.type === "agent_exists",
              ...(a.tier ? { detail: a.tier } : {}),
            });
            break;
          }
          case "workflow_ready": {
            const w = parseEventData<WorkflowReady>(event);
            if (typeof w === "string") break;
            readySnapshot = w;
            setReady(w);
            break;
          }
          case "compiled": {
            const c = parseEventData<{ error?: string }>(event);
            if (typeof c !== "string" && c.error) {
              pushPhase(`Compilation warning: ${c.error}`, "error");
            }
            break;
          }
          case "registered": {
            const r = parseEventData<{ error?: string }>(event);
            if (typeof r !== "string" && r.error) {
              pushPhase(r.error, "error");
            }
            break;
          }
          case "error":
            fail(String(parseEventData<string>(event)));
            break;
          case "fatal_error": {
            const f = parseEventData<{ error?: string }>(event);
            fail(typeof f === "string" ? f : (f.error ?? "Planning failed"));
            break;
          }
          case "done": {
            const d = parseEventData<{ workflow_name?: string }>(event);
            const name =
              typeof d === "string" ? readySnapshot?.workflow_name : (d.workflow_name ?? null);
            settle();
            setRunning(false);
            qc.invalidateQueries({ queryKey: QK.workflows() });
            addRun({
              goal: goalRef.current,
              status: "completed",
              workflowName: name ?? readySnapshot?.workflow_name ?? null,
            });
            toast.success(name ? `Workflow "${name}" is ready.` : "Workflow planned.");
            break;
          }
          default:
            break;
        }
      },
      onDone: () => setRunning(false),
      onError: (err) => fail(err instanceof Error ? err.message : "Planning stream failed"),
    });
  }, [addArtifact, addRun, goal, pushPhase, qc, running, settle]);

  const started = phases.length > 0 || ready !== null;

  return (
    <div className="space-y-6 px-6 py-8">
      <PageHeader
        eyebrow="Planner"
        title="Plan a workflow"
        description="One sentence in, a compiled and registered DAG out. Each phase streams live so you can see which tools were reused and which agents were created."
        actions={
          <Button variant="outline" size="sm" asChild>
            <Link to="/workflows/new">
              <ArrowLeft className="size-3.5" /> Back
            </Link>
          </Button>
        }
      />

      <div className="grid gap-5 lg:grid-cols-[1fr_340px]">
        <div className="min-w-0 space-y-5">
          <GlassPanel tone="raised" className="p-5">
            <p className="eyebrow mb-2">Goal</p>
            <Textarea
              rows={3}
              value={goal}
              disabled={running}
              placeholder="Describe the outcome you want, in one or two sentences…"
              onChange={(e) => setGoal(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submit();
              }}
              className="resize-none"
            />
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Button onClick={submit} disabled={running || goal.trim().length === 0}>
                <Sparkles className="size-4" /> {running ? "Planning…" : "Plan workflow"}
              </Button>
              {running ? (
                <Button variant="outline" onClick={stop}>
                  <Square className="size-3.5" /> Stop
                </Button>
              ) : null}
              <span className="technical-label ml-auto">cmd / ctrl + enter</span>
            </div>

            {!started ? (
              <div className="mt-4 flex flex-wrap gap-2 border-t border-border pt-4">
                {EXAMPLES.map((ex) => (
                  <button
                    key={ex}
                    type="button"
                    onClick={() => setGoal(ex)}
                    className="rounded-lg border border-border glass px-3 py-2 text-left text-xs text-muted-foreground transition hover:bg-surface-hover hover:text-foreground"
                  >
                    {ex}
                  </button>
                ))}
              </div>
            ) : null}
          </GlassPanel>

          {requirements ? (
            <GlassPanel className="p-4">
              <p className="eyebrow mb-1.5">What the planner understood</p>
              <p className="text-sm text-foreground">{requirements}</p>
            </GlassPanel>
          ) : null}

          {started ? (
            <GlassPanel>
              <GlassPanelHeader
                title="Pipeline"
                description="Analyse → tools → agents → DAG → compile → register"
              />
              <div className="p-5">
                <PlannerPhases phases={phases} />
                {running && phases.length === 0 ? (
                  <div className="shimmer h-16 rounded-lg border border-border" />
                ) : null}
              </div>
            </GlassPanel>
          ) : null}

          {failure ? (
            <GlassPanel className="border-red/25 bg-red/5 p-4">
              <p className="text-sm font-semibold text-foreground">Planning failed</p>
              <p className="mt-1 text-xs break-words text-muted-foreground">{failure}</p>
            </GlassPanel>
          ) : null}

          {ready ? (
            <GlassPanel tone="raised" className="p-5">
              <p className="eyebrow mb-1.5">Workflow saved</p>
              <h2 className="font-display text-base font-bold text-foreground">
                {ready.workflow_name}
              </h2>
              {ready.description ? (
                <p className="mt-2 text-sm text-muted-foreground">{ready.description}</p>
              ) : null}
              <div className="mt-3 flex flex-wrap items-center gap-3">
                {ready.step_count ? (
                  <span className="technical-label">{ready.step_count} steps</span>
                ) : null}
                {ready.entry_step ? (
                  <span className="technical-label">entry · {ready.entry_step}</span>
                ) : null}
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                <Button
                  onClick={() =>
                    navigate({
                      to: "/workflows/$workflowName",
                      params: { workflowName: ready.workflow_name },
                    })
                  }
                >
                  Open workflow <ArrowRight className="size-4" />
                </Button>
                <Button variant="outline" asChild>
                  <Link
                    to="/workflows/$workflowName/execute"
                    params={{ workflowName: ready.workflow_name }}
                  >
                    Run it
                  </Link>
                </Button>
              </div>
            </GlassPanel>
          ) : null}

          <div ref={bottomRef} />
        </div>

        <div className="space-y-5">
          <GlassPanel>
            <GlassPanelHeader title="Resources" description="Reused or created for this run" />
            <div className="p-4">
              <ArtifactList artifacts={artifacts} />
            </div>
          </GlassPanel>

          <GlassPanel>
            <GlassPanelHeader
              title="Recent runs"
              description="Kept in this browser only"
              actions={
                runs.length > 0 ? (
                  <Button size="sm" variant="ghost" onClick={clearRuns}>
                    <Trash2 className="size-3.5" />
                  </Button>
                ) : undefined
              }
            />
            <div className="p-4">
              {runs.length === 0 ? (
                <EmptyState
                  icon={<History className="size-5" />}
                  title="No planner runs yet."
                  className="py-8"
                />
              ) : (
                <ul className="space-y-2">
                  {runs.map((r) => (
                    <li
                      key={r.id}
                      className="rounded-lg border border-border bg-background-elevated/60 p-2.5"
                    >
                      <p className="line-clamp-2 text-xs text-foreground">{r.goal}</p>
                      <div className="mt-1.5 flex items-center justify-between gap-2">
                        <span
                          className={
                            r.status === "completed"
                              ? "font-mono text-[9px] font-bold text-emerald uppercase"
                              : "font-mono text-[9px] font-bold text-red uppercase"
                          }
                        >
                          {r.status}
                        </span>
                        <span className="technical-label">{formatRelative(r.createdAt)}</span>
                      </div>
                      {r.workflowName ? (
                        <Link
                          to="/workflows/$workflowName"
                          params={{ workflowName: r.workflowName }}
                          className="mt-1 block truncate font-mono text-[10px] text-primary hover:underline"
                        >
                          {r.workflowName}
                        </Link>
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </GlassPanel>
        </div>
      </div>
    </div>
  );
}
