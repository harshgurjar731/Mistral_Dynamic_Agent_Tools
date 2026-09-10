export interface SSEEvent {
  type: string;
  data: string;
}

/** Plain-string payload events — never JSON.parse these. */
export const STRING_EVENTS = new Set(["status", "text_chunk", "conversation_id", "error"]);

export function parseEventData<T>(e: SSEEvent): T | string {
  if (STRING_EVENTS.has(e.type)) return e.data;
  try {
    return JSON.parse(e.data) as T;
  } catch {
    return e.data;
  }
}

interface StreamOptions {
  method?: "GET" | "POST";
  body?: object | null;
  onEvent: (e: SSEEvent) => void;
  onDone?: () => void;
  onError?: (err: unknown) => void;
  onOpen?: () => void;
  signal?: AbortSignal;
}

/**
 * SSE reader built on fetch — works for both POST and GET streams and joins
 * multi-line `data:` frames with "\n" before the consumer parses them.
 */
export function createSSEStream(url: string, opts: StreamOptions): () => void {
  const ctrl = new AbortController();
  const sig = opts.signal ?? ctrl.signal;
  const method = opts.method ?? (opts.body ? "POST" : "GET");

  (async () => {
    const headers: Record<string, string> = { Accept: "text/event-stream" };
    if (method === "POST") headers["Content-Type"] = "application/json";
    if (typeof window !== "undefined") {
      const token = window.localStorage.getItem("auth_token");
      if (token) headers["Authorization"] = `Bearer ${token}`;
    }

    const res = await fetch(url, {
      method,
      headers,
      body: method === "POST" ? JSON.stringify(opts.body ?? {}) : null,
      signal: sig,
    });

    if (!res.ok) {
      let detail = `HTTP ${res.status}`;
      try {
        const text = await res.text();
        detail = text || detail;
      } catch {
        /* ignore */
      }
      throw new Error(detail);
    }

    opts.onOpen?.();

    const reader = res.body?.getReader();
    if (!reader) return;
    const decoder = new TextDecoder();

    let buffer = "";
    let eventType = "message";
    let dataBuffer: string[] = [];

    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        if (dataBuffer.length) opts.onEvent({ type: eventType, data: dataBuffer.join("\n") });
        opts.onDone?.();
        break;
      }
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const raw of lines) {
        const line = raw.replace(/\r$/, "");
        if (line === "") {
          if (dataBuffer.length) {
            opts.onEvent({ type: eventType, data: dataBuffer.join("\n") });
            dataBuffer = [];
          }
          eventType = "message";
        } else if (line.startsWith("event:")) {
          eventType = line.slice(6).trim();
        } else if (line.startsWith("data:")) {
          dataBuffer.push(line.startsWith("data: ") ? line.slice(6) : line.slice(5));
        }
      }
    }
  })().catch((e) => {
    if ((e as Error)?.name !== "AbortError") {
      console.error("SSE error", e);
      opts.onError?.(e);
    }
  });

  return () => ctrl.abort();
}

export type LiveState =
  | "idle"
  | "connecting"
  | "live"
  | "reconnecting"
  | "closed"
  | "disconnected"
  | "error";
