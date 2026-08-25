import { useCallback, useEffect, useRef, useState } from "react";
import { createSSEStream, parseEventData, type SSEEvent } from "@/api/sse";
import type { LiveState } from "@/api/sse";
import { isTerminal } from "@/types";
import type { ExecutionDetail, ExecutionStep } from "@/types";

const MAX_RETRIES = 6;
const MAX_EVENTS = 500;
const MAX_LOGS = 2000;

export interface ExecutionMonitorState {
  detail: ExecutionDetail | null;
  steps: ExecutionStep[];
  events: Array<{ type: string; data: unknown; ts: number }>;
  logs: string[];
  phase: LiveState;
  error: string | null;
  finalStatus: string | null;
  reconnect: () => void;
}

export function useExecutionStream(executionId: string | null): ExecutionMonitorState {
  const [detail, setDetail] = useState<ExecutionDetail | null>(null);
  const [events, setEvents] = useState<Array<{ type: string; data: unknown; ts: number }>>([]);
  const [phase, setPhase] = useState<LiveState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [finalStatus, setFinalStatus] = useState<string | null>(null);
  const [reconnectTick, setReconnectTick] = useState(0);

  const retriesRef = useRef(0);
  const doneRef = useRef(false);
  const stopRef = useRef<null | (() => void)>(null);

  const reconnect = useCallback(() => {
    retriesRef.current = 0;
    doneRef.current = false;
    setFinalStatus(null);
    setReconnectTick((t) => t + 1);
  }, []);

  useEffect(() => {
    if (!executionId) {
      setPhase("idle");
      return;
    }
    doneRef.current = false;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    function connect() {
      if (cancelled || doneRef.current) return;
      setPhase(retriesRef.current > 0 ? "reconnecting" : "connecting");
      const stop = createSSEStream(`/api/workflows/executions/${executionId}/stream`, {
        method: "GET",
        onOpen: () => {
          if (!cancelled) {
            setPhase("live");
            retriesRef.current = 0;
          }
        },
        onEvent: (e: SSEEvent) => {
          if (cancelled) return;
          if (e.type === "execution_update") {
            const parsed = parseEventData<ExecutionDetail>(e);
            if (typeof parsed !== "string") setDetail(parsed);
          } else if (e.type === "workflow_event") {
            const parsed = parseEventData<unknown>(e);
            setEvents((prev) => [...prev.slice(-(MAX_EVENTS - 1)), { type: e.type, data: parsed, ts: Date.now() }]);
          } else if (e.type === "ping") {
            /* keep-alive */
          } else if (e.type === "error") {
            setError(e.data);
          } else if (e.type === "done") {
            doneRef.current = true;
            setPhase("closed");
            const parsed = parseEventData<{ status?: string }>(e);
            const status =
              typeof parsed === "string" ? parsed : (parsed?.status ?? null);
            setFinalStatus(status ?? "COMPLETED");
          }
        },
        onDone: () => {
          if (cancelled) return;
          if (doneRef.current) {
            setPhase("closed");
            return;
          }
          const terminal = detail ? isTerminal(detail.status) : false;
          if (terminal) {
            setPhase("closed");
            return;
          }
          if (retriesRef.current >= MAX_RETRIES) {
            setPhase("disconnected");
            return;
          }
          retriesRef.current += 1;
          const backoff = Math.min(1000 * 2 ** retriesRef.current, 20_000);
          setPhase("reconnecting");
          timer = setTimeout(connect, backoff);
        },
        onError: () => {
          if (cancelled) return;
          if (retriesRef.current >= MAX_RETRIES) {
            setPhase("disconnected");
          }
        },
      });
      stopRef.current = stop;
    }

    connect();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      stopRef.current?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [executionId, reconnectTick]);

  const steps = detail?.steps?.slice(0, MAX_LOGS) ?? [];

  return { detail, steps, events, logs: [], phase, error, finalStatus, reconnect };
}
