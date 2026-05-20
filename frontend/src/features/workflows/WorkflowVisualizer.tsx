import { useCallback, useMemo, useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ReactFlow,
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  Handle,
  Position,
  type Node,
  type Edge,
  useNodesState,
  useEdgesState,
  MarkerType,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ArrowLeft, Play, X, Cpu, Wrench, HelpCircle,
  Shuffle, GitBranch, Loader2, CheckCircle2, AlertCircle, Clock, Server,
  Grid, Maximize2, LayoutList, Columns, Eye, Settings, ChevronRight, Layers,
  Copy, Check, EyeOff,
} from 'lucide-react';
import { workflowsApi } from '../../api/workflows';
import { QK } from '../../lib/queryClient';
import { cn } from '../../lib/utils';
import WorkflowHistoryPanel from './WorkflowHistoryPanel';
import { getTierConfig, TierBadge } from '../../components/ui/TierBadge';

/* ── Type helpers ────────────────────────────────────────────────────── */
interface WorkflowStep {
  id: string;
  type: string;
  tier?: string;
  description?: string;
  config: Record<string, unknown>;
  next_steps: string[];
}

interface WorkflowDef {
  name: string;
  description?: string;
  entry_step: string;
  steps: WorkflowStep[];
  input_schema?: { name: string; type: string; description?: string }[];
}

/* ── Custom Node Components ──────────────────────────────────────────── */

function BaseNode({
  icon, label, sublabel, accentClass, borderClass, glowColor, children, onClick, selected, direction,
}: {
  icon: React.ReactNode;
  label: string;
  sublabel?: string;
  accentClass: string;
  borderClass: string;
  glowColor: string;
  children?: React.ReactNode;
  onClick?: () => void;
  selected?: boolean;
  direction?: 'TB' | 'LR';
}) {
  const isLR = direction === 'LR';
  const targetPos = isLR ? Position.Left : Position.Top;
  const sourcePos = isLR ? Position.Right : Position.Bottom;

  return (
    <div
      onClick={onClick}
      className={cn(
        'rounded-2xl backdrop-blur-md bg-[rgba(13,18,30,0.85)] border transition-all duration-300 cursor-pointer min-w-[210px] shadow-[0_10px_35px_rgba(0,0,0,0.5)]',
        selected 
          ? 'border-2 scale-[1.03] ' + borderClass
          : 'border-[rgba(255,255,255,0.08)] hover:border-white/20 hover:scale-[1.01]',
      )}
      style={{
        boxShadow: selected 
          ? `0 0 25px rgba(${glowColor}, 0.25), 0 10px 35px rgba(0,0,0,0.6)` 
          : '0 10px 35px rgba(0,0,0,0.5)'
      }}
    >
      <Handle 
        type="target" 
        position={targetPos} 
        className="!bg-[var(--color-bg-base)] !w-3 !h-3 !border-2 !border-[rgba(255,255,255,0.25)] hover:!bg-[#6366f1] !transition-all !rounded-full !z-10" 
      />
      
      {/* Accent Top Border line */}
      <div className={cn('h-1 rounded-t-2xl', accentClass)} />

      <div className="px-4 py-3 flex items-center gap-3">
        <div className={cn('w-7 h-7 rounded-lg flex items-center justify-center text-white shadow-[inset_0_1px_2px_rgba(255,255,255,0.15)] shrink-0', accentClass)}>
          {icon}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-bold text-white leading-snug truncate" title={label}>{label}</p>
          {sublabel && <p className="text-[9px] text-[var(--color-text-muted)] font-mono leading-tight mt-0.5 truncate">{sublabel}</p>}
        </div>
      </div>
      
      {children && (
        <div className="px-4 py-3 text-[10.5px] text-[var(--color-text-muted)] border-t border-[rgba(255,255,255,0.04)] bg-black/20 rounded-b-2xl">
          {children}
        </div>
      )}
      
      <Handle 
        type="source" 
        position={sourcePos} 
        className="!bg-[var(--color-bg-base)] !w-3 !h-3 !border-2 !border-[rgba(255,255,255,0.25)] hover:!bg-[#6366f1] !transition-all !rounded-full !z-10" 
      />
    </div>
  );
}

function AgentNode({ data }: { data: Record<string, unknown> }) {
  const direction = data.direction as 'TB' | 'LR' | undefined;
  const tier = data.tier as string | undefined;
  const gradientMap: Record<string, string> = {
    foundation: 'bg-gradient-to-r from-indigo-500 to-purple-600',
    domain: 'bg-gradient-to-r from-amber-500 to-orange-600',
    use_case: 'bg-gradient-to-r from-emerald-500 to-teal-600',
  };
  const borderMap: Record<string, string> = {
    foundation: 'border-indigo-500/80',
    domain: 'border-amber-500/80',
    use_case: 'border-emerald-500/80',
  };
  const glowMap: Record<string, string> = {
    foundation: '99,102,241',
    domain: '245,158,11',
    use_case: '16,185,129',
  };

  return (
    <BaseNode
      icon={<Cpu size={13} className="text-white shrink-0" />}
      label={data.label as string}
      sublabel={data.agent_id as string | undefined}
      accentClass={gradientMap[tier || 'foundation'] || gradientMap.foundation}
      borderClass={borderMap[tier || 'foundation'] || borderMap.foundation}
      glowColor={glowMap[tier || 'foundation'] || glowMap.foundation}
      selected={data.selected as boolean}
      onClick={data.onClick as () => void}
      direction={direction}
    >
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-1.5">
          <TierBadge tier={tier} />
          <span className="text-[8px] bg-white/5 border border-white/10 px-1.5 py-0.5 rounded font-mono text-white/50">mistral</span>
        </div>
        {data.queryTemplate && (
          <span className="line-clamp-2 text-white/70 italic text-[10px] leading-normal font-light">
            "{data.queryTemplate as string}"
          </span>
        )}
      </div>
    </BaseNode>
  );
}

