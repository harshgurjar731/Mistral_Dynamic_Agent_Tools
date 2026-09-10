import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { Settings2, X } from "lucide-react";
import { z } from "zod";
import { toast } from "sonner";
import { createSSEStream, parseEventData } from "@/api/sse";
import { Composer } from "@/components/chat/Composer";
import { MessageList } from "@/components/chat/MessageList";
import { AttachmentControl } from "@/components/chat/AttachmentChip";
import { ChatSessionSidebar } from "@/components/chat/ChatSessionSidebar";
import { EmptyState } from "@/components/ui/EmptyState";
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
  const [safePrompt, setSafePrompt] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(true);
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
              { type: "image_url", image_url: { url: `data:${m.imageMime};base64,${m.imageBase64}` } },
            ]
          : m.content,
    }));

    setInput("");
    setAttachment(null);
    setIsProcessing(true);

    let accumulated = "";
    stopRef.current = createSSEStream("/api/chat/stream", {
      method: "POST",
      body: { model, messages, stream: true, safe_prompt: safePrompt },
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

  return (
    <div className="flex h-[calc(100vh-3.5rem)] min-h-0">
      <aside className="hidden w-64 shrink-0 border-r border-border md:flex">
        <ChatSessionSidebar
          sessions={generalSessions}
          activeId={sessionId ?? null}
          onSelect={handleSelect}
          onCreate={handleCreate}
          onDelete={handleDelete}
          className="w-full"
        />
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center justify-between border-b border-border px-6 py-4">
          <div>
            <h1 className="text-lg font-semibold tracking-tight text-foreground">
              Playground (Chat Completions)
            </h1>
            <p className="text-xs text-muted-foreground">Standard Chat</p>
          </div>
          <button
            type="button"
            onClick={() => setSettingsOpen((o) => !o)}
            className="inline-flex items-center gap-1.5 rounded-xl border border-border glass px-3 py-1.5 text-xs font-medium text-foreground transition hover:bg-surface-hover"
          >
            <Settings2 className="size-3.5" />
            Chat Settings
          </button>
        </div>

        <div className="flex min-h-0 flex-1">
          <div className="custom-scrollbar flex min-w-0 flex-1 flex-col overflow-y-auto px-6 py-6">
            {!activeSession || activeSession.messages.length === 0 ? (
              <EmptyState
                className="my-auto"
                title="Start a conversation"
                description="Send a message to begin a raw chat-completions session."
              />
            ) : (
              <MessageList messages={activeSession.messages} />
            )}
            <div ref={bottomRef} />
          </div>

          {settingsOpen ? (
            <aside className="hidden w-72 shrink-0 border-l border-border p-5 lg:block">
              <div className="glass-elevated rounded-2xl p-4">
                <div className="flex items-center justify-between">
                  <h2 className="text-sm font-semibold text-foreground">Chat Settings</h2>
                  <button
                    type="button"
                    onClick={() => setSettingsOpen(false)}
                    aria-label="Close settings"
                    className="text-muted-foreground hover:text-foreground"
                  >
                    <X className="size-4" />
                  </button>
                </div>
                <div className="mt-4 space-y-4">
                  <div>
                    <label className="text-xs font-medium text-muted-foreground">Model</label>
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
                  <div className="flex items-center justify-between rounded-xl border border-border bg-background-elevated px-3 py-2.5">
                    <span className="text-xs font-medium text-foreground">Enable Safe Prompt</span>
                    <Switch checked={safePrompt} onCheckedChange={setSafePrompt} />
                  </div>
                </div>
              </div>
            </aside>
          ) : null}
        </div>

        <div className={cn("border-t border-border px-6 py-4")}>
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
  );
}
