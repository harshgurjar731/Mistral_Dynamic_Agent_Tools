import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlertTriangle, Bot, Download, Loader2, Package, Plug, Rocket, Wrench } from "lucide-react";
import { errorMessage, workflowsApi, QK } from "@/api";
import { remoteServersApi } from "@/api/remoteServers";
import { DeploymentHistory } from "@/components/remote-servers/Deployments";
import { DeployAndRunPanel } from "@/components/workflows/DeployAndRunPanel";
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
import { DeploySetupForm } from "@/components/workflows/deploySetup";
import {
  downloadPackage,
  emptySetup,
  setupProblems,
  setupRequest,
  type DeploymentManifest,
  type SetupState,
} from "@/components/workflows/deploySetupModel";

type ModalTab = "download" | "deploy";

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
    error,
  } = useQuery<DeploymentManifest>({
    queryKey: QK.workflowDeploymentManifest(workflowName),
    queryFn: () => workflowsApi.getDeploymentManifest(workflowName),
    enabled: open && Boolean(workflowName),
    // A packaging problem (unapproved tool, tool service down) is an answer, not a blip.
    retry: false,
  });
  const activities = manifest?.dynamic_tools.filter((t) => t.purpose === "activity") ?? [];
  const agentTools = manifest?.dynamic_tools.filter((t) => t.purpose !== "activity") ?? [];
  const packagingError = isError ? (
    <div className="flex items-start gap-2 p-3 rounded-lg border border-red/30 bg-red/10 text-red text-xs">
      <AlertTriangle className="mt-0.5 size-4 shrink-0" />
      <span>{errorMessage(error) || "Failed to load deployment manifest."}</span>
    </div>
  ) : null;
  const [tab, setTab] = useState<ModalTab>("download");
  const [setup, setSetup] = useState<SetupState>(emptySetup);
  const downloadProblems = setupProblems(manifest, { ...setup, env: {} }).filter(
    (p) => !p.endsWith("is required"),
  );
  const download = useMutation({
    mutationFn: () => downloadPackage(workflowName, setupRequest(manifest, setup)),
    onError: (e) => toast.error(errorMessage(e)),
  });
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
            with its agents and the tested code of its activities and agent tools, ready to run as a
            single worker — download it, or deploy it to a server, start the worker and run it
            there.
          </DialogDescription>
        </DialogHeader>

        <Tabs
          value={tab}
          onValueChange={(v) => setTab(v as ModalTab)}
          className="flex min-h-0 flex-1 flex-col"
        >
          <TabsList className="self-start">
            <TabsTrigger value="download" className="gap-1.5">
              <Download className="size-3.5" /> Download
            </TabsTrigger>
            <TabsTrigger value="deploy" className="gap-1.5">
              <Rocket className="size-3.5" /> Deploy & run
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
              packagingError
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

                {/* Bundled code & native tools */}
                <div className="rounded-lg border border-border bg-background-elevated/50 p-3.5 space-y-2.5">
                  <div className="flex items-center gap-2 text-xs font-semibold text-foreground">
                    <Wrench className="size-4 text-pink-400" />
                    <span>
                      Code ({manifest.dynamic_tools.length + manifest.native_tools.length})
                    </span>
                  </div>
                  {manifest.dynamic_tools.length === 0 && manifest.native_tools.length === 0 ? (
                    <p className="text-xs text-muted-foreground">
                      No tools or activities required.
                    </p>
                  ) : (
                    <>
                      {[
                        {
                          title: "Activities — workflow steps, bundled into the worker",
                          items: activities,
                        },
                        {
                          title: "Agent tools — called by agents, bundled into the worker",
                          items: agentTools,
                        },
                      ].map((group) =>
                        group.items.length ? (
                          <div key={group.title} className="space-y-1">
                            <p className="text-[11px] text-muted-foreground">{group.title}</p>
                            <div className="flex flex-wrap gap-1.5">
                              {group.items.map((t) => (
                                <span
                                  key={t.name}
                                  className="px-2 py-0.5 rounded text-[11px] font-mono bg-pink-500/10 text-pink-300 border border-pink-500/20"
                                >
                                  {t.name}
                                  {t.version_no ? ` v${t.version_no}` : ""}
                                </span>
                              ))}
                            </div>
                          </div>
                        ) : null,
                      )}
                      {manifest.native_tools.length ? (
                        <div className="space-y-1">
                          <p className="text-[11px] text-muted-foreground">
                            Native — part of the backend
                          </p>
                          <div className="flex flex-wrap gap-1.5">
                            {manifest.native_tools.map((nt) => (
                              <span
                                key={nt}
                                className="px-2 py-0.5 rounded text-[11px] font-mono bg-indigo-500/10 text-indigo-300 border border-indigo-500/20"
                              >
                                {nt}
                              </span>
                            ))}
                          </div>
                        </div>
                      ) : null}
                    </>
                  )}
                  {manifest.uses_knowledge_graph ? (
                    <p className="text-[11px] text-amber">
                      An agent uses the knowledge graph. The package starts no Neo4j — set NEO4J_*
                      in the server's .env to an existing instance.
                    </p>
                  ) : null}
                </div>

                {/* Connectors */}
                <div className="rounded-lg border border-border bg-background-elevated/50 p-3.5 space-y-2">
                  <div className="flex items-center gap-2 text-xs font-semibold text-foreground">
                    <Plug className="size-4 text-emerald-400" />
                    <span>Connectors ({manifest.connectors.length})</span>
                  </div>
                  {manifest.connectors.length === 0 ? (
                    <p className="text-xs text-muted-foreground">No connectors used.</p>
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
                <div className="space-y-2">
                  <p className="eyebrow">Setup — written into the package's .env</p>
                  <DeploySetupForm manifest={manifest} value={setup} onChange={setSetup} />
                  <p className="text-[11px] text-muted-foreground">
                    Leave the fields blank to get only a .env.template to fill in on the server.
                    Filled in, the download contains your credentials — keep it private.
                  </p>
                </div>
              </div>
            )}
          </TabsContent>

          <TabsContent
            value="deploy"
            className="flex-1 overflow-y-auto custom-scrollbar py-3 space-y-5 text-sm"
          >
            {isLoading ? (
              <div className="flex items-center justify-center py-10 gap-2 text-muted-foreground">
                <Loader2 className="size-4 animate-spin" />
                <span>Analyzing deployment dependencies…</span>
              </div>
            ) : isError ? (
              packagingError
            ) : (
              manifest && <DeployAndRunPanel workflowName={workflowName} manifest={manifest} />
            )}
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
            <Button
              onClick={() => download.mutate()}
              disabled={isLoading || isError || download.isPending || downloadProblems.length > 0}
              title={downloadProblems.join("; ") || undefined}
              className="gap-2"
            >
              {download.isPending ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Download className="size-4" />
              )}
              Download Deployment Package
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