function ToolNode({ data }: { data: Record<string, unknown> }) {
  const direction = data.direction as 'TB' | 'LR' | undefined;
  return (
    <BaseNode
      icon={<Wrench size={13} className="text-white shrink-0" />}
      label={data.label as string}
      sublabel={data.toolName as string}
      accentClass="bg-gradient-to-r from-pink-500 to-rose-600"
      borderClass="border-pink-500/80"
      glowColor="236,72,153"
      selected={data.selected as boolean}
      onClick={data.onClick as () => void}
      direction={direction}
    >
      {data.args && (
        <div className="flex flex-col gap-1">
          <span className="text-[8px] font-semibold text-[rgba(236,72,153,0.7)] uppercase tracking-wider">Arguments</span>
          <div className="flex flex-wrap gap-1 font-mono text-[9px] text-white/80">
            {Object.keys(data.args as object).slice(0, 3).map(arg => (
              <span key={arg} className="px-1 py-0.5 rounded bg-pink-500/10 border border-pink-500/20">{arg}</span>
            ))}
            {Object.keys(data.args as object).length > 3 && (
              <span className="px-1 py-0.5 rounded bg-white/5 text-white/40">+{Object.keys(data.args as object).length - 3} more</span>
            )}
          </div>
        </div>
      )}
    </BaseNode>
  );
}

function ConditionNode({ data }: { data: Record<string, unknown> }) {
  const direction = data.direction as 'TB' | 'LR' | undefined;
  return (
    <BaseNode
      icon={<HelpCircle size={13} className="text-white shrink-0" />}
      label={data.label as string}
      sublabel="Conditional Router"
      accentClass="bg-gradient-to-r from-amber-500 to-orange-500"
      borderClass="border-amber-500/80"
      glowColor="245,158,11"
      selected={data.selected as boolean}
      onClick={data.onClick as () => void}
      direction={direction}
    >
      <div className="flex flex-col gap-1">
        <span className="text-[8px] font-semibold text-amber-500/80 uppercase tracking-wider">Expression</span>
        <span className="font-mono text-[9.5px] text-white/80 line-clamp-1 bg-amber-500/5 border border-amber-500/10 px-1.5 py-0.5 rounded">{data.expression as string}</span>
      </div>
    </BaseNode>
  );
}

function TransformNode({ data }: { data: Record<string, unknown> }) {
  const direction = data.direction as 'TB' | 'LR' | undefined;
  const mappingsCount = Object.keys((data.mappings as object) ?? {}).length;
  return (
    <BaseNode
      icon={<Shuffle size={13} className="text-white shrink-0" />}
      label={data.label as string}
      sublabel="Data Transform"
      accentClass="bg-gradient-to-r from-teal-500 to-emerald-500"
      borderClass="border-teal-500/80"
      glowColor="20,184,166"
      selected={data.selected as boolean}
      onClick={data.onClick as () => void}
      direction={direction}
    >
      <div className="flex items-center gap-1.5">
        <Layers size={10} className="text-teal-400" />
        <span className="text-[10px] text-white/80">{mappingsCount} active mapping{mappingsCount !== 1 ? 's' : ''}</span>
      </div>
    </BaseNode>
  );
}

const NODE_TYPES = { agent: AgentNode, tool: ToolNode, condition: ConditionNode, transform: TransformNode };

