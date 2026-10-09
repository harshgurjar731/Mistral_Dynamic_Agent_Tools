import { Cpu, Loader2, PlugZap, RefreshCw, Stethoscope, Trash2, TriangleAlert } from "lucide-react";
import type {
  CheckReport,
  ProviderCatalog,
  RemoteDeployment,
  RemoteServer,
} from "@/api/remoteServers";
import { Button } from "@/components/ui/button";
import { SectionCard } from "@/components/shared/SectionCard";
import { CheckReportView, HostFacts } from "../CheckReportView";
import { BrevInstanceCard, ConfigurationCard } from "./ServerPanels";
import { cn } from "@/lib/utils";

/** How the server is set up and how it checks out — plus removing it. */
export function SettingsTab({
  server,
  catalog,
  report,
  deployments,
  checking,
  removing,
  onCheck,
  onEdit,
  onRemove,
}: {
  server: RemoteServer;
  catalog: ProviderCatalog | undefined;
  report: CheckReport | null | undefined;
  deployments: RemoteDeployment[];
  checking: boolean;
  removing: boolean;
  onCheck: () => void;
  onEdit: () => void;
  onRemove: () => void;
}) {
  const provisioned = catalog?.providers.find((p) => p.id === server.provider)?.provisioned;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-2 [&>*]:min-w-0">
        <div className="space-y-4">
          <ConfigurationCard server={server} catalog={catalog} onEdit={onEdit} />
          {report && Object.keys(report.system ?? {}).length > 0 ? (
            <SectionCard icon={Cpu} title="Host" bodyClassName="px-5 py-3">
              <HostFacts system={report.system} />
            </SectionCard>
          ) : null}
        </div>

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
                onClick={onCheck}
                disabled={checking}
                aria-label="Re-run diagnostics"
              >
                <RefreshCw className={cn("size-3.5", checking && "animate-spin")} />
              </Button>
            ) : null
          }
        >
          {report ? (
            <CheckReportView report={report} />
          ) : (
            <div className="flex flex-col items-center gap-3 py-6 text-center">
              <PlugZap className="size-6 text-muted-foreground" />
              <p className="text-xs text-muted-foreground">This server hasn't been checked yet.</p>
              <Button size="sm" onClick={onCheck} disabled={checking}>
                {checking ? <Loader2 className="size-3.5 animate-spin" /> : null}
                Run diagnostics
              </Button>
            </div>
          )}
        </SectionCard>
      </div>

      {provisioned ? <BrevInstanceCard server={server} deployments={deployments} /> : null}

      <section className="flex flex-wrap items-center gap-4 rounded-2xl border border-red/25 bg-red/5 px-5 py-4">
        <TriangleAlert className="size-5 shrink-0 text-red" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-foreground">Remove this server</p>
          <p className="text-xs text-muted-foreground">
            Deletes it from this app with its stored credentials and activity history. Nothing on
            the server itself is touched — delete deployed workflows from the Workflows tab first if
            you want them gone.
          </p>
        </div>
        <Button
          size="sm"
          variant="outline"
          className="border-red/40 text-red hover:bg-red/10 hover:text-red"
          onClick={onRemove}
          disabled={removing}
        >
          {removing ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <Trash2 className="size-3.5" />
          )}
          Remove server
        </Button>
      </section>
    </div>
  );
}
