/**
 * BuilderPanels — the non-canvas views of the same definition.
 *
 * JSON is editable and writes back to the store; the script is generated and
 * read-only. That asymmetry is the whole architecture in miniature: the DAG is
 * the source of truth, the Python is a build artifact. Making the script
 * editable would mean maintaining a Python parser and would let the two
 * representations disagree.
 */

import { useMemo, useState } from 'react';
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  Copy,
  Download,
  FileCode2,
  Info,
  Loader2,
  RefreshCw,
  XCircle,
} from 'lucide-react';
import type { ValidationIssue, WorkflowDefinition } from '../../../api/workflowBuilder';
import { useBuilderStore } from './useBuilderStore';
import { cn } from '../../../lib/utils';

/* ── JSON panel ─────────────────────────────────────────────────────────── */

export function JsonPanel() {
  const definition = useBuilderStore((s) => s.definition);
  const replaceDefinition = useBuilderStore((s) => s.replaceDefinition);

  const serialised = useMemo(() => JSON.stringify(definition, null, 2), [definition]);

  // `null` means "mirror the store". Deriving the displayed text this way means
  // canvas edits show up immediately without an effect syncing two copies, while
  // unapplied keystrokes are never clobbered.
  const [draft, setDraft] = useState<string | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);

  const text = draft ?? serialised;
  const dirty = draft !== null;

  const apply = () => {
    try {
      const parsed = JSON.parse(text) as WorkflowDefinition;
      if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.steps)) {
        setParseError('Definition must be an object with a "steps" array.');
        return;
      }
      replaceDefinition(parsed);
      setParseError(null);
      setDraft(null);
    } catch (err) {
      setParseError(err instanceof Error ? err.message : 'Invalid JSON.');
    }
  };

  const revert = () => {
    setDraft(null);
    setParseError(null);
  };

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-[rgba(8,11,19,0.95)]">
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-[var(--color-border-subtle)] shrink-0">
        <Info size={12} className="text-[var(--color-text-muted)] shrink-0" />
        <p className="text-[11px] text-[var(--color-text-muted)] flex-1 min-w-0">
          Edit the definition directly. Applying updates the canvas.
        </p>
        {dirty && (
          <>
            <button
              type="button"
              onClick={revert}
              className="btn-secondary px-3 py-1 text-[11px] rounded-md"
            >
              Revert
            </button>
            <button
              type="button"
              onClick={apply}
              className="btn-primary px-3 py-1 text-[11px] rounded-md"
            >
              Apply to canvas
            </button>
          </>
        )}
      </div>

      {parseError && (
        <div className="flex items-start gap-2 px-4 py-2.5 bg-red-500/8 border-b border-red-500/25 shrink-0">
          <XCircle size={13} className="text-red-400 shrink-0 mt-px" />
          <p className="text-[11px] text-red-300 leading-relaxed break-words">{parseError}</p>
        </div>
      )}

      <textarea
        value={text}
        onChange={(e) => {
          setDraft(e.target.value);
          setParseError(null);
        }}
        spellCheck={false}
        aria-label="Workflow definition JSON"
        className="flex-1 w-full bg-transparent px-4 py-3 text-[11.5px] font-mono leading-relaxed text-[var(--color-text-secondary)] outline-none resize-none custom-scrollbar min-h-0"
      />
    </div>
  );
}

/* ── Script panel ───────────────────────────────────────────────────────── */

interface ScriptPanelProps {
  code: string | null;
  isLoading: boolean;
  error: string | null;
  stale: boolean;
  isPublished: boolean;
  onRefresh: () => void;
}

