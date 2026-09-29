import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { healthApi, QK } from "@/api";
import { StatusPill } from "@/components/ui/StatusPill";
import { cn } from "@/lib/utils";

export function HealthIndicator({
  variant = "pill",
  collapsed = false,
}: {
  /** "rail" is a full-width row for the sidebar; "pill" sits in a header. */
  variant?: "pill" | "rail";
  collapsed?: boolean;
} = {}) {
  const { data, isError, isLoading } = useQuery({
    queryKey: QK.health(),
    queryFn: healthApi.get,
    refetchInterval: 30_000,
    retry: 1,
  });

  const identity = isLoading
    ? { label: "Checking", text: "text-muted-foreground", bg: "bg-muted/40", border: "border-border", pulse: true }
    : isError
      ? { label: "Backend offline", text: "text-red", bg: "bg-red/10", border: "border-red/30" }
      : data?.status === "healthy" || data?.status === "ok"
        ? {
            label: "All systems nominal",
            text: "text-emerald",
            bg: "bg-emerald/10",
            border: "border-emerald/30",
          }
        : {
            label: data?.status ? `Degraded — ${data.status}` : "Degraded",
            text: "text-amber",
            bg: "bg-amber/10",
            border: "border-amber/30",
          };

  if (variant === "rail") {
    return (
      <Link
        to="/health"
        aria-label={`Health: ${identity.label}`}
        title={collapsed ? identity.label : "Open health dashboard"}
        className={cn(
          "flex items-center gap-2.5 rounded-md px-2.5 py-2 text-xs font-medium transition hover:bg-surface-hover",
          collapsed && "justify-center",
          identity.text,
        )}
      >
        <span className="grid size-4 shrink-0 place-items-center">
          <span
            className={cn("size-2 rounded-full bg-current", identity.pulse && "animate-pulse")}
          />
        </span>
        {collapsed ? null : <span className="truncate">{identity.label}</span>}
      </Link>
    );
  }

  return (
    <Link to="/health" aria-label="Open health dashboard">
      <StatusPill identity={identity} size="xs" />
    </Link>
  );
}
