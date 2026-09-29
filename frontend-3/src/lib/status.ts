import type { StepType, ToolSource } from "@/types";

export interface StatusIdentity {
  label: string;
  /** Tailwind text color class using semantic tokens. */
  text: string;
  bg: string;
  border: string;
  pulse?: boolean;
}

export const EXECUTION_STATUS_IDENTITY: Record<string, StatusIdentity> = {
  PENDING: {
    label: "Pending",
    text: "text-muted-foreground",
    bg: "bg-muted/40",
    border: "border-border",
  },
  RUNNING: {
    label: "Running",
    text: "text-blue",
    bg: "bg-blue/10",
    border: "border-blue/30",
    pulse: true,
  },
  RETRYING_AFTER_ERROR: {
    label: "Retrying",
    text: "text-amber",
    bg: "bg-amber/10",
    border: "border-amber/30",
    pulse: true,
  },
  COMPLETED: {
    label: "Completed",
    text: "text-emerald",
    bg: "bg-emerald/10",
    border: "border-emerald/30",
  },
  FAILED: { label: "Failed", text: "text-red", bg: "bg-red/10", border: "border-red/30" },
  CANCELLED: {
    label: "Cancelled",
    text: "text-slate",
    bg: "bg-slate/10",
    border: "border-slate/30",
  },
  TERMINATED: {
    label: "Terminated",
    text: "text-orange",
    bg: "bg-orange/10",
    border: "border-orange/30",
  },
  TIMED_OUT: {
    label: "Timed out",
    text: "text-orange",
    bg: "bg-orange/10",
    border: "border-orange/30",
  },
  CONTINUED_AS_NEW: {
    label: "Continued as new",
    text: "text-purple",
    bg: "bg-purple/10",
    border: "border-purple/30",
  },
};

export function executionStatusIdentity(status?: string | null): StatusIdentity {
  const key = (status ?? "").toUpperCase();
  return (
    EXECUTION_STATUS_IDENTITY[key] ?? {
      label: status ?? "Unknown",
      text: "text-muted-foreground",
      bg: "bg-muted/40",
      border: "border-border",
    }
  );
}

export const STEP_TYPE_IDENTITY: Record<StepType, StatusIdentity & { icon: string }> = {
  agent: {
    label: "Agent",
    icon: "Cpu",
    text: "text-purple",
    bg: "bg-purple/10",
    border: "border-purple/30",
  },
  tool: {
    // A workflow "tool" step runs a standalone function — an activity.
    label: "Activity",
    icon: "Wrench",
    text: "text-blue",
    bg: "bg-blue/10",
    border: "border-blue/30",
  },
  connector: {
    label: "Connector",
    icon: "Plug",
    text: "text-cyan",
    bg: "bg-cyan/10",
    border: "border-cyan/30",
  },
  condition: {
    label: "Condition",
    icon: "GitBranch",
    text: "text-amber",
    bg: "bg-amber/10",
    border: "border-amber/30",
  },
  transform: {
    label: "Transform",
    icon: "Code",
    text: "text-emerald",
    bg: "bg-emerald/10",
    border: "border-emerald/30",
  },
};

/** Colour/icon mapping only — the tier list itself comes from /api/ontology/tiers. */
export const TIER_IDENTITY: Record<string, StatusIdentity> = {
  foundation: {
    label: "Foundation",
    text: "text-indigo",
    bg: "bg-indigo/10",
    border: "border-indigo/30",
  },
  domain: { label: "Domain", text: "text-amber", bg: "bg-amber/10", border: "border-amber/30" },
  use_case: {
    label: "Use-Case",
    text: "text-emerald",
    bg: "bg-emerald/10",
    border: "border-emerald/30",
  },
};

export function tierIdentity(tier?: string | null): StatusIdentity {
  return TIER_IDENTITY[tier ?? "foundation"] ?? TIER_IDENTITY["foundation"]!;
}

export const TOOL_SOURCE_IDENTITY: Record<ToolSource, StatusIdentity> = {
  builtin: { label: "Builtin", text: "text-cyan", bg: "bg-cyan/10", border: "border-cyan/30" },
  native: { label: "Native", text: "text-blue", bg: "bg-blue/10", border: "border-blue/30" },
  dynamic: {
    label: "Dynamic",
    text: "text-purple",
    bg: "bg-purple/10",
    border: "border-purple/30",
  },
};

export function toolSource(id: string | number | null | undefined): ToolSource {
  const str = String(id ?? "");
  if (str.startsWith("native-")) return "native";
  if (str.startsWith("builtin-")) return "builtin";
  return "dynamic";
}
export const isEditableTool = (id: string | number | null | undefined) =>
  toolSource(id) === "dynamic";

/** Native tools seeded into the Tool Service; it refuses to delete them. */
const PROTECTED_TOOL_NAMES = new Set([
  "get_weather",
  "calculate",
  "search_knowledge",
  "create_document",
  "send_email",
]);

/** Whether a tool may be deleted — synthesized, and not a protected native tool. */
export const isDeletableTool = (tool: { id: string | number; name: string }) =>
  toolSource(tool.id) === "dynamic" && !PROTECTED_TOOL_NAMES.has(tool.name);

