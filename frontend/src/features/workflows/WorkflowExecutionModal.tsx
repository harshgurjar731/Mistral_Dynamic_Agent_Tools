import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  X, Play, Loader2, CheckCircle2, AlertCircle, Clock, CircleDot,
  MessageSquare, Send, Bot, User, Zap, Server, ImagePlus, X as XIcon,
} from 'lucide-react';
import { useMutation } from '@tanstack/react-query';
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
}

interface Message {
  role: 'user' | 'assistant' | 'system';
  content: string;
  imagePreview?: string;
}

interface ImageUploadData {
  image_base64: string;
  image_url: string;
  image_mime: string;
  previewUrl: string;
}

const API_IMG_BASE_MODAL = import.meta.env.VITE_API_URL ?? '';

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

/**
 * Parse raw workflow result into clean markdown for display.
 * Handles several output formats:
 *   - Tool call text: "function_name {json}" → extracts JSON content
 *   - JSON string with 'content' or 'result' field → extracts that field
 *   - Escaped newlines (\n as literal chars) → converts to real newlines
 *   - Plain text → passes through
 */
function parseWorkflowResult(raw: string): string {
  let jsonObj: any = null;
  const toolCallMatch = raw.match(/\{[\s\S]*\}$/);
  if (toolCallMatch) {
    try { jsonObj = JSON.parse(toolCallMatch[0]); } catch {}
  }
  if (!jsonObj) {
    try { jsonObj = JSON.parse(raw); } catch {}
  }

  if (jsonObj && typeof jsonObj === 'object' && jsonObj !== null) {
    if (typeof jsonObj.content === 'string') {
      const title = jsonObj.title ? `# ${jsonObj.title}\n\n` : '';
      return title + unescapeNewlines(jsonObj.content);
    }
    if (typeof jsonObj.result === 'string') return unescapeNewlines(jsonObj.result);
    if (typeof jsonObj.final_output === 'string') return unescapeNewlines(jsonObj.final_output);
    if (typeof jsonObj.output === 'string') return unescapeNewlines(jsonObj.output);
    if (typeof jsonObj.response === 'string') return unescapeNewlines(jsonObj.response);

    if ('approved' in jsonObj && jsonObj.reason) {
      const status = jsonObj.approved ? '✅ **Approved**' : '❌ **Rejected**';
      let out = `${status}\n\n**Reason:** ${jsonObj.reason}`;
      if (jsonObj.final_output) out += `\n\n**Output:** ${jsonObj.final_output}`;
      return unescapeNewlines(out);
    }

    const keys = Object.keys(jsonObj).filter(k => k !== 'step_id' && k !== 'status');
    if (keys.length > 0) {
      let formatted = '';
      for (const k of keys) {
        const val = jsonObj[k];
        const readableKey = k.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
        if (typeof val === 'string') {
           formatted += `**${readableKey}:**\n${val}\n\n`;
        } else {
           formatted += `**${readableKey}:**\n\`\`\`json\n${JSON.stringify(val, null, 2)}\n\`\`\`\n\n`;
        }
      }
      return unescapeNewlines(formatted.trim());
    }

    return '```json\n' + JSON.stringify(jsonObj, null, 2) + '\n```';
  }

  return unescapeNewlines(raw);
}

