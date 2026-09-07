import { useState } from 'react';
import { createPortal } from 'react-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import { Check, X, Wrench, FlaskConical, Sparkles, Shield, Search, RotateCcw, ArrowRight } from 'lucide-react';
import { toolsApi } from '../../api/tools';
import { QK } from '../../lib/queryClient';
import { cn } from '../../lib/utils';
import {
  containerVariants,
  itemVariants,
  ToolKindBadge,
  ToolDetailsModal,
  SkeletonGrid,
  EmptyState,
  KIND_CONFIG,
  toolKind,
  toolPurpose,
  type ToolKind,
} from './toolGalleryShared';

/** This page is scoped to tools an agent can call — not standalone workflow
 * Activities, which live in the Activity Gallery (/workflows/activities). */
function isAgentTool(tool: Record<string, unknown>): boolean {
  return toolPurpose(tool) === 'tool';
}

export default function ToolLifecycle() {
  const [tab, setTab] = useState<'active' | 'pending'>('active');
  const [showSynthesizeModal, setShowSynthesizeModal] = useState(false);
  const tabs = [
    { key: 'active' as const, label: 'Active Tools' },
    { key: 'pending' as const, label: 'Pending Review' },
  ];

  return (
    <div className="p-8 max-w-5xl mx-auto">
      <div className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight text-[var(--color-text-primary)]">Tool Lifecycle</h1>
        <p className="text-sm text-[var(--color-text-muted)] mt-1">Synthesize, review, and manage dynamic tools.</p>
      </div>

      {/* Segmented Control & Actions */}
      <div className="flex flex-wrap items-center justify-between gap-4 mb-8">
        <div className="flex items-center gap-1 bg-[var(--color-bg-surface)] p-1 rounded-lg border border-[var(--color-border-subtle)] w-fit">
          {tabs.map(t => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={cn(
                'relative px-4 py-1.5 text-sm font-medium rounded-md transition-colors z-10',
                tab === t.key ? 'text-[var(--color-bg-base)]' : 'text-[var(--color-text-muted)] hover:text-white'
              )}
            >
              {tab === t.key && (
                <motion.div
                  layoutId="tool-tab-indicator"
                  className="absolute inset-0 bg-white rounded-md"
                  transition={{ type: "spring", stiffness: 500, damping: 30 }}
                  style={{ zIndex: -1 }}
                />
              )}
              {t.label}
            </button>
          ))}
        </div>
        <button
          onClick={() => setShowSynthesizeModal(true)}
          className="btn-primary flex items-center gap-2 px-5 py-2 text-sm rounded-md shadow-sm hover:shadow-md transition-all"
        >
          <Sparkles size={16} /> Synthesize Tool
        </button>
      </div>

      <AnimatePresence mode="wait">
        <motion.div
          key={tab}
          initial={{ opacity: 0, y: 5 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -5 }}
          transition={{ duration: 0.2 }}
        >
          {tab === 'active' && <ActiveTools />}
          {tab === 'pending' && <PendingTools />}
        </motion.div>
      </AnimatePresence>

      <AnimatePresence>
        {showSynthesizeModal && (
          <SynthesizeToolModal onClose={() => setShowSynthesizeModal(false)} />
        )}
      </AnimatePresence>
    </div>
  );
}

const KIND_FILTERS: { key: ToolKind | 'all'; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'builtin', label: 'Built-in' },
  { key: 'synthesized', label: 'Synthesized' },
];

