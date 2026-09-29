/**
 * One editor for every rule category. A built-in category opens read-only; a
 * custom one is configured the same way: what it looks like, whether it is for
 * agents or workflows, which rule types it offers in "New rule", and the
 * defaults rules created from it start with.
 */
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bot, Check, GitBranch, Layers, Loader2, Lock, Save } from "lucide-react";
import { toast } from "sonner";
import { errorMessage, QK, rulesApi } from "@/api";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import type { RuleCategory, RuleEnforcement, RuleType } from "@/types";
import { ENFORCEMENT_META, RuleIcon } from "./RulePills";
import {
  CATEGORY_COLORS,
  CATEGORY_ICON_CHOICES,
  type CategoryScope,
  toneFor,
  useRuleCategories,
} from "./ruleScoping";

const SCOPES: Array<{ value: CategoryScope; label: string; icon: typeof Bot }> = [
  { value: "agent", label: "Agent rules", icon: Bot },
  { value: "workflow", label: "Workflow rules", icon: GitBranch },
  { value: "both", label: "Both", icon: Layers },
];

const ENFORCEMENT_DOT: Record<RuleEnforcement, string> = {
  block: "bg-red",
  warn: "bg-amber",
  fix: "bg-cyan",
};

function Section({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-2.5">
      <div>
        <h3 className="text-xs font-semibold text-foreground">{title}</h3>
        {hint ? <p className="mt-0.5 text-[11px] text-muted-foreground">{hint}</p> : null}
      </div>
      {children}
    </section>
  );
}

