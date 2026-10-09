import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Cloud, KeyRound, Loader2, Pencil, RefreshCw, Send, Settings2 } from "lucide-react";
import { QK, errorMessage, toolsApi } from "@/api";
import {
  remoteServersApi,
  type ProviderCatalog,
  type RemoteDeployment,
  type RemoteServer,
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