export function ScriptPanel({
  code,
  isLoading,
  error,
  stale,
  isPublished,
  onRefresh,
}: ScriptPanelProps) {
  const definition = useBuilderStore((s) => s.definition);
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    if (!code) return;
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard can be blocked by permissions; the download path still works.
    }
  };

  const download = () => {
    if (!code) return;
    const blob = new Blob([code], { type: 'text/x-python' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `workflow_${definition.name || 'untitled'}.py`;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-[rgba(8,11,19,0.95)]">
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-[var(--color-border-subtle)] shrink-0">
        <FileCode2 size={12} className="text-[var(--color-text-muted)] shrink-0" />
        <p className="text-[11px] text-[var(--color-text-muted)] flex-1 min-w-0 truncate">
          Generated from the DAG · read-only
        </p>

        {isPublished &&
          (stale ? (
            <span className="flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-full bg-amber-400/10 border border-amber-400/25 text-amber-400 shrink-0">
              <AlertTriangle size={10} /> differs from deployed
            </span>
          ) : (
            <span className="flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-full bg-emerald-400/10 border border-emerald-400/25 text-emerald-400 shrink-0">
              <CheckCircle2 size={10} /> matches deployed
            </span>
          ))}

        <button
          type="button"
          onClick={onRefresh}
          title="Recompile"
          aria-label="Recompile"
          className="w-6 h-6 rounded-md flex items-center justify-center text-[var(--color-text-muted)] hover:text-white hover:bg-[var(--color-bg-hover)] transition-colors shrink-0"
        >
          <RefreshCw size={12} className={cn(isLoading && 'animate-spin')} />
        </button>
        <button
          type="button"
          onClick={copy}
          disabled={!code}
          title="Copy to clipboard"
          aria-label="Copy to clipboard"
          className="w-6 h-6 rounded-md flex items-center justify-center text-[var(--color-text-muted)] hover:text-white hover:bg-[var(--color-bg-hover)] transition-colors disabled:opacity-40 shrink-0"
        >
          {copied ? <Check size={12} className="text-emerald-400" /> : <Copy size={12} />}
        </button>
        <button
          type="button"
          onClick={download}
          disabled={!code}
          title="Download .py"
          aria-label="Download Python file"
          className="w-6 h-6 rounded-md flex items-center justify-center text-[var(--color-text-muted)] hover:text-white hover:bg-[var(--color-bg-hover)] transition-colors disabled:opacity-40 shrink-0"
        >
          <Download size={12} />
        </button>
      </div>

      <div className="flex-1 overflow-auto custom-scrollbar min-h-0">
        {isLoading && !code && (
          <div className="h-full flex items-center justify-center gap-2 text-[var(--color-text-muted)]">
            <Loader2 size={14} className="animate-spin" />
            <span className="text-xs">Compiling…</span>
          </div>
        )}

        {error && !isLoading && (
          <div className="p-6 max-w-lg mx-auto text-center">
            <XCircle size={22} className="text-red-400 mx-auto mb-3" />
            <p className="text-sm font-semibold text-white mb-1.5">Cannot compile yet</p>
            <p className="text-[11px] text-[var(--color-text-muted)] leading-relaxed break-words">
              {error}
            </p>
          </div>
        )}

        {code && !error && (
          <pre className="px-4 py-3 text-[11.5px] font-mono leading-relaxed text-[var(--color-text-secondary)] whitespace-pre">
            {code}
          </pre>
        )}
      </div>
    </div>
  );
}

/* ── Validation strip ───────────────────────────────────────────────────── */

export function ValidationBar({
  issues,
  onSelectStep,
}: {
  issues: ValidationIssue[];
  onSelectStep: (stepId: string) => void;
}) {
  const [open, setOpen] = useState(false);

  const errors = issues.filter((i) => i.severity === 'error');
  const warnings = issues.filter((i) => i.severity === 'warning');

  if (issues.length === 0) return null;

  return (
    <div className="shrink-0 border-t border-[var(--color-border-subtle)] bg-[rgba(11,15,22,0.9)] backdrop-blur-md">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="w-full flex items-center gap-3 px-4 py-2 hover:bg-[var(--color-bg-hover)] transition-colors"
      >
        {errors.length > 0 && (
          <span className="flex items-center gap-1.5 text-[11px] font-semibold text-red-400">
            <XCircle size={12} />
            {errors.length} error{errors.length > 1 ? 's' : ''}
          </span>
        )}
        {warnings.length > 0 && (
          <span className="flex items-center gap-1.5 text-[11px] font-semibold text-amber-400">
            <AlertTriangle size={12} />
            {warnings.length} warning{warnings.length > 1 ? 's' : ''}
          </span>
        )}
        <span className="ml-auto text-[10px] text-[var(--color-text-muted)]">
          {open ? 'Hide' : 'Show'} details
        </span>
      </button>

      {open && (
        <div className="max-h-44 overflow-y-auto custom-scrollbar border-t border-[var(--color-border-subtle)]">
          {[...errors, ...warnings].map((issue, index) => (
            <button
              key={`${issue.code}-${issue.step_id}-${index}`}
              type="button"
              onClick={() => issue.step_id && onSelectStep(issue.step_id)}
              disabled={!issue.step_id}
              className={cn(
                'w-full flex items-start gap-2 px-4 py-2 text-left border-b border-[var(--color-border-subtle)] last:border-b-0 transition-colors',
                issue.step_id ? 'hover:bg-[var(--color-bg-hover)]' : 'cursor-default',
              )}
            >
              {issue.severity === 'error' ? (
                <XCircle size={11} className="text-red-400 shrink-0 mt-0.5" />
              ) : (
                <AlertTriangle size={11} className="text-amber-400 shrink-0 mt-0.5" />
              )}
              <div className="min-w-0 flex-1">
                <p className="text-[11px] text-[var(--color-text-secondary)] leading-relaxed">
                  {issue.message}
                </p>
                <p className="text-[9.5px] text-[var(--color-text-muted)] font-mono mt-0.5">
                  {issue.code}
                  {issue.step_id && ` · ${issue.step_id}`}
                </p>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
