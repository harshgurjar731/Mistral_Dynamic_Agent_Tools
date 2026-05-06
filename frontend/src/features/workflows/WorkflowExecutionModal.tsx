import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  X, Play, Loader2, CheckCircle2, AlertCircle, Clock, CircleDot,
  MessageSquare, Send, Bot, User, ExternalLink, Zap, Server,
} from 'lucide-react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { workflowsApi } from '../../api/workflows';
import { chatApi } from '../../api/chat';
import { cn } from '../../lib/utils';
import ReactMarkdown from 'react-markdown';

const API_BASE = import.meta.env.VITE_API_URL ?? '';

interface WorkflowDef {
  name: string;
  description?: string;
  steps: { id: string; config: Record<string, unknown> }[];
  input_schema?: { name: string; type: string; description?: string }[];
  is_deployed?: boolean;
  le_chat_url?: string;
}

interface Message {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

interface StepResult {
  step_id: string;
  status: string;
  duration_ms?: number;
  error?: string;
}

interface ExecutionData {
  execution_id: string;
  status: string;
  result?: unknown;
  step_results?: StepResult[];
  start_time?: string;
  end_time?: string;
  source?: 'mistral' | 'local';
}

export default function WorkflowExecutionModal({
  workflow,
  executionId: initialExecId,
  onClose,
}: {
  workflow: WorkflowDef;
  executionId?: string;
  onClose: () => void;
}) {
  const qc = useQueryClient();

  // Extract required variables from workflow
  const requiredInputs = useRef<string[]>([]);
  useEffect(() => {
    // Prefer input_schema if available (more reliable than template parsing)
    if (workflow.input_schema && workflow.input_schema.length > 0) {
      requiredInputs.current = workflow.input_schema.map(f => f.name);
      return;
    }
    // Fallback: parse {variable} placeholders from step configs
    const vars = new Set<string>();
    workflow.steps.forEach(step => {
      const checkValues = (obj: unknown) => {
        if (typeof obj === 'string') {
          [...obj.matchAll(/\{([^}]+)\}/g)].forEach(m => vars.add(m[1]));
        } else if (typeof obj === 'object' && obj !== null) {
          Object.values(obj).forEach(checkValues);
        }
      };
      checkValues(step.config);
    });
    // Remove step output vars
    Array.from(vars).forEach(v => {
      if (v.startsWith('step_') && v.endsWith('_output')) vars.delete(v);
    });
    requiredInputs.current = Array.from(vars);
  }, [workflow]);

  const [execStatus, setExecStatus] = useState<'INIT' | 'GATHERING' | 'RUNNING' | 'COMPLETED' | 'FAILED'>(
    initialExecId ? 'RUNNING' : 'INIT'
  );
  const [executionId, setExecutionId] = useState<string | null>(initialExecId ?? null);
  const [execData, setExecData] = useState<ExecutionData | null>(null);
  const [hasAddedResultMsg, setHasAddedResultMsg] = useState(false);

