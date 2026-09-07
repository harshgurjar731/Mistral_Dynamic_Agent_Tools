/**
 * Inline creation modals for the builder.
 *
 * Assembling a workflow usually surfaces a missing piece — an agent that does
 * not exist yet, or a tool nobody has synthesised. Sending the user to another
 * page to create it loses the canvas they were building, so both flows run here
 * and hand the created object straight back to the palette.
 */

import { useState } from 'react';
import { createPortal } from 'react-dom';
import { motion } from 'framer-motion';
import { AlertCircle, Cpu, Loader2, Sparkles, X } from 'lucide-react';
import { agentsApi, type Agent } from '../../../api/agents';
import { toolsApi, type ToolPurpose } from '../../../api/tools';
import type { CatalogTool } from '../../../api/workflowBuilder';
import { cn } from '../../../lib/utils';

/* ── Shared shell ───────────────────────────────────────────────────────── */

function ModalShell({
  title,
  subtitle,
  icon,
  onClose,
  children,
  footer,
  busy,
}: {
  title: string;
  subtitle: string;
  icon: React.ReactNode;
  onClose: () => void;
  children: React.ReactNode;
  footer: React.ReactNode;
  busy?: boolean;
}) {
  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onClick={() => !busy && onClose()}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.97, y: 8 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        onClick={(e) => e.stopPropagation()}
        className="surface-card hover:!transform-none hover:!shadow-none hover:!border-[var(--color-border-subtle)] rounded-2xl w-full max-w-lg max-h-[88vh] flex flex-col overflow-hidden"
      >
        <div className="flex items-center gap-3 px-5 py-4 border-b border-[var(--color-border-subtle)] shrink-0">
          <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center shrink-0">
            {icon}
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="text-sm font-bold text-white">{title}</h2>
            <p className="text-[11px] text-[var(--color-text-muted)] leading-tight mt-0.5">
              {subtitle}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            aria-label="Close"
            className="text-[var(--color-text-muted)] hover:text-white p-1.5 rounded-md hover:bg-[var(--color-bg-hover)] transition-colors disabled:opacity-40"
          >
            <X size={16} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto custom-scrollbar px-5 py-4 space-y-4 min-h-0">
          {children}
        </div>

        <div className="flex items-center justify-end gap-2 px-5 py-3.5 border-t border-[var(--color-border-subtle)] shrink-0">
          {footer}
        </div>
      </motion.div>
    </div>,
    document.body,
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="block text-[10px] font-bold uppercase tracking-wider text-[var(--color-text-muted)] mb-1.5">
        {label}
      </label>
      {children}
      {hint && (
        <p className="text-[10px] text-[var(--color-text-muted)] mt-1.5 leading-relaxed">{hint}</p>
      )}
    </div>
  );
}

function ErrorNote({ message }: { message: string }) {
  return (
    <div className="flex items-start gap-2 rounded-lg px-3 py-2.5 bg-red-500/8 border border-red-500/25">
      <AlertCircle size={13} className="text-red-400 shrink-0 mt-px" />
      <p className="text-[11px] text-red-300 leading-relaxed break-words">{message}</p>
    </div>
  );
}

const inputClass =
  'minimal-input w-full rounded-lg px-3 py-2 text-xs outline-none focus:border-[var(--color-border-focus)]';

function errorMessage(err: unknown, fallback: string): string {
  const anyErr = err as { response?: { data?: { detail?: unknown } }; message?: string };
  const detail = anyErr?.response?.data?.detail;
  if (typeof detail === 'string') return detail;
  if (detail) return JSON.stringify(detail);
  return anyErr?.message ?? fallback;
}

/* ── Create agent ───────────────────────────────────────────────────────── */

