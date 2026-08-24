import { api } from './client';
import type { ConnectorRef } from './connectors';

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
  created_at?: string;
  temperature?: number | null;
  top_p?: number | null;
  max_tokens?: number | null;
  random_seed?: number | null;
  frequency_penalty?: number | null;
  presence_penalty?: number | null;
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