  // Chat state
  const [messages, setMessages] = useState<Message[]>([]);
  const [execStartIndex, setExecStartIndex] = useState<number>(initialExecId ? 0 : -1);
  const [input, setInput] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  // SSE stream ref for cleanup
  const streamAbortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, isTyping, execData]);

  // Init: decide whether to gather inputs or execute immediately
  useEffect(() => {
    if (execStatus !== 'INIT') return;
    if (requiredInputs.current.length === 0) {
      setExecStartIndex(0);
      executeMut.mutate({});
    } else {
      setExecStatus('GATHERING');
      const sysMsg: Message = {
        role: 'system',
        content: `You are a conversational assistant collecting inputs for the '${workflow.name}' workflow.
Required inputs: ${requiredInputs.current.join(', ')}.
Ask the user for these inputs clearly. Once you have ALL information, output ONLY a JSON block:
\`\`\`json
{"__ready": true, "inputs": {"var_name": "value"}}
\`\`\`
Do not output anything else after the JSON.`,
      };
      const greeting: Message = {
        role: 'assistant',
        content: `Hi! To run **${workflow.name.replace(/_/g, ' ')}**, I need a few details:\n\n${
          workflow.input_schema
            ? workflow.input_schema.map(f => `- **${f.name}**${f.description ? `: ${f.description}` : ''}`).join('\n')
            : requiredInputs.current.map(v => `- **${v}**`).join('\n')
        }\n\nWhat would you like to use for these?`,
      };
      setMessages([sysMsg, greeting]);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [execStatus]);

  // ── Execute mutation ────────────────────────────────────────────────────
  const executeMut = useMutation({
    mutationFn: (inputs: Record<string, string>) =>
      workflowsApi.execute(workflow.name, { input: inputs, wait_for_result: false }),
    onSuccess: (res) => {
      const execId = res.data?.execution_id;
      setExecutionId(execId);
      setExecStatus('RUNNING');
      setMessages(prev => {
        setExecStartIndex(prev.length + 1);
        return [
          ...prev,
          {
            role: 'assistant',
            content: `✅ Workflow execution started!\n\n**Execution ID:** \`${execId}\`\n\nTracking progress in real-time…`,
          },
        ];
      });
      if (execId) startSSEStream(execId);
    },
    onError: (err: unknown) => {
      const msg = (err as any)?.response?.data?.detail || 'Failed to start workflow.';
      setExecStatus('FAILED');
      setMessages(prev => [...prev, { role: 'assistant', content: `❌ ${msg}` }]);
    },
  });

  // ── SSE real-time execution stream ──────────────────────────────────────
  const startSSEStream = (execId: string) => {
    if (streamAbortRef.current) streamAbortRef.current.abort();
    const ctrl = new AbortController();
    streamAbortRef.current = ctrl;

    const url = `${API_BASE}${workflowsApi.executionStreamUrl(execId)}`;

    (async () => {
      try {
        const res = await fetch(url, { signal: ctrl.signal });
        if (!res.body) return;
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let eventType = 'message';
        let dataLines: string[] = [];

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() ?? '';

          for (const rawLine of lines) {
            const line = rawLine.replace(/\r$/, '');
            if (line === '') {
              if (dataLines.length > 0) {
                const rawData = dataLines.join('\n');
                handleSSEEvent(eventType, rawData);
                dataLines = [];
              }
              eventType = 'message';
            } else if (line.startsWith('event:')) {
              eventType = line.slice(6).trim();
            } else if (line.startsWith('data:')) {
              dataLines.push(line.startsWith('data: ') ? line.slice(6) : line.slice(5));
            }
          }
        }
      } catch (e: unknown) {
        if ((e as Error).name !== 'AbortError') console.error('SSE stream error', e);
      }
    })();
  };

  const handleSSEEvent = (type: string, rawData: string) => {
    try {
      if (type === 'execution_update') {
        const data: ExecutionData = JSON.parse(rawData);
        setExecData(data);
      } else if (type === 'done') {
        const data = JSON.parse(rawData);
        const finalStatus = (data.status ?? '').toUpperCase();
        if (finalStatus === 'COMPLETED') {
          setExecStatus('COMPLETED');
        } else if (['FAILED', 'TIMED_OUT', 'CANCELLED', 'TERMINATED'].includes(finalStatus)) {
          setExecStatus('FAILED');
        }
      } else if (type === 'error') {
        setExecStatus('FAILED');
        setMessages(prev => [...prev, { role: 'assistant', content: `❌ Stream error: ${rawData}` }]);
      }
    } catch {
      // ignore parse errors
    }
  };

  // Inject result message when execution completes
  useEffect(() => {
    if (!execData || hasAddedResultMsg) return;
    const st = execData.status?.toUpperCase();
    if (st === 'COMPLETED' && execData.result !== undefined) {
      setExecStatus('COMPLETED');
      setHasAddedResultMsg(true);
      const resultStr = typeof execData.result === 'object'
        ? JSON.stringify(execData.result, null, 2)
        : String(execData.result);
      const source = execData.source === 'mistral' ? '🌐 Mistral Server' : '💻 Local Engine';
      setMessages(prev => [
        ...prev,
        {
          role: 'assistant',
          content: `🎉 Workflow completed! *(via ${source})*\n\n\`\`\`json\n${resultStr}\n\`\`\`\n\nDo you have any questions about this result?`,
        },
      ]);
    } else if (['FAILED', 'TIMED_OUT', 'CANCELLED', 'TERMINATED'].includes(st ?? '')) {
      setExecStatus('FAILED');
      setHasAddedResultMsg(true);
      setMessages(prev => [
        ...prev,
        { role: 'assistant', content: `❌ Workflow execution ${st?.toLowerCase() ?? 'failed'}.` },
      ]);
    }
  }, [execData?.status, execData?.result, hasAddedResultMsg]);

  // Cleanup SSE on close
  useEffect(() => {
    return () => { streamAbortRef.current?.abort(); };
  }, []);

  // ── Chat mutation ────────────────────────────────────────────────────────
  const chatMut = useMutation({
    mutationFn: (msgs: Message[]) =>
      chatApi.completion({ model: 'mistral-large-latest', messages: msgs, temperature: 0.1 }),
    onSuccess: (res) => {
      const content = res.data?.choices?.[0]?.message?.content || '';
      if (execStatus === 'GATHERING') {
        const match = content.match(/```json\n([\s\S]*?)\n```/);
        if (match) {
          try {
            const parsed = JSON.parse(match[1]);
            if (parsed.__ready && parsed.inputs) {
              executeMut.mutate(parsed.inputs);
              setIsTyping(false);
              return;
            }
          } catch { /* ignore */ }
        }
        setMessages(prev => [...prev, { role: 'assistant', content }]);
      } else {
        setMessages(prev => [...prev, { role: 'assistant', content }]);
      }
      setIsTyping(false);
    },
    onError: () => {
      setMessages(prev => [...prev, { role: 'assistant', content: 'Sorry, I encountered an error. Please try again.' }]);
      setIsTyping(false);
    },
  });

  // ── Signal mutation ──────────────────────────────────────────────────────
  const signalMut = useMutation({
    mutationFn: (msg: string) =>
      workflowsApi.sendSignal(executionId!, 'user_message', { message: msg }),
  });

  const handleSend = () => {
    if (!input.trim() || isTyping) return;
    const userMsg: Message = { role: 'user', content: input.trim() };
    const newMsgs = [...messages, userMsg];
    setMessages(newMsgs);
    const sentInput = input.trim();
    setInput('');

    if (execStatus === 'RUNNING') {
      // Send signal to running workflow
      if (executionId) signalMut.mutate(sentInput);
      return;
    }

    setIsTyping(true);
    chatMut.mutate(newMsgs);
  };

  // ── Status badge ─────────────────────────────────────────────────────────
  const statusBadge = () => {
    if (!execData) return null;
    const st = execData.status?.toUpperCase();
    const cfg: Record<string, { cls: string; icon: React.ReactNode; label: string }> = {
      RUNNING: { cls: 'text-amber-400 bg-amber-400/10 border-amber-400/20', icon: <Loader2 size={10} className="animate-spin" />, label: 'Running' },
      COMPLETED: { cls: 'text-emerald-400 bg-emerald-400/10 border-emerald-400/20', icon: <CheckCircle2 size={10} />, label: 'Completed' },
      FAILED: { cls: 'text-red-400 bg-red-400/10 border-red-400/20', icon: <AlertCircle size={10} />, label: 'Failed' },
      TIMED_OUT: { cls: 'text-red-400 bg-red-400/10 border-red-400/20', icon: <Clock size={10} />, label: 'Timed Out' },
      CANCELLED: { cls: 'text-[var(--color-text-muted)] bg-[var(--color-bg-hover)] border-[var(--color-border-subtle)]', icon: <CircleDot size={10} />, label: 'Cancelled' },
    };
    const c = cfg[st ?? ''] ?? cfg.RUNNING;
    return (
      <span className={cn('flex items-center gap-1 text-[10px] font-semibold uppercase px-2 py-0.5 rounded-full border', c.cls)}>
        {c.icon} {c.label}
      </span>
    );
  };

  // ── Timeline ─────────────────────────────────────────────────────────────
  const renderTimeline = () => {
    if (!executionId) return null;
    const steps = execData?.step_results ?? [];
    const isRunning = execData?.status?.toUpperCase() === 'RUNNING';
    const isMistral = execData?.source === 'mistral';

    return (
      <div className="flex gap-3 max-w-[90%] my-4">
        <div className="w-8 h-8 rounded-full bg-[var(--color-bg-hover)] border border-[var(--color-border-subtle)] flex items-center justify-center shrink-0 mt-1">
          <Bot size={14} className="text-[var(--color-text-muted)]" />
        </div>
        <div className="surface-card border border-[var(--color-border-subtle)] rounded-tl-sm rounded-2xl p-4 flex-1">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <p className="text-xs text-[var(--color-text-muted)] font-bold uppercase tracking-wider flex items-center gap-1.5">
                {isRunning
                  ? <Loader2 size={11} className="text-[#6366f1] animate-spin" />
                  : <CircleDot size={11} className="text-[var(--color-text-muted)]" />}
                Execution Timeline
              </p>
              {statusBadge()}
            </div>
            <div className="flex items-center gap-2">
              {isMistral
                ? <span className="flex items-center gap-1 text-[9px] text-emerald-400 font-mono"><Server size={9} /> Mistral</span>
                : <span className="flex items-center gap-1 text-[9px] text-[var(--color-text-muted)] font-mono"><Zap size={9} /> Local</span>
              }
              <span className="text-[9px] text-[var(--color-text-muted)] font-mono truncate max-w-[100px]" title={executionId}>{executionId?.slice(0, 12)}…</span>
            </div>
          </div>

          {/* Steps */}
          <div className="relative border-l border-[var(--color-border-subtle)] ml-2 space-y-3 pl-4">
            {steps.map((sr) => (
              <div key={sr.step_id} className="relative">
                <div className="absolute -left-[21px] top-0 w-2.5 h-2.5 rounded-full bg-[var(--color-bg-base)] border border-[var(--color-border-subtle)] flex items-center justify-center">
                  {sr.status === 'completed'
                    ? <CheckCircle2 size={10} className="text-emerald-400 bg-[var(--color-bg-base)] rounded-full" />
                    : sr.status === 'failed'
                    ? <AlertCircle size={10} className="text-red-400 bg-[var(--color-bg-base)] rounded-full" />
                    : <CircleDot size={10} className="text-[#6366f1] animate-pulse bg-[var(--color-bg-base)] rounded-full" />}
                </div>
                <div className="flex items-center justify-between">
                  <p className="text-xs font-semibold text-white font-mono">{sr.step_id}</p>
                  {sr.duration_ms && (
                    <span className="text-[10px] text-[var(--color-text-muted)]">
                      <Clock size={9} className="inline mr-0.5 mb-[1px]" />{Math.round(sr.duration_ms)}ms
                    </span>
                  )}
                </div>
                {sr.error && <p className="text-[10px] text-red-400 font-mono mt-0.5 truncate">{sr.error}</p>}
              </div>
            ))}
            {isRunning && (
              <div className="relative">
                <div className="absolute -left-[21px] top-0 w-2.5 h-2.5 rounded-full bg-[var(--color-bg-base)] border border-[#6366f1] animate-pulse" />
                <p className="text-xs text-[var(--color-text-muted)] italic">Running…</p>
              </div>
            )}
            {steps.length === 0 && !isRunning && (
              <p className="text-xs text-[var(--color-text-muted)] italic">No step data available.</p>
            )}
          </div>
        </div>
      </div>
    );
  };

  const renderMessage = (msg: Message, idx: number) => {
    if (msg.role === 'system') return null;
    return (
      <div key={idx} className={cn('flex gap-3 max-w-[87%]', msg.role === 'user' ? 'ml-auto flex-row-reverse' : '')}>
        <div className={cn('w-8 h-8 rounded-full flex items-center justify-center shrink-0 mt-1',
          msg.role === 'user' ? 'bg-[#6366f1]' : 'bg-[var(--color-bg-hover)] border border-[var(--color-border-subtle)]')}>
          {msg.role === 'user' ? <User size={14} className="text-white" /> : <Bot size={14} className="text-[var(--color-text-muted)]" />}
        </div>
        <div className={cn('p-3 rounded-2xl text-sm',
          msg.role === 'user'
            ? 'bg-[#6366f1] text-white rounded-tr-sm'
            : 'surface-card border border-[var(--color-border-subtle)] rounded-tl-sm text-[var(--color-text-primary)]')}>
          {msg.role === 'user'
            ? <span className="whitespace-pre-wrap">{msg.content}</span>
            : <div className="prose prose-sm prose-invert max-w-none"><ReactMarkdown>{msg.content}</ReactMarkdown></div>}
        </div>
      </div>
    );
  };

  const preExecMsgs = execStartIndex > -1 ? messages.slice(0, execStartIndex) : messages;
  const postExecMsgs = execStartIndex > -1 ? messages.slice(execStartIndex) : [];

  const leChatUrl = workflow.le_chat_url;
  const isTerminal = ['COMPLETED', 'FAILED'].includes(execStatus);

  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm"
    >
      <div className="absolute inset-0" onClick={onClose} />
      <motion.div
        initial={{ scale: 0.95, opacity: 0, y: 20 }}
        animate={{ scale: 1, opacity: 1, y: 0 }}
        exit={{ scale: 0.95, opacity: 0, y: 20 }}
        className="relative z-10 w-full max-w-2xl bg-[var(--color-bg-base)] border border-[var(--color-border-subtle)] rounded-2xl overflow-hidden shadow-2xl flex flex-col h-[85vh]"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] shrink-0">
          <div className="min-w-0 flex-1">
            <h2 className="text-lg font-semibold text-white flex items-center gap-2">
              <MessageSquare size={18} className="text-[#6366f1] shrink-0" />
              <span className="truncate">Conversational Workflow</span>
            </h2>
            <p className="text-xs text-[var(--color-text-muted)] mt-0.5 font-mono truncate">{workflow.name}</p>
          </div>
          <div className="flex items-center gap-2 ml-3 shrink-0">
            {leChatUrl && (
              <a
                href={leChatUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-[rgba(99,102,241,0.15)] text-[#a5b4fc] border border-[rgba(99,102,241,0.3)] hover:bg-[rgba(99,102,241,0.25)] transition-colors"
                title="Open in le Chat"
              >
                <ExternalLink size={12} /> le Chat
              </a>
            )}
            <button onClick={onClose} className="p-2 rounded-lg text-[var(--color-text-muted)] hover:text-white hover:bg-[var(--color-bg-hover)] transition-colors">
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Chat body */}
        <div className="flex-1 overflow-hidden relative flex flex-col">
          <AnimatePresence mode="wait">
            {execStatus === 'INIT' && (
              <motion.div key="init" className="absolute inset-0 flex items-center justify-center">
                <Loader2 size={32} className="animate-spin text-[#6366f1]" />
              </motion.div>
            )}

            {execStatus !== 'INIT' && (
              <motion.div key="chat" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="absolute inset-0 flex flex-col">
                <div ref={scrollRef} className="flex-1 overflow-y-auto p-6 space-y-4 custom-scrollbar">
                  {preExecMsgs.map(renderMessage)}
                  {execStartIndex > -1 && renderTimeline()}
                  {postExecMsgs.map(renderMessage)}

                  {isTyping && (
                    <div className="flex gap-3">
                      <div className="w-8 h-8 rounded-full bg-[var(--color-bg-hover)] border border-[var(--color-border-subtle)] flex items-center justify-center shrink-0">
                        <Bot size={14} className="text-[var(--color-text-muted)]" />
                      </div>
                      <div className="p-3 rounded-2xl surface-card border border-[var(--color-border-subtle)] rounded-tl-sm flex items-center gap-1">
                        <span className="w-1.5 h-1.5 bg-[var(--color-text-muted)] rounded-full animate-bounce" />
                        <span className="w-1.5 h-1.5 bg-[var(--color-text-muted)] rounded-full animate-bounce" style={{ animationDelay: '0.2s' }} />
                        <span className="w-1.5 h-1.5 bg-[var(--color-text-muted)] rounded-full animate-bounce" style={{ animationDelay: '0.4s' }} />
                      </div>
                    </div>
                  )}
                </div>

                {/* Input */}
                <div className="p-4 border-t border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] shrink-0">
                  {execStatus === 'RUNNING' && (
                    <p className="text-[10px] text-[var(--color-text-muted)] mb-2 text-center">
                      Messages sent while running will be delivered as signals to the workflow.
                    </p>
                  )}
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      value={input}
                      onChange={e => setInput(e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && handleSend()}
                      placeholder={
                        execStatus === 'RUNNING'
                          ? 'Send a message to the running workflow…'
                          : isTerminal
                          ? 'Ask a question about the results…'
                          : 'Type your answer…'
                      }
                      className="flex-1 bg-[var(--color-bg-base)] border border-[var(--color-border-subtle)] rounded-xl px-4 py-2.5 text-sm text-white placeholder:text-[var(--color-text-muted)] focus:outline-none focus:border-[#6366f1] transition-colors"
                      disabled={isTyping}
                    />
                    <button
                      onClick={handleSend}
                      disabled={!input.trim() || isTyping}
                      className="btn-primary p-2.5 rounded-xl disabled:opacity-50 shrink-0"
                    >
                      {execStatus === 'RUNNING' ? <Play size={18} className="fill-current" /> : <Send size={18} />}
                    </button>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </motion.div>
    </motion.div>
  );
}
