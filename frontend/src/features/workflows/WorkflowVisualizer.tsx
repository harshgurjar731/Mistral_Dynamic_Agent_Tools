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
} from 'lucide-react';
import { workflowsApi } from '../../api/workflows';
import { QK } from '../../lib/queryClient';
import { cn } from '../../lib/utils';
import WorkflowHistoryPanel from './WorkflowHistoryPanel';

/* ── Type helpers ────────────────────────────────────────────────────── */
interface WorkflowStep {
  id: string;
  type: string;
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
  icon, label, sublabel, accentClass, borderClass, children, onClick, selected,
}: {
  icon: React.ReactNode;
  label: string;
  sublabel?: string;
  accentClass: string;
  borderClass: string;
  children?: React.ReactNode;
  onClick?: () => void;
  selected?: boolean;
}) {
  return (
    <div
      onClick={onClick}
      className={cn(
        'rounded-xl bg-[var(--color-bg-surface)] border transition-all cursor-pointer min-w-[180px]',
        selected ? borderClass + ' shadow-[0_0_20px_rgba(99,102,241,0.3)]' : 'border-[var(--color-border-subtle)]',
        'hover:' + borderClass,
      )}
      style={{ fontFamily: 'Inter, sans-serif' }}
    >
      <Handle type="target" position={Position.Top} className="!bg-[var(--color-border-subtle)] !w-2 !h-2" />
      <div className={cn('rounded-t-xl px-4 py-2.5 flex items-center gap-2.5', accentClass)}>
        {icon}
        <div>
          <p className="text-xs font-bold text-white leading-tight">{label}</p>
          {sublabel && <p className="text-[10px] text-white/60 font-mono leading-tight mt-0.5">{sublabel}</p>}
        </div>
      </div>
      {children && (
        <div className="px-4 py-3 text-[11px] text-[var(--color-text-muted)] border-t border-[var(--color-border-subtle)]">
          {children}
        </div>
      )}
      <Handle type="source" position={Position.Bottom} className="!bg-[var(--color-border-subtle)] !w-2 !h-2" />
    </div>
  );
}

function AgentNode({ data }: { data: Record<string, unknown> }) {
  return (
    <BaseNode
      icon={<Cpu size={14} className="text-white shrink-0" />}
      label={data.label as string}
      sublabel={data.agent_id as string | undefined}
      accentClass="bg-gradient-to-r from-indigo-600 to-purple-600"
      borderClass="border-indigo-500/60"
      selected={data.selected as boolean}
      onClick={data.onClick as () => void}
    >
      {data.queryTemplate && (
        <span className="line-clamp-2 italic">"{data.queryTemplate as string}"</span>
      )}
    </BaseNode>
  );
}

function ToolNode({ data }: { data: Record<string, unknown> }) {
  return (
    <BaseNode
      icon={<Wrench size={14} className="text-white shrink-0" />}
      label={data.label as string}
      sublabel={data.toolName as string}
      accentClass="bg-gradient-to-r from-pink-600 to-rose-600"
      borderClass="border-pink-500/60"
      selected={data.selected as boolean}
      onClick={data.onClick as () => void}
    >
      {data.args && (
        <span className="font-mono text-[10px] text-[var(--color-text-muted)]">
          {Object.keys(data.args as object).join(', ')}
        </span>
      )}
    </BaseNode>
  );
}

function ConditionNode({ data }: { data: Record<string, unknown> }) {
  return (
    <BaseNode
      icon={<HelpCircle size={14} className="text-white shrink-0" />}
      label={data.label as string}
      sublabel="condition"
      accentClass="bg-gradient-to-r from-amber-600 to-orange-600"
      borderClass="border-amber-500/60"
      selected={data.selected as boolean}
      onClick={data.onClick as () => void}
    >
      <span className="font-mono text-[10px]">{data.expression as string}</span>
    </BaseNode>
  );
}

