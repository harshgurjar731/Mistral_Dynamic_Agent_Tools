import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2, Plus, Rocket, Server, Settings2 } from "lucide-react";
import { errorMessage, QK, workflowsApi } from "@/api";
import { remoteServersApi, type RemoteServer } from "@/api/remoteServers";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { DeploymentLog } from "./Deployments";
import { ServerStatusBadge } from "./status";

/**
 * Send a workflow package to a workflow-deployment server.
 *
 * Either the workflow is fixed (workflow page) and the user picks a server,
 * or the server is fixed (server page) and the user picks a workflow.
 */
export function DeployWorkflowPanel({
  workflowName,
  server,
}: {
  workflowName?: string;
  server?: RemoteServer;
}) {
  const qc = useQueryClient();
  const [serverId, setServerId] = useState<string>(server ? String(server.id) : "");
  const [workflow, setWorkflow] = useState<string>(workflowName ?? "");
  const [action, setAction] = useState("bootstrap");
  const [apiKey, setApiKey] = useState("");
  const [customCommand, setCustomCommand] = useState("");
  const [deploymentId, setDeploymentId] = useState<number | null>(null);

  const catalog = useQuery({
    queryKey: QK.remoteServerProviders(),
    queryFn: remoteServersApi.providers,
    staleTime: Infinity,
  });
  const servers = useQuery({
    queryKey: [...QK.remoteServers(), "workflow"],
    queryFn: () => remoteServersApi.list("workflow"),
    enabled: !server,
  });
  const workflows = useQuery({
    queryKey: QK.workflows(),
    queryFn: workflowsApi.list,
    enabled: !workflowName,
  });

  const target = server ?? servers.data?.find((s) => String(s.id) === serverId);
  const isSsh = target?.transport === "ssh";
  const hasStoredKey = Boolean(target?.secrets_set.includes("env_vars"));

  const deploy = useMutation({
    mutationFn: () =>
      remoteServersApi.deployWorkflow(target!.id, {
        workflow_name: workflow,
        action: isSsh ? action : "upload_only",
        mistral_api_key: apiKey || undefined,
        custom_command: action === "custom" ? customCommand : undefined,
      }),
    onSuccess: (dep) => {
      setDeploymentId(dep.id);
      setApiKey("");
      toast.success(`Deploying "${workflow}" to ${target!.name}…`);
      qc.invalidateQueries({ queryKey: ["remote-deployments"] });
      qc.invalidateQueries({ queryKey: QK.remoteServerDeployments(String(target!.id)) });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  if (!server && servers.data && servers.data.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-border/60 py-8 text-center">
        <Server className="size-6 text-muted-foreground" />
        <div>
          <p className="text-sm font-medium text-foreground">No workflow deployment servers yet</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Add a VM or deploy endpoint, then send this package to it directly.
          </p>
        </div>
        <Button size="sm" asChild>
          <Link to="/remote-servers/new" search={{ purpose: "workflow" }}>
            <Plus className="size-3.5" /> Add a server
          </Link>
        </Button>
      </div>
    );
  }

  const workflowOptions = workflows.data?.workflows ?? [];

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        {!server ? (
          <div className="space-y-1.5 sm:col-span-2">
            <div className="flex items-center justify-between">
              <Label className="text-xs">Target server</Label>
              <Link
                to="/remote-servers"
                search={{ purpose: "workflow" }}
                className="inline-flex items-center gap-1 text-[11px] text-primary hover:underline"
              >
                <Settings2 className="size-3" /> Manage servers
              </Link>
            </div>
            <Select value={serverId} onValueChange={setServerId}>
              <SelectTrigger>
                <SelectValue
                  placeholder={servers.isLoading ? "Loading servers…" : "Choose a server…"}
                />
              </SelectTrigger>
              <SelectContent>
                {(servers.data ?? []).map((s) => (
                  <SelectItem key={s.id} value={String(s.id)}>
                    <span className="flex items-center gap-2">
                      {s.name}
                      <span className="text-[10px] text-muted-foreground">{s.provider_label}</span>
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {target ? (
              <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                <ServerStatusBadge state={target.last_status ?? "unknown"} size="xs" />
                <span className="truncate font-mono">{target.url}</span>
                {target.last_status === "unreachable" ? (
                  <span className="text-red">Run checks on the server page first.</span>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : null}

        {!workflowName ? (
          <div className="space-y-1.5 sm:col-span-2">
            <Label className="text-xs">Workflow</Label>
            <Select value={workflow} onValueChange={setWorkflow}>
              <SelectTrigger>
                <SelectValue placeholder="Choose a workflow…" />
              </SelectTrigger>
              <SelectContent>
                {workflowOptions
                  .filter((w) => w.steps.length > 0)
                  .map((w) => (
                    <SelectItem key={w.name} value={w.name}>
                      {w.name}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </div>
        ) : null}

        {isSsh ? (
          <div className="space-y-1.5 sm:col-span-2">
            <Label className="text-xs">After upload</Label>
            <Select value={action} onValueChange={setAction}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(catalog.data?.workflow_actions ?? {}).map(([value, label]) => (
                  <SelectItem key={value} value={value}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ) : null}

        {isSsh && action === "custom" ? (
          <div className="space-y-1.5 sm:col-span-2">
            <Label className="text-xs">Command (runs in the workflow directory)</Label>
            <Textarea
              value={customCommand}
              onChange={(e) => setCustomCommand(e.target.value)}
              placeholder={
                (target?.config?.["post_deploy_command"] as string) ||
                "docker compose -f docker-compose.deploy.yml up -d --build backend"
              }
              rows={2}
              className="font-mono text-xs"
            />
            <p className="text-[11px] text-muted-foreground">
              Leave blank to use the server's default command.
            </p>
          </div>
        ) : null}

        {target ? (
          <div className="space-y-1.5 sm:col-span-2">
            <Label className="text-xs">Target MISTRAL_API_KEY (optional)</Label>
            <Input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder={
                hasStoredKey
                  ? "Using the server's stored environment — enter to override"
                  : "Key of the workspace the workflow will run in"
              }
              autoComplete="new-password"
            />
            <p className="text-[11px] text-muted-foreground">
              Written to the workflow's .env on the server{isSsh ? "" : " (sent in the env field)"};
              never stored here. An existing .env on the server is kept and updated.
            </p>
          </div>
        ) : null}
      </div>

      <div className="flex justify-end">
        <Button
          onClick={() => deploy.mutate()}
          disabled={!target || !workflow || deploy.isPending}
          className="gap-2"
        >
          {deploy.isPending ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Rocket className="size-4" />
          )}
          Deploy to server
        </Button>
      </div>

      {deploymentId ? <DeploymentLog deploymentId={deploymentId} /> : null}
    </div>
  );
}
