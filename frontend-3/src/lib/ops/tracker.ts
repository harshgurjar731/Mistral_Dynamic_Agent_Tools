/**
 * Live progress for every API request the app makes through axios.
 *
 * Each request is tagged with an `X-Op-Id`. The bytes it sends and receives
 * are counted as they move. If it is still waiting a moment later, the
 * server's progress feed for that id is opened (`/api/ops/{id}/events`), and
 * whatever the request is doing there — stages, pipeline layers, tool and
 * model calls, log lines — arrives as it happens. Quick requests finish before
 * the feed is ever opened and cost nothing beyond the header.
 *
 * Reads are tracked too, but stay out of the store unless they are slow: a
 * page that polls must not re-render the activity UI every second.
 */
import type { AxiosInstance, InternalAxiosRequestConfig } from "axios";
import { api, errorMessage } from "@/api/client";
import { createSSEStream, type SSEEvent } from "@/api/sse";
import { useOpsStore, type OpLayer, type OpStep, type TrackedOp } from "@/stores/ops";
import { describeRequest } from "./describe";

/** An action still waiting after this long opens its progress feed. */
const FOLLOW_ACTION_AFTER_MS = 300;
/** A read still waiting after this long is shown, and its feed opened. */
const FOLLOW_READ_AFTER_MS = 1200;
/** How long a finished action stays in view. */
const LINGER_OK_MS = 2500;
const LINGER_FAILED_MS = 8000;
const MAX_STEPS = 60;

const OP_ID = Symbol("opId");
type TaggedConfig = InternalAxiosRequestConfig & { [OP_ID]?: string };

interface Pending {
  method: string;
  url: string;
  startedAt: number;
  timer: ReturnType<typeof setTimeout> | null;
  close: (() => void) | null;
  lastSeq: number;
  /** In the store (always for actions; for reads, once they turned slow). */
  shown: boolean;
}

const pending = new Map<string, Pending>();

const newId = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID().replace(/-/g, "")
    : `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`;

const store = () => useOpsStore.getState();

function show(id: string, p: Pending) {
  if (p.shown) return;
  p.shown = true;
  const op: TrackedOp = {
    id,
    method: p.method,
    url: p.url,
    label: describeRequest(p.method, p.url),
    background: p.method === "GET",
    startedAt: p.startedAt,
    status: "pending",
    steps: [],
    layers: [],
    live: false,
  };
  store().add(op);
}

/* ── The server's feed ────────────────────────────────────────────────── */

function parse(e: SSEEvent): unknown {
  try {
    return JSON.parse(e.data);
  } catch {
    return e.data;
  }
}

function applyEvent(op: TrackedOp, e: SSEEvent): Partial<TrackedOp> | null {
  const data = parse(e);
  switch (e.type) {
    case "stage": {
      const stage = data as NonNullable<TrackedOp["stage"]>;
      return {
        stage,
        ...(typeof stage.total === "number"
          ? { measured: { done: stage.done ?? 0, total: stage.total } }
          : {}),
      };
    }
    case "note":
    case "status":
      return typeof data === "string" ? { note: data } : null;
    case "log": {
      const message = (data as { message?: string })?.message;
      return message ? { note: message } : null;
    }
    case "pipeline": {
      type Manifest = { name?: unknown; label?: unknown; hidden?: boolean } | null;
      const layers: OpLayer[] = ((data as { layers?: Manifest[] })?.layers ?? [])
        .filter((l): l is NonNullable<Manifest> => !!l && !l.hidden)
        .map((l) => ({ name: String(l.name), label: String(l.label ?? l.name), state: "pending" }));
      return { layers };
    }
    case "layer": {
      const { name, state, ms } = data as { name: string; state: OpLayer["state"]; ms?: number };
      if (!op.layers.some((l) => l.name === name)) return null;
      return { layers: op.layers.map((l) => (l.name === name ? { ...l, state, ms } : l)) };
    }
    case "step": {
      const s = data as Partial<OpStep> & { id: number };
      if (s.state === "active") {
        const step: OpStep = {
          id: s.id,
          kind: s.kind ?? "stage",
          name: s.name ?? "",
          state: "active",
        };
        return { steps: [...op.steps, step].slice(-MAX_STEPS) };
      }
      return {
        steps: op.steps.map((x) =>
          x.id === s.id ? { ...x, state: s.state ?? "completed", ms: s.ms, error: s.error } : x,
        ),
      };
    }
    case "op_end": {
      const end = data as { status?: string; error?: string };
      return end?.status === "failed" && end.error ? { error: end.error } : null;
    }
    default:
      return null;
  }
}

