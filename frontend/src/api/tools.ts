import { api } from './client';

export const toolsApi = {
  list:        () => api.get('/api/tools'),
  listPending: () => api.get('/api/tools/pending'),
  approve:     (id: string) => api.post(`/api/tools/${id}/approve`),
  reject:      (id: string) => api.post(`/api/tools/${id}/reject`),
  getByHash:   (hash: string) => api.get(`/api/tools/by-hash/${hash}`),
  synthesize:  (task: string) => api.post('/api/tools/synthesize', { task }),
  delete:      (id: string | number) => api.delete(`/api/tools/${id}`),
  update:      (id: string | number, payload: { source_code: string; description: string }) => api.put(`/api/tools/${id}`, payload),
};
