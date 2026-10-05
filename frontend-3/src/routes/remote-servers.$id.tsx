import { useEffect, useRef, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Activity,
  ArrowLeft,
  Boxes,
  Clock,
  Cloud,
  Copy,
  Cpu,
  Gauge,
  Hammer,
  History,
  KeyRound,
  Loader2,
  Pencil,
  Play,
  PlugZap,
  RefreshCw,
  Rocket,
  Send,
  Server,
  Settings2,
  SquareTerminal,
  Stethoscope,
  Trash2,
} from "lucide-react";
import { QK, errorMessage, toolsApi } from "@/api";
import {
  remoteServersApi,
  type ProviderCatalog,
  type RemoteDeployment,
  type RemoteServer,
} from "@/api/remoteServers";
import type { Tool } from "@/types";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { DetailSkeleton } from "@/components/ui/Skeletons";
import { CodeBlock } from "@/components/shared/CodeBlock";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CheckReportView, HostFacts } from "@/components/remote-servers/CheckReportView";
import { ServerForm } from "@/components/remote-servers/ServerForm";
import { DeployWorkflowPanel } from "@/components/remote-servers/DeployWorkflowPanel";
import { RemoteConsole } from "@/components/remote-servers/RemoteConsole";
import { BuildWorkflowPanel } from "@/components/remote-servers/BuildWorkflowPanel";
import { RunOnServerPanel } from "@/components/remote-servers/RunOnServerPanel";
import { DeploymentHistory, DeploymentLog } from "@/components/remote-servers/Deployments";
import { SectionCard, StatCard } from "@/components/shared/SectionCard";
import {
  PurposeBadge,
  STATE_TONE,
  ServerStatusBadge,
  providerIconFor,
  timeAgo,
  type ServerState,
} from "@/components/remote-servers/status";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/remote-servers/$id")({
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

