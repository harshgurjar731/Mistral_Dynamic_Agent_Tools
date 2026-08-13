import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  AlertCircle, ArrowLeft, Bot, History as HistoryIcon, ImagePlus, Loader2,
  PanelRightClose, PanelRightOpen, Play, RotateCcw, Send, TerminalSquare,
  User, X as XIcon, Zap,
} from 'lucide-react';

import { workflowsApi } from '../../api/workflows';
import { chatApi } from '../../api/chat';
import {
  executionDuration, executionsApi, formatDuration, isActive, isTerminal,
} from '../../api/executions';
import { QK } from '../../lib/queryClient';
import { cn } from '../../lib/utils';
import ExecutionMonitor from './execution/ExecutionMonitor';
import ExecutionStatusBadge from './execution/ExecutionStatusBadge';
import { useExecutionStream } from './execution/useExecutionStream';
import { formatWorkflowResult, isEmptyResult } from './execution/resultFormat';
import WorkflowHistoryPanel from './WorkflowHistoryPanel';

const API_IMG_BASE = import.meta.env.VITE_API_URL ?? '';

interface ImageUploadData {
  image_base64: string;
  image_url: string;
  image_mime: string;
  previewUrl: string;
}

interface Message {
  role: 'user' | 'assistant' | 'system';
  content: string;
  imagePreview?: string;
  imageData?: ImageUploadData;
}

/** Chat state is keyed per execution so reopening a run restores its transcript. */
interface PersistedChat {
  messages: Message[];
  resultAnnounced: boolean;
}

function chatStorageKey(executionId: string) {
  return `workflow_chat_${executionId}`;
}

/** Variables that are wiring between steps, not something to ask a user for. */
const isInternalVar = (name: string) => /^\{?step_.*_output\}?$/.test(name.trim());

/** Pull `{placeholder}` names out of a step config tree. */
function collectTemplateVars(steps: any[]): string[] {
  const found = new Set<string>();
  const walk = (value: unknown) => {
    if (typeof value === 'string') {
      for (const match of value.matchAll(/\{+([^{}]+)\}+/g)) found.add(match[1].trim());
    } else if (value && typeof value === 'object') {
      Object.values(value).forEach(walk);
    }
  };
  steps.forEach((step) => walk(step?.config));
  return [...found].filter((name) => !isInternalVar(name));
}

/** Find the `{"__ready": true, "inputs": {…}}` handshake in an LLM reply. */
function extractReadyPayload(content: string): { inputs: Record<string, string> } | null {
  const candidates: string[] = [content.trim()];

  const fenced = content.match(/```(?:json)?\n?([\s\S]*?)\n?```/);
  if (fenced) candidates.push(fenced[1].trim());

  const bare = content.match(/(\{[\s\S]*"__ready"[\s\S]*\})/);
  if (bare) candidates.push(bare[1].trim());

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      if (parsed?.__ready && parsed.inputs) return { inputs: parsed.inputs };
    } catch {
      /* not this one */
    }
  }
  return null;
}

/** Strip a `__ready: false` block so the handshake never leaks into the chat. */
function stripReadyBlock(content: string): string {
  return content
    .replace(/```(?:json)?\n?[\s\S]*?"__ready"[\s\S]*?\n?```/g, '')
    .replace(/\{[\s\S]*"__ready"[\s\S]*\}/g, '')
    .trim();
}

const MARKDOWN_COMPONENTS = {
  table: (props: any) => (
    <div className="my-5 overflow-x-auto rounded-xl border border-[var(--color-border-subtle)] bg-black/20 shadow-lg">
      <table className="w-full border-collapse text-left text-sm" {...props} />
    </div>
  ),
  thead: (props: any) => (
    <thead className="border-b border-[var(--color-border-subtle)] bg-black/40 text-xs uppercase tracking-wider text-indigo-200" {...props} />
  ),
  tbody: (props: any) => <tbody className="divide-y divide-[var(--color-border-subtle)]" {...props} />,
  tr: (props: any) => <tr className="transition-colors hover:bg-white/[0.04]" {...props} />,
  th: (props: any) => <th className="px-4 py-3 font-semibold" {...props} />,
  td: (props: any) => <td className="px-4 py-3 align-top leading-relaxed text-[var(--color-text-secondary)]" {...props} />,
  a: (props: any) => <a className="text-indigo-400 underline underline-offset-2 hover:text-indigo-300" {...props} />,
  h1: (props: any) => <h1 className="mt-6 mb-4 border-b border-[var(--color-border-subtle)] pb-2 text-2xl font-bold text-white" {...props} />,
  h2: (props: any) => <h2 className="mt-6 mb-3 text-xl font-semibold text-indigo-300" {...props} />,
  h3: (props: any) => <h3 className="mt-4 mb-2 text-lg font-medium text-white" {...props} />,
};

