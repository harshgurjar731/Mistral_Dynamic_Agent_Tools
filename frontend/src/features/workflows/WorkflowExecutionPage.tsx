import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ArrowLeft, Play, Loader2, CheckCircle2, AlertCircle, Clock, CircleDot,
  MessageSquare, Send, Bot, User, Zap, Server, ChevronDown, ChevronRight, TerminalSquare
} from 'lucide-react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { workflowsApi } from '../../api/workflows';
import { chatApi } from '../../api/chat';
import { cn } from '../../lib/utils';
import ReactMarkdown from 'react-markdown';
import { QK } from '../../lib/queryClient';

const API_BASE = import.meta.env.VITE_API_URL ?? '';

interface Message {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

interface StepResult {
  step_id: string;
  status: string;
  duration_ms?: number;
  error?: string;
  input_preview?: string;
  output_preview?: string;
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

function parseWorkflowResult(raw: string): string {
  const toolCallMatch = raw.match(/\{[\s\S]*\}$/);
  if (toolCallMatch) {
    try {
      const json = JSON.parse(toolCallMatch[0]);
      if (typeof json.content === 'string') {
        const title = json.title ? `# ${json.title}\n\n` : '';
        return title + unescapeNewlines(json.content);
      }
      if (typeof json.result === 'string') return unescapeNewlines(json.result);
      return '```json\n' + JSON.stringify(json, null, 2) + '\n```';
    } catch { /* ignore */ }
  }
  try {
    const json = JSON.parse(raw);
    if (typeof json === 'object' && json !== null) {
      if (typeof json.content === 'string') {
        const title = json.title ? `# ${json.title}\n\n` : '';
        return title + unescapeNewlines(json.content);
      }
      if (typeof json.result === 'string') return unescapeNewlines(json.result);
      return '```json\n' + JSON.stringify(json, null, 2) + '\n```';
    }
  } catch { /* ignore */ }
  return unescapeNewlines(raw);
}

function unescapeNewlines(str: string): string {
  return str.replace(/\\n/g, '\n').replace(/\\t/g, '\t').replace(/\\"/g, '"');
}

function StepDetails({ sr }: { sr: StepResult }) {
  const [expanded, setExpanded] = useState(false);
  const durationSec = sr.duration_ms ? (sr.duration_ms / 1000).toFixed(1) : null;
  const displayName = sr.step_id.replace(/_/g, ' ');

  return (
    <div className="relative">
      <div className="absolute -left-[30px] top-0.5 w-2.5 h-2.5 rounded-full bg-[var(--color-bg-base)] border border-[var(--color-border-subtle)] flex items-center justify-center">
        {sr.status === 'completed'
          ? <CheckCircle2 size={10} className="text-emerald-400 bg-[var(--color-bg-base)] rounded-full" />
          : sr.status === 'failed'
          ? <AlertCircle size={10} className="text-red-400 bg-[var(--color-bg-base)] rounded-full" />
          : <CircleDot size={10} className="text-[#6366f1] animate-pulse bg-[var(--color-bg-base)] rounded-full" />}
      </div>
      <div className="flex flex-col">
        <div 
          className="flex items-center justify-between cursor-pointer group"
          onClick={() => setExpanded(!expanded)}
        >
          <div className="flex items-center gap-2">
            <p className="text-sm font-semibold text-white capitalize">{displayName}</p>
            {expanded ? <ChevronDown size={14} className="text-[var(--color-text-muted)]" /> : <ChevronRight size={14} className="text-[var(--color-text-muted)] opacity-0 group-hover:opacity-100 transition-opacity" />}
          </div>
          {durationSec && (
            <span className="text-[10px] text-[var(--color-text-muted)] font-mono bg-[var(--color-bg-hover)] px-1.5 py-0.5 rounded border border-[var(--color-border-subtle)]">
              {durationSec}s
            </span>
          )}
        </div>
        {sr.error && <p className="text-xs text-red-400 font-mono mt-1 break-words">{sr.error}</p>}
        
        <AnimatePresence>
          {expanded && (
            <motion.div 
              initial={{ height: 0, opacity: 0 }} 
              animate={{ height: 'auto', opacity: 1 }} 
              exit={{ height: 0, opacity: 0 }}
              className="overflow-hidden"
            >
              <div className="mt-2 space-y-3 p-3 bg-black/20 rounded-xl border border-[var(--color-border-subtle)] text-xs font-mono">
                {sr.input_preview && (
                  <div>
                    <span className="text-[var(--color-text-muted)] block mb-1 uppercase tracking-wider text-[10px] font-bold">Query / Input:</span>
                    <div className="text-[var(--color-text-secondary)] whitespace-pre-wrap break-words">{sr.input_preview}</div>
                  </div>
                )}
                {sr.output_preview && (
                  <div>
                    <span className="text-[var(--color-text-muted)] block mb-1 uppercase tracking-wider text-[10px] font-bold mt-2">Output / Result:</span>
                    <div className="text-emerald-400/80 whitespace-pre-wrap break-words">{sr.output_preview}</div>
                  </div>
                )}
                {!sr.input_preview && !sr.output_preview && !sr.error && (
                  <span className="text-[var(--color-text-muted)] italic">No preview data available</span>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

export default function WorkflowExecutionPage() {
  const { workflowName } = useParams();
  const navigate = useNavigate();

  // ── Fetch Workflow Definition ───────────────────────────────────────────
  const { data: wfData, isLoading: wfLoading } = useQuery({
    queryKey: QK.workflow(workflowName!),
    queryFn: () => workflowsApi.get(workflowName!).then(r => r.data),
    enabled: !!workflowName,
  });
  
  const workflow = wfData?.workflow ?? wfData;

  // ── Execution State ──────────────────────────────────────────────────────
  const requiredInputs = useRef<string[]>([]);
  const isInternalVar = (name: string) => /^\{?step_.*_output\}?$/.test(name.trim());
  
  const [execStatus, setExecStatus] = useState<'INIT' | 'GATHERING' | 'RUNNING' | 'COMPLETED' | 'FAILED'>('INIT');
  const [executionId, setExecutionId] = useState<string | null>(null);
  const [execData, setExecData] = useState<ExecutionData | null>(null);
  const [hasAddedResultMsg, setHasAddedResultMsg] = useState(false);
  const hasInitialized = useRef(false);

  // Chat state
  const [messages, setMessages] = useState<Message[]>([]);
  const [execStartIndex, setExecStartIndex] = useState<number>(-1);
  const [input, setInput] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const streamAbortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, isTyping, execData]);

  // Init Requirements
  useEffect(() => {
    if (!workflow || execStatus !== 'INIT' || hasInitialized.current) return;
    hasInitialized.current = true;
    setExecStatus('GATHERING');

    const filteredInputSchema = workflow.input_schema?.filter((f: any) => !isInternalVar(f.name));
    const hasInputSchema = filteredInputSchema && filteredInputSchema.length > 0;

    if (hasInputSchema) {
      requiredInputs.current = filteredInputSchema.map((f: any) => f.name);
    } else {
      const vars = new Set<string>();
      (workflow.steps ?? []).forEach((step: any) => {
        const checkValues = (obj: unknown) => {
          if (typeof obj === 'string') {
            [...obj.matchAll(/\{{1,2}([^}]+)\}{1,2}/g)].forEach(m => vars.add(m[1]));
          } else if (typeof obj === 'object' && obj !== null) {
            Object.values(obj).forEach(checkValues);
          }
        };
        checkValues(step.config);
      });
      Array.from(vars).forEach(v => { if (isInternalVar(v)) vars.delete(v); });
      requiredInputs.current = Array.from(vars);
    }

    if (requiredInputs.current.length > 0) {
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
      const inputList = hasInputSchema
        ? filteredInputSchema.map((f: any) => `- **${f.name}**${f.description ? `: ${f.description}` : ''}`).join('\n')
        : requiredInputs.current.map(v => `- **${v}**`).join('\n');
      const greeting: Message = {
        role: 'assistant',
        content: `Hi! To run **${workflow.name.replace(/_/g, ' ')}**, I need a few details:\n\n${inputList}\n\nWhat would you like to use for these?`,
      };
      setMessages([sysMsg, greeting]);
    } else {
      const displayName = workflow.name.replace(/_/g, ' ');
      const sysMsg: Message = {
        role: 'system',
        content: `You are a conversational assistant for the '${workflow.name}' workflow.
The workflow does not have explicitly defined input variables, but the user should describe what they want.
Ask the user to describe their requirements. Once you have enough context, output ONLY a JSON block:
\`\`\`json
{"__ready": true, "inputs": {"user_input": "the user's description"}}
\`\`\`
Do not output anything else after the JSON.`,
      };
      const greeting: Message = {
        role: 'assistant',
        content: `Hi! To run **${displayName}**, please describe what you'd like.\n\nFor example: your preferences, requirements, or any specific details that would help the workflow produce better results.`,
      };
      setMessages([sysMsg, greeting]);
    }
  }, [workflow, execStatus]);

  // ── Execute Mutation ─────────────────────────────────────────────────────
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

  // ── SSE Stream ───────────────────────────────────────────────────────────
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
        if (finalStatus === 'COMPLETED') setExecStatus('COMPLETED');
        else if (['FAILED', 'TIMED_OUT', 'CANCELLED', 'TERMINATED'].includes(finalStatus)) setExecStatus('FAILED');
      } else if (type === 'error') {
        setExecStatus('FAILED');
        setMessages(prev => [...prev, { role: 'assistant', content: `❌ Stream error: ${rawData}` }]);
      }
    } catch { /* ignore */ }
  };

  useEffect(() => {
    if (!execData || hasAddedResultMsg) return;
    const st = execData.status?.toUpperCase();
    if (st === 'COMPLETED') {
      setExecStatus('COMPLETED');
      setHasAddedResultMsg(true);

      let resultContent: string;
      let rawResultValue = execData.result;
      if (rawResultValue && typeof rawResultValue === 'object' && !Array.isArray(rawResultValue)) {
        const keys = Object.keys(rawResultValue);
        if (keys.length === 1 && keys[0] === 'result') {
          rawResultValue = (rawResultValue as Record<string, unknown>).result;
        }
      }

      if (rawResultValue == null || rawResultValue === '' || (typeof rawResultValue === 'object' && Object.keys(rawResultValue as object).length === 0)) {
        resultContent = '*Workflow completed successfully but did not return output data.*';
      } else {
        const rawStr = typeof rawResultValue === 'string' ? rawResultValue : JSON.stringify(rawResultValue, null, 2);
        resultContent = parseWorkflowResult(rawStr);
      }

      setMessages(prev => [
        ...prev,
        {
          role: 'assistant',
          content: `🎉 **Workflow Execution Complete!**\n\n---\n\n${resultContent}\n\n---\n*Ask me anything about this result.*`,
        },
      ]);
    } else if (['FAILED', 'TIMED_OUT', 'CANCELLED', 'TERMINATED'].includes(st ?? '')) {
      setExecStatus('FAILED');
      setHasAddedResultMsg(true);
      const errorDetail = execData.result && typeof execData.result === 'object'
        ? (execData.result as Record<string, unknown>).error || ''
        : typeof execData.result === 'string' ? execData.result : '';
      setMessages(prev => [
        ...prev,
        { role: 'assistant', content: `❌ Workflow execution **${st?.toLowerCase() ?? 'failed'}**.${errorDetail ? '\n\n> ' + errorDetail : ''}` },
      ]);
    }
  }, [execData?.status, execData?.result, hasAddedResultMsg]);

  useEffect(() => {
    return () => { streamAbortRef.current?.abort(); };
  }, []);

  // ── Chat & Signal Mutations ─────────────────────────────────────────────
  const chatMut = useMutation({
    mutationFn: (msgs: Message[]) => chatApi.completion({ model: 'mistral-large-latest', messages: msgs, temperature: 0.1 }),
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
      }
      setMessages(prev => [...prev, { role: 'assistant', content }]);
      setIsTyping(false);
    },
    onError: () => {
      setMessages(prev => [...prev, { role: 'assistant', content: 'Sorry, I encountered an error. Please try again.' }]);
      setIsTyping(false);
    },
  });

