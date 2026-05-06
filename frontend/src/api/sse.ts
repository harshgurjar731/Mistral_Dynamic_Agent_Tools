export interface SSEEvent {
  type: string;
  data: string;
}

export function createSSEStream(
  url: string,
  body: object,
  onEvent: (event: SSEEvent) => void,
  onDone?: () => void,
  signal?: AbortSignal
): () => void {
  const ctrl = new AbortController();
  const combinedSignal = signal ?? ctrl.signal;

  (async () => {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: combinedSignal,
    });

    const reader = res.body?.getReader();
    if (!reader) return;
    const decoder = new TextDecoder();

    let buffer = '';
    let eventType = 'message';
    let dataBuffer: string[] = [];

    // eslint-disable-next-line no-constant-condition
    while (true) {
      const { done, value } = await reader.read();
      if (done) { 
        if (dataBuffer.length > 0) {
          onEvent({ type: eventType, data: dataBuffer.join('\n') });
        }
        onDone?.(); 
        break; 
      }
      buffer += decoder.decode(value, { stream: true });

      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        const cleanLine = line.replace(/\r$/, '');
        if (cleanLine === '') {
          if (dataBuffer.length > 0) {
            onEvent({ type: eventType, data: dataBuffer.join('\n') });
            dataBuffer = [];
          }
          eventType = 'message';
        } else if (cleanLine.startsWith('event:')) {
          eventType = cleanLine.slice(6).trim();
        } else if (cleanLine.startsWith('data:')) {
          dataBuffer.push(cleanLine.startsWith('data: ') ? cleanLine.slice(6) : cleanLine.slice(5));
        }
      }
    }
  })().catch((e) => {
    if (e.name !== 'AbortError') console.error('SSE error', e);
  });

  return () => ctrl.abort();
}
