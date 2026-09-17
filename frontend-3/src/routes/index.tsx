import { createFileRoute, Link } from "@tanstack/react-router";
import {
  AlertTriangle,
  ArrowRight,
  Bot,
  Clock,
  FileText,
  History,
  RefreshCw,
  RotateCcw,
  Search,
  Sparkles,
  Trash2,
  Users,
  Zap,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createSSEStream, parseEventData } from "@/api/sse";
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
import { usePipelineRun } from "@/components/pipeline/usePipelineRun";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { formatRelative } from "@/lib/status";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/")({
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

function OrchestratorChat() {
  const [input, setInput] = useState("");
  const [tier, setTier] = useState("domain");
  const [answer, setAnswer] = useState("");
  const [decisions, setDecisions] = useState<AgentDecisions>({});
  const [errorText, setErrorText] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [agentId, setAgentId] = useState<string | null>(null);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [submittedQuery, setSubmittedQuery] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [history, setHistory] = useState<OrchestratorRunEntry[]>([]);
  const [activeHistoryId, setActiveHistoryId] = useState<string | null>(null);

  const { run, reset, restore, handleEvent, settle, failRunning } = usePipelineRun();

  const stopRef = useRef<(() => void) | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  /** Guards the save effect so a finished run is recorded exactly once. */
  const savedRef = useRef(true);

  useEffect(() => {
    try {
      const stored = localStorage.getItem(HISTORY_KEY);
      if (stored) setHistory(JSON.parse(stored) as OrchestratorRunEntry[]);
    } catch {
      // A corrupt store is not worth failing the page over.
    }
  }, []);

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
  }, [run, answer, errorText]);

  useEffect(() => () => stopRef.current?.(), []);

  // Record the run once it has fully settled. An effect rather than the stream
  // callback: that fires in the same tick as the last layer events and settle(),
  // so the state it can see is one render behind.
  useEffect(() => {
    if (isProcessing || savedRef.current || (!run.started && !errorText)) return;
    savedRef.current = true;
    const entry: OrchestratorRunEntry = {
      id: crypto.randomUUID(),
      timestamp: Date.now(),
      prompt: submittedQuery ?? "",
      manifest: run.manifest,
      runtime: run.runtime,
      decisions,
      title: decisions.agent_config?.agent_name ?? null,
      response: answer,
      agentId,
      failed: Boolean(errorText),
    };
    setActiveHistoryId(entry.id);
    setHistory((prev) => {
      const next = [entry, ...prev].slice(0, MAX_HISTORY);
      persistHistory(next);
      return next;
    });
  }, [isProcessing, run, decisions, submittedQuery, answer, agentId, errorText, persistHistory]);

  const submit = useCallback(
    (override?: string) => {
      const query = (override ?? input).trim();
      if (!query || isProcessing) return;

      stopRef.current?.();
      setSubmittedQuery(query);
      if (override === undefined) setInput("");
      setAnswer("");
      setDecisions({});
      setErrorText(null);
      setAgentId(null);
      setActiveHistoryId(null);
      setIsProcessing(true);
      savedRef.current = false;
      reset();

      const finish = () => {
        setIsProcessing(false);
        settle();
      };

      stopRef.current = createSSEStream("/api/orchestrate/stream", {
        method: "POST",
        body: { query, tier, ...(conversationId ? { conversation_id: conversationId } : {}) },
        onEvent: (event) => {
          // The manifest, layer lifecycle and status notes are handled centrally.
          if (handleEvent(event.type, event.data)) return;

          if (AGENT_DECISION_EVENTS.has(event.type as keyof AgentDecisions)) {
            const parsed = parseEventData<unknown>(event);
            if (typeof parsed === "string") return;
            setDecisions((prev) => ({ ...prev, [event.type]: parsed }));
            return;
          }

          switch (event.type) {
            case "text_chunk":
              setAnswer((prev) => prev + event.data);
              break;
            case "conversation_id":
              setConversationId(event.data);
              break;
            case "error":
              setErrorText(event.data);
              failRunning(event.data);
              break;
            case "done": {
              const done = parseEventData<{ agent_id?: string }>(event);
              if (typeof done !== "string" && done.agent_id) setAgentId(done.agent_id);
              break;
            }
            default:
              break;
          }
        },
        onDone: finish,
        onError: (err) => {
          const message = err instanceof Error ? err.message : "Stream failed";
          setErrorText(message);
          failRunning(message);
          setIsProcessing(false);
        },
      });
    },
    [conversationId, failRunning, handleEvent, input, isProcessing, reset, settle, tier],
  );

  const loadHistoryEntry = (entry: OrchestratorRunEntry) => {
    stopRef.current?.();
    setIsProcessing(false);
    savedRef.current = true;
    setSubmittedQuery(entry.prompt);
    setDecisions(entry.decisions ?? {});
    setAnswer(entry.response ?? entry.answer ?? "");
    setAgentId(entry.agentId ?? null);
    setErrorText(null);
    setActiveHistoryId(entry.id);
    restore(entry.manifest, entry.runtime);
    setHistoryOpen(false);
  };

  const resetChat = () => {
    stopRef.current?.();
    savedRef.current = true;
    setSubmittedQuery(null);
    setDecisions({});
    setAnswer("");
    setErrorText(null);
    setAgentId(null);
    setConversationId(null);
    setActiveHistoryId(null);
    setIsProcessing(false);
    reset();
  };

  const cards = useMemo(() => agentLayerCards(decisions), [decisions]);
  const raw = useMemo(() => agentLayerRaw(decisions), [decisions]);

  const empty = !submittedQuery && !run.started && !answer;

  return (
    <div className="relative mx-auto flex min-h-[calc(100vh-6rem)] w-full max-w-4xl flex-col px-5 pb-8">
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
        <div className="flex flex-1 flex-col items-center justify-center pb-24">
          <div className="relative mb-8">
            <div
              className="absolute -inset-12 rounded-full opacity-20 blur-3xl"
              style={{ background: "var(--gradient-brand)" }}
            />
            <div className="relative grid size-16 place-items-center rounded-2xl border border-border/60 glass">
              <Bot className="size-7 text-primary" />
            </div>
          </div>

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
                  <span className="ml-auto inline-flex items-center gap-1 rounded-full border border-primary/25 bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">
                    <span className="size-1.5 animate-pulse rounded-full bg-primary" />
                    Processing
                  </span>
                ) : null}
              </div>
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
                  onClick={() => submit(submittedQuery)}
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
            onSubmit={() => submit()}
            onStop={() => {
              stopRef.current?.();
              setIsProcessing(false);
              settle();
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