/* ── DAG layout helper ───────────────────────────────────────────────── */
function buildGraph(
  workflow: WorkflowDef,
  selectedId: string | null,
  onSelect: (id: string) => void,
  direction: 'TB' | 'LR'
): { nodes: Node[]; edges: Edge[] } {
  const steps = workflow.steps;
  const levelMap: Record<string, number> = {};

  // BFS to assign levels
  const queue = [workflow.entry_step];
  levelMap[workflow.entry_step] = 0;
  while (queue.length > 0) {
    const curr = queue.shift()!;
    const step = steps.find(s => s.id === curr);
    if (!step) continue;
    for (const next of step.next_steps ?? []) {
      if (!(next in levelMap)) {
        levelMap[next] = (levelMap[curr] ?? 0) + 1;
        queue.push(next);
      }
    }
    // condition branches
    if (step.config?.true_step && !((step.config.true_step as string) in levelMap)) {
      levelMap[step.config.true_step as string] = (levelMap[curr] ?? 0) + 1;
      queue.push(step.config.true_step as string);
    }
    if (step.config?.false_step && !((step.config.false_step as string) in levelMap)) {
      levelMap[step.config.false_step as string] = (levelMap[curr] ?? 0) + 1;
      queue.push(step.config.false_step as string);
    }
  }

  // Group by level for x-positioning
  const levelGroups: Record<number, string[]> = {};
  for (const [id, level] of Object.entries(levelMap)) {
    if (!levelGroups[level]) levelGroups[level] = [];
    levelGroups[level].push(id);
  }

  const nodes: Node[] = steps.map(step => {
    const level = levelMap[step.id] ?? 0;
    const siblings = levelGroups[level] ?? [step.id];
    const colIdx = siblings.indexOf(step.id);
    const totalCols = siblings.length;
    
    // Grid alignment offsets
    const xBase = (colIdx - (totalCols - 1) / 2) * 260;

    // Adjust position based on orientation direction
    const x = direction === 'LR' ? level * 310 : xBase;
    const y = direction === 'LR' ? (colIdx - (totalCols - 1) / 2) * 200 : level * 230;

    const commonData: Record<string, unknown> = {
      label: step.description || step.id,
      selected: selectedId === step.id,
      onClick: () => onSelect(step.id),
    };

    let typeSpecific: Record<string, unknown> = {};
    if (step.type === 'agent') {
      typeSpecific = { agent_id: step.config?.agent_id, queryTemplate: step.config?.query_template, tier: step.tier };
    } else if (step.type === 'tool') {
      typeSpecific = { toolName: step.config?.tool_name, args: step.config?.arguments };
    } else if (step.type === 'condition') {
      typeSpecific = { expression: step.config?.expression };
    } else if (step.type === 'transform') {
      typeSpecific = { mappings: step.config?.mappings };
    }

    return {
      id: step.id,
      type: step.type,
      position: { x, y },
      data: { ...commonData, ...typeSpecific, direction },
    };
  });

  const edges: Edge[] = [];
  for (const step of steps) {
    for (const next of step.next_steps ?? []) {
      edges.push({
        id: `${step.id}->${next}`,
        source: step.id,
        target: next,
        animated: true,
        markerEnd: { type: MarkerType.ArrowClosed, color: '#6366f1' },
        style: { stroke: '#6366f1', strokeWidth: 2, strokeDasharray: '4,4' },
      });
    }
    if (step.type === 'condition') {
      if (step.config?.true_step) {
        edges.push({
          id: `${step.id}->true`,
          source: step.id,
          target: step.config.true_step as string,
          label: 'YES',
          animated: true,
          markerEnd: { type: MarkerType.ArrowClosed, color: '#10b981' },
          style: { stroke: '#10b981', strokeWidth: 2, strokeDasharray: '4,4' },
          labelStyle: { fill: '#10b981', fontSize: 10, fontWeight: 700, fontFamily: 'monospace' },
          labelBgStyle: { fill: 'var(--color-bg-base)', fillOpacity: 0.8 },
        });
      }
      if (step.config?.false_step) {
        edges.push({
          id: `${step.id}->false`,
          source: step.id,
          target: step.config.false_step as string,
          label: 'NO',
          animated: true,
          markerEnd: { type: MarkerType.ArrowClosed, color: '#ef4444' },
          style: { stroke: '#ef4444', strokeWidth: 2, strokeDasharray: '4,4' },
          labelStyle: { fill: '#ef4444', fontSize: 10, fontWeight: 700, fontFamily: 'monospace' },
          labelBgStyle: { fill: 'var(--color-bg-base)', fillOpacity: 0.8 },
        });
      }
    }
  }

  return { nodes, edges };
}

