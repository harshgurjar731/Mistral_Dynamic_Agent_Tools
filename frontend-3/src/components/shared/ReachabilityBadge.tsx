import type { StatusIdentity } from "@/lib/status";
import { StatusPill } from "@/components/ui/StatusPill";

export type ReachState = "reachable" | "unreachable" | "checking" | "unknown";

const IDENTITY: Record<ReachState, StatusIdentity> = {
  reachable: {
    label: "Reachable",
    text: "text-emerald",
    bg: "bg-emerald/10",
    border: "border-emerald/30",
  },
  unreachable: { label: "Unreachable", text: "text-red", bg: "bg-red/10", border: "border-red/30" },
  checking: {
    label: "Checking…",
    text: "text-amber",
    bg: "bg-amber/10",
    border: "border-amber/30",
    pulse: true,
  },
  unknown: {
    label: "Not checked",
    text: "text-muted-foreground",
    bg: "bg-muted/40",
    border: "border-border",
  },
};

export function ReachabilityBadge({ state }: { state: ReachState }) {
  return <StatusPill identity={IDENTITY[state]} />;
}

export type HealthState = "healthy" | "disconnected" | "unreachable" | "checking" | "unknown";

const HEALTH_IDENTITY: Record<HealthState, StatusIdentity> = {
  healthy: {
    label: "Healthy",
    text: "text-emerald",
    bg: "bg-emerald/10",
    border: "border-emerald/30",
    pulse: true,
  },
  disconnected: {
    label: "Disconnected",
    text: "text-slate",
    bg: "bg-slate/10",
    border: "border-slate/30",
  },
  unreachable: { label: "Unreachable", text: "text-red", bg: "bg-red/10", border: "border-red/30" },
  checking: {
    label: "Checking…",
    text: "text-amber",
    bg: "bg-amber/10",
    border: "border-amber/30",
    pulse: true,
  },
  unknown: {
    label: "Not checked",
    text: "text-muted-foreground",
    bg: "bg-muted/40",
    border: "border-border",
  },
};

export function HealthBadge({ state }: { state: HealthState }) {
  return <StatusPill identity={HEALTH_IDENTITY[state]} />;
}
