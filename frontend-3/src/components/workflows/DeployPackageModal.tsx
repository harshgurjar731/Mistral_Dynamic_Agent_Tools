import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Bot, Download, Loader2, Package, Plug, Rocket, Wrench } from "lucide-react";
import { workflowsApi, QK } from "@/api";
import { remoteServersApi } from "@/api/remoteServers";
import { DeployWorkflowPanel } from "@/components/remote-servers/DeployWorkflowPanel";
import { DeploymentHistory } from "@/components/remote-servers/Deployments";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

interface DeploymentAgentSpec {
  name: string;
  model: string;
  tier?: string | null;
}
interface DeploymentDynamicTool {
  name: string;
}
interface DeploymentConnectorRef {
  connector_id?: string | null;
  connector_name?: string | null;
}
interface DeploymentManifest {
  workflow_name: string;
  agents: DeploymentAgentSpec[];
  native_tools: string[];
  dynamic_tools: DeploymentDynamicTool[];
  connectors: DeploymentConnectorRef[];
}

export function DeployPackageModal({
  workflowName,
  open,
  onOpenChange,
}: {
  workflowName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const {
    data: manifest,
    isLoading,
    isError,
  } = useQuery<DeploymentManifest>({
    queryKey: QK.workflowDeploymentManifest(workflowName),
    queryFn: () => workflowsApi.getDeploymentManifest(workflowName),
    enabled: open && Boolean(workflowName),
  });
  const [tab, setTab] = useState<"download" | "deploy">("download");
  const history = useQuery({
    queryKey: QK.workflowRemoteDeployments(workflowName),
    queryFn: () => remoteServersApi.workflowDeployments(workflowName),
    enabled: open && tab === "deploy" && Boolean(workflowName),
    refetchInterval: (q) =>
      q.state.data?.some((d) => d.status === "running" || d.status === "queued") ? 3000 : false,
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[88vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Package className="size-5 text-indigo-400" /> Package for Deployment
          </DialogTitle>
          <DialogDescription>
            Bundle <span className="font-mono text-foreground font-semibold">{workflowName}</span>{" "}
            and all its dependent agents, dynamic tools, and connector configs — download it, or
            send it straight to one of your remote servers.
          </DialogDescription>
        </DialogHeader>

        <Tabs
          value={tab}
          onValueChange={(v) => setTab(v as "download" | "deploy")}
          className="flex min-h-0 flex-1 flex-col"
        >
          <TabsList className="self-start">
            <TabsTrigger value="download" className="gap-1.5">
              <Download className="size-3.5" /> Download
            </TabsTrigger>
            <TabsTrigger value="deploy" className="gap-1.5">
              <Rocket className="size-3.5" /> Deploy to server
            </TabsTrigger>
          </TabsList>
          <TabsContent
            value="download"
            className="flex-1 overflow-y-auto custom-scrollbar py-3 space-y-4 text-sm"
          >
            {isLoading ? (
              <div className="flex items-center justify-center py-10 gap-2 text-muted-foreground">
                <Loader2 className="size-4 animate-spin" />
                <span>Analyzing deployment dependencies…</span>
              </div>
            ) : isError || !manifest ? (
              <div className="flex items-center gap-2 p-3 rounded-lg border border-red/30 bg-red/10 text-red text-xs">
                <AlertTriangle className="size-4 shrink-0" />
                <span>Failed to load deployment manifest.</span>
              </div>
            ) : (
              <div className="space-y-4">
                {/* Agents */}
                <div className="rounded-lg border border-border bg-background-elevated/50 p-3.5 space-y-2">
                  <div className="flex items-center gap-2 text-xs font-semibold text-foreground">
                    <Bot className="size-4 text-indigo-400" />
                    <span>Agents ({manifest.agents.length})</span>
                  </div>
                  {manifest.agents.length === 0 ? (
                    <p className="text-xs text-muted-foreground">No agents required.</p>
                  ) : (
                    <ul className="space-y-1.5">
                      {manifest.agents.map((ag) => (
                        <li
                          key={ag.name}
                          className="flex items-center justify-between text-xs font-mono bg-surface-hover/50 px-2.5 py-1.5 rounded"
                        >
                          <span className="text-foreground">{ag.name}</span>
                          <span className="text-muted-foreground text-[10px]">
                            {ag.model} {ag.tier ? `· ${ag.tier}` : ""}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                {/* Dynamic & Native Tools */}
                <div className="rounded-lg border border-border bg-background-elevated/50 p-3.5 space-y-2">
                  <div className="flex items-center gap-2 text-xs font-semibold text-foreground">
                    <Wrench className="size-4 text-pink-400" />
                    <span>
                      Tools ({manifest.dynamic_tools.length + manifest.native_tools.length})
                    </span>
                  </div>
                  {manifest.dynamic_tools.length === 0 && manifest.native_tools.length === 0 ? (
                    <p className="text-xs text-muted-foreground">No tools required.</p>
                  ) : (
                    <div className="flex flex-wrap gap-1.5">
                      {manifest.dynamic_tools.map((dt) => (
                        <span
                          key={dt.name}
                          className="px-2 py-0.5 rounded text-[11px] font-mono bg-pink-500/10 text-pink-300 border border-pink-500/20"
                        >
                          {dt.name} (dynamic)
                        </span>
                      ))}
                      {manifest.native_tools.map((nt) => (
                        <span
                          key={nt}
                          className="px-2 py-0.5 rounded text-[11px] font-mono bg-indigo-500/10 text-indigo-300 border border-indigo-500/20"
                        >
                          {nt} (native)
                        </span>
                      ))}
                    </div>
                  )}
                </div>

                {/* Connectors */}
                <div className="rounded-lg border border-border bg-background-elevated/50 p-3.5 space-y-2">
                  <div className="flex items-center gap-2 text-xs font-semibold text-foreground">
                    <Plug className="size-4 text-emerald-400" />
                    <span>Connectors ({manifest.connectors.length})</span>
                  </div>
                  {manifest.connectors.length === 0 ? (
                    <p className="text-xs text-muted-foreground">No external connectors used.</p>
                  ) : (
                    <div className="flex flex-wrap gap-1.5">
                      {manifest.connectors.map((c, i) => (
                        <span
                          key={c.connector_id ?? i}
                          className="px-2 py-0.5 rounded text-[11px] font-mono bg-emerald-500/10 text-emerald-300 border border-emerald-500/20"
                        >
                          {c.connector_name || c.connector_id}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}
          </TabsContent>

          <TabsContent
            value="deploy"
            className="flex-1 overflow-y-auto custom-scrollbar py-3 space-y-5 text-sm"
          >
            <DeployWorkflowPanel workflowName={workflowName} />
            <div>
              <p className="eyebrow mb-2">Recent deployments of this workflow</p>
              <DeploymentHistory
                deployments={history.data}
                showServer
                showTarget={false}
                emptyTitle="Not deployed to any server yet"
              />
            </div>
          </TabsContent>
        </Tabs>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
          {tab === "download" ? (
            <Button asChild disabled={isLoading || isError} className="gap-2">
              <a
                href={workflowsApi.deploymentPackageUrl(workflowName)}
                download={`${workflowName}_deployment.zip`}
              >
                <Download className="size-4" /> Download Deployment Package
              </a>
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
