import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Check, ChevronDown, ChevronRight, Loader2, Plus, ShieldCheck, Trash2, X,
} from 'lucide-react';
import { ontologyApi, type OntologyRule, type RuleException } from '../../api/ontology';
import { cn } from '../../lib/utils';

/**
 * Rules — the declarative layer over the four checks the builder used to run
 * as fixed Python. A rule is data: it can be added, disabled, or have its
 * parameters changed without a deploy. A draft has zero effect on validation
 * until approved, and an exception is a specific, reasoned, audited
 * derogation for one subject — never a silent skip.
 */

const KIND_LABELS: Record<string, string> = {
  capability_gap: 'Capability coverage',
  egress: 'Restricted data egress',
  guardrail: 'Guardrail coverage',
  library_domain: 'Library / domain match',
  cardinality: 'Cardinality',
  derives_annotation: 'Derived annotation',
};

const KIND_HINT: Record<string, string> = {
  capability_gap: 'An agent must be able to reach every capability it requires.',
  egress: 'Restricted data (params.restricted_data_classes) must not reach a connector that egresses to a third party.',
  guardrail: 'The entry step should be governed by the required tier (params.required_tier).',
  library_domain: "An agent's document library should belong to the domain(s) it serves.",
  cardinality: 'A subject must have between params.min and params.max annotations for params.predicate.',
  derives_annotation: 'If params.when holds, write params.write as a new annotation with source="derived".',
};

const SEVERITY_TONE: Record<string, string> = {
  error: 'text-red-300 border-red-400/30 bg-red-500/10',
  warning: 'text-amber-300 border-amber-400/30 bg-amber-500/10',
};

const STATUS_TONE: Record<string, string> = {
  draft: 'text-slate-300 border-slate-400/30 bg-slate-500/10',
  approved: 'text-emerald-300 border-emerald-400/30 bg-emerald-500/10',
  superseded: 'text-slate-400 border-slate-500/30 bg-slate-600/10',
};

export default function RulesTab() {
  const qc = useQueryClient();
  const [showEditor, setShowEditor] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['ontology', 'rules'],
    queryFn: () => ontologyApi.rules().then((r) => r.data),
  });

  const approve = useMutation({
    mutationFn: (id: string) => ontologyApi.approveRule(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['ontology', 'rules'] }),
  });

  const remove = useMutation({
    mutationFn: (id: string) => ontologyApi.deleteRule(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['ontology', 'rules'] }),
  });

  const rules = data?.rules ?? [];

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="max-w-2xl text-sm text-[var(--color-text-muted)]">
          The governance checks the workflow builder runs before you publish, as data instead of
          code. A rule has no effect until its status is <strong className="text-[var(--color-text-secondary)]">approved</strong>.
          Exceptions grant one subject a specific, reasoned exemption from one rule.
        </p>
        <button
          onClick={() => setShowEditor(true)}
          className="btn-primary flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs"
        >
          <Plus size={12} /> Add rule
        </button>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center gap-2 py-12 text-sm text-[var(--color-text-muted)]">
          <Loader2 size={16} className="animate-spin" /> Loading rules…
        </div>
      ) : rules.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-[var(--color-border-subtle)] py-14 text-center">
          <ShieldCheck size={22} className="mb-3 text-[var(--color-text-muted)] opacity-40" />
          <p className="text-sm text-[var(--color-text-secondary)]">No rules recorded yet.</p>
          <p className="mt-1 max-w-sm text-xs text-[var(--color-text-muted)]">
            Add one, or check that the seed file loaded on startup.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {rules.map((rule) => (
            <RuleRow
              key={rule.id}
              rule={rule}
              expanded={expanded === rule.id}
              onToggle={() => setExpanded(expanded === rule.id ? null : rule.id)}
              onApprove={() => approve.mutate(rule.id)}
              onDelete={() => remove.mutate(rule.id)}
              busy={approve.isPending || remove.isPending}
            />
          ))}
        </div>
      )}

      {showEditor && (
        <RuleEditor
          onClose={() => setShowEditor(false)}
          onSaved={() => {
            setShowEditor(false);
            qc.invalidateQueries({ queryKey: ['ontology', 'rules'] });
          }}
        />
      )}
    </div>
  );
}

