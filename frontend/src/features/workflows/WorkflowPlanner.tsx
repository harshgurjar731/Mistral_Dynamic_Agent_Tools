import { useState, useRef, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  GitBranch, ArrowRight, CheckCircle2, AlertCircle,
  RefreshCw, Wrench, Cpu, Sparkles, CircleDot,
  Code2, Server, PackageCheck, PackagePlus, History, Zap,
  Shield, ListChecks, Share2, Repeat, Split, ShieldAlert
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { workflowPlannerApi, type PlannerEvent } from '../../api/workflowPlanner';
import { workflowsApi } from '../../api/workflows';
import { cn } from '../../lib/utils';
import { QK } from '../../lib/queryClient';
import PlannerHistoryPanel, { type PlannerHistoryEntry } from './PlannerHistoryPanel';
import PipelineTimeline, { type LayerManifestEntry, type LayerRuntime } from '../../components/pipeline/PipelineTimeline';
import AgentGuardrailCard from '../../components/pipeline/GuardrailCard';
import LibraryProvisionedCard from '../../components/pipeline/LibraryProvisionedCard';
import { usePipelineRun } from '../../components/pipeline/usePipelineRun';

import { getTierConfig, TierBadge } from '../../components/ui/TierBadge';

/* ── Timeline Step Types ──────────────────────────────────────────────── */
export interface TimelineStep {
  id: string;
  type: 'status' | 'capabilities' | 'execution_modes' | 'reuse_plan'
      | 'activity_plan' | 'agent_designed' | 'library_provisioned'
      | 'topology' | 'data_flow'
      | 'workflow_guardrails' | 'validation'
      | 'tool_exists' | 'tool_new' | 'activity_new' | 'agent_exists' | 'agent_new'
      | 'workflow_ready' | 'compiled' | 'registered' | 'fatal_error' | 'error';
  content: string | Record<string, unknown>;
  status: 'pending' | 'active' | 'completed';
}

/* ── Sub-cards ────────────────────────────────────────────────────────── */

type Capability = {
  id: string; name: string; purpose: string;
  tier: string; kind: string; depends_on: string[]; parallelisable: boolean;
};

const KIND_STYLE: Record<string, { icon: typeof Cpu; text: string; bg: string; border: string }> = {
  agent:     { icon: Cpu,    text: 'text-[#a5b4fc]',   bg: 'bg-[rgba(99,102,241,0.1)]', border: 'border-[rgba(99,102,241,0.2)]' },
  activity:  { icon: Zap,    text: 'text-pink-300',    bg: 'bg-[rgba(236,72,153,0.1)]', border: 'border-[rgba(236,72,153,0.2)]' },
  connector: { icon: Server, text: 'text-emerald-300', bg: 'bg-[rgba(16,185,129,0.1)]', border: 'border-[rgba(16,185,129,0.2)]' },
};

/** Why a layer decided what it decided. Every decision event carries one. */
function Rationale({ text }: { text?: unknown }) {
  if (!text || typeof text !== 'string') return null;
  return (
    <p className="text-[11px] text-[var(--color-text-muted)] mt-3 pt-3 border-t border-[var(--color-border-subtle)] italic leading-relaxed">
      {text}
    </p>
  );
}

function CapabilitiesCard({ data }: { data: Record<string, unknown> }) {
  const caps = (data.capabilities as Capability[]) ?? [];
  return (
    <div className="surface-card rounded-xl p-5 mt-2 border border-[rgba(99,102,241,0.15)]">
      <p className="text-xs font-semibold uppercase tracking-wider text-[var(--color-text-muted)] mb-3">
        Required Capabilities ({caps.length})
      </p>
      {!!data.description && (
        <p className="text-sm text-[var(--color-text-secondary)] mb-4 italic">
          "{data.description as string}"
        </p>
      )}
      <div className="space-y-1.5">
        {caps.map((c, i) => {
          const style = KIND_STYLE[c.kind] ?? KIND_STYLE.agent;
          const Icon = style.icon;
          return (
            <div key={c.id} className="flex items-start gap-2.5 text-xs">
              <span className="text-[10px] font-mono text-[var(--color-text-muted)] w-5 shrink-0 pt-0.5">{i + 1}.</span>
              <Icon size={12} className={cn(style.text, 'shrink-0 mt-0.5')} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-medium text-[var(--color-text-primary)]">{c.name}</span>
                  <span className={cn('px-1.5 py-0.5 rounded text-[9px] font-mono border', style.bg, style.border, style.text)}>
                    {c.kind}
                  </span>
                  {c.parallelisable && (
                    <span className="text-[9px] uppercase tracking-wider text-amber-300/80">parallel</span>
                  )}
                </div>
                <p className="text-[var(--color-text-muted)] mt-0.5">{c.purpose}</p>
              </div>
            </div>
          );
        })}
      </div>
      <Rationale text={data.reasoning} />
    </div>
  );
}

function ReusePlanCard({ data }: { data: Record<string, unknown> }) {
  const reused = (data.reused as Array<Record<string, string>>) ?? [];
  const toCreate = (data.to_create as Array<Record<string, string>>) ?? [];
  return (
    <div className="surface-card rounded-xl p-5 mt-2 border border-[rgba(99,102,241,0.15)]">
      <p className="text-xs font-semibold uppercase tracking-wider text-[var(--color-text-muted)] mb-3 flex items-center gap-1.5">
        <Repeat size={11} /> Reuse Decision
      </p>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <p className="text-[10px] uppercase tracking-wider text-emerald-400/80 mb-2 font-medium">
            Reusing ({reused.length})
          </p>
          <div className="space-y-1.5">
            {reused.map(r => (
              <div key={r.capability} className="text-[11px]">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="font-mono text-[var(--color-text-primary)]">{r.capability}</span>
                  {r.guardrail_fit === 'adequate' && (
                    <span className="flex items-center gap-1 text-[9px] uppercase tracking-wider text-emerald-400/80">
                      <Shield size={9} /> safety ok
                    </span>
                  )}
                </div>
                <p className="text-[var(--color-text-muted)] mt-0.5">{r.reason}</p>
              </div>
            ))}
            {reused.length === 0 && <span className="text-xs text-[var(--color-text-muted)]">Nothing reusable</span>}
          </div>
        </div>
        <div>
          <p className="text-[10px] uppercase tracking-wider text-[#a5b4fc] mb-2 font-medium">
            Creating ({toCreate.length})
          </p>
          <div className="space-y-1.5">
            {toCreate.map(c => (
              <div key={c.capability} className="text-[11px]">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="font-mono text-[var(--color-text-primary)]">{c.name}</span>
                  {c.guardrail_fit === 'insufficient' && (
                    <span className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-amber-400/10 border border-amber-400/25 text-[9px] uppercase tracking-wider text-amber-300">
                      <ShieldAlert size={9} /> safety gap
                    </span>
                  )}
                </div>
                <p className="text-[var(--color-text-muted)] mt-0.5">{c.reason}</p>
                {!!c.guardrail_gap && (
                  <p className="text-amber-300/90 mt-0.5">Missing: {c.guardrail_gap}</p>
                )}
              </div>
            ))}
            {toCreate.length === 0 && <span className="text-xs text-[var(--color-text-muted)]">Nothing new needed</span>}
          </div>
        </div>
      </div>
      <Rationale text={data.reasoning} />
    </div>
  );
}

function TopologyCard({ data }: { data: Record<string, unknown> }) {
  const steps = (data.steps as Array<Record<string, unknown>>) ?? [];
  return (
    <div className="surface-card rounded-xl p-5 mt-2 border border-[rgba(99,102,241,0.15)]">
      <p className="text-xs font-semibold uppercase tracking-wider text-[var(--color-text-muted)] mb-3 flex items-center gap-1.5">
        <Share2 size={11} /> Graph Shape ({steps.length} steps)
      </p>
      <div className="space-y-1">
        {steps.map(st => (
          <div key={st.id as string} className="flex items-center gap-2 text-[11px] flex-wrap">
            <span className="font-mono text-[var(--color-text-primary)]">{st.id as string}</span>
            <span className="text-[9px] px-1.5 py-0.5 rounded bg-[var(--color-bg-hover)] border border-[var(--color-border-subtle)] text-[var(--color-text-muted)]">
              {st.type as string}
            </span>
            {!!st.parallel_group && (
              <span className="text-[9px] uppercase tracking-wider text-amber-300/80">
                concurrent: {st.parallel_group as string}
              </span>
            )}
            {((st.next_steps as string[]) ?? []).length > 0 && (
              <>
                <ArrowRight size={10} className="text-[var(--color-text-muted)]" />
                <span className="font-mono text-[var(--color-text-muted)]">
                  {((st.next_steps as string[]) ?? []).join(', ')}
                </span>
              </>
            )}
          </div>
        ))}
      </div>
      <Rationale text={data.reasoning} />
    </div>
  );
}

function DataFlowCard({ data }: { data: Record<string, unknown> }) {
  const inputs = (data.input_schema as Array<Record<string, unknown>>) ?? [];
  const steps = (data.steps as Array<Record<string, unknown>>) ?? [];
  return (
    <div className="surface-card rounded-xl p-5 mt-2 border border-[rgba(99,102,241,0.15)]">
      <p className="text-xs font-semibold uppercase tracking-wider text-[var(--color-text-muted)] mb-3 flex items-center gap-1.5">
        <ArrowRight size={11} /> Data Flow
      </p>
      {inputs.length > 0 && (
        <div className="mb-3">
          <p className="text-[10px] uppercase tracking-wider text-[var(--color-text-muted)] mb-1.5 font-medium">Workflow inputs</p>
          <div className="flex flex-wrap gap-1.5">
            {inputs.map(i => (
              <span key={i.name as string} className="px-2 py-0.5 rounded bg-[rgba(99,102,241,0.1)] border border-[rgba(99,102,241,0.2)] text-[11px] font-mono text-[#a5b4fc]">
                {i.name as string}{i.required ? '' : '?'}
              </span>
            ))}
          </div>
        </div>
      )}
      <div className="space-y-1">
        {steps.map(st => (
          <div key={st.id as string} className="flex items-center gap-2 text-[11px]">
            <span className="font-mono text-[var(--color-text-primary)]">{st.id as string}</span>
            <span className="text-[var(--color-text-muted)] font-mono text-[10px]">
              {((st.config_keys as string[]) ?? []).join(' / ') || 'no config'}
            </span>
          </div>
        ))}
      </div>
      <Rationale text={data.reasoning} />
    </div>
  );
}

function GuardrailCard({ data }: { data: Record<string, unknown> }) {
  if (data.reviewed === false) {
    return (
      <div className="surface-card rounded-xl p-4 mt-2 border border-[rgba(245,158,11,0.25)] flex items-center gap-2.5">
        <AlertCircle size={14} className="text-amber-400 shrink-0" />
        <p className="text-xs text-amber-300">{data.reasoning as string}</p>
      </div>
    );
  }
  const missing = (data.missing_gates as Array<Record<string, unknown>>) ?? [];
  const exposure = (data.data_exposure as Array<Record<string, string>>) ?? [];
  const policy = (data.workflow_policy as Record<string, unknown>) ?? {};
  return (
    <div className="surface-card rounded-xl p-5 mt-2 border border-[rgba(16,185,129,0.2)] bg-[rgba(16,185,129,0.03)]">
      <p className="text-xs font-semibold uppercase tracking-wider text-[var(--color-text-muted)] mb-3 flex items-center gap-1.5">
        <Shield size={11} /> Safety Review
      </p>
      <div className="flex flex-wrap gap-3 text-[11px] mb-3">
        <span className={cn('flex items-center gap-1', data.has_input_gate ? 'text-emerald-400' : 'text-amber-400')}>
          {data.has_input_gate ? <CheckCircle2 size={11} /> : <AlertCircle size={11} />} Input gate
        </span>
        <span className={cn('flex items-center gap-1', data.has_output_gate ? 'text-emerald-400' : 'text-amber-400')}>
          {data.has_output_gate ? <CheckCircle2 size={11} /> : <AlertCircle size={11} />} Output gate
        </span>
        <span className="text-[var(--color-text-muted)]">
          PII: <strong className="text-white">{policy.pii_policy as string}</strong>
        </span>
      </div>
      {missing.length > 0 && (
        <div className="mb-3">
          <p className="text-[10px] uppercase tracking-wider text-amber-400/80 mb-1.5 font-medium">Missing gates</p>
          {missing.map((g, i) => (
            <p key={i} className="text-[11px] text-[var(--color-text-secondary)]">
              After <span className="font-mono">{g.after_step as string}</span> &mdash; {g.purpose as string}
            </p>
          ))}
        </div>
      )}
      {exposure.length > 0 && (
        <div>
          <p className="text-[10px] uppercase tracking-wider text-[var(--color-text-muted)] mb-1.5 font-medium">Data exposure</p>
          {exposure.map((e, i) => (
            <p key={i} className="text-[11px] text-[var(--color-text-secondary)]">
              <span className="font-mono">{e.from}</span> &rarr; <span className="font-mono">{e.to}</span>: {e.risk}
            </p>
          ))}
        </div>
      )}
      <Rationale text={data.reasoning} />
    </div>
  );
}

function ValidationCard({ data }: { data: Record<string, unknown> }) {
  const issues = (data.issues as Array<Record<string, string>>) ?? [];
  const valid = data.valid as boolean;
  return (
    <div className={cn(
      'surface-card rounded-xl p-4 mt-2 border',
      valid ? 'border-[rgba(16,185,129,0.2)]' : 'border-[rgba(239,68,68,0.25)]',
    )}>
      <div className="flex items-center gap-2.5">
        <ListChecks size={14} className={valid ? 'text-emerald-400' : 'text-red-400'} />
        <p className="text-xs font-semibold text-white">
          {valid
            ? 'Validated — ready to register'
            : `${data.error_count as number} error(s) — saved, but not registered`}
        </p>
      </div>
      {issues.length > 0 && (
        <div className="mt-3 space-y-1">
          {issues.map((iss, i) => (
            <p key={i} className={cn('text-[11px]', iss.severity === 'error' ? 'text-red-300' : 'text-amber-300')}>
              {iss.step_id && <span className="font-mono">{iss.step_id}: </span>}{iss.message}
            </p>
          ))}
        </div>
      )}
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

function ActivityCard({ data }: { data: Record<string, unknown> }) {
  const status = data.status as string | undefined;
  const label =
    status === 'existing' ? 'Standalone step' : status === 'approved' ? 'Synthesised & Approved' : (status ?? 'Activity');
  return (
    <div className="flex items-center justify-between rounded-lg px-4 py-2.5 mt-2 shadow-lg transition-all border border-[rgba(244,114,182,0.3)] bg-gradient-to-br from-[rgba(244,114,182,0.15)] to-[rgba(244,114,182,0.02)] backdrop-blur-md">
      <div className="flex items-center gap-2.5">
        <Zap size={14} className="text-pink-300" />
        <span className="text-sm font-mono text-[var(--color-text-primary)]">{data.tool_name as string}</span>
        <span className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full border text-pink-300 bg-[rgba(244,114,182,0.1)] border-[rgba(244,114,182,0.25)]">
          Activity
        </span>
      </div>
      <span className="text-[10px] font-medium uppercase px-2 py-0.5 rounded border text-pink-300 bg-[rgba(244,114,182,0.1)] border-[rgba(244,114,182,0.25)]">
        {label}
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
  // The full DAG rides along on this event — use it to break the step count
  // down by kind rather than just reporting a bare total.
  const dagSteps = ((data.dag as Record<string, unknown> | undefined)?.steps ?? []) as Array<{ type?: string }>;
  const activityCount = dagSteps.filter(s => s.type === 'tool').length;

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
      <div className="flex flex-wrap gap-4 text-xs text-[var(--color-text-muted)]">
        <span><strong className="text-white">{data.step_count as number}</strong> steps</span>
        <span><strong className="text-white">{(data.agents as string[])?.length ?? 0}</strong> agents</span>
        {activityCount > 0 && (
          <span className="flex items-center gap-1">
            <Zap size={11} className="text-pink-300" />
            <strong className="text-white">{activityCount}</strong> activit{activityCount === 1 ? 'y' : 'ies'}
          </span>
        )}
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
        {!!data.mistral_workflow_id && (
          <p className="text-[10px] text-emerald-400 font-mono truncate mt-0.5">ID: {data.mistral_workflow_id as string}</p>
        )}
      </div>
      <span className="ml-auto text-[10px] bg-emerald-400/10 text-emerald-400 border border-emerald-400/20 px-2 py-0.5 rounded-full uppercase font-medium shrink-0">Live</span>
    </div>
  );
}

/* ── Timeline grouping ────────────────────────────────────────────────── */

/**
 * Consecutive tool events and consecutive activity events collapse into one
 * labelled section each, so the timeline reads as "here is what was built for
 * the agents to call" and "here is what became a step of its own" rather than
 * a flat run of similar-looking cards.
 *
 * Grouping is deliberately *consecutive* only — the two kinds are synthesised
 * in different phases (tools in Phase 2, activities in Phase 4b), and merging
 * across the phases between them would misrepresent the order things happened.
 */
type TimelineRow =
  | { kind: 'single'; key: string; step: TimelineStep }
  | { kind: 'group'; family: 'tool' | 'activity'; key: string; steps: TimelineStep[] };

const GROUP_META = {
  tool: {
    label: 'Tools',
    caption: 'attached to agents',
    icon: Wrench,
    dot: '#818cf8',
    text: 'text-[#a5b4fc]',
    border: 'border-[rgba(129,140,248,0.25)]',
    bg: 'bg-[rgba(129,140,248,0.05)]',
  },
  activity: {
    label: 'Activities',
    caption: 'standalone workflow steps',
    icon: Zap,
    dot: '#f472b6',
    text: 'text-pink-300',
    border: 'border-[rgba(244,114,182,0.25)]',
    bg: 'bg-[rgba(244,114,182,0.05)]',
  },
} as const;

function familyOf(type: TimelineStep['type']): 'tool' | 'activity' | null {
  if (type === 'tool_exists' || type === 'tool_new') return 'tool';
  if (type === 'activity_new') return 'activity';
  return null;
}

/**
 * Which layer produced each kind of card.
 *
 * The planner is a chain of single-decision layers, so every payload it emits
 * belongs to exactly one of them. Attaching cards this way puts each decision's
 * evidence directly under the decision, instead of in a parallel log whose
 * ordering only coincidentally matched.
 */
const CARD_OWNER: Partial<Record<TimelineStep['type'], string>> = {
  capabilities:        'goal_decomposition',
  execution_modes:     'execution_mode',
  reuse_plan:          'capability_reuse',
  // One consolidated plan per layer, not a scatter of one-line rows. The
  // per-activity events are still accepted for older history entries.
  activity_plan:       'activity_gap',
  tool_exists:         'activity_gap',
  tool_new:            'activity_gap',
  activity_new:        'activity_gap',
  agent_designed:      'agent_design',
  library_provisioned: 'agent_provisioning',
  agent_exists:        'agent_provisioning',
  agent_new:           'agent_provisioning',
  topology:            'step_topology',
  data_flow:           'data_flow',
  workflow_guardrails: 'workflow_guardrail',
  validation:          'workflow_validation',
  workflow_ready:      'workflow_persistence',
  compiled:            'workflow_compilation',
  registered:          'workflow_registration',
};

const MODE_STYLE: Record<string, { icon: typeof Cpu; text: string; bg: string; border: string; label: string }> = {
  agent:     { icon: Cpu,    text: 'text-[#a5b4fc]',   bg: 'bg-[rgba(99,102,241,0.1)]', border: 'border-[rgba(99,102,241,0.2)]', label: 'Agent' },
  activity:  { icon: Zap,    text: 'text-pink-300',    bg: 'bg-[rgba(236,72,153,0.1)]', border: 'border-[rgba(236,72,153,0.2)]', label: 'Function' },
  connector: { icon: Server, text: 'text-emerald-300', bg: 'bg-[rgba(16,185,129,0.1)]', border: 'border-[rgba(16,185,129,0.2)]', label: 'Integration' },
};

function ExecutionModesCard({ data }: { data: Record<string, unknown> }) {
  const decisions = (data.decisions as Array<Record<string, unknown>>) ?? [];
  const counts = (data.counts as Record<string, number>) ?? {};
  const pruned = (data.pruned as Array<Record<string, string>>) ?? [];
  return (
    <div className="surface-card rounded-xl p-5 mt-2 border border-[rgba(99,102,241,0.15)]">
      <p className="text-xs font-semibold uppercase tracking-wider text-[var(--color-text-muted)] mb-3 flex items-center gap-1.5">
        <Split size={11} /> How Each Step Runs
      </p>
      <div className="flex flex-wrap gap-3 text-[11px] mb-4">
        {Object.entries(MODE_STYLE).map(([mode, style]) => (
          <span key={mode} className={cn('px-2 py-0.5 rounded border', style.bg, style.border, style.text)}>
            {counts[mode] ?? 0} {style.label.toLowerCase()}{(counts[mode] ?? 0) === 1 ? '' : 's'}
          </span>
        ))}
        {pruned.length > 0 && (
          <span className="px-2 py-0.5 rounded border border-amber-400/25 bg-amber-400/10 text-amber-300">
            {pruned.length} removed
          </span>
        )}
      </div>
      <div className="space-y-2">
        {decisions.map(d => {
          const style = MODE_STYLE[d.mode as string] ?? MODE_STYLE.agent;
          const Icon = style.icon;
          return (
            <div key={d.id as string} className="flex items-start gap-2.5 text-xs">
              <Icon size={12} className={cn(style.text, 'shrink-0 mt-0.5')} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-medium text-[var(--color-text-primary)]">{d.name as string}</span>
                  <span className={cn('px-1.5 py-0.5 rounded text-[9px] border', style.bg, style.border, style.text)}>
                    {style.label}
                  </span>
                  {d.mode === 'agent' && !d.agent_needs_tools && (
                    <span className="text-[9px] uppercase tracking-wider text-[var(--color-text-muted)]">no tools</span>
                  )}
                </div>
                <p className="text-[var(--color-text-muted)] mt-0.5">{d.rationale as string}</p>
              </div>
            </div>
          );
        })}
      </div>
      {pruned.length > 0 && (
        <div className="mt-3 pt-3 border-t border-[var(--color-border-subtle)]">
          <p className="text-[10px] uppercase tracking-wider text-amber-400/80 mb-1.5">Removed as redundant</p>
          {pruned.map((pr, i) => (
            <p key={i} className="text-[11px] text-[var(--color-text-secondary)]">
              <span className="font-mono">{pr.capability}</span> merged into{' '}
              <span className="font-mono">{pr.merged_into}</span>
            </p>
          ))}
        </div>
      )}
      <Rationale text={data.reasoning} />
    </div>
  );
}

function ActivityPlanCard({ data }: { data: Record<string, unknown> }) {
  const reused = (data.reused as Array<Record<string, string>>) ?? [];
  const built = (data.built as Array<Record<string, unknown>>) ?? [];
  const failed = (data.failed as Array<Record<string, string>>) ?? [];
  if (data.note && reused.length === 0 && built.length === 0) {
    return (
      <div className="surface-card rounded-xl p-4 mt-2 border border-[var(--color-border-subtle)]">
        <p className="text-xs text-[var(--color-text-muted)]">{data.note as string}</p>
      </div>
    );
  }
  return (
    <div className="surface-card rounded-xl p-5 mt-2 border border-[rgba(236,72,153,0.18)]">
      <p className="text-xs font-semibold uppercase tracking-wider text-[var(--color-text-muted)] mb-3 flex items-center gap-1.5">
        <Zap size={11} className="text-pink-300" /> Deterministic Steps
      </p>

      {reused.length > 0 && (
        <div className="mb-4">
          <p className="text-[10px] uppercase tracking-wider text-emerald-400/80 mb-2">
            Already existed ({reused.length})
          </p>
          {reused.map(r => (
            <div key={r.capability} className="flex items-center gap-2 text-[11px] mb-1">
              <PackageCheck size={11} className="text-[var(--color-text-muted)] shrink-0" />
              <span className="font-mono text-[var(--color-text-primary)]">{r.tool_name}</span>
              <span className="text-[var(--color-text-muted)]">for {r.capability_name}</span>
            </div>
          ))}
        </div>
      )}

      {built.length > 0 && (
        <div>
          <p className="text-[10px] uppercase tracking-wider text-pink-300/80 mb-2">
            Built now ({built.length})
          </p>
          <div className="space-y-2">
            {built.map(b => (
              <div key={b.tool_name as string} className="rounded-lg border border-[rgba(236,72,153,0.2)] bg-[rgba(236,72,153,0.04)] px-3 py-2">
                <div className="flex items-center gap-2 flex-wrap">
                  <PackagePlus size={11} className="text-[#f9a8d4] shrink-0" />
                  <span className="text-[11px] font-mono text-[var(--color-text-primary)]">{b.tool_name as string}</span>
                  <span className="text-[10px] text-[var(--color-text-muted)]">for {b.capability_name as string}</span>
                </div>
                {!!b.description && (
                  <p className="text-[11px] text-[var(--color-text-secondary)] mt-1">{b.description as string}</p>
                )}
                {((b.parameters as string[]) ?? []).length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-1.5">
                    {((b.parameters as string[]) ?? []).map(pn => (
                      <span key={pn} className="px-1.5 py-0.5 rounded bg-[rgba(236,72,153,0.1)] text-[10px] font-mono text-[#f9a8d4]">
                        {pn}{((b.required as string[]) ?? []).includes(pn) ? '' : '?'}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {failed.length > 0 && (
        <div className="mt-3 pt-3 border-t border-[var(--color-border-subtle)]">
          <p className="text-[10px] uppercase tracking-wider text-amber-400/80 mb-1.5">
            Could not be built ({failed.length})
          </p>
          {failed.map((f, i) => (
            <p key={i} className="text-[11px] text-amber-300">
              <span className="font-mono">{f.tool_name}</span>
              {f.deferred ? " (built on the first run)" : " (cannot run until rebuilt or re-planned)"}
              {f.rolled_back ? " · broken build rolled back" : ""}: {f.error}
            </p>
          ))}
        </div>
      )}
      <Rationale text={data.reasoning} />
    </div>
  );
}

function AgentDesignedCard({ data }: { data: Record<string, unknown> }) {
  const tools = (data.tools as string[]) ?? [];
  const g = data.guardrails as Record<string, unknown> | null;
  const cfg = getTierConfig(data.tier as string | undefined);
  return (
    <div className={cn('rounded-xl p-4 mt-2 border', cfg.cardBg, cfg.cardBorder)}>
      <div className="flex items-center gap-2 flex-wrap">
        <Cpu size={13} className={cfg.color} />
        <span className="text-xs font-bold text-white">{data.agent_name as string}</span>
        <TierBadge tier={data.tier as string | undefined} />
        <span className="text-[10px] font-mono text-[var(--color-text-muted)]">
          {data.model as string}{data.temperature !== undefined ? ` · ${data.temperature}` : ''}
        </span>
        <span className="ml-auto text-[10px] text-[var(--color-text-muted)]">
          {data.instruction_chars as number} chars of instructions
        </span>
      </div>
      {!!data.output_contract && (
        <p className="text-[11px] text-[var(--color-text-secondary)] mt-2">
          <span className="text-[var(--color-text-muted)]">Returns — </span>{data.output_contract as string}
        </p>
      )}
      {tools.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-2">
          {tools.map(t => (
            <span key={t} className="px-1.5 py-0.5 rounded bg-[rgba(236,72,153,0.08)] border border-[rgba(236,72,153,0.15)] text-[10px] font-mono text-[#f9a8d4]">{t}</span>
          ))}
        </div>
      )}
      {!!data.requested_library && (
        <p className="text-[11px] text-[#a5b4fc] mt-2">
          Needs a document library that does not exist yet — “
          {(data.requested_library as Record<string, string>).name}” will be created empty.
        </p>
      )}
      {g && <AgentGuardrailCard data={g} compact />}
      <Rationale text={data.reasoning} />
    </div>
  );
}

/**
 * The card for one payload. Pure — it closes over nothing in the component,
 * which is what lets the layer-cards memo call it before the component body
 * has finished evaluating.
 */
function renderCard(step: TimelineStep) {
  if (step.type === 'capabilities') return <CapabilitiesCard data={step.content as Record<string, unknown>} />;
  if (step.type === 'execution_modes') return <ExecutionModesCard data={step.content as Record<string, unknown>} />;
  if (step.type === 'reuse_plan') return <ReusePlanCard data={step.content as Record<string, unknown>} />;
  if (step.type === 'activity_plan') return <ActivityPlanCard data={step.content as Record<string, unknown>} />;
  if (step.type === 'agent_designed') return <AgentDesignedCard data={step.content as Record<string, unknown>} />;
  if (step.type === 'library_provisioned') return <LibraryProvisionedCard data={step.content as Record<string, any>} />;
  if (step.type === 'topology') return <TopologyCard data={step.content as Record<string, unknown>} />;
  if (step.type === 'data_flow') return <DataFlowCard data={step.content as Record<string, unknown>} />;
  if (step.type === 'workflow_guardrails') return <GuardrailCard data={step.content as Record<string, unknown>} />;
  if (step.type === 'validation') return <ValidationCard data={step.content as Record<string, unknown>} />;
  if (step.type === 'tool_exists') return <ToolExistsCard data={step.content as Record<string, unknown>} />;
  if (step.type === 'tool_new') return <ToolNewCard data={step.content as Record<string, unknown>} />;
  if (step.type === 'activity_new') return <ActivityCard data={step.content as Record<string, unknown>} />;
  if (step.type === 'agent_exists') return <AgentExistsCard data={step.content as Record<string, unknown>} />;
  if (step.type === 'agent_new') return <AgentNewCard data={step.content as Record<string, unknown>} />;
  if (step.type === 'workflow_ready') return <WorkflowReadyCard data={step.content as Record<string, unknown>} />;
  if (step.type === 'compiled') return <CompiledCard data={step.content as Record<string, unknown>} />;
  if (step.type === 'registered') return <RegisteredCard data={step.content as Record<string, unknown>} />;
  return null;
}

function groupTimeline(steps: TimelineStep[]): TimelineRow[] {
  const rows: TimelineRow[] = [];
  for (const step of steps) {
    const family = familyOf(step.type);
    if (!family) {
      rows.push({ kind: 'single', key: step.id, step });
      continue;
    }
    const last = rows[rows.length - 1];
    if (last?.kind === 'group' && last.family === family) {
      last.steps.push(step);
    } else {
      rows.push({ kind: 'group', family, key: step.id, steps: [step] });
    }
  }
  return rows;
}

/* ── Main Component ───────────────────────────────────────────────────── */

export default function WorkflowPlanner() {
  const [input, setInput] = useState('');
  const [isPlanning, setIsPlanning] = useState(false);
  const [steps, setSteps] = useState<TimelineStep[]>([]);
  const { run, reset, restore, handleEvent, settle, failRunning } = usePipelineRun();
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
        // Reconstruct a minimal timeline from the workflow definition. A
        // "tool"-type DAG step is a standalone Activity (see graphModel.ts) —
        // never an agent capability — so it renders as one here too.
        const wfSteps = (wf.steps ?? []) as Record<string, any>[];
        const agentSteps = wfSteps.filter(s => s.type === 'agent');
        const activitySteps = wfSteps.filter(s => s.type === 'tool');
        const agentNames = agentSteps.map(s => s.config?.agent_name ?? s.config?.agent_id ?? s.id);

        // Reconstruct the capability list from the saved DAG. The planner's
        // own decomposition is not recoverable — dependency edges and stated
        // purposes are not persisted — so this shows what the steps became
        // rather than what was originally asked for.
        steps.push({
          id: `${wf.name}-capabilities`,
          type: 'capabilities',
          content: {
            workflow_name: wf.name,
            description: wf.description ?? '',
            capabilities: wfSteps.map(s => ({
              id: s.id,
              name: s.config?.agent_name ?? s.config?.tool_name ?? s.id,
              purpose: s.description ?? '',
              tier: s.tier ?? 'domain',
              kind: s.type === 'tool' ? 'activity'
                : s.type === 'connector' ? 'connector'
                : 'agent',
              depends_on: [],
              parallelisable: !!s.parallel_group,
            })),
          },
          status: 'completed',
        });

        activitySteps.forEach(s => {
          steps.push({
            id: `${wf.name}-activity-${s.id}`,
            type: 'activity_new',
            content: { tool_name: s.config?.tool_name ?? s.id, status: 'existing' },
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
            dag: { steps: wfSteps },
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

  const saveToHistory = (
    goalToSave: string,
    finalSteps: TimelineStep[],
    finalWorkflowName: string | null,
    fatalError: boolean,
    finalManifest: LayerManifestEntry[],
    finalRuntime: Record<string, LayerRuntime>,
  ) => {
    setHistory(prev => {
      const newEntry: PlannerHistoryEntry = {
        id: crypto.randomUUID(),
        timestamp: Date.now(),
        goal: goalToSave,
        workflowName: finalWorkflowName,
        steps: finalSteps,
        hasFatalError: fatalError,
        manifest: finalManifest,
        runtime: finalRuntime,
      };
      const updated = [newEntry, ...prev].slice(0, 50);
      localStorage.setItem('agent_planner_history', JSON.stringify(updated));
      return updated;
    });
  };

  /** Cards grouped under the layer that produced them. */
  const layerCards = useMemo(() => {
    const byLayer: Record<string, React.ReactNode[]> = {};
    for (const step of steps) {
      const owner = CARD_OWNER[step.type];
      if (!owner) continue;
      (byLayer[owner] ??= []).push(
        <div key={step.id}>{renderCard(step)}</div>,
      );
    }
    return Object.fromEntries(
      Object.entries(byLayer).map(([layer, nodes]) => [
        layer,
        <div className="space-y-2">{nodes}</div>,
      ]),
    );
  }, [steps]);

  /** The decision payloads behind each layer, for the raw JSON view. */
  const layerRaw = useMemo(() => {
    const byLayer: Record<string, unknown[]> = {};
    for (const step of steps) {
      const owner = CARD_OWNER[step.type];
      if (!owner || typeof step.content === 'string') continue;
      (byLayer[owner] ??= []).push(step.content);
    }
    return Object.fromEntries(
      Object.entries(byLayer).map(([k, v]) => [k, v.length === 1 ? v[0] : v]),
    );
  }, [steps]);

  /**
   * Rows the layer timeline does not own.
   *
   * A live run leaves only errors here. History entries synthesised from a
   * saved workflow have no manifest at all, so they still render as the
   * grouped rows they were written for.
   */
  const legacyRows = useMemo(() => {
    const unowned = run.manifest.length > 0
      ? steps.filter(st => !CARD_OWNER[st.type])
      : steps;
    return groupTimeline(unowned);
  }, [steps, run.manifest.length]);

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
  }, [steps, run]);

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
    reset();

    const cancel = workflowPlannerApi.plan(
      goal,
      (event: PlannerEvent) => {
        // `pipeline`, `layer` and `status` drive the chain itself.
        if (handleEvent(event.type, event.data)) return;

        if (event.type === 'capabilities') {
          try { addStep('capabilities', JSON.parse(event.data)); } catch { /* ignore */ }
        } else if (event.type === 'execution_modes') {
          try { addStep('execution_modes', JSON.parse(event.data)); } catch { /* ignore */ }
        } else if (event.type === 'reuse_plan') {
          try { addStep('reuse_plan', JSON.parse(event.data)); } catch { /* ignore */ }
        } else if (event.type === 'activity_plan') {
          try { addStep('activity_plan', JSON.parse(event.data)); } catch { /* ignore */ }
        } else if (event.type === 'agent_designed') {
          try { addStep('agent_designed', JSON.parse(event.data)); } catch { /* ignore */ }
        } else if (event.type === 'library_provisioned') {
          try { addStep('library_provisioned', JSON.parse(event.data)); } catch { /* ignore */ }
        } else if (event.type === 'topology') {
          try { addStep('topology', JSON.parse(event.data)); } catch { /* ignore */ }
        } else if (event.type === 'data_flow') {
          try { addStep('data_flow', JSON.parse(event.data)); } catch { /* ignore */ }
        } else if (event.type === 'workflow_guardrails') {
          try { addStep('workflow_guardrails', JSON.parse(event.data)); } catch { /* ignore */ }
        } else if (event.type === 'validation') {
          try { addStep('validation', JSON.parse(event.data)); } catch { /* ignore */ }
        } else if (event.type === 'tool_exists') {
          try { addStep('tool_exists', JSON.parse(event.data)); } catch { /* ignore */ }
        } else if (event.type === 'tool_new') {
          try { addStep('tool_new', JSON.parse(event.data)); } catch { /* ignore */ }
        } else if (event.type === 'activity_new') {
          try { addStep('activity_new', JSON.parse(event.data)); } catch { /* ignore */ }
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
          failRunning('This step could not be completed.');
          setHasFatalError(true);
        } else if (event.type === 'error') {
          addStep('error', event.data);
          failRunning(event.data);
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
        settle();
        setSteps(prev => {
          const updated = [...prev];
          if (updated.length > 0 && updated[updated.length - 1].status === 'active') {
            updated[updated.length - 1].status = 'completed';
          }
          const fatal = updated.some(s => s.type === 'fatal_error' || s.type === 'error');
          const nameStep = updated.find(s => s.type === 'workflow_ready');
          const finalName = nameStep ? (nameStep.content as Record<string, any>).workflow_name : null;
          // `run` is read here rather than passed in: settle() has already
          // queued its update, and the entry only needs the terminal states.
          saveToHistory(goal, updated, finalName, fatal, run.manifest, run.runtime);
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
    // The only branch needing component scope: retrying re-runs the planner.
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
    return renderCard(step);
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
      {(steps.length > 0 || run.started) && (
        <div className="max-w-3xl mx-auto w-full pb-32">
          {/* A live or replayed run draws the layer chain, with each decision's
              evidence attached to the layer that made it. */}
          {run.manifest.length > 0 && (
            <PipelineTimeline
              manifest={run.manifest}
              runtime={run.runtime}
              activeNote={run.activeNote}
              cards={layerCards}
              raw={layerRaw}
            />
          )}

          <div className="relative border-l border-[var(--color-border-subtle)] ml-4 md:ml-8 space-y-6 pb-8">
            <AnimatePresence>
              {legacyRows.map(row => {
                /* ── Tools / Activities sections ───────────────────────── */
                if (row.kind === 'group') {
                  const meta = GROUP_META[row.family];
                  const GroupIcon = meta.icon;
                  return (
                    <motion.div
                      key={row.key}
                      initial={{ opacity: 0, x: -20 }}
                      animate={{ opacity: 1, x: 0 }}
                      className="relative pl-8 md:pl-12"
                    >
                      <div
                        className="absolute left-[-9px] top-1.5 w-4 h-4 rounded-full bg-[var(--color-bg-base)] border-2 flex items-center justify-center"
                        style={{ borderColor: meta.dot }}
                      >
                        <CheckCircle2
                          size={16}
                          className="absolute bg-[var(--color-bg-base)] rounded-full"
                          style={{ color: meta.dot }}
                        />
                      </div>

                      <div className={cn('rounded-xl border px-3 pb-3 pt-2.5 mt-2', meta.border, meta.bg)}>
                        <div className="flex items-center gap-1.5">
                          <GroupIcon size={11} className={meta.text} />
                          <span className={cn('text-[10px] font-bold uppercase tracking-wider', meta.text)}>
                            {meta.label}
                          </span>
                          <span className={cn('text-[10px] opacity-60', meta.text)}>
                            {row.steps.length} · {meta.caption}
                          </span>
                        </div>
                        {row.steps.map(s => (
                          <div key={s.id}>{renderStepContent(s)}</div>
                        ))}
                      </div>
                    </motion.div>
                  );
                }

                /* ── Everything else keeps its own timeline entry ───────── */
                const step = row.step;
                return (
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
                );
              })}
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
              // Entries synthesised from a saved workflow carry no manifest;
              // those fall back to the legacy row rendering below.
              restore(entry.manifest ?? [], entry.runtime ?? {});
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
