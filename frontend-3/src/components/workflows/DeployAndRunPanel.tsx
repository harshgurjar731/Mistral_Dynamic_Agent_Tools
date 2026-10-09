import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  CheckCircle2,
  ChevronDown,
  Circle,
  Loader2,
  Play,
  Plus,
  Rocket,
  Settings2,
  XCircle,
} from "lucide-react";
import { errorMessage, QK } from "@/api";
import { remoteServersApi, type RemoteDeployment } from "@/api/remoteServers";
import { DeploymentLog } from "@/components/remote-servers/Deployments";
import { RunOnServerPanel } from "@/components/remote-servers/RunOnServerPanel";
import { KeyValueRows, type KeyValueRow } from "@/components/remote-servers/remoteShared";
import { ServerStatusBadge } from "@/components/remote-servers/status";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { DeploySetupForm } from "./deploySetup";
import {
  emptySetup,
  setupProblems,
  setupRequest,
  type DeploymentManifest,
  type SetupState,
} from "./deploySetupModel";

const ACTIVE = new Set(["queued", "running"]);

/** A deploy stage, recognised by the log line the backend writes when it starts. */
type Stage = { label: string; marker: string };

function stagesFor(bundledCount: number): Stage[] {
  return [
    {
      label: bundledCount
        ? `Package the workflow with its ${bundledCount} tool & activity module${bundledCount === 1 ? "" : "s"}`
        : "Package the workflow",
      marker: "▶ Building deployment package",
    },
    { label: "Upload & extract on the server", marker: "▶ Uploading package" },
    { label: "Write .env (API key, worker queue)", marker: "▶ Writing .env" },
    {
      label: "Build & start the worker (creates the agents first)",
      marker: "▶ Building and starting the worker",
    },
    { label: "Wait for the worker to poll its queue", marker: "▶ Waiting for the worker" },
  ];
}

/** Index of the last stage the log has reached, or -1. */
function reachedStage(stages: Stage[], log: string): number {
  let reached = -1;
  stages.forEach((s, i) => {
    if (log.includes(s.marker)) reached = i;
  });
  return reached;
}

function StageList({
  stages,
  deployment,
}: {
  stages: Stage[];
  deployment: RemoteDeployment | undefined;
}) {
  const log = deployment?.log ?? "";
  const reached = reachedStage(stages, log);
  const status = deployment?.status;
  const ready = log.includes("✔ Worker is up");
  return (
    <ol className="space-y-1.5">
      {stages.map((s, i) => {
        const done = status === "succeeded" || i < reached;
        const current = !done && i === Math.max(reached, 0) && status != null;
        const failed = current && status === "failed";
        return (
          <li key={s.label} className="flex items-center gap-2 text-xs">
            {done ? (
              <CheckCircle2 className="size-3.5 shrink-0 text-emerald-400" />
            ) : failed ? (
              <XCircle className="size-3.5 shrink-0 text-red" />
            ) : current ? (
              <Loader2 className="size-3.5 shrink-0 animate-spin text-primary" />
            ) : (
              <Circle className="size-3.5 shrink-0 text-muted-foreground/50" />
            )}
            <span className={cn(done || current ? "text-foreground" : "text-muted-foreground")}>
              {s.label}
            </span>
          </li>
        );
      })}
      {status === "succeeded" ? (
        <li className="flex items-center gap-2 text-xs">
          {ready ? (
            <CheckCircle2 className="size-3.5 shrink-0 text-emerald-400" />
          ) : (
            <Circle className="size-3.5 shrink-0 text-amber" />
          )}
          <span className={ready ? "text-foreground" : "text-amber"}>
            {ready
              ? "Worker is polling — ready to run"
              : "Worker didn't report ready yet — check its logs before running"}
          </span>
        </li>
      ) : null}
    </ol>
  );
}