function RuleRow({
  rule, expanded, onToggle, onApprove, onDelete, busy,
}: {
  rule: OntologyRule;
  expanded: boolean;
  onToggle: () => void;
  onApprove: () => void;
  onDelete: () => void;
  busy: boolean;
}) {
  return (
    <div className="rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)]">
      <button
        onClick={onToggle}
        className="flex w-full items-center gap-2 p-3.5 text-left"
      >
        {expanded ? <ChevronDown size={13} className="shrink-0 text-[var(--color-text-muted)]" /> : <ChevronRight size={13} className="shrink-0 text-[var(--color-text-muted)]" />}
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <h3 className="truncate text-sm font-semibold text-white">{rule.label}</h3>
            <code className="rounded bg-black/30 px-1 font-mono text-[9px] text-indigo-300">{rule.id}</code>
          </span>
          <p className="mt-0.5 truncate text-[11px] text-[var(--color-text-muted)]">
            {KIND_LABELS[rule.kind] ?? rule.kind} · {KIND_HINT[rule.kind] ?? ''}
          </p>
        </span>
        <span className={cn('shrink-0 rounded-full border px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider', SEVERITY_TONE[rule.severity] ?? SEVERITY_TONE.warning)}>
          {rule.severity}
        </span>
        <span className={cn('shrink-0 rounded-full border px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider', STATUS_TONE[rule.status] ?? STATUS_TONE.draft)}>
          {rule.status}
        </span>
        <span className={cn('shrink-0 rounded border px-1.5 py-0.5 text-[9px]', rule.source === 'seed' ? 'border-indigo-400/25 bg-indigo-500/10 text-indigo-300' : 'border-[var(--color-border-subtle)] text-[var(--color-text-muted)]')}>
          {rule.source}
        </span>
      </button>

      {expanded && (
        <div className="space-y-3 border-t border-[var(--color-border-subtle)] p-3.5">
          <div className="flex flex-wrap items-center gap-2">
            {rule.status === 'draft' && (
              <button
                onClick={onApprove}
                disabled={busy}
                className="flex items-center gap-1.5 rounded-lg border border-emerald-400/30 bg-emerald-500/10 px-2.5 py-1 text-[11px] text-emerald-300 hover:bg-emerald-500/20 disabled:opacity-40"
              >
                <Check size={11} /> Approve
              </button>
            )}
            <button
              onClick={onDelete}
              disabled={busy}
              className="flex items-center gap-1.5 rounded-lg border border-[var(--color-border-subtle)] px-2.5 py-1 text-[11px] text-[var(--color-text-secondary)] hover:border-red-400/40 hover:text-red-300 disabled:opacity-40"
            >
              <Trash2 size={11} /> Delete
            </button>
          </div>

          <pre className="max-h-40 overflow-auto rounded-lg bg-black/30 p-2.5 font-mono text-[10px] leading-relaxed text-[var(--color-text-muted)]">
            {JSON.stringify(rule.params, null, 2)}
          </pre>

          <ExceptionsPanel ruleId={rule.id} />
        </div>
      )}
    </div>
  );
}

function ExceptionsPanel({ ruleId }: { ruleId: string }) {
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['ontology', 'rules', ruleId, 'exceptions'],
    queryFn: () => ontologyApi.ruleExceptions(ruleId).then((r) => r.data),
  });

  const remove = useMutation({
    mutationFn: (id: number) => ontologyApi.removeRuleException(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['ontology', 'rules', ruleId, 'exceptions'] }),
  });

  const exceptions = data?.exceptions ?? [];

  return (
    <div className="rounded-lg border border-[var(--color-border-subtle)] bg-black/20 p-2.5">
      <div className="mb-2 flex items-center justify-between">
        <p className="text-[10px] font-bold uppercase tracking-wider text-[var(--color-text-muted)]">
          Exceptions {exceptions.length > 0 && `(${exceptions.length})`}
        </p>
        <button
          onClick={() => setShowForm((v) => !v)}
          className="flex items-center gap-1 text-[10px] text-indigo-300 hover:text-white"
        >
          <Plus size={10} /> Grant exception
        </button>
      </div>

      {isLoading ? (
        <p className="text-[11px] text-[var(--color-text-muted)]">Loading…</p>
      ) : exceptions.length === 0 ? (
        <p className="text-[11px] text-[var(--color-text-muted)]">No exceptions granted for this rule.</p>
      ) : (
        <div className="space-y-1.5">
          {exceptions.map((exc) => (
            <ExceptionRow key={exc.id} exception={exc} onDelete={() => remove.mutate(exc.id)} />
          ))}
        </div>
      )}

      {showForm && (
        <ExceptionForm
          ruleId={ruleId}
          onCancel={() => setShowForm(false)}
          onSaved={() => {
            setShowForm(false);
            qc.invalidateQueries({ queryKey: ['ontology', 'rules', ruleId, 'exceptions'] });
          }}
        />
      )}
    </div>
  );
}

