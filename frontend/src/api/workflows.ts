import { api } from './client';

export const workflowsApi = {
  // ── CRUD ────────────────────────────────────────────────────────────────
  list:         () => api.get('/api/workflows'),
  get:          (name: string) => api.get(`/api/workflows/${name}`),
  create:       (body: object) => api.post('/api/workflows', body),
  archive:      (name: string) => api.put(`/api/workflows/${name}/archive`),
  unarchive:    (name: string) => api.put(`/api/workflows/${name}/unarchive`),

  // ── Execution ────────────────────────────────────────────────────────────
  execute:        (name: string, body?: object) => api.post(`/api/workflows/${name}/execute`, body),
  getExecution:   (id: string) => api.get(`/api/workflows/executions/${id}`),
  listExecutions: (name: string) => api.get(`/api/workflows/${name}/executions`),

  // ── Registration / Export ────────────────────────────────────────────────
  register:        (name: string) => api.post(`/api/workflows/${name}/register`, {}),
  exportToMistral: (name: string) => api.post(`/api/workflows/${name}/export`, {}),

  // ── Signals (send user messages to running execution) ────────────────────
  sendSignal: (executionId: string, signalName: string, payload?: object) =>
    api.post(`/api/workflows/executions/${executionId}/signal`, {
      signal_name: signalName,
      payload: payload ?? {},
    }),

  // ── SSE stream helpers (returns URL string for use with createSSEStream) ──
  executionStreamUrl: (executionId: string) =>
    `/api/workflows/executions/${executionId}/stream`,
};
