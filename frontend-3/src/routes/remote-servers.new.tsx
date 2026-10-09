import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { ArrowLeft } from "lucide-react";
import { QK } from "@/api";
import { remoteServersApi } from "@/api/remoteServers";
import { ServerForm } from "@/components/remote-servers/ServerForm";
import { Button } from "@/components/ui/button";
import { ErrorState } from "@/components/ui/ErrorState";
import { DetailSkeleton } from "@/components/ui/Skeletons";

const searchSchema = z.object({
  purpose: z.enum(["tool", "workflow"]).optional(),
});

export const Route = createFileRoute("/remote-servers/new")({
  validateSearch: searchSchema,
  head: () => ({
    meta: [
      { title: "Add Remote Server — Agentic AI Design Patterns" },
      { name: "description", content: "Add a deployment server." },
    ],
  }),
  component: NewRemoteServerPage,
});

function NewRemoteServerPage() {
  const { purpose } = Route.useSearch();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const catalog = useQuery({
    queryKey: QK.remoteServerProviders(),
    queryFn: remoteServersApi.providers,
    staleTime: Infinity,
  });

  return (
    <div className="mx-auto max-w-3xl px-6 py-8">
      <Button size="sm" variant="ghost" asChild className="mb-4">
        <Link to="/remote-servers" search={{ purpose }}>
          <ArrowLeft className="size-3.5" /> Remote Servers
        </Link>
      </Button>
      <h1 className="text-2xl font-semibold tracking-tight text-foreground">
        Add a <span className="text-gradient-brand">remote server</span>
      </h1>
      <p className="mt-1.5 text-sm text-muted-foreground">
        A place to deploy workflows or tools. Four quick steps — you can test the connection before
        anything is saved.
      </p>

      <div className="mt-6">
        {catalog.isLoading ? (
          <DetailSkeleton />
        ) : catalog.isError || !catalog.data ? (
          <ErrorState error={catalog.error} onRetry={() => catalog.refetch()} />
        ) : (
          <ServerForm
            catalog={catalog.data}
            initialPurpose={purpose}
            onCancel={() => navigate({ to: "/remote-servers", search: { purpose } })}
            onSaved={(s) => {
              qc.invalidateQueries({ queryKey: QK.remoteServers() });
              navigate({
                to: "/remote-servers/$id",
                params: { id: String(s.id) },
                // Brev provisioning streams its log on the Settings tab.
                search: { tab: s.provision_deployment_id ? "settings" : undefined },
              });
            }}
          />
        )}
      </div>
    </div>
  );
}
