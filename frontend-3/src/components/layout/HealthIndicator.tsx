import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { healthApi, QK } from "@/api";
import { StatusPill } from "@/components/ui/StatusPill";

export function HealthIndicator() {
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

  return (
    <Link to="/health" aria-label="Open health dashboard">
      <StatusPill identity={identity} size="xs" />
    </Link>
  );
}
