import { useCallback, useEffect, useRef, useState } from 'react';
import {
  executionsApi,
  isTerminal,
  type ExecutionDetail,
  type ExecutionStep,
  type LogLine,
} from '../../../api/executions';

const API_BASE = import.meta.env.VITE_API_URL ?? '';

/** A custom event published by the workflow itself over its own stream. */
export interface WorkflowEvent {
  id?: string | null;
  event?: string | null;
  data?: unknown;
  receivedAt: number;
}

export type StreamPhase = 'idle' | 'connecting' | 'live' | 'reconnecting' | 'closed' | 'error';

export interface ExecutionStreamState {
  detail: ExecutionDetail | null;
  steps: ExecutionStep[];
  events: WorkflowEvent[];
  /** The engine's live narration of the run, in arrival order. */
  logs: LogLine[];
  phase: StreamPhase;
  error: string | null;
  /** Server-confirmed terminal status, set when the `done` frame arrives. */
  finalStatus: string | null;
  /** Force a fresh connection — used by the retry affordance. */
  reconnect: () => void;
}

const MAX_RETRIES = 6;
const MAX_EVENTS = 500;
const MAX_LOGS = 2000;

/**
 * Follow a workflow execution over SSE.
 *
 * The backend stream carries three things: `execution_update` frames with the
 * whole normalised execution (status, result, per-step progress),
 * `workflow_event` frames for anything the workflow published itself, and a
 * final `done`. A dropped connection is retried with backoff — but only while
 * the execution is still live, since reconnecting to a finished run would just
 * replay the same terminal frame forever.
 *
 * Passing a null id keeps the hook inert, so a component can mount before an
 * execution exists.
 */
export function useExecutionStream(executionId: string | null): ExecutionStreamState {
  const [detail, setDetail] = useState<ExecutionDetail | null>(null);
  const [events, setEvents] = useState<WorkflowEvent[]>([]);
  const [logs, setLogs] = useState<LogLine[]>([]);
  const [phase, setPhase] = useState<StreamPhase>('idle');
  const [error, setError] = useState<string | null>(null);
  const [finalStatus, setFinalStatus] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  const abortRef = useRef<AbortController | null>(null);
  // Retry count lives in a ref so a reconnect does not re-run the effect and
  // restart the very connection it is counting failures for.
  const retriesRef = useRef(0);
  const doneRef = useRef(false);

  const reconnect = useCallback(() => {
    retriesRef.current = 0;
    doneRef.current = false;
    setError(null);
    setNonce((n) => n + 1);
  }, []);

  useEffect(() => {
    if (!executionId) {
      setPhase('idle');
      return;
    }

    let cancelled = false;
    doneRef.current = false;
    setPhase('connecting');

    const handleFrame = (type: string, raw: string) => {
      if (cancelled) return;
      let payload: any;
      try {
        payload = JSON.parse(raw);
      } catch {
        return;
      }

      switch (type) {
        case 'execution_update':
          setDetail(payload as ExecutionDetail);
          setPhase('live');
          retriesRef.current = 0;
          break;
        case 'log':
          setLogs((prev) => {
            // A reconnect replays from seq 0, so lines already held would
            // duplicate. Keying on seq keeps the tail stable across retries.
            const seen = new Set(prev.map((line) => line.seq));
            const incoming = (payload.lines as LogLine[]).filter((l) => !seen.has(l.seq));
            if (!incoming.length) return prev;
            const next = [...prev, ...incoming];
            return next.length > MAX_LOGS ? next.slice(-MAX_LOGS) : next;
          });
          break;
        case 'workflow_event':
          setEvents((prev) => {
            const next = [...prev, { ...payload, receivedAt: Date.now() }];
            // Bound the buffer — a chatty workflow can emit thousands and the
            // log view only ever shows the tail.
            return next.length > MAX_EVENTS ? next.slice(-MAX_EVENTS) : next;
          });
          break;
        case 'done':
          doneRef.current = true;
          setFinalStatus(String(payload.status ?? '').toUpperCase());
          setPhase('closed');
          break;
        case 'error':
          setError(String(payload.detail ?? payload.error ?? 'Stream error'));
          break;
        case 'ping':
        default:
          break;
      }
    };

    const run = async () => {
      while (!cancelled && !doneRef.current && retriesRef.current <= MAX_RETRIES) {
        const controller = new AbortController();
        abortRef.current = controller;

        try {
          const response = await fetch(
            `${API_BASE}${executionsApi.streamUrl(executionId)}`,
            { signal: controller.signal, headers: { Accept: 'text/event-stream' } },
          );

          if (!response.ok || !response.body) {
            throw new Error(`Stream responded ${response.status}`);
          }

          setPhase('live');
          const reader = response.body.getReader();
          const decoder = new TextDecoder();
          let buffer = '';
          let eventType = 'message';
          let dataLines: string[] = [];

          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() ?? '';

            for (const rawLine of lines) {
              const line = rawLine.replace(/\r$/, '');
              if (line === '') {
                if (dataLines.length) {
                  handleFrame(eventType, dataLines.join('\n'));
                  dataLines = [];
                }
                eventType = 'message';
              } else if (line.startsWith('event:')) {
                eventType = line.slice(6).trim();
              } else if (line.startsWith('data:')) {
                dataLines.push(line.startsWith('data: ') ? line.slice(6) : line.slice(5));
              }
            }
          }
        } catch (e) {
          if (cancelled || (e as Error).name === 'AbortError') return;
          retriesRef.current += 1;
        }

        if (cancelled || doneRef.current) return;

        // The stream closed without a `done`. If the execution has since
        // finished, settle from a one-shot read rather than reconnecting.
        try {
          const { data } = await executionsApi.get(executionId);
          if (cancelled) return;
          setDetail(data);
          if (isTerminal(data.status)) {
            setFinalStatus(data.status.toUpperCase());
            setPhase('closed');
            return;
          }
        } catch {
          retriesRef.current += 1;
        }

        retriesRef.current += 1;
        if (retriesRef.current > MAX_RETRIES) break;

        setPhase('reconnecting');
        await new Promise((resolve) =>
          setTimeout(resolve, Math.min(1000 * 2 ** (retriesRef.current - 1), 15_000)),
        );
      }

      if (!cancelled && !doneRef.current) {
        setPhase('error');
        setError('Lost connection to the execution stream.');
      }
    };

    void run();

    return () => {
      cancelled = true;
      abortRef.current?.abort();
    };
  }, [executionId, nonce]);

  return {
    detail,
    steps: detail?.steps ?? [],
    events,
    logs,
    phase,
    error,
    finalStatus,
    reconnect,
  };
}
