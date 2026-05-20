import { useState, useRef, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  GitBranch, ArrowRight, CheckCircle2, AlertCircle,
  RefreshCw, Wrench, Cpu, Sparkles, CircleDot,
  Code2, Server, PackageCheck, PackagePlus, History
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { workflowPlannerApi, type PlannerEvent } from '../../api/workflowPlanner';
import { workflowsApi } from '../../api/workflows';
import { cn } from '../../lib/utils';
import { QK } from '../../lib/queryClient';
import PlannerHistoryPanel, { type PlannerHistoryEntry } from './PlannerHistoryPanel';

import { getTierConfig, TierBadge } from '../../components/ui/TierBadge';

/* ── Timeline Step Types ──────────────────────────────────────────────── */
export interface TimelineStep {
  id: string;
  type: 'status' | 'requirements' | 'tool_exists' | 'tool_new' | 'agent_exists' | 'agent_new'
      | 'workflow_ready' | 'compiled' | 'registered' | 'fatal_error' | 'error';
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

function ToolExistsCard({ data }: { data: Record<string, unknown> }) {
  return (
    <div className="flex items-center justify-between rounded-lg px-4 py-2.5 mt-2 shadow-lg transition-all border border-[rgba(148,163,184,0.2)] bg-gradient-to-br from-[rgba(148,163,184,0.1)] to-[rgba(148,163,184,0.02)] backdrop-blur-md">
      <div className="flex items-center gap-2.5">
        <PackageCheck size={14} className="text-[var(--color-text-muted)]" />
        <span className="text-sm font-mono text-[var(--color-text-primary)]">{data.tool_name as string}</span>
      </div>
      <span className="text-[10px] font-medium uppercase px-2 py-0.5 rounded border text-[var(--color-text-muted)] bg-[var(--color-bg-hover)] border-[var(--color-border-subtle)]">
        Already exists
      </span>
    </div>
  );
}

function ToolNewCard({ data }: { data: Record<string, unknown> }) {
  const status = data.status as string;
  return (
    <div className="flex items-center justify-between rounded-lg px-4 py-2.5 mt-2 shadow-lg transition-all border border-[rgba(52,211,153,0.3)] bg-gradient-to-br from-[rgba(52,211,153,0.15)] to-[rgba(52,211,153,0.02)] backdrop-blur-md">
      <div className="flex items-center gap-2.5">
        <PackagePlus size={14} className="text-emerald-400" />
        <span className="text-sm font-mono text-[var(--color-text-primary)]">{data.tool_name as string}</span>
      </div>
      <span className="text-[10px] font-medium uppercase px-2 py-0.5 rounded border text-[var(--color-accent-success)] bg-[rgba(34,197,94,0.1)] border-[rgba(34,197,94,0.2)]">
        {status === 'approved' ? 'Synthesised & Approved' : status}
      </span>
    </div>
  );
}

function AgentExistsCard({ data }: { data: Record<string, unknown> }) {
  const tools = (data.tools as string[]) ?? [];
  const tier = data.tier as string | undefined;
  const cfg = getTierConfig(tier);
  return (
    <div className={cn('rounded-xl p-5 mt-2 border shadow-lg transition-all', cfg.cardBg, cfg.cardBorder)}>
      <div className="flex items-center gap-3 mb-3">
        <div className={cn('w-9 h-9 rounded-lg flex items-center justify-center border', cfg.bg, cfg.border)}>
          <Cpu size={16} className={cfg.color} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-sm font-semibold text-white">{data.agent_name as string}</p>
            <TierBadge tier={tier} />
          </div>
          <p className="text-[10px] font-mono text-[var(--color-text-muted)]">{data.model as string}</p>
        </div>
        <span className="text-[10px] bg-[var(--color-bg-hover)] text-[var(--color-text-muted)] border border-[var(--color-border-subtle)] px-2 py-0.5 rounded-full uppercase font-medium shrink-0">Reused</span>
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

function AgentNewCard({ data }: { data: Record<string, unknown> }) {
  const tools = (data.tools as string[]) ?? [];
  const tier = data.tier as string | undefined;
  const cfg = getTierConfig(tier);
  return (
    <div className={cn('rounded-xl p-5 mt-2 border shadow-lg transition-all', cfg.cardBg, cfg.cardBorder)}>
      <div className="flex items-center gap-3 mb-3">
        <div className={cn('w-9 h-9 rounded-lg flex items-center justify-center border', cfg.bg, cfg.border)}>
          <Cpu size={16} className={cfg.color} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-sm font-semibold text-white">{data.agent_name as string}</p>
            <TierBadge tier={tier} />
          </div>
          <p className="text-[10px] font-mono text-[var(--color-text-muted)]">{data.model as string}</p>
        </div>
        <span className="text-[10px] bg-[rgba(34,197,94,0.1)] text-[var(--color-accent-success)] border border-[rgba(34,197,94,0.2)] px-2 py-0.5 rounded-full uppercase font-medium shrink-0">Created</span>
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
        <p className="text-xs font-semibold text-white">Compiled to Workflows SDK</p>
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
        <p className="text-xs font-semibold text-white">Registered on Workflow Server</p>
        {data.mistral_workflow_id && (
          <p className="text-[10px] text-emerald-400 font-mono truncate mt-0.5">ID: {data.mistral_workflow_id as string}</p>
        )}
      </div>
      <span className="ml-auto text-[10px] bg-emerald-400/10 text-emerald-400 border border-emerald-400/20 px-2 py-0.5 rounded-full uppercase font-medium shrink-0">Live</span>
    </div>
  );
}

/* ── Main Component ───────────────────────────────────────────────────── */

export default function WorkflowPlanner() {
  const [input, setInput] = useState('');
  const [isPlanning, setIsPlanning] = useState(false);
  const [steps, setSteps] = useState<TimelineStep[]>([]);
  const [workflowName, setWorkflowName] = useState<string | null>(null);
  const [hasFatalError, setHasFatalError] = useState(false);

  const [history, setHistory] = useState<PlannerHistoryEntry[]>(() => {
    try {
      const saved = localStorage.getItem('agent_planner_history');
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);

  const { data: wfListData, isLoading: isLoadingWorkflows } = useQuery({
    queryKey: QK.workflows(),
    queryFn: () =>
      workflowsApi.list().then(r => {
        const d = r.data;
        return Array.isArray(d) ? d : d.workflows ?? [];
      }),
    enabled: isHistoryOpen, // only fetch when panel is opened
  });

  const mergedHistory = useMemo(() => {
    // Build synthetic entries from backend workflows
    const workflows = (Array.isArray(wfListData) ? wfListData : (wfListData as any)?.workflows ?? []) as Record<string, any>[];
    if (workflows.length === 0) return history;

    const knownNames = new Set(history.map(h => h.workflowName).filter(Boolean));
    const synthetic: PlannerHistoryEntry[] = workflows
      .filter(wf => !wf.archived && wf.name && !knownNames.has(wf.name))
      .map(wf => {
        const steps: TimelineStep[] = [];
        // Reconstruct a minimal timeline from the workflow definition
        const wfSteps = (wf.steps ?? []) as Record<string, any>[];
        const agentSteps = wfSteps.filter(s => s.type === 'agent');
        const toolSteps = wfSteps.filter(s => s.type === 'tool');
        const agentNames = agentSteps.map(s => s.config?.agent_name ?? s.config?.agent_id ?? s.id);
        const toolNames = toolSteps.map(s => s.config?.tool_name ?? s.id);

        steps.push({
          id: `${wf.name}-req`,
          type: 'requirements',
          content: {
            description: wf.description ?? '',
            tools_needed: toolNames,
            agents_needed: agentNames,
          },
          status: 'completed',
        });

        toolSteps.forEach(s => {
          steps.push({
            id: `${wf.name}-tool-${s.id}`,
            type: 'tool_exists',
            content: { tool_name: s.config?.tool_name ?? s.id },
            status: 'completed',
          });
        });

        agentSteps.forEach(s => {
          steps.push({
            id: `${wf.name}-agent-${s.id}`,
            type: 'agent_exists',
            content: {
              agent_name: s.config?.agent_name ?? s.config?.agent_id ?? s.id,
              model: s.config?.model ?? 'mistral',
              tools: s.config?.tools ?? [],
              tier: s.tier,
            },
            status: 'completed',
          });
        });

        steps.push({
          id: `${wf.name}-ready`,
          type: 'workflow_ready',
          content: {
            workflow_name: wf.name,
            description: wf.description ?? '',
            step_count: wfSteps.length,
            agents: agentNames,
            entry_step: wf.entry_step ?? '',
          },
          status: 'completed',
        });

        let nameHash = 0;
        const nameStr = wf.name || '';
        for (let i = 0; i < nameStr.length; i++) {
          nameHash = nameStr.charCodeAt(i) + ((nameHash << 5) - nameHash);
        }
        // Offset deterministically by up to 3 days (in ms) from the current moment
        const stableTimestamp = 1779274134000 - Math.abs(nameHash % 259200000);

        return {
          id: `backend-${wf.name}`,
          timestamp: stableTimestamp,
          goal: wf.description || `Build the "${wf.name}" workflow`,
          workflowName: wf.name,
          steps,
          hasFatalError: false,
          restoredFromBackend: true,
        } as PlannerHistoryEntry;
      });

    return [...history, ...synthetic];
  }, [history, wfListData]);

  const saveToHistory = (goalToSave: string, finalSteps: TimelineStep[], finalWorkflowName: string | null, fatalError: boolean) => {
    setHistory(prev => {
      const newEntry: PlannerHistoryEntry = {
        id: crypto.randomUUID(),
        timestamp: Date.now(),
        goal: goalToSave,
        workflowName: finalWorkflowName,
        steps: finalSteps,
        hasFatalError: fatalError
      };
      const updated = [newEntry, ...prev].slice(0, 50);
      localStorage.setItem('agent_planner_history', JSON.stringify(updated));
      return updated;
    });
  };

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
    setHasFatalError(false);

    const cancel = workflowPlannerApi.plan(
      goal,
      (event: PlannerEvent) => {
        if (event.type === 'status') {
          addStep('status', event.data, 'active');
        } else if (event.type === 'requirements') {
          try { addStep('requirements', JSON.parse(event.data)); } catch { /* ignore */ }
        } else if (event.type === 'tool_exists') {
          try { addStep('tool_exists', JSON.parse(event.data)); } catch { /* ignore */ }
        } else if (event.type === 'tool_new') {
          try { addStep('tool_new', JSON.parse(event.data)); } catch { /* ignore */ }
        } else if (event.type === 'agent_exists') {
          try { addStep('agent_exists', JSON.parse(event.data)); } catch { /* ignore */ }
        } else if (event.type === 'agent_new') {
          try { addStep('agent_new', JSON.parse(event.data)); } catch { /* ignore */ }
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
        } else if (event.type === 'fatal_error') {
          try {
            const data = JSON.parse(event.data);
            addStep('fatal_error', data.error || event.data);
          } catch {
            addStep('fatal_error', event.data);
          }
          setHasFatalError(true);
        } else if (event.type === 'error') {
          addStep('error', event.data);
          setHasFatalError(true);
        } else if (event.type === 'done') {
          try {
            const data = JSON.parse(event.data);
            if (data.workflow_name) setWorkflowName(data.workflow_name);
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
          const fatal = updated.some(s => s.type === 'fatal_error' || s.type === 'error');
          const nameStep = updated.find(s => s.type === 'workflow_ready');
          const finalName = nameStep ? (nameStep.content as Record<string, any>).workflow_name : null;
          saveToHistory(goal, updated, finalName, fatal);
          return updated;
        });
      },
    );
    cancelRef.current = cancel;
  };

  const handleRestart = () => {
    if (cancelRef.current) cancelRef.current();
    setHasFatalError(false);
    setWorkflowName(null);
    handleSubmit();
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
    if (step.type === 'tool_exists') return <ToolExistsCard data={step.content as Record<string, unknown>} />;
    if (step.type === 'tool_new') return <ToolNewCard data={step.content as Record<string, unknown>} />;
    if (step.type === 'agent_exists') return <AgentExistsCard data={step.content as Record<string, unknown>} />;
    if (step.type === 'agent_new') return <AgentNewCard data={step.content as Record<string, unknown>} />;
    if (step.type === 'workflow_ready') return <WorkflowReadyCard data={step.content as Record<string, unknown>} />;
    if (step.type === 'compiled') return <CompiledCard data={step.content as Record<string, unknown>} />;
    if (step.type === 'registered') return <RegisteredCard data={step.content as Record<string, unknown>} />;
    if (step.type === 'fatal_error' || step.type === 'error') {
      return (
        <div className="surface-card rounded-xl p-5 mt-2 border border-[rgba(239,68,68,0.2)] bg-[rgba(239,68,68,0.05)] flex flex-col gap-4">
          <p className="text-sm font-mono text-[var(--color-accent-danger)] break-words">{step.content as string}</p>
          <button onClick={handleRestart} className="btn-secondary px-4 py-2 text-sm rounded-md flex items-center gap-2 hover:text-white w-fit">
            <RefreshCw size={14} /> Restart Planning
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
        className={cn('max-w-3xl mx-auto w-full transition-all duration-500 relative z-10', steps.length > 0 ? 'mt-0 mb-12' : 'mt-[18vh]')}
      >
        <div className="flex justify-end mb-4">
          <button
            onClick={() => setIsHistoryOpen(true)}
            className="flex items-center gap-2 px-3 py-1.5 text-xs font-medium rounded-lg text-[var(--color-text-muted)] hover:text-white hover:bg-[var(--color-bg-hover)] border border-transparent hover:border-[var(--color-border-subtle)] transition-colors"
          >
            <History size={14} />
            View History
          </button>
        </div>
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
            rows={6}
            className="w-full bg-transparent px-4 py-3 text-base text-white placeholder:text-[var(--color-text-muted)] outline-none resize-none overflow-y-auto custom-scrollbar min-h-[180px]"
            disabled={isPlanning}
          />
          <div className="flex justify-between items-center p-2 border-t border-[var(--color-border-subtle)] mt-2">
            <div className="flex items-center gap-2 text-xs text-[var(--color-text-muted)]">
              <Sparkles size={12} />
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
                  {/* Timeline dot — color-coded by tier for agent steps */}
                  {(() => {
                    const isAgentStep = step.type === 'agent_exists' || step.type === 'agent_new';
                    const tierColor = isAgentStep
                      ? getTierConfig((step.content as Record<string, unknown>)?.tier as string).dot
                      : undefined;
                    return (
                      <div
                        className={cn(
                          "absolute left-[-9px] top-1.5 w-4 h-4 rounded-full bg-[var(--color-bg-base)] border-2 flex items-center justify-center",
                          !tierColor && "border-[var(--color-border-subtle)]"
                        )}
                        style={tierColor ? { borderColor: tierColor } : undefined}
                      >
                        {step.status === 'active' && (
                          <CircleDot
                            size={16}
                            className="absolute animate-pulse bg-[var(--color-bg-base)] rounded-full"
                            style={tierColor ? { color: tierColor } : { color: '#a5b4fc' }}
                          />
                        )}
                        {step.status === 'completed' && step.type !== 'error' && step.type !== 'fatal_error' && (
                          <CheckCircle2
                            size={16}
                            className="absolute bg-[var(--color-bg-base)] rounded-full"
                            style={tierColor ? { color: tierColor } : { color: 'var(--color-accent-success)' }}
                          />
                        )}
                        {(step.type === 'error' || step.type === 'fatal_error') && (
                          <AlertCircle size={16} className="text-[var(--color-accent-danger)] absolute bg-[var(--color-bg-base)] rounded-full" />
                        )}
                      </div>
                    );
                  })()}

                  {renderStepContent(step)}
                </motion.div>
              ))}
            </AnimatePresence>

            {/* Final CTA */}
            {workflowName && !isPlanning && !hasFatalError && (
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

      <AnimatePresence>
        {isHistoryOpen && (
          <PlannerHistoryPanel
            history={mergedHistory}
            isLoading={isLoadingWorkflows}
            onClose={() => setIsHistoryOpen(false)}
            onSelectEntry={(entry) => {
              setInput(entry.goal);
              setSteps(entry.steps);
              setWorkflowName(entry.workflowName);
              setHasFatalError(entry.hasFatalError);
            }}
            onClearHistory={() => {
              setHistory([]);
              localStorage.removeItem('agent_planner_history');
            }}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
