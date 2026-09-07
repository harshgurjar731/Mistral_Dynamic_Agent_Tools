import { useState } from 'react';
import { ChevronDown, RotateCcw, ShieldAlert } from 'lucide-react';
import { cn } from '../../lib/utils';
import { Switch } from '../../components/ui/Switch';
import type { GuardrailCategoryThresholds, GuardrailConfig, GuardrailModerationConfig } from '../../api/agents';

type Version = 'v1' | 'v2';

/**
 * Category id -> label, per moderation model version. `dangerous_and_criminal_content`
 * is v1's combined category; v2 splits it into `dangerous` / `criminal` and adds
 * `jailbreaking`, which v1 has no equivalent for.
 */
const CATEGORIES: Record<Version, { id: keyof GuardrailCategoryThresholds; label: string }[]> = {
  v1: [
    { id: 'sexual', label: 'Sexual content' },
    { id: 'hate_and_discrimination', label: 'Hate & discrimination' },
    { id: 'violence_and_threats', label: 'Violence & threats' },
    { id: 'dangerous_and_criminal_content', label: 'Dangerous & criminal content' },
    { id: 'selfharm', label: 'Self-harm' },
    { id: 'health', label: 'Health advice' },
    { id: 'financial', label: 'Financial advice' },
    { id: 'law', label: 'Legal advice' },
    { id: 'pii', label: 'PII exposure' },
  ],
  v2: [
    { id: 'sexual', label: 'Sexual content' },
    { id: 'hate_and_discrimination', label: 'Hate & discrimination' },
    { id: 'violence_and_threats', label: 'Violence & threats' },
    { id: 'dangerous', label: 'Dangerous content' },
    { id: 'criminal', label: 'Criminal content' },
    { id: 'selfharm', label: 'Self-harm' },
    { id: 'health', label: 'Health advice' },
    { id: 'financial', label: 'Financial advice' },
    { id: 'law', label: 'Legal advice' },
    { id: 'pii', label: 'PII exposure' },
    { id: 'jailbreaking', label: 'Jailbreak attempts' },
  ],
};

const DEFAULT_MODEL_NAME = 'mistral-moderation-2603';

function emptyModeration(): GuardrailModerationConfig {
  return { action: 'block' };
}

/** Which of the two moderation slots on the config carries the active policy. */
function activeVersion(value: GuardrailConfig | null): Version {
  if (value?.moderation_llm_v1 && !value?.moderation_llm_v2) return 'v1';
  return 'v2';
}

