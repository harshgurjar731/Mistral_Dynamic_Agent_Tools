/**
 * Create a rule, in a modal, in two short steps: choose what it checks, then
 * adjust it. Every choice starts on the rule type's recommended default, so a
 * rule can be created with one click after picking it — the rest is optional.
 */
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Bot, ChevronDown, GitBranch, Loader2, Plus, Search } from "lucide-react";
import { toast } from "sonner";
import { errorMessage, rulesApi } from "@/api";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import type { RuleApplies, RuleCategory, RuleEnforcement, RuleScope, RuleType } from "@/types";
import { RuleParamsForm } from "./RuleParamsForm";
import { AppliesPicker, CategoryPicker } from "./RuleScopingControls";
import { appliesToFields, toneFor, useRuleCategories } from "./ruleScoping";
import { ENFORCEMENT_META, RuleIcon, renderSummary } from "./RulePills";

const ENFORCEMENT_DOT: Record<RuleEnforcement, string> = {
  block: "bg-red",
  warn: "bg-amber",
  fix: "bg-cyan",
};

function Segmented<T extends string | boolean>({
  options,
  value,
  onChange,
}: {
  options: Array<{ value: T; label: string; dot?: string }>;
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div className="inline-flex rounded-lg border border-border bg-background/60 p-0.5">
      {options.map((o) => (
        <button
          key={String(o.value)}
          type="button"
          onClick={() => onChange(o.value)}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition",
            value === o.value
              ? "bg-surface text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {o.dot ? <span className={cn("size-1.5 rounded-full", o.dot)} /> : null}
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function RuleCreateDialog({
  open,
  onOpenChange,
  scope: initialScope,
  types,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  scope: RuleScope;
  types: RuleType[];
}) {
  const qc = useQueryClient();
  const [scope, setScope] = useState<RuleScope>(initialScope);
  const [query, setQuery] = useState("");
  const [type, setType] = useState<RuleType | null>(null);
  const [params, setParams] = useState<Record<string, unknown>>({});
  const [enforcement, setEnforcement] = useState<RuleEnforcement>("block");
  const [applies, setApplies] = useState<RuleApplies>("ai");
  const [targets, setTargets] = useState<string[]>([]);
  const [category, setCategory] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [showDetails, setShowDetails] = useState(false);

  // Every opening starts fresh, on the tab the user came from.
  useEffect(() => {
    if (!open) return;
    setScope(initialScope);
    setQuery("");
    setType(null);
    setShowDetails(false);
  }, [open, initialScope]);

  const pick = (t: RuleType, from?: RuleCategory) => {
    setType(t);
    setParams(Object.fromEntries(t.params.map((p) => [p.key, p.default])));
    // A category's defaults apply where the rule type supports them.
    const catEnforcement = from?.default_enforcement as RuleEnforcement | null | undefined;
    setEnforcement(
      catEnforcement && t.enforcements.includes(catEnforcement)
        ? catEnforcement
        : t.default_enforcement,
    );
    // A rule that only works when always on starts that way.
    setApplies(
      t.key === "reviewed_tools_only"
        ? "always"
        : from?.default_applies === "always" || from?.default_applies === "ai"
          ? from.default_applies
          : "ai",
    );
    setTargets([]);
    setCategory(from?.id ?? t.category);
    setName(t.name);
    setDescription("");
    setShowDetails(false);
  };

  const { categories } = useRuleCategories();
  // Every category — built-in or custom — offers the rule types it lists, so a
  // custom category appears here exactly like a built-in one.
  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const matching = types.filter(
      (t) =>
        t.scope === scope &&
        (!q || `${t.name} ${t.description} ${t.category}`.toLowerCase().includes(q)),
    );
    const listed = categories
      .filter((c) => !c.builtin)
      .concat(categories.filter((c) => c.builtin))
      .map((c) => ({
        category: c as RuleCategory | null,
        items: matching.filter((t) => c.rule_types?.includes(t.key)),
      }));
    const covered = new Set(listed.flatMap((g) => g.items.map((t) => t.key)));
    const rest = matching.filter((t) => !covered.has(t.key));
    return listed
      .concat(rest.length ? [{ category: null, items: rest }] : [])
      .filter((g) => g.items.length);
  }, [types, scope, query, categories]);

  const optionLabels = useMemo(
    () =>
      Object.fromEntries(
        (type?.params ?? []).map((p) => [
          p.key,
          Object.fromEntries(p.options.map((o) => [o.value, o.label])),
        ]),
      ),
    [type],
  );

  const create = useMutation({
    mutationFn: () =>
      rulesApi.create({
        type: type!.key,
        name: name.trim() || type!.name,
        description: description.trim(),
        params,
        enforcement,
        category,
        ...appliesToFields(applies, targets),
      }),
    onSuccess: (r) => {
      toast.success(`Rule “${r.name}” created`);
      void qc.invalidateQueries({ queryKey: ["rules"] });
      onOpenChange(false);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const noun = scope === "agent" ? "agent" : "workflow";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] max-w-2xl flex-col gap-0 overflow-hidden p-0">
        {/* Header */}
        <DialogHeader className="space-y-1 border-b border-border px-6 py-4 text-left">
          {type ? (
            <div className="flex items-start gap-3">
              <span className="grid size-9 shrink-0 place-items-center rounded-lg border border-primary/30 bg-primary/10 text-primary">
                <RuleIcon name={type.icon} className="size-4" />
              </span>
              <div className="min-w-0 flex-1">
                <DialogTitle className="text-base">{type.name}</DialogTitle>
                <DialogDescription className="mt-0.5 text-xs">{type.description}</DialogDescription>
              </div>
            </div>
          ) : (
            <>
              <DialogTitle className="text-base">New rule</DialogTitle>
              <DialogDescription className="text-xs">
                Pick what the rule should check. You can adjust it on the next step.
              </DialogDescription>
            </>
          )}
        </DialogHeader>

        {/* Body */}
        <div className="custom-scrollbar flex-1 overflow-y-auto px-6 py-5">
          {!type ? (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center gap-2">
                <div className="inline-flex rounded-lg border border-border bg-background/60 p-0.5">
                  {(
                    [
                      { value: "agent", label: "Agent rules", icon: Bot },
                      { value: "workflow", label: "Workflow rules", icon: GitBranch },
                    ] as const
                  ).map((o) => (
                    <button
                      key={o.value}
                      type="button"
                      onClick={() => setScope(o.value)}
                      className={cn(
                        "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition",
                        scope === o.value
                          ? "bg-surface text-foreground shadow-sm"
                          : "text-muted-foreground hover:text-foreground",
                      )}
                    >
                      <o.icon className="size-3.5" /> {o.label}
                    </button>
                  ))}
                </div>
                <div className="relative min-w-[12rem] flex-1">
                  <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
                  <input
                    autoFocus
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Search rules…"
                    className="h-8 w-full rounded-lg border border-border bg-background pr-3 pl-8 text-xs text-foreground placeholder:text-muted-foreground focus:ring-1 focus:ring-primary focus:outline-none"
                  />
                </div>
              </div>

              {groups.length === 0 ? (
                <p className="py-8 text-center text-xs text-muted-foreground">
                  No {noun} rules match “{query}”.
                </p>
              ) : (
                groups.map(({ category: c, items }) => {
                  return (
                    <div key={c?.id ?? "other"}>
                      <p className="mb-2 flex items-center gap-1.5 text-[10px] font-semibold tracking-wider text-muted-foreground uppercase">
                        <span
                          className={cn(
                            "grid size-4 place-items-center rounded border",
                            toneFor(c?.color).chip,
                          )}
                        >
                          <RuleIcon name={c?.icon ?? "Tag"} className="size-2.5" />
                        </span>
                        {c?.name ?? "Other"}
                        {c && !c.builtin ? (
                          <span className="font-normal tracking-normal normal-case text-muted-foreground/70">
                            · your category
                          </span>
                        ) : null}
                      </p>
                      <div className="grid gap-2 sm:grid-cols-2">
                        {items.map((t) => (
                          <button
                            key={t.key}
                            type="button"
                            onClick={() => pick(t, c ?? undefined)}
                            className="group flex items-start gap-2.5 rounded-lg border border-border bg-background/40 p-2.5 text-left transition hover:border-primary/40 hover:bg-primary/5"
                          >
                            <span className="grid size-7 shrink-0 place-items-center rounded-md border border-border bg-background-elevated text-muted-foreground group-hover:text-primary">
                              <RuleIcon name={t.icon} className="size-3.5" />
                            </span>
                            <span className="min-w-0">
                              <span className="block text-xs font-medium text-foreground">
                                {t.name}
                              </span>
                              <span className="mt-0.5 line-clamp-2 block text-[11px] leading-snug text-muted-foreground">
                                {t.description}
                              </span>
                            </span>
                          </button>
                        ))}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          ) : (
            <div className="space-y-6">
              {type.params.length > 0 ? (
                <section>
                  <h3 className="mb-3 text-xs font-semibold text-foreground">Settings</h3>
                  <RuleParamsForm fields={type.params} value={params} onChange={setParams} />
                </section>
              ) : null}

              <section className="space-y-4 rounded-xl border border-border bg-background/40 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="text-xs font-semibold text-foreground">If it’s broken</p>
                    <p className="mt-0.5 text-[11px] text-muted-foreground">
                      {type.enforcement_help[enforcement] ?? ENFORCEMENT_META[enforcement].hint}
                    </p>
                  </div>
                  {type.enforcements.length > 1 ? (
                    <Segmented
                      options={type.enforcements.map((e) => ({
                        value: e,
                        label: ENFORCEMENT_META[e].label,
                        dot: ENFORCEMENT_DOT[e],
                      }))}
                      value={enforcement}
                      onChange={setEnforcement}
                    />
                  ) : (
                    <span className="inline-flex items-center gap-1.5 text-xs text-foreground">
                      <span className={cn("size-1.5 rounded-full", ENFORCEMENT_DOT[enforcement])} />
                      {ENFORCEMENT_META[enforcement].label}
                    </span>
                  )}
                </div>

                <div className="space-y-2.5 border-t border-border/60 pt-4">
                  <p className="text-xs font-semibold text-foreground">Apply to</p>
                  <AppliesPicker
                    scope={scope}
                    applies={applies}
                    targets={targets}
                    onlyAlways={type.key === "reviewed_tools_only"}
                    onChange={(next) => {
                      setApplies(next.applies);
                      setTargets(next.targets);
                    }}
                  />
                </div>

                <div className="space-y-2.5 border-t border-border/60 pt-4">
                  <p className="text-xs font-semibold text-foreground">Category</p>
                  <CategoryPicker value={category} onChange={setCategory} />
                </div>
              </section>

              <section>
                <button
                  type="button"
                  onClick={() => setShowDetails((s) => !s)}
                  className="flex items-center gap-1 text-xs text-muted-foreground transition hover:text-foreground"
                >
                  <ChevronDown
                    className={cn("size-3.5 transition-transform", !showDetails && "-rotate-90")}
                  />
                  Name and description
                  <span className="text-muted-foreground/70">· optional</span>
                </button>
                {showDetails ? (
                  <div className="mt-3 space-y-3">
                    <input
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder={type.name}
                      className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:ring-1 focus:ring-primary focus:outline-none"
                    />
                    <textarea
                      value={description}
                      onChange={(e) => setDescription(e.target.value)}
                      rows={2}
                      placeholder="Why this rule exists — the orchestrator reads this when deciding where it applies."
                      className="w-full resize-none rounded-lg border border-border bg-background px-3 py-2 text-xs text-foreground placeholder:text-muted-foreground focus:ring-1 focus:ring-primary focus:outline-none"
                    />
                  </div>
                ) : null}
              </section>
            </div>
          )}
        </div>

        {/* Footer */}
        {type ? (
          <div className="border-t border-border bg-background/60 px-6 py-3.5">
            <p className="mb-3 text-xs leading-relaxed text-foreground/90">
              <span className="font-semibold text-primary">What it does: </span>
              {renderSummary(type.summary, params, optionLabels)}
              <span className="text-muted-foreground">
                {" "}
                Checked {type.checkpoint_labels.map((l) => l.toLowerCase()).join(", ")}.
              </span>
            </p>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setType(null)}
                className="inline-flex items-center gap-1 rounded-lg px-2.5 py-2 text-xs text-muted-foreground transition hover:bg-surface-hover hover:text-foreground"
              >
                <ArrowLeft className="size-3.5" /> Back
              </button>
              <button
                type="button"
                onClick={() => onOpenChange(false)}
                className="ml-auto rounded-lg border border-border px-3 py-2 text-xs text-muted-foreground transition hover:bg-surface-hover hover:text-foreground"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => create.mutate()}
                disabled={create.isPending || (applies === "targeted" && targets.length === 0)}
                className="inline-flex items-center gap-1.5 rounded-lg bg-gradient-brand px-4 py-2 text-xs font-semibold text-primary-foreground transition hover:opacity-90 disabled:opacity-50"
              >
                {create.isPending ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <Plus className="size-3.5" />
                )}
                Create rule
              </button>
            </div>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
