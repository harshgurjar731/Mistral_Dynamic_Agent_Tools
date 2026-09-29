import { Cloud, Code2, Server, Terminal, Webhook, type LucideIcon } from "lucide-react";
import type { StatusIdentity } from "@/lib/status";
import type { DeploymentStatus, ServerPurpose, ServerStatus } from "@/api/remoteServers";
import { StatusPill } from "@/components/ui/StatusPill";
import { cn } from "@/lib/utils";

export type ServerState = ServerStatus | "checking" | "unknown";

const SERVER_IDENTITY: Record<ServerState, StatusIdentity> = {
  healthy: {
    label: "Healthy",
    text: "text-emerald",
    bg: "bg-emerald/10",
    border: "border-emerald/30",
  },
  degraded: { label: "Degraded", text: "text-amber", bg: "bg-amber/10", border: "border-amber/30" },
  unreachable: { label: "Unreachable", text: "text-red", bg: "bg-red/10", border: "border-red/30" },
  checking: {
    label: "Checking…",
    text: "text-blue",
    bg: "bg-blue/10",
    border: "border-blue/30",
    pulse: true,
  },
  unknown: {
    label: "Not checked",
    text: "text-muted-foreground",
    bg: "bg-muted/40",
    border: "border-border",
  },
};

const DEPLOYMENT_IDENTITY: Record<DeploymentStatus, StatusIdentity> = {
  queued: {
    label: "Queued",
    text: "text-muted-foreground",
    bg: "bg-muted/40",
    border: "border-border",
  },
  running: {
    label: "Running",
    text: "text-blue",
    bg: "bg-blue/10",
    border: "border-blue/30",
    pulse: true,
  },
  succeeded: {
    label: "Succeeded",
    text: "text-emerald",
    bg: "bg-emerald/10",
    border: "border-emerald/30",
  },
  failed: { label: "Failed", text: "text-red", bg: "bg-red/10", border: "border-red/30" },
};

export function ServerStatusBadge({
  state,
  size = "sm",
}: {
  state: ServerState;
  size?: "xs" | "sm" | undefined;
}) {
  return <StatusPill identity={SERVER_IDENTITY[state]} size={size} />;
}

export function DeploymentStatusBadge({ status }: { status: DeploymentStatus }) {
  return (
    <StatusPill identity={DEPLOYMENT_IDENTITY[status] ?? DEPLOYMENT_IDENTITY.queued} size="xs" />
  );
}

const PROVIDER_ICONS: Record<string, LucideIcon> = {
  code: Code2,
  terminal: Terminal,
  cloud: Cloud,
  webhook: Webhook,
};

export function providerIcon(icon?: string): LucideIcon {
  return (icon && PROVIDER_ICONS[icon]) || Server;
}

/** Icon for a saved server, whose row carries the provider id but not its icon. */
const PROVIDER_ICON_KEY: Record<string, string> = {
  mcp_code_endpoint: "code",
  ssh: "terminal",
  http_deploy: "webhook",
};
export function providerIconFor(providerId: string): LucideIcon {
  return providerIcon(PROVIDER_ICON_KEY[providerId] ?? "cloud");
}

/** Accent classes per server state — dots, stripes and numbers. */
export const STATE_TONE: Record<ServerState, { dot: string; text: string; stripe: string }> = {
  healthy: { dot: "bg-emerald", text: "text-emerald", stripe: "from-emerald/70" },
  degraded: { dot: "bg-amber", text: "text-amber", stripe: "from-amber/70" },
  unreachable: { dot: "bg-red", text: "text-red", stripe: "from-red/70" },
  checking: { dot: "bg-blue animate-pulse", text: "text-blue", stripe: "from-blue/70" },
  unknown: { dot: "bg-muted-foreground/50", text: "text-muted-foreground", stripe: "from-border" },
};

export const PURPOSE_LABEL: Record<ServerPurpose, string> = {
  tool: "Tool deployment",
  workflow: "Workflow deployment",
};

export function PurposeBadge({
  purpose,
  className,
}: {
  purpose: ServerPurpose;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md border px-1.5 py-0.5 text-[10px] font-medium",
        purpose === "tool"
          ? "border-pink/20 bg-pink/8 text-pink"
          : "border-cyan/25 bg-cyan/10 text-cyan",
        className,
      )}
    >
      {PURPOSE_LABEL[purpose]}
    </span>
  );
}

export function timeAgo(iso?: string | null): string {
  if (!iso) return "never";
  const t = new Date(iso.endsWith("Z") || iso.includes("+") ? iso : `${iso}Z`).getTime();
  const s = Math.max(0, Math.round((Date.now() - t) / 1000));
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}
