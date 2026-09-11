import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Bot, Globe, MessageSquare, Plug, Save, Settings2, Sparkles, Trash2, Wrench, X } from "lucide-react";
import { toast } from "sonner";
import { z } from "zod";
import {
  agentsApi,
  connectorsApi,
  librariesApi,
  ontologyApi,
  QK,
  toolsApi,
} from "@/api";
import { errorMessage } from "@/api/client";
import type { AgentPatch } from "@/api/agents";
import { createSSEStream, parseEventData } from "@/api/sse";
import { Composer } from "@/components/chat/Composer";
import { MessageList } from "@/components/chat/MessageList";
import { AttachmentControl } from "@/components/chat/AttachmentChip";
import { ChatSessionSidebar } from "@/components/chat/ChatSessionSidebar";
import { TierSelector } from "@/components/chat/TierSelector";
import { GlassPanel, GlassPanelHeader } from "@/components/glass/GlassPanel";
import { GuardrailEditor } from "@/components/agents/GuardrailEditor";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { DetailSkeleton } from "@/components/ui/Skeletons";
import { Slider } from "@/components/ui/slider";
import { useSessionStore } from "@/stores/sessions";
import { cn } from "@/lib/utils";
import type { ChatMessagePayload } from "@/api";
import type { Concept, ConnectorRef, GuardrailConfig, Message, UploadResult } from "@/types";

const searchSchema = z.object({
  session: z.string().optional(),
});

export const Route = createFileRoute("/agents/$id")({
  validateSearch: searchSchema,
  head: () => ({
    meta: [
      { title: "Agent Detail — Agentic AI Design Patterns" },
      { name: "description", content: "Agent configuration and chat." },
      { property: "og:title", content: "Agent Detail — Agentic AI Design Patterns" },
      { property: "og:description", content: "Agent configuration and chat." },
    ],
  }),
  component: AgentsIdPage,
});

const newMessageId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

function toolName(t: unknown): string {
  if (typeof t === "string") return t;
  if (t && typeof t === "object") {
    const o = t as Record<string, unknown>;
    const fn = o["function"];
    if (fn && typeof fn === "object") return String((fn as Record<string, unknown>)["name"] ?? "");
    return String(o["name"] ?? "");
  }
  return "";
}

interface ConfigForm {
  name: string;
  description: string;
  model: string;
  instructions: string;
  tier: string;
  temperature: number | null;
  top_p: number | null;
  max_tokens: number | null;
  random_seed: number | null;
  frequency_penalty: number | null;
  presence_penalty: number | null;
  toolNames: string[];
  connectorIds: string[];
  libraryIds: string[];
  guardrails: GuardrailConfig | null;
}

