import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Boxes, Hammer, Package, Play, Plus, RefreshCw, Rocket, Trash2, X } from "lucide-react";
import { QK } from "@/api";
import { remoteServersApi, type RemoteServer, type RemoteWorkflow } from "@/api/remoteServers";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { SectionCard } from "@/components/shared/SectionCard";
import { DeployWorkflowPanel } from "../DeployWorkflowPanel";
import { BuildWorkflowPanel } from "../BuildWorkflowPanel";
import { RunOnServerPanel } from "../RunOnServerPanel";
import { DeleteRemoteWorkflowDialog } from "../DeleteRemoteWorkflowDialog";
import { CommandRunOutput } from "../remoteShared";
import { timeAgo } from "../status";
import { containersUp } from "./tabs";
import { cn } from "@/lib/utils";

const tabTrigger =
  "gap-1.5 rounded-lg px-3 text-xs data-[state=active]:bg-primary/10 data-[state=active]:text-primary data-[state=active]:shadow-none";

/**
 * Everything you do with workflows on this server. SSH servers list what is
 * deployed; picking one walks its lifecycle — package, build & start, run.
 * Other servers can only receive packages, so they get the deploy form.
 */
export function WorkflowsTab({
  server,
  selected,
  onSelect,
}: {
  server: RemoteServer;
  selected: string | undefined;
  onSelect: (workflow: string | undefined) => void;
}) {
  if (server.transport !== "ssh") {
    return (
      <SectionCard
        icon={Rocket}
        title="Deploy a workflow"
        description="Builds the workflow's deployment package and sends it to this server's endpoint."
      >
        <DeployWorkflowPanel server={server} />
      </SectionCard>
    );
  }
  return <SshWorkflows server={server} selected={selected} onSelect={onSelect} />;
}