export function CreateAgentModal({
  models,
  tiers,
  tools,
  onClose,
  onCreated,
}: {
  models: string[];
  tiers: string[];
  tools: CatalogTool[];
  onClose: () => void;
  onCreated: (agentId: string) => void;
}) {
  const [name, setName] = useState('');
  const [model, setModel] = useState(models[0] ?? 'mistral-large-latest');
  const [tier, setTier] = useState(tiers[0] ?? 'foundation');
  const [description, setDescription] = useState('');
  const [instructions, setInstructions] = useState('');
  const [selectedTools, setSelectedTools] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSubmit = name.trim().length > 1 && instructions.trim().length > 20 && !busy;

  const toggleTool = (toolName: string) =>
    setSelectedTools((prev) =>
      prev.includes(toolName) ? prev.filter((t) => t !== toolName) : [...prev, toolName],
    );

  const submit = async () => {
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    try {
      const res = await agentsApi.create({
        name: name.trim(),
        model,
        description: description.trim() || `Workflow agent: ${name.trim()}`,
        instructions: instructions.trim(),
        tier,
        // Tools are bound at agent creation — this is what the model may call.
        tools: selectedTools as unknown as Agent['tools'],
      });
      onCreated(res.data.id);
    } catch (err) {
      setError(errorMessage(err, 'Failed to create the agent.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <ModalShell
      title="Create agent"
      subtitle="Added to your Mistral account and dropped into the palette"
      icon={<Cpu size={17} className="text-white" />}
      onClose={onClose}
      busy={busy}
      footer={
        <>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="btn-secondary px-4 py-2 text-xs rounded-lg disabled:opacity-40"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={!canSubmit}
            className="btn-primary px-4 py-2 text-xs rounded-lg flex items-center gap-2 disabled:opacity-40"
          >
            {busy && <Loader2 size={13} className="animate-spin" />}
            Create agent
          </button>
        </>
      }
    >
      {error && <ErrorNote message={error} />}

      <Field label="Name">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Risk Assessor"
          className={inputClass}
          autoFocus
        />
      </Field>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Model">
          <select value={model} onChange={(e) => setModel(e.target.value)} className={inputClass}>
            {models.map((m) => (
              <option key={m} value={m} className="bg-[#0d121e]">
                {m}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Tier">
          <select value={tier} onChange={(e) => setTier(e.target.value)} className={inputClass}>
            {tiers.map((t) => (
              <option key={t} value={t} className="bg-[#0d121e]">
                {t}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <Field label="Description">
        <input
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="One line on what this agent is for"
          className={inputClass}
        />
      </Field>

      <Field
        label="Instructions"
        hint="Cover the role, the task, the expected output format, and what to do when information is missing. Short instructions produce vague agents."
      >
        <textarea
          value={instructions}
          onChange={(e) => setInstructions(e.target.value)}
          rows={7}
          placeholder={
            'ROLE: You are …\nTASK: …\nOUTPUT FORMAT: …\nCONSTRAINTS: …\nFALLBACK: If information is missing, state the assumption and continue.'
          }
          className={cn(inputClass, 'resize-none font-mono leading-relaxed custom-scrollbar')}
        />
        <p
          className={cn(
            'text-[10px] mt-1',
            instructions.trim().length < 20
              ? 'text-amber-400'
              : 'text-[var(--color-text-muted)]',
          )}
        >
          {instructions.trim().length} characters{instructions.trim().length < 20 && ' — need at least 20'}
        </p>
      </Field>

      <Field
        label={`Tools (${selectedTools.length} selected)`}
        hint="What this agent is allowed to call. The model decides when to use them — you can change this later from the canvas."
      >
        {tools.length === 0 ? (
          <p className="text-[11px] text-[var(--color-text-muted)]">No tools available yet.</p>
        ) : (
          <div className="max-h-44 overflow-y-auto custom-scrollbar rounded-lg border border-[var(--color-border-subtle)] divide-y divide-[var(--color-border-subtle)]">
            {tools.map((tool) => {
              const checked = selectedTools.includes(tool.name);
              return (
                <label
                  key={`${tool.source}:${tool.name}`}
                  className="flex items-start gap-2 px-2.5 py-2 cursor-pointer hover:bg-[var(--color-bg-hover)] transition-colors"
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggleTool(tool.name)}
                    className="mt-0.5 accent-[#6366f1] shrink-0"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block text-[11px] font-mono text-white truncate">
                      {tool.name}
                    </span>
                    {tool.description && (
                      <span className="block text-[10px] text-[var(--color-text-muted)] leading-snug line-clamp-2">
                        {tool.description}
                      </span>
                    )}
                  </span>
                  <span className="text-[8.5px] uppercase font-bold text-[var(--color-text-muted)] shrink-0 mt-0.5">
                    {tool.source}
                  </span>
                </label>
              );
            })}
          </div>
        )}
      </Field>
    </ModalShell>
  );
}

/* ── Create tool ────────────────────────────────────────────────────────── */

export function CreateToolModal({
  onClose,
  onCreated,
  purpose,
}: {
  onClose: () => void;
  onCreated: (toolName: string) => void;
  /** Tags the record so it shows up in the right gallery — see toolGalleryShared.tsx. */
  purpose: ToolPurpose;
}) {
  const [task, setTask] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSubmit = task.trim().length > 10 && !busy;

  const submit = async () => {
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    try {
      // Synthesis is the full codegen → lint → sandbox → approve pipeline, so
      // this can legitimately take a while; the axios client allows for it.
      const res = await toolsApi.synthesize(task.trim(), purpose);
      const data = res.data as { status?: string; tool_name?: string; message?: string };

      if (data.status === 'failed' || data.status === 'error') {
        setError(data.message ?? 'Tool synthesis failed.');
        return;
      }
      onCreated(data.tool_name ?? '');
    } catch (err) {
      setError(errorMessage(err, 'Failed to synthesise the tool.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <ModalShell
      title={purpose === 'activity' ? 'Synthesise activity' : 'Synthesise tool'}
      subtitle="Codestral writes it, then it is linted and sandbox-tested"
      icon={<Sparkles size={17} className="text-white" />}
      onClose={onClose}
      busy={busy}
      footer={
        <>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="btn-secondary px-4 py-2 text-xs rounded-lg disabled:opacity-40"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={!canSubmit}
            className="btn-primary px-4 py-2 text-xs rounded-lg flex items-center gap-2 disabled:opacity-40"
          >
            {busy && <Loader2 size={13} className="animate-spin" />}
            {busy ? 'Synthesising…' : 'Synthesise'}
          </button>
        </>
      }
    >
      {error && <ErrorNote message={error} />}

      <Field
        label={purpose === 'activity' ? 'What should the activity do?' : 'What should the tool do?'}
        hint="Describe the inputs, the work, and the shape of the result. Name any external API it should call — the generator can only use the standard library plus a fixed allow-list of packages."
      >
        <textarea
          value={task}
          onChange={(e) => setTask(e.target.value)}
          rows={6}
          autoFocus
          placeholder="e.g. Given a loan amount, annual interest rate and term in years, return the monthly repayment, total interest and an amortisation summary."
          className={cn(inputClass, 'resize-none leading-relaxed custom-scrollbar')}
        />
      </Field>

      {busy && (
        <div className="rounded-lg px-3 py-2.5 bg-[rgba(99,102,241,0.06)] border border-[rgba(99,102,241,0.2)]">
          <p className="text-[11px] text-[var(--color-text-secondary)] leading-relaxed">
            Generating code, running static analysis, and executing it in the sandbox. Failures are
            fed back to the model and retried automatically — this usually takes 20–60 seconds.
          </p>
        </div>
      )}
    </ModalShell>
  );
}
