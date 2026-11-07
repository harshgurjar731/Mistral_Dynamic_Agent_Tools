import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { authKeys, statusApi } from "@/api/auth";
import { StatusPill } from "@/components/ui/StatusPill";
import { cn } from "@/lib/utils";
import { useUiConfig } from "@/lib/uiConfig";

/** Is the platform live? Polls the user-level status (the caller's workspace). */
export function useSystemStatus() {
  const ui = useUiConfig();
  return useQuery({
    queryKey: authKeys.status(),
    queryFn: statusApi.get,
    refetchInterval: Math.max(5, Number(ui.UI_HEALTH_POLL_SECONDS) || 30) * 1000,
    retry: 1,
  });
}

export function HealthIndicator({
  variant = "pill",
  collapsed = false,
}: {
  /** "rail" is a full-width row for the sidebar; "pill" sits in a header. */
  variant?: "pill" | "rail";
  collapsed?: boolean;
} = {}) {
  const { data, isError, isLoading } = useSystemStatus();
  const problems = data?.issues.filter((i) => i.state === "down" || i.state === "degraded") ?? [];

  const identity = isLoading
    ? {
        label: "Checking",
        text: "text-muted-foreground",
        bg: "bg-muted/40",
        border: "border-border",
        pulse: true,
      }
    : isError
      ? {
          label: "Can't reach the platform",
          text: "text-red",
          bg: "bg-red/10",
          border: "border-red/30",
        }
      : data?.status === "operational"
        ? { label: "Live", text: "text-emerald", bg: "bg-emerald/10", border: "border-emerald/30" }
        : data?.status === "outage"
          ? { label: "Outage", text: "text-red", bg: "bg-red/10", border: "border-red/30" }
          : {
              label:
                problems.length === 1 ? `${problems[0]!.name} affected` : "Some features affected",
              text: "text-amber",
              bg: "bg-amber/10",
              border: "border-amber/30",
            };

  if (variant === "rail") {
    return (
      <Link
        to="/health"
        aria-label={`System status: ${identity.label}`}
        title={collapsed ? identity.label : "System status"}
        className={cn(
          "flex items-center gap-2.5 rounded-md px-2.5 py-2 text-xs font-medium transition hover:bg-surface-hover",
          collapsed && "justify-center",
          identity.text,
        )}
      >
        <span className="grid size-4 shrink-0 place-items-center">
          <span
            className={cn(
              "size-2 rounded-full bg-current",
              (identity.pulse || data?.status === "operational") && "animate-pulse",
            )}
          />
        </span>
        {collapsed ? null : <span className="truncate">{identity.label}</span>}
      </Link>
    );
  }

  return (
    <Link to="/health" aria-label="System status">
      <StatusPill identity={identity} size="xs" />
    </Link>
  );
}