/** Convert literal \n sequences (two chars) into real newlines. */
function unescapeNewlines(str: string): string {
  return str
    .replace(/\\n/g, '\n')
    .replace(/\\t/g, '\t')
    .replace(/\\"/g, '"');
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

  // Extract required variables from workflow
  const requiredInputs = useRef<string[]>([]);

  // Helper: detect internal inter-step variable names regardless of brace wrapping
  const isInternalVar = (name: string) =>
    /^\{?step_.*_output\}?$/.test(name.trim());

  // Filter input_schema to exclude internal inter-step variables (step_*_output)
  const filteredInputSchema = workflow.input_schema?.filter(
    f => !isInternalVar(f.name)
  );
  const hasInputSchema = filteredInputSchema && filteredInputSchema.length > 0;
  useEffect(() => {
    // Prefer input_schema if available (more reliable than template parsing)
    if (hasInputSchema) {
      requiredInputs.current = filteredInputSchema!.map(f => f.name);
      return;
    }
    // Fallback: parse {variable} placeholders from step configs
    const vars = new Set<string>();
    workflow.steps.forEach(step => {
      const checkValues = (obj: unknown) => {
        if (typeof obj === 'string') {
          // Match both single {var} and double {{var}} brace patterns
          [...obj.matchAll(/\{{1,2}([^}]+)\}{1,2}/g)].forEach(m => vars.add(m[1]));
        } else if (typeof obj === 'object' && obj !== null) {
          Object.values(obj).forEach(checkValues);
        }
      };
      checkValues(step.config);
    });
    // Remove internal inter-step variables — these are NOT user inputs
    Array.from(vars).forEach(v => {
      if (isInternalVar(v)) vars.delete(v);
    });
    requiredInputs.current = Array.from(vars);
  }, [workflow, hasInputSchema, filteredInputSchema]);

  const [execStatus, setExecStatus] = useState<'INIT' | 'GATHERING' | 'RUNNING' | 'COMPLETED' | 'FAILED'>(
    initialExecId ? 'RUNNING' : 'INIT'
  );
  const [executionId, setExecutionId] = useState<string | null>(initialExecId ?? null);
  const [execData, setExecData] = useState<ExecutionData | null>(null);
  const [hasAddedResultMsg, setHasAddedResultMsg] = useState(false);
  const hasInitialized = useRef(false); // guard against StrictMode double-mount

  // Chat state
  const [messages, setMessages] = useState<Message[]>([]);
  const [execStartIndex, setExecStartIndex] = useState<number>(initialExecId ? 0 : -1);
  const [input, setInput] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  // SSE stream ref for cleanup
  const streamAbortRef = useRef<AbortController | null>(null);

  // Image upload state
  const [uploadedImage, setUploadedImage] = useState<ImageUploadData | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setMessages(prev => [...prev, { role: 'assistant', content: '❌ Please select a valid image file.' }]);
      return;
    }
    setIsUploading(true);
    try {
      const res = await workflowsApi.uploadImage(file);
      const data = res.data;
      const previewUrl = URL.createObjectURL(file);
      setUploadedImage({
        image_base64: data.image_base64,
        image_url: `${API_IMG_BASE_MODAL}${data.image_url}`,
        image_mime: data.image_mime,
        previewUrl,
      });
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: `📷 Image uploaded! (${(data.size_bytes / 1024).toFixed(0)}KB) — it will be included with the workflow execution.`,
      }]);
    } catch (err: any) {
      const errMsg = err?.response?.data?.detail || 'Upload failed.';
      setMessages(prev => [...prev, { role: 'assistant', content: `❌ ${errMsg}` }]);
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, isTyping, execData]);

  // Save state to local storage
  useEffect(() => {
    if (!executionId) return;
    const stateToSave = {
      messages,
      execStartIndex,
      execData,
      hasAddedResultMsg,
      execStatus,
    };
    localStorage.setItem(`workflow_chat_${executionId}`, JSON.stringify(stateToSave));
  }, [messages, execStartIndex, execData, hasAddedResultMsg, execStatus, executionId]);

  // Init: decide whether to gather inputs or execute immediately
  useEffect(() => {
    if (execStatus !== 'INIT') return;
    if (hasInitialized.current) return; // prevent double execution
    hasInitialized.current = true;

    if (initialExecId) {
      setExecutionId(initialExecId);
      const saved = localStorage.getItem(`workflow_chat_${initialExecId}`);
      if (saved) {
        try {
          const parsed = JSON.parse(saved);
          setMessages(parsed.messages || []);
          setExecStartIndex(parsed.execStartIndex ?? -1);
          setExecData(parsed.execData || null);
          setHasAddedResultMsg(parsed.hasAddedResultMsg || false);
          setExecStatus(parsed.execStatus || 'RUNNING');
          
          if (parsed.execStatus === 'RUNNING') {
            startSSEStream(initialExecId);
          }
          return;
        } catch { /* fallback */ }
      }
      
      setExecStatus('RUNNING');
      setMessages([
        {
          role: 'assistant',
          content: '⚠️ **Chat history not found**\n\nThe conversational history for this execution is not available in your local storage. You can still view the backend execution timeline and status above.',
        }
      ]);
      startSSEStream(initialExecId);
      return;
    }

    setExecStatus('GATHERING');

    if (requiredInputs.current.length > 0) {
      // We know exactly what inputs are needed — ask for each one
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
        ? filteredInputSchema!.map(f => `- **${f.name}**${f.description ? `: ${f.description}` : ''}`).join('\n')
        : requiredInputs.current.map(v => `- **${v}**`).join('\n');
      const greeting: Message = {
        role: 'assistant',
        content: `Hi! To run **${workflow.name.replace(/_/g, ' ')}**, I need a few details:\n\n${inputList}\n\nWhat would you like to use for these?`,
      };
      setMessages([sysMsg, greeting]);
    } else {
      // No explicit inputs detected — ask for general context
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
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [execStatus]);

  // ── Execute mutation ────────────────────────────────────────────────────
  const executeMut = useMutation({
    mutationFn: (inputs: Record<string, string>) => {
      const mergedInputs = { ...inputs };
      if (uploadedImage) {
        mergedInputs.image_base64 = uploadedImage.image_base64;
        mergedInputs.image_url = uploadedImage.image_url;
        mergedInputs.image_mime = uploadedImage.image_mime;
      }
      return workflowsApi.execute(workflow.name, { input: mergedInputs, wait_for_result: false });
    },
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
  function startSSEStream(execId: string) {
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
    if (st === 'COMPLETED') {
      setExecStatus('COMPLETED');
      setHasAddedResultMsg(true);

      const source = execData.source === 'mistral' ? '🌐 Mistral Server' : '💻 Local Engine';
      const stepsCompleted = execData.step_results?.length ?? 0;

      // Calculate duration
      let durationStr = '';
      if (execData.start_time && execData.end_time) {
        const ms = new Date(execData.end_time).getTime() - new Date(execData.start_time).getTime();
        const sec = Math.round(ms / 1000);
        durationStr = sec > 60 ? `${Math.floor(sec / 60)}m ${sec % 60}s` : `${sec}s`;
      }

      // ── Smart result parser ─────────────────────────────────────────
      let resultContent: string;
      let rawResultValue = execData.result;

      // Unwrap {'result': X} envelope if backend didn't
      if (rawResultValue && typeof rawResultValue === 'object' && !Array.isArray(rawResultValue)) {
        const keys = Object.keys(rawResultValue);
        if (keys.length === 1 && keys[0] === 'result') {
          rawResultValue = (rawResultValue as Record<string, unknown>).result;
        }
      }

      if (rawResultValue == null || rawResultValue === '' || (typeof rawResultValue === 'object' && Object.keys(rawResultValue as object).length === 0)) {
        resultContent = '*Workflow completed successfully but did not return output data.*';
      } else {
        const rawStr = typeof rawResultValue === 'string'
          ? rawResultValue
          : typeof rawResultValue === 'object'
          ? JSON.stringify(rawResultValue, null, 2)
          : String(rawResultValue);
        resultContent = parseWorkflowResult(rawStr);
      }

      const header = `🎉 **Workflow completed!**\n\n` +
        `| | |\n|---|---|\n` +
        `| **Source** | ${source} |\n` +
        `| **Steps** | ${stepsCompleted} completed |\n` +
        (durationStr ? `| **Duration** | ${durationStr} |\n` : '') +
        `\n---\n\n`;

      setMessages(prev => [
        ...prev,
        {
          role: 'assistant',
          content: header + resultContent + '\n\n---\n*Ask me anything about this result.*',
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
    const userMsg: Message = {
      role: 'user',
      content: input.trim(),
      imagePreview: uploadedImage?.previewUrl,
    };
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
            {steps.map((sr) => {
              const durationSec = sr.duration_ms ? (sr.duration_ms / 1000).toFixed(1) : null;
              const displayName = sr.step_id.replace(/_/g, ' ');
              return (
                <div key={sr.step_id} className="relative">
                  <div className="absolute -left-[21px] top-0 w-2.5 h-2.5 rounded-full bg-[var(--color-bg-base)] border border-[var(--color-border-subtle)] flex items-center justify-center">
                    {sr.status === 'completed'
                      ? <CheckCircle2 size={10} className="text-emerald-400 bg-[var(--color-bg-base)] rounded-full" />
                      : sr.status === 'failed'
                      ? <AlertCircle size={10} className="text-red-400 bg-[var(--color-bg-base)] rounded-full" />
                      : <CircleDot size={10} className="text-[#6366f1] animate-pulse bg-[var(--color-bg-base)] rounded-full" />}
                  </div>
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-semibold text-white capitalize">{displayName}</p>
                    {durationSec && (
                      <span className="text-[10px] text-[var(--color-text-muted)]">
                        <Clock size={9} className="inline mr-0.5 mb-[1px]" />{durationSec}s
                      </span>
                    )}
                  </div>
                  {sr.error && <p className="text-[10px] text-red-400 font-mono mt-0.5 truncate">{sr.error}</p>}
                </div>
              );
            })}
            {isRunning && (
              <div className="relative">
                <div className="absolute -left-[21px] top-0 w-2.5 h-2.5 rounded-full bg-[var(--color-bg-base)] border border-[#6366f1] animate-pulse" />
                <p className="text-xs text-[var(--color-text-muted)] italic flex items-center gap-1.5">
                  <Loader2 size={10} className="animate-spin text-[#6366f1]" />
                  {steps.length > 0
                    ? `Step ${steps.length + 1} running…`
                    : 'Starting…'
                  }
                </p>
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
      <div key={idx} className={cn('flex gap-3 min-w-0 w-full', msg.role === 'user' ? 'justify-end' : 'justify-start')}>
        <div className={cn('w-8 h-8 rounded-full flex items-center justify-center shrink-0 mt-1',
          msg.role === 'user' ? 'bg-[#6366f1]' : 'bg-[var(--color-bg-hover)] border border-[var(--color-border-subtle)]')}>
          {msg.role === 'user' ? <User size={14} className="text-white" /> : <Bot size={14} className="text-[var(--color-text-muted)]" />}
        </div>
        <div className={cn('p-3 rounded-2xl text-sm min-w-0 w-fit',
          '[&_pre]:whitespace-pre-wrap [&_pre]:break-words [&_pre]:!overflow-x-hidden [&_code]:break-words [&_*]:min-w-0 break-words',
          msg.role === 'user'
            ? 'bg-[#6366f1] text-white rounded-tr-sm max-w-[85%]'
            : 'surface-card border border-[var(--color-border-subtle)] rounded-tl-sm text-[var(--color-text-primary)] max-w-[90%]')}>
          {msg.role === 'user'
            ? <div>
                {msg.imagePreview && (
                  <img src={msg.imagePreview} alt="Uploaded" className="max-w-[200px] max-h-[150px] rounded-lg mb-2 object-cover border border-white/20" />
                )}
                <span className="whitespace-pre-wrap break-words">{msg.content}</span>
              </div>
            : <div className="prose prose-sm prose-invert max-w-none"><ReactMarkdown>{msg.content}</ReactMarkdown></div>}
        </div>
      </div>
    );
  };

  const preExecMsgs = execStartIndex > -1 ? messages.slice(0, execStartIndex) : messages;
  const postExecMsgs = execStartIndex > -1 ? messages.slice(execStartIndex) : [];

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

                  {/* Image preview */}
                  {uploadedImage && (
                    <div className="mb-2 flex items-center gap-2">
                      <div className="relative group">
                        <img src={uploadedImage.previewUrl} alt="Preview" className="w-14 h-14 rounded-lg object-cover border border-indigo-500/40" />
                        <button onClick={() => setUploadedImage(null)} className="absolute -top-1 -right-1 w-4 h-4 bg-red-500 rounded-full flex items-center justify-center text-white opacity-0 group-hover:opacity-100 transition-opacity">
                          <XIcon size={8} />
                        </button>
                      </div>
                      <span className="text-[10px] text-indigo-400 font-semibold">📷 Attached</span>
                    </div>
                  )}

                  <div className="flex items-center gap-2">
                    {/* Hidden file input */}
                    <input ref={fileInputRef} type="file" accept="image/jpeg,image/png,image/webp,image/gif" className="hidden" onChange={handleImageUpload} />

                    {/* Image upload button */}
                    <button
                      onClick={() => fileInputRef.current?.click()}
                      disabled={isUploading || execStatus === 'RUNNING'}
                      className="p-2.5 rounded-xl border border-[var(--color-border-subtle)] text-[var(--color-text-muted)] hover:text-indigo-400 hover:border-indigo-500/30 transition-all disabled:opacity-40"
                      title="Upload image"
                    >
                      {isUploading ? <Loader2 size={16} className="animate-spin" /> : <ImagePlus size={16} />}
                    </button>

                    <textarea
                      value={input}
                      onChange={e => setInput(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === 'Enter' && !e.shiftKey) {
                          e.preventDefault();
                          handleSend();
                        }
                      }}
                      onInput={e => {
                        const target = e.target as HTMLTextAreaElement;
                        target.style.height = 'auto';
                        target.style.height = `${Math.min(target.scrollHeight, 200)}px`;
                      }}
                      rows={1}
                      placeholder={
                        execStatus === 'RUNNING'
                          ? 'Send a message to the running workflow…'
                          : isTerminal
                          ? 'Ask a question about the results…'
                          : uploadedImage
                          ? 'Describe the image or add details…'
                          : 'Type your answer or attach an image…'
                      }
                      className="flex-1 bg-[var(--color-bg-base)] border border-[var(--color-border-subtle)] rounded-xl px-4 py-2.5 text-sm text-white placeholder:text-[var(--color-text-muted)] focus:outline-none focus:border-[#6366f1] transition-colors resize-none overflow-y-auto overflow-x-hidden custom-scrollbar"
                      style={{ minHeight: '42px', maxHeight: '200px' }}
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
