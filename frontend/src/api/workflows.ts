import { api } from './client';
import axios from 'axios';

const API_BASE = import.meta.env.VITE_API_URL ?? '';

export const workflowsApi = {
  // ── CRUD ────────────────────────────────────────────────────────────────
  list:         () => api.get('/api/workflows'),
  get:          (name: string) => api.get(`/api/workflows/${name}`),
  create:       (body: object) => api.post('/api/workflows', body),
  archive:      (name: string) => api.put(`/api/workflows/${name}/archive`),
  unarchive:    (name: string) => api.put(`/api/workflows/${name}/unarchive`),

  // ── Execution ────────────────────────────────────────────────────────────
  // Starting a run lives here because it hangs off the workflow. Everything
  // that happens *to* a run afterwards — status, traces, control — is in
  // `api/executions.ts`, which mirrors the Mistral executions API.
  execute:        (name: string, body?: object) => api.post(`/api/workflows/${name}/execute`, body),
  getExecution:   (id: string) => api.get(`/api/workflows/executions/${id}`),
  listExecutions: (name: string) => api.get(`/api/workflows/${name}/executions`),
  metrics:        (name: string) => api.get(`/api/workflows/${name}/metrics`),

  // ── Registration / Export ────────────────────────────────────────────────
  register:        (name: string) => api.post(`/api/workflows/${name}/register`, {}),
  exportToMistral: (name: string) => api.post(`/api/workflows/${name}/export`, {}),

  // ── Signals (send user messages to running execution) ────────────────────
  // The API takes `name` / `input`; the older `signal_name` / `payload` spelling
  // was accepted at the HTTP layer but never reached the workflow handler.
  sendSignal: (executionId: string, signalName: string, payload?: object) =>
    api.post(`/api/workflows/executions/${executionId}/signals`, {
      name: signalName,
      input: payload ?? {},
    }),

  // ── Image upload ─────────────────────────────────────────────────────────
  uploadImage: (file: File) => {
    const formData = new FormData();
    formData.append('file', file);
    return axios.post(`${API_BASE}/api/uploads/image`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
  },

  // ── SSE stream helpers (returns URL string for use with createSSEStream) ──
  executionStreamUrl: (executionId: string) =>
    `/api/workflows/executions/${executionId}/stream`,
};

