import { useState } from "react";
import { ChevronDown, RotateCcw, ShieldAlert } from "lucide-react";
import { cn } from "@/lib/utils";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import type {
  GuardrailCategoryThresholds,
  GuardrailConfig,
  GuardrailModerationConfig,
} from "@/types";

type Version = "v1" | "v2";

const CATEGORIES: Record<Version, { id: keyof GuardrailCategoryThresholds; label: string }[]> = {
  v1: [
    { id: "sexual", label: "Sexual content" },
    { id: "hate_and_discrimination", label: "Hate & discrimination" },
    { id: "violence_and_threats", label: "Violence & threats" },
    { id: "dangerous_and_criminal_content", label: "Dangerous & criminal content" },
    { id: "selfharm", label: "Self-harm" },
    { id: "health", label: "Health advice" },
    { id: "financial", label: "Financial advice" },
    { id: "law", label: "Legal advice" },
    { id: "pii", label: "PII exposure" },
  ],
  v2: [
    { id: "sexual", label: "Sexual content" },
    { id: "hate_and_discrimination", label: "Hate & discrimination" },
    { id: "violence_and_threats", label: "Violence & threats" },
    { id: "dangerous", label: "Dangerous content" },
    { id: "criminal", label: "Criminal content" },
    { id: "selfharm", label: "Self-harm" },
    { id: "health", label: "Health advice" },
    { id: "financial", label: "Financial advice" },
    { id: "law", label: "Legal advice" },
    { id: "pii", label: "PII exposure" },
    { id: "jailbreaking", label: "Jailbreak attempts" },
  ],
};

const DEFAULT_MODEL_NAME = "mistral-moderation-2603";

function emptyModeration(): GuardrailModerationConfig {
  return { action: "block" };
}

function activeVersion(value: GuardrailConfig | null): Version {
  if (value?.moderation_llm_v1 && !value?.moderation_llm_v2) return "v1";
  return "v2";
}

