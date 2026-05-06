import { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  GitBranch, ArrowRight, CheckCircle2, AlertCircle,
  RefreshCw, Wrench, Cpu, Sparkles, CircleDot,
  Code2, Server, MessageSquare, ExternalLink,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { workflowPlannerApi, type PlannerEvent } from '../../api/workflowPlanner';
import { cn } from '../../lib/utils';

/* ── Timeline Step Types ──────────────────────────────────────────────── */
interface TimelineStep {
  id: string;
  type: 'status' | 'requirements' | 'tool_synthesised' | 'agent_created' | 'workflow_ready'
      | 'compiled' | 'registered' | 'le_chat_published' | 'error';
  content: string | Record<string, unknown>;
  status: 'pending' | 'active' | 'completed';
}

/* ── Sub-cards ────────────────────────────────────────────────────────── */

function RequirementsCard({ data }: { data: Record<string, unknown> }) {
  const tools = (data.tools_needed as string[]) ?? [];
  const agents = (data.agents_needed as string[]) ?? [];
  return (
    <div className="surface-card rounded-xl p-5 mt-2 border border-[rgba(99,102,241,0.15)]">
      <p className="text-xs font-semibold uppercase tracking-wider text-[var(--color-text-muted)] mb-3">
        Workflow Requirements
      </p>
      {data.description && (
        <p className="text-sm text-[var(--color-text-secondary)] mb-4 italic">
          "{data.description as string}"
        </p>
      )}
      <div className="grid grid-cols-2 gap-4">
        <div>
          <p className="text-[10px] uppercase tracking-wider text-[var(--color-text-muted)] mb-2 font-medium flex items-center gap-1">
            <Wrench size={10} /> Tools ({tools.length})
          </p>
          <div className="flex flex-wrap gap-1.5">
            {tools.map(t => (
              <span key={t} className="px-2 py-0.5 rounded bg-[rgba(236,72,153,0.1)] border border-[rgba(236,72,153,0.2)] text-[11px] font-mono text-[#f9a8d4]">{t}</span>
            ))}
            {tools.length === 0 && <span className="text-xs text-[var(--color-text-muted)]">None needed</span>}
          </div>
        </div>
        <div>
          <p className="text-[10px] uppercase tracking-wider text-[var(--color-text-muted)] mb-2 font-medium flex items-center gap-1">
            <Cpu size={10} /> Agents ({agents.length})
          </p>
          <div className="flex flex-wrap gap-1.5">
            {agents.map(a => (
              <span key={a} className="px-2 py-0.5 rounded bg-[rgba(99,102,241,0.1)] border border-[rgba(99,102,241,0.2)] text-[11px] font-mono text-[#a5b4fc]">{a}</span>
            ))}
            {agents.length === 0 && <span className="text-xs text-[var(--color-text-muted)]">None needed</span>}
          </div>
        </div>
      </div>
    </div>
  );
}

function ToolCard({ data }: { data: Record<string, unknown> }) {
  const status = data.status as string;
  const colors: Record<string, string> = {
    synthesized: 'text-[var(--color-accent-success)] bg-[rgba(34,197,94,0.1)] border-[rgba(34,197,94,0.2)]',
    approved: 'text-[var(--color-accent-success)] bg-[rgba(34,197,94,0.1)] border-[rgba(34,197,94,0.2)]',
    exists: 'text-[var(--color-text-muted)] bg-[var(--color-bg-hover)] border-[var(--color-border-subtle)]',
    failed: 'text-[var(--color-accent-danger)] bg-[rgba(239,68,68,0.1)] border-[rgba(239,68,68,0.2)]',
    pending_approval: 'text-[var(--color-accent-warning)] bg-[rgba(245,158,11,0.1)] border-[rgba(245,158,11,0.2)]',
  };
  return (
    <div className="flex items-center justify-between surface-card rounded-lg px-4 py-2.5 mt-2">
      <div className="flex items-center gap-2.5">
        <Wrench size={14} className="text-[var(--color-text-muted)]" />
        <span className="text-sm font-mono text-[var(--color-text-primary)]">{data.tool_name as string}</span>
      </div>
      <span className={cn('text-[10px] font-medium uppercase px-2 py-0.5 rounded border', colors[status] ?? colors.failed)}>
        {status === 'exists' ? 'Already exists' : status}
      </span>
    </div>
  );
}

function AgentCard({ data }: { data: Record<string, unknown> }) {
  const tools = (data.tools as string[]) ?? [];
  if (data.error) {
    return (
      <div className="surface-card rounded-xl p-4 mt-2 border border-[rgba(239,68,68,0.2)]">
        <p className="text-sm font-medium text-[var(--color-accent-danger)]">{data.agent_name as string} — failed</p>
        <p className="text-xs text-[var(--color-text-muted)] font-mono mt-1">{data.error as string}</p>
      </div>
    );
  }
  return (
    <div className="surface-card rounded-xl p-5 mt-2 border border-[rgba(99,102,241,0.15)]">
      <div className="flex items-center gap-3 mb-3">
        <div className="w-9 h-9 rounded-lg bg-[rgba(99,102,241,0.15)] border border-[rgba(99,102,241,0.25)] flex items-center justify-center">
          <Cpu size={16} className="text-[#a5b4fc]" />
        </div>
        <div>
          <p className="text-sm font-semibold text-white">{data.agent_name as string}</p>
          <p className="text-[10px] font-mono text-[var(--color-text-muted)]">{data.model as string}</p>
        </div>
        <span className="ml-auto text-[10px] bg-[rgba(34,197,94,0.1)] text-[var(--color-accent-success)] border border-[rgba(34,197,94,0.2)] px-2 py-0.5 rounded-full uppercase font-medium">Created</span>
      </div>
      {tools.length > 0 && (
        <div>
          <p className="text-[10px] uppercase tracking-wider text-[var(--color-text-muted)] mb-1.5 font-medium">Equipped Tools</p>
          <div className="flex flex-wrap gap-1.5">
            {tools.map(t => (
              <span key={t} className="px-2 py-0.5 rounded bg-[rgba(236,72,153,0.08)] border border-[rgba(236,72,153,0.15)] text-[11px] font-mono text-[#f9a8d4]">{t}</span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function WorkflowReadyCard({ data }: { data: Record<string, unknown> }) {
  return (
    <div className="surface-card rounded-xl p-5 mt-2 border border-[rgba(99,102,241,0.3)] bg-[rgba(99,102,241,0.05)]">
      <div className="flex items-center gap-3 mb-3">
        <div className="w-9 h-9 rounded-lg bg-[rgba(99,102,241,0.2)] flex items-center justify-center">
          <GitBranch size={16} className="text-[#a5b4fc]" />
        </div>
        <div>
          <p className="text-sm font-bold text-white font-mono">{data.workflow_name as string}</p>
          <p className="text-xs text-[var(--color-text-muted)]">{data.description as string}</p>
        </div>
      </div>
      <div className="flex gap-4 text-xs text-[var(--color-text-muted)]">
        <span><strong className="text-white">{data.step_count as number}</strong> steps</span>
        <span><strong className="text-white">{(data.agents as string[])?.length ?? 0}</strong> agents</span>
        <span>Entry: <strong className="text-white font-mono">{data.entry_step as string}</strong></span>
      </div>
    </div>
  );
}

function CompiledCard({ data }: { data: Record<string, unknown> }) {
  if (data.error) {
    return (
      <div className="surface-card rounded-xl p-4 mt-2 border border-[rgba(239,68,68,0.2)]">
        <p className="text-xs text-red-400 font-mono">{data.error as string}</p>
      </div>
    );
  }
  return (
    <div className="surface-card rounded-xl p-4 mt-2 border border-[rgba(99,102,241,0.15)] flex items-center gap-3">
      <div className="w-8 h-8 rounded-lg bg-[rgba(99,102,241,0.15)] flex items-center justify-center shrink-0">
        <Code2 size={14} className="text-[#a5b4fc]" />
      </div>
      <div className="min-w-0">
        <p className="text-xs font-semibold text-white">Compiled to Mistral Workflows SDK</p>
        <p className="text-[10px] text-[var(--color-text-muted)] font-mono truncate mt-0.5">{data.file_path as string}</p>
      </div>
      <span className="ml-auto text-[10px] bg-emerald-400/10 text-emerald-400 border border-emerald-400/20 px-2 py-0.5 rounded-full uppercase font-medium shrink-0">Done</span>
    </div>
  );
}

function RegisteredCard({ data }: { data: Record<string, unknown> }) {
  if (data.error) {
    return (
      <div className="surface-card rounded-xl p-4 mt-2 border border-[rgba(245,158,11,0.2)] bg-amber-400/5">
        <div className="flex items-center gap-2">
          <Server size={12} className="text-amber-400 shrink-0" />
          <p className="text-xs text-amber-400 font-medium">Registration pending</p>
        </div>
        <p className="text-[10px] text-[var(--color-text-muted)] mt-1">{data.error as string}</p>
      </div>
    );
  }
  return (
    <div className="surface-card rounded-xl p-4 mt-2 border border-emerald-400/20 bg-emerald-400/5 flex items-center gap-3">
      <div className="w-8 h-8 rounded-lg bg-emerald-400/10 flex items-center justify-center shrink-0">
        <Server size={14} className="text-emerald-400" />
      </div>
      <div className="min-w-0">
        <p className="text-xs font-semibold text-white">Registered on Mistral Server</p>
        {data.mistral_workflow_id && (
          <p className="text-[10px] text-emerald-400 font-mono truncate mt-0.5">ID: {data.mistral_workflow_id as string}</p>
        )}
      </div>
      <span className="ml-auto text-[10px] bg-emerald-400/10 text-emerald-400 border border-emerald-400/20 px-2 py-0.5 rounded-full uppercase font-medium shrink-0">Live</span>
    </div>
  );
}

function LeChatCard({ data }: { data: Record<string, unknown> }) {
  if (data.error) {
    return (
      <div className="surface-card rounded-xl p-4 mt-2 border border-[rgba(239,68,68,0.2)]">
        <p className="text-xs text-[var(--color-text-muted)]">le Chat publish failed: {data.error as string}</p>
      </div>
    );
  }
  const url = data.le_chat_url as string;
  return (
    <div className="surface-card rounded-xl p-4 mt-2 border border-[rgba(99,102,241,0.3)] bg-[rgba(99,102,241,0.06)] flex items-center gap-3">
      <div className="w-8 h-8 rounded-lg bg-[rgba(99,102,241,0.15)] flex items-center justify-center shrink-0">
        <MessageSquare size={14} className="text-[#a5b4fc]" />
      </div>
      <div className="min-w-0">
        <p className="text-xs font-semibold text-white">Published to le Chat</p>
        <p className="text-[10px] text-[var(--color-text-muted)] font-mono truncate mt-0.5">Agent: {data.agent_id as string}</p>
      </div>
      {url && (
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="ml-auto flex items-center gap-1 text-[10px] bg-[rgba(99,102,241,0.2)] text-[#a5b4fc] border border-[rgba(99,102,241,0.3)] px-2.5 py-1.5 rounded-lg hover:bg-[rgba(99,102,241,0.3)] transition-colors shrink-0"
        >
          <ExternalLink size={10} /> Open
        </a>
      )}
    </div>
  );
}

/* ── Main Component ───────────────────────────────────────────────────── */

export default function WorkflowPlanner() {
  const [input, setInput] = useState('');
  const [isPlanning, setIsPlanning] = useState(false);
  const [steps, setSteps] = useState<TimelineStep[]>([]);
  const [workflowName, setWorkflowName] = useState<string | null>(null);
  const [leChatUrl, setLeChatUrl] = useState<string | null>(null);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<(() => void) | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 120)}px`;
    }
  }, [input]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [steps]);

  const addStep = (type: TimelineStep['type'], content: string | Record<string, unknown>, status: TimelineStep['status'] = 'completed') => {
    setSteps(prev => {
      const updated = [...prev];
      if (updated.length > 0 && updated[updated.length - 1].status === 'active') {
        updated[updated.length - 1].status = 'completed';
      }
      updated.push({ id: crypto.randomUUID(), type, content, status });
      return updated;
    });
  };

  const handleSubmit = () => {
    const goal = input.trim();
    if (!goal || isPlanning) return;

    setIsPlanning(true);
    setSteps([]);
    setWorkflowName(null);

    const cancel = workflowPlannerApi.plan(
      goal,
      (event: PlannerEvent) => {
        if (event.type === 'status') {
          addStep('status', event.data, 'active');
        } else if (event.type === 'requirements') {
          try { addStep('requirements', JSON.parse(event.data)); } catch { /* ignore */ }
        } else if (event.type === 'tool_synthesised') {
          try { addStep('tool_synthesised', JSON.parse(event.data)); } catch { /* ignore */ }
        } else if (event.type === 'agent_created') {
          try { addStep('agent_created', JSON.parse(event.data)); } catch { /* ignore */ }
        } else if (event.type === 'workflow_ready') {
          try {
            const data = JSON.parse(event.data);
            addStep('workflow_ready', data);
            setWorkflowName(data.workflow_name);
          } catch { /* ignore */ }
        } else if (event.type === 'compiled') {
          try { addStep('compiled', JSON.parse(event.data)); } catch { /* ignore */ }
        } else if (event.type === 'registered') {
          try { addStep('registered', JSON.parse(event.data)); } catch { /* ignore */ }
        } else if (event.type === 'le_chat_published') {
          try {
            const data = JSON.parse(event.data);
            addStep('le_chat_published', data);
            if (data.le_chat_url) setLeChatUrl(data.le_chat_url);
          } catch { /* ignore */ }
        } else if (event.type === 'error') {
          addStep('error', event.data);
        } else if (event.type === 'done') {
          try {
            const data = JSON.parse(event.data);
            if (data.workflow_name) setWorkflowName(data.workflow_name);
            if (data.le_chat_url) setLeChatUrl(data.le_chat_url);
          } catch { /* ignore */ }
        }
      },
      () => {
        setIsPlanning(false);
        setSteps(prev => {
          const updated = [...prev];
          if (updated.length > 0 && updated[updated.length - 1].status === 'active') {
            updated[updated.length - 1].status = 'completed';
          }
          return updated;
        });
      },
    );
    cancelRef.current = cancel;
  };

  const renderStepContent = (step: TimelineStep) => {
    if (step.type === 'status') {
      return (
        <span className={cn('text-sm font-medium', step.status === 'active' ? 'text-white' : 'text-[var(--color-text-muted)]')}>
          {step.content as string}
          {step.status === 'active' && <span className="ml-2 inline-block w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin align-middle" />}
        </span>
      );
    }
    if (step.type === 'requirements') return <RequirementsCard data={step.content as Record<string, unknown>} />;
    if (step.type === 'tool_synthesised') return <ToolCard data={step.content as Record<string, unknown>} />;
    if (step.type === 'agent_created') return <AgentCard data={step.content as Record<string, unknown>} />;
    if (step.type === 'workflow_ready') return <WorkflowReadyCard data={step.content as Record<string, unknown>} />;
    if (step.type === 'compiled') return <CompiledCard data={step.content as Record<string, unknown>} />;
    if (step.type === 'registered') return <RegisteredCard data={step.content as Record<string, unknown>} />;
    if (step.type === 'le_chat_published') return <LeChatCard data={step.content as Record<string, unknown>} />;
    if (step.type === 'error') {
      return (
        <div className="surface-card rounded-xl p-5 mt-2 border border-[rgba(239,68,68,0.2)] bg-[rgba(239,68,68,0.05)] flex flex-col gap-4">
          <p className="text-sm font-mono text-[var(--color-accent-danger)] break-words">{step.content as string}</p>
          <button onClick={handleSubmit} className="btn-secondary px-4 py-2 text-sm rounded-md flex items-center gap-2 hover:text-white w-fit">
            <RefreshCw size={14} /> Retry Planning
          </button>
        </div>
      );
    }
    return null;
  };

  return (
    <div className="flex flex-col h-full absolute inset-0 overflow-y-auto px-4 py-12 custom-scrollbar">
      {/* Hero / Input area */}
      <motion.div
        layout
        className={cn('max-w-3xl mx-auto w-full transition-all duration-500', steps.length > 0 ? 'mt-0 mb-12' : 'mt-[18vh]')}
      >
        <div className="text-center mb-8">
          <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center mx-auto mb-6 shadow-[0_0_40px_rgba(99,102,241,0.3)]">
            <GitBranch size={30} className="text-white" />
          </div>
          <h1 className="text-3xl font-bold text-white tracking-tight mb-3">
            What workflow do you want to build?
          </h1>
          <p className="text-[var(--color-text-muted)]">
            Describe your goal — agents, tools, and the entire pipeline will be assembled automatically.
          </p>
        </div>

        <div className="surface-card rounded-2xl p-2 shadow-2xl focus-within:ring-2 focus-within:ring-[var(--color-border-focus)] transition-all">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSubmit(); } }}
            placeholder="e.g. Build a multi-step insurance claim processing pipeline that validates claims, queries the database, checks weather, and generates a report…"
            className="w-full bg-transparent px-4 py-3 text-base text-white placeholder:text-[var(--color-text-muted)] outline-none resize-none overflow-y-auto custom-scrollbar min-h-[64px]"
            disabled={isPlanning}
          />
          <div className="flex justify-between items-center p-2 border-t border-[var(--color-border-subtle)] mt-2">
            <div className="flex items-center gap-2 text-xs text-[var(--color-text-muted)]">
              <Sparkles size={12} />
              <span>Powered by Mistral AI</span>
            </div>
            <button
              onClick={handleSubmit}
              disabled={!input.trim() || isPlanning}
              className="btn-primary px-6 py-2 rounded-lg font-medium shadow-lg disabled:opacity-50 flex items-center gap-2"
            >
              {isPlanning ? (
                <><div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> Planning…</>
              ) : (
                <>Plan Workflow <ArrowRight size={16} /></>
              )}
            </button>
          </div>
        </div>
      </motion.div>

      {/* Timeline */}
      {steps.length > 0 && (
        <div className="max-w-3xl mx-auto w-full pb-32">
          <div className="relative border-l border-[var(--color-border-subtle)] ml-4 md:ml-8 space-y-6 pb-8">
            <AnimatePresence>
              {steps.map(step => (
                <motion.div
                  key={step.id}
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  className="relative pl-8 md:pl-12"
                >
                  {/* Timeline dot */}
                  <div className="absolute left-[-9px] top-1.5 w-4 h-4 rounded-full bg-[var(--color-bg-base)] border-2 border-[var(--color-border-subtle)] flex items-center justify-center">
                    {step.status === 'active' && <CircleDot size={16} className="text-[#a5b4fc] absolute animate-pulse bg-[var(--color-bg-base)] rounded-full" />}
                    {step.status === 'completed' && step.type !== 'error' && <CheckCircle2 size={16} className="text-[var(--color-accent-success)] absolute bg-[var(--color-bg-base)] rounded-full" />}
                    {step.type === 'error' && <AlertCircle size={16} className="text-[var(--color-accent-danger)] absolute bg-[var(--color-bg-base)] rounded-full" />}
                  </div>

                  {renderStepContent(step)}
                </motion.div>
              ))}
            </AnimatePresence>

            {/* Final CTA */}
            {workflowName && !isPlanning && (
              <motion.div
                initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
                className="relative pl-8 md:pl-12 pt-6"
              >
                <div className="flex flex-wrap gap-3">
                  <button
                    onClick={() => navigate(`/workflows/${encodeURIComponent(workflowName)}`)}
                    className="btn-primary flex-1 min-w-[160px] py-4 rounded-xl font-bold text-base shadow-xl flex items-center justify-center gap-2 hover:scale-[1.02] transition-transform"
                  >
                    <GitBranch size={20} /> View Workflow DAG
                  </button>
                  {leChatUrl && (
                    <a
                      href={leChatUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-2 px-5 py-4 rounded-xl font-bold text-base border border-[rgba(99,102,241,0.4)] bg-[rgba(99,102,241,0.1)] text-[#a5b4fc] hover:bg-[rgba(99,102,241,0.2)] transition-colors"
                    >
                      <MessageSquare size={18} /> Open in le Chat <ExternalLink size={14} />
                    </a>
                  )}
                  <button
                    onClick={() => navigate('/workflows')}
                    className="btn-secondary px-5 py-4 rounded-xl font-medium flex items-center gap-2"
                  >
                    Manage Workflows
                  </button>
                </div>
              </motion.div>
            )}
          </div>
        </div>
      )}

      <div ref={endRef} />
    </div>
  );
}