export default function WorkflowExecutionPage() {
  const { workflowName } = useParams();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const urlExecId = searchParams.get('execId');

  // ── Workflow definition ────────────────────────────────────────────────
  const { data: wfData, isLoading: wfLoading } = useQuery({
    queryKey: QK.workflow(workflowName!),
    queryFn: () => workflowsApi.get(workflowName!).then((r) => r.data),
    enabled: !!workflowName,
  });
  const workflow = wfData?.workflow ?? wfData;

  // ── Chat + execution state ─────────────────────────────────────────────
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [executionId, setExecutionId] = useState<string | null>(urlExecId);
  const [resultAnnounced, setResultAnnounced] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [uploadedImage, setUploadedImage] = useState<ImageUploadData | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  const scrollRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const greetedRef = useRef(false);
  const requiredInputs = useRef<string[]>([]);

  const { detail, phase, error: streamError, events, logs, reconnect } =
    useExecutionStream(executionId);

  const live = isActive(detail?.status);
  const finished = isTerminal(detail?.status);

  const notify = useCallback((content: string) => {
    setMessages((prev) => [...prev, { role: 'assistant', content }]);
  }, []);

  // ── Live clock for the header readout ──────────────────────────────────
  useEffect(() => {
    if (!live) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [live]);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, isTyping]);

  // ── Chat persistence ───────────────────────────────────────────────────
  useEffect(() => {
    if (!executionId || !messages.length) return;
    const payload: PersistedChat = { messages, resultAnnounced };
    try {
      localStorage.setItem(chatStorageKey(executionId), JSON.stringify(payload));
    } catch {
      // Quota exceeded — a long transcript with inline images can blow the
      // budget. Losing the cache is preferable to breaking the page.
    }
  }, [executionId, messages, resultAnnounced]);

  // ── Opening an existing execution ──────────────────────────────────────
  useEffect(() => {
    if (!urlExecId || greetedRef.current) return;
    greetedRef.current = true;
    setExecutionId(urlExecId);

    const saved = localStorage.getItem(chatStorageKey(urlExecId));
    if (saved) {
      try {
        const parsed: PersistedChat = JSON.parse(saved);
        setMessages(parsed.messages ?? []);
        setResultAnnounced(parsed.resultAnnounced ?? false);
        return;
      } catch {
        /* corrupted cache — fall through to the placeholder */
      }
    }

    setMessages([{
      role: 'assistant',
      content:
        '**Viewing a past execution.**\n\nThe conversation for this run was not saved on this device, but the full timeline, trace and result are on the right.',
    }]);
    setResultAnnounced(true);
  }, [urlExecId]);

  // ── Opening a fresh run: greet and collect inputs ──────────────────────
  useEffect(() => {
    if (!workflow || urlExecId || greetedRef.current) return;
    greetedRef.current = true;

    const schema = (workflow.input_schema ?? []).filter((f: any) => !isInternalVar(f.name));
    const names: string[] = schema.length
      ? schema.map((f: any) => f.name)
      : collectTemplateVars(workflow.steps ?? []);
    requiredInputs.current = names;

    const displayName = String(workflow.name).replace(/_/g, ' ');
    const readyContract = `Once you have ALL the information, reply with ONLY this JSON and nothing else:
\`\`\`json
{"__ready": true, "inputs": {"var_name": "value"}}
\`\`\``;

    if (names.length) {
      const list = schema.length
        ? schema.map((f: any) => `- **${f.name}**${f.description ? ` — ${f.description}` : ''}`).join('\n')
        : names.map((n) => `- **${n}**`).join('\n');

      setMessages([
        {
          role: 'system',
          content: `You are collecting inputs for the '${workflow.name}' workflow.
Required inputs: ${names.join(', ')}.
Ask for them conversationally, one short message at a time.
Never output JSON while you are still gathering. ${readyContract}`,
        },
        {
          role: 'assistant',
          content: `Hi! To run **${displayName}** I need a few details:\n\n${list}\n\nWhat should I use?`,
        },
      ]);
    } else {
      setMessages([
        {
          role: 'system',
          content: `You are collecting context for the '${workflow.name}' workflow, which declares no explicit inputs.
Ask the user to describe what they want. ${readyContract}
Use the key "user_input" for their description.`,
        },
        {
          role: 'assistant',
          content: `Hi! Tell me what you'd like **${displayName}** to work on — requirements, preferences, or any detail that will sharpen the result.`,
        },
      ]);
    }
  }, [workflow, urlExecId]);

  // ── Announce the outcome in the transcript, once ───────────────────────
  useEffect(() => {
    if (!detail || resultAnnounced || !isTerminal(detail.status)) return;
    setResultAnnounced(true);

    const status = detail.status.toUpperCase();
    if (status === 'COMPLETED') {
      const body = isEmptyResult(detail.result)
        ? '_The workflow finished without returning output. The step timeline on the right shows what ran._'
        : formatWorkflowResult(detail.result);
      notify(`🎉 **Execution complete**\n\n---\n\n${body}\n\n---\n_Ask me anything about this result._`);
    } else {
      const reason = detail.error
        ? `\n\n> ${detail.error}`
        : '';
      notify(`⚠️ Execution **${status.toLowerCase().replace(/_/g, ' ')}**.${reason}`);
    }
  }, [detail?.status, detail?.result, detail?.error, resultAnnounced, notify]);

  // ── Execute ────────────────────────────────────────────────────────────
  const executeMut = useMutation({
    mutationFn: (inputs: Record<string, string>) => {
      const lastImage = uploadedImage ?? [...messages].reverse().find((m) => m.imageData)?.imageData;
      const merged: Record<string, string> = { ...inputs };
      if (lastImage) {
        merged.image_base64 = lastImage.image_base64;
        merged.image_url = lastImage.image_url;
        merged.image_mime = lastImage.image_mime;
      }
      return workflowsApi.execute(workflow.name, { input: merged, wait_for_result: false });
    },
    onSuccess: (res) => {
      const id = res.data?.execution_id;
      if (!id) {
        notify('❌ The backend accepted the request but returned no execution id.');
        return;
      }
      setExecutionId(id);
      setResultAnnounced(false);
      setUploadedImage(null);
      setSearchParams({ execId: id }, { replace: true });
      notify(
        `▶️ **Execution started**\n\nRunning on ${
          res.data?.source === 'local' ? 'the local DAG engine' : 'Mistral'
        }. Live progress is on the right — you can send signals to it from here while it runs.`,
      );
    },
    onError: (error: any) => {
      notify(`❌ ${error?.response?.data?.detail ?? 'Failed to start the workflow.'}`);
    },
  });

  // ── Input-gathering chat turn ──────────────────────────────────────────
  const chatMut = useMutation({
    mutationFn: (msgs: Message[]) =>
      chatApi.completion({ model: 'mistral-large-latest', messages: msgs, temperature: 0.1 }),
    onSuccess: (res) => {
      setIsTyping(false);
      const content: string = res.data?.choices?.[0]?.message?.content ?? '';

      const ready = extractReadyPayload(content);
      if (ready) {
        executeMut.mutate(ready.inputs);
        return;
      }

      const display = stripReadyBlock(content);
      if (display) setMessages((prev) => [...prev, { role: 'assistant', content: display }]);
    },
    onError: () => {
      setIsTyping(false);
      notify('Sorry — I could not reach the model. Please try again.');
    },
  });

  // ── Signals to a running execution ─────────────────────────────────────
  const signalMut = useMutation({
    mutationFn: (payload: Record<string, unknown>) =>
      executionsApi.signal(executionId!, 'user_message', payload),
    onSuccess: (res) => {
      if (!res.data?.delivered) {
        notify(
          `_Signal not delivered — ${res.data?.detail ?? 'the workflow may not declare a `user_message` handler.'}_`,
        );
      }
    },
    onError: (error: any) => {
      notify(`_Signal failed: ${error?.response?.data?.detail ?? 'unknown error'}_`);
    },
  });

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      notify('❌ Please pick a JPEG, PNG, WebP or GIF.');
      return;
    }
    setIsUploading(true);
    try {
      const { data } = await workflowsApi.uploadImage(file);
      setUploadedImage({
        image_base64: data.image_base64,
        image_url: `${API_IMG_BASE}${data.image_url}`,
        image_mime: data.image_mime,
        previewUrl: URL.createObjectURL(file),
      });
    } catch (error: any) {
      notify(`❌ Image upload failed: ${error?.response?.data?.detail ?? 'unknown error'}`);
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleSend = () => {
    const text = input.trim();
    if ((!text && !uploadedImage) || isTyping) return;

    const userMessage: Message = {
      role: 'user',
      content: text || '📸 [image attached]',
      imagePreview: uploadedImage?.previewUrl,
      imageData: uploadedImage ?? undefined,
    };
    const next = [...messages, userMessage];
    setMessages(next);

    const image = uploadedImage;
    setInput('');
    setUploadedImage(null);

    // While a run is in flight, a message is a signal to the workflow rather
    // than another turn of the input-gathering conversation.
    if (live && executionId) {
      const payload: Record<string, unknown> = { message: text };
      if (image) {
        payload.image_base64 = image.image_base64;
        payload.image_url = image.image_url;
        payload.image_mime = image.image_mime;
      }
      signalMut.mutate(payload);
      return;
    }

    setIsTyping(true);
    chatMut.mutate(next);
  };

  const startFreshRun = () => {
    setExecutionId(null);
    setResultAnnounced(false);
    setMessages([]);
    greetedRef.current = false;
    setSearchParams({}, { replace: true });
  };

  const openExecution = (id: string) => {
    setExecutionId(id);
    setResultAnnounced(false);
    setMessages([]);
    greetedRef.current = false;
    setSearchParams({ execId: id }, { replace: true });
  };

  const headerDuration = useMemo(
    () => (detail ? executionDuration(detail, now) : null),
    [detail, now],
  );

  // ── Render ─────────────────────────────────────────────────────────────
  if (wfLoading) {
    return (
      <div className="flex flex-1 items-center justify-center bg-[var(--color-bg-base)]">
        <Loader2 className="h-8 w-8 animate-spin text-indigo-400" />
      </div>
    );
  }

  if (!workflow) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center bg-[var(--color-bg-base)] p-6 text-white">
        <AlertCircle className="mb-4 h-12 w-12 text-red-400" />
        <h2 className="mb-2 text-xl font-semibold">Workflow not found</h2>
        <button onClick={() => navigate('/workflows')} className="btn-secondary rounded-lg px-4 py-2">
          Back to workflows
        </button>
      </div>
    );
  }

  const canSend = (!!input.trim() || !!uploadedImage) && !isTyping && !executeMut.isPending;

  return (
    <div className="flex h-full flex-col overflow-hidden bg-[var(--color-bg-base)] text-white">
      {/* ── Header ─────────────────────────────────────────────────────── */}
      <header className="z-10 flex shrink-0 items-center justify-between gap-3 border-b border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] px-5 py-3 backdrop-blur-md">
        <div className="flex min-w-0 items-center gap-3">
          <button
            onClick={() => navigate('/workflows')}
            className="-ml-2 rounded-xl p-2 text-[var(--color-text-muted)] transition-colors hover:bg-white/5 hover:text-white"
            title="Back to workflows"
          >
            <ArrowLeft size={19} />
          </button>
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-indigo-500 to-purple-600 shadow-lg shadow-indigo-500/20">
            <TerminalSquare size={17} className="text-white" />
          </div>
          <div className="min-w-0">
            <h1 className="truncate text-base font-bold capitalize">
              {String(workflow.name).replace(/_/g, ' ')}
            </h1>
            <p className="truncate text-[11px] text-[var(--color-text-muted)]">
              {workflow.description || 'Workflow execution console'}
            </p>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {detail && (
            <span className="hidden font-mono text-[11px] tabular-nums text-[var(--color-text-muted)] sm:inline">
              {formatDuration(headerDuration)}
            </span>
          )}
          <ExecutionStatusBadge
            status={detail?.status ?? (executionId ? 'PENDING' : undefined)}
          />

          {finished && (
            <button
              onClick={startFreshRun}
              className="flex items-center gap-1.5 rounded-xl border border-[var(--color-border-subtle)] px-3 py-1.5 text-xs font-semibold text-[var(--color-text-secondary)] transition-colors hover:border-indigo-400/40 hover:text-white"
            >
              <RotateCcw size={13} />
              Run again
            </button>
          )}

          <button
            onClick={() => setHistoryOpen(true)}
            className="rounded-xl p-2 text-[var(--color-text-muted)] transition-colors hover:bg-white/5 hover:text-white"
            title="Execution history"
          >
            <HistoryIcon size={17} />
          </button>
          <button
            onClick={() => setSidebarOpen((v) => !v)}
            className="hidden rounded-xl p-2 text-[var(--color-text-muted)] transition-colors hover:bg-white/5 hover:text-white md:block"
            title={sidebarOpen ? 'Hide console' : 'Show console'}
          >
            {sidebarOpen ? <PanelRightClose size={17} /> : <PanelRightOpen size={17} />}
          </button>
        </div>
      </header>

      {/* ── Body ───────────────────────────────────────────────────────── */}
      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
        {/* Chat */}
        <section className="flex min-w-0 flex-1 flex-col">
          <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-6 custom-scrollbar md:px-8">
            <div className="flex flex-col space-y-5">
              {messages.map((message, index) => {
                if (message.role === 'system') return null;
                const isUser = message.role === 'user';
                return (
                  <motion.div
                    key={index}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.22 }}
                    className={cn('flex w-full min-w-0 gap-3', isUser ? 'justify-end' : 'justify-start')}
                  >
                    {!isUser && (
                      <div className="mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)]">
                        <Bot size={14} className="text-indigo-400" />
                      </div>
                    )}
                    <div
                      className={cn(
                        'min-w-0 break-words text-[14px] leading-relaxed shadow-sm',
                        '[&_pre]:whitespace-pre-wrap [&_pre]:break-words [&_code]:break-words',
                        isUser
                          ? 'max-w-[75%] rounded-2xl rounded-tr-md bg-gradient-to-br from-indigo-500 to-indigo-600 px-4 py-3 text-white'
                          : 'max-w-[88%] rounded-2xl rounded-tl-md border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] px-5 py-4',
                      )}
                    >
                      {isUser ? (
                        <>
                          {message.imagePreview && (
                            <img
                              src={message.imagePreview}
                              alt="Attached"
                              className="mb-2 max-h-[180px] max-w-[240px] rounded-xl border border-white/20 object-cover"
                            />
                          )}
                          <span className="whitespace-pre-wrap break-words">{message.content}</span>
                        </>
                      ) : (
                        <div className="prose prose-invert prose-sm max-w-none prose-p:my-1.5 prose-headings:my-2 prose-strong:text-white prose-code:rounded-md prose-code:bg-black/20 prose-code:px-1.5 prose-code:py-0.5 prose-code:text-xs prose-code:text-indigo-300 prose-pre:rounded-xl prose-pre:border prose-pre:border-[var(--color-border-subtle)] prose-pre:bg-black/30">
                          <ReactMarkdown remarkPlugins={[remarkGfm]} components={MARKDOWN_COMPONENTS}>
                            {message.content.replace(/```(?:markdown)?\n([\s\S]*?)```/g, '$1')}
                          </ReactMarkdown>
                        </div>
                      )}
                    </div>
                    {isUser && (
                      <div className="mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 shadow-lg shadow-indigo-500/20">
                        <User size={14} className="text-white" />
                      </div>
                    )}
                  </motion.div>
                );
              })}

              {(isTyping || executeMut.isPending) && (
                <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex gap-3">
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)]">
                    <Bot size={14} className="text-indigo-400" />
                  </div>
                  <div className="flex items-center gap-1.5 rounded-2xl rounded-tl-md border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] px-5 py-4">
                    <span className="h-2 w-2 animate-bounce rounded-full bg-indigo-500" />
                    <span className="h-2 w-2 animate-bounce rounded-full bg-indigo-500" style={{ animationDelay: '0.15s' }} />
                    <span className="h-2 w-2 animate-bounce rounded-full bg-indigo-500" style={{ animationDelay: '0.3s' }} />
                  </div>
                </motion.div>
              )}
            </div>
          </div>

          {/* Composer */}
          <div className="shrink-0 border-t border-[var(--color-border-subtle)] px-4 pb-4 pt-3 md:px-8">
            {live && (
              <div className="mb-3 flex items-center gap-2 rounded-xl border border-blue-500/20 bg-blue-500/10 px-3 py-2 text-xs text-blue-300">
                <Zap size={13} className="shrink-0" />
                <span>The workflow is running — messages are delivered as live signals.</span>
              </div>
            )}

            {uploadedImage && (
              <div className="mb-3 flex items-start gap-2">
                <div className="group relative">
                  <img
                    src={uploadedImage.previewUrl}
                    alt="Upload preview"
                    className="h-20 w-20 rounded-xl border-2 border-indigo-500/40 object-cover"
                  />
                  <button
                    onClick={() => setUploadedImage(null)}
                    className="absolute -right-2 -top-2 flex h-5 w-5 items-center justify-center rounded-full bg-red-500 text-white opacity-0 transition-opacity group-hover:opacity-100"
                  >
                    <XIcon size={10} />
                  </button>
                </div>
                <p className="mt-1 text-xs text-[var(--color-text-muted)]">
                  <span className="font-semibold text-indigo-400">Image attached</span>
                  <br />
                  Sent with your next message.
                </p>
              </div>
            )}

            <div className="flex items-end gap-2">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp,image/gif"
                className="hidden"
                onChange={handleImageUpload}
              />
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={isUploading}
                className="flex h-[50px] w-11 shrink-0 items-center justify-center rounded-xl border border-[var(--color-border-subtle)] text-[var(--color-text-muted)] transition-colors hover:border-indigo-500/30 hover:text-indigo-400 disabled:opacity-40"
                title="Attach an image"
              >
                {isUploading ? <Loader2 size={15} className="animate-spin" /> : <ImagePlus size={15} />}
              </button>

              <div className="relative flex-1">
                <textarea
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      handleSend();
                    }
                  }}
                  onInput={(e) => {
                    const el = e.target as HTMLTextAreaElement;
                    el.style.height = 'auto';
                    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
                  }}
                  rows={1}
                  disabled={isTyping}
                  placeholder={
                    live ? 'Send a signal to the running workflow…'
                      : finished ? 'Ask about the result, or start a new run…'
                        : 'Type your message…'
                  }
                  className="w-full resize-none overflow-y-auto rounded-2xl border border-[var(--color-border-subtle)] bg-black/20 py-3.5 pl-5 pr-14 text-[14px] text-white placeholder:text-[var(--color-text-muted)] transition-colors focus:border-indigo-500/50 focus:outline-none custom-scrollbar"
                  style={{ minHeight: '50px', maxHeight: '200px' }}
                />
                <button
                  onClick={handleSend}
                  disabled={!canSend}
                  className="absolute right-2 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-xl bg-gradient-to-r from-indigo-500 to-indigo-600 text-white shadow-lg shadow-indigo-500/20 transition-all hover:from-indigo-600 hover:to-indigo-700 disabled:opacity-40"
                >
                  {live ? <Play size={15} className="ml-0.5 fill-current" /> : <Send size={15} />}
                </button>
              </div>
            </div>
          </div>
        </section>

        {/* Execution console */}
        <AnimatePresence initial={false}>
          {sidebarOpen && (
            <motion.aside
              initial={{ width: 0, opacity: 0 }}
              animate={{ width: 400, opacity: 1 }}
              exit={{ width: 0, opacity: 0 }}
              transition={{ duration: 0.22, ease: 'easeInOut' }}
              className="hidden min-w-0 flex-col overflow-hidden border-l border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] md:flex"
              style={{ maxWidth: 400 }}
            >
              <div className="w-[400px] flex-1 min-h-0">
                <ExecutionMonitor
                  executionId={executionId}
                  detail={detail}
                  phase={phase}
                  streamError={streamError}
                  workflowEvents={events}
                  logs={logs}
                  onReconnect={reconnect}
                  onNotice={notify}
                />
              </div>
            </motion.aside>
          )}
        </AnimatePresence>
      </div>

      <AnimatePresence>
        {historyOpen && (
          <WorkflowHistoryPanel
            workflowName={workflowName!}
            onClose={() => setHistoryOpen(false)}
            onSelectExecution={openExecution}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
