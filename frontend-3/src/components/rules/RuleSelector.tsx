import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ChevronDown, Loader2, Lock, Plus, Sparkles, X } from "lucide-react";
import { toast } from "sonner";
import { errorMessage, QK, rulesApi } from "@/api";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import type { RuleRef, RuleScope, RuleSuggestion } from "@/types";
import { RuleIcon, SourcePill } from "./RulePills";

/**
 * Pick the optional rules for one agent or workflow.
 *
 * Always-on rules are shown locked — they apply regardless and are switched
 * off on the Rules page, not per subject. Optional rules can be added by hand
 * or suggested by the AI, and each shows who added it and why.
 */
export function RuleSelector({
  scope,
  value,
  onChange,
  onSuggest,
  suggestHint,
}: {
  scope: RuleScope;
  value: RuleRef[];
  onChange: (next: RuleRef[]) => void;
  /** Returns the AI's picks. Omit to hide the "Suggest with AI" button. */
  onSuggest?: (() => Promise<RuleSuggestion[]>) | undefined;
  /** Shown instead of suggesting when there is not enough to go on yet. */
  suggestHint?: string | undefined;
}) {
  const [addOpen, setAddOpen] = useState(false);
  const [showAlways, setShowAlways] = useState(false);
  const [suggesting, setSuggesting] = useState(false);

  const rulesQuery = useQuery({ queryKey: QK.rules(scope), queryFn: () => rulesApi.list(scope) });
  const rules = (rulesQuery.data?.rules ?? []).filter((r) => r.enabled);
  const alwaysOn = rules.filter((r) => r.always_on);
  const selectable = rules.filter((r) => !r.always_on);
  const byId = Object.fromEntries(rules.map((r) => [r.id, r]));

  const selected = value.filter((v) => byId[v.rule_id] && !byId[v.rule_id]!.always_on);
  const selectedIds = new Set(selected.map((s) => s.rule_id));
  const addable = selectable.filter((r) => !selectedIds.has(r.id));

  const suggest = async () => {
    if (!onSuggest) return;
    setSuggesting(true);
    try {
      const picks = await onSuggest();
      const fresh = picks.filter((p) => !selectedIds.has(p.rule_id));
      if (!fresh.length) {
        toast.info(
          picks.length
            ? "The AI agrees with your current rules."
            : "The AI found no extra rules worth adding.",
        );
      } else {
        onChange([
          ...selected,
          ...fresh.map((p) => ({
            rule_id: p.rule_id,
            source: "ai" as const,
            reason: p.reason ?? "",
          })),
        ]);
        toast.success(`Added ${fresh.length} suggested rule${fresh.length === 1 ? "" : "s"}`);
      }
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setSuggesting(false);
    }
  };

  if (rulesQuery.isLoading) {
    return (
      <div className="flex items-center gap-2 py-3 text-xs text-muted-foreground">
        <Loader2 className="size-3.5 animate-spin" /> Loading rules…
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Always on — locked */}
      {alwaysOn.length ? (
        <div className="rounded-lg border border-border bg-background/40">
          <button
            type="button"
            onClick={() => setShowAlways((v) => !v)}
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs"
          >
            <Lock className="size-3 text-slate" />
            <span className="font-medium text-foreground">
              {alwaysOn.length} always-on rule{alwaysOn.length === 1 ? "" : "s"}
            </span>
            <span className="text-muted-foreground">apply automatically</span>
            <ChevronDown
              className={cn(
                "ml-auto size-3.5 text-muted-foreground transition-transform",
                showAlways && "rotate-180",
              )}
            />
          </button>
          {showAlways ? (
            <ul className="space-y-1.5 border-t border-border px-3 py-2.5">
              {alwaysOn.map((r) => (
                <li key={r.id} className="flex items-start gap-2 text-xs">
                  <RuleIcon
                    name={r.icon}
                    className="mt-0.5 size-3 shrink-0 text-muted-foreground"
                  />
                  <span className="min-w-0">
                    <span className="font-medium text-foreground">{r.name}</span>
                    <span className="block text-[11px] text-muted-foreground">{r.summary}</span>
                  </span>
                </li>
              ))}
              <li className="pt-1 text-[10px] text-muted-foreground">
                Switch these off on the{" "}
                <Link to="/rules" className="text-primary hover:underline">
                  Rules page
                </Link>
                .
              </li>
            </ul>
          ) : null}
        </div>
      ) : null}

      {/* Selected optional rules */}
      {selected.length ? (
        <ul className="space-y-2">
          {selected.map((s) => {
            const r = byId[s.rule_id]!;
            return (
              <li
                key={s.rule_id}
                className="flex items-start gap-2.5 rounded-lg border border-border bg-background-elevated/60 px-3 py-2"
              >
                <RuleIcon name={r.icon} className="mt-0.5 size-3.5 shrink-0 text-primary" />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-xs font-medium text-foreground">{r.name}</span>
                    <SourcePill source={s.source === "ai" ? "ai" : "user"} />
                  </div>
                  <p className="mt-0.5 text-[11px] text-muted-foreground">
                    {s.reason || r.summary}
                  </p>
                </div>
                <button
                  type="button"
                  aria-label={`Remove ${r.name}`}
                  onClick={() => onChange(selected.filter((x) => x.rule_id !== s.rule_id))}
                  className="rounded p-0.5 text-muted-foreground transition hover:text-red"
                >
                  <X className="size-3.5" />
                </button>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="rounded-lg border border-dashed border-border px-3 py-2.5 text-[11px] text-muted-foreground">
          No optional rules yet. Add one, or let the AI suggest what fits.
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Popover open={addOpen} onOpenChange={setAddOpen}>
          <PopoverTrigger asChild>
            <button
              type="button"
              disabled={!addable.length}
              className="inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-xs font-medium text-foreground transition hover:bg-surface-hover disabled:opacity-50"
            >
              <Plus className="size-3.5" /> Add rule
            </button>
          </PopoverTrigger>
          <PopoverContent
            align="start"
            className="custom-scrollbar max-h-80 w-80 overflow-y-auto border-border bg-popover p-1.5"
          >
            {addable.map((r) => (
              <button
                key={r.id}
                type="button"
                onClick={() => {
                  onChange([...selected, { rule_id: r.id, source: "user", reason: "" }]);
                  setAddOpen(false);
                }}
                className="flex w-full items-start gap-2.5 rounded-md px-2.5 py-2 text-left transition hover:bg-surface-hover"
              >
                <RuleIcon
                  name={r.icon}
                  className="mt-0.5 size-3.5 shrink-0 text-muted-foreground"
                />
                <span className="min-w-0">
                  <span className="block text-xs font-medium text-foreground">{r.name}</span>
                  <span className="block text-[11px] text-muted-foreground">{r.summary}</span>
                </span>
              </button>
            ))}
          </PopoverContent>
        </Popover>

        {onSuggest ? (
          <button
            type="button"
            onClick={() => void suggest()}
            disabled={suggesting || Boolean(suggestHint) || !selectable.length}
            title={suggestHint}
            className="inline-flex items-center gap-1.5 rounded-lg border border-purple/30 bg-purple/10 px-2.5 py-1.5 text-xs font-medium text-purple transition hover:bg-purple/15 disabled:opacity-50"
          >
            {suggesting ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Sparkles className="size-3.5" />
            )}
            Suggest with AI
          </button>
        ) : null}
        {suggestHint ? (
          <span className="text-[10px] text-muted-foreground">{suggestHint}</span>
        ) : null}
      </div>
    </div>
  );
}
