/**
 * GuardrailCard — the platform's moderation configuration for one agent.
 *
 * Not instruction text. Mistral scores every turn against these categories and
 * blocks above the threshold, outside the model, so it holds regardless of what
 * the agent was told or how a user talks around it. The card says so, because
 * "guardrails" reading as prose advice is exactly the confusion this replaced.
 *
 * Thresholds are shown strictest-first with a bar, since the number alone
 * ("pii: 0.2") does not convey that lower means stricter.
 */
import { Shield, ShieldOff } from 'lucide-react';
import { cn } from '../../lib/utils';

export interface GuardrailView {
  enabled?: boolean;
  version?: string;
  action?: string;
  block_on_error?: boolean;
  ignore_other_categories?: boolean;
  max_tool_rounds?: number;
  thresholds?: Array<{ category: string; threshold: number }>;
  rationale?: string;
}

/**
 * Lower threshold = stricter; a score above the threshold is a violation.
 *
 * 1.0 is special — Mistral treats it as "category disabled". That is how an
 * agent is exempted from the topic category that is its own subject: a clinical
 * agent scores ~1.0 on `health` every turn, so anything less blocks it.
 */
function bandFor(t: number): { bar: string; text: string; word: string } {
  if (t >= 1) return { bar: 'bg-[var(--color-border-subtle)]', text: 'text-[var(--color-text-muted)]', word: 'disabled' };
  if (t <= 0.3) return { bar: 'bg-red-400', text: 'text-red-300', word: 'strict' };
  if (t <= 0.6) return { bar: 'bg-amber-400', text: 'text-amber-300', word: 'moderate' };
  return { bar: 'bg-emerald-400', text: 'text-emerald-300', word: 'permissive' };
}

export default function GuardrailCard({
  data,
  compact = false,
}: {
  data: GuardrailView;
  compact?: boolean;
}) {
  const thresholds = data.thresholds ?? [];

  if (!data.enabled) {
    return (
      <div className="surface-card rounded-xl p-4 mt-3 border border-[var(--color-border-subtle)] flex items-start gap-2.5">
        <ShieldOff size={13} className="text-[var(--color-text-muted)] shrink-0 mt-0.5" />
        <div>
          <p className="text-xs font-semibold text-[var(--color-text-primary)]">
            No moderation guardrail
          </p>
          <p className="text-[11px] text-[var(--color-text-muted)] mt-0.5 leading-relaxed">
            {data.rationale ||
              'This agent holds no tools, integrations or documents and its subject matter carries no moderation risk.'}
          </p>
          {data.max_tool_rounds !== undefined && (
            <p className="text-[10px] text-[var(--color-text-muted)] mt-1.5">
              Tool-call budget: <strong className="text-[var(--color-text-primary)]">{data.max_tool_rounds}</strong> rounds
            </p>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className={cn(
      'surface-card rounded-xl border border-[rgba(16,185,129,0.22)] bg-[rgba(16,185,129,0.04)]',
      compact ? 'p-3 mt-2' : 'p-5 mt-3',
    )}>
      <div className="flex items-center gap-2 mb-1">
        <Shield size={compact ? 11 : 13} className="text-emerald-400" />
        <span className={cn('font-semibold text-white', compact ? 'text-[11px]' : 'text-xs')}>
          Moderation guardrail
        </span>
        <span className="text-[9px] uppercase tracking-wider text-emerald-400/80 font-mono">
          {data.version ?? 'v2'}
        </span>
        <span className={cn(
          'ml-auto text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded border',
          data.action === 'block'
            ? 'text-red-300 border-red-400/25 bg-red-400/10'
            : 'text-[var(--color-text-muted)] border-[var(--color-border-subtle)]',
        )}>
          {data.action === 'block' ? 'blocks the turn' : 'scores only'}
        </span>
      </div>

      <p className="text-[10px] text-[var(--color-text-muted)] leading-relaxed mb-3">
        Enforced by Mistral outside the model — not written into the agent's instructions.
      </p>

      {thresholds.length > 0 && (
        <div className="space-y-1.5 mb-3">
          {thresholds.map(t => {
            const band = bandFor(t.threshold);
            return (
              <div key={t.category} className="flex items-center gap-2">
                <span className="text-[11px] font-mono text-[var(--color-text-primary)] w-44 shrink-0 truncate">
                  {t.category}
                </span>
                <div className="flex-1 h-1 rounded-full bg-[var(--color-bg-hover)] overflow-hidden min-w-[40px]">
                  <div
                    className={cn('h-full rounded-full', band.bar)}
                    style={{ width: `${Math.max(4, (1 - t.threshold) * 100)}%` }}
                  />
                </div>
                <span className={cn('text-[10px] font-mono tabular-nums w-8 text-right', band.text)}>
                  {t.threshold.toFixed(2)}
                </span>
                <span className="text-[9px] uppercase tracking-wider text-[var(--color-text-muted)] w-16">
                  {band.word}
                </span>
              </div>
            );
          })}
          <p className="text-[9px] text-[var(--color-text-muted)] pt-0.5">
            Lower is stricter; 1.00 disables a category. Anything not listed keeps
            the model's own default rather than being skipped.
          </p>
        </div>
      )}

      <div className="flex flex-wrap gap-x-4 gap-y-1 text-[10px] text-[var(--color-text-muted)] pt-2 border-t border-[var(--color-border-subtle)]">
        <span>Tool rounds: <strong className="text-[var(--color-text-primary)]">{data.max_tool_rounds ?? 5}</strong></span>
        <span>On moderation error: <strong className="text-[var(--color-text-primary)]">{data.block_on_error ? 'block' : 'allow'}</strong></span>
        {data.ignore_other_categories && <span>Other categories ignored</span>}
      </div>

      {data.rationale && (
        <p className="text-[11px] text-[var(--color-text-muted)] mt-2 italic leading-relaxed">
          {data.rationale}
        </p>
      )}
    </div>
  );
}