function follow(id: string, p: Pending) {
  if (p.close) return;
  p.close = createSSEStream(`/api/ops/${id}/events?after=${p.lastSeq}`, {
    method: "GET",
    onOpen: () => store().patch(id, () => ({ live: true })),
    onEvent: (e) => {
      if (e.id !== undefined) {
        if (e.id <= p.lastSeq) return;
        p.lastSeq = e.id;
      }
      store().patch(id, (op) => applyEvent(op, e) ?? {});
    },
    onDone: () => {
      p.close = null;
      store().patch(id, () => ({ live: false }));
    },
    onError: () => {
      p.close = null;
      store().patch(id, () => ({ live: false }));
    },
  });
}

/* ── Requests ─────────────────────────────────────────────────────────── */

function begin(config: TaggedConfig): TaggedConfig {
  const url = config.url ?? "";
  if (typeof window === "undefined" || !url.startsWith("/api/") || url.startsWith("/api/ops/")) {
    return config;
  }
  const id = newId();
  const method = (config.method ?? "get").toUpperCase();
  config[OP_ID] = id;
  config.headers.set("X-Op-Id", id);

  const p: Pending = {
    method,
    url,
    startedAt: Date.now(),
    timer: null,
    close: null,
    lastSeq: 0,
    shown: false,
  };
  pending.set(id, p);
  const isRead = method === "GET";
  if (!isRead) show(id, p);
  p.timer = setTimeout(
    () => {
      p.timer = null;
      if (!pending.has(id)) return;
      show(id, p);
      follow(id, p);
    },
    isRead ? FOLLOW_READ_AFTER_MS : FOLLOW_ACTION_AFTER_MS,
  );

  const onUpload = config.onUploadProgress;
  config.onUploadProgress = (e) => {
    if (e.total && p.shown) {
      store().patch(id, () => ({ upload: { loaded: e.loaded, total: e.total ?? 0 } }));
    }
    onUpload?.(e);
  };
  const onDownload = config.onDownloadProgress;
  config.onDownloadProgress = (e) => {
    if (p.shown) {
      store().patch(id, () => ({ download: { loaded: e.loaded, total: e.total ?? 0 } }));
    }
    onDownload?.(e);
  };
  return config;
}

function finish(config: TaggedConfig | undefined, error?: unknown) {
  const id = config?.[OP_ID];
  if (!id) return;
  const p = pending.get(id);
  if (!p) return;
  pending.delete(id);
  if (p.timer) clearTimeout(p.timer);
  if (!p.shown) return;

  if (p.method === "GET") {
    p.close?.();
    store().remove(id);
    return;
  }
  const failed = error !== undefined;
  store().patch(id, (op) => ({
    status: failed ? "failed" : "completed",
    finishedAt: Date.now(),
    error: failed ? errorMessage(error) : undefined,
    // A finished request has done everything it was going to.
    layers: op.layers.map((l) =>
      l.state === "pending" || l.state === "active"
        ? { ...l, state: failed ? l.state : "completed" }
        : l,
    ),
  }));
  // The feed closes itself on `op_end`; this only covers a feed that never did.
  setTimeout(() => p.close?.(), 3000);
  setTimeout(() => store().remove(id), failed ? LINGER_FAILED_MS : LINGER_OK_MS);
}

let installed = false;

/** Track every request made through `instance`. Idempotent. */
export function installOpTracking(instance: AxiosInstance = api) {
  if (installed || typeof window === "undefined") return;
  installed = true;
  instance.interceptors.request.use((config) => begin(config as TaggedConfig));
  instance.interceptors.response.use(
    (res) => {
      finish(res.config as TaggedConfig);
      return res;
    },
    (err: { config?: TaggedConfig }) => {
      finish(err?.config, err ?? new Error("Request failed"));
      return Promise.reject(err);
    },
  );
}
