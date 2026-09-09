/**
 * LibraryProvisionedCard — an empty document library created for a new agent.
 *
 * Shown because the agent is deliberately wired to something with no content in
 * it yet: the user needs to know it exists and that filling it is the next
 * step, or the agent will look broken when it finds nothing to cite.
 */
import { AlertCircle, FolderPlus } from 'lucide-react';

export default function LibraryProvisionedCard({ data }: { data: Record<string, any> }) {
  if (data.created === false) {
    return (
      <div className="surface-card rounded-xl p-4 mt-3 border border-[rgba(245,158,11,0.25)] flex items-start gap-2.5">
        <AlertCircle size={13} className="text-amber-400 shrink-0 mt-0.5" />
        <div>
          <p className="text-xs font-semibold text-amber-300">
            Could not create “{data.name}”
          </p>
          <p className="text-[11px] text-[var(--color-text-muted)] mt-0.5">
            {data.error} — the agent was created without it and will answer from general knowledge.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="surface-card rounded-xl p-4 mt-3 border border-[rgba(99,102,241,0.22)] bg-[rgba(99,102,241,0.04)]">
      <div className="flex items-center gap-2">
        <FolderPlus size={13} className="text-[#a5b4fc]" />
        <span className="text-xs font-semibold text-white">{data.name}</span>
        <span className="text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-[rgba(99,102,241,0.12)] border border-[rgba(99,102,241,0.2)] text-[#a5b4fc]">
          empty
        </span>
      </div>
      {!!data.description && (
        <p className="text-[11px] text-[var(--color-text-secondary)] mt-1.5">{data.description}</p>
      )}
      <p className="text-[11px] text-[var(--color-text-muted)] mt-2 leading-relaxed">
        No existing library covered this subject, so one was created and attached.
        Upload documents to it and the agent will start using them — no changes needed.
      </p>
      {!!data.library_id && (
        <p className="text-[10px] font-mono text-[var(--color-text-muted)] mt-1.5">{data.library_id}</p>
      )}
    </div>
  );
}