function ActiveTools() {
  const { data: rawData = [], isLoading } = useQuery({
    queryKey: QK.tools(),
    queryFn: () => toolsApi.list().then(r => Array.isArray(r.data) ? r.data : r.data.tools ?? []),
  });
  const data = (rawData as Record<string, unknown>[]).filter(isAgentTool);
  const [selectedTool, setSelectedTool] = useState<Record<string, any> | null>(null);
  const [search, setSearch] = useState('');
  const [kindFilter, setKindFilter] = useState<ToolKind | 'all'>('all');

  if (isLoading) return <SkeletonGrid />;
  if (!data.length) return <EmptyState icon={Wrench} text="No active tools. Synthesize one to get started." />;

  const tools = data.filter((tool) => {
    if (search && !String(tool.name ?? '').toLowerCase().includes(search.toLowerCase())) return false;
    if (kindFilter !== 'all' && toolKind(tool) !== kindFilter) return false;
    return true;
  });

  const filtersActive = !!search || kindFilter !== 'all';
  const clearFilters = () => { setSearch(''); setKindFilter('all'); };

  return (
    <>
      {/* Search + kind filter */}
      <div className="flex flex-wrap items-center gap-2 mb-6">
        <div className="relative flex-1 min-w-[200px]">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)]" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search tools…"
            className="w-full minimal-input bg-[var(--color-bg-surface)] rounded-md pl-9 pr-4 py-2 text-sm"
          />
        </div>
        <div className="flex items-center gap-1 bg-[var(--color-bg-surface)] p-1 rounded-lg border border-[var(--color-border-subtle)] w-fit shrink-0">
          {KIND_FILTERS.map((f) => (
            <button
              key={f.key}
              onClick={() => setKindFilter(f.key)}
              className={cn(
                'px-3 py-1.5 text-xs font-medium rounded-md transition-colors',
                kindFilter === f.key
                  ? 'bg-[var(--color-bg-hover)] text-white'
                  : 'text-[var(--color-text-muted)] hover:text-white'
              )}
            >
              {f.label}
            </button>
          ))}
        </div>
        {filtersActive && (
          <button
            onClick={clearFilters}
            className="flex shrink-0 items-center gap-1.5 rounded-md border border-[var(--color-border-subtle)] px-3 py-2 text-sm text-[var(--color-text-secondary)] transition-colors hover:border-indigo-400/40 hover:text-white"
          >
            <RotateCcw size={13} /> Clear
          </button>
        )}
        <span className="ml-auto shrink-0 font-mono text-xs tabular-nums text-[var(--color-text-muted)]">
          {filtersActive ? `${tools.length} of ${data.length}` : `${data.length} tool${data.length === 1 ? '' : 's'}`}
        </span>
      </div>

      {tools.length === 0 ? (
        <EmptyState icon={Search} text="No tools match your filters. Try a different search term or filter." />
      ) : (
      <motion.div variants={containerVariants} initial="hidden" animate="show" className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {tools.map((tool: Record<string, unknown>, i: number) => {
          const kind = toolKind(tool);
          const cfg = KIND_CONFIG[kind];
          const Icon = cfg.icon;
          return (
            <motion.div
              key={String(tool.id ?? i)}
              variants={itemVariants}
              className="surface-card rounded-xl p-5 group cursor-pointer hover:border-[var(--color-border-focus)] transition-all hover:scale-[1.01] flex flex-col h-full"
              onClick={() => setSelectedTool(tool)}
            >
              <div className="flex items-start gap-3 mb-4">
                <div className={cn('w-10 h-10 rounded-lg flex items-center justify-center shrink-0 border', cfg.bg, cfg.border)}>
                  <Icon size={18} className={cfg.color} />
                </div>
                <div className="min-w-0 flex-1">
                  <h3 className="text-sm font-[family-name:var(--font-mono)] font-medium text-[var(--color-text-primary)] truncate">{String(tool.name)}</h3>
                  <div className="mt-1.5 flex items-center gap-1.5 flex-wrap">
                    <ToolKindBadge kind={kind} />
                    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-[rgba(16,185,129,0.1)] border border-[rgba(16,185,129,0.2)]">
                      <span className="w-1.5 h-1.5 rounded-full bg-[var(--color-accent-success)]" />
                      <span className="text-[9px] font-bold text-[var(--color-accent-success)] uppercase tracking-wider">Active</span>
                    </span>
                  </div>
                </div>
              </div>
              <p className="text-sm text-[var(--color-text-secondary)] leading-relaxed flex-1 line-clamp-4">
                {tool.description ? String(tool.description) : <span className="italic opacity-50">No description provided</span>}
              </p>
              <div className="mt-4 pt-4 border-t border-[var(--color-border-subtle)] flex items-center justify-between">
                <p className="text-[10px] text-[var(--color-text-muted)] font-[family-name:var(--font-mono)] uppercase tracking-wider truncate">
                  {tool.version ? `v${String(tool.version)}` : ' '}
                </p>
                <span className="text-[10px] text-[var(--color-text-muted)] opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1">
                  View details <ArrowRight size={10} />
                </span>
              </div>
            </motion.div>
          );
        })}
      </motion.div>
      )}

      <AnimatePresence>
        {selectedTool && (
           <ToolDetailsModal tool={selectedTool} onClose={() => setSelectedTool(null)} />
        )}
      </AnimatePresence>
    </>
  );
}

