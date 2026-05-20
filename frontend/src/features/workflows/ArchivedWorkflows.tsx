import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import {
  GitBranch, FolderArchive, RotateCcw, RefreshCw, ArrowLeft
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
  show: { opacity: 1, y: 0, transition: { type: 'spring', stiffness: 300, damping: 24 } },
};

/* ── Workflow Card ─────────────────────────────────────────────────────── */
function ArchivedWorkflowCard({
  wf,
  onUnarchive,
}: {
  wf: Record<string, unknown>;
  onUnarchive: () => void;
}) {
  const steps = (wf.steps as unknown[]) ?? [];

  return (
    <motion.div variants={itemVariants} className="surface-card rounded-xl p-5 group flex flex-col gap-4 opacity-75 hover:opacity-100 transition-opacity">
      {/* Header row */}
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-[var(--color-bg-hover)] border border-[var(--color-border-subtle)] flex items-center justify-center shrink-0">
            <FolderArchive size={18} className="text-[var(--color-text-muted)]" />
          </div>
          <div>
            <p className="text-sm font-semibold text-[var(--color-text-secondary)] font-mono line-through">{String(wf.name)}</p>
            {wf.description && <p className="text-xs text-[var(--color-text-muted)] mt-0.5 line-clamp-1">{String(wf.description)}</p>}
          </div>
        </div>
      </div>

      {/* Meta row */}
      <div className="flex items-center gap-3">
        <span className="text-[10px] font-medium bg-[var(--color-bg-hover)] border border-[var(--color-border-subtle)] px-2 py-0.5 rounded-full text-[var(--color-text-muted)] uppercase tracking-wider">
          {steps.length} step{steps.length !== 1 ? 's' : ''}
        </span>
        {wf.is_deployed && (
          <span className="ml-auto text-[10px] bg-[var(--color-bg-hover)] text-[var(--color-text-muted)] border border-[var(--color-border-subtle)] px-2 py-0.5 rounded-full uppercase font-medium flex items-center gap-1">
            Deployed
          </span>
        )}
      </div>

      {/* Actions row */}
      <div className="flex items-center gap-2 pt-2 border-t border-[var(--color-border-subtle)]">
        <button
          onClick={onUnarchive}
          className="btn-primary flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md flex-1 justify-center"
        >
          <RotateCcw size={12} /> Unarchive
        </button>
      </div>
    </motion.div>
  );
}

/* ── Main Page ────────────────────────────────────────────────────────── */
export default function ArchivedWorkflows() {
  const qc = useQueryClient();
  const navigate = useNavigate();

  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: QK.workflows(),
    queryFn: () =>
      workflowsApi.list().then(r => {
        const d = r.data;
        return Array.isArray(d) ? d : d.workflows ?? [];
      }),
  });

  const unarchiveMut = useMutation({
    mutationFn: (name: string) => workflowsApi.unarchive(name),
    onSuccess: () => qc.invalidateQueries({ queryKey: QK.workflows() }),
    onError: (err: any) => {
      const msg = err?.response?.data?.detail || err?.response?.data?.message || err.message || 'Failed to unarchive workflow';
      alert(msg);
    }
  });

  const workflows = (Array.isArray(data) ? data : (data as any)?.workflows ?? []).filter((w: any) => w.archived);

  return (
    <div className="p-8 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex items-end justify-between mb-8">
        <div>
          <button 
            onClick={() => navigate('/workflows')} 
            className="flex items-center gap-2 text-sm text-[var(--color-text-muted)] hover:text-white mb-2 transition-colors"
          >
            <ArrowLeft size={14} /> Back to Workflows
          </button>
          <h1 className="text-2xl font-semibold tracking-tight text-[var(--color-text-primary)] flex items-center gap-2">
            <FolderArchive size={24} className="text-[var(--color-text-muted)]" /> Archived Workflows
          </h1>
          <p className="text-sm text-[var(--color-text-muted)] mt-1">
            Workflows that have been archived. You can restore them at any time.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => refetch()}
            className="btn-secondary p-2 rounded-md flex items-center"
            title="Refresh"
          >
            <RefreshCw size={15} className={isFetching ? 'animate-spin' : ''} />
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
          initial={{ opacity: 0 }} animate={{ opacity: 1 }}
          className="text-center py-20 border border-dashed border-[var(--color-border-subtle)] rounded-xl flex flex-col items-center gap-4 bg-[var(--color-bg-surface)]"
        >
          <div className="w-16 h-16 rounded-full bg-[var(--color-bg-hover)] flex items-center justify-center mb-2">
            <FolderArchive size={28} className="text-[var(--color-text-muted)]" />
          </div>
          <div>
            <p className="text-base font-semibold text-[var(--color-text-primary)]">No archived workflows</p>
            <p className="text-sm text-[var(--color-text-muted)] mt-1 max-w-sm mx-auto">Archived workflows will appear here.</p>
          </div>
        </motion.div>
      ) : (
        <motion.div
          variants={containerVariants} initial="hidden" animate="show"
          className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4"
        >
          {workflows.map((wf: Record<string, unknown>) => (
            <ArchivedWorkflowCard
              key={String(wf.name)}
              wf={wf as Record<string, unknown>}
              onUnarchive={() => unarchiveMut.mutate(String(wf.name))}
            />
          ))}
        </motion.div>
      )}
    </div>
  );
}
