import { motion } from 'framer-motion';
import { useQuery } from '@tanstack/react-query';
import { X, Play, Loader2, CheckCircle2, AlertCircle, Clock, GitBranch } from 'lucide-react';
import { workflowsApi } from '../../api/workflows';
import { cn } from '../../lib/utils';

export default function WorkflowHistoryPanel({
  workflowName,
  onClose,
  onSelectExecution,
}: {
  workflowName: string;
  onClose: () => void;
  onSelectExecution: (id: string) => void;
}) {
  const { data, isLoading } = useQuery({
    queryKey: ['executions', workflowName],
    queryFn: () => workflowsApi.listExecutions(workflowName).then(r => r.data),
    refetchInterval: 5000, // Refresh occasionally
  });

  const executions = (data?.executions ?? []) as any[];

  return (
    <>
      {/* Backdrop */}
      <motion.div
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        className="fixed inset-0 bg-black/50 backdrop-blur-sm z-40"
        onClick={onClose}
      />
      {/* Side Panel */}
      <motion.div
        initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }}
        transition={{ type: 'spring', stiffness: 300, damping: 30 }}
        className="fixed top-0 right-0 bottom-0 w-96 bg-[var(--color-bg-base)] border-l border-[var(--color-border-subtle)] shadow-2xl z-50 flex flex-col"
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] shrink-0">
          <div className="flex items-center gap-2">
            <Clock size={16} className="text-[#a5b4fc]" />
            <h2 className="text-sm font-semibold text-white">Execution History</h2>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-md text-[var(--color-text-muted)] hover:text-white hover:bg-[var(--color-bg-hover)] transition-colors">
            <X size={16} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 custom-scrollbar space-y-3">
          {isLoading ? (
            <div className="flex items-center justify-center h-32">
              <Loader2 size={24} className="animate-spin text-[var(--color-text-muted)]" />
            </div>
          ) : executions.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-48 text-center px-4">
              <GitBranch size={24} className="text-[var(--color-text-muted)] mb-3" />
              <p className="text-sm text-[var(--color-text-secondary)]">No previous executions found.</p>
              <p className="text-xs text-[var(--color-text-muted)] mt-1">Run this workflow to see its history here.</p>
            </div>
          ) : (
            executions.map((exec) => (
              <div
                key={exec.execution_id}
                onClick={() => {
                  onSelectExecution(exec.execution_id);
                  onClose();
                }}
                className="surface-card rounded-xl p-4 border border-[var(--color-border-subtle)] hover:border-[#6366f1] cursor-pointer transition-colors group"
              >
                <div className="flex items-center justify-between mb-2">
                  <p className="text-xs font-mono text-[var(--color-text-primary)] truncate max-w-[200px]">{exec.execution_id}</p>
                  <span className={cn('flex items-center gap-1 text-[10px] font-semibold uppercase px-2 py-0.5 rounded-full border', {
                    'COMPLETED': 'text-[var(--color-accent-success)] bg-[rgba(34,197,94,0.1)] border-[rgba(34,197,94,0.2)]',
                    'FAILED': 'text-[var(--color-accent-danger)] bg-[rgba(239,68,68,0.1)] border-[rgba(239,68,68,0.2)]',
                    'RUNNING': 'text-[var(--color-accent-warning)] bg-[rgba(245,158,11,0.1)] border-[rgba(245,158,11,0.2)]',
                  }[exec.status as string] || 'text-[var(--color-text-muted)] bg-[var(--color-bg-hover)] border-[var(--color-border-subtle)]')}>
                    {exec.status === 'RUNNING' && <Loader2 size={10} className="animate-spin" />}
                    {exec.status === 'COMPLETED' && <CheckCircle2 size={10} />}
                    {exec.status === 'FAILED' && <AlertCircle size={10} />}
                    {exec.status}
                  </span>
                </div>
                <div className="flex items-center justify-between text-[10px] text-[var(--color-text-muted)] mt-3">
                  <p>{new Date(exec.start_time).toLocaleString()}</p>
                  <p className="flex items-center gap-1 opacity-0 group-hover:opacity-100 text-[#a5b4fc] transition-opacity">
                    <Play size={10} /> View Run
                  </p>
                </div>
              </div>
            ))
          )}
        </div>
      </motion.div>
    </>
  );
}