function RemoteServerDetailPage() {
  const { id } = Route.useParams();
  const qc = useQueryClient();
  const navigate = useNavigate();
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
  const tone = STATE_TONE[state];
  const Icon = providerIconFor(server.provider);
  const checks = report?.checks ?? [];
  const passed = checks.filter((c) => c.status === "pass").length;
  const deps = deployments.data ?? [];
  const lastDep = deps[0];
  const isSshWorkflow = server.purpose === "workflow" && server.transport === "ssh";
  const stateLabel =
    state === "unknown" ? "Not checked" : state.charAt(0).toUpperCase() + state.slice(1);

  return (
    <div className="px-6 py-8">
      <BackLink />

      {/* ── Hero card ── */}
      <div
        className="relative overflow-hidden rounded-2xl border border-border/60 backdrop-blur-md"
        style={{ background: "var(--surface)" }}
      >
        <div className={cn("h-1 w-full bg-gradient-to-r to-transparent", tone.stripe)} />
        <div className="flex flex-wrap items-start gap-5 p-6">
          <div className="relative">
            <div className="grid size-16 place-items-center rounded-2xl border border-primary/25 bg-primary/10 text-primary">
              <Icon className="size-7" />
            </div>
            <span
              className={cn(
                "absolute -right-1 -bottom-1 size-4 rounded-full ring-4 ring-[var(--surface)]",
                tone.dot,
              )}
            />
          </div>

          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2.5">
              <h1 className="truncate text-2xl font-semibold tracking-tight text-foreground">
                {server.name}
              </h1>
              <ServerStatusBadge state={state} />
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <PurposeBadge purpose={server.purpose} />
              <span className="rounded-md border border-border/60 px-1.5 py-0.5 text-[10px]">
                {server.provider_label}
              </span>
            </div>
            <CopyAddress value={server.url} />
            {server.description ? (
              <p className="mt-3 max-w-3xl text-sm text-muted-foreground">{server.description}</p>
            ) : null}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" onClick={() => check.mutate()} disabled={check.isPending}>
              {check.isPending ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <PlugZap className="size-3.5" />
              )}
              Run diagnostics
            </Button>
            <Button size="sm" variant="outline" onClick={() => setEditOpen(true)}>
              <Pencil className="size-3.5" /> Edit
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="text-muted-foreground hover:bg-red/10 hover:text-red"
              onClick={() => window.confirm(`Remove "${server.name}"?`) && remove.mutate()}
              disabled={remove.isPending}
              aria-label="Remove server"
            >
              <Trash2 className="size-3.5" />
            </Button>
          </div>
        </div>
      </div>

      {/* ── Stat cards ── */}
      <div className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          icon={Activity}
          label="Health"
          value={stateLabel}
          valueClassName={tone.text}
          hint={checks.length ? `${passed} of ${checks.length} checks passed` : "Run diagnostics"}
        />
        <StatCard
          icon={Gauge}
          label="Latency"
          value={report?.latency_ms != null ? `${report.latency_ms} ms` : "—"}
          hint={report?.duration_ms != null ? `full check took ${report.duration_ms} ms` : null}
        />
        <StatCard
          icon={Clock}
          label="Last checked"
          value={timeAgo(report?.checked_at ?? server.last_checked_at)}
          hint={`added ${timeAgo(server.created_at)}`}
        />
        <StatCard
          icon={Rocket}
          label="Deployments"
          value={deps.length}
          hint={lastDep ? `last: ${lastDep.target} · ${lastDep.status}` : "nothing deployed yet"}
        />
      </div>

      {/* ── Main grid ── */}
      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          {catalog.data?.providers.find((p) => p.id === server.provider)?.provisioned ? (
            <BrevInstanceCard server={server} deployments={deps} />
          ) : null}

          {server.purpose === "workflow" ? (
            <SectionCard
              icon={Rocket}
              title="Deploy a workflow"
              description="Builds the workflow's deployment package and sends it to this server."
            >
              <DeployWorkflowPanel server={server} />
            </SectionCard>
          ) : (
            <SectionCard
              icon={Send}
              title="Push a tool"
              description="Send a dynamic tool's source code to this server's endpoint."
            >
              <PushToolPanel server={server} />
            </SectionCard>
          )}

          {isSshWorkflow ? <RemoteWorkflowsCard server={server} /> : null}

          {isSshWorkflow ? (
            <SectionCard
              icon={Hammer}
              title="Build"
              description="Build a deployed workflow's containers on this server, with every docker compose option, and start them."
            >
              <BuildWorkflowPanel server={server} />
            </SectionCard>
          ) : null}

          {isSshWorkflow ? (
            <SectionCard
              icon={Play}
              title="Run workflow"
              description="Execute a deployed workflow on this server's worker and watch the run live."
            >
              <RunOnServerPanel server={server} />
            </SectionCard>
          ) : null}

          {server.transport === "ssh" ? (
            <SectionCard
              icon={SquareTerminal}
              title="Console"
              description="Start and inspect the workflow worker, or run any command on this server."
            >
              <RemoteConsole server={server} />
            </SectionCard>
          ) : null}

          <SectionCard
            icon={History}
            title="Deployment history"
            description="Every tool push and workflow deployment to this server."
          >
            {deployments.isLoading ? <DetailSkeleton /> : <DeploymentHistory deployments={deps} />}
          </SectionCard>
        </div>

        <div className="space-y-4">
          <SectionCard
            icon={Stethoscope}
            title="Diagnostics"
            description={
              server.transport === "ssh"
                ? "DNS, port, SSH login, host key and host tooling."
                : "DNS, port, TLS, health endpoint and deploy route."
            }
            actions={
              report ? (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => check.mutate()}
                  disabled={check.isPending}
                  aria-label="Re-run diagnostics"
                >
                  <RefreshCw className={cn("size-3.5", check.isPending && "animate-spin")} />
                </Button>
              ) : null
            }
          >
            {report ? (
              <CheckReportView report={report} />
            ) : (
              <div className="flex flex-col items-center gap-3 py-6 text-center">
                <PlugZap className="size-6 text-muted-foreground" />
                <p className="text-xs text-muted-foreground">
                  This server hasn't been checked yet.
                </p>
                <Button size="sm" onClick={() => check.mutate()} disabled={check.isPending}>
                  {check.isPending ? <Loader2 className="size-3.5 animate-spin" /> : null}
                  Run diagnostics
                </Button>
              </div>
            )}
          </SectionCard>

          {report && Object.keys(report.system ?? {}).length > 0 ? (
            <SectionCard icon={Cpu} title="Host" bodyClassName="px-5 py-3">
              <HostFacts system={report.system} />
            </SectionCard>
          ) : null}

          <ConfigurationCard
            server={server}
            catalog={catalog.data}
            onEdit={() => setEditOpen(true)}
          />
        </div>
      </div>

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