function rowsToRecord(rows: KeyValueRow[]): Record<string, string> {
  return Object.fromEntries(rows.filter((r) => r.key).map((r) => [r.key, r.value]));
}

/**
 * End to end on an SSH server, from the workflow page: upload the package
 * (tool and activity code bundled into the worker), write .env, start the
 * worker and wait for it to poll — then run the workflow on that worker.
 */
export function DeployAndRunPanel({
  workflowName,
  manifest,
}: {
  workflowName: string;
  manifest: DeploymentManifest;
}) {
  const qc = useQueryClient();
  const [serverId, setServerId] = useState("");
  const [setup, setSetup] = useState<SetupState>(emptySetup);
  const [noCache, setNoCache] = useState(false);
  const [extraEnv, setExtraEnv] = useState<KeyValueRow[]>([]);
  const [advanced, setAdvanced] = useState(false);
  const [deploymentId, setDeploymentId] = useState<number | null>(null);
  const [runWithoutDeploy, setRunWithoutDeploy] = useState(false);

  const servers = useQuery({
    queryKey: [...QK.remoteServers(), "workflow"],
    queryFn: () => remoteServersApi.list("workflow"),
  });
  // The whole flow runs docker compose over SSH; HTTP deploy endpoints can't.
  const sshServers = (servers.data ?? []).filter((s) => s.transport === "ssh");
  const target = sshServers.find((s) => String(s.id) === serverId);
  // Already on that server: its .env holds earlier answers, so blanks keep them.
  const onServer = useQuery({
    queryKey: QK.remoteServerWorkflows(serverId),
    queryFn: () => remoteServersApi.remoteWorkflows(serverId),
    enabled: Boolean(target),
  });
  const redeploy = Boolean(onServer.data?.items.some((w) => w.name === workflowName && w.env));
  const keptOnServer = redeploy ? (manifest.setup ?? []).map((f) => f.key) : [];
  const problems = setupProblems(manifest, setup, keptOnServer);

  const deployment = useQuery({
    queryKey: QK.remoteDeployment(deploymentId ?? 0),
    queryFn: () => remoteServersApi.deployment(deploymentId!),
    enabled: deploymentId != null,
    refetchInterval: (q) => (!q.state.data || ACTIVE.has(q.state.data.status) ? 1500 : false),
  });
  const status = deploymentId != null ? deployment.data?.status : undefined;
  const busy = status != null && ACTIVE.has(status);
  const deployed = status === "succeeded";

  const deploy = useMutation({
    mutationFn: () =>
      remoteServersApi.deployWorkflow(target!.id, {
        workflow_name: workflowName,
        action: "full",
        ...(() => {
          const req = setupRequest(manifest, setup);
          return { env: { ...rowsToRecord(extraEnv), ...req.env }, sql: req.sql };
        })(),
        no_cache: noCache,
      }),
    onSuccess: (dep) => {
      setDeploymentId(dep.id);
      setRunWithoutDeploy(false);
      // Values may be secrets; don't keep them in the form after sending.
      setSetup((s) => ({ ...s, env: {}, sqlUrl: "" }));
      setExtraEnv((rows) => rows.map((r) => ({ ...r, value: "" })));
      toast.success(`Deploying "${workflowName}" to ${target!.name}…`);
      qc.invalidateQueries({ queryKey: QK.workflowRemoteDeployments(workflowName) });
      qc.invalidateQueries({ queryKey: QK.remoteServerDeployments(String(target!.id)) });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  if (servers.data && sshServers.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-border/60 py-8 text-center">
        <p className="text-sm font-medium text-foreground">No SSH workflow servers yet</p>
        <p className="max-w-sm text-xs text-muted-foreground">
          Deploy & run needs a server reached over SSH (e.g. a Brev VM). HTTP deploy endpoints can
          still receive the package from the server page.
        </p>
        <Button size="sm" asChild>
          <Link to="/remote-servers/new" search={{ purpose: "workflow" }}>
            <Plus className="size-3.5" /> Add a server
          </Link>
        </Button>
      </div>
    );
  }

  const stages = stagesFor(manifest.dynamic_tools.length);

  return (
    <div className="space-y-5">
      {/* 1 · Configure */}
      <section className="space-y-3">
        <p className="eyebrow">1 · Server & settings</p>
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <Label className="text-xs">Server</Label>
            <Link
              to="/remote-servers"
              search={{ purpose: "workflow" }}
              className="inline-flex items-center gap-1 text-[11px] text-primary hover:underline"
            >
              <Settings2 className="size-3" /> Manage servers
            </Link>
          </div>
          <Select
            value={serverId}
            onValueChange={(v) => {
              setServerId(v);
              setDeploymentId(null);
              setRunWithoutDeploy(false);
            }}
            disabled={busy}
          >
            <SelectTrigger>
              <SelectValue
                placeholder={servers.isLoading ? "Loading servers…" : "Choose a server…"}
              />
            </SelectTrigger>
            <SelectContent>
              {sshServers.map((s) => (
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
            </div>
          ) : null}
        </div>

        {target ? (
          <DeploySetupForm
            manifest={manifest}
            value={setup}
            onChange={setSetup}
            keptOnServer={keptOnServer}
            disabled={busy}
          />
        ) : null}

        <button
          type="button"
          onClick={() => setAdvanced((a) => !a)}
          className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
        >
          <ChevronDown className={cn("size-3 transition-transform", advanced && "rotate-180")} />
          Advanced
        </button>
        {advanced ? (
          <div className="space-y-3 rounded-lg border border-border/60 p-3">
            <label className="flex cursor-pointer items-start gap-2">
              <Checkbox
                checked={noCache}
                onCheckedChange={(v) => setNoCache(v === true)}
                className="mt-0.5"
              />
              <span>
                <span className="block text-xs text-foreground">Rebuild from scratch</span>
                <span className="block text-[11px] text-muted-foreground">
                  docker compose build --no-cache — slower; use when an image seems stale
                </span>
              </span>
            </label>
            <div className="space-y-1.5">
              <Label className="text-xs">More .env values</Label>
              <KeyValueRows
                rows={extraEnv}
                onChange={setExtraEnv}
                keyPlaceholder="NAME"
                valuePlaceholder="value (masked)"
                secretValues
                addLabel="Add .env value"
              />
            </div>
          </div>
        ) : null}
      </section>

      {/* 2 · Deploy */}
      <section className="space-y-3">
        <p className="eyebrow">2 · Deploy, set up & start the worker</p>
        <StageList stages={stages} deployment={deployment.data} />
        <div className="flex flex-wrap items-center justify-end gap-2">
          {target && !busy && !deployed ? (
            <Button variant="ghost" size="sm" onClick={() => setRunWithoutDeploy(true)}>
              Already running there? Skip to run
            </Button>
          ) : null}
          <Button
            onClick={() => deploy.mutate()}
            disabled={!target || deploy.isPending || busy || problems.length > 0}
            title={problems.join("; ") || undefined}
            className="gap-2"
          >
            {deploy.isPending || busy ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Rocket className="size-4" />
            )}
            {deployed || status === "failed" ? "Deploy again" : "Deploy & start worker"}
          </Button>
        </div>
        {target && problems.length ? (
          <p className="text-right text-[11px] text-amber">{problems.join(" · ")}</p>
        ) : null}
        {deploymentId != null ? <DeploymentLog deploymentId={deploymentId} /> : null}
      </section>

      {/* 3 · Run */}
      {target && (deployed || runWithoutDeploy) ? (
        <section className="space-y-3">
          <p className="eyebrow flex items-center gap-1.5">
            <Play className="size-3" /> 3 · Run on {target.name}
          </p>
          <RunOnServerPanel key={target.id} server={target} workflow={workflowName} />
        </section>
      ) : null}
    </div>
  );
}