  const signalMut = useMutation({
    mutationFn: (msg: string) => workflowsApi.sendSignal(executionId!, 'user_message', { message: msg }),
  });

  const handleSend = () => {
    if (!input.trim() || isTyping) return;
    const userMsg: Message = { role: 'user', content: input.trim() };
    const newMsgs = [...messages, userMsg];
    setMessages(newMsgs);
    const sentInput = input.trim();
    setInput('');

    if (execStatus === 'RUNNING') {
      if (executionId) signalMut.mutate(sentInput);
      return;
    }

    setIsTyping(true);
    chatMut.mutate(newMsgs);
  };

  // ── Render ──────────────────────────────────────────────────────────────
  if (wfLoading) {
    return (
      <div className="flex-1 flex items-center justify-center p-6 bg-[var(--color-bg-base)] text-white">
        <Loader2 className="w-8 h-8 animate-spin text-[#6366f1]" />
      </div>
    );
  }

  if (!workflow) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-6 bg-[var(--color-bg-base)] text-white">
        <AlertCircle className="w-12 h-12 text-red-400 mb-4" />
        <h2 className="text-xl font-semibold mb-2">Workflow Not Found</h2>
        <button onClick={() => navigate('/workflows')} className="btn-secondary">Back to Dashboard</button>
      </div>
    );
  }

  const isTerminal = ['COMPLETED', 'FAILED'].includes(execStatus);
  const steps = execData?.step_results ?? [];
  const isRunning = execData?.status?.toUpperCase() === 'RUNNING';

  const statusConfig: Record<string, { cls: string; icon: React.ReactNode; label: string }> = {
    GATHERING: { cls: 'text-blue-400 bg-blue-400/10 border-blue-400/20', icon: <MessageSquare size={12} />, label: 'Input Required' },
    RUNNING: { cls: 'text-amber-400 bg-amber-400/10 border-amber-400/20', icon: <Loader2 size={12} className="animate-spin" />, label: 'Running' },
    COMPLETED: { cls: 'text-emerald-400 bg-emerald-400/10 border-emerald-400/20', icon: <CheckCircle2 size={12} />, label: 'Completed' },
    FAILED: { cls: 'text-red-400 bg-red-400/10 border-red-400/20', icon: <AlertCircle size={12} />, label: 'Failed' },
  };
  const sc = statusConfig[execStatus] || { cls: 'text-gray-400 bg-gray-400/10 border-gray-400/20', icon: <CircleDot size={12} />, label: execStatus };

  return (
    <div className="flex flex-col h-full bg-[var(--color-bg-base)] text-white overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] shrink-0 z-10">
        <div className="flex items-center gap-4 min-w-0">
          <button 
            onClick={() => navigate('/workflows')}
            className="p-2 -ml-2 rounded-lg text-[var(--color-text-muted)] hover:text-white hover:bg-[var(--color-bg-hover)] transition-colors"
          >
            <ArrowLeft size={20} />
          </button>
          <div>
            <h1 className="text-xl font-bold flex items-center gap-2">
              <TerminalSquare size={22} className="text-[#6366f1]" />
              <span className="truncate">{workflow.name}</span>
            </h1>
            <p className="text-xs text-[var(--color-text-muted)] mt-0.5 truncate max-w-md">
              {workflow.description || 'Execution workspace'}
            </p>
          </div>
        </div>
        <div className={cn("flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-xs font-semibold uppercase tracking-wider shadow-sm", sc.cls)}>
          {sc.icon} {sc.label}
        </div>
      </div>

      {/* Main Content: Split Layout */}
      <div className="flex flex-1 overflow-hidden flex-col md:flex-row">
        
        {/* Left: Chat Interface */}
        <div className="flex-[3] flex flex-col min-w-0 border-r border-[var(--color-border-subtle)] bg-[var(--color-bg-base)] relative">
          <div ref={scrollRef} className="flex-1 overflow-y-auto p-6 space-y-6 custom-scrollbar">
            {messages.map((msg, i) => {
              if (msg.role === 'system') return null;
              return (
                <div key={i} className={cn('flex gap-3 max-w-[90%]', msg.role === 'user' ? 'ml-auto flex-row-reverse' : '')}>
                  <div className={cn('w-9 h-9 rounded-full flex items-center justify-center shrink-0 mt-1 shadow-sm',
                    msg.role === 'user' ? 'bg-gradient-to-br from-[#6366f1] to-[#4f46e5]' : 'bg-[var(--color-bg-surface)] border border-[var(--color-border-subtle)]')}>
                    {msg.role === 'user' ? <User size={16} className="text-white" /> : <Bot size={16} className="text-[var(--color-text-primary)]" />}
                  </div>
                  <div className={cn('p-4 rounded-2xl text-[15px] leading-relaxed shadow-sm overflow-hidden',
                    msg.role === 'user'
                      ? 'bg-gradient-to-br from-[#6366f1] to-[#4f46e5] text-white rounded-tr-sm'
                      : 'bg-[var(--color-bg-surface)] border border-[var(--color-border-subtle)] rounded-tl-sm text-[var(--color-text-primary)] backdrop-blur-sm bg-opacity-80')}>
                    {msg.role === 'user'
                      ? <span className="whitespace-pre-wrap">{msg.content}</span>
                      : <div className="prose prose-invert prose-sm prose-p:my-1 prose-pre:my-2 prose-headings:my-2 max-w-none prose-a:text-[#818cf8] prose-strong:text-white">
                          <ReactMarkdown>{msg.content}</ReactMarkdown>
                        </div>}
                  </div>
                </div>
              );
            })}
            
            {isTyping && (
              <div className="flex gap-3">
                <div className="w-9 h-9 rounded-full bg-[var(--color-bg-surface)] border border-[var(--color-border-subtle)] flex items-center justify-center shrink-0">
                  <Bot size={16} className="text-[var(--color-text-primary)]" />
                </div>
                <div className="p-4 rounded-2xl bg-[var(--color-bg-surface)] border border-[var(--color-border-subtle)] rounded-tl-sm flex items-center gap-1.5 shadow-sm">
                  <span className="w-2 h-2 bg-[#6366f1] rounded-full animate-bounce" />
                  <span className="w-2 h-2 bg-[#6366f1] rounded-full animate-bounce" style={{ animationDelay: '0.2s' }} />
                  <span className="w-2 h-2 bg-[#6366f1] rounded-full animate-bounce" style={{ animationDelay: '0.4s' }} />
                </div>
              </div>
            )}
          </div>

          <div className="p-4 border-t border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] shrink-0">
            {execStatus === 'RUNNING' && (
              <div className="flex items-center gap-2 mb-3 text-xs text-blue-400 bg-blue-400/10 p-2 rounded-lg border border-blue-400/20">
                <Zap size={14} className="shrink-0" />
                <span>Messages sent now will be delivered as runtime signals to the workflow.</span>
              </div>
            )}
            <div className="relative group">
              <input
                type="text"
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleSend()}
                placeholder={
                  execStatus === 'RUNNING' ? 'Send a signal to the running workflow...' :
                  isTerminal ? 'Ask a question about the results...' :
                  'Type your message here...'
                }
                className="w-full bg-[var(--color-bg-base)] border border-[var(--color-border-subtle)] rounded-xl pl-4 pr-14 py-3.5 text-[15px] text-white placeholder:text-[var(--color-text-muted)] focus:outline-none focus:border-[#6366f1] focus:ring-1 focus:ring-[#6366f1] transition-all shadow-inner"
                disabled={isTyping}
              />
              <button
                onClick={handleSend}
                disabled={!input.trim() || isTyping}
                className="absolute right-2 top-2 bottom-2 bg-[#6366f1] hover:bg-[#4f46e5] text-white px-3 rounded-lg flex items-center justify-center disabled:opacity-50 disabled:hover:bg-[#6366f1] transition-colors shadow-md"
              >
                {execStatus === 'RUNNING' ? <Play size={16} className="fill-current" /> : <Send size={16} />}
              </button>
            </div>
          </div>
        </div>

        {/* Right: Timeline & Telemetry */}
        <div className="flex-[2] flex flex-col min-w-0 bg-[var(--color-bg-surface)] border-l border-[var(--color-border-subtle)]">
          <div className="px-6 py-4 border-b border-[var(--color-border-subtle)] bg-[var(--color-bg-hover)] shrink-0 flex items-center justify-between">
            <h3 className="font-semibold flex items-center gap-2 text-[15px]">
              <Clock size={16} className="text-[#6366f1]" />
              Execution Timeline
            </h3>
            {executionId && (
              <span className="text-xs font-mono text-[var(--color-text-muted)] flex items-center gap-1.5 bg-black/20 px-2 py-1 rounded-md border border-[var(--color-border-subtle)]">
                {execData?.source === 'mistral' ? <Server size={10} className="text-emerald-400" /> : <Zap size={10} className="text-amber-400" />}
                ID: {executionId.slice(0, 8)}
              </span>
            )}
          </div>
          
          <div className="flex-1 overflow-y-auto p-6 custom-scrollbar relative">
            {!executionId ? (
              <div className="absolute inset-0 flex flex-col items-center justify-center text-[var(--color-text-muted)]">
                <CircleDot size={32} className="mb-4 opacity-20" />
                <p className="text-sm">Timeline will appear once execution begins</p>
              </div>
            ) : (
              <div className="relative border-l-2 border-[var(--color-border-subtle)] ml-3 space-y-6 pl-6 pb-8">
                {steps.map((sr) => (
                  <StepDetails key={sr.step_id} sr={sr} />
                ))}
                
                {isRunning && (
                  <div className="relative">
                    <div className="absolute -left-[31px] top-0.5 w-3 h-3 rounded-full bg-[var(--color-bg-base)] border-2 border-[#6366f1] animate-pulse" />
                    <p className="text-sm font-semibold text-[#6366f1] flex items-center gap-2">
                      <Loader2 size={14} className="animate-spin" />
                      {steps.length > 0 ? `Running step ${steps.length + 1}...` : 'Initializing workflow...'}
                    </p>
                  </div>
                )}
                
                {isTerminal && steps.length > 0 && (
                  <div className="relative">
                    <div className="absolute -left-[31px] top-0.5 w-3 h-3 rounded-full bg-[var(--color-bg-base)] border-2 border-emerald-400" />
                    <p className="text-sm font-semibold text-emerald-400">Workflow Execution Finished</p>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
        
      </div>
    </div>
  );
}