function PendingTools() {
  const qc = useQueryClient();
  const { data: rawData = [], isLoading } = useQuery({
    queryKey: QK.pendingTools(),
    queryFn: () => toolsApi.listPending().then(r => Array.isArray(r.data) ? r.data : r.data.tools ?? []),
    refetchInterval: 5_000,
  });
  const data = (rawData as Record<string, unknown>[]).filter(isAgentTool);

  const approve = useMutation({ mutationFn: (id: string) => toolsApi.approve(id), onSuccess: () => { qc.invalidateQueries({ queryKey: QK.pendingTools() }); qc.invalidateQueries({ queryKey: QK.tools() }); } });
  const reject  = useMutation({ mutationFn: (id: string) => toolsApi.reject(id), onSuccess: () => qc.invalidateQueries({ queryKey: QK.pendingTools() }) });

  if (isLoading) return <SkeletonGrid />;
  if (!data.length) return <EmptyState icon={Shield} text="No tools awaiting approval. All clear." />;

  return (
    <motion.div variants={containerVariants} initial="hidden" animate="show" className="space-y-3">
      {data.map((tool: Record<string, unknown>) => (
        <motion.div key={String(tool.id)} variants={itemVariants} className="surface-card rounded-xl overflow-hidden">
          <div className="flex flex-wrap items-center gap-4 px-5 py-4">
            <div className="w-8 h-8 rounded-md bg-[var(--color-bg-hover)] border border-[var(--color-border-subtle)] flex items-center justify-center">
              <Shield size={14} className="text-[var(--color-accent-warning)]" />
            </div>
            <div className="flex-1 min-w-0">
              <span className="font-[family-name:var(--font-mono)] text-sm font-medium text-[var(--color-text-primary)] block mb-1">{String(tool.name)}</span>
              <div className="flex items-center gap-1.5 flex-wrap">
                <ToolKindBadge kind={toolKind(tool)} />
                <span className="text-[10px] text-[var(--color-accent-warning)] uppercase tracking-wider font-medium">Pending Review</span>
              </div>
            </div>
            <div className="flex flex-wrap gap-2 mt-2 sm:mt-0 sm:ml-auto w-full sm:w-auto">
              <button onClick={() => approve.mutate(String(tool.id))} disabled={approve.isPending} className="btn-primary flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs rounded-md border border-transparent flex-1 sm:flex-none">
                <Check size={14} /> Approve
              </button>
              <button onClick={() => reject.mutate(String(tool.id))} disabled={reject.isPending} className="btn-secondary flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs rounded-md text-[var(--color-accent-danger)] hover:bg-[rgba(239,68,68,0.1)] hover:border-[rgba(239,68,68,0.2)] flex-1 sm:flex-none">
                <X size={14} /> Reject
              </button>
            </div>
          </div>
        </motion.div>
      ))}
    </motion.div>
  );
}

