import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowRight, Sparkles } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { createSSEStream, parseEventData } from "@/api/sse";
import { Composer } from "@/components/chat/Composer";
import { Markdown } from "@/components/chat/Markdown";
import { TierSelector } from "@/components/chat/TierSelector";
import { Timeline, type TimelineStep } from "@/components/orchestrator/Timeline";
import type { AgentConfigEvent, OrchestrateDoneEvent } from "@/types";

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
  "Summarise last quarter's incident reports and flag recurring root causes",
  "Research three competitors and produce a positioning brief",
  "Draft an onboarding checklist for a new data engineer",
];

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

  const stopRef = useRef<(() => void) | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

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

    stopRef.current = createSSEStream("/api/orchestrate/stream", {
      method: "POST",
      body: { query, tier, ...(conversationId ? { conversation_id: conversationId } : {}) },
      onEvent: (event) => {
        switch (event.type) {
          case "status":
            pushStep(String(parseEventData<string>(event)));
            break;
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
          case "text_chunk":
            setAnswer((prev) => prev + String(parseEventData<string>(event)));
            break;
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
              setAgentId(done.agent_id ?? null);
              setAgentName(done.agent_name ?? null);
            }
            setSteps((prev) =>
              prev.map((s) => (s.state === "active" ? { ...s, state: "completed" as const } : s)),
            );
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
  }, [conversationId, input, isProcessing, pushStep, tier]);

  const empty = !submittedQuery && steps.length === 0 && !answer;

  return (
    <div className="mx-auto flex min-h-[calc(100vh-6rem)] w-full max-w-3xl flex-col px-5 pb-8">
      {empty ? (
        <div className="flex flex-1 flex-col justify-center py-14 text-center">
          <span className="mx-auto inline-flex items-center gap-2 rounded-full border border-primary/25 bg-primary/10 px-3 py-1 text-[11px] font-medium text-primary">
            <Sparkles className="size-3" />
            Agent orchestration
          </span>
          <h1 className="mt-5 text-4xl font-semibold tracking-tight text-foreground sm:text-5xl">
            Describe the goal.
            <br />
            <span className="text-gradient-brand">We design the agent.</span>
          </h1>
          <p className="mx-auto mt-4 max-w-xl text-sm text-muted-foreground">
            The orchestrator picks a model, equips tools and connectors, scopes domain knowledge and
            streams the answer — then hands you a reusable agent.
          </p>
          <div className="mt-8 flex flex-wrap justify-center gap-2">
            {SUGGESTIONS.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setInput(s)}
                className="rounded-xl border border-border glass px-3 py-2 text-left text-xs text-muted-foreground transition hover:bg-surface-hover hover:text-foreground"
              >
                {s}
              </button>
            ))}
          </div>
        </div>
      ) : (
        <div className="flex-1 space-y-6 py-8">
          {submittedQuery ? (
            <div className="ml-auto max-w-[85%] rounded-2xl border border-primary/25 bg-primary/10 px-4 py-3 text-sm text-foreground">
              {submittedQuery}
            </div>
          ) : null}

          <Timeline steps={steps} />

          {answer ? (
            <div className="rounded-2xl border border-border glass p-5">
              <Markdown content={answer} />
            </div>
          ) : isProcessing ? (
            <div className="shimmer h-16 rounded-2xl border border-border glass" />
          ) : null}

          {agentId ? (
            <Link
              to="/agents/$id"
              params={{ id: agentId }}
              className="inline-flex items-center gap-2 rounded-xl bg-gradient-brand px-4 py-2.5 text-sm font-medium text-primary-foreground transition hover:opacity-90"
            >
              {agentName ? `Open ${agentName}` : "Generate Agent"}
              <ArrowRight className="size-4" />
            </Link>
          ) : null}

          <div ref={bottomRef} />
        </div>
      )}

      <div className="sticky bottom-4 mt-4">
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
  );
}
