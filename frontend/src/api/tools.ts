import { api } from './client';

/** "tool" — an agent capability; "activity" — a standalone workflow step. Mutually exclusive. */
export type ToolPurpose = 'tool' | 'activity';

export const toolsApi = {
  list:        () => api.get('/api/tools'),
  listPending: () => api.get('/api/tools/pending'),
  approve:     (id: string) => api.post(`/api/tools/${id}/approve`),
  reject:      (id: string) => api.post(`/api/tools/${id}/reject`),
  getByHash:   (hash: string) => api.get(`/api/tools/by-hash/${hash}`),
  synthesize:  (task: string, purpose: ToolPurpose) => api.post('/api/tools/synthesize', { task, purpose }),
  delete:      (id: string | number) => api.delete(`/api/tools/${id}`),
  update:      (id: string | number, payload: { source_code: string; description: string; purpose?: ToolPurpose }) => api.put(`/api/tools/${id}`, payload),
};

