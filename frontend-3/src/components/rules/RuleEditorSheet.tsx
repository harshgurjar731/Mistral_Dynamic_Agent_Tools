import { useEffect, useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Loader2, RotateCcw, Save, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { errorMessage, rulesApi } from "@/api";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import type { Rule, RuleEnforcement, RuleScope, RuleType } from "@/types";
import { RuleParamsForm } from "./RuleParamsForm";
import {
  CATEGORY_META,
  CATEGORY_ORDER,
  ENFORCEMENT_META,
  RuleIcon,
  renderSummary,
} from "./RulePills";

/**
 * Create or edit one rule. Creating is two steps: pick what kind of rule,
 * then configure it. Every setting is a form control — never JSON — and the
 * sentence at the bottom always says, in plain words, what the rule will do.
 */
export function RuleEditorSheet({
  open,
  onOpenChange,
  scope,
  rule,
  types,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  scope: RuleScope;
  /** The rule being edited; omit to create a new one. */
  rule?: Rule | null;
  types: RuleType[];
}) {
  const qc = useQueryClient();
  const scopeTypes = useMemo(() => types.filter((t) => t.scope === scope), [types, scope]);

  const [typeKey, setTypeKey] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [params, setParams] = useState<Record<string, unknown>>({});
  const [enforcement, setEnforcement] = useState<RuleEnforcement>("block");
  const [alwaysOn, setAlwaysOn] = useState(false);

  const type = types.find((t) => t.key === typeKey) ?? null;

  // Reset whenever the sheet opens on a different rule (or on "new").
  useEffect(() => {
    if (!open) return;
    if (rule) {
      setTypeKey(rule.type);
      setName(rule.name);
      setDescription(rule.description ?? "");
      setParams(rule.params ?? {});
      setEnforcement(rule.enforcement);
      setAlwaysOn(rule.always_on);
    } else {
      setTypeKey(null);
      setName("");
      setDescription("");
      setParams({});
      setAlwaysOn(false);
    }
  }, [open, rule]);

  const pickType = (t: RuleType) => {
    setTypeKey(t.key);
    setName(t.name);
    setDescription("");
    setParams(Object.fromEntries(t.params.map((p) => [p.key, p.default])));
    setEnforcement(t.default_enforcement);
    setAlwaysOn(false);
  };

  const invalidate = () => qc.invalidateQueries({ queryKey: ["rules"] });

  const save = useMutation({
    mutationFn: () => {
      const body = {
        name: name.trim(),
        description: description.trim(),
        params,
        enforcement,
        always_on: alwaysOn,
      };
      return rule ? rulesApi.update(rule.id, body) : rulesApi.create({ type: typeKey!, ...body });
    },
    onSuccess: () => {
      toast.success(rule ? "Rule saved" : "Rule created");
      invalidate();
      onOpenChange(false);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const remove = useMutation({
    mutationFn: () => rulesApi.remove(rule!.id),
    onSuccess: () => {
      toast.success("Rule deleted");
      invalidate();
      onOpenChange(false);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const restore = useMutation({
    mutationFn: () => rulesApi.restore(rule!.id),
    onSuccess: (r) => {
      toast.success("Restored to the recommended settings");
      setName(r.name);
      setDescription(r.description ?? "");
      setParams(r.params);
      setEnforcement(r.enforcement);
      setAlwaysOn(r.always_on);
      invalidate();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

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

  const scopeWord = scope === "agent" ? "agent" : "workflow";

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="custom-scrollbar w-full overflow-y-auto border-border bg-background-elevated p-0 sm:max-w-lg">
        <SheetHeader className="border-b border-border px-6 py-5">
          <div className="flex items-center gap-2">
            <span
              className={cn(
                "rounded border px-1.5 py-0.5 font-mono text-[9px] font-bold uppercase",
                scope === "agent"
                  ? "border-primary/30 bg-primary/10 text-primary"
                  : "border-blue/30 bg-blue/10 text-blue",
              )}
            >
              {scopeWord} rule
            </span>
          </div>
          <SheetTitle className="text-base">
            {rule
              ? "Edit rule"
              : type
                ? `New ${type.name.toLowerCase()} rule`
                : `New ${scopeWord} rule`}
          </SheetTitle>
          <SheetDescription className="text-xs">
            {type
              ? type.description
              : `Pick what this rule should check. It will apply to ${scopeWord}s only.`}
          </SheetDescription>
        </SheetHeader>

        {!type ? (
          <TypeGallery types={scopeTypes} onPick={pickType} />
        ) : (
          <div className="space-y-6 px-6 py-5">
            {!rule ? (
              <button
                type="button"
                onClick={() => setTypeKey(null)}
                className="inline-flex items-center gap-1 text-xs text-muted-foreground transition hover:text-foreground"
              >
                <ArrowLeft className="size-3" /> Choose a different kind of rule
              </button>
            ) : null}

            <section className="space-y-3">
              <div>
                <label className="eyebrow mb-1.5 block">Name</label>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                />
              </div>
              <div>
                <label className="eyebrow mb-1.5 block">Why this rule exists (optional)</label>
                <input
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder={type.description}
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                />
                <p className="mt-1 text-[11px] text-muted-foreground">
                  The orchestrator reads this when deciding where the rule is relevant.
                </p>
              </div>
            </section>

            <section>
              <h3 className="mb-3 text-xs font-semibold text-foreground">Settings</h3>
              <RuleParamsForm fields={type.params} value={params} onChange={setParams} />
            </section>

            <section>
              <h3 className="mb-2 text-xs font-semibold text-foreground">When it's violated</h3>
              <div className="grid gap-2">
                {type.enforcements.map((e) => {
                  const meta = ENFORCEMENT_META[e];
                  const on = enforcement === e;
                  return (
                    <button
                      key={e}
                      type="button"
                      onClick={() => setEnforcement(e)}
                      className={cn(
                        "rounded-lg border px-3 py-2.5 text-left transition",
                        on
                          ? "border-primary/40 bg-primary/8"
                          : "border-border hover:border-border-strong",
                      )}
                    >
                      <span className="flex items-center gap-2 text-xs font-semibold text-foreground">
                        <span
                          className={cn(
                            "size-2 rounded-full",
                            e === "block" ? "bg-red" : e === "warn" ? "bg-amber" : "bg-cyan",
                          )}
                        />
                        {meta.label}
                      </span>
                      <span className="mt-0.5 block text-[11px] text-muted-foreground">
                        {type.enforcement_help[e] ?? meta.hint}
                      </span>
                    </button>
                  );
                })}
              </div>
            </section>

            <section>
              <h3 className="mb-2 text-xs font-semibold text-foreground">How it's applied</h3>
              <div className="grid gap-2 sm:grid-cols-2">
                {[
                  {
                    on: true,
                    title: "Always on",
                    body: `Every ${scopeWord}, including existing ones.`,
                  },
                  {
                    on: false,
                    title: "AI decides",
                    body: `The orchestrator adds it to ${scopeWord}s where it's relevant. You can also add it by hand.`,
                  },
                ].map((opt) => (
                  <button
                    key={opt.title}
                    type="button"
                    onClick={() => setAlwaysOn(opt.on)}
                    className={cn(
                      "rounded-lg border px-3 py-2.5 text-left transition",
                      alwaysOn === opt.on
                        ? "border-primary/40 bg-primary/8"
                        : "border-border hover:border-border-strong",
                    )}
                  >
                    <span className="block text-xs font-semibold text-foreground">{opt.title}</span>
                    <span className="mt-0.5 block text-[11px] text-muted-foreground">
                      {opt.body}
                    </span>
                  </button>
                ))}
              </div>
              {type.key === "reviewed_tools_only" && !alwaysOn ? (
                <p className="mt-2 text-[11px] text-amber">
                  This rule only takes effect when it is always on — tools are generated before any
                  agent exists to attach it to.
                </p>
              ) : null}
            </section>

            <section className="rounded-xl border border-primary/25 bg-primary/5 p-4">
              <p className="eyebrow mb-1.5">What this rule does</p>
              <p className="text-sm text-foreground">
                {renderSummary(type.summary, params, optionLabels)}
              </p>
              <p className="mt-2 text-[11px] text-muted-foreground">
                Checked {type.checkpoint_labels.map((l) => l.toLowerCase()).join(" · ")}.
              </p>
            </section>

            <div className="flex flex-wrap items-center gap-2 border-t border-border pt-4">
              {rule?.source === "recommended" ? (
                <button
                  type="button"
                  onClick={() => restore.mutate()}
                  disabled={restore.isPending}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-xs text-muted-foreground transition hover:bg-surface-hover hover:text-foreground disabled:opacity-50"
                >
                  <RotateCcw className="size-3.5" /> Restore default
                </button>
              ) : null}
              {rule && rule.source !== "recommended" ? (
                <button
                  type="button"
                  onClick={() =>
                    window.confirm(`Delete the rule "${rule.name}"?`) && remove.mutate()
                  }
                  disabled={remove.isPending}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-red/20 px-3 py-2 text-xs text-red/80 transition hover:bg-red/10 hover:text-red disabled:opacity-50"
                >
                  <Trash2 className="size-3.5" /> Delete
                </button>
              ) : null}
              <button
                type="button"
                onClick={() => save.mutate()}
                disabled={save.isPending || !name.trim()}
                className="ml-auto inline-flex items-center gap-1.5 rounded-xl bg-gradient-brand px-4 py-2 text-sm font-medium text-primary-foreground transition hover:opacity-90 disabled:opacity-50"
              >
                {save.isPending ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Save className="size-4" />
                )}
                {rule ? "Save rule" : "Create rule"}
              </button>
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

function TypeGallery({ types, onPick }: { types: RuleType[]; onPick: (t: RuleType) => void }) {
  const groups = CATEGORY_ORDER.map((c) => ({
    c,
    items: types.filter((t) => t.category === c),
  })).filter((g) => g.items.length);
  return (
    <div className="space-y-5 px-6 py-5">
      {groups.map(({ c, items }) => {
        const meta = CATEGORY_META[c];
        const Icon = meta?.icon;
        return (
          <div key={c}>
            <p className="eyebrow mb-2 flex items-center gap-1.5">
              {Icon ? <Icon className="size-3" /> : null}
              {meta?.label ?? c}
            </p>
            <div className="grid gap-2">
              {items.map((t) => (
                <button
                  key={t.key}
                  type="button"
                  onClick={() => onPick(t)}
                  className="group flex items-start gap-3 rounded-xl border border-border bg-background/40 p-3 text-left transition hover:border-primary/40 hover:bg-primary/5"
                >
                  <span className="grid size-8 shrink-0 place-items-center rounded-lg border border-border bg-background-elevated text-muted-foreground group-hover:text-primary">
                    <RuleIcon name={t.icon} className="size-4" />
                  </span>
                  <span className="min-w-0">
                    <span className="block text-sm font-medium text-foreground">{t.name}</span>
                    <span className="mt-0.5 block text-xs text-muted-foreground">
                      {t.description}
                    </span>
                    <span className="mt-1 block text-[10px] text-muted-foreground/80">
                      {t.checkpoint_labels.join(" · ")}
                    </span>
                  </span>
                </button>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
