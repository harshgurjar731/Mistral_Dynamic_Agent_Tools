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
    label: "Tool",
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
  dynamic: { label: "Dynamic", text: "text-purple", bg: "bg-purple/10", border: "border-purple/30" },
};

export function toolSource(id: string): ToolSource {
  if (id.startsWith("native-")) return "native";
  if (id.startsWith("builtin-")) return "builtin";
  return "dynamic";
}
export const isEditableTool = (id: string) => toolSource(id) === "dynamic";

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
  idle: { label: "Idle", text: "text-muted-foreground", bg: "bg-muted/40", border: "border-border" },
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

export function formatRelative(value?: string | number | null): string {
  if (!value) return "—";
  const t = typeof value === "number" ? value : Date.parse(value);
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
  const t = typeof value === "number" ? value : Date.parse(value);
  if (Number.isNaN(t)) return String(value);
  return new Date(t).toLocaleString();
}
