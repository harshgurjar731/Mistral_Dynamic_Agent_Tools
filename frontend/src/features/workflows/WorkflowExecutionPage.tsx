import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import {
  ArrowLeft, Play, Loader2, CheckCircle2, AlertCircle, Clock, CircleDot,
  MessageSquare, Send, Bot, User, Zap, Server, ChevronDown, ChevronUp, TerminalSquare,
  PanelRightClose, PanelRightOpen, Layers, ArrowDownRight, ArrowUpRight, ImagePlus, X as XIcon,
  GitMerge
} from 'lucide-react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { workflowsApi } from '../../api/workflows';
import { chatApi } from '../../api/chat';
import { cn } from '../../lib/utils';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { QK } from '../../lib/queryClient';

const API_BASE = import.meta.env.VITE_API_URL ?? '';

interface Message {
  role: 'user' | 'assistant' | 'system';
  content: string;
  imagePreview?: string;  // local preview URL for uploaded images
  imageData?: ImageUploadData;
}

interface ImageUploadData {
  image_base64: string;
  image_url: string;
  image_mime: string;
  previewUrl: string;
}

const API_IMG_BASE = import.meta.env.VITE_API_URL ?? '';

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

function stripMarkdownCodeBlock(str: string): string {
  const trimmed = str.trim();
  if (trimmed.startsWith('```markdown') && trimmed.endsWith('```')) {
    return trimmed.slice(11, -3).trim();
  }
  if (trimmed.startsWith('```') && trimmed.endsWith('```')) {
    return trimmed.slice(3, -3).trim();
  }
  return str;
}

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
      return stripMarkdownCodeBlock(title + unescapeNewlines(jsonObj.content));
    }
    if (typeof jsonObj.final_response === 'string') return stripMarkdownCodeBlock(unescapeNewlines(jsonObj.final_response));
    if (typeof jsonObj.result === 'string') return stripMarkdownCodeBlock(unescapeNewlines(jsonObj.result));
    if (typeof jsonObj.final_output === 'string') return stripMarkdownCodeBlock(unescapeNewlines(jsonObj.final_output));
    if (typeof jsonObj.output === 'string') return stripMarkdownCodeBlock(unescapeNewlines(jsonObj.output));
    if (typeof jsonObj.response === 'string') return stripMarkdownCodeBlock(unescapeNewlines(jsonObj.response));

    if ('approved' in jsonObj && jsonObj.reason) {
      const status = jsonObj.approved ? '✅ **Approved**' : '❌ **Rejected**';
      let out = `${status}\n\n**Reason:** ${jsonObj.reason}`;
      if (jsonObj.final_output) out += `\n\n**Output:** ${jsonObj.final_output}`;
      return unescapeNewlines(out);
    }

    const keys = Object.keys(jsonObj).filter(k => k !== 'step_id' && k !== 'status');
    if (keys.length > 0) {
      // If we have a final_response_generation step, prefer it directly
      if (jsonObj.final_response_generation && typeof jsonObj.final_response_generation === 'string') {
        return stripMarkdownCodeBlock(unescapeNewlines(jsonObj.final_response_generation));
      }

      // Find the longest string (most likely the markdown report)
      let longestStr = '';
      for (const k of keys) {
        const val = jsonObj[k];
        if (typeof val === 'string' && val.length > longestStr.length) {
          longestStr = val;
        }
      }

      if (longestStr) {
        return stripMarkdownCodeBlock(unescapeNewlines(longestStr));
      }

      // Only fallback to formatting all keys if we couldn't find a good string
      let formatted = '';
      for (const k of keys) {
        const val = jsonObj[k];
        const readableKey = k.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
        if (typeof val === 'string') {
           formatted += `**${readableKey}:**\n${stripMarkdownCodeBlock(val)}\n\n`;
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

function unescapeNewlines(str: string): string {
  return str.replace(/\\n/g, '\n').replace(/\\t/g, '\t').replace(/\\"/g, '"');
}

function StepDetails({ sr, index, isParallelMember }: { sr: StepResult; index: number; isParallelMember?: boolean }) {
  const [expanded, setExpanded] = useState(true);
  const durationSec = sr.duration_ms ? (sr.duration_ms / 1000).toFixed(1) : null;
  const isParallelGroupStart = sr.step_id.startsWith('__parallel_') && sr.step_id.endsWith(':start');
  const displayName = isParallelGroupStart
    ? sr.step_id.replace('__parallel_', '').replace(':start', '').replace(/_/g, ' ')
    : sr.step_id.replace(/_/g, ' ');
  const isCompleted = sr.status === 'completed';
  const isFailed = sr.status === 'failed';
  const isRunning = !isCompleted && !isFailed;

  // Parallel group start markers get a special treatment
  if (isParallelGroupStart) {
    return (
      <motion.div
        initial={{ opacity: 0, x: -10 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ delay: index * 0.05 }}
        className="relative"
      >
        <div className="absolute -left-[31px] top-1 w-3 h-3 rounded-full border-2 border-[var(--color-bg-surface)] z-10 bg-cyan-500" />
        <div className="rounded-xl border border-cyan-500/30 bg-cyan-500/10 px-4 py-2.5 flex items-center gap-2">
          <GitMerge size={13} className="text-cyan-400 shrink-0" />
          <span className="text-xs font-bold text-cyan-300 uppercase tracking-wider">⚡ Parallel Group: {displayName}</span>
        </div>
      </motion.div>
    );
  }

  const dotColor = isCompleted ? 'bg-emerald-500' : isFailed ? 'bg-red-500' : 'bg-indigo-500 animate-pulse';
  const DotIcon = isCompleted ? CheckCircle2 : isFailed ? AlertCircle : CircleDot;
  const dotIconColor = isCompleted ? 'text-emerald-400' : isFailed ? 'text-red-400' : 'text-indigo-400';

  return (
    <motion.div
      initial={{ opacity: 0, x: -10 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: index * 0.05 }}
      className="relative"
    >
      {/* Timeline dot */}
      <div className={cn(
        'absolute -left-[31px] top-1 w-3 h-3 rounded-full border-2 border-[var(--color-bg-surface)] z-10',
        isParallelMember ? 'ring-2 ring-cyan-500/30' : '',
        dotColor
      )} />

      {/* Step card */}
      <div className={cn(
        'rounded-xl border transition-all duration-200',
        isParallelMember ? 'ml-2 border-l-2 border-l-cyan-500/40' : '',
        isCompleted ? 'bg-emerald-500/5 border-emerald-500/20' :
        isFailed ? 'bg-red-500/5 border-red-500/20' :
        'bg-indigo-500/5 border-indigo-500/20'
      )}>
        {/* Step header */}
        <button
          onClick={() => setExpanded(!expanded)}
          className="w-full flex items-center justify-between px-4 py-3 cursor-pointer group"
        >
          <div className="flex items-center gap-2.5 min-w-0">
            <DotIcon size={14} className={dotIconColor} />
            <span className="text-sm font-semibold text-white capitalize truncate">{displayName}</span>
            {isParallelMember && <Zap size={10} className="text-cyan-400 shrink-0" />}
            {isRunning && <Loader2 size={12} className="text-indigo-400 animate-spin shrink-0" />}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {durationSec && (
              <span className="text-[10px] text-[var(--color-text-muted)] font-mono bg-black/20 px-2 py-0.5 rounded-full">
                {durationSec}s
              </span>
            )}
            {expanded ? <ChevronUp size={14} className="text-[var(--color-text-muted)]" /> : <ChevronDown size={14} className="text-[var(--color-text-muted)]" />}
          </div>
        </button>

        {sr.error && <p className="text-xs text-red-400 font-mono px-4 pb-2 break-words">⚠ {sr.error}</p>}

        <AnimatePresence>
          {expanded && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="overflow-hidden"
            >
              <div className="px-4 pb-4 space-y-3">
                {sr.input_preview && (
                  <div className="bg-black/20 rounded-lg p-3 border border-[var(--color-border-subtle)]">
                    <div className="flex items-center gap-1.5 mb-2">
                      <ArrowDownRight size={11} className="text-blue-400" />
                      <span className="text-[10px] text-blue-400 uppercase tracking-wider font-bold">Input</span>
                    </div>
                    <div className="text-xs text-[var(--color-text-secondary)] whitespace-pre-wrap break-words font-mono leading-relaxed">{sr.input_preview}</div>
                  </div>
                )}
                {sr.output_preview && (
                  <div className="bg-black/20 rounded-lg p-3 border border-emerald-500/10">
                    <div className="flex items-center gap-1.5 mb-2">
                      <ArrowUpRight size={11} className="text-emerald-400" />
                      <span className="text-[10px] text-emerald-400 uppercase tracking-wider font-bold">Output</span>
                    </div>
                    <div className="text-xs text-emerald-300/80 whitespace-pre-wrap break-words font-mono leading-relaxed">{sr.output_preview}</div>
                  </div>
                )}
                {!sr.input_preview && !sr.output_preview && !sr.error && (
                  <p className="text-xs text-[var(--color-text-muted)] italic px-1">No preview data available for this step.</p>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </motion.div>
  );
}

export default function WorkflowExecutionPage() {
  const { workflowName } = useParams();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const urlExecId = searchParams.get('execId');

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
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);
  const streamAbortRef = useRef<AbortController | null>(null);

  // Image upload state
  const [uploadedImage, setUploadedImage] = useState<ImageUploadData | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setMessages(prev => [...prev, { role: 'assistant', content: '❌ Please select a valid image file (JPEG, PNG, WebP, or GIF).' }]);
      return;
    }
    setIsUploading(true);
    try {
      const res = await workflowsApi.uploadImage(file);
      const data = res.data;
      const previewUrl = URL.createObjectURL(file);
      setUploadedImage({
        image_base64: data.image_base64,
        image_url: `${API_IMG_BASE}${data.image_url}`,
        image_mime: data.image_mime,
        previewUrl,
      });
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: `📷 Image uploaded successfully! (${(data.size_bytes / 1024).toFixed(0)}KB)\n\nThe image will be included with your next message or when the workflow executes.`,
      }]);
    } catch (err: any) {
      const errMsg = err?.response?.data?.detail || 'Failed to upload image.';
      setMessages(prev => [...prev, { role: 'assistant', content: `❌ Image upload failed: ${errMsg}` }]);
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

  // Init Requirements
  useEffect(() => {
    if (!workflow || execStatus !== 'INIT' || hasInitialized.current) return;
    hasInitialized.current = true;

    if (urlExecId) {
      setExecutionId(urlExecId);
      const saved = localStorage.getItem(`workflow_chat_${urlExecId}`);
      if (saved) {
        try {
          const parsed = JSON.parse(saved);
          setMessages(parsed.messages || []);
          setExecStartIndex(parsed.execStartIndex ?? -1);
          setExecData(parsed.execData || null);
          setHasAddedResultMsg(parsed.hasAddedResultMsg || false);
          setExecStatus(parsed.execStatus || 'RUNNING');
          
          if (parsed.execStatus === 'RUNNING') {
            startSSEStream(urlExecId);
          }
          return;
        } catch { /* fallback if corrupted */ }
      }
      
      setExecStatus('RUNNING');
      setMessages([
        {
          role: 'assistant',
          content: '⚠️ **Chat history not found**\n\nThe conversational history for this execution is not available in your local storage. You can still view the backend execution timeline and status above.',
        }
      ]);
      startSSEStream(urlExecId);
      return;
    }

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
            [...obj.matchAll(/\{+([^{}]+)\}+/g)].forEach(m => vars.add(m[1].trim()));
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
Ask the user for these inputs clearly.
CRITICAL INSTRUCTION: DO NOT output any JSON while you are still gathering inputs. Only ask conversational questions.
Once you have ALL information, output ONLY a JSON block:
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
    mutationFn: (inputs: Record<string, string>) => {
      // Find the last image uploaded in the chat history
      const lastImgMsg = messages.slice().reverse().find(m => m.imageData);
      const imgData = uploadedImage || lastImgMsg?.imageData;

      // Merge image data into inputs if an image was uploaded
      const mergedInputs = { ...inputs };
      if (imgData) {
        mergedInputs.image_base64 = imgData.image_base64;
        mergedInputs.image_url = imgData.image_url;
        mergedInputs.image_mime = imgData.image_mime;
      }
      return workflowsApi.execute(workflow.name, { input: mergedInputs, wait_for_result: false });
    },
    onSuccess: (res) => {
      const execId = res.data?.execution_id;
      setExecutionId(execId);
      setExecStatus('RUNNING');
      setExecData(null);
      setHasAddedResultMsg(false);
      setUploadedImage(null);
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

  // ── SSE Stream ────────────────────────────────────────────────────────────────
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
      let displayContent = content;
      
      // Always try to intercept __ready JSON payload so users can restart workflows
      // Try to parse as JSON first (if the LLM output raw JSON without markdown)
      try {
        const rawParsed = JSON.parse(content.trim());
        if (rawParsed.__ready && rawParsed.inputs) {
          executeMut.mutate(rawParsed.inputs);
          setIsTyping(false);
          return;
        } else if (rawParsed.__ready === false) {
           displayContent = ''; // If it's pure JSON and false, don't show it
        }
      } catch {
        // If not raw JSON, check for markdown block or raw JSON block embedded in text
        let jsonStr = '';
        const match = content.match(/```(?:json)?\n?([\s\S]*?)\n?```/);
        
        if (match) {
          jsonStr = match[1].trim();
        } else {
          // Fallback: Try to find a JSON block containing "__ready"
          const fallbackMatch = content.match(/(\{[\s\S]*"__ready"[\s\S]*\})/);
          if (fallbackMatch) {
            jsonStr = fallbackMatch[1].trim();
          }
        }
        
        if (jsonStr) {
          try {
            const parsed = JSON.parse(jsonStr);
            if (parsed.__ready && parsed.inputs) {
              executeMut.mutate(parsed.inputs);
              setIsTyping(false);
              return;
            } else if (parsed.__ready === false) {
              // Strip the JSON block from the display content
              if (match) {
                displayContent = displayContent.replace(/```(?:json)?\n?[\s\S]*?\n?```/, '').trim();
              } else {
                displayContent = displayContent.replace(/\{[\s\S]*"__ready"[\s\S]*\}/, '').trim();
              }
            }
          } catch { /* ignore */ }
        }
      }
      
      if (displayContent) {
        setMessages(prev => [...prev, { role: 'assistant', content: displayContent }]);
      }
      setIsTyping(false);
    },
    onError: () => {
      setMessages(prev => [...prev, { role: 'assistant', content: 'Sorry, I encountered an error. Please try again.' }]);
      setIsTyping(false);
    },
  });

  const signalMut = useMutation({
    mutationFn: (payload: any) => workflowsApi.sendSignal(executionId!, 'user_message', payload),
  });

  const handleSend = () => {
    if ((!input.trim() && !uploadedImage) || isTyping) return;
    const userMsg: Message = {
      role: 'user',
      content: input.trim() || '📸 [Image Attached]',
      imagePreview: uploadedImage?.previewUrl,
      imageData: uploadedImage || undefined,
    };
    const newMsgs = [...messages, userMsg];
    setMessages(newMsgs);
    
    const sentInput = input.trim();
    const currentImage = uploadedImage;
    
    setInput('');
    setUploadedImage(null);

    if (execStatus === 'RUNNING') {
      const payload: any = { message: sentInput };
      if (currentImage) {
        payload.image_base64 = currentImage.image_base64;
        payload.image_url = currentImage.image_url;
        payload.image_mime = currentImage.image_mime;
      }
      if (executionId) signalMut.mutate(payload);
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
      <div className="flex items-center justify-between px-6 py-3 border-b border-[var(--color-border-subtle)] bg-gradient-to-r from-[var(--color-bg-surface)] to-[var(--color-bg-surface)]/80 backdrop-blur-md shrink-0 z-10">
        <div className="flex items-center gap-4 min-w-0">
          <button 
            onClick={() => navigate('/workflows')}
            className="p-2 -ml-2 rounded-xl text-[var(--color-text-muted)] hover:text-white hover:bg-white/5 transition-all duration-200"
          >
            <ArrowLeft size={20} />
          </button>
          <div className="min-w-0">
            <h1 className="text-lg font-bold flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center shrink-0 shadow-lg shadow-indigo-500/20">
                <TerminalSquare size={16} className="text-white" />
              </div>
              <span className="truncate">{workflow.name.replace(/_/g, ' ')}</span>
            </h1>
            <p className="text-[11px] text-[var(--color-text-muted)] mt-0.5 truncate max-w-md pl-10">
              {workflow.description || 'Workflow execution workspace'}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className={cn("flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-xs font-semibold uppercase tracking-wider shadow-sm", sc.cls)}>
            {sc.icon} {sc.label}
          </div>
          <button
            onClick={() => setSidebarOpen(!sidebarOpen)}
            className="p-2 rounded-xl text-[var(--color-text-muted)] hover:text-white hover:bg-white/5 transition-all duration-200 hidden md:flex"
            title={sidebarOpen ? 'Hide timeline' : 'Show timeline'}
          >
            {sidebarOpen ? <PanelRightClose size={18} /> : <PanelRightOpen size={18} />}
          </button>
        </div>
      </div>

      {/* Main Content: Split Layout */}
      <div className="flex flex-1 overflow-hidden flex-col md:flex-row">
        
        {/* Left: Chat Interface */}
        <div className="flex-1 flex flex-col min-w-0 bg-[var(--color-bg-base)] relative">
          <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 md:px-8 py-6 custom-scrollbar">
            <div className="w-full flex flex-col space-y-5">
              {messages.map((msg, i) => {
                if (msg.role === 'system') return null;
                const isUser = msg.role === 'user';
                const isResult = !isUser && i >= execStartIndex && execStartIndex > 0 && msg.content.includes('Workflow Execution Complete');
                return (
                  <motion.div
                    key={i}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.25 }}
                    className={cn('flex gap-3 min-w-0 w-full', isUser ? 'justify-end' : 'justify-start')}
                  >
                    {!isUser && (
                      <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-[var(--color-bg-surface)] to-[var(--color-bg-hover)] border border-[var(--color-border-subtle)] flex items-center justify-center shrink-0 mt-1 shadow-sm">
                        <Bot size={14} className="text-indigo-400" />
                      </div>
                    )}
                    <div className={cn(
                      'text-[14px] leading-relaxed shadow-sm min-w-0 w-fit',
                      '[&_pre]:whitespace-pre-wrap [&_pre]:break-words [&_pre]:!overflow-x-hidden [&_code]:break-words [&_*]:min-w-0 break-words',
                      isUser
                        ? 'bg-gradient-to-br from-indigo-500 to-indigo-600 text-white rounded-2xl rounded-tr-md px-4 py-3 max-w-[75%]'
                        : isResult
                        ? 'bg-gradient-to-br from-[var(--color-bg-surface)] to-emerald-500/5 border border-emerald-500/20 rounded-2xl rounded-tl-md px-5 py-4 max-w-[90%]'
                        : 'bg-[var(--color-bg-surface)] border border-[var(--color-border-subtle)] rounded-2xl rounded-tl-md px-5 py-4 max-w-[85%]'
                    )}>
                      {isUser
                        ? <div>
                            {msg.imagePreview && (
                              <img
                                src={msg.imagePreview}
                                alt="Uploaded"
                                className="max-w-[240px] max-h-[180px] rounded-xl mb-2 object-cover border border-white/20"
                              />
                            )}
                            <span className="whitespace-pre-wrap break-words">{msg.content}</span>
                          </div>
                        : <div className="prose prose-invert prose-sm prose-p:my-1.5 prose-pre:my-3 prose-headings:my-2 prose-li:my-0.5 prose-ul:my-1 prose-ol:my-1 max-w-none prose-strong:text-white prose-code:text-indigo-300 prose-code:bg-black/20 prose-code:px-1.5 prose-code:py-0.5 prose-code:rounded-md prose-code:text-xs prose-pre:bg-black/30 prose-pre:border prose-pre:border-[var(--color-border-subtle)] prose-pre:rounded-xl">
                            <ReactMarkdown 
                              remarkPlugins={[remarkGfm]}
                              components={{
                                table: ({node, ...props}) => (
                                  <div className="overflow-x-auto my-6 rounded-xl border border-[var(--color-border-subtle)] bg-black/20 shadow-lg">
                                    <table className="w-full text-sm text-left border-collapse" {...props} />
                                  </div>
                                ),
                                thead: ({node, ...props}) => <thead className="text-xs uppercase bg-black/40 border-b border-[var(--color-border-subtle)] text-indigo-200 tracking-wider" {...props} />,
                                tbody: ({node, ...props}) => <tbody className="divide-y divide-[var(--color-border-subtle)]" {...props} />,
                                tr: ({node, ...props}) => <tr className="hover:bg-white/[0.04] transition-colors" {...props} />,
                                th: ({node, ...props}) => <th className="px-4 py-3.5 font-semibold" {...props} />,
                                td: ({node, ...props}) => <td className="px-4 py-3 align-top leading-relaxed text-[var(--color-text-secondary)]" {...props} />,
                                a: ({node, ...props}) => <a className="text-indigo-400 hover:text-indigo-300 underline underline-offset-2 transition-colors" {...props} />,
                                h1: ({node, ...props}) => <h1 className="text-2xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-indigo-400 to-emerald-400 mt-6 mb-4 pb-2 border-b border-[var(--color-border-subtle)]" {...props} />,
                                h2: ({node, ...props}) => <h2 className="text-xl font-semibold text-indigo-300 mt-6 mb-3 flex items-center gap-2" {...props} />,
                                h3: ({node, ...props}) => <h3 className="text-lg font-medium text-white mt-4 mb-2" {...props} />,
                              }}
                            >
                              {msg.content.replace(/```(?:markdown)?\n([\s\S]*?)```/g, '$1')}
                            </ReactMarkdown>
                          </div>}
                    </div>
                    {isUser && (
                      <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center shrink-0 mt-1 shadow-lg shadow-indigo-500/20">
                        <User size={14} className="text-white" />
                      </div>
                    )}
                  </motion.div>
                );
              })}
              
              {isTyping && (
                <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex gap-3">
                  <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-[var(--color-bg-surface)] to-[var(--color-bg-hover)] border border-[var(--color-border-subtle)] flex items-center justify-center shrink-0">
                    <Bot size={14} className="text-indigo-400" />
                  </div>
                  <div className="px-5 py-4 rounded-2xl bg-[var(--color-bg-surface)] border border-[var(--color-border-subtle)] rounded-tl-md flex items-center gap-1.5 shadow-sm">
                    <span className="w-2 h-2 bg-indigo-500 rounded-full animate-bounce" />
                    <span className="w-2 h-2 bg-indigo-500 rounded-full animate-bounce" style={{ animationDelay: '0.15s' }} />
                    <span className="w-2 h-2 bg-indigo-500 rounded-full animate-bounce" style={{ animationDelay: '0.3s' }} />
                  </div>
                </motion.div>
              )}
            </div>
          </div>

          {/* Input bar */}
          <div className="px-4 md:px-8 pb-4 pt-3 border-t border-[var(--color-border-subtle)] bg-gradient-to-t from-[var(--color-bg-surface)] to-transparent shrink-0">
            <div className="w-full relative">
              {execStatus === 'RUNNING' && (
                <div className="flex items-center gap-2 mb-3 text-xs text-blue-400 bg-blue-500/10 px-3 py-2 rounded-xl border border-blue-500/20">
                  <Zap size={13} className="shrink-0" />
                  <span>Messages will be delivered as runtime signals to the workflow.</span>
                </div>
              )}

              {/* Image preview */}
              {uploadedImage && (
                <div className="mb-3 flex items-start gap-2">
                  <div className="relative group">
                    <img
                      src={uploadedImage.previewUrl}
                      alt="Upload preview"
                      className="w-20 h-20 rounded-xl object-cover border-2 border-indigo-500/40 shadow-lg shadow-indigo-500/10"
                    />
                    <button
                      onClick={() => setUploadedImage(null)}
                      className="absolute -top-2 -right-2 w-5 h-5 bg-red-500 rounded-full flex items-center justify-center text-white shadow-md opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      <XIcon size={10} />
                    </button>
                  </div>
                  <div className="text-xs text-[var(--color-text-muted)] mt-1">
                    <p className="font-semibold text-indigo-400">📷 Image attached</p>
                    <p className="mt-0.5">Will be sent with the workflow</p>
                  </div>
                </div>
              )}

              <div className="relative flex items-center gap-2">
                {/* Hidden file input */}
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp,image/gif"
                  className="hidden"
                  onChange={handleImageUpload}
                />

                {/* Image upload button */}
                <button
                  onClick={() => fileInputRef.current?.click()}
                  disabled={isUploading || execStatus === 'RUNNING'}
                  className="shrink-0 w-10 h-10 rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-bg-base)] hover:bg-[var(--color-bg-hover)] hover:border-indigo-500/30 text-[var(--color-text-muted)] hover:text-indigo-400 flex items-center justify-center transition-all disabled:opacity-40"
                  title="Upload an image"
                >
                  {isUploading
                    ? <Loader2 size={15} className="animate-spin" />
                    : <ImagePlus size={15} />
                  }
                </button>

                <div className="relative flex-1 flex items-center">
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
                      execStatus === 'RUNNING' ? 'Send a signal to the running workflow…' :
                      isTerminal ? 'Ask about the results…' :
                      uploadedImage ? 'Describe the image or add details…' :
                      'Type your message or attach an image…'
                    }
                    className="w-full bg-[var(--color-bg-base)] border border-[var(--color-border-subtle)] rounded-2xl pl-5 pr-14 py-3.5 text-[14px] text-white placeholder:text-[var(--color-text-muted)] focus:outline-none focus:border-indigo-500/50 focus:ring-2 focus:ring-indigo-500/20 transition-all resize-none overflow-y-auto overflow-x-hidden custom-scrollbar"
                    style={{ minHeight: '50px', maxHeight: '200px' }}
                    disabled={isTyping}
                  />
                  <button
                    onClick={handleSend}
                    disabled={!input.trim() || isTyping}
                    className="absolute right-2 top-1/2 -translate-y-1/2 bg-gradient-to-r from-indigo-500 to-indigo-600 hover:from-indigo-600 hover:to-indigo-700 text-white w-10 h-10 rounded-xl flex items-center justify-center disabled:opacity-40 transition-all shadow-lg shadow-indigo-500/20"
                  >
                    {execStatus === 'RUNNING' ? <Play size={15} className="fill-current ml-0.5" /> : <Send size={15} />}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Right: Timeline & Telemetry — Collapsible */}
        <AnimatePresence initial={false}>
          {sidebarOpen && (
            <motion.div
              initial={{ width: 0, opacity: 0 }}
              animate={{ width: 380, opacity: 1 }}
              exit={{ width: 0, opacity: 0 }}
              transition={{ duration: 0.25, ease: 'easeInOut' }}
              className="hidden md:flex flex-col min-w-0 bg-[var(--color-bg-surface)] border-l border-[var(--color-border-subtle)] overflow-hidden"
              style={{ maxWidth: 380 }}
            >
              <div className="px-5 py-3 border-b border-[var(--color-border-subtle)] bg-[var(--color-bg-hover)]/50 shrink-0 flex items-center justify-between">
                <h3 className="font-semibold flex items-center gap-2 text-sm">
                  <Layers size={15} className="text-indigo-400" />
                  Execution Timeline
                </h3>
                {executionId && (
                  <span className="text-[10px] font-mono text-[var(--color-text-muted)] flex items-center gap-1 bg-black/20 px-2 py-0.5 rounded-full border border-[var(--color-border-subtle)]">
                    {execData?.source === 'mistral' ? <Server size={9} className="text-emerald-400" /> : <Zap size={9} className="text-amber-400" />}
                    {executionId.slice(0, 8)}
                  </span>
                )}
              </div>
              
              <div className="flex-1 overflow-y-auto p-5 custom-scrollbar relative">
                {!executionId ? (
                  <div className="absolute inset-0 flex flex-col items-center justify-center text-[var(--color-text-muted)]">
                    <div className="w-16 h-16 rounded-2xl bg-[var(--color-bg-hover)] flex items-center justify-center mb-4">
                      <Clock size={24} className="opacity-30" />
                    </div>
                    <p className="text-sm font-medium opacity-60">Awaiting execution</p>
                    <p className="text-xs opacity-40 mt-1">Timeline appears once the workflow starts</p>
                  </div>
                ) : (
                  <div className="relative border-l-2 border-[var(--color-border-subtle)] ml-3 space-y-4 pl-5 pb-6">
                    {/* Step count summary */}
                    {steps.length > 0 && (
                      <div className="text-[10px] text-[var(--color-text-muted)] uppercase tracking-wider font-bold mb-2 -mt-1">
                        {steps.filter(s => s.status === 'completed').length}/{steps.length} steps completed
                      </div>
                    )}

                    {steps.map((sr, idx) => {
                      // Detect if this step follows a parallel group start marker
                      // Simplified: check if the step_id is NOT a parallel marker and the previous one was
                      const isParallelMember = !sr.step_id.startsWith('__parallel_') && 
                        steps.slice(0, idx).reverse().some(s => {
                          if (s.step_id.startsWith('__parallel_') && s.step_id.endsWith(':start')) return true;
                          if (!s.step_id.startsWith('__parallel_')) return false;
                          return false;
                        });
                      return <StepDetails key={sr.step_id} sr={sr} index={idx} isParallelMember={isParallelMember} />;
                    })}
                    
                    {isRunning && (
                      <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        className="relative"
                      >
                        <div className="absolute -left-[30px] top-1 w-3 h-3 rounded-full bg-indigo-500 border-2 border-[var(--color-bg-surface)] animate-pulse z-10" />
                        <div className="bg-indigo-500/10 border border-indigo-500/20 rounded-xl px-4 py-3 flex items-center gap-2">
                          <Loader2 size={13} className="text-indigo-400 animate-spin shrink-0" />
                          <p className="text-sm font-medium text-indigo-300">
                            {steps.length > 0 ? `Running step ${steps.length + 1}…` : 'Initializing workflow…'}
                          </p>
                        </div>
                      </motion.div>
                    )}
                    
                    {isTerminal && (
                      <motion.div
                        initial={{ opacity: 0, scale: 0.95 }}
                        animate={{ opacity: 1, scale: 1 }}
                        className="relative"
                      >
                        <div className={cn(
                          "absolute -left-[30px] top-1 w-3 h-3 rounded-full border-2 border-[var(--color-bg-surface)] z-10",
                          execStatus === 'COMPLETED' ? 'bg-emerald-500' : 'bg-red-500'
                        )} />
                        <div className={cn(
                          "rounded-xl px-4 py-3 border",
                          execStatus === 'COMPLETED'
                            ? 'bg-emerald-500/10 border-emerald-500/20'
                            : 'bg-red-500/10 border-red-500/20'
                        )}>
                          <p className={cn(
                            "text-sm font-semibold flex items-center gap-2",
                            execStatus === 'COMPLETED' ? 'text-emerald-400' : 'text-red-400'
                          )}>
                            {execStatus === 'COMPLETED' ? <CheckCircle2 size={14} /> : <AlertCircle size={14} />}
                            {execStatus === 'COMPLETED' ? 'Execution Complete' : 'Execution Failed'}
                          </p>
                          {execData?.end_time && execData?.start_time && (
                            <p className="text-[10px] text-[var(--color-text-muted)] mt-1 font-mono">
                              Duration: {((new Date(execData.end_time).getTime() - new Date(execData.start_time).getTime()) / 1000).toFixed(1)}s
                            </p>
                          )}
                        </div>

                        {execStatus === 'COMPLETED' && !!execData?.result && (
                          <div className="mt-4 bg-black border border-emerald-500/30 rounded-xl overflow-hidden backdrop-blur-md shadow-[0_0_15px_rgba(16,185,129,0.1)]">
                            <div className="bg-emerald-500/10 px-4 py-3 border-b border-emerald-500/20 flex items-center gap-2">
                              <CheckCircle2 size={16} className="text-emerald-400" />
                              <h3 className="text-emerald-400 font-semibold text-sm tracking-wide uppercase">Final Output</h3>
                            </div>
                            <div className="p-8 bg-white text-black overflow-x-auto rounded-b-xl">
                              {(() => {
                                let mdContent = '';
                                const raw = execData.result;
                                if (typeof raw === 'string') {
                                  mdContent = raw;
                                } else if (raw && typeof raw === 'object') {
                                  // Extract markdown from workflow steps
                                  const rObj = raw as Record<string, any>;
                                  if (rObj.final_response_generation && typeof rObj.final_response_generation === 'string') {
                                    mdContent = rObj.final_response_generation;
                                  } else {
                                    // Find longest string (usually the report)
                                    let longest = '';
                                    Object.values(rObj).forEach(val => {
                                      if (typeof val === 'string' && val.length > longest.length) {
                                        longest = val;
                                      }
                                    });
                                    mdContent = longest || JSON.stringify(raw, null, 2);
                                  }
                                }

                                mdContent = stripMarkdownCodeBlock(mdContent);

                                return (
                                  <div className="prose prose-sm md:prose-base prose-slate max-w-none prose-headings:font-bold prose-a:text-indigo-600 prose-tables:border-collapse prose-th:bg-gray-100 prose-th:p-2 prose-th:border prose-td:p-2 prose-td:border">
                                    <ReactMarkdown remarkPlugins={[remarkGfm]}>
                                      {mdContent}
                                    </ReactMarkdown>
                                  </div>
                                );
                              })()}
                            </div>
                          </div>
                        )}
                      </motion.div>
                    )}
                  </div>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
        
      </div>
    </div>
  );
}