/* ── Node Detail Modal ────────────────────────────────────────────────── */
/* ── Copyable Variable Field ─────────────────────────────────────────── */
function CopyableField({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = () => {
    navigator.clipboard.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wider text-[var(--color-text-muted)] font-semibold mb-1">{label}</p>
      <div className="flex items-center justify-between gap-2 bg-[rgba(255,255,255,0.03)] border border-white/5 hover:border-white/10 px-3 py-2 rounded-lg transition-colors group">
        <span className="text-xs font-mono text-white/90 truncate select-all">{value}</span>
        <button onClick={handleCopy} className="text-white/40 hover:text-white/80 p-1 rounded hover:bg-white/5 transition-all shrink-0">
          {copied ? (
            <span className="text-[10px] text-emerald-400 font-medium">Copied!</span>
          ) : (
            <Copy size={12} className="group-hover:scale-105" />
          )}
        </button>
      </div>
    </div>
  );
}

/* ── Prompt Parameter Variable Highlighter ───────────────────────────── */
function highlightPromptVariables(prompt: string) {
  const parts = prompt.split(/(\{\{\{[^{}]+\}\}\}|\{\{[^{}]+\}\})/g);
  return parts.map((part, idx) => {
    const isVar = part.startsWith('{{');
    if (isVar) {
      const cleanVar = part.replace(/[\{\}]/g, '');
      return (
        <span 
          key={idx} 
          className="inline-block px-1.5 py-0.5 rounded bg-amber-500/20 border border-amber-500/30 text-amber-300 font-mono text-[10.5px] mx-0.5 shadow-sm font-semibold select-all"
        >
          {cleanVar}
        </span>
      );
    }
    return <span key={idx}>{part}</span>;
  });
}

/* ── Node Inspect Drawer ──────────────────────────────────────────────── */
interface NodeInspectDrawerProps {
  step: WorkflowStep;
  onClose: () => void;
  workflow: WorkflowDef;
  onNavigateToNode: (id: string) => void;
}

function NodeInspectDrawer({ step, onClose, workflow, onNavigateToNode }: NodeInspectDrawerProps) {
  const typeColors: Record<string, { gradient: string; border: string; glow: string; text: string; label: string }> = {
    agent: {
      gradient: 'from-indigo-600 to-purple-600',
      border: 'border-indigo-500/30',
      glow: 'rgba(99, 102, 241, 0.15)',
      text: 'text-indigo-400',
      label: 'Agent Node'
    },
    tool: {
      gradient: 'from-pink-600 to-rose-600',
      border: 'border-pink-500/30',
      glow: 'rgba(236, 72, 153, 0.15)',
      text: 'text-pink-400',
      label: 'Tool Execution'
    },
    condition: {
      gradient: 'from-amber-600 to-orange-600',
      border: 'border-amber-500/30',
      glow: 'rgba(245, 158, 11, 0.15)',
      text: 'text-amber-400',
      label: 'Conditional Router'
    },
    transform: {
      gradient: 'from-teal-600 to-emerald-600',
      border: 'border-teal-500/30',
      glow: 'rgba(20, 184, 166, 0.15)',
      text: 'text-teal-400',
      label: 'Data Transform'
    },
  };

  const typeIcons: Record<string, React.ReactNode> = {
    agent: <Cpu size={18} className="text-white" />,
    tool: <Wrench size={18} className="text-white" />,
    condition: <HelpCircle size={18} className="text-white" />,
    transform: <Shuffle size={18} className="text-white" />,
  };

  const theme = typeColors[step.type] ?? typeColors.agent;

  const parentSteps = useMemo(() => {
    return workflow.steps.filter(s => {
      if (s.next_steps?.includes(step.id)) return true;
      if (s.type === 'condition' && (s.config?.true_step === step.id || s.config?.false_step === step.id)) return true;
      return false;
    });
  }, [workflow, step]);

  const childSteps = useMemo(() => {
    const ids: string[] = [];
    if (step.next_steps) ids.push(...step.next_steps);
    if (step.type === 'condition') {
      if (step.config?.true_step) ids.push(step.config.true_step as string);
      if (step.config?.false_step) ids.push(step.config.false_step as string);
    }
    return workflow.steps.filter(s => ids.includes(s.id));
  }, [workflow, step]);

  return (
    <motion.div
      initial={{ x: '100%' }}
      animate={{ x: 0 }}
      exit={{ x: '100%' }}
      transition={{ type: 'spring', damping: 26, stiffness: 220 }}
      className="absolute right-0 top-0 bottom-0 w-full sm:w-[450px] bg-slate-950/90 backdrop-blur-xl border-l border-white/10 shadow-2xl flex flex-col z-30 overflow-hidden"
    >
      <div className={cn("absolute left-0 top-0 bottom-0 w-[2px] bg-gradient-to-b", theme.gradient)} />

      {/* Header */}
      <div className={cn('bg-gradient-to-r px-6 py-4 flex items-center justify-between border-b border-white/5 relative shrink-0', theme.gradient)}>
        <div className="absolute inset-0 bg-black/20 pointer-events-none" />
        <div className="flex items-center gap-3 relative z-10">
          <div className="w-9 h-9 rounded-lg bg-white/10 backdrop-blur-sm border border-white/10 flex items-center justify-center shadow-md">
            {typeIcons[step.type]}
          </div>
          <div>
            <p className="text-sm font-bold text-white leading-normal truncate max-w-[280px]" title={step.description || step.id}>
              {step.description || step.id}
            </p>
            <p className="text-[10px] text-white/85 uppercase tracking-wider font-mono font-semibold">{theme.label}</p>
          </div>
        </div>
        <button
          onClick={onClose}
          className="text-white/70 hover:text-white p-1.5 rounded-lg hover:bg-white/10 transition-colors relative z-10 flex items-center justify-center"
        >
          <X size={16} />
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-6 py-6 space-y-6 scrollbar-thin scrollbar-thumb-white/10">
        
        {/* Core Identity */}
        <div className="space-y-4">
          <CopyableField label="Step Identifier (ID)" value={step.id} />
          {step.description && (
            <div>
              <p className="text-[10px] uppercase tracking-wider text-[var(--color-text-muted)] font-semibold mb-1">Description</p>
              <p className="text-xs text-white/80 leading-relaxed bg-white/5 border border-white/5 rounded-lg px-3 py-2.5">
                {step.description}
              </p>
            </div>
          )}
        </div>

        {/* Connections Directory */}
        <div className="space-y-3">
          <div className="flex items-center gap-1.5">
            <GitBranch size={13} className="text-indigo-400" />
            <h4 className="text-xs uppercase tracking-wider text-white font-bold">Connections Directory</h4>
          </div>

          <div className="grid grid-cols-1 gap-4 bg-white/5 border border-white/5 p-4 rounded-xl">
            {/* Parents */}
            <div>
              <span className="text-[9px] uppercase tracking-wider text-white/50 font-bold block mb-2">Incoming Inputs (Parents)</span>
              {parentSteps.length === 0 ? (
                <span className="text-[10.5px] text-white/30 italic block px-1">No parent steps (Entry step)</span>
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {parentSteps.map(p => (
                    <button
                      key={p.id}
                      onClick={() => onNavigateToNode(p.id)}
                      className="px-2.5 py-1.5 rounded-lg bg-black/40 hover:bg-black/60 border border-white/5 hover:border-white/20 text-xs font-mono text-white/80 transition-all flex items-center gap-1.5 group shrink-0"
                    >
                      <span className={cn("w-1.5 h-1.5 rounded-full shrink-0", 
                        p.type === 'agent' ? 'bg-indigo-500' : p.type === 'tool' ? 'bg-pink-500' : p.type === 'condition' ? 'bg-amber-500' : 'bg-teal-500'
                      )} />
                      <span className="truncate max-w-[120px]">{p.id}</span>
                      <ChevronRight size={10} className="text-white/20 group-hover:text-white/60 transition-transform group-hover:translate-x-0.5" />
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="border-t border-white/5" />

            {/* Children */}
            <div>
              <span className="text-[9px] uppercase tracking-wider text-white/50 font-bold block mb-2">Outgoing Outputs (Children)</span>
              {childSteps.length === 0 ? (
                <span className="text-[10.5px] text-white/30 italic block px-1">No child steps (Terminal node)</span>
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {childSteps.map(c => (
                    <button
                      key={c.id}
                      onClick={() => onNavigateToNode(c.id)}
                      className="px-2.5 py-1.5 rounded-lg bg-black/40 hover:bg-black/60 border border-white/5 hover:border-white/20 text-xs font-mono text-white/80 transition-all flex items-center gap-1.5 group shrink-0"
                    >
                      <span className={cn("w-1.5 h-1.5 rounded-full shrink-0", 
                        c.type === 'agent' ? 'bg-indigo-500' : c.type === 'tool' ? 'bg-pink-500' : c.type === 'condition' ? 'bg-amber-500' : 'bg-teal-500'
                      )} />
                      <span className="truncate max-w-[120px]">{c.id}</span>
                      <ChevronRight size={10} className="text-white/20 group-hover:text-white/60 transition-transform group-hover:translate-x-0.5" />
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Technical Specification */}
        <div className="space-y-4">
          <div className="flex items-center gap-1.5">
            <Settings size={13} className={theme.text} />
            <h4 className="text-xs uppercase tracking-wider text-white font-bold">Node Specification</h4>
          </div>

          <div className={cn("p-4 rounded-xl border bg-gradient-to-b from-white/[0.02] to-transparent space-y-4", theme.border)}>
            
            {step.type === 'agent' && (
              <>
                {step.config.agent_id && (
                  <CopyableField label="Assigned Agent Identity" value={step.config.agent_id as string} />
                )}
                {step.tier && (
                  <div>
                    <p className="text-[10px] uppercase tracking-wider text-[var(--color-text-muted)] font-semibold mb-1">Compute Tier & Engine</p>
                    <div className="flex items-center gap-2 bg-black/30 px-3 py-2 rounded-lg border border-white/5">
                      <TierBadge tier={step.tier} />
                      <span className="text-[10px] bg-indigo-500/10 border border-indigo-500/20 px-2 py-0.5 rounded font-mono text-indigo-300">Mistral Large</span>
                    </div>
                  </div>
                )}
                {step.config.query_template && (
                  <div>
                    <p className="text-[10px] uppercase tracking-wider text-[var(--color-text-muted)] font-semibold mb-1">Query / Instruction Prompt</p>
                    <div className="bg-black/40 border border-white/5 rounded-lg p-3 font-serif italic text-xs leading-relaxed text-white/90 shadow-inner max-h-[220px] overflow-y-auto">
                      {highlightPromptVariables(step.config.query_template as string)}
                    </div>
                  </div>
                )}
              </>
            )}

            {step.type === 'tool' && (
              <>
                {step.config.tool_name && (
                  <CopyableField label="Tool Definition Called" value={step.config.tool_name as string} />
                )}
                {step.config.arguments && (
                  <div>
                    <p className="text-[10px] uppercase tracking-wider text-[var(--color-text-muted)] font-semibold mb-1">Execution Arguments Schema</p>
                    <div className="bg-black/30 border border-white/5 rounded-xl overflow-hidden shadow-inner">
                      <div className="grid grid-cols-3 gap-2 px-3 py-1.5 bg-white/5 border-b border-white/5 text-[9px] uppercase tracking-wider text-white/40 font-bold font-mono">
                        <div>Argument</div>
                        <div className="col-span-2">Value Expression</div>
                      </div>
                      <div className="divide-y divide-white/5 max-h-[200px] overflow-y-auto">
                        {Object.entries(step.config.arguments as object).map(([key, val]) => (
                          <div key={key} className="grid grid-cols-3 gap-2 px-3 py-2 text-xs font-mono">
                            <div className="text-pink-400 font-medium truncate select-all">{key}</div>
                            <div className="col-span-2 text-white/80 select-all truncate" title={typeof val === 'object' ? JSON.stringify(val) : String(val)}>
                              {typeof val === 'object' ? JSON.stringify(val) : String(val)}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                )}
              </>
            )}

            {step.type === 'condition' && (
              <>
                {step.config.expression && (
                  <div>
                    <p className="text-[10px] uppercase tracking-wider text-[var(--color-text-muted)] font-semibold mb-1">Conditional Formula Expression</p>
                    <div className="bg-amber-500/5 border border-amber-500/20 px-3 py-2.5 rounded-lg font-mono text-xs text-amber-300 shadow-inner select-all">
                      {step.config.expression as string}
                    </div>
                  </div>
                )}
                <div className="space-y-2">
                  <p className="text-[10px] uppercase tracking-wider text-[var(--color-text-muted)] font-semibold">Router Outcomes</p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {step.config.true_step && (
                      <button
                        onClick={() => onNavigateToNode(step.config.true_step as string)}
                        className="p-2.5 rounded-lg bg-emerald-500/5 border border-emerald-500/20 hover:border-emerald-500/40 text-left transition-all group"
                      >
                        <span className="text-[9px] uppercase tracking-wider font-bold text-emerald-400 font-mono block mb-1">True Path (YES) ➔</span>
                        <span className="text-xs font-mono text-white/95 truncate block">{step.config.true_step as string}</span>
                      </button>
                    )}
                    {step.config.false_step && (
                      <button
                        onClick={() => onNavigateToNode(step.config.false_step as string)}
                        className="p-2.5 rounded-lg bg-rose-500/5 border border-rose-500/20 hover:border-rose-500/40 text-left transition-all group"
                      >
                        <span className="text-[9px] uppercase tracking-wider font-bold text-rose-400 font-mono block mb-1">False Path (NO) ➔</span>
                        <span className="text-xs font-mono text-white/95 truncate block">{step.config.false_step as string}</span>
                      </button>
                    )}
                  </div>
                </div>
              </>
            )}

            {step.type === 'transform' && step.config.mappings && (
              <div>
                <p className="text-[10px] uppercase tracking-wider text-[var(--color-text-muted)] font-semibold mb-1">Attribute Variable Mappings</p>
                <div className="bg-black/30 border border-white/5 rounded-xl overflow-hidden shadow-inner">
                  <div className="grid grid-cols-2 gap-2 px-3 py-1.5 bg-white/5 border-b border-white/5 text-[9px] uppercase tracking-wider text-white/40 font-bold font-mono">
                    <div>Source Variable</div>
                    <div>Target Attribute</div>
                  </div>
                  <div className="divide-y divide-white/5 max-h-[220px] overflow-y-auto">
                    {Object.entries(step.config.mappings as object).map(([src, dst]) => (
                      <div key={src} className="grid grid-cols-2 gap-2 px-3 py-2 text-xs font-mono items-center">
                        <div className="text-teal-400 font-medium truncate select-all">{src}</div>
                        <div className="text-white/80 select-all truncate flex items-center gap-1">
                          <span>➔</span>
                          <span className="truncate" title={String(dst)}>{String(dst)}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

          </div>
        </div>

      </div>
    </motion.div>
  );
}

/* ── Status Badge ────────────────────────────────────────────────────── */
function StatusBadge({ status }: { status?: string }) {
  const cfg: Record<string, { label: string; cls: string; icon: React.ReactNode }> = {
    COMPLETED: { label: 'Completed', cls: 'text-[var(--color-accent-success)] bg-[rgba(34,197,94,0.1)] border-[rgba(34,197,94,0.2)]', icon: <CheckCircle2 size={11} /> },
    FAILED: { label: 'Failed', cls: 'text-[var(--color-accent-danger)] bg-[rgba(239,68,68,0.1)] border-[rgba(239,68,68,0.2)]', icon: <AlertCircle size={11} /> },
    RUNNING: { label: 'Running', cls: 'text-[var(--color-accent-warning)] bg-[rgba(245,158,11,0.1)] border-[rgba(245,158,11,0.2)]', icon: <Loader2 size={11} className="animate-spin" /> },
    PENDING: { label: 'Pending', cls: 'text-[var(--color-text-muted)] bg-[var(--color-bg-hover)] border-[var(--color-border-subtle)]', icon: <Clock size={11} /> },
  };
  const c = cfg[status ?? ''] ?? cfg.PENDING;
  return (
    <span className={cn('flex items-center gap-1.5 text-[10px] font-semibold uppercase px-2.5 py-1 rounded-full border', c.cls)}>
      {c.icon} {c.label}
    </span>
  );
}

/* ── Main Component ───────────────────────────────────────────────────── */
export default function WorkflowVisualizer() {
  const { workflowName } = useParams<{ workflowName: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();

  const [selectedStepId, setSelectedStepId] = useState<string | null>(null);
  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);

  const [direction, setDirection] = useState<'TB' | 'LR'>('TB');
  const [gridVariant, setGridVariant] = useState<BackgroundVariant | 'none'>(BackgroundVariant.Dots);
  const [showMinimap, setShowMinimap] = useState(true);
  const [rfInstance, setRfInstance] = useState<any>(null);

  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [exportSuccess, setExportSuccess] = useState<string | null>(null);

  const exportMutation = useMutation({
    mutationFn: () => workflowsApi.exportToMistral(workflowName!),
    onSuccess: (res) => {
      setExportSuccess(res.data.file_path);
      setTimeout(() => setExportSuccess(null), 5000);
    },
    onError: (err: any) => {
      alert("Failed to export: " + (err.response?.data?.detail || err.message));
    }
  });

  const { data: wfData, isLoading } = useQuery({
    queryKey: [...QK.workflows(), workflowName],
    queryFn: () => workflowsApi.get(workflowName!).then(r => r.data),
    enabled: !!workflowName,
  });

  const workflow: WorkflowDef | null = wfData?.workflow ?? null;

  const selectedStep = useMemo(() => {
    if (!selectedStepId || !workflow) return null;
    return workflow.steps.find(s => s.id === selectedStepId) ?? null;
  }, [selectedStepId, workflow]);

  const handleSelect = useCallback((id: string) => {
    setSelectedStepId(prev => prev === id ? null : id);
  }, []);

  useEffect(() => {
    if (!workflow) return;
    const { nodes: n, edges: e } = buildGraph(workflow, selectedStepId, handleSelect, direction);
    setNodes(n);
    setEdges(e);

    if (rfInstance) {
      setTimeout(() => {
        rfInstance.fitView({ padding: 0.3, duration: 600 });
      }, 50);
    }
  }, [workflow, selectedStepId, handleSelect, direction, setNodes, setEdges, rfInstance]);

  if (isLoading) {
    return (
      <div className="h-full flex items-center justify-center bg-[rgba(8,11,19,0.95)]">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-2 border-[#6366f1] border-t-transparent rounded-full animate-spin" />
          <p className="text-sm text-[var(--color-text-muted)]">Loading workflow…</p>
        </div>
      </div>
    );
  }

  if (!workflow) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-4 p-8 bg-[rgba(8,11,19,0.95)]">
        <GitBranch size={32} className="text-[var(--color-text-muted)]" />
        <p className="text-sm text-[var(--color-text-secondary)]">Workflow "{workflowName}" not found.</p>
        <button onClick={() => navigate('/workflows')} className="btn-secondary px-4 py-2 text-sm rounded-md flex items-center gap-2">
          <ArrowLeft size={14} /> Back to Workflows
        </button>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col overflow-hidden bg-[rgba(8,11,19,0.95)]">
      {/* Top bar */}
      <div className="flex flex-wrap items-center justify-between gap-4 px-5 py-3 bg-[var(--color-bg-surface)] border-b border-[var(--color-border-subtle)] shrink-0">
        <div className="flex items-center flex-wrap gap-3">
          <button onClick={() => navigate('/workflows')} className="text-[var(--color-text-muted)] hover:text-white p-1.5 rounded-md hover:bg-[var(--color-bg-hover)] transition-colors">
            <ArrowLeft size={16} />
          </button>
          <div className="hidden sm:block w-px h-5 bg-[var(--color-border-subtle)]" />
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center shrink-0">
              <GitBranch size={14} className="text-white" />
            </div>
            <div>
              <p className="text-sm font-semibold text-white font-mono">{workflow.name}</p>
              <p className="text-[10px] text-[var(--color-text-muted)]">{workflow.steps.length} steps</p>
            </div>
          </div>
          {workflow.description && (
            <>
              <div className="hidden sm:block w-px h-5 bg-[var(--color-border-subtle)]" />
              <p className="text-xs text-[var(--color-text-muted)] italic max-w-xs truncate">{workflow.description}</p>
            </>
          )}
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => exportMutation.mutate()}
            disabled={exportMutation.isPending}
            className="btn-secondary flex items-center gap-2 px-3 py-1.5 text-sm rounded-md whitespace-nowrap"
          >
            {exportMutation.isPending ? <Loader2 size={14} className="animate-spin" /> : <Server size={14} />}
            {exportSuccess ? "Exported!" : "Export Workflow"}
          </button>
          <button
            onClick={() => setIsHistoryOpen(true)}
            className="btn-secondary flex items-center gap-2 px-3 py-1.5 text-sm rounded-md"
          >
            <Clock size={14} /> History
          </button>
          <button
            onClick={() => navigate(`/workflows/${encodeURIComponent(workflowName!)}/execute`)}
            className="btn-primary flex items-center gap-2 px-4 py-2 text-sm rounded-md whitespace-nowrap"
          >
            <Play size={14} /> Run Workflow
          </button>
        </div>
      </div>

      {/* Visualizer Workspace */}
      <div className="flex-1 flex overflow-hidden relative">
        
        {/* Main Canvas Area */}
        <div className="flex-1 relative h-full">
          
          {/* Glassmorphic Floating Toolbar */}
          <div className="absolute top-4 left-4 z-10 flex flex-wrap gap-2 p-1.5 rounded-xl border border-white/10 bg-slate-950/80 backdrop-blur-md shadow-lg pointer-events-auto">
            {/* Direction */}
            <div className="flex bg-black/40 rounded-lg p-0.5 border border-white/5">
              <button
                onClick={() => setDirection('TB')}
                className={cn(
                  "p-1.5 rounded-md text-xs font-semibold transition-all flex items-center gap-1.5",
                  direction === 'TB' ? "bg-indigo-600 text-white shadow" : "text-white/60 hover:text-white"
                )}
                title="Vertical layout (Top-Bottom)"
              >
                <LayoutList size={13} />
                <span className="hidden md:inline">Vertical</span>
              </button>
              <button
                onClick={() => setDirection('LR')}
                className={cn(
                  "p-1.5 rounded-md text-xs font-semibold transition-all flex items-center gap-1.5",
                  direction === 'LR' ? "bg-indigo-600 text-white shadow" : "text-white/60 hover:text-white"
                )}
                title="Horizontal layout (Left-Right)"
              >
                <Columns size={13} />
                <span className="hidden md:inline">Horizontal</span>
              </button>
            </div>

            {/* Grid styling */}
            <div className="flex bg-black/40 rounded-lg p-0.5 border border-white/5">
              <button
                onClick={() => setGridVariant(BackgroundVariant.Dots)}
                className={cn(
                  "px-2 py-1.5 rounded-md text-[10px] font-bold uppercase transition-all",
                  gridVariant === BackgroundVariant.Dots ? "bg-white/10 text-white font-extrabold" : "text-white/50 hover:text-white"
                )}
              >
                Dots
              </button>
              <button
                onClick={() => setGridVariant(BackgroundVariant.Lines)}
                className={cn(
                  "px-2 py-1.5 rounded-md text-[10px] font-bold uppercase transition-all",
                  gridVariant === BackgroundVariant.Lines ? "bg-white/10 text-white font-extrabold" : "text-white/50 hover:text-white"
                )}
              >
                Lines
              </button>
              <button
                onClick={() => setGridVariant('none')}
                className={cn(
                  "px-2 py-1.5 rounded-md text-[10px] font-bold uppercase transition-all",
                  gridVariant === 'none' ? "bg-white/10 text-white font-extrabold" : "text-white/50 hover:text-white"
                )}
              >
                None
              </button>
            </div>

            {/* Minimap visibility */}
            <button
              onClick={() => setShowMinimap(!showMinimap)}
              className={cn(
                "p-2 rounded-lg border transition-all flex items-center justify-center bg-black/40",
                showMinimap ? "border-indigo-500/30 text-indigo-400" : "border-white/5 text-white/50 hover:text-white"
              )}
              title={showMinimap ? "Hide Minimap" : "Show Minimap"}
            >
              {showMinimap ? <Eye size={13} /> : <EyeOff size={13} />}
            </button>

            {/* Camera auto-fit */}
            <button
              onClick={() => rfInstance?.fitView({ padding: 0.3, duration: 800 })}
              className="p-2 rounded-lg border border-white/5 hover:border-white/20 text-white/50 hover:text-white bg-black/40 transition-all flex items-center justify-center"
              title="Fit View"
            >
              <Maximize2 size={13} />
            </button>
          </div>

          {/* ReactFlow Canvas */}
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            nodeTypes={NODE_TYPES}
            onInit={setRfInstance}
            fitView
            fitViewOptions={{ padding: 0.3 }}
            className="!bg-[rgba(8,11,19,0.95)]"
            proOptions={{ hideAttribution: true }}
          >
            {gridVariant !== 'none' && (
              <Background
                variant={gridVariant as BackgroundVariant}
                gap={24}
                size={1}
                color="rgba(255,255,255,0.06)"
              />
            )}
            <Controls
              className="!bg-slate-900/90 !border !border-white/10 !rounded-xl !shadow-xl"
              style={{ bottom: 24, left: 24 }}
            />
            {showMinimap && (
              <MiniMap
                style={{ background: 'rgb(15, 23, 42)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 12 }}
                nodeColor={(node) => {
                  const map: Record<string, string> = { agent: '#6366f1', tool: '#ec4899', condition: '#f59e0b', transform: '#14b8a6' };
                  return map[node.type ?? ''] ?? '#475569';
                }}
                maskColor="rgba(0,0,0,0.6)"
                position="bottom-right"
              />
            )}
          </ReactFlow>

          {/* Prompt Click Hint */}
          {workflow.steps.length > 0 && !selectedStepId && (
            <div className="absolute top-4 left-1/2 -translate-x-1/2 pointer-events-none">
              <div className="bg-slate-900/80 backdrop-blur-md border border-white/10 rounded-full px-4 py-2 text-xs text-white/70 flex items-center gap-2 shadow-lg">
                <div className="w-1.5 h-1.5 rounded-full bg-indigo-500 animate-ping" />
                <span>Select a node to inspect and control execution paths</span>
              </div>
            </div>
          )}
        </div>

        {/* Sliding Inspect Panel drawer */}
        <AnimatePresence>
          {selectedStep && (
            <NodeInspectDrawer
              step={selectedStep}
              onClose={() => setSelectedStepId(null)}
              workflow={workflow}
              onNavigateToNode={(nodeId) => {
                setSelectedStepId(nodeId);
                const node = rfInstance?.getNode(nodeId);
                if (node) {
                  const x = node.position.x + 105;
                  const y = node.position.y + 60;
                  rfInstance.setCenter(x, y, { zoom: 1.1, duration: 800 });
                }
              }}
            />
          )}
        </AnimatePresence>
      </div>

      {/* Workflow Execution History Panel */}
      <AnimatePresence>
        {isHistoryOpen && workflow && (
          <WorkflowHistoryPanel
            workflowName={workflow.name}
            onClose={() => setIsHistoryOpen(false)}
            onSelectExecution={(id) => {
              navigate(`/workflows/${encodeURIComponent(workflowName!)}/execute?execId=${id}`);
            }}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