function ExceptionRow({ exception, onDelete }: { exception: RuleException; onDelete: () => void }) {
  const expired = exception.expires_at ? new Date(exception.expires_at).getTime() < Date.now() : false;
  return (
    <div className="rounded border border-[var(--color-border-subtle)] bg-black/20 px-2 py-1.5 text-[11px]">
      <div className="flex items-center justify-between gap-2">
        <span className="min-w-0 truncate text-[var(--color-text-secondary)]">
          <code className="font-mono text-[10px] text-indigo-300">{exception.subject_type}:{exception.subject_id}</code>
        </span>
        <span className="flex shrink-0 items-center gap-1.5">
          {expired && (
            <span className="rounded border border-amber-400/25 bg-amber-500/10 px-1 text-[9px] text-amber-300">expired</span>
          )}
          <button onClick={onDelete} className="rounded p-0.5 text-[var(--color-text-muted)] hover:text-red-300">
            <Trash2 size={10} />
          </button>
        </span>
      </div>
      <p className="mt-0.5 text-[10px] text-[var(--color-text-muted)]">
        "{exception.reason}" — granted by {exception.granted_by}
        {exception.expires_at && `, expires ${new Date(exception.expires_at).toLocaleDateString()}`}
      </p>
    </div>
  );
}

function ExceptionForm({ ruleId, onCancel, onSaved }: { ruleId: string; onCancel: () => void; onSaved: () => void }) {
  const [subjectType, setSubjectType] = useState('agent');
  const [subjectId, setSubjectId] = useState('');
  const [reason, setReason] = useState('');
  const [grantedBy, setGrantedBy] = useState('');
  const [expiresAt, setExpiresAt] = useState('');

  const save = useMutation({
    mutationFn: () =>
      ontologyApi.addRuleException(ruleId, {
        subject_type: subjectType,
        subject_id: subjectId.trim(),
        reason: reason.trim(),
        granted_by: grantedBy.trim(),
        expires_at: expiresAt || undefined,
      }),
    onSuccess: onSaved,
  });

  const detail = (save.error as any)?.response?.data?.detail;

  return (
    <div className="mt-2.5 space-y-2 rounded-lg border border-indigo-400/25 bg-indigo-500/5 p-2.5">
      <div className="grid grid-cols-2 gap-2">
        <select
          value={subjectType}
          onChange={(e) => setSubjectType(e.target.value)}
          className="minimal-input rounded px-2 py-1 text-[11px]"
        >
          {['agent', 'tool', 'connector', 'workflow', 'library'].map((t) => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>
        <input
          value={subjectId}
          onChange={(e) => setSubjectId(e.target.value)}
          placeholder="subject id"
          className="minimal-input rounded px-2 py-1 text-[11px]"
        />
      </div>
      <input
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder="Reason — required, this is the derogation's justification"
        className="minimal-input w-full rounded px-2 py-1 text-[11px]"
      />
      <div className="grid grid-cols-2 gap-2">
        <input
          value={grantedBy}
          onChange={(e) => setGrantedBy(e.target.value)}
          placeholder="Granted by"
          className="minimal-input rounded px-2 py-1 text-[11px]"
        />
        <input
          type="date"
          value={expiresAt}
          onChange={(e) => setExpiresAt(e.target.value)}
          className="minimal-input rounded px-2 py-1 text-[11px]"
        />
      </div>
      {detail && <p className="text-[10px] text-red-300">{detail}</p>}
      <div className="flex justify-end gap-1.5">
        <button onClick={onCancel} className="rounded px-2 py-1 text-[10px] text-[var(--color-text-muted)] hover:text-white">
          Cancel
        </button>
        <button
          onClick={() => save.mutate()}
          disabled={save.isPending || !subjectId.trim() || !reason.trim() || !grantedBy.trim()}
          className="btn-primary flex items-center gap-1 rounded px-2.5 py-1 text-[10px] disabled:opacity-40"
        >
          {save.isPending && <Loader2 size={10} className="animate-spin" />} Grant
        </button>
      </div>
    </div>
  );
}

function RuleEditor({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [id, setId] = useState('');
  const [kind, setKind] = useState<keyof typeof KIND_LABELS>('cardinality');
  const [label, setLabel] = useState('');
  const [severity, setSeverity] = useState('warning');
  const [status, setStatus] = useState('draft');
  const [paramsText, setParamsText] = useState('{}');
  const [paramsError, setParamsError] = useState('');

  const save = useMutation({
    mutationFn: () => {
      let params: Record<string, unknown>;
      try {
        params = JSON.parse(paramsText || '{}');
      } catch {
        throw new Error('Params must be valid JSON.');
      }
      return ontologyApi.createRule({
        id: id.trim(), kind, label: label.trim() || id.trim(), params, severity, status,
      });
    },
    onSuccess: onSaved,
    onError: (e: any) => setParamsError(e?.response?.data?.detail || e?.message || 'Could not save.'),
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
      <div className="w-full max-w-lg rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-bg-base)] p-5">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-white">Add rule</h3>
          <button onClick={onClose} className="text-[var(--color-text-muted)] hover:text-white">
            <X size={15} />
          </button>
        </div>

        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-[var(--color-text-muted)]">Id</span>
              <input value={id} onChange={(e) => setId(e.target.value)} placeholder="e.g. cardinality.has_tier" className="minimal-input w-full rounded-lg px-2.5 py-1.5 text-xs" />
            </label>
            <label className="block">
              <span className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-[var(--color-text-muted)]">Kind</span>
              <select value={kind} onChange={(e) => setKind(e.target.value as keyof typeof KIND_LABELS)} className="minimal-input w-full rounded-lg px-2.5 py-1.5 text-xs">
                {Object.entries(KIND_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </label>
          </div>

          <p className="text-[10px] text-[var(--color-text-muted)]">{KIND_HINT[kind]}</p>

          <label className="block">
            <span className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-[var(--color-text-muted)]">Label</span>
            <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="A short name for this rule" className="minimal-input w-full rounded-lg px-2.5 py-1.5 text-xs" />
          </label>

          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-[var(--color-text-muted)]">Severity</span>
              <select value={severity} onChange={(e) => setSeverity(e.target.value)} className="minimal-input w-full rounded-lg px-2.5 py-1.5 text-xs">
                <option value="warning">warning</option>
                <option value="error">error</option>
              </select>
            </label>
            <label className="block">
              <span className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-[var(--color-text-muted)]">Status</span>
              <select value={status} onChange={(e) => setStatus(e.target.value)} className="minimal-input w-full rounded-lg px-2.5 py-1.5 text-xs">
                <option value="draft">draft — no effect yet</option>
                <option value="approved">approved</option>
              </select>
            </label>
          </div>

          <label className="block">
            <span className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-[var(--color-text-muted)]">Params (JSON)</span>
            <textarea
              value={paramsText}
              onChange={(e) => setParamsText(e.target.value)}
              rows={6}
              className="minimal-input w-full resize-none rounded-lg px-2.5 py-1.5 font-mono text-[11px] custom-scrollbar"
            />
          </label>
        </div>

        {(paramsError || save.isError) && (
          <p className="mt-3 rounded-lg border border-red-500/25 bg-red-500/10 px-3 py-2 text-[11px] text-red-300">
            {paramsError}
          </p>
        )}

        <div className="mt-4 flex justify-end gap-2">
          <button onClick={onClose} className="btn-secondary rounded-lg px-3 py-1.5 text-xs">Cancel</button>
          <button
            onClick={() => { setParamsError(''); save.mutate(); }}
            disabled={save.isPending || !id.trim()}
            className="btn-primary flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs disabled:opacity-40"
          >
            {save.isPending && <Loader2 size={12} className="animate-spin" />}
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