export function GuardrailEditor({
  value,
  onChange,
}: {
  value: GuardrailConfig | null;
  onChange: (value: GuardrailConfig | null) => void;
}) {
  const enabled = value != null;
  const version = activeVersion(value);
  const moderation: GuardrailModerationConfig =
    (version === "v1" ? value?.moderation_llm_v1 : value?.moderation_llm_v2) ?? {};
  const thresholds = moderation.custom_category_thresholds ?? {};

  const [showThresholds, setShowThresholds] = useState(
    () => Object.values(thresholds).some((v) => v != null),
  );

  const patchModeration = (patch: Partial<GuardrailModerationConfig>) => {
    if (!value) return;
    onChange({
      ...value,
      moderation_llm_v1: version === "v1" ? { ...moderation, ...patch } : null,
      moderation_llm_v2: version === "v2" ? { ...moderation, ...patch } : null,
    });
  };

  const patchThreshold = (id: keyof GuardrailCategoryThresholds, raw: string) => {
    const next = { ...thresholds };
    if (raw === "") {
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
      moderation_llm_v1: next === "v1" ? emptyModeration() : null,
      moderation_llm_v2: next === "v2" ? emptyModeration() : null,
    });
  };

  return (
    <div className="rounded-xl border border-border bg-background-elevated/70 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <ShieldAlert className="size-4 text-amber" />
            Guardrails & Moderation
          </h3>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            Runs a Mistral moderation model over every input and completion to enforce safety
            boundaries and content policies.
          </p>
        </div>

        <Switch checked={enabled} onCheckedChange={toggleEnabled} />
      </div>

      {enabled && (
        <div className="mt-4 space-y-4 border-t border-border pt-4">
          {/* Moderation model version */}
          <div>
            <label className="eyebrow mb-1.5 block">Moderation model version</label>
            <div className="inline-flex rounded-md border border-border bg-background-elevated p-0.5">
              {(["v2", "v1"] as Version[]).map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => switchVersion(v)}
                  className={cn(
                    "rounded px-3 py-1 text-xs font-medium transition-colors",
                    version === v
                      ? "bg-amber/20 text-amber font-semibold"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {v === "v2" ? "v2 (recommended)" : "v1"}
                </button>
              ))}
            </div>
            <p className="mt-1 text-[11px] text-muted-foreground">
              {version === "v2"
                ? "Adds jailbreak detection and separate categories for dangerous and criminal content."
                : "Combines dangerous and criminal content; lacks jailbreak detection."}
            </p>
          </div>

          {/* Action on flagged content */}
          <div>
            <label className="eyebrow mb-1.5 block">When content is flagged</label>
            <select
              value={moderation.action ?? ""}
              onChange={(e) =>
                patchModeration({
                  action: (e.target.value || null) as "none" | "block" | null,
                })
              }
              className="h-9 w-full rounded-md border border-input bg-background-elevated px-2.5 text-xs text-foreground focus:outline-none"
            >
              <option value="">Platform default</option>
              <option value="block">Block response (HTTP 403)</option>
              <option value="none">Log only, do not block</option>
            </select>
          </div>

          {/* Block on error */}
          <div className="flex items-start justify-between gap-3 rounded-lg border border-border bg-background-elevated/50 p-3">
            <span className="text-xs leading-relaxed">
              <span className="font-medium text-foreground">Block on moderation error</span>
              <span className="block text-[11px] text-muted-foreground mt-0.5">
                If the moderation service check fails or times out, reject the request instead of
                allowing it through uninspected.
              </span>
            </span>
            <Switch
              checked={value?.block_on_error ?? false}
              onCheckedChange={(checked) =>
                onChange(value ? { ...value, block_on_error: checked } : value)
              }
            />
          </div>

          {/* Ignore other categories */}
          <div className="flex items-start justify-between gap-3 rounded-lg border border-border bg-background-elevated/50 p-3">
            <span className="text-xs leading-relaxed">
              <span className="font-medium text-foreground">
                Only evaluate custom-threshold categories
              </span>
              <span className="block text-[11px] text-muted-foreground mt-0.5">
                Skip default categories; only test the categories configured with custom numeric
                thresholds below.
              </span>
            </span>
            <Switch
              checked={moderation.ignore_other_categories ?? false}
              onCheckedChange={(checked) =>
                patchModeration({ ignore_other_categories: checked })
              }
            />
          </div>

          {/* Custom Category Thresholds */}
          <div className="border-t border-border pt-3">
            <button
              type="button"
              onClick={() => setShowThresholds((v) => !v)}
              className="flex w-full items-center justify-between text-xs font-medium text-foreground"
            >
              <span>Custom Category Sensitivity Thresholds</span>
              <ChevronDown
                className={cn(
                  "size-3.5 text-muted-foreground transition-transform",
                  showThresholds && "rotate-180",
                )}
              />
            </button>

            {showThresholds && (
              <div className="mt-3 space-y-2">
                <p className="text-[11px] text-muted-foreground">
                  Range: 0.0 (block everything) to 1.0 (never block). Leave blank to use model default sensitivity.
                </p>
                <div className="space-y-1.5">
                  {CATEGORIES[version].map(({ id, label }) => (
                    <div key={id} className="flex items-center justify-between gap-3 text-xs">
                      <span className="text-muted-foreground">{label}</span>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <Input
                          type="number"
                          min={0}
                          max={1}
                          step={0.05}
                          value={thresholds[id] ?? ""}
                          onChange={(e) => patchThreshold(id, e.target.value)}
                          placeholder="default"
                          className="h-7 w-20 text-right font-mono text-xs"
                        />
                        {thresholds[id] != null && (
                          <button
                            type="button"
                            onClick={() => patchThreshold(id, "")}
                            title="Reset to default"
                            className="p-1 text-muted-foreground hover:text-foreground"
                          >
                            <RotateCcw className="size-3" />
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
export default GuardrailEditor;
