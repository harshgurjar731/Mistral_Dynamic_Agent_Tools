import { api } from './client';
import type { ConnectorRef } from './connectors';

/**
 * Per-category moderation thresholds (0-1, higher = more permissive).
 * `dangerous_and_criminal_content` only exists on the v1 moderation model;
 * `dangerous`, `criminal` and `jailbreaking` only exist on v2.
 */
export interface GuardrailCategoryThresholds {
  sexual?: number | null;
  hate_and_discrimination?: number | null;
  violence_and_threats?: number | null;
  dangerous?: number | null;
  criminal?: number | null;
  dangerous_and_criminal_content?: number | null;
  selfharm?: number | null;
  health?: number | null;
  financial?: number | null;
  law?: number | null;
  pii?: number | null;
  jailbreaking?: number | null;
}

export interface GuardrailModerationConfig {
  model_name?: string | null;
  custom_category_thresholds?: GuardrailCategoryThresholds | null;
  ignore_other_categories?: boolean;
  action?: 'none' | 'block' | null;
}

export interface GuardrailConfig {
  block_on_error?: boolean;
  moderation_llm_v1?: GuardrailModerationConfig | null;
  moderation_llm_v2?: GuardrailModerationConfig | null;
}

export interface Agent {
  id: string;
  name: string;
  model: string;
  description?: string;
  instructions?: string;
  tools?: unknown[];
  /**
   * Connectors attached to this agent, read back off its `tools` array.
   * Omitting the field on update keeps them; sending [] detaches them all.
   */
  connectors?: ConnectorRef[];
  tier?: string;
  /**
   * Platform-owned: the backend refuses to delete it (403).
   *
   * Currently just the query optimiser, which every graph retrieval passes
   * through. Surfaced on the listing so the UI can hide the control rather
   * than let someone discover the rule by hitting an error.
   */
  protected?: boolean;
  /**
   * Whether this agent may search the knowledge graph and curated industry
   * knowledge. Opt-in per agent — the tool being attached *is* the setting.
   */
  knowledge_graph?: boolean;
  created_at?: string;
  temperature?: number | null;
  top_p?: number | null;
  max_tokens?: number | null;
  random_seed?: number | null;
  frequency_penalty?: number | null;
  presence_penalty?: number | null;
  /**
   * Content-moderation policy. At most one entry in practice — the array
   * shape mirrors the Mistral API, which allows several, but nothing scopes
   * multiple entries differently.
   */
  guardrails?: GuardrailConfig[] | null;
}

export interface PaginatedAgents {
  items: Agent[];
  page: number;
  page_size: number;
  total_pages: number;
  count: number;
}

export const agentsApi = {
  list:   (page = 0, page_size = 20) =>
    api.get<PaginatedAgents>('/api/agents', { params: { page, page_size } }),
  get:    (id: string)  => api.get<Agent>(`/api/agents/${id}`),
  create: (body: Partial<Agent>) => api.post<Agent>('/api/agents', body),
  update: (id: string, body: Partial<Agent>) => api.patch<Agent>(`/api/agents/${id}`, body),
  delete: (id: string)  => api.delete(`/api/agents/${id}`),
};
