import { useEffect, useRef, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { z } from "zod";
import { ArrowLeft, History, Send, Server, SquareTerminal } from "lucide-react";
import { QK, errorMessage } from "@/api";
import { remoteServersApi } from "@/api/remoteServers";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { DetailSkeleton } from "@/components/ui/Skeletons";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { SectionCard } from "@/components/shared/SectionCard";
import { ServerForm } from "@/components/remote-servers/ServerForm";
import { RemoteConsole } from "@/components/remote-servers/RemoteConsole";
import { DeploymentHistory } from "@/components/remote-servers/Deployments";
import { ServerHeader } from "@/components/remote-servers/detail/ServerHeader";
import { OverviewTab } from "@/components/remote-servers/detail/OverviewTab";
import { WorkflowsTab } from "@/components/remote-servers/detail/WorkflowsTab";
import { SettingsTab } from "@/components/remote-servers/detail/SettingsTab";
import { PushToolPanel } from "@/components/remote-servers/detail/ServerPanels";
import { SERVER_TABS, tabsFor, type ServerTab } from "@/components/remote-servers/detail/tabs";
import type { ServerState } from "@/components/remote-servers/status";

const searchSchema = z.object({
  tab: z.enum(SERVER_TABS).optional(),
  /** The deployed workflow open in the Workflows tab. */
  wf: z.string().optional(),
});

export const Route = createFileRoute("/remote-servers/$id")({
  validateSearch: searchSchema,
  head: () => ({
    meta: [
      { title: "Remote Server — Agentic AI Design Patterns" },
      { name: "description", content: "Remote server detail, diagnostics and deployments." },
      { property: "og:title", content: "Remote Server — Agentic AI Design Patterns" },
      {
        property: "og:description",
        content: "Remote server detail, diagnostics and deployments.",
      },
    ],
  }),
  component: RemoteServerDetailPage,
});

const tabTrigger =
  "gap-1.5 rounded-lg px-3 text-xs data-[state=active]:bg-primary/10 data-[state=active]:text-primary data-[state=active]:shadow-none";

function RemoteServerDetailPage() {
  const { id } = Route.useParams();
  const { tab, wf } = Route.useSearch();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const navigateSearch = useNavigate({ from: Route.fullPath });
  const [editOpen, setEditOpen] = useState(false);

  const query = useQuery({
    queryKey: QK.remoteServer(id),
    queryFn: () => remoteServersApi.get(id),
  });
  const catalog = useQuery({
    queryKey: QK.remoteServerProviders(),
    queryFn: remoteServersApi.providers,
    staleTime: Infinity,
  });
  const deployments = useQuery({
    queryKey: QK.remoteServerDeployments(id),
    queryFn: () => remoteServersApi.deployments(id),
    refetchInterval: (q) =>
      q.state.data?.some((d) => d.status === "running" || d.status === "queued") ? 3000 : false,
  });

  const check = useMutation({
    mutationFn: () => remoteServersApi.check(id),
    onSuccess: (r) => {
      if (r.status === "healthy") toast.success("All checks passed.");
      else toast.warning(`Server is ${r.status}.`);
      qc.invalidateQueries({ queryKey: QK.remoteServers() });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const remove = useMutation({
    mutationFn: () => remoteServersApi.remove(id),
    onSuccess: () => {
      toast.success("Server removed.");
      qc.invalidateQueries({ queryKey: QK.remoteServers() });
      navigate({ to: "/remote-servers" });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  // Provisioning rewrites host, key and diagnostics — reload once it ends.
  const provisioning = (deployments.data ?? []).some(
    (d) => d.kind === "provision" && (d.status === "running" || d.status === "queued"),
  );
  const wasProvisioning = useRef(false);
  useEffect(() => {
    if (wasProvisioning.current && !provisioning) {
      qc.invalidateQueries({ queryKey: QK.remoteServers() });
    }
    wasProvisioning.current = provisioning;
  }, [provisioning, qc]);

  const server = query.data;

  if (query.isLoading) {
    return (
      <div className="px-6 py-8">
        <DetailSkeleton />
      </div>
    );
  }
  if (query.isError || !server) {
    return (
      <div className="px-6 py-8">
        <BackLink />
        {query.isError ? (
          <ErrorState
            error={query.error}
            title="Remote server not found."
            onRetry={() => query.refetch()}
          />
        ) : (
          <EmptyState icon={<Server className="size-6" />} title="Remote server not found." />
        )}
      </div>
    );
  }

  const report = check.data ?? server.last_check;
  const state: ServerState = check.isPending ? "checking" : (report?.status ?? "unknown");
  const deps = deployments.data ?? [];
  const tabs = tabsFor(server);
  // A tab this server doesn't have (e.g. from an old link) falls back to the overview.
  const active: ServerTab = tab && tabs.some((t) => t.id === tab) ? tab : "overview";

  const go = (next: ServerTab, workflow?: string) =>
    navigateSearch({
      search: { tab: next === "overview" ? undefined : next, wf: workflow },
      replace: true,
    });
  const confirmRemove = () => window.confirm(`Remove "${server.name}"?`) && remove.mutate();

  return (
    <div className="mx-auto max-w-7xl px-6 py-8">
      <BackLink />

      <ServerHeader
        server={server}
        report={report}
        state={state}
        checking={check.isPending}
        onCheck={() => check.mutate()}
        onEdit={() => setEditOpen(true)}
        onRemove={confirmRemove}
      />

      <Tabs value={active} onValueChange={(v) => go(v as ServerTab)} className="mt-5">
        <div className="custom-scrollbar -mx-1 overflow-x-auto px-1">
          <TabsList className="h-10 rounded-xl border border-border/50 bg-surface/40 p-1 backdrop-blur-sm">
            {tabs.map((t) => (
              <TabsTrigger key={t.id} value={t.id} className={tabTrigger}>
                <t.icon className="size-3.5" />
                {t.label}
                {t.id === "activity" && deps.length ? (
                  <span className="rounded-full bg-muted/60 px-1.5 text-[10px] text-muted-foreground tabular-nums">
                    {deps.length}
                  </span>
                ) : null}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>

        <TabsContent value="overview" className="mt-4">
          <OverviewTab
            server={server}
            report={report}
            deployments={deps}
            checking={check.isPending}
            onCheck={() => check.mutate()}
            go={go}
          />
        </TabsContent>

        <TabsContent value="workflows" className="mt-4">
          <WorkflowsTab server={server} selected={wf} onSelect={(w) => go("workflows", w)} />
        </TabsContent>

        <TabsContent value="push" className="mt-4">
          <SectionCard
            icon={Send}
            title="Push a tool"
            description="Send a dynamic tool's source code to this server's endpoint."
          >
            <PushToolPanel server={server} />
          </SectionCard>
        </TabsContent>

        <TabsContent value="console" className="mt-4">
          <SectionCard
            icon={SquareTerminal}
            title="Console"
            description="Start and inspect a workflow's worker, or run any command on this server."
          >
            <RemoteConsole server={server} />
          </SectionCard>
        </TabsContent>

        <TabsContent value="activity" className="mt-4">
          <SectionCard
            icon={History}
            title="Activity"
            description="Every deployment, build, command and provisioning run on this server — expand one for its log."
          >
            {deployments.isLoading ? <DetailSkeleton /> : <DeploymentHistory deployments={deps} />}
          </SectionCard>
        </TabsContent>

        <TabsContent value="settings" className="mt-4">
          <SettingsTab
            server={server}
            catalog={catalog.data}
            report={report}
            deployments={deps}
            checking={check.isPending}
            removing={remove.isPending}
            onCheck={() => check.mutate()}
            onEdit={() => setEditOpen(true)}
            onRemove={confirmRemove}
          />
        </TabsContent>
      </Tabs>

      {/* ── Edit dialog ── */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="custom-scrollbar max-h-[88vh] max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Edit {server.name}</DialogTitle>
            <DialogDescription>
              Saved passwords, keys and tokens stay as they are unless you enter a new value.
            </DialogDescription>
          </DialogHeader>
          {catalog.data ? (
            <ServerForm
              key={server.updated_at ?? server.id}
              catalog={catalog.data}
              server={server}
              layout="stacked"
              onCancel={() => setEditOpen(false)}
              onSaved={() => {
                setEditOpen(false);
                qc.invalidateQueries({ queryKey: QK.remoteServers() });
              }}
            />
          ) : (
            <DetailSkeleton />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function BackLink() {
  return (
    <Button size="sm" variant="ghost" asChild className="mb-4">
      <Link to="/remote-servers">
        <ArrowLeft className="size-3.5" /> Remote Servers
      </Link>
    </Button>
  );
}
