/**
 * Data behind rule categories and targeting, shared by the create modal, the
 * rule page and the rules list.
 */
import { useQuery } from "@tanstack/react-query";
import { agentsApi, QK, rulesApi, workflowsApi } from "@/api";
import type { Rule, RuleApplies, RuleCategory, RuleScope } from "@/types";

/** Written out in full so Tailwind sees every class. */
export const CATEGORY_TONE: Record<string, { chip: string; dot: string; swatch: string }> = {
  red: { chip: "border-red/30 bg-red/10 text-red", dot: "bg-red", swatch: "bg-red" },
  amber: { chip: "border-amber/30 bg-amber/10 text-amber", dot: "bg-amber", swatch: "bg-amber" },
  emerald: {
    chip: "border-emerald/30 bg-emerald/10 text-emerald",
    dot: "bg-emerald",
    swatch: "bg-emerald",
  },
  cyan: { chip: "border-cyan/30 bg-cyan/10 text-cyan", dot: "bg-cyan", swatch: "bg-cyan" },
  blue: { chip: "border-blue/30 bg-blue/10 text-blue", dot: "bg-blue", swatch: "bg-blue" },
  indigo: {
    chip: "border-indigo/30 bg-indigo/10 text-indigo",
    dot: "bg-indigo",
    swatch: "bg-indigo",
  },
  purple: {
    chip: "border-purple/30 bg-purple/10 text-purple",
    dot: "bg-purple",
    swatch: "bg-purple",
  },
  pink: { chip: "border-pink/30 bg-pink/10 text-pink", dot: "bg-pink", swatch: "bg-pink" },
  orange: {
    chip: "border-orange/30 bg-orange/10 text-orange",
    dot: "bg-orange",
    swatch: "bg-orange",
  },
  slate: { chip: "border-slate/30 bg-slate/10 text-slate", dot: "bg-slate", swatch: "bg-slate" },
};

export const CATEGORY_COLORS = Object.keys(CATEGORY_TONE);

export type CategoryScope = "agent" | "workflow" | "both";

/** Icons offered when creating a category. */
export const CATEGORY_ICON_CHOICES = [
  "Tag",
  "Flag",
  "Scale",
  "Briefcase",
  "Building2",
  "Globe",
  "Bookmark",
  "Star",
];

export const toneFor = (color: string | undefined) =>
  CATEGORY_TONE[color ?? "slate"] ?? CATEGORY_TONE["slate"]!;

export function useRuleCategories() {
  const query = useQuery({ queryKey: QK.ruleCategories(), queryFn: () => rulesApi.categories() });
  const categories: RuleCategory[] = query.data?.categories ?? [];
  const byId = Object.fromEntries(categories.map((c) => [c.id, c])) as Record<string, RuleCategory>;
  return { categories, byId, isLoading: query.isLoading };
}

export interface TargetOption {
  id: string;
  name: string;
  hint?: string | undefined;
}

/** Agents or workflows a rule can be pointed at. */
export function useTargetOptions(scope: RuleScope, enabled = true) {
  const agents = useQuery({
    queryKey: QK.agentsPage(0, 100),
    queryFn: () => agentsApi.list(0, 100),
    enabled: enabled && scope === "agent",
  });
  const workflows = useQuery({
    queryKey: QK.workflows(),
    queryFn: workflowsApi.list,
    enabled: enabled && scope === "workflow",
  });
  const options: TargetOption[] =
    scope === "agent"
      ? (agents.data?.items ?? []).map((a) => ({
          id: a.id,
          name: a.name || a.id,
          hint: a.tier ?? a.model,
        }))
      : (workflows.data?.workflows ?? [])
          .filter((w) => !w.archived)
          .map((w) => ({ id: w.name, name: w.name, hint: `${w.steps?.length ?? 0} steps` }));
  return {
    options,
    isLoading: scope === "agent" ? agents.isLoading : workflows.isLoading,
  };
}

/** Turn the picker's state into the fields the API stores. */
export function appliesToFields(applies: RuleApplies, targets: string[]) {
  return {
    always_on: applies === "always",
    targets: applies === "targeted" ? targets : [],
  };
}

/** A rule's current "Apply to" state, including rules saved before targeting existed. */
export function appliesOf(rule: Pick<Rule, "always_on" | "targets" | "applies">): RuleApplies {
  if (rule.applies) return rule.applies;
  if (rule.always_on) return "always";
  return rule.targets?.length ? "targeted" : "ai";
}
