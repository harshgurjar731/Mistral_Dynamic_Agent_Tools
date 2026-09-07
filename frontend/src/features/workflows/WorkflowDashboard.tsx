import { useMemo, useState, type MouseEvent } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import {
  GitBranch, Play, Archive, Loader2, Plus,
  RefreshCw, Sparkles, FolderArchive, Server, Zap,
  Pencil, AlertTriangle, Package, Search, RotateCcw, Tag,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { workflowsApi } from '../../api/workflows';
import { ontologyApi } from '../../api/ontology';
import { QK } from '../../lib/queryClient';
import DeployPackageModal from './DeployPackageModal';
import WorkflowClassificationModal from './WorkflowClassificationModal';
import DomainFilterDropdown from '../ontology/DomainFilterDropdown';
import { buildDomainTree, expandedMatchSet, intersects } from '../ontology/domainTree';

const containerVariants = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { staggerChildren: 0.05 } },
};
const itemVariants = {
  hidden: { opacity: 0, y: 10 },
  show: { opacity: 1, y: 0, transition: { type: 'spring' as const, stiffness: 300, damping: 24 } },
};

/* ── Workflow Card ─────────────────────────────────────────────────────── */
function WorkflowCard({
  wf,
  domains,
  onArchive,
  onExecute,
  onView,
  onEdit,
  onRegister,
  onPackage,
  onClassify,
  isRegistering,
}: {
  wf: Record<string, unknown>;
  domains: string[];
  onArchive: () => void;
  onExecute: () => void;
  onView: () => void;
  onEdit: () => void;
  onRegister: () => void;
  onPackage: () => void;
  onClassify: () => void;
  isRegistering: boolean;
}) {
  const steps = (wf.steps as unknown[]) ?? [];
  const isDeployed = Boolean(wf.is_deployed);
  const mistralId = wf.id as string | undefined;
  const needsPublish = Boolean(wf.has_unpublished_changes);
  // Workflows discovered on Mistral but absent locally have no steps to edit.
  const isEditable = steps.length > 0;

  // The card itself opens the workflow — the same thing the old "View"
  // button did — so every inner control has to stop the click from also
  // bubbling up into that navigation.
  const stop = (fn: () => void) => (e: MouseEvent) => { e.stopPropagation(); fn(); };

  return (
    <motion.div
      variants={itemVariants}
      onClick={onView}
      className="surface-card rounded-xl p-5 group flex flex-col h-full gap-4 cursor-pointer hover:scale-[1.01] transition-all"
    >
      {/* Header row */}
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3 min-w-0 flex-1">
          <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-indigo-500/20 to-purple-600/20 border border-[rgba(99,102,241,0.25)] flex items-center justify-center shrink-0">
            <GitBranch size={18} className="text-[#a5b4fc]" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-white font-mono truncate" title={String(wf.name)}>
              {String(wf.name)}
            </p>
            {!!wf.description && (
              <p className="text-xs text-[var(--color-text-muted)] mt-0.5 line-clamp-2">{String(wf.description)}</p>
            )}
          </div>
        </div>
        <button
          onClick={stop(onArchive)}
          className="p-1.5 rounded-md text-[var(--color-text-muted)] hover:text-white hover:bg-[var(--color-bg-hover)] transition-colors opacity-0 group-hover:opacity-100 shrink-0 ml-1"
          title="Archive Workflow"
        >
          <Archive size={14} />
        </button>
      </div>

      {/* Meta row */}
      <div className="flex flex-wrap items-center gap-2 mt-1">
        <span className="shrink-0 text-[10px] font-medium bg-[var(--color-bg-hover)] border border-[var(--color-border-subtle)] px-2 py-0.5 rounded-full text-[var(--color-text-muted)] uppercase tracking-wider">
          {steps.length} step{steps.length !== 1 ? 's' : ''}
        </span>

        {/* Deployed badge */}
        {isDeployed ? (
          <span className="flex items-center gap-1 text-[10px] bg-emerald-400/10 text-emerald-400 border border-emerald-400/20 px-2 py-0.5 rounded-full uppercase font-medium shrink-0">
            <Server size={10} /> Mistral
            {mistralId && <span className="text-[8px] opacity-70 font-mono">{mistralId.slice(-6)}</span>}
          </span>
        ) : (
          <span className="flex items-center gap-1 text-[10px] bg-[var(--color-bg-hover)] text-[var(--color-text-muted)] border border-[var(--color-border-subtle)] px-2 py-0.5 rounded-full uppercase font-medium shrink-0">
            <Zap size={10} /> Local
          </span>
        )}

        {/* Edited since it was last published to Mistral */}
        {needsPublish && (
          <span
            title="This workflow has been edited since it was last published"
            className="flex items-center gap-1 text-[10px] bg-amber-400/10 text-amber-400 border border-amber-400/25 px-2 py-0.5 rounded-full uppercase font-medium shrink-0"
          >
            <AlertTriangle size={10} /> Unpublished
          </span>
        )}

        {/* Domain classification */}
        <button
          type="button"
          onClick={stop(onClassify)}
          title={domains.length ? `Domain: ${domains.join(', ')} — click to edit` : 'Click to classify this workflow by domain'}
          className="flex items-center gap-1 text-[10px] bg-indigo-400/10 hover:bg-indigo-400/20 text-indigo-300 border border-indigo-400/20 hover:border-indigo-400/40 px-2 py-0.5 rounded-full font-medium shrink-0 transition-colors"
        >
          <Tag size={10} />
          {domains.length === 0
            ? 'Classify'
            : domains.length > 2
              ? `${domains.slice(0, 2).join(', ')} +${domains.length - 2}`
              : domains.join(', ')}
        </button>
      </div>

      {/* Actions row — Execute is the one action worth a full label; the rest
          are small icon buttons so they don't compete for width, and their
          presence varies per card (Edit/Register are conditional). */}
      <div className="flex items-center gap-1.5 pt-2 mt-auto border-t border-[var(--color-border-subtle)]">
        {isEditable && (
          <button
            onClick={stop(onEdit)}
            title="Open in the visual builder"
            className="btn-secondary flex items-center justify-center p-1.5 rounded-md shrink-0"
          >
            <Pencil size={12} />
          </button>
        )}

        {!isDeployed && (
          <button
            onClick={stop(onRegister)}
            disabled={isRegistering}
            title="Register on Mistral server"
            className="btn-secondary flex items-center justify-center p-1.5 rounded-md shrink-0 disabled:opacity-50"
          >
            {isRegistering ? <Loader2 size={12} className="animate-spin" /> : <Server size={12} />}
          </button>
        )}

        <button
          onClick={stop(onPackage)}
          title="Package this workflow for deployment on another server"
          className="btn-secondary flex items-center justify-center p-1.5 rounded-md shrink-0"
        >
          <Package size={12} />
        </button>

        <button
          onClick={stop(onExecute)}
          className="btn-primary flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs rounded-md ml-auto"
        >
          <Play size={12} className="fill-current" /> Execute
        </button>
      </div>
    </motion.div>
  );
}