function CopyAddress({ value }: { value: string }) {
  return (
    <button
      type="button"
      onClick={() => {
        void navigator.clipboard?.writeText(value);
        toast.success("Address copied.");
      }}
      title="Copy address"
      className="group mt-3 inline-flex max-w-full items-center gap-2 rounded-lg border border-border/50 bg-background-elevated/60 px-2.5 py-1.5 transition hover:border-primary/30"
    >
      <span className="truncate font-mono text-xs text-foreground/90">{value}</span>
      <Copy className="size-3 shrink-0 text-muted-foreground group-hover:text-primary" />
    </button>
  );
}

/** Non-secret settings at a glance, plus which secrets are stored. */
function ConfigurationCard({
  server,
  catalog,
  onEdit,
}: {
  server: RemoteServer;
  catalog: ProviderCatalog | undefined;
  onEdit: () => void;
}) {
  const provider = catalog?.providers.find((p) => p.id === server.provider);
  const fields = (provider?.fields ?? []).filter(
    (f) => !f.secret && server.config[f.key] != null && String(server.config[f.key]) !== "",
  );
  const secrets = (provider?.fields ?? []).filter((f) => server.secrets_set.includes(f.key));
  const fingerprint = server.config["host_fingerprint"] as string | undefined;

  return (
    <SectionCard
      icon={Settings2}
      title="Configuration"
      actions={
        <Button size="sm" variant="ghost" onClick={onEdit} aria-label="Edit configuration">
          <Pencil className="size-3.5" />
        </Button>
      }
      bodyClassName="px-5 py-3"
    >
      <dl className="divide-y divide-border/40 text-xs">
        {fields.map((f) => {
          const raw = String(server.config[f.key]);
          const shown = f.options?.find((o) => o.value === raw)?.label ?? raw;
          return (
            <div key={f.key} className="flex min-w-0 items-center gap-3 py-1.5">
              <dt className="w-28 shrink-0 text-muted-foreground">{f.label}</dt>
              <dd className="truncate font-mono text-[11px] text-foreground" title={raw}>
                {shown}
              </dd>
            </div>
          );
        })}
        {fingerprint ? (
          <div className="flex min-w-0 items-center gap-3 py-1.5">
            <dt className="w-28 shrink-0 text-muted-foreground">Host key</dt>
            <dd className="truncate font-mono text-[11px] text-foreground" title={fingerprint}>
              {fingerprint}
            </dd>
          </div>
        ) : null}
      </dl>
      {secrets.length > 0 ? (
        <div className="mt-3 flex flex-wrap gap-1.5 border-t border-border/40 pt-3">
          {secrets.map((f) => (
            <span
              key={f.key}
              className="inline-flex items-center gap-1 rounded-md border border-emerald/25 bg-emerald/10 px-1.5 py-0.5 text-[10px] text-emerald"
            >
              <KeyRound className="size-2.5" />
              {f.label}
            </span>
          ))}
        </div>
      ) : null}
    </SectionCard>
  );
}

