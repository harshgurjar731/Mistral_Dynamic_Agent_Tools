/** Display names and colours for industry knowledge — one place, used by every panel. */
import type {
  IndustryCategory,
  IndustryForce,
  IndustryNode,
  IndustryRelation,
} from "@/api/industry";

export const SELECT_CLASS =
  "h-9 rounded-md border border-input bg-background-elevated/70 px-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary disabled:opacity-50";

export const CATEGORY: Record<IndustryCategory, { label: string; tone: string; hint: string }> = {
  regulation: {
    label: "Regulation",
    tone: "border-red/25 bg-red/10 text-red",
    hint: "A legal or regulatory obligation. Reaches decomposition, oversight, guardrails, rules, design and code.",
  },
  standard: {
    label: "Standard",
    tone: "border-indigo/25 bg-indigo/10 text-indigo",
    hint: "An industry standard, data format or code list. Reaches data flow, design, tools and code.",
  },
  business_rule: {
    label: "Business rule",
    tone: "border-amber/25 bg-amber/10 text-amber",
    hint: "A rule, limit or threshold the industry applies. Reaches decomposition, rules, design and code.",
  },
  metric: {
    label: "Metric",
    tone: "border-cyan/25 bg-cyan/10 text-cyan",
    hint: "A KPI with its formula. Reaches decomposition, data flow, design and code.",
  },
  risk: {
    label: "Risk",
    tone: "border-pink/25 bg-pink/10 text-pink",
    hint: "A failure mode, fraud pattern or hazard. Reaches decomposition, oversight, guardrails and design.",
  },
  process: {
    label: "Typical process",
    tone: "border-emerald/25 bg-emerald/10 text-emerald",
    hint: "How the work is usually done across the industry. Reaches decomposition, topology and design.",
  },
  definition: {
    label: "Definition",
    tone: "border-border bg-muted/40 text-muted-foreground",
    hint: "A term and what it means here. Reaches instructions, design, data flow and code.",
  },
};

export const CATEGORY_ORDER: IndustryCategory[] = [
  "regulation",
  "business_rule",
  "standard",
  "metric",
  "risk",
  "process",
  "definition",
];

export const FORCE: Record<IndustryForce, { label: string; tone: string; hint: string }> = {
  must: {
    label: "Mandatory",
    tone: "border-red/30 bg-red/12 text-red",
    hint: "An obligation: every plan in scope must meet it.",
  },
  avoid: {
    label: "Prohibited",
    tone: "border-red/30 bg-red/12 text-red",
    hint: "Never done: every plan in scope must rule it out.",
  },
  should: {
    label: "Recommended",
    tone: "border-amber/30 bg-amber/10 text-amber",
    hint: "The industry's normal practice; followed unless the request says otherwise.",
  },
  may: {
    label: "Info",
    tone: "border-border bg-muted/30 text-muted-foreground",
    hint: "Background a plan may use.",
  },
};

export const FORCE_ORDER: IndustryForce[] = ["must", "avoid", "should", "may"];

export function forceOf(strength: string | null | undefined): IndustryForce {
  return strength === "must" || strength === "avoid" || strength === "should" ? strength : "may";
}

export const RELATION: Record<IndustryRelation, string> = {
  exact: "Filed here",
  inherited: "Inherited from above",
  narrower: "Filed below",
};

export const STATUS_TONE: Record<string, string> = {
  active: "border-emerald/25 bg-emerald/10 text-emerald",
  proposed: "border-amber/25 bg-amber/10 text-amber",
  conflicting: "border-red/25 bg-red/10 text-red",
  retired: "border-border bg-muted/30 text-muted-foreground",
};

export const STATUS_LABEL: Record<string, string> = {
  active: "Approved",
  proposed: "Waiting for review",
  conflicting: "Conflicting",
  retired: "Retired",
};

/** Industry › Domain › Subdomain labels for a node id. */
export function nodePath(nodes: Map<string, IndustryNode>, id: string | null | undefined): string {
  const chain: string[] = [];
  let cursor = id ?? null;
  const seen = new Set<string>();
  while (cursor && !seen.has(cursor)) {
    seen.add(cursor);
    const node = nodes.get(cursor);
    if (!node) break;
    chain.unshift(node.label);
    cursor = node.parent_id;
  }
  return chain.join(" › ");
}