function TransformNode({ data }: { data: Record<string, unknown> }) {
  return (
    <BaseNode
      icon={<Shuffle size={14} className="text-white shrink-0" />}
      label={data.label as string}
      sublabel="transform"
      accentClass="bg-gradient-to-r from-teal-600 to-emerald-600"
      borderClass="border-teal-500/60"
      selected={data.selected as boolean}
      onClick={data.onClick as () => void}
    >
      <span className="text-[10px]">{Object.keys((data.mappings as object) ?? {}).length} mappings</span>
    </BaseNode>
  );
}

const NODE_TYPES = { agent: AgentNode, tool: ToolNode, condition: ConditionNode, transform: TransformNode };

/* ── DAG layout helper ───────────────────────────────────────────────── */
function buildGraph(workflow: WorkflowDef, selectedId: string | null, onSelect: (id: string) => void): { nodes: Node[]; edges: Edge[] } {
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
    const xBase = (colIdx - (totalCols - 1) / 2) * 260;

    const commonData: Record<string, unknown> = {
      label: step.description || step.id,
      selected: selectedId === step.id,
      onClick: () => onSelect(step.id),
    };

    let typeSpecific: Record<string, unknown> = {};
    if (step.type === 'agent') {
      typeSpecific = { agent_id: step.config?.agent_id, queryTemplate: step.config?.query_template };
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
      position: { x: xBase, y: level * 180 },
      data: { ...commonData, ...typeSpecific },
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
        style: { stroke: '#6366f1', strokeWidth: 2 },
      });
    }
    if (step.type === 'condition') {
      if (step.config?.true_step) {
        edges.push({
          id: `${step.id}->true`,
          source: step.id,
          target: step.config.true_step as string,
          label: 'yes',
          animated: true,
          markerEnd: { type: MarkerType.ArrowClosed, color: '#22c55e' },
          style: { stroke: '#22c55e', strokeWidth: 2 },
          labelStyle: { fill: '#22c55e', fontSize: 11, fontWeight: 600 },
          labelBgStyle: { fill: 'transparent' },
        });
      }
      if (step.config?.false_step) {
        edges.push({
          id: `${step.id}->false`,
          source: step.id,
          target: step.config.false_step as string,
          label: 'no',
          animated: true,
          markerEnd: { type: MarkerType.ArrowClosed, color: '#ef4444' },
          style: { stroke: '#ef4444', strokeWidth: 2 },
          labelStyle: { fill: '#ef4444', fontSize: 11, fontWeight: 600 },
          labelBgStyle: { fill: 'transparent' },
        });
      }
    }
  }

  return { nodes, edges };
}