export default function GuardrailEditor({
  value,
  onChange,
}: {
  value: GuardrailConfig | null;
  onChange: (value: GuardrailConfig | null) => void;
}) {
  const enabled = value != null;
  const version = activeVersion(value);
  const moderation: GuardrailModerationConfig =
    (version === 'v1' ? value?.moderation_llm_v1 : value?.moderation_llm_v2) ?? {};
  const thresholds = moderation.custom_category_thresholds ?? {};

  // Start expanded when the agent already has custom thresholds set — an
  // existing configuration should never load hidden behind a collapsed
  // disclosure, since that reads as "the categories aren't there".
  const [showThresholds, setShowThresholds] = useState(
    () => Object.values(thresholds).some((v) => v != null),
  );

  const patchModeration = (patch: Partial<GuardrailModerationConfig>) => {
    if (!value) return;
    onChange({
      ...value,
      moderation_llm_v1: version === 'v1' ? { ...moderation, ...patch } : null,
      moderation_llm_v2: version === 'v2' ? { ...moderation, ...patch } : null,
    });
  };

  const patchThreshold = (id: keyof GuardrailCategoryThresholds, raw: string) => {
    const next = { ...thresholds };
    if (raw === '') {
      delete next[id];
    } else {
      next[id] = parseFloat(raw);
    }
    patchModeration({ custom_category_thresholds: next });
  };

  const toggleEnabled = () => {
    if (enabled) {
      onChange(null);
    } else {
      onChange({ block_on_error: false, moderation_llm_v2: emptyModeration() });
    }
  };

  const switchVersion = (next: Version) => {
    if (next === version) return;
    onChange({
      block_on_error: value?.block_on_error ?? false,
      moderation_llm_v1: next === 'v1' ? emptyModeration() : null,
      moderation_llm_v2: next === 'v2' ? emptyModeration() : null,
    });
  };

  return (
    <div className="rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface,rgba(0,0,0,0.2))] p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="flex items-center gap-2 text-sm font-medium text-[var(--color-text-primary)]">
            <ShieldAlert size={14} className="text-amber-400" />
            Guardrails
          </h3>
          <p className="mt-1 text-[11px] leading-relaxed text-[var(--color-text-muted)]">
            Runs a moderation model over every message and response, and can block
            content that crosses a category threshold before it reaches the user.
          </p>
        </div>

        <Switch checked={enabled} onChange={toggleEnabled} className="mt-0.5" />
      </div>

      {enabled && (
        <div className="mt-4 space-y-4">
          {/* Moderation model version */}
          <div>
            <label className="mb-1.5 block text-[11px] font-medium text-[var(--color-text-secondary)]">
              Moderation model
            </label>
            <div className="inline-flex rounded-md border border-[var(--color-border-subtle)] p-0.5">
              {(['v2', 'v1'] as Version[]).map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => switchVersion(v)}
                  className={cn(
                    'rounded px-3 py-1 text-[11px] font-medium transition-colors',
                    version === v
                      ? 'bg-amber-400/15 text-amber-300'
                      : 'text-[var(--color-text-muted)] hover:text-white',
                  )}
                >
                  {v === 'v2' ? 'v2 (recommended)' : 'v1'}
                </button>
              ))}
            </div>
            <p className="mt-1 text-[10px] text-[var(--color-text-muted)]">
              {version === 'v2'
                ? 'Adds jailbreak detection and splits dangerous/criminal content into separate categories.'
                : 'Combines dangerous and criminal content into one category; no jailbreak detection.'}
            </p>
          </div>

          {/* Action on flagged content */}
          <div>
            <label className="mb-1.5 block text-[11px] font-medium text-[var(--color-text-secondary)]">
              When content is flagged
            </label>
            <select
              value={moderation.action ?? ''}
              onChange={(e) => patchModeration({ action: (e.target.value || null) as 'none' | 'block' | null })}
              className="w-full minimal-input rounded-md px-3 py-2 text-sm appearance-none cursor-pointer"
            >
              <option value="" className="bg-[var(--color-bg-surface)] text-white">Platform default</option>
              <option value="block" className="bg-[var(--color-bg-surface)] text-white">Block the response</option>
              <option value="none" className="bg-[var(--color-bg-surface)] text-white">Log only, don't block</option>
            </select>
          </div>

          {/* Block on error */}
          <div className="flex items-start justify-between gap-3 rounded-md border border-[var(--color-border-subtle)] bg-[rgba(245,158,11,0.05)] px-3 py-2.5">
            <span className="text-xs leading-relaxed">
              <span className="font-medium text-white">Block on moderation error</span>
              <span className="block text-[var(--color-text-muted)] mt-0.5">
                If the moderation check itself fails server-side, return HTTP 403
                instead of letting the request through unchecked.
              </span>
            </span>
            <Switch
              checked={value?.block_on_error ?? false}
              onChange={(block_on_error) => onChange(value ? { ...value, block_on_error } : value)}
              className="mt-0.5"
            />
          </div>

          {/* Ignore other categories */}
          <div className="flex items-start justify-between gap-3 rounded-md border border-[var(--color-border-subtle)] px-3 py-2.5">
            <span className="text-xs leading-relaxed">
              <span className="font-medium text-white">Only evaluate custom-threshold categories</span>
              <span className="block text-[var(--color-text-muted)] mt-0.5">
                Skip every category below that is left at its default — only the
                ones you set a threshold for are checked.
              </span>
            </span>
            <Switch
              checked={moderation.ignore_other_categories ?? false}
              onChange={(ignore_other_categories) => patchModeration({ ignore_other_categories })}
              className="mt-0.5"
            />
          </div>

          {/* Model override */}
          <div>
            <label className="mb-1.5 block text-[11px] font-medium text-[var(--color-text-secondary)]">
              Moderation model override
            </label>
            <input
              value={moderation.model_name ?? ''}
              onChange={(e) => patchModeration({ model_name: e.target.value || null })}
              placeholder={`${DEFAULT_MODEL_NAME} (default — leave blank)`}
              className="w-full minimal-input rounded-md px-3 py-2 text-sm font-[family-name:var(--font-mono)]"
            />
          </div>

          {/* Category thresholds */}
          <div className="pt-3 border-t border-[var(--color-border-subtle)]">
            <button
              type="button"
              onClick={() => setShowThresholds((v) => !v)}
              className="flex w-full items-center justify-between text-[11px] font-medium text-[var(--color-text-secondary)]"
            >
              <span>Custom category thresholds (optional)</span>
              <ChevronDown size={12} className={cn('transition-transform', showThresholds && 'rotate-180')} />
            </button>

            {showThresholds && (
              <div className="mt-3 space-y-2">
                <p className="text-[10px] text-[var(--color-text-muted)]">
                  0 = block almost everything in this category, 1 = never block on it. Leave blank to use the model's default sensitivity.
                </p>
                <div className="space-y-1.5">
                  {CATEGORIES[version].map(({ id, label }) => (
                    <div key={id} className="flex items-center justify-between gap-3">
                      <span className="text-[11px] text-[var(--color-text-secondary)] leading-tight">
                        {label}
                      </span>
                      <div className="flex items-center gap-1 shrink-0">
                        <input
                          type="number"
                          min={0}
                          max={1}
                          step={0.05}
                          value={thresholds[id] ?? ''}
                          onChange={(e) => patchThreshold(id, e.target.value)}
                          placeholder="default"
                          className="w-16 minimal-input rounded-md px-2 py-1 text-xs font-[family-name:var(--font-mono)] text-right"
                        />
                        {thresholds[id] != null && (
                          <button
                            type="button"
                            onClick={() => patchThreshold(id, '')}
                            title="Reset to default"
                            className="text-[var(--color-text-muted)] hover:text-white transition-colors"
                          >
                            <RotateCcw size={11} />
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