/** Brev servers: the latest provisioning run and a way to re-run it (e.g. after an IP change). */
function BrevInstanceCard({
  server,
  deployments,
}: {
  server: RemoteServer;
  deployments: RemoteDeployment[];
}) {
  const qc = useQueryClient();
  const latest = deployments.find((d) => d.kind === "provision");
  const active = latest?.status === "running" || latest?.status === "queued";

  const provision = useMutation({
    mutationFn: () => remoteServersApi.provision(server.id),
    onSuccess: () => {
      toast.success("Provisioning started.");
      qc.invalidateQueries({ queryKey: QK.remoteServerDeployments(String(server.id)) });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  return (
    <SectionCard
      icon={Cloud}
      title="Brev instance"
      description={`Instance "${String(server.config["instance_name"] ?? "")}" — SSH access is resolved with the Brev CLI on this backend's host.`}
      actions={
        <Button
          size="sm"
          variant="outline"
          onClick={() => provision.mutate()}
          disabled={active || provision.isPending}
        >
          {active || provision.isPending ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <RefreshCw className="size-3.5" />
          )}
          Re-provision
        </Button>
      }
    >
      {latest ? (
        <DeploymentLog deploymentId={latest.id} />
      ) : (
        <p className="py-4 text-center text-xs text-muted-foreground">
          Not provisioned yet — start the instance in Brev, then click Re-provision.
        </p>
      )}
    </SectionCard>
  );
}

function PushToolPanel({ server }: { server: RemoteServer }) {
  const qc = useQueryClient();
  const [toolId, setToolId] = useState("");
  const [response, setResponse] = useState<unknown>(null);
  const tools = useQuery({ queryKey: QK.tools(), queryFn: toolsApi.list });

  const send = useMutation({
    mutationFn: () => remoteServersApi.sendTool(server.id, toolId),
    onSuccess: (res) => {
      setResponse(res);
      const ok = (res as { status?: string })?.status === "sent";
      if (ok) toast.success("Tool sent.");
      else toast.error((res as { message?: string })?.message ?? "Send failed.");
      qc.invalidateQueries({ queryKey: QK.remoteServerDeployments(String(server.id)) });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <div className="min-w-[14rem] flex-1">
          <Select value={toolId} onValueChange={setToolId}>
            <SelectTrigger>
              <SelectValue placeholder="Choose a tool…" />
            </SelectTrigger>
            <SelectContent>
              {(tools.data ?? []).map((t: Tool) => (
                <SelectItem key={t.id} value={String(t.id)}>
                  {t.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Button onClick={() => send.mutate()} disabled={!toolId || send.isPending}>
          {send.isPending ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <Send className="size-3.5" />
          )}
          Send to {server.name}
        </Button>
      </div>
      {response ? (
        <div>
          <p className="eyebrow mb-1.5">
            {(response as { status?: string })?.status === "sent" ? "Send result" : "Send failed"}
          </p>
          <CodeBlock code={JSON.stringify(response, null, 2)} language="json" />
        </div>
      ) : null}
    </div>
  );
}

function RemoteWorkflowsCard({ server }: { server: RemoteServer }) {
  const q = useQuery({
    queryKey: QK.remoteServerWorkflows(String(server.id)),
    queryFn: () => remoteServersApi.remoteWorkflows(server.id),
  });
  const items = q.data?.items ?? [];

  return (
    <SectionCard
      icon={Boxes}
      title="Workflows on this server"
      description={`Unpacked under ${String(server.config["deploy_path"] ?? "~/workflow-deployments")}, with their containers.`}
      actions={
        <Button
          size="sm"
          variant="ghost"
          onClick={() => q.refetch()}
          disabled={q.isFetching}
          aria-label="Refresh"
        >
          <RefreshCw className={cn("size-3.5", q.isFetching && "animate-spin")} />
        </Button>
      }
    >
      {q.isLoading ? (
        <DetailSkeleton />
      ) : q.data?.error ? (
        <p className="text-xs text-red">{q.data.error}</p>
      ) : items.length === 0 ? (
        <p className="py-4 text-center text-xs text-muted-foreground">Nothing deployed here yet.</p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {items.map((w) => {
            const up = w.containers.filter((c) => c.status.startsWith("Up")).length;
            return (
              <div
                key={w.name}
                className="rounded-xl border border-border/60 bg-background-elevated/40 p-3"
              >
                <div className="flex items-center gap-2">
                  <Boxes className="size-3.5 text-cyan" />
                  <span className="truncate font-mono text-xs text-foreground">{w.name}</span>
                </div>
                <div className="mt-2 flex flex-wrap gap-1.5 text-[10px]">
                  <span
                    className={cn(
                      "rounded border px-1",
                      w.env ? "border-emerald/30 text-emerald" : "border-amber/30 text-amber",
                    )}
                  >
                    {w.env ? ".env present" : "no .env"}
                  </span>
                  <span
                    className={cn(
                      "rounded border px-1",
                      up ? "border-emerald/30 text-emerald" : "border-border text-muted-foreground",
                    )}
                  >
                    {up}/{w.containers.length} containers up
                  </span>
                </div>
                <p className="mt-2 text-[11px] text-muted-foreground">
                  deployed {timeAgo(w.modified)}
                </p>
              </div>
            );
          })}
        </div>
      )}
    </SectionCard>
  );
}
