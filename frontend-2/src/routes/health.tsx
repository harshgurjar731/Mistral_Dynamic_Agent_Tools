import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Activity, Box, Server } from "lucide-react";
import { healthApi, QK } from "@/api";
import { GlassPanel, GlassPanelHeader } from "@/components/glass/GlassPanel";
import { ErrorState } from "@/components/ui/ErrorState";
import { CardGridSkeleton } from "@/components/ui/Skeletons";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/health")({
  head: () => ({
    meta: [
      { title: "Health — Agentic AI Design Patterns" },
      { name: "description", content: "Platform health dashboard." },
      { property: "og:title", content: "Health — Agentic AI Design Patterns" },
      { property: "og:description", content: "Platform health dashboard." },
    ],
  }),
  component: HealthPage,
});

function Dot({ healthy }: { healthy: boolean }) {
  return (
    <span
      className={cn(
        "size-2.5 rounded-full",
        healthy ? "animate-pulse bg-emerald" : "bg-red",
      )}
    />
  );
}

function ServiceCard({
  icon,
  name,
  status,
  version,
  healthy,
}: {
  icon: React.ReactNode;
  name: string;
  status: string;
  version?: string;
  healthy: boolean;
}) {
  return (
    <GlassPanel className="p-5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-muted-foreground">
          {icon}
          <p className="text-sm font-semibold text-foreground">{name}</p>
        </div>
        <Dot healthy={healthy} />
      </div>
      <div className="mt-4 space-y-1">
        <p className="text-xs text-muted-foreground">
          Status <span className="text-foreground">{status}</span>
        </p>
        <p className="text-xs text-muted-foreground">
          Version <span className="text-foreground">{version ?? "—"}</span>
        </p>
      </div>
    </GlassPanel>
  );
}

function HealthPage() {
  const query = useQuery({
    queryKey: QK.health(),
    queryFn: healthApi.get,
    refetchInterval: 15_000,
  });

  return (
    <div className="px-6 py-8">
      <h1 className="text-2xl font-semibold tracking-tight text-foreground">System Health</h1>
      <p className="mt-2 text-sm text-muted-foreground">Live status of all core microservices.</p>

      <div className="mt-6">
        {query.isLoading ? (
          <CardGridSkeleton count={3} />
        ) : query.isError ? (
          <ErrorState error={query.error} onRetry={() => query.refetch()} />
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            <ServiceCard
              icon={<Server className="size-4" />}
              name="Orchestrator (:8000)"
              status={query.data?.status ?? "unknown"}
              {...(query.data?.version ? { version: query.data.version } : {})}
              healthy={query.data?.status === "healthy"}
            />
            <ServiceCard
              icon={<Box className="size-4" />}
              name="Tool Service (:9000)"
              status={query.data?.docker_tool_service ?? "unknown"}
              healthy={query.data?.docker_tool_service === "reachable"}
            />
            <ServiceCard
              icon={<Activity className="size-4" />}
              name="Frontend"
              status="healthy"
              version="1.0.0"
              healthy
            />
          </div>
        )}
      </div>
    </div>
  );
}
