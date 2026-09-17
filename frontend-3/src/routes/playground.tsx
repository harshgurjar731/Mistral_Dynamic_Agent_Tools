import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { Bot, MessageSquare, Settings2, Sparkles, X } from "lucide-react";
import { z } from "zod";
import { toast } from "sonner";
import { createSSEStream, parseEventData } from "@/api/sse";
import { Composer } from "@/components/chat/Composer";
import { MessageList } from "@/components/chat/MessageList";
import { AttachmentControl } from "@/components/chat/AttachmentChip";
import { ChatSessionSidebar } from "@/components/chat/ChatSessionSidebar";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CHAT_MODELS } from "@/lib/models";
import { cn } from "@/lib/utils";
import { useSessionStore } from "@/stores/sessions";
import type { ChatMessagePayload } from "@/api";
import type { Message, UploadResult } from "@/types";

const searchSchema = z.object({
  session: z.string().optional(),
});

export const Route = createFileRoute("/playground")({
  validateSearch: searchSchema,
  head: () => ({
    meta: [
      { title: "Playground — Agentic AI Design Patterns" },
      {
        name: "description",
        content: "Raw chat-completions playground, bypassing the orchestrator.",
      },
      { property: "og:title", content: "Playground — Agentic AI Design Patterns" },
      {
        property: "og:description",
        content: "Raw chat-completions playground, bypassing the orchestrator.",
      },
    ],
  }),
  component: PlaygroundPage,
});

const newMessageId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

