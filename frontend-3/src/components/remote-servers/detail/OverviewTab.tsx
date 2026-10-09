import { useQuery } from "@tanstack/react-query";
import { ArrowRight, Boxes, Check, History, Loader2, PartyPopper, Stethoscope } from "lucide-react";
import { QK } from "@/api";
import {
  remoteServersApi,
  type CheckReport,
  type RemoteDeployment,
  type RemoteServer,
  type RemoteWorkflow,
} from "@/api/remoteServers";
import { Button } from "@/components/ui/button";
import { SectionCard } from "@/components/shared/SectionCard";
import { DeploymentHistory } from "../Deployments";
import { timeAgo } from "../status";
import { containersUp, type ServerTab } from "./tabs";
import { cn } from "@/lib/utils";

type Go = (tab: ServerTab, workflow?: string) => void;

interface SetupStep {
  title: string;
  hint: string;
  done: boolean;
  action: { label: string; run: () => void; busy?: boolean };
}

/** The steps from "added" to "doing its job", ticked from data the page already has. */
function setupSteps({
  server,
  report,
  deployments,
  workflows,
  checking,
  onCheck,
  go,
}: {
  server: RemoteServer;
  report: CheckReport | null | undefined;
  deployments: RemoteDeployment[];
  workflows: RemoteWorkflow[] | undefined;
  checking: boolean;
  onCheck: () => void;
  go: Go;
}): SetupStep[] {
  const connected = report?.status === "healthy" || report?.status === "degraded";
  const steps: SetupStep[] = [
    {
      title: "Connected",
      hint: connected
        ? `Reachable — ${report?.checks.filter((c) => c.status === "pass").length ?? 0} checks passed`
        : report
          ? "The last diagnostics could not reach the server"
          : "Run diagnostics to confirm the server is reachable",
      done: connected,
      action: { label: "Run diagnostics", run: onCheck, busy: checking },
    },
  ];
  const succeeded = (kind: RemoteDeployment["kind"]) =>
    deployments.some((d) => d.kind === kind && d.status === "succeeded");

  if (server.purpose === "tool") {
    steps.push({
      title: "Tool pushed",
      hint: "Send a dynamic tool's code to this endpoint",
      done: succeeded("tool"),
      action: { label: "Push a tool", run: () => go("push") },
    });
    return steps;
  }
  if (server.transport !== "ssh") {
    steps.push({
      title: "Package sent",
      hint: "Send a workflow's deployment package to this endpoint",
      done: succeeded("workflow"),
      action: { label: "Deploy a workflow", run: () => go("workflows") },
    });
    return steps;
  }

  const list = workflows ?? [];
  const running = list.find((w) => containersUp(w) > 0);
  const worker = list.find((w) =>
    w.containers.some((c) => c.name.includes("backend") && c.status.startsWith("Up")),
  );
  steps.push(
    {
      title: "Workflow deployed",
      hint: list.length
        ? `${list.length} workflow package${list.length === 1 ? "" : "s"} on the server`
        : "Upload a workflow package to the server",
      done: list.length > 0,
      action: { label: "Deploy a workflow", run: () => go("workflows") },
    },
    {
      title: "Built & started",
      hint: running ? `${running.name} has containers up` : "Build its containers and start them",
      done: Boolean(running),
      action: { label: "Build & start", run: () => go("workflows", list[0]?.name) },
    },
    {
      title: "Worker running",
      hint: worker
        ? `${worker.name}'s worker is polling for runs`
        : "The backend container runs the worker that picks up runs",
      done: Boolean(worker),
      action: {
        label: "Open workflow",
        run: () => go("workflows", (running ?? list[0])?.name),
      },
    },
  );
  return steps;
}

