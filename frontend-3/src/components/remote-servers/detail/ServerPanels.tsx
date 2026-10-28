import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  ArrowRightLeft,
  Cloud,
  KeyRound,
  Loader2,
  Pencil,
  Play,
  RefreshCw,
  Send,
  Settings2,
} from "lucide-react";
import { QK, errorMessage, toolsApi } from "@/api";
import {
  remoteServersApi,
  type ProviderCatalog,
  type RemoteDeployment,
  type RemoteServer,
  type ServerProvider,
} from "@/api/remoteServers";
import type { Tool } from "@/types";
import { Button } from "@/components/ui/button";
import { CodeBlock } from "@/components/shared/CodeBlock";
import { SectionCard } from "@/components/shared/SectionCard";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { DeploymentLog } from "../Deployments";
import { cn } from "@/lib/utils";
import {
  AccountNotice,
  matchInstance,
  useProviderAccounts,
  useStartInstance,
} from "../ProviderAccounts";
import { LivePercent } from "@/components/activity/LiveProgress";

/** Non-secret settings at a glance, plus which secrets are stored. */
export function ConfigurationCard({
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
      description="Connection and deployment settings. Secrets are stored encrypted."
      actions={
        <Button size="sm" variant="outline" onClick={onEdit}>
          <Pencil className="size-3.5" /> Edit
        </Button>
      }
      bodyClassName="px-5 py-3"
    >
      <dl className="divide-y divide-border/40 text-xs">
        {fields.map((f) => {
          const raw = String(server.config[f.key]);
          const shown = f.options?.find((o) => o.value === raw)?.label ?? raw;
          return (
            <div key={f.key} className="flex min-w-0 items-center gap-3 py-2">
              <dt className="w-36 shrink-0 text-muted-foreground">{f.label}</dt>
              <dd className="truncate font-mono text-[11px] text-foreground" title={raw}>
                {shown}
              </dd>
            </div>
          );
        })}
        {fingerprint ? (
          <div className="flex min-w-0 items-center gap-3 py-2">
            <dt className="w-36 shrink-0 text-muted-foreground">Host key</dt>
            <dd className="truncate font-mono text-[11px] text-foreground" title={fingerprint}>
              {fingerprint}
            </dd>
          </div>
        ) : null}
      </dl>
      {secrets.length > 0 ? (
        <div className="mt-3 flex flex-wrap items-center gap-1.5 border-t border-border/40 pt-3">
          <span className="mr-1 text-[11px] text-muted-foreground">Stored secrets</span>
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
export function BrevInstanceCard({
  server,
  provider,
  deployments,
}: {
  server: RemoteServer;
  provider: ServerProvider | undefined;
  deployments: RemoteDeployment[];
}) {
  const qc = useQueryClient();
  const latest = deployments.find((d) => d.kind === "provision");
  const active = latest?.status === "running" || latest?.status === "queued";
  // Provisioning needs the CLI logged in — unless a token it can log in with is stored.
  const account = useProviderAccounts(Boolean(provider?.account)).data?.find(
    (a) => a.provider === provider?.id,
  );
  const blocked =
    (account?.state === "logged_out" || account?.state === "not_installed") &&
    !account.token_saved &&
    !server.secrets_set.includes("brev_token");

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
          disabled={active || provision.isPending || blocked}
          title={blocked ? "Log in to Brev first" : undefined}
        >
          {active || provision.isPending ? (
            <>
              <Loader2 className="size-3.5 animate-spin" />
              <LivePercent />
            </>
          ) : (
            <RefreshCw className="size-3.5" />
          )}
          Re-provision
        </Button>
      }
    >
      <AccountNotice provider={provider} className="mb-3" />
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

/**
 * Cloud servers with a connected account: the VM's live state and address,
 * with Start for a stopped VM and a way to follow a changed public IP.
 */
export function CloudInstanceCard({
  server,
  provider,
}: {
  server: RemoteServer;
  provider: ServerProvider | undefined;
}) {
  const qc = useQueryClient();
  const spec = provider?.account;
  const accounts = useProviderAccounts(Boolean(spec));
  const start = useStartInstance(provider?.id ?? "");
  const status = accounts.data?.find((a) => a.provider === provider?.id);
  const instance = status ? matchInstance(spec, server.config, status.instances) : undefined;

  const useIp = useMutation({
    mutationFn: (host: string) => remoteServersApi.update(server.id, { config: { host } }),
    onSuccess: (s) => {
      toast.success(`Host updated to ${String(s.config["host"])}.`);
      qc.invalidateQueries({ queryKey: QK.remoteServers() });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  if (!spec || spec.kind !== "api") return null;
  const host = String(server.config["host"] ?? "");
  const running = instance && /^(RUNNING|ACTIVE)$/.test(instance.state);
  const ipChanged = Boolean(instance?.public_ip) && instance!.public_ip !== host;
  const idFields = spec.match
    .map((k) => provider.fields.find((f) => f.key === k)?.label ?? k)
    .join(" and ");

  return (
    <SectionCard
      icon={Cloud}
      title={`${spec.label} instance`}
      description="Live state from your provider account."
      actions={
        <Button
          size="sm"
          variant="ghost"
          onClick={() => accounts.refetch()}
          disabled={accounts.isFetching}
        >
          <RefreshCw className={cn("size-3.5", accounts.isFetching && "animate-spin")} />
          Refresh
        </Button>
      }
    >
      <AccountNotice provider={provider} />
      {status?.state !== "logged_in" ? null : !instance ? (
        <p className="text-xs text-muted-foreground">
          This server's {idFields} {spec.match.length > 1 ? "don't" : "doesn't"} match any instance
          in the account. Set {spec.match.length > 1 ? "them" : "it"} under Edit (or pick the
          instance there) to see its state here.
        </p>
      ) : (
        <div className="space-y-3">
          <dl className="divide-y divide-border/40 text-xs">
            {[
              ["Instance", `${instance.name}${instance.location ? ` · ${instance.location}` : ""}`],
              ["State", instance.state.toLowerCase()],
              ["Public IP", instance.public_ip || "none"],
              ["Private IP", instance.private_ip || "—"],
            ].map(([k, v]) => (
              <div key={k} className="flex min-w-0 items-center gap-3 py-2">
                <dt className="w-28 shrink-0 text-muted-foreground">{k}</dt>
                <dd
                  className={cn(
                    "truncate font-mono text-[11px]",
                    k === "State" && (running ? "text-emerald" : "text-amber"),
                  )}
                >
                  {v}
                </dd>
              </div>
            ))}
          </dl>
          {ipChanged ? (
            <div className="flex flex-wrap items-center gap-2 rounded-xl border border-amber/30 bg-amber/10 px-3 py-2.5 text-xs">
              <span className="min-w-0 flex-1 text-foreground">
                The public IP is now <code className="font-mono">{instance.public_ip}</code>; this
                server still uses <code className="font-mono">{host || "no host"}</code>.
              </span>
              <Button
                size="sm"
                onClick={() => useIp.mutate(instance.public_ip)}
                disabled={useIp.isPending}
              >
                {useIp.isPending ? (
                  <>
                    <Loader2 className="size-3.5 animate-spin" />
                    <LivePercent />
                  </>
                ) : (
                  <ArrowRightLeft className="size-3.5" />
                )}
                Use current IP
              </Button>
            </div>
          ) : null}
          {!running ? (
            <Button
              size="sm"
              variant="outline"
              onClick={() => start.mutate(instance)}
              disabled={start.isPending}
            >
              {start.isPending ? (
                <>
                  <Loader2 className="size-3.5 animate-spin" />
                  <LivePercent />
                </>
              ) : (
                <Play className="size-3.5" />
              )}
              Start {instance.name}
            </Button>
          ) : null}
        </div>
      )}
    </SectionCard>
  );
}

export function PushToolPanel({ server }: { server: RemoteServer }) {
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
            <>
              <Loader2 className="size-3.5 animate-spin" />
              <LivePercent />
            </>
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