function PlaygroundPage() {
  const { session: sessionId } = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });

  const sessions = useSessionStore((s) => s.sessions);
  const createSession = useSessionStore((s) => s.createSession);
  const removeSession = useSessionStore((s) => s.removeSession);
  const appendMessage = useSessionStore((s) => s.appendMessage);
  const updateMessage = useSessionStore((s) => s.updateMessage);

  const generalSessions = useMemo(
    () => sessions.filter((s) => s.type === "general").sort((a, b) => b.updatedAt - a.updatedAt),
    [sessions],
  );

  const activeSession = useMemo(
    () => generalSessions.find((s) => s.id === sessionId) ?? null,
    [generalSessions, sessionId],
  );

  const [input, setInput] = useState("");
  const [model, setModel] = useState("mistral-large-latest");
  const [temperature, setTemperature] = useState(0.7);
  const [topP, setTopP] = useState(1.0);
  const [safePrompt, setSafePrompt] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [sessionsOpen, setSessionsOpen] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [attachment, setAttachment] = useState<UploadResult | null>(null);
  const [uploading, setUploading] = useState(false);

  const stopRef = useRef<(() => void) | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [activeSession?.messages.length]);

  useEffect(() => () => stopRef.current?.(), []);

  const handleCreate = () => {
    const id = createSession("general");
    void navigate({ search: { session: id } });
  };

  const handleSelect = (id: string) => {
    void navigate({ search: { session: id } });
    setSessionsOpen(false);
  };

  const handleDelete = (id: string) => {
    removeSession(id);
    if (id === sessionId) {
      const next = generalSessions.find((s) => s.id !== id);
      void navigate({ search: { session: next?.id } });
    }
  };

  const submit = () => {
    const text = input.trim();
    if ((!text && !attachment) || isProcessing) return;

    let id = sessionId;
    if (!id || !activeSession) {
      id = createSession("general");
      void navigate({ search: { session: id } });
    }
    const sid = id as string;

    const userMessage: Message = {
      id: newMessageId(),
      role: "user",
      content: text,
      timestamp: new Date().toISOString(),
      imageUrl: attachment?.image_url,
      imageBase64: attachment?.image_base64,
      imageMime: attachment?.image_mime,
    };
    appendMessage(sid, userMessage);

    const assistantId = newMessageId();
    appendMessage(sid, { id: assistantId, role: "assistant", content: "", streaming: true });

    const history = [...(activeSession?.messages ?? []), userMessage];
    const messages: ChatMessagePayload[] = history.map((m) => ({
      role: m.role,
      content:
        m.imageBase64 && m.imageMime
          ? [
              { type: "text", text: m.content },
              {
                type: "image_url",
                image_url: { url: `data:${m.imageMime};base64,${m.imageBase64}` },
              },
            ]
          : m.content,
    }));

    setInput("");
    setAttachment(null);
    setIsProcessing(true);

    let accumulated = "";
    stopRef.current = createSSEStream("/api/chat/stream", {
      method: "POST",
      body: { model, messages, stream: true, safe_prompt: safePrompt, temperature, top_p: topP },
      onEvent: (event) => {
        switch (event.type) {
          case "text_chunk":
            accumulated += String(parseEventData<string>(event));
            updateMessage(sid, assistantId, { content: accumulated });
            break;
          case "done":
            setIsProcessing(false);
            break;
          case "error":
            toast.error(String(parseEventData<string>(event)));
            setIsProcessing(false);
            break;
          default:
            break;
        }
      },
      onDone: () => {
        updateMessage(sid, assistantId, { streaming: false });
        setIsProcessing(false);
      },
      onError: (err) => {
        toast.error(err instanceof Error ? err.message : "Stream failed");
        updateMessage(sid, assistantId, { streaming: false });
        setIsProcessing(false);
      },
    });
  };

  const hasMessages = activeSession && activeSession.messages.length > 0;
  const activeModel = CHAT_MODELS.find((m) => m.value === model);

  return (
    <div className="flex h-[calc(100vh-3.5rem)] min-h-0 flex-col">
      {/* ── Top Bar ── */}
      <header className="relative z-30 flex items-center gap-3 border-b border-border px-5 py-3">
        {/* Left: Sessions dropdown trigger */}
        <div className="relative">
          <button
            type="button"
            onClick={() => setSessionsOpen((o) => !o)}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition",
              sessionsOpen
                ? "border-primary/30 bg-primary/10 text-primary"
                : "border-border/60 text-muted-foreground hover:border-border hover:bg-surface-hover hover:text-foreground",
            )}
          >
            <MessageSquare className="size-3.5" />
            Sessions
            {generalSessions.length > 0 && (
              <span className="rounded bg-surface-elevated px-1 py-0.5 text-[10px] tabular-nums leading-none">
                {generalSessions.length}
              </span>
            )}
          </button>

          {/* Sessions dropdown */}
          <ChatSessionSidebar
            sessions={generalSessions}
            activeId={sessionId ?? null}
            onSelect={handleSelect}
            onCreate={handleCreate}
            onDelete={handleDelete}
            open={sessionsOpen}
            onClose={() => setSessionsOpen(false)}
          />
        </div>

        <div className="h-5 w-px bg-border/60" />

        {/* Title */}
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-sm font-semibold tracking-tight text-foreground">
            {activeSession?.title || "Playground"}
          </h1>
        </div>

        {/* Right: Model badge + Settings */}
        <div className="flex items-center gap-2">
          <span className="hidden items-center gap-1.5 rounded-lg border border-blue/20 bg-blue/8 px-2 py-1 text-[10px] font-medium text-blue sm:inline-flex">
            <Sparkles className="size-3" />
            {activeModel?.label ?? model}
          </span>
          <button
            type="button"
            onClick={() => setSettingsOpen((o) => !o)}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition",
              settingsOpen
                ? "border-primary/30 bg-primary/10 text-primary"
                : "border-border/60 text-muted-foreground hover:border-border hover:bg-surface-hover hover:text-foreground",
            )}
          >
            <Settings2 className="size-3.5" />
            <span className="hidden sm:inline">Settings</span>
          </button>
        </div>
      </header>

      {/* ── Content Row ── */}
      <div className="flex min-h-0 flex-1">
        {/* ── Chat Area ── */}
        <div className="flex min-w-0 flex-1 flex-col">
          {/* Messages */}
          <div className="custom-scrollbar flex-1 overflow-y-auto">
            {!hasMessages ? (
              <div className="flex h-full flex-col items-center justify-center px-6 pb-16">
                <div className="relative mb-6">
                  <div
                    className="absolute -inset-8 rounded-full opacity-15 blur-2xl"
                    style={{ background: "var(--gradient-brand)" }}
                  />
                  <div className="relative grid size-14 place-items-center rounded-2xl border border-border/60 glass">
                    <Bot className="size-6 text-primary" />
                  </div>
                </div>
                <h2 className="text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
                  Start a <span className="text-gradient-brand">conversation.</span>
                </h2>
                <p className="mt-2 max-w-sm text-center text-sm leading-relaxed text-muted-foreground">
                  Send a message below to begin. Use Settings to adjust model and parameters.
                </p>
                <div className="mt-6 flex flex-wrap justify-center gap-2">
                  {[
                    "Explain quantum computing",
                    "Write a Python sort function",
                    "Translate to French",
                  ].map((hint) => (
                    <button
                      key={hint}
                      type="button"
                      onClick={() => setInput(hint)}
                      className="rounded-xl border border-border/60 px-3 py-1.5 text-xs text-muted-foreground transition hover:border-primary/30 hover:bg-surface-hover hover:text-foreground"
                    >
                      {hint}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div className="mx-auto w-full max-w-3xl px-6 py-6">
                <MessageList messages={activeSession!.messages} />
                <div ref={bottomRef} />
              </div>
            )}
          </div>

          {/* Composer */}
          <div className="border-t border-border bg-background/80 px-4 py-3 backdrop-blur-md sm:px-6">
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
                placeholder="Send a message…"
                leading={
                  <AttachmentControl
                    attachment={attachment}
                    onAttach={setAttachment}
                    onClear={() => setAttachment(null)}
                    uploading={uploading}
                    setUploading={setUploading}
                    disabled={isProcessing}
                  />
                }
              />
            </div>
          </div>
        </div>

        {/* ── Settings Panel ── */}
        <aside
          className={cn(
            "hidden shrink-0 border-l border-border transition-all duration-300 ease-out lg:block",
            settingsOpen ? "w-72 opacity-100" : "w-0 overflow-hidden opacity-0",
          )}
        >
          <div className="flex h-full w-72 flex-col p-4">
            <div className="glass-elevated flex-1 rounded-2xl p-4">
              {/* Header */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="grid size-6 place-items-center rounded-md bg-primary/10 text-primary">
                    <Settings2 className="size-3" />
                  </div>
                  <h2 className="text-sm font-semibold text-foreground">Settings</h2>
                </div>
                <button
                  type="button"
                  onClick={() => setSettingsOpen(false)}
                  aria-label="Close settings"
                  className="rounded-md p-1 text-muted-foreground transition hover:bg-surface-hover hover:text-foreground"
                >
                  <X className="size-3.5" />
                </button>
              </div>

              <div className="mt-5 space-y-5">
                {/* Model */}
                <div>
                  <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Model
                  </label>
                  <Select value={model} onValueChange={setModel}>
                    <SelectTrigger className="mt-1.5 bg-background-elevated text-foreground">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {CHAT_MODELS.map((m) => (
                        <SelectItem key={m.value} value={m.value}>
                          {m.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="h-px bg-border/60" />

                {/* Temperature */}
                <div>
                  <div className="flex items-center justify-between">
                    <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                      Temperature
                    </label>
                    <span className="rounded-md bg-surface-elevated px-1.5 py-0.5 font-mono text-[10px] text-foreground">
                      {temperature}
                    </span>
                  </div>
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.05"
                    value={temperature}
                    onChange={(e) => setTemperature(parseFloat(e.target.value))}
                    className="mt-2 w-full accent-primary"
                  />
                  <div className="mt-1 flex justify-between text-[9px] text-muted-foreground/50">
                    <span>Precise</span>
                    <span>Creative</span>
                  </div>
                </div>

                {/* Top P */}
                <div>
                  <div className="flex items-center justify-between">
                    <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                      Top P
                    </label>
                    <span className="rounded-md bg-surface-elevated px-1.5 py-0.5 font-mono text-[10px] text-foreground">
                      {topP}
                    </span>
                  </div>
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.05"
                    value={topP}
                    onChange={(e) => setTopP(parseFloat(e.target.value))}
                    className="mt-2 w-full accent-primary"
                  />
                  <div className="mt-1 flex justify-between text-[9px] text-muted-foreground/50">
                    <span>Focused</span>
                    <span>Diverse</span>
                  </div>
                </div>

                <div className="h-px bg-border/60" />

                {/* Safe Prompt */}
                <div className="flex items-center justify-between rounded-xl border border-border bg-background-elevated px-3 py-2.5">
                  <div>
                    <p className="text-xs font-medium text-foreground">Safe Prompt</p>
                    <p className="mt-0.5 text-[10px] text-muted-foreground/60">
                      Prepend safety instructions
                    </p>
                  </div>
                  <Switch checked={safePrompt} onCheckedChange={setSafePrompt} />
                </div>
              </div>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
