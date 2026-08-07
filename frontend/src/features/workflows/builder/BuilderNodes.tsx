/**
 * BuilderNodes — canvas node renderers for the visual builder.
 *
 * Deliberately more compact than the read-only WorkflowVisualizer cards: in an
 * editor the graph shape matters more than per-step detail, and detail lives in
 * the inspector. Each node surfaces only what you need to reason about wiring —
 * type, binding, entry marker, and validation state.
 */

import { memo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { AlertTriangle, Cpu, Flag, GitBranch, Shuffle, Wrench, XCircle } from 'lucide-react';
import type { ValidationIssue, WorkflowStep } from '../../../api/workflowBuilder';
import { STEP_META } from './graphModel';
import { getTierConfig } from '../../../components/ui/TierBadge';
import { cn } from '../../../lib/utils';

interface NodeData extends Record<string, unknown> {
  step: WorkflowStep;
  isEntry: boolean;
  issues: ValidationIssue[];
  hasError: boolean;
  hasWarning: boolean;
  /** Tools bound to this step's agent on Mistral (agent steps only). */
  agentTools?: string[];
  /** The bound agent id is not in the catalog — probably deleted on Mistral. */
  agentMissing?: boolean;
  /** A tool is being dragged over this node. */
  isToolDropTarget?: boolean;
}

const HANDLE_STYLE: React.CSSProperties = {
  width: 10,
  height: 10,
  border: '2px solid rgba(8,11,19,0.95)',
  boxShadow: '0 0 0 1px rgba(255,255,255,0.18)',
};

function StatusPip({ hasError, hasWarning }: { hasError: boolean; hasWarning: boolean }) {
  if (hasError) {
    return (
      <span
        title="This step has errors"
        className="w-5 h-5 rounded-md bg-red-500/15 border border-red-500/40 flex items-center justify-center shrink-0"
      >
        <XCircle size={11} className="text-red-400" />
      </span>
    );
  }
  if (hasWarning) {
    return (
      <span
        title="This step has warnings"
        className="w-5 h-5 rounded-md bg-amber-400/15 border border-amber-400/40 flex items-center justify-center shrink-0"
      >
        <AlertTriangle size={11} className="text-amber-400" />
      </span>
    );
  }
  return null;
}

interface ShellProps {
  data: NodeData;
  selected?: boolean;
  icon: React.ReactNode;
  accent: string;
  glow: string;
  typeLabel: string;
  children?: React.ReactNode;
  /** Condition nodes render their own labelled source handles. */
  customSourceHandles?: boolean;
}

function NodeShell({
  data,
  selected,
  icon,
  accent,
  glow,
  typeLabel,
  children,
  customSourceHandles,
}: ShellProps) {
  const { step, isEntry, hasError, hasWarning, isToolDropTarget } = data;

  const borderColor = isToolDropTarget
    ? '#f472b6'
    : hasError
      ? 'rgba(248,113,113,0.75)'
      : selected
        ? accent
        : hasWarning
          ? 'rgba(251,191,36,0.45)'
          : 'rgba(255,255,255,0.09)';

  return (
    <div
      className={cn(
        'rounded-xl backdrop-blur-md bg-[rgba(13,18,30,0.92)] transition-all duration-200 overflow-hidden',
        selected || isToolDropTarget ? 'border-2' : 'border',
      )}
      style={{
        borderColor,
        width: '100%',
        height: '100%',
        boxShadow: isToolDropTarget
          ? '0 0 0 4px rgba(244,114,182,0.22), 0 14px 34px rgba(0,0,0,0.6)'
          : selected
            ? `0 0 0 3px rgba(${glow},0.14), 0 14px 34px rgba(0,0,0,0.6)`
            : '0 8px 22px rgba(0,0,0,0.45)',
      }}
    >
      <Handle
        id="in"
        type="target"
        position={Position.Top}
        style={{ ...HANDLE_STYLE, background: 'rgba(148,163,184,0.9)' }}
      />

      {/* Accent rail */}
      <div className="h-[3px] w-full" style={{ background: accent }} />

      <div className="px-3 pt-2.5 pb-2 flex items-center gap-2">
        <div
          className="w-6 h-6 rounded-md flex items-center justify-center text-white shrink-0"
          style={{ background: accent }}
        >
          {icon}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-bold text-white leading-tight truncate" title={step.id}>
            {step.id}
          </p>
          <p className="text-[9px] uppercase tracking-wider font-semibold" style={{ color: accent }}>
            {typeLabel}
          </p>
        </div>
        {isEntry && (
          <span
            title="Entry step"
            className="w-5 h-5 rounded-md bg-emerald-400/15 border border-emerald-400/40 flex items-center justify-center shrink-0"
          >
            <Flag size={10} className="text-emerald-400" />
          </span>
        )}
        <StatusPip hasError={hasError} hasWarning={hasWarning} />
      </div>

      <div className="px-3 pb-2.5 space-y-1">{children}</div>

      {step.parallel_group && (
        <div className="px-3 pb-2">
          <span className="inline-flex items-center gap-1 text-[9px] font-mono px-1.5 py-0.5 rounded bg-cyan-400/10 border border-cyan-400/25 text-cyan-300">
            ∥ {step.parallel_group}
          </span>
        </div>
      )}

      {!customSourceHandles && (
        <Handle
          id="out"
          type="source"
          position={Position.Bottom}
          style={{ ...HANDLE_STYLE, background: accent }}
        />
      )}
    </div>
  );
}

/** One-line key/value row, truncated — full values live in the inspector. */
function Field({ label, value, mono }: { label: string; value?: string; mono?: boolean }) {
  const empty = !value;
  return (
    <div className="flex items-baseline gap-1.5 min-w-0">
      <span className="text-[9px] uppercase tracking-wide text-[var(--color-text-muted)] shrink-0">
        {label}
      </span>
      <span
        className={cn(
          'text-[10px] truncate min-w-0',
          mono && 'font-mono',
          empty ? 'text-red-400/80 italic' : 'text-[var(--color-text-secondary)]',
        )}
        title={value}
      >
        {value || 'not set'}
      </span>
    </div>
  );
}

/* ── Agent ──────────────────────────────────────────────────────────────── */

export const BuilderAgentNode = memo(function BuilderAgentNode({
  data,
  selected,
}: NodeProps) {
  const nodeData = data as NodeData;
  const cfg = nodeData.step.config ?? {};
  const meta = STEP_META.agent;
  const tier = nodeData.step.tier ?? undefined;
  const tierCfg = getTierConfig(tier ?? undefined);
  const tools = nodeData.agentTools ?? [];
  const visibleTools = tools.slice(0, 3);

  return (
    <NodeShell
      data={nodeData}
      selected={selected}
      icon={<Cpu size={12} />}
      accent={meta.accent}
      glow={meta.glow}
      typeLabel="Agent"
    >
      <Field label="agent" value={(cfg.agent_name as string) || (cfg.agent_id as string)} />
      <Field label="prompt" value={cfg.query_template as string} mono />

      {/* Tools the agent may call. Bound to the agent on Mistral, not the step. */}
      <div className="flex items-center gap-1 flex-wrap pt-0.5">
        <Wrench size={9} className="text-[var(--color-text-muted)] shrink-0" />
        {tools.length === 0 ? (
          <span className="text-[9px] text-[var(--color-text-muted)] italic">
            {nodeData.isToolDropTarget ? 'drop to attach' : 'no tools'}
          </span>
        ) : (
          <>
            {visibleTools.map((tool) => (
              <span
                key={tool}
                title={tool}
                className="px-1 py-px rounded bg-[rgba(236,72,153,0.1)] border border-[rgba(236,72,153,0.25)] text-[8.5px] font-mono text-[#f9a8d4] max-w-[74px] truncate"
              >
                {tool}
              </span>
            ))}
            {tools.length > visibleTools.length && (
              <span className="text-[8.5px] text-[var(--color-text-muted)]">
                +{tools.length - visibleTools.length}
              </span>
            )}
          </>
        )}
      </div>

      {tier && (
        <span
          className={cn(
            'inline-block text-[8px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded border mt-0.5',
            tierCfg.color,
            tierCfg.bg,
            tierCfg.border,
          )}
        >
          {tierCfg.label}
        </span>
      )}
    </NodeShell>
  );
});

/* ── Tool ───────────────────────────────────────────────────────────────── */

export const BuilderToolNode = memo(function BuilderToolNode({ data, selected }: NodeProps) {
  const nodeData = data as NodeData;
  const cfg = nodeData.step.config ?? {};
  const meta = STEP_META.tool;
  const args = (cfg.arguments_template ?? cfg.arguments) as Record<string, unknown> | undefined;
  const argCount = args ? Object.keys(args).length : 0;

  return (
    <NodeShell
      data={nodeData}
      selected={selected}
      icon={<Wrench size={12} />}
      accent={meta.accent}
      glow={meta.glow}
      typeLabel="Tool"
    >
      <Field label="tool" value={cfg.tool_name as string} mono />
      <Field label="args" value={argCount > 0 ? `${argCount} mapped` : 'none'} />
      {/* The builder no longer creates these — flag them so it is obvious the
          call bypasses any agent and the arguments are hand-written. */}
      <span
        title="Runs the tool directly, without an agent deciding how to call it"
        className="inline-flex items-center gap-1 text-[8px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded border border-amber-400/30 bg-amber-400/10 text-amber-400 mt-0.5"
      >
        direct call
      </span>
    </NodeShell>
  );
});

/* ── Condition ──────────────────────────────────────────────────────────── */

export const BuilderConditionNode = memo(function BuilderConditionNode({
  data,
  selected,
}: NodeProps) {
  const nodeData = data as NodeData;
  const cfg = nodeData.step.config ?? {};
  const meta = STEP_META.condition;

  return (
    <NodeShell
      data={nodeData}
      selected={selected}
      icon={<GitBranch size={12} />}
      accent={meta.accent}
      glow={meta.glow}
      typeLabel="Condition"
      customSourceHandles
    >
      <Field label="if" value={cfg.expression as string} mono />

      {/* Two labelled outputs so branch wiring is explicit on the canvas. */}
      <div className="flex items-center justify-between pt-1 text-[9px] font-bold uppercase tracking-wider">
        <span className="text-emerald-400">true</span>
        <span className="text-red-400">false</span>
      </div>

      <Handle
        id="true"
        type="source"
        position={Position.Bottom}
        style={{ ...HANDLE_STYLE, background: '#34d399', left: '28%' }}
      />
      <Handle
        id="false"
        type="source"
        position={Position.Bottom}
        style={{ ...HANDLE_STYLE, background: '#f87171', left: '72%' }}
      />
    </NodeShell>
  );
});

/* ── Transform ──────────────────────────────────────────────────────────── */

export const BuilderTransformNode = memo(function BuilderTransformNode({
  data,
  selected,
}: NodeProps) {
  const nodeData = data as NodeData;
  const cfg = nodeData.step.config ?? {};
  const meta = STEP_META.transform;
  const mappings = cfg.mappings as Record<string, unknown> | undefined;
  const summary = cfg.transform_code
    ? String(cfg.transform_code)
    : mappings && Object.keys(mappings).length > 0
      ? `${Object.keys(mappings).length} mapping(s)`
      : '';

  return (
    <NodeShell
      data={nodeData}
      selected={selected}
      icon={<Shuffle size={12} />}
      accent={meta.accent}
      glow={meta.glow}
      typeLabel="Transform"
    >
      <Field label="rule" value={summary} mono />
    </NodeShell>
  );
});

// The nodeTypes map lives in BuilderCanvas: exporting a non-component
// alongside components here would break React Fast Refresh for this file.