function SshWorkflows({
  server,
  selected,
  onSelect,
}: {
  server: RemoteServer;
  selected: string | undefined;
  onSelect: (workflow: string | undefined) => void;
}) {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: QK.remoteServerWorkflows(String(server.id)),
    queryFn: () => remoteServersApi.remoteWorkflows(server.id),
  });
  const items = q.data?.items ?? [];
  const current = items.find((w) => w.name === selected);

  const [deleting, setDeleting] = useState<RemoteWorkflow | null>(null);
  const [deleteRunId, setDeleteRunId] = useState<number | null>(null);
  // Same key CommandRunOutput polls; refresh the list once the deletion ends.
  const deleteRun = useQuery({
    queryKey: QK.remoteDeployment(deleteRunId ?? 0),
    queryFn: () => remoteServersApi.deployment(deleteRunId as number),
    enabled: deleteRunId != null,
  });
  const deleteStatus = deleteRun.data?.status;
  useEffect(() => {
    if (deleteStatus === "succeeded" || deleteStatus === "failed") {
      qc.invalidateQueries({ queryKey: QK.remoteServerWorkflows(String(server.id)) });
    }
  }, [deleteStatus, qc, server.id]);

  return (
    <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[18rem_minmax(0,1fr)] [&>*]:min-w-0">
      {/* ── Deployed workflows ── */}
      <aside
        className="rounded-2xl border border-border/60 backdrop-blur-md lg:sticky lg:top-6"
        style={{ background: "var(--surface)" }}
      >
        <div className="flex items-center gap-2 border-b border-border/40 px-4 py-3">
          <p className="text-xs font-semibold text-foreground">On this server</p>
          <span className="rounded-full border border-border/60 px-1.5 text-[10px] text-muted-foreground tabular-nums">
            {items.length}
          </span>
          <Button
            size="icon"
            variant="ghost"
            className="ml-auto size-7"
            onClick={() => q.refetch()}
            disabled={q.isFetching}
            aria-label="Refresh"
          >
            <RefreshCw className={cn("size-3.5", q.isFetching && "animate-spin")} />
          </Button>
        </div>

        <div className="space-y-1 p-2">
          <button
            type="button"
            onClick={() => onSelect(undefined)}
            className={cn(
              "flex w-full items-center gap-2.5 rounded-xl border border-dashed px-3 py-2.5 text-left text-xs transition",
              selected == null
                ? "border-primary/50 bg-primary/10 text-primary"
                : "border-border/60 text-muted-foreground hover:border-primary/30 hover:text-foreground",
            )}
          >
            <Plus className="size-3.5" />
            Deploy a workflow
          </button>

          {q.isLoading ? (
            <div className="space-y-1.5 p-1" aria-label="Loading workflows">
              {[0, 1, 2].map((i) => (
                <Skeleton key={i} className="h-10 rounded-xl" />
              ))}
            </div>
          ) : q.data?.error ? (
            <p className="px-2 py-3 text-[11px] text-red">{q.data.error}</p>
          ) : items.length === 0 ? (
            <p className="px-2 py-4 text-center text-[11px] text-muted-foreground">
              Nothing deployed yet.
            </p>
          ) : (
            items.map((w) => {
              const up = containersUp(w);
              const active = w.name === selected;
              return (
                <div
                  key={w.name}
                  className={cn(
                    "group flex items-center gap-1 rounded-xl border transition",
                    active
                      ? "border-primary/40 bg-primary/10"
                      : "border-transparent hover:border-border/60 hover:bg-surface-hover",
                  )}
                >
                  <button
                    type="button"
                    onClick={() => onSelect(w.name)}
                    className="min-w-0 flex-1 px-3 py-2 text-left"
                  >
                    <span className="flex items-center gap-2">
                      <span
                        className={cn(
                          "size-1.5 shrink-0 rounded-full",
                          up ? "bg-emerald" : "bg-muted-foreground/40",
                        )}
                      />
                      <span
                        className={cn(
                          "truncate font-mono text-xs",
                          active ? "text-primary" : "text-foreground",
                        )}
                      >
                        {w.name}
                      </span>
                    </span>
                    <span className="mt-0.5 block pl-3.5 text-[10px] text-muted-foreground">
                      {up}/{w.containers.length} up · {w.env ? ".env" : "no .env"} ·{" "}
                      {timeAgo(w.modified)}
                    </span>
                  </button>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="mr-1 size-7 shrink-0 text-muted-foreground opacity-0 group-hover:opacity-100 hover:bg-red/10 hover:text-red focus-visible:opacity-100"
                    onClick={() => setDeleting(w)}
                    aria-label={`Delete ${w.name} from the server`}
                    title="Delete from server"
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                </div>
              );
            })
          )}
        </div>
      </aside>

      {/* ── Selected workflow / deploy form ── */}
      <div className="min-w-0 space-y-4">
        {deleteRunId != null ? (
          <SectionCard
            icon={Trash2}
            title="Deleting from server"
            actions={
              <Button
                size="icon"
                variant="ghost"
                className="size-7"
                onClick={() => setDeleteRunId(null)}
                aria-label="Dismiss"
              >
                <X className="size-3.5" />
              </Button>
            }
          >
            <CommandRunOutput deploymentId={deleteRunId} />
          </SectionCard>
        ) : null}

        {current ? (
          <WorkflowLifecycle
            key={current.name}
            server={server}
            workflow={current}
            onDelete={() => setDeleting(current)}
          />
        ) : (
          <SectionCard
            icon={Rocket}
            title="Deploy a workflow"
            description="Packages a workflow from this app, uploads it to the server and sets up its .env. Then build and run it from its page here."
          >
            <DeployWorkflowPanel server={server} />
          </SectionCard>
        )}
      </div>

      {deleting ? (
        <DeleteRemoteWorkflowDialog
          server={server}
          workflow={deleting}
          open
          onOpenChange={(o) => !o && setDeleting(null)}
          onStarted={(id) => {
            setDeleteRunId(id);
            if (deleting.name === selected) onSelect(undefined);
          }}
        />
      ) : null}
    </div>
  );
}

const STEPS = [
  { id: "package", n: 1, label: "Package", icon: Package },
  { id: "build", n: 2, label: "Build & start", icon: Hammer },
  { id: "run", n: 3, label: "Run", icon: Play },
] as const;

