import { api } from './client';
import { createSSEStream, type SSEEvent } from './sse';

export const chatApi = {
  completion: (body: object) => api.post('/api/chat/completions', body),
  stream: (body: object, onEvent: (e: SSEEvent) => void, onDone?: () => void, signal?: AbortSignal) =>
    createSSEStream('/api/chat/stream', body, onEvent, onDone, signal),
};
