import { del, get, patch, post } from "./client";
import type { Agent, PaginatedAgents, RuleRef } from "@/types";

export interface AgentCreate {
  name: string;
  model: string;
  instructions: string;
  description?: string;
  tier?: string;
  tools?: unknown[];
  document_library_ids?: string[];
  connectors?: Agent["connectors"];
  /** Opt-in grounded retrieval over the knowledge graph. */
  knowledge_graph?: boolean;
  temperature?: number | null;
  top_p?: number | null;
  max_tokens?: number | null;
  random_seed?: number | null;
  frequency_penalty?: number | null;
  presence_penalty?: number | null;
  guardrails?: Agent["guardrails"];
  /** Optional agent rules; always-on rules apply without being listed. */
  rules?: RuleRef[];
}

export type AgentPatch = Partial<
  Pick<
    Agent,
    | "name"
    | "model"
    | "instructions"
    | "description"
    | "tier"
    | "temperature"
    | "top_p"
    | "max_tokens"
    | "random_seed"
    | "frequency_penalty"
    | "presence_penalty"
    | "tools"
    | "document_library_ids"
    | "connectors"
    | "guardrails"
  >
>;

/**
 * The forms edit one guardrail config; the API takes a list (mirroring Mistral,
 * which allows several). Omitted stays omitted, `null` clears, one becomes [one].
 */
function withGuardrailList<T extends { guardrails?: Agent["guardrails"] }>(body: T) {
  if (!("guardrails" in body)) return body;
  const { guardrails, ...rest } = body;
  return { ...rest, guardrails: guardrails ? [guardrails] : [] };
}

export const agentsApi = {
  list: (page = 0, pageSize = 20, sort?: string) =>
    get<PaginatedAgents>("/api/agents", { page, page_size: pageSize, ...(sort ? { sort } : {}) }),
  get: (id: string) => get<Agent>(`/api/agents/${id}`),
  create: (body: AgentCreate) => post<Agent>("/api/agents", withGuardrailList(body)),
  /** Omit `connectors` to keep them; send [] to detach all. */
  update: (id: string, body: AgentPatch) =>
    patch<Agent>(`/api/agents/${id}`, withGuardrailList(body)),
  remove: (id: string) => del<unknown>(`/api/agents/${id}`),
};