function Choice<T extends string>({
  options,
  value,
  onChange,
  disabled,
}: {
  options: Array<{ value: T; label: string; dot?: string | undefined; icon?: typeof Bot }>;
  value: T;
  onChange: (v: T) => void;
  disabled?: boolean;
}) {
  return (
    <div className="inline-flex flex-wrap rounded-lg border border-border bg-background/60 p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          disabled={disabled}
          onClick={() => onChange(o.value)}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition disabled:cursor-default",
            value === o.value
              ? "bg-surface text-foreground shadow-sm"
              : "text-muted-foreground enabled:hover:text-foreground",
          )}
        >
          {o.icon ? <o.icon className="size-3.5" /> : null}
          {o.dot ? <span className={cn("size-1.5 rounded-full", o.dot)} /> : null}
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function CategoryEditorDialog({
  open,
  onOpenChange,
  category,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The category to edit or view; omit to create a new one. */
  category?: RuleCategory | null | undefined;
  onSaved?: ((c: RuleCategory) => void) | undefined;
}) {
  const qc = useQueryClient();
  const readOnly = Boolean(category?.builtin);
  const { categories } = useRuleCategories();
  const typesQuery = useQuery({ queryKey: QK.ruleTypes(), queryFn: () => rulesApi.types() });
  const allTypes: RuleType[] = useMemo(() => typesQuery.data?.types ?? [], [typesQuery.data]);

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [color, setColor] = useState("indigo");
  const [icon, setIcon] = useState("Tag");
  const [scope, setScope] = useState<CategoryScope>("both");
  const [ruleTypes, setRuleTypes] = useState<string[]>([]);
  const [enforcement, setEnforcement] = useState<"" | RuleEnforcement>("");
  const [applies, setApplies] = useState<"" | "always" | "ai">("");

  useEffect(() => {
    if (!open) return;
    setName(category?.name ?? "");
    setDescription(category?.description ?? "");
    setColor(category?.color ?? "indigo");
    setIcon(category?.icon ?? "Tag");
    setScope((category?.scope as CategoryScope | undefined) ?? "both");
    setRuleTypes(category?.rule_types ?? []);
    setEnforcement((category?.default_enforcement as RuleEnforcement | null) ?? "");
    setApplies((category?.default_applies as "always" | "ai" | null) ?? "");
  }, [open, category]);

  // Offer types grouped the way the built-in categories file them.
  const builtins = categories.filter((c) => c.builtin);
  const offered = useMemo(
    () => allTypes.filter((t) => scope === "both" || t.scope === scope),
    [allTypes, scope],
  );
  const groups = builtins
    .map((c) => ({ category: c, items: offered.filter((t) => c.rule_types?.includes(t.key)) }))
    .filter((g) => g.items.length);
  const selected = new Set(ruleTypes);
  const shownSelected = ruleTypes.filter((k) => offered.some((t) => t.key === k));

  // Enforcements every chosen type supports; a default outside that set would
  // be silently ignored for some of them.
  const commonEnforcements = useMemo(() => {
    const chosen = allTypes.filter((t) => selected.has(t.key));
    if (!chosen.length) return ["block", "warn", "fix"] as RuleEnforcement[];
    return (["block", "warn", "fix"] as RuleEnforcement[]).filter((e) =>
      chosen.some((t) => t.enforcements.includes(e)),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allTypes, ruleTypes]);

  const toggle = (key: string) =>
    setRuleTypes((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]));
  const toggleGroup = (keys: string[], on: boolean) =>
    setRuleTypes((prev) =>
      on ? [...new Set([...prev, ...keys])] : prev.filter((k) => !keys.includes(k)),
    );

  const save = useMutation({
    mutationFn: () => {
      const body = {
        name: name.trim(),
        description: description.trim(),
        color,
        icon,
        scope,
        rule_types: shownSelected,
        default_enforcement: enforcement,
        default_applies: applies,
      };
      return category ? rulesApi.updateCategory(category.id, body) : rulesApi.createCategory(body);
    },
    onSuccess: (c) => {
      toast.success(category ? `Category “${c.name}” saved` : `Category “${c.name}” created`);
      void qc.invalidateQueries({ queryKey: QK.ruleCategories() });
      void qc.invalidateQueries({ queryKey: ["rules"] });
      onSaved?.(c);
      onOpenChange(false);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const tone = toneFor(color);
  const title = readOnly ? category!.name : category ? "Edit category" : "New category";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[88vh] max-w-2xl flex-col gap-0 overflow-hidden p-0">
        <DialogHeader className="space-y-1 border-b border-border px-6 py-4 text-left">
          <div className="flex items-center gap-3">
            <span
              className={cn("grid size-9 shrink-0 place-items-center rounded-lg border", tone.chip)}
            >
              <RuleIcon name={icon} className="size-4" />
            </span>
            <div className="min-w-0 flex-1">
              <DialogTitle className="flex items-center gap-2 text-base">
                {title}
                {readOnly ? (
                  <span className="inline-flex items-center gap-1 rounded border border-border px-1.5 py-0.5 text-[10px] font-normal text-muted-foreground">
                    <Lock className="size-2.5" /> Built-in
                  </span>
                ) : null}
              </DialogTitle>
              <DialogDescription className="text-xs">
                {readOnly
                  ? "Built-in categories ship with the platform and cannot be changed. Create your own to group rules differently."
                  : "Configure it like a built-in category: the rule types it offers in “New rule”, and the defaults those rules start with."}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="custom-scrollbar flex-1 space-y-6 overflow-y-auto px-6 py-5">
          <Section title="Details">
            <div className="grid gap-2.5 sm:grid-cols-2">
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                disabled={readOnly}
                maxLength={60}
                autoFocus={!readOnly}
                placeholder="Name, e.g. Compliance"
                className="h-9 rounded-lg border border-border bg-background px-3 text-sm text-foreground placeholder:text-muted-foreground focus:ring-1 focus:ring-primary focus:outline-none disabled:opacity-80"
              />
              <input
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                disabled={readOnly}
                maxLength={300}
                placeholder="What belongs here"
                className="h-9 rounded-lg border border-border bg-background px-3 text-xs text-foreground placeholder:text-muted-foreground focus:ring-1 focus:ring-primary focus:outline-none disabled:opacity-80"
              />
            </div>
          </Section>

          {readOnly ? null : (
            <Section title="Appearance">
              <div className="flex flex-wrap items-center gap-4">
                <div className="flex items-center gap-1.5" role="radiogroup" aria-label="Colour">
                  {CATEGORY_COLORS.map((c) => (
                    <button
                      key={c}
                      type="button"
                      role="radio"
                      aria-checked={color === c}
                      aria-label={c}
                      onClick={() => setColor(c)}
                      className={cn(
                        "size-5 rounded-full transition",
                        toneFor(c).swatch,
                        color === c
                          ? "ring-2 ring-foreground ring-offset-2 ring-offset-background"
                          : "opacity-50 hover:opacity-100",
                      )}
                    />
                  ))}
                </div>
                <div className="flex items-center gap-1" role="radiogroup" aria-label="Icon">
                  {CATEGORY_ICON_CHOICES.map((i) => (
                    <button
                      key={i}
                      type="button"
                      role="radio"
                      aria-checked={icon === i}
                      aria-label={i}
                      onClick={() => setIcon(i)}
                      className={cn(
                        "grid size-8 place-items-center rounded-lg border transition",
                        icon === i
                          ? tone.chip
                          : "border-border text-muted-foreground hover:text-foreground",
                      )}
                    >
                      <RuleIcon name={i} className="size-3.5" />
                    </button>
                  ))}
                </div>
              </div>
            </Section>
          )}

          <Section title="For" hint="Which rules this category offers when someone creates a rule.">
            <Choice
              options={SCOPES}
              value={scope}
              onChange={(s) => {
                setScope(s);
                if (s !== "both") {
                  setRuleTypes((prev) =>
                    prev.filter((k) => allTypes.find((t) => t.key === k)?.scope === s),
                  );
                }
              }}
              disabled={readOnly}
            />
          </Section>

          <Section
            title={`Rule types (${shownSelected.length})`}
            hint={
              readOnly
                ? "The rule types filed under this category."
                : "Tick the rule types this category offers. They appear under it in “New rule”; a type can be in several categories."
            }
          >
            {typesQuery.isLoading ? (
              <p className="flex items-center gap-2 text-xs text-muted-foreground">
                <Loader2 className="size-3 animate-spin" /> Loading rule types…
              </p>
            ) : (
              <div className="space-y-3">
                {groups.map(({ category: g, items }) => {
                  const shown = readOnly ? items.filter((t) => selected.has(t.key)) : items;
                  if (!shown.length) return null;
                  const keys = shown.map((t) => t.key);
                  const all = keys.every((k) => selected.has(k));
                  return (
                    <div key={g.id} className="rounded-lg border border-border">
                      <div className="flex items-center gap-2 border-b border-border/60 px-3 py-2">
                        <RuleIcon name={g.icon} className="size-3 text-muted-foreground" />
                        <span className="text-[11px] font-medium text-foreground">{g.name}</span>
                        {readOnly ? null : (
                          <button
                            type="button"
                            onClick={() => toggleGroup(keys, !all)}
                            className="ml-auto text-[10px] text-primary hover:underline"
                          >
                            {all ? "Clear" : "Select all"}
                          </button>
                        )}
                      </div>
                      <div className="grid gap-1 p-1.5 sm:grid-cols-2">
                        {shown.map((t) => {
                          const on = selected.has(t.key);
                          return (
                            <button
                              key={t.key}
                              type="button"
                              disabled={readOnly}
                              onClick={() => toggle(t.key)}
                              className={cn(
                                "flex items-start gap-2 rounded-md px-2 py-1.5 text-left transition disabled:cursor-default",
                                on ? "bg-primary/5" : "enabled:hover:bg-surface-hover",
                              )}
                            >
                              {readOnly ? null : (
                                <span
                                  className={cn(
                                    "mt-0.5 grid size-3.5 shrink-0 place-items-center rounded border",
                                    on
                                      ? "border-primary bg-primary text-primary-foreground"
                                      : "border-border",
                                  )}
                                >
                                  {on ? <Check className="size-2.5" /> : null}
                                </span>
                              )}
                              <RuleIcon
                                name={t.icon}
                                className="mt-0.5 size-3.5 shrink-0 text-muted-foreground"
                              />
                              <span className="min-w-0">
                                <span className="block text-xs text-foreground">{t.name}</span>
                                <span className="block text-[10px] text-muted-foreground">
                                  {t.scope === "agent" ? "Agent rule" : "Workflow rule"} ·{" "}
                                  {t.enforcements.map((e) => ENFORCEMENT_META[e].label).join(" / ")}
                                </span>
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </Section>

          <Section
            title="Defaults for new rules"
            hint="What a rule created from this category starts with. It can still be changed on the rule."
          >
            <div className="space-y-3 rounded-lg border border-border bg-background/40 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs text-foreground">If it’s broken</span>
                <Choice
                  disabled={readOnly}
                  value={enforcement}
                  onChange={setEnforcement}
                  options={[
                    { value: "" as const, label: "Rule’s own" },
                    ...commonEnforcements.map((e) => ({
                      value: e,
                      label: ENFORCEMENT_META[e].label,
                      dot: ENFORCEMENT_DOT[e],
                    })),
                  ]}
                />
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border/60 pt-3">
                <span className="text-xs text-foreground">Apply to</span>
                <Choice
                  disabled={readOnly}
                  value={applies}
                  onChange={setApplies}
                  options={[
                    { value: "" as const, label: "Rule’s own" },
                    { value: "always", label: "All" },
                    { value: "ai", label: "Where relevant" },
                  ]}
                />
              </div>
              {enforcement ? (
                <p className="text-[10px] text-muted-foreground">
                  Rule types that cannot {ENFORCEMENT_META[enforcement].label.toLowerCase()} keep
                  their own default.
                </p>
              ) : null}
            </div>
          </Section>
        </div>

        <div className="flex items-center gap-2 border-t border-border bg-background/60 px-6 py-3.5">
          {!readOnly && shownSelected.length === 0 ? (
            <span className="text-[11px] text-amber">
              With no rule types it will only be a label.
            </span>
          ) : null}
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="ml-auto rounded-lg border border-border px-3 py-2 text-xs text-muted-foreground transition hover:bg-surface-hover hover:text-foreground"
          >
            {readOnly ? "Close" : "Cancel"}
          </button>
          {readOnly ? null : (
            <button
              type="button"
              onClick={() => save.mutate()}
              disabled={!name.trim() || save.isPending}
              className="inline-flex items-center gap-1.5 rounded-lg bg-gradient-brand px-4 py-2 text-xs font-semibold text-primary-foreground transition hover:opacity-90 disabled:opacity-50"
            >
              {save.isPending ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Save className="size-3.5" />
              )}
              {category ? "Save category" : "Create category"}
            </button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
