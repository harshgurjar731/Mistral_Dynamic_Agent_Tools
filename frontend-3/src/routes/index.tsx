import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import {
  AlertTriangle,
  ArrowRight,
  Bot,
  Clock,
  FileText,
  History,
  Layers,
  RefreshCw,
  RotateCcw,
  Search,
  Sparkles,
  Trash2,
  Users,
  Zap,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { z } from "zod";
import { parseEventData, type SSEEvent } from "@/api/sse";
import { errorMessage, runsApi, type RunStatus } from "@/api";
import { Composer } from "@/components/chat/Composer";
import { Markdown } from "@/components/chat/Markdown";
import { TierSelector } from "@/components/chat/TierSelector";
import {
  AGENT_DECISION_EVENTS,
  agentLayerCards,
  agentLayerRaw,
  type AgentDecisions,
} from "@/components/orchestrator/AgentDecisionCards";
import {
  PipelineTimeline,
  type LayerManifestEntry,
  type LayerRuntime,
} from "@/components/pipeline/PipelineTimeline";
import {
  applyPipelineEvent,
  EMPTY_PIPELINE,
  failPipeline,
  settlePipeline,
  type PipelineRun,
} from "@/components/pipeline/usePipelineRun";
import { formatElapsed } from "@/components/runs/runMeta";
import { stopRun, trackStartedRun } from "@/lib/runs/connections";
import { useElapsed, useRunReducer, useRunView, useTrackedRun } from "@/lib/runs/useRun";
import { useRunsStore } from "@/stores/runs";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { formatRelative } from "@/lib/status";
import { cn } from "@/lib/utils";

const searchSchema = z.object({
  /** The background agent run on screen. */
  run: z.string().optional(),
});

export const Route = createFileRoute("/")({
  validateSearch: searchSchema,
  head: () => ({
    meta: [
      { title: "Orchestrator — Agentic AI Design Patterns" },
      {
        name: "description",
        content:
          "Describe a goal in natural language and watch the platform design, equip and run a purpose-built AI agent live.",
      },
      { property: "og:title", content: "Orchestrator — Agentic AI Design Patterns" },
      {
        property: "og:description",
        content:
          "Describe a goal in natural language and watch the platform design, equip and run a purpose-built AI agent live.",
      },
    ],
  }),
  component: OrchestratorChat,
});

const SUGGESTIONS = [
  {
    text: "Summarise last quarter's incident reports and flag recurring root causes",
    icon: FileText,
    label: "Incident Analysis",
  },
  {
    text: "Research three competitors and produce a positioning brief",
    icon: Search,
    label: "Competitive Research",
  },
  {
    text: "Draft an onboarding checklist for a new data engineer",
    icon: Users,
    label: "Onboarding Plan",
  },
];

/**
 * A finished run, timeline included — kept so a past run is reopened through
 * the same timeline that watched it happen. Entries recorded before the layer
 * timeline existed carry no manifest and reopen as prompt + answer only.
 */
interface OrchestratorRunEntry {
  id: string;
  /** The background run this entry records — keeps a run from being saved twice. */
  runId?: string | null | undefined;
  timestamp: number;
  prompt: string;
  manifest?: LayerManifestEntry[];
  runtime?: Record<string, LayerRuntime>;
  decisions?: AgentDecisions;
  title?: string | null;
  response?: string;
  /** Pre-timeline entries stored the answer here. */
  answer?: string;
  agentId?: string | null;
  failed?: boolean;
}

const HISTORY_KEY = "agent_orchestrator_history";
const MAX_HISTORY = 40;

/* ── Run → view ────────────────────────────────────────────────────────── */

interface AgentView {
  pipeline: PipelineRun;
  decisions: AgentDecisions;
  answer: string;
  conversationId: string | null;
  agentId: string | null;
  errorText: string | null;
  /** Set once the run's `run_end` has been replayed. */
  end: { status: RunStatus; error: string | null } | null;
}

const initAgentView = (): AgentView => ({
  pipeline: EMPTY_PIPELINE,
  decisions: {},
  answer: "",
  conversationId: null,
  agentId: null,
  errorText: null,
  end: null,
});

/**
 * The orchestrator's event handling as a pure fold, so a run watched live,
 * reopened mid-way, or replayed after a reload renders the same screen.
 */
function reduceAgent(view: AgentView, event: SSEEvent): AgentView {
  const pipeline = applyPipelineEvent(view.pipeline, event.type, event.data);
  if (pipeline) return { ...view, pipeline };

  if (AGENT_DECISION_EVENTS.has(event.type as keyof AgentDecisions)) {
    const parsed = parseEventData<unknown>(event);
    if (typeof parsed === "string") return view;
    return { ...view, decisions: { ...view.decisions, [event.type]: parsed } };
  }

  switch (event.type) {
    case "text_chunk":
      return { ...view, answer: view.answer + event.data };
    case "conversation_id":
      return { ...view, conversationId: event.data };
    case "error":
      return {
        ...view,
        errorText: event.data,
        pipeline: failPipeline(view.pipeline, event.data),
      };
    case "done": {
      const done = parseEventData<{ agent_id?: string }>(event);
      return typeof done !== "string" && done.agent_id ? { ...view, agentId: done.agent_id } : view;
    }
    case "run_end": {
      const end = parseEventData<{ status?: RunStatus; error?: string | null }>(event);
      const status: RunStatus = typeof end === "string" ? "completed" : (end.status ?? "completed");
      const error = typeof end === "string" ? null : (end.error ?? null);
      if (status === "completed") {
        return { ...view, end: { status, error }, pipeline: settlePipeline(view.pipeline) };
      }
      if (status === "cancelled") {
        return {
          ...view,
          end: { status, error },
          pipeline: failPipeline(view.pipeline, "Stopped before it finished."),
        };
      }
      const message = view.errorText ?? error ?? "Generation failed";
      return {
        ...view,
        end: { status, error },
        errorText: message,
        pipeline: failPipeline(view.pipeline, message),
      };
    }
    default:
      return view;
  }
}

function OrchestratorChat() {
  const navigate = useNavigate({ from: Route.fullPath });
  const { run: runId } = Route.useSearch();

  const [input, setInput] = useState("");
  const [tier, setTier] = useState("domain");
  const [starting, setStarting] = useState(false);
  /** The prompt of a run being started, shown before the run exists. */
  const [pendingQuery, setPendingQuery] = useState<string | null>(null);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [history, setHistory] = useState<OrchestratorRunEntry[]>([]);
  /** A saved history entry being shown, instead of a live run. */
  const [replay, setReplay] = useState<OrchestratorRunEntry | null>(null);

  const bottomRef = useRef<HTMLDivElement>(null);

  const tracked = useTrackedRun(runId);
  const { missing } = useRunView(runId);
  const view = useRunReducer(runId, reduceAgent, initAgentView);

  // Until the run's summary loads, a run without a replayed ending counts as live.
  const running =
    Boolean(runId) && !missing && !view.end && (tracked ? tracked.status === "running" : true);
  const isProcessing = running || starting;
  const elapsed = useElapsed(tracked?.created_at, running, tracked?.finished_at);

  const run = useMemo<PipelineRun>(
    () =>
      replay
        ? {
            manifest: replay.manifest ?? [],
            runtime: replay.runtime ?? {},
            activeNote: "",
            started: (replay.manifest?.length ?? 0) > 0,
          }
        : view.pipeline,
    [replay, view.pipeline],
  );
  const decisions = useMemo(
    () => (replay ? (replay.decisions ?? {}) : view.decisions),
    [replay, view.decisions],
  );
  const answer = replay ? (replay.response ?? replay.answer ?? "") : view.answer;
  const agentId = replay ? (replay.agentId ?? null) : view.agentId;
  const errorText = replay ? null : view.errorText;
  const submittedQuery = replay
    ? replay.prompt
    : runId
      ? (tracked?.title ?? pendingQuery)
      : pendingQuery;

  useEffect(() => {
    try {
      const stored = localStorage.getItem(HISTORY_KEY);
      if (stored) setHistory(JSON.parse(stored) as OrchestratorRunEntry[]);
    } catch {
      // A corrupt store is not worth failing the page over.
    }
  }, []);

  // Coming back to the orchestrator lands on the run still in flight (or one
  // that finished while the user was away), rather than on an empty screen.
  const attachedRef = useRef(false);
  useEffect(() => {
    if (attachedRef.current) return;
    attachedRef.current = true;
    if (runId) return;
    const candidate = Object.values(useRunsStore.getState().runs)
      .filter((r) => r.kind === "agent" && (r.status === "running" || !r.seen))
      .sort((a, b) => (b.created_at ?? "").localeCompare(a.created_at ?? ""))[0];
    if (candidate) void navigate({ search: { run: candidate.id }, replace: true });
  }, [navigate, runId]);

  // Follow-up messages continue the conversation of the run on screen.
  useEffect(() => {
    if (view.conversationId) setConversationId(view.conversationId);
  }, [view.conversationId]);

  const persistHistory = useCallback((next: OrchestratorRunEntry[]) => {
    try {
      localStorage.setItem(HISTORY_KEY, JSON.stringify(next));
    } catch {
      // Quota exceeded or storage disabled — the in-memory list still works.
    }
  }, []);

  const clearHistory = useCallback(() => {
    setHistory([]);
    try {
      localStorage.removeItem(HISTORY_KEY);
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [run.runtime, run.activeNote, answer, errorText]);

  // Record a finished run once, keyed by its run id.
  useEffect(() => {
    if (!runId || !view.end || replay) return;
    if (!view.pipeline.started && !view.errorText) return;
    setHistory((prev) => {
      if (prev.some((h) => h.runId === runId)) return prev;
      const entry: OrchestratorRunEntry = {
        id: crypto.randomUUID(),
        runId,
        timestamp: Date.now(),
        prompt: tracked?.title ?? "",
        manifest: view.pipeline.manifest,
        runtime: view.pipeline.runtime,
        decisions: view.decisions,
        title: view.decisions.agent_config?.agent_name ?? null,
        response: view.answer,
        agentId: view.agentId,
        failed: Boolean(view.errorText),
      };
      const next = [entry, ...prev].slice(0, MAX_HISTORY);
      persistHistory(next);
      return next;
    });
  }, [runId, view, replay, tracked?.title, persistHistory]);

  const submit = useCallback(
    async (override?: string) => {
      const query = (override ?? input).trim();
      if (!query || isProcessing) return;

      setStarting(true);
      setPendingQuery(query);
      setReplay(null);
      if (override === undefined) setInput("");
      try {
        const started = await runsApi.startAgent({
          query,
          tier,
          ...(conversationId ? { conversation_id: conversationId } : {}),
        });
        trackStartedRun(started);
        void navigate({ search: { run: started.id } });
      } catch (err) {
        toast.error(`Could not start: ${errorMessage(err)}`);
        if (override === undefined) setInput(query);
        setPendingQuery(null);
      } finally {
        setStarting(false);
      }
    },
    [conversationId, input, isProcessing, navigate, tier],
  );

  const loadHistoryEntry = (entry: OrchestratorRunEntry) => {
    setHistoryOpen(false);
    setPendingQuery(null);
    if (entry.runId && useRunsStore.getState().runs[entry.runId]) {
      // Still tracked: reopen the run itself, which replays from the server.
      setReplay(null);
      void navigate({ search: { run: entry.runId } });
      return;
    }
    setReplay(entry);
    void navigate({ search: {} });
  };

  const resetChat = () => {
    setReplay(null);
    setPendingQuery(null);
    setConversationId(null);
    void navigate({ search: {} });
  };

  const activeHistoryId =
    replay?.id ?? (runId ? (history.find((h) => h.runId === runId)?.id ?? null) : null);

  const cards = useMemo(() => agentLayerCards(decisions), [decisions]);
  const raw = useMemo(() => agentLayerRaw(decisions), [decisions]);

  const empty = !submittedQuery && !run.started && !answer;

  return (
    <div className="relative mx-auto flex min-h-[calc(100dvh-3.5rem)] w-full max-w-4xl md:min-h-dvh flex-col px-5 pb-8">
      {/* ── History toggle ── */}
      <div className="flex items-center justify-end gap-2 py-3">
        {!empty && (
          <button
            type="button"
            onClick={resetChat}
            className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-muted-foreground transition hover:bg-surface-hover hover:text-foreground"
          >
            <RotateCcw className="size-3" />
            New
          </button>
        )}
        <button
          type="button"
          onClick={() => setHistoryOpen(true)}
          className="inline-flex items-center gap-1.5 rounded-lg border border-border/60 px-3 py-1.5 text-xs font-medium text-muted-foreground transition hover:border-border hover:bg-surface-hover hover:text-foreground"
        >
          <History className="size-3.5" />
          History{history.length > 0 ? ` (${history.length})` : ""}
        </button>
      </div>

      {/* ── Empty / Hero State ── */}
      {empty ? (
        <div className="flex flex-1 flex-col items-center justify-center py-8">
          <h1 className="text-center text-3xl font-semibold tracking-tight text-foreground sm:text-4xl lg:text-5xl">
            Describe your goal.
            <br />
            <span className="text-gradient-brand">We design the agent.</span>
          </h1>

          <div className="mt-10 grid w-full max-w-2xl gap-3 sm:grid-cols-3">
            {SUGGESTIONS.map((s) => {
              const Icon = s.icon;
              return (
                <button
                  key={s.text}
                  type="button"
                  onClick={() => setInput(s.text)}
                  className="group relative flex flex-col gap-3 rounded-2xl border border-border/60 p-4 text-left transition-all duration-200 hover:border-primary/40 hover:bg-surface-hover hover:shadow-[0_0_24px_-6px_var(--primary)]"
                >
                  <span className="inline-flex size-9 items-center justify-center rounded-xl border border-border/60 bg-background-elevated text-muted-foreground transition group-hover:border-primary/30 group-hover:text-primary">
                    <Icon className="size-4" />
                  </span>
                  <span className="text-[11px] font-semibold tracking-wider text-muted-foreground uppercase transition group-hover:text-primary">
                    {s.label}
                  </span>
                  <span className="text-xs leading-relaxed text-muted-foreground/80 transition group-hover:text-foreground/70">
                    {s.text}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      ) : (
        /* ── Active Session ── */
        <div className="flex-1 space-y-5 py-4">
          {submittedQuery ? (
            <div className="flex justify-end">
              <div className="max-w-[80%] rounded-2xl rounded-tr-md border border-primary/20 bg-primary/8 px-4 py-3 text-sm leading-relaxed text-foreground">
                {submittedQuery}
              </div>
            </div>
          ) : null}

          {/* Pipeline — the chain of decisions, each with its evidence */}
          {run.started || isProcessing ? (
            <div className="rounded-2xl border border-border/50 bg-surface/40 p-5 backdrop-blur-sm">
              <div className="mb-4 flex items-center gap-2">
                <Zap className="size-3.5 text-primary" />
                <span className="text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
                  Orchestration Pipeline
                </span>
                {isProcessing ? (
                  <span className="ml-auto inline-flex items-center gap-1.5 rounded-full border border-primary/25 bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">
                    <span className="size-1.5 animate-pulse rounded-full bg-primary" />
                    Processing
                    {running && elapsed != null ? (
                      <span className="font-mono tabular-nums opacity-80">
                        {formatElapsed(elapsed)}
                      </span>
                    ) : null}
                  </span>
                ) : null}
              </div>
              {running ? (
                <p className="mb-4 flex items-start gap-2 rounded-lg border border-border/50 bg-background-elevated/40 px-3 py-2 text-[11px] leading-relaxed text-muted-foreground">
                  <Layers className="mt-0.5 size-3 shrink-0 text-primary" />
                  This runs in the background. You can leave this page — the agent keeps being
                  built, and this timeline picks up where it is when you come back.
                </p>
              ) : null}
              {run.started ? (
                <PipelineTimeline
                  manifest={run.manifest}
                  runtime={run.runtime}
                  activeNote={run.activeNote}
                  cards={cards}
                  raw={raw}
                />
              ) : (
                <div className="shimmer h-16 rounded-xl border border-border/50" />
              )}
            </div>
          ) : null}

          {missing ? (
            <p className="rounded-2xl border border-border/50 bg-surface/30 p-4 text-xs text-muted-foreground">
              This run is no longer available — it may have been cleared from the server’s run log.
            </p>
          ) : null}

          {view.end?.status === "cancelled" && !replay ? (
            <p className="text-xs text-muted-foreground">
              Stopped before it finished. Anything already created is kept.
            </p>
          ) : null}

          {errorText ? (
            <div className="flex flex-col items-start gap-3 rounded-2xl border border-red/25 bg-red/5 p-4">
              <div className="flex items-start gap-2">
                <AlertTriangle className="mt-0.5 size-4 shrink-0 text-red" />
                <p className="font-mono text-xs break-words text-red">{errorText}</p>
              </div>
              {submittedQuery ? (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void submit(submittedQuery ?? undefined)}
                  disabled={isProcessing}
                >
                  <RefreshCw className="size-3.5" /> Retry generation
                </Button>
              ) : null}
            </div>
          ) : null}

          {answer ? (
            <div className="rounded-2xl border border-border/50 bg-surface/30 p-6 backdrop-blur-sm">
              <div className="mb-3 flex items-center gap-2">
                <Sparkles className="size-3.5 text-amber" />
                <span className="text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
                  Result
                </span>
              </div>
              <div className="prose-sm">
                <Markdown content={answer} />
              </div>
            </div>
          ) : isProcessing && run.started ? (
            <div className="shimmer h-20 rounded-2xl border border-border/50 bg-surface/30" />
          ) : null}

          {agentId && !isProcessing ? (
            <div className="flex items-center gap-3 rounded-2xl border border-emerald/20 bg-emerald/5 p-4">
              <div className="grid size-10 shrink-0 place-items-center rounded-xl bg-emerald/15 text-emerald">
                <Bot className="size-5" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-foreground">
                  {decisions.agent_config?.agent_name || "Agent"} is ready
                </p>
                <p className="text-xs text-muted-foreground">
                  Your agent was created and is ready to use.
                </p>
              </div>
              <Link
                to="/agents/$id"
                params={{ id: agentId }}
                className="inline-flex items-center gap-2 rounded-xl bg-gradient-brand px-4 py-2.5 text-sm font-medium text-primary-foreground transition hover:opacity-90"
              >
                Open Agent
                <ArrowRight className="size-4" />
              </Link>
            </div>
          ) : null}

          <div ref={bottomRef} />
        </div>
      )}

      {/* ── Composer ── */}
      <div className="sticky bottom-4 z-20 mt-4">
        <div className="mx-auto max-w-3xl">
          <Composer
            value={input}
            onChange={setInput}
            onSubmit={() => void submit()}
            onStop={() => {
              if (runId) void stopRun(runId);
            }}
            isProcessing={isProcessing}
            leading={<TierSelector value={tier} onChange={setTier} disabled={isProcessing} />}
          />
        </div>
      </div>

      {/* ── History Dialog ── */}
      <Dialog open={historyOpen} onOpenChange={setHistoryOpen}>
        <DialogContent className="flex max-h-[80vh] flex-col overflow-hidden sm:max-w-lg">
          <DialogHeader className="flex flex-row items-center justify-between pr-6">
            <DialogTitle className="flex items-center gap-2 text-base">
              <History className="size-4 text-primary" />
              Run History
            </DialogTitle>
            {history.length > 0 && (
              <Button
                variant="ghost"
                size="sm"
                onClick={clearHistory}
                className="h-7 text-xs text-muted-foreground hover:text-red"
              >
                <Trash2 className="mr-1 size-3" />
                Clear All
              </Button>
            )}
          </DialogHeader>

          <div className="custom-scrollbar flex-1 space-y-1.5 overflow-y-auto py-2">
            {history.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <div className="grid size-12 place-items-center rounded-2xl border border-border/60 bg-surface/40">
                  <Clock className="size-5 text-muted-foreground" />
                </div>
                <p className="mt-3 text-sm font-medium text-muted-foreground">No runs yet</p>
                <p className="mt-1 text-xs text-muted-foreground/70">
                  Agents you generate are kept here with the decisions that produced them.
                </p>
              </div>
            ) : (
              history.map((entry) => {
                const layerCount = entry.manifest?.filter((l) => !l.hidden).length ?? 0;
                return (
                  <button
                    key={entry.id}
                    type="button"
                    onClick={() => loadHistoryEntry(entry)}
                    className={cn(
                      "w-full rounded-xl border p-3.5 text-left transition-all duration-150 hover:border-border hover:bg-surface-hover",
                      entry.id === activeHistoryId
                        ? "border-primary/30 bg-primary/5"
                        : "border-transparent",
                    )}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="truncate text-xs font-semibold text-foreground">
                            {entry.title || "Orchestration Run"}
                          </span>
                          {entry.failed ? (
                            <span className="shrink-0 rounded-md border border-red/25 bg-red/10 px-1.5 py-0.5 text-[9px] font-semibold tracking-wider text-red uppercase">
                              Failed
                            </span>
                          ) : entry.agentId ? (
                            <span className="shrink-0 rounded-md border border-emerald/25 bg-emerald/10 px-1.5 py-0.5 text-[9px] font-semibold tracking-wider text-emerald uppercase">
                              Agent
                            </span>
                          ) : null}
                        </div>
                        <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-muted-foreground">
                          {entry.prompt}
                        </p>
                      </div>
                      <span className="shrink-0 text-[10px] text-muted-foreground/70 tabular-nums">
                        {formatRelative(new Date(entry.timestamp).toISOString())}
                      </span>
                    </div>
                    {layerCount > 0 ? (
                      <div className="mt-2 flex items-center gap-1 text-[10px] text-muted-foreground/60">
                        <Zap className="size-2.5" />
                        {layerCount} decisions
                      </div>
                    ) : null}
                  </button>
                );
              })
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
