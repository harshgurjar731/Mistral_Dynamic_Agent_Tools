import { api } from './client';
import { createSSEStream, type SSEEvent } from './sse';

export interface OrchestratorRequest {
  query: string;
  agent_id?: string;
  conversation_id?: string;
  cleanup_agent?: boolean;
  workflow?: string;
  tier?: string;
}

export const orchestratorApi = {
  run: (body: OrchestratorRequest) =>
    api.post('/api/orchestrate', body),

  stream: (
    body: OrchestratorRequest,
    onEvent: (e: SSEEvent) => void,
    onDone?: () => void,
    signal?: AbortSignal
  ) => createSSEStream('/api/orchestrate/stream', body, onEvent, onDone, signal),

  chatCompletion: (body: object) => api.post('/api/chat/completions', body),

  chatStream: (body: object, onEvent: (e: SSEEvent) => void, onDone?: () => void, signal?: AbortSignal) =>
    createSSEStream('/api/chat/stream', body, onEvent, onDone, signal),
};