function AgentsIdPage() {
  const { id } = Route.useParams();
  const { session: sessionId } = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const qc = useQueryClient();

  const agentQuery = useQuery({
    queryKey: QK.agent(id),
    queryFn: () => agentsApi.get(id),
    retry: 1,
  });

  const toolsQuery = useQuery({ queryKey: QK.tools(), queryFn: toolsApi.list });
  const connectorsQuery = useQuery({
    queryKey: QK.connectors(),
    queryFn: () => connectorsApi.list(),
  });
  const librariesQuery = useQuery({ queryKey: QK.libraries(), queryFn: librariesApi.list });
  const domainConceptsQuery = useQuery({
    queryKey: QK.ontologyConcepts("domain"),
    queryFn: () => ontologyApi.concepts("domain"),
  });
  const annotationsQuery = useQuery({
    queryKey: QK.annotations("agent", id),
    queryFn: () => ontologyApi.annotationsFor("agent", id),
  });

  const domainConcepts: Concept[] = Array.isArray(domainConceptsQuery.data)
    ? domainConceptsQuery.data
    : (domainConceptsQuery.data?.concepts ?? []);

  const annotationMap = annotationsQuery.data
    ? "annotations" in annotationsQuery.data
      ? annotationsQuery.data.annotations
      : annotationsQuery.data
    : undefined;
  const currentDomains = annotationMap?.serves_domain ?? [];

  const [form, setForm] = useState<ConfigForm | null>(null);
  const [configOpen, setConfigOpen] = useState(false);
  const [sessionsOpen, setSessionsOpen] = useState(false);

  useEffect(() => {
    if (!agentQuery.data) return;
    const a = agentQuery.data;
    setForm({
      name: a.name,
      description: a.description ?? "",
      model: a.model,
      instructions: a.instructions ?? "",
      tier: a.tier ?? "foundation",
      temperature: a.temperature ?? null,
      top_p: a.top_p ?? null,
      max_tokens: a.max_tokens ?? null,
      random_seed: a.random_seed ?? null,
      frequency_penalty: a.frequency_penalty ?? null,
      presence_penalty: a.presence_penalty ?? null,
      toolNames: (a.tools ?? []).map(toolName).filter(Boolean),
      connectorIds: (a.connectors ?? []).map((c) => c.connector_id),
      libraryIds: a.document_library_ids ?? [],
      guardrails: a.guardrails ?? null,
    });
  }, [agentQuery.data]);

  const patchMutation = useMutation({
    mutationFn: (body: AgentPatch) => agentsApi.update(id, body),
    onSuccess: () => {
      toast.success("Agent updated");
      void qc.invalidateQueries({ queryKey: QK.agent(id) });
      void qc.invalidateQueries({ queryKey: QK.agents() });
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  const deleteMutation = useMutation({
    mutationFn: () => agentsApi.remove(id),
    onSuccess: () => {
      toast.success("Agent deleted");
      void qc.invalidateQueries({ queryKey: QK.agents() });
      void navigate({ to: "/agents" });
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  const setDomainsMutation = useMutation({
    mutationFn: (conceptIds: string[]) =>
      ontologyApi.setAnnotations({
        subject_type: "agent",
        subject_id: id,
        predicate: "serves_domain",
        concept_ids: conceptIds,
      }),
    onSuccess: () => {
      toast.success("Domains updated");
      void qc.invalidateQueries({ queryKey: QK.annotations("agent", id) });
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  const handleSave = () => {
    if (!form || !agentQuery.data) return;
    const a = agentQuery.data;
    const patch: AgentPatch = {};
    if (form.name !== a.name) patch.name = form.name;
    if (form.description !== (a.description ?? "")) patch.description = form.description;
    if (form.model !== a.model) patch.model = form.model;
    if (form.instructions !== (a.instructions ?? "")) patch.instructions = form.instructions;
    if (form.tier !== (a.tier ?? "foundation")) patch.tier = form.tier;
    if (form.temperature !== (a.temperature ?? null)) patch.temperature = form.temperature;
    if (form.top_p !== (a.top_p ?? null)) patch.top_p = form.top_p;
    if (form.max_tokens !== (a.max_tokens ?? null)) patch.max_tokens = form.max_tokens;
    if (form.random_seed !== (a.random_seed ?? null)) patch.random_seed = form.random_seed;
    if (form.frequency_penalty !== (a.frequency_penalty ?? null))
      patch.frequency_penalty = form.frequency_penalty;
    if (form.presence_penalty !== (a.presence_penalty ?? null))
      patch.presence_penalty = form.presence_penalty;

    const originalToolNames = (a.tools ?? []).map(toolName).filter(Boolean).sort().join(",");
    if (form.toolNames.slice().sort().join(",") !== originalToolNames) {
      patch.tools = form.toolNames.map((n) => ({ name: n }));
    }
    const originalConnectorIds = (a.connectors ?? []).map((c) => c.connector_id).sort().join(",");
    if (form.connectorIds.slice().sort().join(",") !== originalConnectorIds) {
      patch.connectors = form.connectorIds.map((cid) => ({ connector_id: cid }) as ConnectorRef);
    }
    const originalLibraryIds = (a.document_library_ids ?? []).slice().sort().join(",");
    if (form.libraryIds.slice().sort().join(",") !== originalLibraryIds) {
      patch.document_library_ids = form.libraryIds;
    }

    if (JSON.stringify(form.guardrails) !== JSON.stringify(a.guardrails ?? null)) {
      patch.guardrails = form.guardrails;
    }

    if (Object.keys(patch).length === 0) {
      toast.info("No changes to save");
      return;
    }
    patchMutation.mutate(patch);
  };

  /* ── chat ────────────────────────────────────────────────────────── */
  const sessions = useSessionStore((s) => s.sessions);
  const createSession = useSessionStore((s) => s.createSession);
  const removeSession = useSessionStore((s) => s.removeSession);
  const appendMessage = useSessionStore((s) => s.appendMessage);
  const updateMessage = useSessionStore((s) => s.updateMessage);
  const setConversationId = useSessionStore((s) => s.setConversationId);

  const agentSessions = useMemo(
    () =>
      sessions
        .filter((s) => s.type === "agent" && s.agentId === id)
        .sort((a, b) => b.updatedAt - a.updatedAt),
    [sessions, id],
  );
  const activeSession = useMemo(
    () => agentSessions.find((s) => s.id === sessionId) ?? null,
    [agentSessions, sessionId],
  );

  const [input, setInput] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);
  const [attachment, setAttachment] = useState<UploadResult | null>(null);
  const [uploading, setUploading] = useState(false);
  const stopRef = useRef<(() => void) | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [activeSession?.messages.length]);
  useEffect(() => () => stopRef.current?.(), []);

  const handleCreateSession = () => {
    const sid = createSession("agent", id);
    void navigate({ search: { session: sid } });
  };
  const handleSelectSession = (sid: string) => {
    void navigate({ search: { session: sid } });
    setSessionsOpen(false);
  };
  const handleDeleteSession = (sid: string) => {
    removeSession(sid);
    if (sid === sessionId) {
      const next = agentSessions.find((s) => s.id !== sid);
      void navigate({ search: { session: next?.id } });
    }
  };

  const submit = () => {
    const text = input.trim();
    if ((!text && !attachment) || isProcessing) return;

    let sid = sessionId;
    if (!sid || !activeSession) {
      sid = createSession("agent", id);
      void navigate({ search: { session: sid } });
    }
    const activeSid = sid as string;

    const userMessage: Message = {
      id: newMessageId(),
      role: "user",
      content: text,
      timestamp: new Date().toISOString(),
      imageUrl: attachment?.image_url,
      imageBase64: attachment?.image_base64,
      imageMime: attachment?.image_mime,
    };
    appendMessage(activeSid, userMessage);
    const assistantId = newMessageId();
    appendMessage(activeSid, { id: assistantId, role: "assistant", content: "", streaming: true });

    setInput("");
    setAttachment(null);
    setIsProcessing(true);

    const conversationId = activeSession?.conversationId ?? null;

    let accumulated = "";
    stopRef.current = createSSEStream("/api/orchestrate/stream", {
      method: "POST",
      body: {
        query: text,
        agent_id: id,
        ...(conversationId ? { conversation_id: conversationId } : {}),
        ...(attachment
          ? { image_base64: attachment.image_base64, image_mime: attachment.image_mime }
          : {}),
      },
      onEvent: (event) => {
        switch (event.type) {
          case "text_chunk":
            accumulated += String(parseEventData<string>(event));
            updateMessage(activeSid, assistantId, { content: accumulated });
            break;
          case "conversation_id":
            setConversationId(activeSid, String(parseEventData<string>(event)));
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
        updateMessage(activeSid, assistantId, { streaming: false });
        setIsProcessing(false);
      },
      onError: (err) => {
        toast.error(err instanceof Error ? err.message : "Stream failed");
        updateMessage(activeSid, assistantId, { streaming: false });
        setIsProcessing(false);
      },
    });
  };

  /* ── render ──────────────────────────────────────────────────────── */
  if (agentQuery.isLoading) {
    return (
      <div className="px-6 py-8">
        <DetailSkeleton />
      </div>
    );
  }
  if (agentQuery.isError || !agentQuery.data || !form) {
    const notFound =
      (agentQuery.error as { response?: { status?: number } } | undefined)?.response?.status === 404;
    return (
      <div className="px-6 py-8">
        {notFound ? (
          <EmptyState
            title="Agent not found."
            description="It may have been deleted."
            action={
              <Link
                to="/agents"
                className="inline-flex items-center gap-1.5 rounded-xl border border-border glass px-3 py-1.5 text-xs font-medium text-foreground transition hover:bg-surface-hover"
              >
                <ArrowLeft className="size-3.5" />
                Back to Agent Studio
              </Link>
            }
          />
        ) : (
          <ErrorState error={agentQuery.error} onRetry={() => void agentQuery.refetch()} />
        )}
      </div>
    );
  }

  const agent = agentQuery.data;
  const toolOptions = toolsQuery.data ?? [];
  const connectorOptions = connectorsQuery.data?.items ?? [];
  const libraryOptions = librariesQuery.data ?? [];

  return (
    <div className="flex h-[calc(100vh-3.5rem)] min-h-0 flex-col">
      {/* ── Top Bar ── */}
      <header className="relative z-30 flex items-center gap-3 border-b border-border px-5 py-3">
        {/* Back + Sessions dropdown */}
        <Link
          to="/agents"
          className="inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs text-muted-foreground transition hover:bg-surface-hover hover:text-foreground"
        >
          <ArrowLeft className="size-3" />
          Back
        </Link>

        <div className="h-5 w-px bg-border/60" />

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
            {agentSessions.length > 0 && (
              <span className="rounded bg-surface-elevated px-1 py-0.5 text-[10px] tabular-nums leading-none">
                {agentSessions.length}
              </span>
            )}
          </button>
          <ChatSessionSidebar
            sessions={agentSessions}
            activeId={sessionId ?? null}
            onSelect={handleSelectSession}
            onCreate={handleCreateSession}
            onDelete={handleDeleteSession}
            open={sessionsOpen}
            onClose={() => setSessionsOpen(false)}
          />
        </div>

        <div className="h-5 w-px bg-border/60" />

        {/* Title + badges */}
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-sm font-semibold tracking-tight text-foreground">
            {agent.name}
          </h1>
        </div>

        {/* Model + classification badges (playground-style) */}
        <div className="hidden items-center gap-2 sm:flex">
          <span className="inline-flex items-center gap-1.5 rounded-lg border border-blue/20 bg-blue/8 px-2 py-1 text-[10px] font-medium text-blue">
            <Sparkles className="size-3" />
            {agent.model}
          </span>
          {currentDomains.length > 0 && (
            <span className="inline-flex items-center gap-1.5 rounded-lg border border-indigo/20 bg-indigo/8 px-2 py-1 text-[10px] font-medium text-indigo">
              <Globe className="size-3" />
              {currentDomains.length} domain{currentDomains.length !== 1 ? "s" : ""}
            </span>
          )}
        </div>

        {/* Right actions */}
        <div className="flex items-center gap-2">
          {!agent.protected && (
            <button
              type="button"
              onClick={() => window.confirm(`Delete agent "${agent.name}"?`) && deleteMutation.mutate()}
              disabled={deleteMutation.isPending}
              className="inline-flex items-center gap-1.5 rounded-lg border border-red/20 px-2.5 py-1.5 text-xs font-medium text-red/80 transition hover:border-red/40 hover:bg-red/10 hover:text-red disabled:opacity-50"
            >
              <Trash2 className="size-3.5" />
              <span className="hidden sm:inline">Delete</span>
            </button>
          )}
          <button
            type="button"
            onClick={() => setConfigOpen((o) => !o)}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition",
              configOpen
                ? "border-primary/30 bg-primary/10 text-primary"
                : "border-border/60 text-muted-foreground hover:border-border hover:bg-surface-hover hover:text-foreground",
            )}
          >
            <Settings2 className="size-3.5" />
            <span className="hidden sm:inline">Config</span>
          </button>
        </div>
      </header>

      {/* ── Content Row ── */}
      <div className="flex min-h-0 flex-1">
        {/* Chat Area */}
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="custom-scrollbar flex-1 overflow-y-auto">
            {!activeSession || activeSession.messages.length === 0 ? (
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
                  Chat with{" "}
                  <span className="text-gradient-brand">{agent.name}</span>
                </h2>
                <p className="mt-2 max-w-sm text-center text-sm leading-relaxed text-muted-foreground">
                  Send a message below to start. Open Config to adjust parameters.
                </p>
              </div>
            ) : (
              <div className="mx-auto w-full max-w-3xl px-6 py-6">
                <MessageList messages={activeSession.messages} />
                <div ref={bottomRef} />
              </div>
            )}
          </div>
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
                placeholder={`Message ${agent.name}…`}
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

        {configOpen ? (
          <aside className="hidden w-96 shrink-0 overflow-y-auto border-l border-border bg-background/40 backdrop-blur-md custom-scrollbar lg:block">
            <div className="space-y-4 p-5">
              <GlassPanel tone="raised">
                <GlassPanelHeader
                  title="Agent Configuration"
                  actions={
                    <button
                      type="button"
                      onClick={handleSave}
                      disabled={patchMutation.isPending}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-gradient-brand px-3 py-1.5 text-xs font-medium text-primary-foreground transition hover:opacity-90 disabled:opacity-50"
                    >
                      <Save className="size-3.5" />
                      {patchMutation.isPending ? "Saving…" : "Save"}
                    </button>
                  }
                />
                <div className="space-y-3 p-5">
                  <Field label="Name">
                    <input
                      value={form.name}
                      onChange={(e) => setForm({ ...form, name: e.target.value })}
                      className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                    />
                  </Field>
                  <Field label="Description">
                    <input
                      value={form.description}
                      onChange={(e) => setForm({ ...form, description: e.target.value })}
                      className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                    />
                  </Field>
                  <Field label="Model">
                    <input
                      value={form.model}
                      onChange={(e) => setForm({ ...form, model: e.target.value })}
                      className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                    />
                  </Field>
                  <Field label="Instructions">
                    <textarea
                      rows={5}
                      value={form.instructions}
                      onChange={(e) => setForm({ ...form, instructions: e.target.value })}
                      className="custom-scrollbar mt-1 w-full resize-none rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                    />
                  </Field>
                  <Field label="Tier">
                    <div className="mt-1">
                      <TierSelector value={form.tier} onChange={(tier) => setForm({ ...form, tier })} />
                    </div>
                  </Field>
                  <Field label="Domain">
                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                      {currentDomains.map((did) => {
                        const concept = domainConcepts.find((c) => c.id === did);
                        return (
                          <span
                            key={did}
                            className="inline-flex items-center gap-1 rounded-full border border-cyan/25 bg-cyan/10 px-2 py-0.5 text-[10px] font-medium text-cyan"
                          >
                            {concept?.label ?? did}
                            <button
                              type="button"
                              aria-label={`Remove ${did}`}
                              onClick={() =>
                                setDomainsMutation.mutate(currentDomains.filter((d) => d !== did))
                              }
                            >
                              <X className="size-2.5" />
                            </button>
                          </span>
                        );
                      })}
                    </div>
                    <select
                      value=""
                      disabled={setDomainsMutation.isPending}
                      onChange={(e) => {
                        const v = e.target.value;
                        if (v && !currentDomains.includes(v)) {
                          setDomainsMutation.mutate([...currentDomains, v]);
                        }
                      }}
                      className="mt-1.5 w-full rounded-lg border border-border bg-background px-3 py-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                    >
                      <option value="">Add a domain…</option>
                      {domainConcepts
                        .filter((c) => !currentDomains.includes(c.id))
                        .map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.label}
                          </option>
                        ))}
                    </select>
                  </Field>
                </div>
              </GlassPanel>

              <GlassPanel tone="raised">
                <GlassPanelHeader title="Completion Parameters" />
                <div className="space-y-4 p-5">
                  <SliderField
                    label="Temperature"
                    lowLabel="Precise"
                    highLabel="Creative"
                    value={form.temperature}
                    min={0}
                    max={1.5}
                    step={0.05}
                    onChange={(v) => setForm({ ...form, temperature: v })}
                  />
                  <SliderField
                    label="Top P"
                    lowLabel="Focused"
                    highLabel="Diverse"
                    value={form.top_p}
                    min={0}
                    max={1}
                    step={0.05}
                    onChange={(v) => setForm({ ...form, top_p: v })}
                  />
                  <NumberField
                    label="Max Tokens"
                    placeholder="Default (model limit)"
                    value={form.max_tokens}
                    onChange={(v) => setForm({ ...form, max_tokens: v })}
                  />
                  <NumberField
                    label="Random Seed"
                    placeholder="None (random)"
                    value={form.random_seed}
                    onChange={(v) => setForm({ ...form, random_seed: v })}
                  />
                  <SliderField
                    label="Frequency Penalty"
                    lowLabel="0"
                    highLabel="2"
                    value={form.frequency_penalty}
                    min={0}
                    max={2}
                    step={0.05}
                    onChange={(v) => setForm({ ...form, frequency_penalty: v })}
                  />
                  <SliderField
                    label="Presence Penalty"
                    lowLabel="0"
                    highLabel="2"
                    value={form.presence_penalty}
                    min={0}
                    max={2}
                    step={0.05}
                    onChange={(v) => setForm({ ...form, presence_penalty: v })}
                  />
                </div>
              </GlassPanel>

              <GlassPanel tone="raised">
                <GlassPanelHeader title="Tools Equipped" />
                <div className="p-5">
                  {form.toolNames.length === 0 ? (
                    <p className="text-xs text-muted-foreground">No tools equipped.</p>
                  ) : (
                    <div className="flex flex-wrap gap-1.5">
                      {form.toolNames.map((n) => (
                        <Chip
                          key={n}
                          icon={<Wrench className="size-2.5" />}
                          label={n}
                          onRemove={() =>
                            setForm({ ...form, toolNames: form.toolNames.filter((x) => x !== n) })
                          }
                        />
                      ))}
                    </div>
                  )}
                  <select
                    value=""
                    onChange={(e) => {
                      const v = e.target.value;
                      if (v && !form.toolNames.includes(v)) {
                        setForm({ ...form, toolNames: [...form.toolNames, v] });
                      }
                    }}
                    className="mt-3 w-full rounded-lg border border-border bg-background px-3 py-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                  >
                    <option value="">Attach a tool…</option>
                    {toolOptions
                      .filter((t) => !form.toolNames.includes(t.name))
                      .map((t) => (
                        <option key={t.id} value={t.name}>
                          {t.name}
                        </option>
                      ))}
                  </select>
                </div>
              </GlassPanel>

              <GlassPanel tone="raised">
                <GlassPanelHeader title="Connectors" />
                <div className="p-5">
                  {form.connectorIds.length === 0 ? (
                    <p className="text-xs text-muted-foreground">No connectors attached.</p>
                  ) : (
                    <div className="flex flex-wrap gap-1.5">
                      {form.connectorIds.map((cid) => {
                        const c = connectorOptions.find((x) => x.id === cid);
                        return (
                          <Chip
                            key={cid}
                            icon={<Plug className="size-2.5" />}
                            label={c?.name ?? cid}
                            onRemove={() =>
                              setForm({
                                ...form,
                                connectorIds: form.connectorIds.filter((x) => x !== cid),
                              })
                            }
                          />
                        );
                      })}
                    </div>
                  )}
                  <select
                    value=""
                    onChange={(e) => {
                      const v = e.target.value;
                      if (v && !form.connectorIds.includes(v)) {
                        setForm({ ...form, connectorIds: [...form.connectorIds, v] });
                      }
                    }}
                    className="mt-3 w-full rounded-lg border border-border bg-background px-3 py-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                  >
                    <option value="">Attach a connector…</option>
                    {connectorOptions
                      .filter((c) => !form.connectorIds.includes(c.id))
                      .map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                  </select>
                </div>
              </GlassPanel>

              <GlassPanel tone="raised">
                <GlassPanelHeader title="Document Libraries" />
                <div className="p-5">
                  {form.libraryIds.length === 0 ? (
                    <p className="text-xs text-muted-foreground">No libraries attached.</p>
                  ) : (
                    <div className="flex flex-wrap gap-1.5">
                      {form.libraryIds.map((lid) => {
                        const l = libraryOptions.find((x) => x.id === lid);
                        return (
                          <Chip
                            key={lid}
                            label={l?.name ?? lid}
                            onRemove={() =>
                              setForm({
                                ...form,
                                libraryIds: form.libraryIds.filter((x) => x !== lid),
                              })
                            }
                          />
                        );
                      })}
                    </div>
                  )}
                  <select
                    value=""
                    onChange={(e) => {
                      const v = e.target.value;
                      if (v && !form.libraryIds.includes(v)) {
                        setForm({ ...form, libraryIds: [...form.libraryIds, v] });
                      }
                    }}
                    className="mt-3 w-full rounded-lg border border-border bg-background px-3 py-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                  >
                    <option value="">Attach a library…</option>
                    {libraryOptions
                      .filter((l) => !form.libraryIds.includes(l.id))
                      .map((l) => (
                        <option key={l.id} value={l.id}>
                          {l.name}
                        </option>
                      ))}
                  </select>
                </div>
              </GlassPanel>

              <GuardrailEditor
                value={form.guardrails}
                onChange={(g) => setForm({ ...form, guardrails: g })}
              />
            </div>
          </aside>
        ) : null}
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</label>
      {children}
    </div>
  );
}

function Chip({
  icon,
  label,
  onRemove,
}: {
  icon?: React.ReactNode;
  label: string;
  onRemove: () => void;
}) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-border bg-background-elevated px-2 py-0.5 text-[10px] font-medium text-foreground">
      {icon}
      {label}
      <button type="button" aria-label={`Remove ${label}`} onClick={onRemove}>
        <X className="size-2.5" />
      </button>
    </span>
  );
}

function SliderField({
  label,
  lowLabel,
  highLabel,
  value,
  min,
  max,
  step,
  onChange,
}: {
  label: string;
  lowLabel: string;
  highLabel: string;
  value: number | null;
  min: number;
  max: number;
  step: number;
  onChange: (v: number | null) => void;
}) {
  const current = value ?? (min + max) / 2;
  return (
    <div>
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-foreground">{label}</span>
        <span className="font-mono text-[11px] text-muted-foreground">
          {value == null ? "default" : current.toFixed(2)}
        </span>
      </div>
      <Slider
        value={[current]}
        min={min}
        max={max}
        step={step}
        onValueChange={([v]) => onChange(v ?? null)}
        className="mt-2"
      />
      <div className="mt-1 flex justify-between text-[10px] text-muted-foreground">
        <span>{lowLabel}</span>
        <span>{highLabel}</span>
      </div>
    </div>
  );
}

function NumberField({
  label,
  placeholder,
  value,
  onChange,
}: {
  label: string;
  placeholder: string;
  value: number | null;
  onChange: (v: number | null) => void;
}) {
  return (
    <div>
      <label className="text-xs font-medium text-muted-foreground">{label}</label>
      <input
        type="number"
        value={value ?? ""}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))}
        className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
      />
    </div>
  );
}
