/**
 * The controls that say where a rule belongs and whom it applies to:
 * a category picker (with "new category" in place) and an "Apply to" picker
 * that can point the rule at specific agents or workflows.
 */
import { useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Check, Loader2, Plus, Search, X } from "lucide-react";
import { toast } from "sonner";
import { errorMessage, QK, rulesApi } from "@/api";
import { cn } from "@/lib/utils";
import type { RuleApplies, RuleCategory, RuleScope } from "@/types";
import { CategoryEditorDialog } from "./CategoryEditorDialog";
import { RuleIcon } from "./RulePills";
import {
  CATEGORY_COLORS,
  CATEGORY_ICON_CHOICES,
  toneFor,
  useRuleCategories,
  useTargetOptions,
} from "./ruleScoping";

/* ── Category ──────────────────────────────────────────────────────────── */

export function CategoryBadge({
  category,
  fallbackId,
  className,
}: {
  category: RuleCategory | undefined;
  fallbackId?: string;
  className?: string;
}) {
  const tone = toneFor(category?.color);
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-medium",
        tone.chip,
        className,
      )}
    >
      <RuleIcon name={category?.icon ?? "Tag"} className="size-2.5" />
      {category?.name ?? fallbackId ?? "Uncategorised"}
    </span>
  );
}

export function CategoryPicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (id: string) => void;
}) {
  const { categories } = useRuleCategories();
  const [adding, setAdding] = useState(false);

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5">
        {categories.map((c) => {
          const on = c.id === value;
          return (
            <button
              key={c.id}
              type="button"
              onClick={() => onChange(c.id)}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs transition",
                on
                  ? toneFor(c.color).chip
                  : "border-border text-muted-foreground hover:border-border-strong hover:text-foreground",
              )}
            >
              <RuleIcon name={c.icon} className="size-3" />
              {c.name}
              {on ? <Check className="size-3" /> : null}
            </button>
          );
        })}
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="inline-flex items-center gap-1 rounded-md border border-dashed border-border px-2.5 py-1 text-xs text-muted-foreground transition hover:border-primary/40 hover:text-primary"
        >
          <Plus className="size-3" /> New category
        </button>
      </div>
      <CategoryEditorDialog
        open={adding}
        onOpenChange={setAdding}
        onSaved={(c) => onChange(c.id)}
      />
    </div>
  );
}

/* ── Apply to ──────────────────────────────────────────────────────────── */

export function TargetPicker({
  scope,
  value,
  onChange,
}: {
  scope: RuleScope;
  value: string[];
  onChange: (ids: string[]) => void;
}) {
  const { options, isLoading } = useTargetOptions(scope);
  const [q, setQ] = useState("");
  const noun = scope === "agent" ? "agents" : "workflows";
  const selected = new Set(value);
  const byId = Object.fromEntries(options.map((o) => [o.id, o]));

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return options.filter(
      (o) => !needle || `${o.name} ${o.id} ${o.hint ?? ""}`.toLowerCase().includes(needle),
    );
  }, [options, q]);

  const toggle = (id: string) =>
    onChange(selected.has(id) ? value.filter((v) => v !== id) : [...value, id]);

  return (
    <div className="rounded-lg border border-border bg-background/60">
      {value.length ? (
        <div className="flex flex-wrap gap-1.5 border-b border-border px-2.5 py-2">
          {value.map((id) => (
            <span
              key={id}
              className="inline-flex items-center gap-1 rounded-md border border-blue/30 bg-blue/10 px-1.5 py-0.5 text-[11px] text-blue"
            >
              {byId[id]?.name ?? id}
              {byId[id] ? null : <span className="text-[9px] opacity-70">(not found)</span>}
              <button type="button" aria-label="Remove" onClick={() => toggle(id)}>
                <X className="size-3" />
              </button>
            </span>
          ))}
        </div>
      ) : null}
      <div className="relative border-b border-border">
        <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={`Search ${noun}…`}
          className="h-8 w-full bg-transparent pr-3 pl-8 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none"
        />
      </div>
      <div className="custom-scrollbar max-h-44 overflow-y-auto p-1">
        {isLoading ? (
          <p className="flex items-center gap-2 px-2 py-3 text-xs text-muted-foreground">
            <Loader2 className="size-3 animate-spin" /> Loading {noun}…
          </p>
        ) : shown.length === 0 ? (
          <p className="px-2 py-3 text-xs text-muted-foreground">
            {options.length ? `No ${noun} match “${q}”.` : `No ${noun} yet.`}
          </p>
        ) : (
          shown.map((o) => {
            const on = selected.has(o.id);
            return (
              <button
                key={o.id}
                type="button"
                onClick={() => toggle(o.id)}
                className={cn(
                  "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition",
                  on
                    ? "bg-blue/10 text-foreground"
                    : "text-muted-foreground hover:bg-surface-hover hover:text-foreground",
                )}
              >
                <span
                  className={cn(
                    "grid size-3.5 shrink-0 place-items-center rounded border",
                    on ? "border-blue bg-blue text-background" : "border-border",
                  )}
                >
                  {on ? <Check className="size-2.5" /> : null}
                </span>
                <span className="min-w-0 flex-1 truncate">{o.name}</span>
                {o.hint ? (
                  <span className="shrink-0 text-[10px] text-muted-foreground/70">{o.hint}</span>
                ) : null}
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}

export function AppliesPicker({
  scope,
  applies,
  targets,
  onChange,
  onlyAlways = false,
}: {
  scope: RuleScope;
  applies: RuleApplies;
  targets: string[];
  onChange: (next: { applies: RuleApplies; targets: string[] }) => void;
  /** The rule only works when always on (e.g. reviewed tools only). */
  onlyAlways?: boolean;
}) {
  const noun = scope === "agent" ? "agent" : "workflow";
  const OPTIONS: Array<{ value: RuleApplies; label: string; hint: string }> = [
    { value: "always", label: `All ${noun}s`, hint: `Every ${noun}, including existing ones.` },
    {
      value: "targeted",
      label: `Specific ${noun}s`,
      hint: `Only the ${noun}s you choose below. The orchestrator will not add it anywhere else.`,
    },
    {
      value: "ai",
      label: "Where relevant",
      hint: `The orchestrator adds it to ${noun}s it fits; you can also add it by hand.`,
    },
  ];
  const current = OPTIONS.find((o) => o.value === applies) ?? OPTIONS[2]!;

  return (
    <div className="space-y-2.5">
      <div className="inline-flex flex-wrap rounded-lg border border-border bg-background/60 p-0.5">
        {OPTIONS.map((o) => (
          <button
            key={o.value}
            type="button"
            onClick={() => onChange({ applies: o.value, targets })}
            className={cn(
              "rounded-md px-3 py-1.5 text-xs font-medium transition",
              applies === o.value
                ? "bg-surface text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {o.label}
          </button>
        ))}
      </div>
      <p className="text-[11px] text-muted-foreground">{current.hint}</p>
      {applies === "targeted" ? (
        <>
          <TargetPicker
            scope={scope}
            value={targets}
            onChange={(ids) => onChange({ applies, targets: ids })}
          />
          {targets.length === 0 ? (
            <p className="text-[11px] text-amber">Choose at least one {noun}.</p>
          ) : null}
        </>
      ) : null}
      {onlyAlways && applies !== "always" ? (
        <p className="text-[11px] text-amber">
          This rule only takes effect when applied to all agents — tools are generated before any
          agent exists to target.
        </p>
      ) : null}
    </div>
  );
}
