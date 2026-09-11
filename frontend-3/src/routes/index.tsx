import { createFileRoute, Link } from "@tanstack/react-router";
import {
  ArrowRight,
  Bot,
  Clock,
  FileText,
  History,
  RotateCcw,
  Search,
  Sparkles,
  Trash2,
  Users,
  X,
  Zap,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { createSSEStream, parseEventData } from "@/api/sse";
import { Composer } from "@/components/chat/Composer";
import { Markdown } from "@/components/chat/Markdown";
import { TierSelector } from "@/components/chat/TierSelector";
import {
  Timeline,
  type GuardrailData,
  type LibraryProvisionedData,
  type RequirementsData,
  type TimelineStep,
  type ToolBuiltData,
  type ValidationData,
} from "@/components/orchestrator/Timeline";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { formatRelative } from "@/lib/status";
import type { AgentConfigEvent, OrchestrateDoneEvent } from "@/types";

export const Route = createFileRoute("/")(  {
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

interface OrchestratorRunEntry {
  id: string;
  timestamp: number;
  prompt: string;
  steps: TimelineStep[];
  answer: string;
  agentId?: string | null;
  agentName?: string | null;
}

const HISTORY_KEY = "agent_orchestrator_history";

function OrchestratorChat() {
  const [input, setInput] = useState("");
  const [tier, setTier] = useState("domain");
  const [steps, setSteps] = useState<TimelineStep[]>([]);
  const [answer, setAnswer] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);
  const [agentId, setAgentId] = useState<string | null>(null);
  const [agentName, setAgentName] = useState<string | null>(null);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [submittedQuery, setSubmittedQuery] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [history, setHistory] = useState<OrchestratorRunEntry[]>([]);

  const stopRef = useRef<(() => void) | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  // Load history from localStorage
  useEffect(() => {
    try {
      const stored = localStorage.getItem(HISTORY_KEY);
      if (stored) setHistory(JSON.parse(stored));
    } catch {
      // ignore
    }
  }, []);

  const saveToHistory = useCallback((entry: OrchestratorRunEntry) => {
    setHistory((prev) => {
      const updated = [entry, ...prev.filter((h) => h.id !== entry.id)].slice(0, 30);
      try {
        localStorage.setItem(HISTORY_KEY, JSON.stringify(updated));
      } catch {
        // ignore
      }
      return updated;
    });
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
  }, [steps, answer]);

  useEffect(() => () => stopRef.current?.(), []);

  const pushStep = useCallback((label: string, state: TimelineStep["state"] = "active") => {
    setSteps((prev) => [
      ...prev.map((s) => (s.state === "active" ? { ...s, state: "completed" as const } : s)),
      { id: `${prev.length}-${label.slice(0, 24)}`, label, state },
    ]);
  }, []);

  const submit = useCallback(() => {
    const query = input.trim();
    if (!query || isProcessing) return;

    setSubmittedQuery(query);
    setInput("");
    setSteps([]);
    setAnswer("");
    setAgentId(null);
    setAgentName(null);
    setIsProcessing(true);

    let accumulatedAnswer = "";
    let finalAgentId: string | null = null;
    let finalAgentName: string | null = null;

    stopRef.current = createSSEStream("/api/orchestrate/stream", {
      method: "POST",
      body: { query, tier, ...(conversationId ? { conversation_id: conversationId } : {}) },
      onEvent: (event) => {
        switch (event.type) {
          case "status":
            pushStep(String(parseEventData<string>(event)));
            break;
          case "requirements": {
            const raw = parseEventData<RequirementsData>(event);
            const reqData = typeof raw === "string" ? (JSON.parse(raw) as RequirementsData) : raw;
            setSteps((prev) => [
              ...prev.map((s) => (s.state === "active" ? { ...s, state: "completed" as const } : s)),
              {
                id: `req-${prev.length}`,
                label: "Requirements identified",
                state: "completed",
                requirements: reqData,
              },
            ]);
            break;
          }
          case "tool_built": {
            const raw = parseEventData<ToolBuiltData>(event);
            const toolData = typeof raw === "string" ? (JSON.parse(raw) as ToolBuiltData) : raw;
            setSteps((prev) => [
              ...prev.map((s) => (s.state === "active" ? { ...s, state: "completed" as const } : s)),
              {
                id: `tool-${prev.length}`,
                label: `Tool synthesized: ${toolData.tool_name}`,
                state: "completed",
                toolBuilt: toolData,
              },
            ]);
            break;
          }
          case "agent_config": {
            const config = parseEventData<AgentConfigEvent>(event);
            if (typeof config === "string") break;
            setSteps((prev) => [
              ...prev.map((s) => (s.state === "active" ? { ...s, state: "completed" as const } : s)),
              {
                id: `config-${prev.length}`,
                label: "Agent designed",
                state: "completed",
                config,
              },
            ]);
            break;
          }
          case "guardrail": {
            const raw = parseEventData<GuardrailData>(event);
            const guardData = typeof raw === "string" ? (JSON.parse(raw) as GuardrailData) : raw;
            setSteps((prev) => [
              ...prev.map((s) => (s.state === "active" ? { ...s, state: "completed" as const } : s)),
              {
                id: `guard-${prev.length}`,
                label: "Safety guardrail configured",
                state: "completed",
                guardrail: guardData,
              },
            ]);
            break;
          }
          case "library_provisioned": {
            const raw = parseEventData<LibraryProvisionedData>(event);
            const libData =
              typeof raw === "string" ? (JSON.parse(raw) as LibraryProvisionedData) : raw;
            setSteps((prev) => [
              ...prev.map((s) => (s.state === "active" ? { ...s, state: "completed" as const } : s)),
              {
                id: `lib-${prev.length}`,
                label: `Library provisioned: ${libData.name || libData.id}`,
                state: "completed",
                libraryProvisioned: libData,
              },
            ]);
            break;
          }
          case "validation": {
            const raw = parseEventData<ValidationData>(event);
            const valData = typeof raw === "string" ? (JSON.parse(raw) as ValidationData) : raw;
            setSteps((prev) => [
              ...prev.map((s) => (s.state === "active" ? { ...s, state: "completed" as const } : s)),
              {
                id: `val-${prev.length}`,
                label: valData.valid ? "Validation passed" : "Validation warnings",
                state: "completed",
                validation: valData,
              },
            ]);
            break;
          }
          case "text_chunk": {
            const chunk = String(parseEventData<string>(event));
            accumulatedAnswer += chunk;
            setAnswer((prev) => prev + chunk);
            break;
          }
          case "conversation_id":
            setConversationId(String(parseEventData<string>(event)));
            break;
          case "error": {
            pushStep(String(parseEventData<string>(event)), "error");
            setIsProcessing(false);
            stopRef.current?.();
            break;
          }
          case "done": {
            const done = parseEventData<OrchestrateDoneEvent>(event);
            if (typeof done !== "string") {
              finalAgentId = done.agent_id ?? null;
              finalAgentName = done.agent_name ?? null;
              setAgentId(finalAgentId);
              setAgentName(finalAgentName);
            }
            setSteps((prev) => {
              const finishedSteps = prev.map((s) =>
                s.state === "active" ? { ...s, state: "completed" as const } : s,
              );
              // Save to history
              saveToHistory({
                id: crypto.randomUUID(),
                timestamp: Date.now(),
                prompt: query,
                steps: finishedSteps,
                answer: accumulatedAnswer,
                agentId: finalAgentId,
                agentName: finalAgentName,
              });
              return finishedSteps;
            });
            setIsProcessing(false);
            break;
          }
          default:
            break;
        }
      },
      onDone: () => setIsProcessing(false),
      onError: (err) => {
        pushStep(err instanceof Error ? err.message : "Stream failed", "error");
        setIsProcessing(false);
      },
    });
  }, [conversationId, input, isProcessing, pushStep, saveToHistory, tier]);

  const loadHistoryEntry = (entry: OrchestratorRunEntry) => {
    setSubmittedQuery(entry.prompt);
    setSteps(entry.steps);
    setAnswer(entry.answer);
    setAgentId(entry.agentId ?? null);
    setAgentName(entry.agentName ?? null);
    setHistoryOpen(false);
  };

  const resetChat = () => {
    setSubmittedQuery(null);
    setSteps([]);
    setAnswer("");
    setAgentId(null);
    setAgentName(null);
    setConversationId(null);
    setIsProcessing(false);
    stopRef.current?.();
  };

  const empty = !submittedQuery && steps.length === 0 && !answer;

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
          {/* Animated accent */}
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

          {/* Suggestion Cards */}
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
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground transition group-hover:text-primary">
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
          {/* User query bubble */}
          {submittedQuery ? (
            <div className="flex justify-end">
              <div className="max-w-[80%] rounded-2xl rounded-tr-md border border-primary/20 bg-primary/8 px-4 py-3 text-sm leading-relaxed text-foreground">
                {submittedQuery}
              </div>
            </div>
          ) : null}

          {/* Timeline */}
          {steps.length > 0 && (
            <div className="rounded-2xl border border-border/50 bg-surface/40 p-5 backdrop-blur-sm">
              <div className="mb-3 flex items-center gap-2">
                <Zap className="size-3.5 text-primary" />
                <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Orchestration Pipeline
                </span>
                {isProcessing && (
                  <span className="ml-auto inline-flex items-center gap-1 rounded-full border border-primary/25 bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">
                    <span className="size-1.5 animate-pulse rounded-full bg-primary" />
                    Processing
                  </span>
                )}
              </div>
              <Timeline steps={steps} />
            </div>
          )}

          {/* Answer */}
          {answer ? (
            <div className="rounded-2xl border border-border/50 bg-surface/30 p-6 backdrop-blur-sm">
              <div className="mb-3 flex items-center gap-2">
                <Sparkles className="size-3.5 text-amber" />
                <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Result
                </span>
              </div>
              <div className="prose-sm">
                <Markdown content={answer} />
              </div>
            </div>
          ) : isProcessing ? (
            <div className="shimmer h-20 rounded-2xl border border-border/50 bg-surface/30" />
          ) : null}

          {/* Agent CTA */}
          {agentId ? (
            <div className="flex items-center gap-3 rounded-2xl border border-emerald/20 bg-emerald/5 p-4">
              <div className="grid size-10 shrink-0 place-items-center rounded-xl bg-emerald/15 text-emerald">
                <Bot className="size-5" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-foreground">
                  {agentName || "Agent"} is ready
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
            onSubmit={submit}
            onStop={() => {
              stopRef.current?.();
              setIsProcessing(false);
            }}
            isProcessing={isProcessing}
            leading={<TierSelector value={tier} onChange={setTier} disabled={isProcessing} />}
          />
        </div>
      </div>

      {/* ── History Dialog ── */}
      <Dialog open={historyOpen} onOpenChange={setHistoryOpen}>
        <DialogContent className="sm:max-w-lg max-h-[80vh] overflow-hidden flex flex-col">
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
                className="text-xs text-muted-foreground hover:text-red h-7"
              >
                <Trash2 className="size-3 mr-1" />
                Clear All
              </Button>
            )}
          </DialogHeader>

          <div className="flex-1 overflow-y-auto custom-scrollbar space-y-1.5 py-2">
            {history.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <div className="grid size-12 place-items-center rounded-2xl border border-border/60 bg-surface/40">
                  <Clock className="size-5 text-muted-foreground" />
                </div>
                <p className="mt-3 text-sm font-medium text-muted-foreground">No runs yet</p>
                <p className="mt-1 text-xs text-muted-foreground/70">
                  Your orchestration history will appear here.
                </p>
              </div>
            ) : (
              history.map((entry) => (
                <button
                  key={entry.id}
                  type="button"
                  onClick={() => loadHistoryEntry(entry)}
                  className="w-full text-left rounded-xl border border-transparent p-3.5 transition-all duration-150 hover:border-border hover:bg-surface-hover"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-semibold text-foreground truncate">
                          {entry.agentName || "Orchestration Run"}
                        </span>
                        {entry.agentId && (
                          <span className="shrink-0 rounded-md border border-emerald/25 bg-emerald/10 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-emerald">
                            Agent
                          </span>
                        )}
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground line-clamp-2 leading-relaxed">
                        {entry.prompt}
                      </p>
                    </div>
                    <span className="shrink-0 text-[10px] text-muted-foreground/70 tabular-nums">
                      {formatRelative(new Date(entry.timestamp).toISOString())}
                    </span>
                  </div>
                  <div className="mt-2 flex items-center gap-3 text-[10px] text-muted-foreground/60">
                    <span className="flex items-center gap-1">
                      <Zap className="size-2.5" />
                      {entry.steps.length} steps
                    </span>
                  </div>
                </button>
              ))
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
