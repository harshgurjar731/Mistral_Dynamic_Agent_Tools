import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { Tag, X } from 'lucide-react';
import DomainClassificationEditor from '../ontology/DomainClassificationEditor';

/**
 * Show + edit which domain a workflow serves.
 *
 * The visualizer is a canvas plus a top bar rather than a settings panel
 * (unlike agent detail, which has one), so this follows the same
 * toggle-modal pattern as `DeployPackageModal` instead of a docked section.
 * Workflows are keyed by `name` everywhere else in this app — including the
 * annotation writes `schedule_classification` already makes on creation — so
 * `subjectId` is the workflow's name, not a numeric id.
 */
export default function WorkflowClassificationModal({
  workflowName,
  onClose,
}: {
  workflowName: string;
  onClose: () => void;
}) {
  return createPortal(
    <AnimatePresence>
      <div
        className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      >
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 20 }}
          onClick={(e) => e.stopPropagation()}
          className="bg-[var(--color-bg-surface)] border border-[var(--color-border-subtle)] rounded-xl w-full max-w-lg overflow-hidden flex flex-col shadow-2xl max-h-[85vh]"
        >
          <div className="flex items-center justify-between p-5 border-b border-[var(--color-border-subtle)] bg-[var(--color-bg-base)] shrink-0">
            <h2 className="text-sm font-medium text-[var(--color-text-primary)] flex items-center gap-2">
              <Tag size={16} className="text-indigo-400" /> Domain classification
            </h2>
            <button
              onClick={onClose}
              className="text-[var(--color-text-muted)] hover:text-white transition-colors p-1 rounded-md hover:bg-[var(--color-bg-hover)]"
            >
              <X size={16} />
            </button>
          </div>

          <div className="p-6 overflow-y-auto space-y-4">
            <p className="text-xs text-[var(--color-text-muted)]">
              Which business domain <span className="font-mono text-[var(--color-text-secondary)]">{workflowName}</span> serves.
              New workflows are classified automatically — correct it here if that guess was wrong.
            </p>
            <DomainClassificationEditor subjectType="workflow" subjectId={workflowName} />
          </div>
        </motion.div>
      </div>
    </AnimatePresence>,
    document.body,
  );
}