/* ── Node Detail Modal ────────────────────────────────────────────────── */
function NodeDetailModal({ step, onClose }: { step: WorkflowStep; onClose: () => void }) {
  const typeColors: Record<string, string> = {
    agent: 'from-indigo-600 to-purple-600',
    tool: 'from-pink-600 to-rose-600',
    condition: 'from-amber-600 to-orange-600',
    transform: 'from-teal-600 to-emerald-600',
  };
  const typeIcons: Record<string, React.ReactNode> = {
    agent: <Cpu size={18} className="text-white" />,
    tool: <Wrench size={18} className="text-white" />,
    condition: <HelpCircle size={18} className="text-white" />,
    transform: <Shuffle size={18} className="text-white" />,
  };

  return (
    <motion.div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
    >
      <div className="absolute inset-0 bg-black/70 backdrop-blur-md" onClick={onClose} />
      <motion.div
        initial={{ scale: 0.85, opacity: 0, y: 30 }}
        animate={{ scale: 1, opacity: 1, y: 0 }}
        exit={{ scale: 0.85, opacity: 0, y: 30 }}
        transition={{ type: 'spring', stiffness: 400, damping: 30 }}
        className="relative z-10 w-full max-w-lg"
      >
        {/* Glow effect */}
        <div className={cn('absolute inset-0 rounded-2xl opacity-20 blur-2xl bg-gradient-to-br pointer-events-none', typeColors[step.type] ?? 'from-indigo-600 to-purple-600')} />

        <div className="relative bg-[var(--color-bg-surface)] border border-[var(--color-border-subtle)] rounded-2xl overflow-hidden shadow-2xl">
          {/* Header */}
          <div className={cn('bg-gradient-to-r px-6 py-4 flex items-center justify-between', typeColors[step.type] ?? 'from-indigo-600 to-purple-600')}>
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-lg bg-white/20 flex items-center justify-center">
                {typeIcons[step.type]}
              </div>
              <div>
                <p className="text-sm font-bold text-white">{step.description || step.id}</p>
                <p className="text-xs text-white/70 uppercase tracking-wider font-mono">{step.type} step</p>
              </div>
            </div>
            <button onClick={onClose} className="text-white/70 hover:text-white p-1.5 rounded-md hover:bg-white/10 transition-colors">
              <X size={16} />
            </button>
          </div>

          {/* Body */}
          <div className="p-6 space-y-4">
            <div>
              <p className="text-[10px] uppercase tracking-wider text-[var(--color-text-muted)] font-semibold mb-1">Step ID</p>
              <p className="text-sm font-mono text-white bg-[var(--color-bg-hover)] px-3 py-1.5 rounded-md">{step.id}</p>
            </div>

            {step.type === 'agent' && (
              <>
                {step.config.agent_id && (
                  <div>
                    <p className="text-[10px] uppercase tracking-wider text-[var(--color-text-muted)] font-semibold mb-1">Agent ID</p>
                    <p className="text-xs font-mono text-[#a5b4fc] bg-[rgba(99,102,241,0.1)] px-3 py-1.5 rounded-md">{step.config.agent_id as string}</p>
                  </div>
                )}
                {step.config.query_template && (
                  <div>
                    <p className="text-[10px] uppercase tracking-wider text-[var(--color-text-muted)] font-semibold mb-1">Query Template</p>
                    <p className="text-sm text-[var(--color-text-secondary)] bg-[var(--color-bg-hover)] px-3 py-2 rounded-md italic">"{step.config.query_template as string}"</p>
                  </div>
                )}
              </>
            )}

            {step.type === 'tool' && (
              <>
                {step.config.tool_name && (
                  <div>
                    <p className="text-[10px] uppercase tracking-wider text-[var(--color-text-muted)] font-semibold mb-1">Tool Name</p>
                    <p className="text-sm font-mono text-[#f9a8d4] bg-[rgba(236,72,153,0.1)] px-3 py-1.5 rounded-md">{step.config.tool_name as string}</p>
                  </div>
                )}
                {step.config.arguments && (
                  <div>
                    <p className="text-[10px] uppercase tracking-wider text-[var(--color-text-muted)] font-semibold mb-1">Arguments</p>
                    <pre className="text-xs font-mono text-[var(--color-text-secondary)] bg-[var(--color-bg-hover)] px-3 py-2 rounded-md overflow-x-auto">
                      {JSON.stringify(step.config.arguments, null, 2)}
                    </pre>
                  </div>
                )}
              </>
            )}

            {step.type === 'condition' && (
              <>
                <div>
                  <p className="text-[10px] uppercase tracking-wider text-[var(--color-text-muted)] font-semibold mb-1">Expression</p>
                  <p className="text-sm font-mono text-[#fbbf24] bg-[rgba(245,158,11,0.1)] px-3 py-1.5 rounded-md">{step.config.expression as string}</p>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <p className="text-[10px] uppercase tracking-wider text-[var(--color-accent-success)] font-semibold mb-1">True → </p>
                    <p className="text-xs font-mono text-white bg-[rgba(34,197,94,0.1)] px-2 py-1 rounded">{step.config.true_step as string}</p>
                  </div>
                  <div>
                    <p className="text-[10px] uppercase tracking-wider text-[var(--color-accent-danger)] font-semibold mb-1">False → </p>
                    <p className="text-xs font-mono text-white bg-[rgba(239,68,68,0.1)] px-2 py-1 rounded">{step.config.false_step as string}</p>
                  </div>
                </div>
              </>
            )}

            {step.type === 'transform' && step.config.mappings && (
              <div>
                <p className="text-[10px] uppercase tracking-wider text-[var(--color-text-muted)] font-semibold mb-1">Mappings</p>
                <pre className="text-xs font-mono text-[var(--color-text-secondary)] bg-[var(--color-bg-hover)] px-3 py-2 rounded-md overflow-x-auto">
                  {JSON.stringify(step.config.mappings, null, 2)}
                </pre>
              </div>
            )}

            {step.next_steps?.length > 0 && (
              <div>
                <p className="text-[10px] uppercase tracking-wider text-[var(--color-text-muted)] font-semibold mb-1">Next Steps</p>
                <div className="flex flex-wrap gap-2">
                  {step.next_steps.map(ns => (
                    <span key={ns} className="px-2 py-0.5 rounded bg-[var(--color-bg-hover)] border border-[var(--color-border-subtle)] text-xs font-mono text-[var(--color-text-secondary)]">→ {ns}</span>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </motion.div>
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
    const { nodes: n, edges: e } = buildGraph(workflow, selectedStepId, handleSelect);
    setNodes(n);
    setEdges(e);
  }, [workflow, selectedStepId, handleSelect, setNodes, setEdges]);

  if (isLoading) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-2 border-[#6366f1] border-t-transparent rounded-full animate-spin" />
          <p className="text-sm text-[var(--color-text-muted)]">Loading workflow…</p>
        </div>
      </div>
    );
  }

  if (!workflow) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-4 p-8">
        <GitBranch size={32} className="text-[var(--color-text-muted)]" />
        <p className="text-sm text-[var(--color-text-secondary)]">Workflow "{workflowName}" not found.</p>
        <button onClick={() => navigate('/workflows')} className="btn-secondary px-4 py-2 text-sm rounded-md flex items-center gap-2">
          <ArrowLeft size={14} /> Back to Workflows
        </button>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
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
            {exportSuccess ? "Exported!" : "Export to Mistral"}
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

      {/* ReactFlow Canvas */}
      <div className="flex-1 relative">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          nodeTypes={NODE_TYPES}
          fitView
          fitViewOptions={{ padding: 0.3 }}
          className="!bg-[var(--color-bg-base)]"
          proOptions={{ hideAttribution: true }}
        >
          <Background
            variant={BackgroundVariant.Dots}
            gap={24}
            size={1}
            color="rgba(255,255,255,0.06)"
          />
          <Controls
            className="!bg-[var(--color-bg-surface)] !border !border-[var(--color-border-subtle)] !rounded-xl !shadow-xl"
            style={{ bottom: 24, left: 24 }}
          />
          <MiniMap
            style={{ background: 'var(--color-bg-surface)', border: '1px solid var(--color-border-subtle)', borderRadius: 12 }}
            nodeColor={(node) => {
              const map: Record<string, string> = { agent: '#6366f1', tool: '#ec4899', condition: '#f59e0b', transform: '#14b8a6' };
              return map[node.type ?? ''] ?? '#475569';
            }}
            maskColor="rgba(0,0,0,0.5)"
            position="bottom-right"
          />
        </ReactFlow>

        {/* Hint overlay */}
        {workflow.steps.length > 0 && !selectedStepId && (
          <div className="absolute top-4 left-1/2 -translate-x-1/2 pointer-events-none">
            <div className="bg-[var(--color-bg-surface)] border border-[var(--color-border-subtle)] rounded-full px-4 py-2 text-xs text-[var(--color-text-muted)] flex items-center gap-2 shadow-lg">
              <span>Click any node to inspect</span>
            </div>
          </div>
        )}
      </div>

      {/* Node Detail Modal */}
      <AnimatePresence>
        {selectedStep && (
          <NodeDetailModal step={selectedStep} onClose={() => setSelectedStepId(null)} />
        )}
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
