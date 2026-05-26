import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import {
  GitBranch, Play, Archive, Loader2, Plus, Eye,
  RefreshCw, Sparkles, FolderArchive, Server, Zap,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { workflowsApi } from '../../api/workflows';
import { QK } from '../../lib/queryClient';

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
  onArchive,
  onExecute,
  onView,
  onRegister,
  isRegistering,
}: {
  wf: Record<string, unknown>;
  onArchive: () => void;
  onExecute: () => void;
  onView: () => void;
  onRegister: () => void;
  isRegistering: boolean;
}) {
  const steps = (wf.steps as unknown[]) ?? [];
  const isDeployed = Boolean(wf.is_deployed);
  const mistralId = wf.id as string | undefined;

  return (
    <motion.div variants={itemVariants} className="surface-card rounded-xl p-5 group flex flex-col h-full gap-4">
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
          onClick={onArchive}
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
      </div>

      {/* Actions row */}
      <div className="flex flex-wrap sm:flex-nowrap items-center gap-2 pt-2 mt-auto border-t border-[var(--color-border-subtle)]">
        <button
          onClick={onView}
          className="btn-secondary flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md flex-1 justify-center"
        >
          <Eye size={12} /> View
        </button>

        {!isDeployed && (
          <button
            onClick={onRegister}
            disabled={isRegistering}
            className="btn-secondary flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md flex-1 justify-center disabled:opacity-50"
            title="Register on Mistral server"
          >
            {isRegistering ? <Loader2 size={12} className="animate-spin" /> : <Server size={12} />}
            Register
          </button>
        )}

        <button
          onClick={onExecute}
          className="btn-primary flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md flex-1 justify-center"
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

  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: QK.workflows(),
    queryFn: () =>
      workflowsApi.list().then(r => {
        const d = r.data;
        return Array.isArray(d) ? d : d.workflows ?? [];
      }),
  });

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

  const workflows = (Array.isArray(data) ? data : (data as any)?.workflows ?? []).filter((w: unknown) => !(w as Record<string, unknown>).archived);

  return (
    <div className="p-8 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex items-end justify-between mb-8">
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
            <Sparkles size={15} /> Plan New Workflow
          </button>
        </div>
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
            <p className="text-base font-semibold text-[var(--color-text-primary)]">No workflows yet</p>
            <p className="text-sm text-[var(--color-text-muted)] mt-1 max-w-sm mx-auto">
              Get started by planning your first dynamic multi-agent pipeline. It will be registered on Mistral automatically.
            </p>
          </div>
          <button
            onClick={() => navigate('/workflows/new')}
            className="btn-primary flex items-center gap-2 px-5 py-2.5 text-sm rounded-lg mt-2"
          >
            <Plus size={16} /> Plan Workflow
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
              onArchive={() => archiveMut.mutate(String(wf.name))}
              onExecute={() => navigate(`/workflows/${encodeURIComponent(String(wf.name))}/execute`)}
              onView={() => navigate(`/workflows/${encodeURIComponent(String(wf.name))}`)}
              onRegister={() => registerMut.mutate(String(wf.name))}
              isRegistering={registeringName === String(wf.name)}
            />
          ))}
        </motion.div>
      )}

    </div>
  );
}