function SynthesizeToolModal({ onClose }: { onClose: () => void }) {
  const [task, setTask] = useState('');
  const qc = useQueryClient();
  const synthesis = useMutation({
    mutationFn: () => toolsApi.synthesize(task, 'tool').then(r => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: QK.pendingTools() }),
  });

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 20 }}
        onClick={e => e.stopPropagation()}
        className="bg-[var(--color-bg-surface)] border border-[var(--color-border-subtle)] rounded-xl w-full max-w-2xl overflow-hidden flex flex-col shadow-2xl"
      >
        <div className="flex items-center justify-between p-5 border-b border-[var(--color-border-subtle)] bg-[var(--color-bg-base)]">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-md bg-white flex items-center justify-center">
              <Sparkles size={14} className="text-black" />
            </div>
            <div>
              <h2 className="text-sm font-medium text-[var(--color-text-primary)]">Tool Synthesizer</h2>
              <p className="text-xs text-[var(--color-text-muted)]">Describe the utility — Codestral will generate, lint, and sandbox.</p>
            </div>
          </div>
          <button onClick={onClose} className="text-[var(--color-text-muted)] hover:text-white p-1 rounded-md hover:bg-[var(--color-bg-hover)] transition-colors">
            <X size={16} />
          </button>
        </div>
        <div className="p-6">
          <div className="mb-6">
            <label className="block text-xs text-[var(--color-text-muted)] mb-2 uppercase tracking-wider font-medium">Task Description</label>
            <textarea value={task} onChange={e => setTask(e.target.value)} rows={4} placeholder="e.g. A function that fetches the weather for a given city." className="w-full minimal-input rounded-md px-4 py-3 text-sm resize-none focus:ring-2 focus:ring-[var(--color-border-focus)] focus:bg-[var(--color-bg-hover)] transition-all outline-none" />
          </div>
          <button onClick={() => synthesis.mutate()} disabled={task.length < 10 || synthesis.isPending} className="w-full btn-primary px-4 py-2.5 text-sm rounded-md flex items-center justify-center gap-2 disabled:opacity-50 transition-all hover:shadow-[0_0_15px_rgba(99,102,241,0.4)]">
            <FlaskConical size={16} />
            {synthesis.isPending ? 'Synthesizing...' : 'Synthesize Tool'}
          </button>

          <AnimatePresence>
            {synthesis.data && synthesis.data.status !== 'error' && (
              <motion.div
                initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
                className="mt-4 surface-card rounded-xl p-4 border-[rgba(16,185,129,0.3)] bg-[rgba(16,185,129,0.02)] flex items-center gap-3"
              >
                <div className="w-6 h-6 rounded-full bg-[rgba(16,185,129,0.1)] flex items-center justify-center flex-shrink-0">
                  <Check size={12} className="text-[var(--color-accent-success)]" />
                </div>
                <p className="text-sm text-[var(--color-text-secondary)]">Tool generated successfully and moved to the <span className="text-[var(--color-text-primary)] font-medium">Pending Review</span> queue.</p>
              </motion.div>
            )}
            {synthesis.data && synthesis.data.status === 'error' && (
              <motion.div
                initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
                className="mt-4 surface-card rounded-xl p-4 border-[rgba(239,68,68,0.3)] bg-[rgba(239,68,68,0.02)] flex items-start gap-3"
              >
                <div className="w-6 h-6 rounded-full bg-[rgba(239,68,68,0.1)] flex items-center justify-center flex-shrink-0 mt-0.5">
                  <X size={12} className="text-[var(--color-accent-danger)]" />
                </div>
                <div>
                  <p className="text-sm font-medium text-[var(--color-text-primary)]">Synthesis Failed</p>
                  <p className="text-sm text-[var(--color-text-secondary)] mt-1">{synthesis.data.message || "An unknown error occurred."}</p>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </motion.div>
    </div>,
    document.body
  );
}
