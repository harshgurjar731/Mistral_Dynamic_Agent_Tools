import { motion } from 'framer-motion';
import { X, Clock, GitBranch, AlertCircle, CheckCircle2, Trash2, Loader2 } from 'lucide-react';
import { cn } from '../../lib/utils';
import type { TimelineStep } from './WorkflowPlanner';

export interface PlannerHistoryEntry {
  id: string;
  timestamp: number;
  goal: string;
  workflowName: string | null;
  steps: TimelineStep[];
  hasFatalError: boolean;
  restoredFromBackend?: boolean;
}

function HistorySkeleton() {
  return (
    <div className="space-y-3">
      {[...Array(3)].map((_, i) => (
        <div key={i} className="surface-card rounded-xl p-4 border border-[var(--color-border-subtle)] animate-pulse">
          <div className="flex items-start justify-between mb-3 gap-2">
            <div className="flex-1 space-y-2">
              <div className="h-4 w-4/5 rounded bg-[var(--color-bg-hover)]" />
              <div className="h-3 w-3/5 rounded bg-[var(--color-bg-hover)]" />
            </div>
            <div className="h-5 w-16 rounded-full bg-[var(--color-bg-hover)] shrink-0" />
          </div>
          <div className="h-3 w-1/3 rounded bg-[var(--color-bg-hover)] mb-3" />
          <div className="flex items-center justify-between pt-2 border-t border-[var(--color-border-subtle)]">
            <div className="h-3 w-1/4 rounded bg-[var(--color-bg-hover)]" />
            <div className="h-3 w-1/5 rounded bg-[var(--color-bg-hover)]" />
          </div>
        </div>
      ))}
    </div>
  );
}

export default function PlannerHistoryPanel({
  history,
  isLoading,
  onClose,
  onSelectEntry,
  onClearHistory,
}: {
  history: PlannerHistoryEntry[];
  isLoading?: boolean;
  onClose: () => void;
  onSelectEntry: (entry: PlannerHistoryEntry) => void;
  onClearHistory: () => void;
}) {
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
        className="fixed top-0 right-0 bottom-0 w-[400px] max-w-[100vw] bg-[var(--color-bg-base)] border-l border-[var(--color-border-subtle)] shadow-2xl z-50 flex flex-col"
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] shrink-0">
          <div className="flex items-center gap-2">
            <Clock size={16} className="text-[#a5b4fc]" />
            <h2 className="text-sm font-semibold text-white">Planning History</h2>
            {isLoading && <Loader2 size={14} className="animate-spin text-[var(--color-text-muted)]" />}
          </div>
          <button onClick={onClose} className="p-1.5 rounded-md text-[var(--color-text-muted)] hover:text-white hover:bg-[var(--color-bg-hover)] transition-colors">
            <X size={16} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 custom-scrollbar space-y-3">
          {isLoading && history.length === 0 ? (
            <HistorySkeleton />
          ) : history.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-48 text-center px-4">
              <GitBranch size={24} className="text-[var(--color-text-muted)] mb-3" />
              <p className="text-sm text-[var(--color-text-secondary)]">No planning history yet.</p>
              <p className="text-xs text-[var(--color-text-muted)] mt-1">Start planning a workflow to see its timeline here.</p>
            </div>
          ) : (
            <>
              {history.map((entry) => (
                <motion.div
                  key={entry.id}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ type: 'spring', stiffness: 400, damping: 30 }}
                  onClick={() => {
                    onSelectEntry(entry);
                    onClose();
                  }}
                  className="surface-card rounded-xl p-4 border border-[var(--color-border-subtle)] hover:border-[#6366f1] cursor-pointer transition-colors group"
                >
                  <div className="flex items-start justify-between mb-2 gap-2">
                    <p className="text-sm font-medium text-white line-clamp-2 leading-snug">{entry.goal}</p>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <span className={cn('flex items-center gap-1 text-[10px] font-semibold uppercase px-2 py-0.5 rounded-full border', {
                        'text-[var(--color-accent-danger)] bg-[rgba(239,68,68,0.1)] border-[rgba(239,68,68,0.2)]': entry.hasFatalError,
                        'text-[var(--color-accent-success)] bg-[rgba(34,197,94,0.1)] border-[rgba(34,197,94,0.2)]': !entry.hasFatalError && entry.workflowName,
                        'text-[var(--color-text-muted)] bg-[var(--color-bg-hover)] border-[var(--color-border-subtle)]': !entry.hasFatalError && !entry.workflowName,
                      })}>
                        {entry.hasFatalError ? <AlertCircle size={10} /> : <CheckCircle2 size={10} />}
                        {entry.hasFatalError ? 'Failed' : entry.workflowName ? 'Success' : 'Incomplete'}
                      </span>
                    </div>
                  </div>
                  {entry.workflowName && !entry.hasFatalError && (
                    <p className="text-xs font-mono text-[#a5b4fc] mb-3">{entry.workflowName}</p>
                  )}
                  <div className="flex items-center justify-between text-[10px] text-[var(--color-text-muted)] mt-2 pt-2 border-t border-[var(--color-border-subtle)]">
                    <p>{new Date(entry.timestamp).toLocaleString()}</p>
                    <p className="flex items-center gap-1 opacity-0 group-hover:opacity-100 text-[#a5b4fc] transition-opacity">
                      <Clock size={10} /> View Timeline
                    </p>
                  </div>
                </motion.div>
              ))}
            </>
          )}
        </div>
        
        {history.length > 0 && (
          <div className="p-4 border-t border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] shrink-0">
            <button
              onClick={onClearHistory}
              className="w-full flex items-center justify-center gap-2 py-2 rounded-lg text-sm font-medium text-[var(--color-accent-danger)] bg-[rgba(239,68,68,0.1)] hover:bg-[rgba(239,68,68,0.15)] transition-colors"
            >
              <Trash2 size={16} /> Clear History
            </button>
          </div>
        )}
      </motion.div>
    </>
  );
}
