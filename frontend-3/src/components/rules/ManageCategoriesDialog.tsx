/** Every rule category, built-in and custom, listed the same way. */
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Eye, Lock, Pencil, Plus, Trash2 } from "lucide-react";
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
import type { RuleCategory } from "@/types";
import { CategoryEditorDialog } from "./CategoryEditorDialog";
import { ENFORCEMENT_META, RuleIcon } from "./RulePills";
import { toneFor, useRuleCategories } from "./ruleScoping";

const SCOPE_LABEL: Record<string, string> = {
  agent: "Agent rules",
  workflow: "Workflow rules",
  both: "Agent & workflow rules",
};

function CategoryRow({
  category,
  onOpen,
}: {
  category: RuleCategory;
  onOpen: (c: RuleCategory) => void;
}) {
  const qc = useQueryClient();
  const tone = toneFor(category.color);
  const typeCount = category.rule_types?.length ?? 0;

  const remove = useMutation({
    mutationFn: () => rulesApi.removeCategory(category.id),
    onSuccess: (r) => {
      toast.success(
        r.rules_moved
          ? `Deleted — ${r.rules_moved} rule${r.rules_moved === 1 ? "" : "s"} moved back to their own category`
          : "Category deleted",
      );
      void qc.invalidateQueries({ queryKey: QK.ruleCategories() });
      void qc.invalidateQueries({ queryKey: ["rules"] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const defaults = [
    category.default_enforcement
      ? ENFORCEMENT_META[category.default_enforcement as keyof typeof ENFORCEMENT_META]?.label
      : null,
    category.default_applies === "always"
      ? "Applies to all"
      : category.default_applies === "ai"
        ? "Where relevant"
        : null,
  ].filter(Boolean);

  return (
    <div className="group flex items-center gap-3 rounded-lg border border-border px-3 py-2.5 transition hover:border-border-strong">
      <span className={cn("grid size-8 shrink-0 place-items-center rounded-md border", tone.chip)}>
        <RuleIcon name={category.icon} className="size-3.5" />
      </span>
      <button type="button" onClick={() => onOpen(category)} className="min-w-0 flex-1 text-left">
        <p className="truncate text-sm font-medium text-foreground">{category.name}</p>
        <p className="truncate text-[11px] text-muted-foreground">
          {typeCount} rule type{typeCount === 1 ? "" : "s"} ·{" "}
          {SCOPE_LABEL[category.scope ?? "both"] ?? SCOPE_LABEL["both"]} · {category.rules} rule
          {category.rules === 1 ? "" : "s"}
          {defaults.length ? ` · Default: ${defaults.join(", ")}` : ""}
        </p>
      </button>
      {category.builtin ? (
        <>
          <span className="flex items-center gap-1 text-[10px] text-muted-foreground/70">
            <Lock className="size-3" /> Built-in
          </span>
          <button
            type="button"
            onClick={() => onOpen(category)}
            aria-label={`View ${category.name}`}
            className="rounded-md p-1.5 text-muted-foreground hover:bg-surface-hover hover:text-foreground"
          >
            <Eye className="size-3.5" />
          </button>
        </>
      ) : (
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => onOpen(category)}
            aria-label={`Edit ${category.name}`}
            className="rounded-md p-1.5 text-muted-foreground hover:bg-surface-hover hover:text-foreground"
          >
            <Pencil className="size-3.5" />
          </button>
          <button
            type="button"
            onClick={() =>
              window.confirm(
                `Delete the category “${category.name}”?` +
                  (category.rules
                    ? ` Its ${category.rules} rule${category.rules === 1 ? "" : "s"} will move back to their own category.`
                    : ""),
              ) && remove.mutate()
            }
            disabled={remove.isPending}
            aria-label={`Delete ${category.name}`}
            className="rounded-md p-1.5 text-muted-foreground hover:bg-red/10 hover:text-red disabled:opacity-50"
          >
            <Trash2 className="size-3.5" />
          </button>
        </div>
      )}
    </div>
  );
}

export function ManageCategoriesDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { categories } = useRuleCategories();
  const [editor, setEditor] = useState<{ open: boolean; category: RuleCategory | null }>({
    open: false,
    category: null,
  });
  const custom = categories.filter((c) => !c.builtin);
  const builtin = categories.filter((c) => c.builtin);
  const openEditor = (category: RuleCategory | null) => setEditor({ open: true, category });

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="flex max-h-[85vh] max-w-xl flex-col gap-0 overflow-hidden p-0">
          <DialogHeader className="space-y-1 border-b border-border px-6 py-4 text-left">
            <DialogTitle className="text-base">Rule categories</DialogTitle>
            <DialogDescription className="text-xs">
              A category groups rule types in “New rule” and gives new rules their defaults. It
              never changes what a rule checks.
            </DialogDescription>
          </DialogHeader>
          <div className="custom-scrollbar flex-1 space-y-5 overflow-y-auto px-6 py-5">
            <section className="space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-[10px] font-semibold tracking-wider text-muted-foreground uppercase">
                  Your categories ({custom.length})
                </p>
                <button
                  type="button"
                  onClick={() => openEditor(null)}
                  className="inline-flex items-center gap-1 rounded-lg bg-gradient-brand px-3 py-1.5 text-xs font-medium text-primary-foreground transition hover:opacity-90"
                >
                  <Plus className="size-3.5" /> New category
                </button>
              </div>
              {custom.length === 0 ? (
                <p className="rounded-lg border border-dashed border-border px-3 py-4 text-center text-xs text-muted-foreground">
                  None yet — create one to group rules by team, regulation or product.
                </p>
              ) : (
                custom.map((c) => <CategoryRow key={c.id} category={c} onOpen={openEditor} />)
              )}
            </section>
            <section className="space-y-2">
              <p className="text-[10px] font-semibold tracking-wider text-muted-foreground uppercase">
                Built-in ({builtin.length})
              </p>
              {builtin.map((c) => (
                <CategoryRow key={c.id} category={c} onOpen={openEditor} />
              ))}
            </section>
          </div>
        </DialogContent>
      </Dialog>
      <CategoryEditorDialog
        open={editor.open}
        category={editor.category}
        onOpenChange={(o) => setEditor((s) => ({ ...s, open: o }))}
      />
    </>
  );
}