/* ── Dashboard ─────────────────────────────────────────────────────────── */
export default function WorkflowDashboard() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [registeringName, setRegisteringName] = useState<string | null>(null);
  const [packagingName, setPackagingName] = useState<string | null>(null);
  const [classifyingName, setClassifyingName] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [domainFilter, setDomainFilter] = useState<Set<string>>(new Set());

  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: QK.workflows(),
    queryFn: () =>
      workflowsApi.list().then(r => {
        const d = r.data;
        return Array.isArray(d) ? d : d.workflows ?? [];
      }),
  });

  const { data: domainConceptData } = useQuery({
    queryKey: QK.ontologyConcepts('domain'),
    queryFn: () => ontologyApi.concepts('domain').then(r => r.data),
  });
  // `?? []` alone would hand useMemo a fresh array every render while the
  // query is still loading — memoized here so the fallback stays referentially
  // stable too.
  const domainConcepts = useMemo(() => domainConceptData?.concepts ?? [], [domainConceptData]);
  const domainTree = useMemo(() => buildDomainTree(domainConcepts), [domainConcepts]);

  const activeWorkflows: Record<string, unknown>[] = (Array.isArray(data) ? data : (data as any)?.workflows ?? [])
    .filter((w: Record<string, unknown>) => !w.archived);
  const activeWorkflowNames = activeWorkflows.map((w) => String(w.name));

  // Which domain each workflow serves — fetched once for the whole list
  // (one request instead of one per card) and used both by the filter and
  // by each card's own classification badge.
  const { data: domainBulk } = useQuery({
    queryKey: ['ontology', 'annotations', 'workflow', 'bulk', activeWorkflowNames.join(',')],
    queryFn: () => ontologyApi.annotationsBulk('workflow', activeWorkflowNames).then(r => r.data),
    enabled: activeWorkflowNames.length > 0,
  });

  const domainMatchSet = useMemo(
    () => expandedMatchSet(domainTree, domainFilter),
    [domainTree, domainFilter],
  );

  const domainLabelById = useMemo(
    () => new Map(domainConcepts.map((c) => [c.id, c.label])),
    [domainConcepts],
  );
  const domainsFor = (name: string): string[] =>
    (domainBulk?.annotations[name]?.serves_domain ?? []).map((id) => domainLabelById.get(id) ?? id);

  const archiveMut = useMutation({
    mutationFn: (name: string) => workflowsApi.archive(name),
    onSuccess: () => qc.invalidateQueries({ queryKey: QK.workflows() }),
    onError: (err: unknown) => {
      const msg = (err as any)?.response?.data?.detail || (err as Error).message || 'Failed to archive';
      alert(msg);
    },
  });

  const registerMut = useMutation({
    mutationFn: (name: string) => workflowsApi.register(name),
    onMutate: (name) => setRegisteringName(name),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: QK.workflows() });
      setRegisteringName(null);
    },
    onError: (err: unknown) => {
      const msg = (err as any)?.response?.data?.detail || (err as Error).message || 'Failed to register';
      alert(msg);
      setRegisteringName(null);
    },
  });

  const workflows = activeWorkflows
    .filter((w: Record<string, unknown>) => {
      if (!search) return true;
      return String(w.name).toLowerCase().includes(search.toLowerCase());
    })
    .filter((w: Record<string, unknown>) => {
      if (!domainFilter.size) return true;
      const domains = domainBulk?.annotations[String(w.name)]?.serves_domain;
      return intersects(domains, domainMatchSet);
    });

  const filtersActive = !!search || domainFilter.size > 0;
  const clearFilters = () => { setSearch(''); setDomainFilter(new Set()); };

  return (
    <div className="p-8 max-w-6xl mx-auto">
      {/* Header — primary actions only. Filtering lives in its own row below,
          so "narrow the list" and "do something" don't blur into one row. */}
      <div className="flex flex-wrap items-end justify-between gap-3 mb-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-white mb-2">Workflows</h1>
          <p className="text-sm text-[var(--color-text-muted)]">Design, execute, and monitor multi-agent pipelines.</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => refetch()}
            className="btn-secondary p-2 rounded-md flex items-center"
            title="Refresh"
          >
            <RefreshCw size={15} className={isFetching ? 'animate-spin' : ''} />
          </button>
          <button
            onClick={() => navigate('/workflows/archived')}
            className="btn-secondary flex items-center gap-2 px-4 py-2 text-sm rounded-md"
          >
            <FolderArchive size={15} /> Archived
          </button>
          <button
            onClick={() => navigate('/workflows/new')}
            className="btn-primary flex items-center gap-2 px-4 py-2 text-sm rounded-md"
          >
            <Sparkles size={15} /> New Workflow
          </button>
        </div>
      </div>

      {/* Search + filters */}
      <div className="flex flex-wrap items-center gap-2 mb-6">
        <div className="relative flex-1 min-w-[200px]">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)]" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search workflows…"
            className="w-full minimal-input bg-[var(--color-bg-surface)] rounded-md pl-9 pr-4 py-2 text-sm"
          />
        </div>
        <DomainFilterDropdown concepts={domainConcepts} selected={domainFilter} onChange={setDomainFilter} />
        {filtersActive && (
          <button
            onClick={clearFilters}
            className="flex shrink-0 items-center gap-1.5 rounded-md border border-[var(--color-border-subtle)] px-3 py-2 text-sm text-[var(--color-text-secondary)] transition-colors hover:border-indigo-400/40 hover:text-white"
          >
            <RotateCcw size={13} /> Clear
          </button>
        )}
        {!isLoading && (
          <span className="ml-auto shrink-0 font-mono text-xs tabular-nums text-[var(--color-text-muted)]">
            {filtersActive
              ? `${workflows.length} of ${activeWorkflows.length}`
              : `${activeWorkflows.length} workflow${activeWorkflows.length === 1 ? '' : 's'}`}
          </span>
        )}
      </div>

      {/* Grid */}
      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="surface-card rounded-xl p-5 flex flex-col h-full gap-4 animate-pulse">
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-lg bg-[var(--color-bg-hover)] shrink-0" />
                <div className="flex-1 space-y-2 py-1">
                  <div className="h-4 w-3/4 rounded bg-[var(--color-bg-hover)]" />
                  <div className="h-3 w-full rounded bg-[var(--color-bg-hover)]" />
                  <div className="h-3 w-5/6 rounded bg-[var(--color-bg-hover)]" />
                </div>
              </div>
              <div className="flex items-center gap-3 mt-1">
                <div className="h-5 w-16 rounded-full bg-[var(--color-bg-hover)]" />
                <div className="h-5 w-20 rounded-full bg-[var(--color-bg-hover)]" />
              </div>
              <div className="flex gap-2 pt-2 mt-auto border-t border-[var(--color-border-subtle)]">
                <div className="h-8 rounded bg-[var(--color-bg-hover)] flex-1" />
                <div className="h-8 rounded bg-[var(--color-bg-hover)] flex-1" />
                <div className="h-8 rounded bg-[var(--color-bg-hover)] flex-1" />
              </div>
            </div>
          ))}
        </div>
      ) : workflows.length === 0 ? (
        <motion.div
          initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
          className="text-center py-24 px-6 rounded-2xl flex flex-col items-center justify-center min-h-[400px] gap-4 bg-[rgba(15,20,28,0.4)] backdrop-blur-xl border border-[rgba(255,255,255,0.05)] shadow-[inset_0_0_30px_rgba(0,0,0,0.2)] w-full mt-2"
        >
          <div className="w-20 h-20 rounded-full bg-gradient-to-br from-indigo-500/10 to-purple-600/10 border border-[rgba(99,102,241,0.2)] flex items-center justify-center mb-2 shadow-[0_0_20px_rgba(99,102,241,0.15)]">
            <GitBranch size={32} className="text-indigo-400" />
          </div>
          <div>
            <p className="text-base font-semibold text-[var(--color-text-primary)]">
              {filtersActive ? 'No workflows match your filters' : 'No workflows yet'}
            </p>
            <p className="text-sm text-[var(--color-text-muted)] mt-1 max-w-sm mx-auto">
              {filtersActive
                ? 'Try a different search term, or widen the domain filter.'
                : 'Build your first multi-agent pipeline — describe the goal and let the planner assemble it, or drag agents onto a canvas yourself.'}
            </p>
          </div>
          <button
            onClick={filtersActive ? clearFilters : () => navigate('/workflows/new')}
            className="btn-primary flex items-center gap-2 px-5 py-2.5 text-sm rounded-lg mt-2"
          >
            {filtersActive ? <RotateCcw size={16} /> : <Plus size={16} />}
            {filtersActive ? 'Clear filters' : 'New Workflow'}
          </button>
        </motion.div>
      ) : (
        <motion.div
          variants={containerVariants} initial="hidden" animate="show"
          className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4"
        >
          {workflows.map((wf: Record<string, unknown>) => (
            <WorkflowCard
              key={String(wf.name)}
              wf={wf}
              domains={domainsFor(String(wf.name))}
              onArchive={() => archiveMut.mutate(String(wf.name))}
              onExecute={() => navigate(`/workflows/${encodeURIComponent(String(wf.name))}/execute`)}
              onView={() => navigate(`/workflows/${encodeURIComponent(String(wf.name))}`)}
              onEdit={() => navigate(`/workflows/${encodeURIComponent(String(wf.name))}/edit`)}
              onRegister={() => registerMut.mutate(String(wf.name))}
              onPackage={() => setPackagingName(String(wf.name))}
              onClassify={() => setClassifyingName(String(wf.name))}
              isRegistering={registeringName === String(wf.name)}
            />
          ))}
        </motion.div>
      )}

      {packagingName && (
        <DeployPackageModal workflowName={packagingName} onClose={() => setPackagingName(null)} />
      )}

      {classifyingName && (
        <WorkflowClassificationModal workflowName={classifyingName} onClose={() => setClassifyingName(null)} />
      )}
    </div>
  );
}
