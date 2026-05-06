import { api } from './client';

export const conversationsApi = {
  list:    () => api.get('/api/conversations'),
  get:     (id: string) => api.get(`/api/conversations/${id}`),
  history: (id: string) => api.get(`/api/conversations/${id}/history`),
  delete:  (id: string) => api.delete(`/api/conversations/${id}`),
};
