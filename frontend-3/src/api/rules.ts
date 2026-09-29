import { del, get, patch, post, put } from "./client";
import type {
  AgentRuleActivity,
  AgentRuleEntry,
  Rule,
  RuleCategory,
  RuleEnforcement,
  RuleEvent,
  RuleOutcome,
  RuleRef,
  RuleScope,
  RuleSuggestion,
  RuleType,
  WorkflowDefinition,
} from "@/types";

export interface RuleCreate {
  type: string;
  name: string;
  description?: string;
  params?: Record<string, unknown>;
  enforcement?: RuleEnforcement;
  always_on?: boolean;
  enabled?: boolean;
  category?: string | undefined;
  targets?: string[] | undefined;
}

export interface CategoryBody {
  name?: string;
  description?: string;
  color?: string;
  icon?: string;
  scope?: string;
  rule_types?: string[];
  /** "" clears back to the rule type's own default. */
  default_enforcement?: string;
  default_applies?: string;
}

export interface RuleSuggestBody {
  scope: RuleScope;
  name?: string;
  description?: string;
  instructions?: string;
  tier?: string;
  model?: string;
  tools?: unknown[];
  connectors?: unknown[];
  definition?: WorkflowDefinition;
}

const enc = encodeURIComponent;

export const rulesApi = {
  types: (scope?: RuleScope) =>
    get<{ types: RuleType[]; checkpoints: Record<string, string> }>(
      "/api/rules/types",
      scope ? { scope } : {},
    ),
  list: (scope?: RuleScope) =>
    get<{ rules: Rule[]; count: number }>("/api/rules", scope ? { scope } : {}),
  create: (body: RuleCreate) => post<Rule>("/api/rules", body),
  update: (id: string, body: Partial<RuleCreate>) => patch<Rule>(`/api/rules/${enc(id)}`, body),
  remove: (id: string) => del<{ deleted: string }>(`/api/rules/${enc(id)}`),
  restore: (id: string) => post<Rule>(`/api/rules/${enc(id)}/restore`),

  categories: () => get<{ categories: RuleCategory[] }>("/api/rules/categories"),
  createCategory: (body: CategoryBody & { name: string }) =>
    post<RuleCategory>("/api/rules/categories", body),
  updateCategory: (id: string, body: CategoryBody) =>
    patch<RuleCategory>(`/api/rules/categories/${enc(id)}`, body),
  removeCategory: (id: string) =>
    del<{ deleted: string; rules_moved: number }>(`/api/rules/categories/${enc(id)}`),

  agentRules: (agentId: string) =>
    get<{ rules: AgentRuleEntry[]; selectable: Rule[] }>(`/api/rules/agents/${enc(agentId)}`),
  /** Replace an agent's optional rules; fix rules are applied to the live agent. */
  setAgentRules: (agentId: string, rules: RuleRef[]) =>
    put<{ rules: AgentRuleEntry[]; outcomes: RuleOutcome[] }>(`/api/rules/agents/${enc(agentId)}`, {
      rules,
    }),
  agentActivity: (agentId: string) =>
    get<{ activity: AgentRuleActivity[]; recent_blocks: RuleEvent[] }>(
      `/api/rules/agents/${enc(agentId)}/activity`,
    ),
  workflowRules: (name: string) =>
    get<{ rules: AgentRuleEntry[]; events: RuleEvent[] }>(`/api/rules/workflows/${enc(name)}`),
  events: (params: {
    scope?: RuleScope;
    subject_id?: string;
    rule_id?: string;
    outcome?: string;
    include_passed?: boolean;
    limit?: number;
  }) => get<{ events: RuleEvent[]; count: number }>("/api/rules/events", params),
  /** LLM pick of optional rules, for manual creation. */
  suggest: (body: RuleSuggestBody) =>
    post<{ selected: RuleSuggestion[]; reasoning: string; decided: boolean }>(
      "/api/rules/suggest",
      body,
    ),
};