export const DOCUMENT_STATUS_IDENTITY: Record<string, StatusIdentity> = {
  uploaded: {
    label: "Uploaded",
    text: "text-muted-foreground",
    bg: "bg-muted/40",
    border: "border-border",
  },
  indexing: {
    label: "Indexing",
    text: "text-blue",
    bg: "bg-blue/10",
    border: "border-blue/30",
    pulse: true,
  },
  extracting: {
    label: "Extracting",
    text: "text-blue",
    bg: "bg-blue/10",
    border: "border-blue/30",
    pulse: true,
  },
  extracted: { label: "Extracted", text: "text-cyan", bg: "bg-cyan/10", border: "border-cyan/30" },
  proposed: {
    label: "Awaiting review",
    text: "text-amber",
    bg: "bg-amber/10",
    border: "border-amber/30",
  },
  graphed: {
    label: "Graphed",
    text: "text-emerald",
    bg: "bg-emerald/10",
    border: "border-emerald/30",
  },
  unsupported: {
    label: "Unsupported",
    text: "text-slate",
    bg: "bg-slate/10",
    border: "border-slate/30",
  },
  failed: { label: "Failed", text: "text-red", bg: "bg-red/10", border: "border-red/30" },
};

export const TIMELINE_STATUS_IDENTITY: Record<string, StatusIdentity> = {
  running: {
    label: "Running",
    text: "text-blue",
    bg: "bg-blue/10",
    border: "border-blue/30",
    pulse: true,
  },
  ok: { label: "OK", text: "text-emerald", bg: "bg-emerald/10", border: "border-emerald/30" },
  failed: { label: "Failed", text: "text-red", bg: "bg-red/10", border: "border-red/30" },
  skipped: { label: "Skipped", text: "text-slate", bg: "bg-slate/10", border: "border-slate/30" },
};

export const LIVE_STATE_IDENTITY: Record<string, StatusIdentity> = {
  idle: {
    label: "Idle",
    text: "text-muted-foreground",
    bg: "bg-muted/40",
    border: "border-border",
  },
  connecting: {
    label: "Connecting",
    text: "text-amber",
    bg: "bg-amber/10",
    border: "border-amber/30",
    pulse: true,
  },
  live: {
    label: "Live",
    text: "text-emerald",
    bg: "bg-emerald/10",
    border: "border-emerald/30",
    pulse: true,
  },
  reconnecting: {
    label: "Reconnecting",
    text: "text-amber",
    bg: "bg-amber/10",
    border: "border-amber/30",
    pulse: true,
  },
  closed: { label: "Closed", text: "text-slate", bg: "bg-slate/10", border: "border-slate/30" },
  disconnected: {
    label: "Disconnected",
    text: "text-slate",
    bg: "bg-slate/10",
    border: "border-slate/30",
  },
  error: { label: "Error", text: "text-red", bg: "bg-red/10", border: "border-red/30" },
};

/* ── formatting helpers ─────────────────────────────────────────────── */

export function formatDuration(ms?: number | null): string {
  if (ms == null) return "—";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(s < 10 ? 2 : 1)}s`;
  const m = Math.floor(s / 60);
  const rem = Math.round(s % 60);
  if (m < 60) return `${m}m ${rem}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

/**
 * Parse a server timestamp. The backend stores UTC without saying so
 * ("2026-09-17T09:28:12"); read as-is, a browser treats that as local time and
 * every "5 minutes ago" is off by the viewer's offset. A date-time with no zone
 * is therefore read as UTC. Returns NaN when unparseable.
 */
export function parseServerTime(value: string | number): number {
  if (typeof value === "number") return value;
  const v = value.trim();
  const naive = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/.test(v);
  return Date.parse(naive ? `${v.replace(" ", "T")}Z` : v);
}

export function formatRelative(value?: string | number | null): string {
  if (!value) return "—";
  const t = parseServerTime(value);
  if (Number.isNaN(t)) return String(value);
  const diff = Date.now() - t;
  const abs = Math.abs(diff);
  const mins = Math.round(abs / 60000);
  if (abs < 45000) return "just now";
  if (mins < 60) return diff > 0 ? `${mins}m ago` : `in ${mins}m`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return diff > 0 ? `${hours}h ago` : `in ${hours}h`;
  const days = Math.round(hours / 24);
  if (days < 30) return diff > 0 ? `${days}d ago` : `in ${days}d`;
  return new Date(t).toLocaleDateString();
}

export function formatTimestamp(value?: string | number | null): string {
  if (!value) return "—";
  const t = parseServerTime(value);
  if (Number.isNaN(t)) return String(value);
  return new Date(t).toLocaleString();
}

const CREATED_FORMAT = new Intl.DateTimeFormat(undefined, {
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

/** "18 Sep 2026, 11:04" in the viewer's time zone, or null when there is no date. */
export function formatCreated(value: unknown): string | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  if (value === "" || value === "None") return null;
  const t = parseServerTime(value);
  return Number.isNaN(t) ? null : CREATED_FORMAT.format(t);
}
