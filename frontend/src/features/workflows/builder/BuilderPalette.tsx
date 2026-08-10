/**
 * BuilderPalette — the drag source for the canvas.
 *
 * Three sections: agents (from the Mistral account), tools (native, built-in
 * and synthesised), and logic primitives. Agents and tools can also be created
 * inline, so assembling a workflow never requires leaving the builder.
 */

import { useMemo, useState } from 'react';
import {
  ChevronDown,
  Cpu,
  GitBranch,
  MousePointerSquareDashed,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  RefreshCw,
  Search,
  Shuffle,
  Sparkles,
  Wrench,
} from 'lucide-react';
import type { CatalogAgent, CatalogTool } from '../../../api/workflowBuilder';
import { DRAG_MIME, DRAG_TOOL_HINT, type DragPayload } from './BuilderCanvas';
import { STEP_META } from './graphModel';
import { getTierConfig } from '../../../components/ui/TierBadge';
import { cn } from '../../../lib/utils';

interface Props {
  agents: CatalogAgent[];
  tools: CatalogTool[];
  isLoading: boolean;
  onRefresh: () => void;
  onCreateAgent: () => void;
  onCreateTool: () => void;
}

function startDrag(event: React.DragEvent, payload: DragPayload) {
  event.dataTransfer.setData(DRAG_MIME, JSON.stringify(payload));
  // Tools get a second, payload-free type so the canvas can recognise them
  // mid-drag and highlight the agents they can attach to.
  if (payload.kind === 'tool') event.dataTransfer.setData(DRAG_TOOL_HINT, '1');
  event.dataTransfer.effectAllowed = 'copy';
}

function Section({
  title,
  count,
  icon,
  action,
  children,
  defaultOpen = true,
}: {
  title: string;
  count?: number;
  icon: React.ReactNode;
  action?: React.ReactNode;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border-b border-[var(--color-border-subtle)] last:border-b-0">
      <div className="flex items-center gap-2 px-3 py-2.5">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="flex items-center gap-2 flex-1 min-w-0 text-left group"
        >
          <ChevronDown
            size={12}
            className={cn(
              'text-[var(--color-text-muted)] transition-transform shrink-0',
              !open && '-rotate-90',
            )}
          />
          <span className="text-[var(--color-text-muted)] shrink-0">{icon}</span>
          <span className="text-[11px] font-bold uppercase tracking-wider text-[var(--color-text-secondary)] group-hover:text-white transition-colors truncate">
            {title}
          </span>
          {count !== undefined && (
            <span className="text-[10px] font-mono text-[var(--color-text-muted)] shrink-0">
              {count}
            </span>
          )}
        </button>
        {action}
      </div>
      {open && <div className="px-2 pb-2.5 space-y-1.5">{children}</div>}
    </div>
  );
}

function DragCard({
  payload,
  accent,
  icon,
  title,
  subtitle,
  badge,
  tooltip,
}: {
  payload: DragPayload;
  accent: string;
  icon: React.ReactNode;
  title: string;
  subtitle?: string;
  badge?: React.ReactNode;
  tooltip?: string;
}) {
  return (
    <div
      draggable
      onDragStart={(e) => startDrag(e, payload)}
      title={tooltip}
      className="group flex items-center gap-2.5 px-2.5 py-2 rounded-lg border border-[var(--color-border-subtle)] bg-[rgba(255,255,255,0.02)] cursor-grab active:cursor-grabbing hover:border-[rgba(99,102,241,0.4)] hover:bg-[var(--color-bg-hover)] transition-colors"
    >
      <div
        className="w-6 h-6 rounded-md flex items-center justify-center text-white shrink-0"
        style={{ background: accent }}
      >
        {icon}
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-[11px] font-semibold text-white truncate leading-tight">{title}</p>
        {subtitle && (
          <p className="text-[9px] text-[var(--color-text-muted)] font-mono truncate leading-tight mt-0.5">
            {subtitle}
          </p>
        )}
      </div>
      {badge}
    </div>
  );
}