/** One deployed workflow: its state, and its three lifecycle steps as tabs. */
function WorkflowLifecycle({
  server,
  workflow,
  onDelete,
}: {
  server: RemoteServer;
  workflow: RemoteWorkflow;
  onDelete: () => void;
}) {
  const up = containersUp(workflow);
  // Land on the step that comes next: build until something runs, then run.
  const [step, setStep] = useState<string>(up > 0 ? "run" : "build");

  return (
    <section
      className="rounded-2xl border border-border/60 backdrop-blur-md"
      style={{ background: "var(--surface)" }}
    >
      <header className="flex flex-wrap items-start gap-3 border-b border-border/40 px-5 py-4">
        <div className="grid size-9 shrink-0 place-items-center rounded-lg border border-cyan/25 bg-cyan/10 text-cyan">
          <Boxes className="size-4" />
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="truncate font-mono text-sm font-semibold text-foreground">
            {workflow.name}
          </h2>
          <div className="mt-1.5 flex flex-wrap gap-1.5 text-[10px]">
            <span
              className={cn(
                "rounded border px-1.5 py-px",
                up ? "border-emerald/30 text-emerald" : "border-border text-muted-foreground",
              )}
            >
              {up}/{workflow.containers.length} containers up
            </span>
            <span
              className={cn(
                "rounded border px-1.5 py-px",
                workflow.env ? "border-emerald/30 text-emerald" : "border-amber/30 text-amber",
              )}
            >
              {workflow.env ? ".env present" : "no .env"}
            </span>
            <span className="rounded border border-border px-1.5 py-px text-muted-foreground">
              deployed {timeAgo(workflow.modified)}
            </span>
          </div>
        </div>
        <Button
          size="sm"
          variant="ghost"
          className="text-muted-foreground hover:bg-red/10 hover:text-red"
          onClick={onDelete}
        >
          <Trash2 className="size-3.5" /> Delete
        </Button>
      </header>

      {workflow.containers.length > 0 ? (
        <div className="flex flex-wrap gap-1.5 border-b border-border/40 px-5 py-2.5">
          {workflow.containers.map((c) => (
            <span
              key={c.name}
              title={c.status}
              className="inline-flex items-center gap-1.5 rounded-md border border-border/50 bg-background-elevated/60 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground"
            >
              <span
                className={cn(
                  "size-1.5 rounded-full",
                  c.status.startsWith("Up") ? "bg-emerald" : "bg-red",
                )}
              />
              {c.name}
            </span>
          ))}
        </div>
      ) : null}

      <Tabs value={step} onValueChange={setStep} className="p-5">
        <TabsList className="h-10 rounded-xl border border-border/50 bg-surface/40 p-1">
          {STEPS.map((s) => (
            <TabsTrigger key={s.id} value={s.id} className={tabTrigger}>
              <span className="grid size-4 place-items-center rounded-full border border-current text-[9px]">
                {s.n}
              </span>
              {s.label}
            </TabsTrigger>
          ))}
        </TabsList>

        <TabsContent value="package" className="mt-4">
          <p className="mb-4 text-xs text-muted-foreground">
            Re-send the latest version of this workflow. The server's .env is kept and updated.
          </p>
          <DeployWorkflowPanel server={server} workflowName={workflow.name} />
        </TabsContent>
        <TabsContent value="build" className="mt-4">
          <p className="mb-4 text-xs text-muted-foreground">
            Build the workflow's containers with docker compose and start the worker.
          </p>
          <BuildWorkflowPanel server={server} workflow={workflow.name} />
        </TabsContent>
        <TabsContent value="run" className="mt-4">
          <p className="mb-4 text-xs text-muted-foreground">
            Start a run on this server's worker and follow it live.
            {up === 0 ? (
              <span className="text-amber"> No containers are up yet — build & start first.</span>
            ) : null}
          </p>
          <RunOnServerPanel server={server} workflow={workflow.name} />
        </TabsContent>
      </Tabs>
    </section>
  );
}
