import { del, get, patch, post } from "./client";
import type { Agent, PaginatedAgents } from "@/types";

export interface AgentCreate {
  name: string;
  model: string;
  instructions: string;
  description?: string;
  tier?: string;
  tools?: unknown[];
  document_library_ids?: string[];
  connectors?: Agent["connectors"];
  temperature?: number | null;
  top_p?: number | null;
  max_tokens?: number | null;
  random_seed?: number | null;
  frequency_penalty?: number | null;
  presence_penalty?: number | null;
  guardrails?: Agent["guardrails"];
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

export const agentsApi = {
  list: (page = 0, pageSize = 20) =>
    get<PaginatedAgents>("/api/agents", { page, page_size: pageSize }),
  get: (id: string) => get<Agent>(`/api/agents/${id}`),
  create: (body: AgentCreate) => post<Agent>("/api/agents", body),
  /** Omit `connectors` to keep them; send [] to detach all. */
  update: (id: string, body: AgentPatch) => patch<Agent>(`/api/agents/${id}`, body),
  remove: (id: string) => del<unknown>(`/api/agents/${id}`),
};