export function OverviewTab({
  server,
  report,
  deployments,
  checking,
  onCheck,
  go,
}: {
  server: RemoteServer;
  report: CheckReport | null | undefined;
  deployments: RemoteDeployment[];
  checking: boolean;
  onCheck: () => void;
  go: Go;
}) {
  const isSshWorkflow = server.purpose === "workflow" && server.transport === "ssh";
  const workflows = useQuery({
    queryKey: QK.remoteServerWorkflows(String(server.id)),
    queryFn: () => remoteServersApi.remoteWorkflows(server.id),
    enabled: isSshWorkflow,
  });
  const items = workflows.data?.items;
  const steps = setupSteps({
    server,
    report,
    deployments,
    workflows: items,
    checking,
    onCheck,
    go,
  });
  const next = steps.findIndex((s) => !s.done);
  const issues = (report?.checks ?? []).filter((c) => c.status === "fail" || c.status === "warn");

  return (
    <div className="space-y-4">
      {/* ── Setup progress ── */}
      {next === -1 ? (
        <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-emerald/25 bg-emerald/5 px-5 py-4">
          <PartyPopper className="size-5 text-emerald" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-foreground">This server is ready</p>
            <p className="text-xs text-muted-foreground">
              {isSshWorkflow
                ? "A worker is up. Start runs from the workflow's Run step."
                : "Everything is set up."}
            </p>
          </div>
          {isSshWorkflow ? (
            <Button
              size="sm"
              onClick={() =>
                go("workflows", items?.find((w) => containersUp(w) > 0)?.name ?? items?.[0]?.name)
              }
            >
              Run a workflow <ArrowRight className="size-3.5" />
            </Button>
          ) : null}
        </div>
      ) : (
        <section
          className="rounded-2xl border border-border/60 backdrop-blur-md"
          style={{ background: "var(--surface)" }}
        >
          <header className="flex items-center gap-3 border-b border-border/40 px-5 py-4">
            <div className="min-w-0 flex-1">
              <h2 className="text-sm font-semibold text-foreground">Get this server ready</h2>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {steps.filter((s) => s.done).length} of {steps.length} done
              </p>
            </div>
            <div className="hidden h-1.5 w-40 overflow-hidden rounded-full bg-muted/50 sm:block">
              <div
                className="h-full rounded-full bg-gradient-brand transition-all"
                style={{
                  width: `${(steps.filter((s) => s.done).length / steps.length) * 100}%`,
                }}
              />
            </div>
          </header>
          <ol className="divide-y divide-border/40">
            {steps.map((s, i) => {
              const isNext = i === next;
              return (
                <li
                  key={s.title}
                  className={cn("flex items-center gap-3 px-5 py-3", isNext && "bg-primary/[0.04]")}
                >
                  <span
                    className={cn(
                      "grid size-6 shrink-0 place-items-center rounded-full border text-[11px] font-medium",
                      s.done
                        ? "border-emerald/30 bg-emerald/15 text-emerald"
                        : isNext
                          ? "border-primary/40 bg-primary/15 text-primary"
                          : "border-border text-muted-foreground",
                    )}
                  >
                    {s.done ? <Check className="size-3" /> : i + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p
                      className={cn(
                        "text-sm",
                        s.done || isNext ? "text-foreground" : "text-muted-foreground",
                      )}
                    >
                      {s.title}
                    </p>
                    <p className="truncate text-[11px] text-muted-foreground">{s.hint}</p>
                  </div>
                  {isNext ? (
                    <Button size="sm" onClick={s.action.run} disabled={s.action.busy}>
                      {s.action.busy ? <Loader2 className="size-3.5 animate-spin" /> : null}
                      {s.action.label}
                      {s.action.busy ? null : <ArrowRight className="size-3.5" />}
                    </Button>
                  ) : null}
                </li>
              );
            })}
          </ol>
        </section>
      )}

      <div
        className={cn(
          "grid grid-cols-1 items-start gap-4 [&>*]:min-w-0",
          isSshWorkflow && "lg:grid-cols-2",
        )}
      >
        {/* ── Workflows at a glance ── */}
        {isSshWorkflow ? (
          <SectionCard
            icon={Boxes}
            title="Workflows on this server"
            actions={
              <Button size="sm" variant="ghost" onClick={() => go("workflows")}>
                Manage <ArrowRight className="size-3.5" />
              </Button>
            }
            bodyClassName="p-2"
          >
            {workflows.isLoading ? (
              <p className="px-3 py-4 text-xs text-muted-foreground">Loading…</p>
            ) : workflows.data?.error ? (
              <p className="px-3 py-4 text-xs text-red">{workflows.data.error}</p>
            ) : !items?.length ? (
              <p className="px-3 py-6 text-center text-xs text-muted-foreground">
                Nothing deployed yet.
              </p>
            ) : (
              <ul>
                {items.map((w) => {
                  const up = containersUp(w);
                  return (
                    <li key={w.name}>
                      <button
                        type="button"
                        onClick={() => go("workflows", w.name)}
                        className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left transition hover:bg-surface-hover"
                      >
                        <span
                          className={cn(
                            "size-1.5 shrink-0 rounded-full",
                            up ? "bg-emerald" : "bg-muted-foreground/40",
                          )}
                        />
                        <span className="truncate font-mono text-xs text-foreground">{w.name}</span>
                        <span className="ml-auto shrink-0 text-[10px] text-muted-foreground">
                          {up}/{w.containers.length} up · {timeAgo(w.modified)}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </SectionCard>
        ) : null}

        <div className="space-y-4">
          {/* ── Diagnostics issues ── */}
          {issues.length > 0 ? (
            <SectionCard
              icon={Stethoscope}
              title="Needs attention"
              actions={
                <Button size="sm" variant="ghost" onClick={() => go("settings")}>
                  Diagnostics <ArrowRight className="size-3.5" />
                </Button>
              }
              bodyClassName="space-y-1.5 px-5 py-3"
            >
              {issues.map((c) => (
                <p key={c.id} className="text-xs">
                  <span className={c.status === "fail" ? "text-red" : "text-amber"}>{c.label}</span>
                  <span className="text-muted-foreground"> — {c.detail}</span>
                </p>
              ))}
            </SectionCard>
          ) : null}

          {/* ── Recent activity ── */}
          <SectionCard
            icon={History}
            title="Recent activity"
            actions={
              deployments.length > 5 ? (
                <Button size="sm" variant="ghost" onClick={() => go("activity")}>
                  All {deployments.length} <ArrowRight className="size-3.5" />
                </Button>
              ) : null
            }
          >
            <DeploymentHistory deployments={deployments.slice(0, 5)} emptyTitle="Nothing yet" />
          </SectionCard>
        </div>
      </div>
    </div>
  );
}