const TOOL_SOURCE_STYLE: Record<CatalogTool['source'], { label: string; className: string }> = {
  builtin: { label: 'built-in', className: 'text-cyan-300 bg-cyan-400/10 border-cyan-400/25' },
  native: { label: 'native', className: 'text-violet-300 bg-violet-400/10 border-violet-400/25' },
  dynamic: { label: 'synth', className: 'text-pink-300 bg-pink-400/10 border-pink-400/25' },
};

export default function BuilderPalette({
  agents,
  tools,
  isLoading,
  onRefresh,
  onCreateAgent,
  onCreateTool,
}: Props) {
  const [query, setQuery] = useState('');
  const [collapsed, setCollapsed] = useState(false);

  const needle = query.trim().toLowerCase();

  const filteredAgents = useMemo(
    () =>
      !needle
        ? agents
        : agents.filter(
            (a) =>
              a.name.toLowerCase().includes(needle) ||
              (a.description ?? '').toLowerCase().includes(needle) ||
              (a.tier ?? '').toLowerCase().includes(needle),
          ),
    [agents, needle],
  );

  const filteredTools = useMemo(
    () =>
      !needle
        ? tools
        : tools.filter(
            (t) =>
              t.name.toLowerCase().includes(needle) ||
              (t.description ?? '').toLowerCase().includes(needle),
          ),
    [tools, needle],
  );

  const iconButton =
    'w-6 h-6 rounded-md flex items-center justify-center border border-[var(--color-border-subtle)] bg-[rgba(255,255,255,0.03)] text-[var(--color-text-muted)] hover:text-white hover:border-[rgba(99,102,241,0.4)] transition-colors shrink-0';

  const toggleButton = (
    <button
      type="button"
      onClick={() => setCollapsed((c) => !c)}
      title={collapsed ? 'Expand palette' : 'Collapse palette'}
      aria-label={collapsed ? 'Expand palette' : 'Collapse palette'}
      className="w-7 h-7 rounded-md flex items-center justify-center text-[var(--color-text-muted)] hover:text-white hover:bg-[var(--color-bg-hover)] transition-colors shrink-0"
    >
      {collapsed ? <PanelLeftOpen size={14} /> : <PanelLeftClose size={14} />}
    </button>
  );

  if (collapsed) {
    return (
      <aside className="w-10 shrink-0 flex flex-col border-r border-[var(--color-border-subtle)] bg-[rgba(11,15,22,0.75)] backdrop-blur-md min-h-0 transition-[width] duration-150 ease-in-out overflow-hidden">
        <div className="flex items-center justify-center py-3 border-b border-[var(--color-border-subtle)] shrink-0">
          {toggleButton}
        </div>
      </aside>
    );
  }

  return (
    <aside className="w-[268px] shrink-0 flex flex-col border-r border-[var(--color-border-subtle)] bg-[rgba(11,15,22,0.75)] backdrop-blur-md min-h-0 transition-[width] duration-150 ease-in-out overflow-hidden">
      {/* Header with toggle */}
      <div className="flex items-center gap-2 px-2.5 py-2.5 border-b border-[var(--color-border-subtle)] shrink-0">
        <div className="relative flex-1 min-w-0">
          <Search
            size={13}
            className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)] pointer-events-none"
          />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search agents and tools…"
            aria-label="Search palette"
            className="minimal-input w-full rounded-lg pl-8 pr-2.5 py-1.5 text-xs outline-none focus:border-[var(--color-border-focus)]"
          />
        </div>
        {toggleButton}
      </div>

      <div className="flex-1 overflow-y-auto custom-scrollbar min-h-0">
        {/* Agents */}
        <Section
          title="Agents"
          count={filteredAgents.length}
          icon={<Cpu size={12} />}
          action={
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={onRefresh}
                title="Refresh catalog"
                aria-label="Refresh catalog"
                className={iconButton}
              >
                <RefreshCw size={11} className={cn(isLoading && 'animate-spin')} />
              </button>
              <button
                type="button"
                onClick={onCreateAgent}
                title="Create a new agent"
                aria-label="Create a new agent"
                className={iconButton}
              >
                <Plus size={12} />
              </button>
            </div>
          }
        >
          {isLoading && filteredAgents.length === 0 && (
            <p className="text-[10px] text-[var(--color-text-muted)] px-1 py-2">Loading agents…</p>
          )}
          {!isLoading && filteredAgents.length === 0 && (
            <p className="text-[10px] text-[var(--color-text-muted)] px-1 py-2 leading-relaxed">
              {needle ? 'No agents match your search.' : 'No agents yet — create one to get started.'}
            </p>
          )}
          {filteredAgents.map((agent) => {
            const tierCfg = getTierConfig(agent.tier ?? undefined);
            return (
              <DragCard
                key={agent.id}
                payload={{ kind: 'agent', agent }}
                accent={STEP_META.agent.accent}
                icon={<Cpu size={12} />}
                title={agent.name}
                subtitle={agent.model}
                tooltip={agent.description ?? agent.name}
                badge={
                  agent.tier ? (
                    <span
                      className={cn(
                        'text-[8px] font-bold uppercase px-1.5 py-0.5 rounded border shrink-0',
                        tierCfg.color,
                        tierCfg.bg,
                        tierCfg.border,
                      )}
                    >
                      {tierCfg.label}
                    </span>
                  ) : undefined
                }
              />
            );
          })}
        </Section>

        {/* Tools — attach to an agent, never a step of their own */}
        <Section
          title="Tools"
          count={filteredTools.length}
          icon={<Wrench size={12} />}
          action={
            <button
              type="button"
              onClick={onCreateTool}
              title="Synthesise a new tool"
              aria-label="Synthesise a new tool"
              className={iconButton}
            >
              <Sparkles size={12} />
            </button>
          }
        >
          <p className="flex items-start gap-1.5 text-[9.5px] text-[var(--color-text-muted)] leading-relaxed px-1 pb-1">
            <MousePointerSquareDashed size={11} className="shrink-0 mt-px" />
            <span>
              Drop a tool <strong className="text-[var(--color-text-secondary)]">onto an agent</strong> to
              give it that capability. Tools cannot run on their own — the agent decides when to
              call them.
            </span>
          </p>

          {!isLoading && filteredTools.length === 0 && (
            <p className="text-[10px] text-[var(--color-text-muted)] px-1 py-2 leading-relaxed">
              {needle ? 'No tools match your search.' : 'No tools available.'}
            </p>
          )}
          {filteredTools.map((tool) => {
            const style = TOOL_SOURCE_STYLE[tool.source] ?? TOOL_SOURCE_STYLE.dynamic;
            return (
              <DragCard
                key={`${tool.source}:${tool.name}`}
                payload={{ kind: 'tool', tool }}
                accent={STEP_META.tool.accent}
                icon={<Wrench size={12} />}
                title={tool.name}
                subtitle={
                  Object.keys(tool.parameters ?? {}).length > 0
                    ? `${Object.keys(tool.parameters).length} param(s)`
                    : 'no params'
                }
                tooltip={tool.description ?? tool.name}
                badge={
                  <span
                    className={cn(
                      'text-[8px] font-bold uppercase px-1.5 py-0.5 rounded border shrink-0',
                      style.className,
                    )}
                  >
                    {style.label}
                  </span>
                }
              />
            );
          })}
        </Section>

        {/* Logic */}
        <Section title="Logic" icon={<GitBranch size={12} />}>
          <DragCard
            payload={{ kind: 'logic', logic: 'condition' }}
            accent={STEP_META.condition.accent}
            icon={<GitBranch size={12} />}
            title="Condition"
            subtitle="branch on an expression"
            tooltip={STEP_META.condition.hint}
          />
          <DragCard
            payload={{ kind: 'logic', logic: 'transform' }}
            accent={STEP_META.transform.accent}
            icon={<Shuffle size={12} />}
            title="Transform"
            subtitle="reshape variables"
            tooltip={STEP_META.transform.hint}
          />
        </Section>
      </div>

      <div className="px-3 py-2 border-t border-[var(--color-border-subtle)] shrink-0">
        <p className="text-[9.5px] text-[var(--color-text-muted)] leading-relaxed">
          Agents and logic become steps on the canvas. Tools attach to an agent. Connect steps by
          dragging from the dot at the bottom of a card.
        </p>
      </div>
    </aside>
  );
}
