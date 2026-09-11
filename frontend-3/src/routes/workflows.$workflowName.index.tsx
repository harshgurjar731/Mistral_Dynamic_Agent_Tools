import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import {
  ArrowLeft,
  Columns,
  Download,
  History,
  Loader2,
  Map,
  Package,
  Pencil,
  Play,
  RefreshCw,
  Rocket,
  Rows,
  Tag,
} from "lucide-react";
import { errorMessage, executionsApi, QK, workflowsApi } from "@/api";
import { PageHeader, StatTile } from "@/components/shared/PageHeader";
import { GlassPanel, GlassPanelHeader } from "@/components/glass/GlassPanel";
import { GraphCanvas } from "@/components/graph/GraphCanvas";
import { GraphLegend } from "@/components/graph/Legend";
import { stepsToGraph } from "@/components/graph/fromDefinition";
import { CodeBlock } from "@/components/shared/CodeBlock";
import { DeployBadge, SourceBadge } from "@/components/workflows/WorkflowCard";
import { WorkflowHistoryPanel } from "@/components/workflows/HistoryPanel";
import { IssueList, ValidationSummary } from "@/components/workflows/ValidationPanel";
import { DeployPackageModal } from "@/components/workflows/DeployPackageModal";
import { WorkflowClassificationModal } from "@/components/workflows/WorkflowClassificationModal";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { StatusPill } from "@/components/ui/StatusPill";
import { DetailSkeleton, TableSkeleton } from "@/components/ui/Skeletons";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { executionStatusIdentity, formatDuration, formatTimestamp } from "@/lib/status";

export const Route = createFileRoute("/workflows/$workflowName/")({
  head: ({ params }) => ({
    meta: [
      { title: `${params.workflowName} — Agentic AI Design Patterns` },
      {
        name: "description",
        content: `Definition, compiled module and runs for ${params.workflowName}.`,
      },
      { property: "og:title", content: `${params.workflowName} — Agentic AI Design Patterns` },
      {
        property: "og:description",
        content: `Definition, compiled module and runs for ${params.workflowName}.`,
      },
    ],
  }),
  component: WorkflowDetailPage,
});

function WorkflowDetailPage() {
  const { workflowName } = Route.useParams();
  const qc = useQueryClient();
  const [historyOpen, setHistoryOpen] = useState(false);
  const [deployOpen, setDeployOpen] = useState(false);
  const [classifyOpen, setClassifyOpen] = useState(false);
  const [direction, setDirection] = useState<"LR" | "TB">("LR");
  const [showMinimap, setShowMinimap] = useState(true);

  const wf = useQuery({
    queryKey: QK.workflow(workflowName),
    queryFn: () => workflowsApi.get(workflowName),
  });

  const definition = wf.data;
  const remoteOnly = (definition?.steps?.length ?? 0) === 0;

  const validation = useQuery({
    queryKey: [...QK.workflow(workflowName), "validation"],
    queryFn: () => workflowsApi.validate(definition!),
    enabled: Boolean(definition) && !remoteOnly,
  });

  const script = useQuery({
    queryKey: QK.workflowScript(workflowName),
    queryFn: () => workflowsApi.script(workflowName),
    enabled: Boolean(definition) && !remoteOnly,
    retry: false,
  });

  const metrics = useQuery({
    queryKey: [...QK.workflow(workflowName), "metrics"],
    queryFn: () => workflowsApi.metrics(workflowName),
  });

  const runs = useQuery({
    queryKey: [...QK.workflow(workflowName), "executions"],
    queryFn: () => executionsApi.list({ workflow_identifier: workflowName, page_size: 8 }),
  });

  const publish = useMutation({
    mutationFn: () => workflowsApi.publish(workflowName),
    onSuccess: (res) => {
      toast.success(String(res["message"] ?? "Workflow published"));
      qc.invalidateQueries({ queryKey: QK.workflow(workflowName) });
      qc.invalidateQueries({ queryKey: QK.workflows() });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const exportMutation = useMutation({
    mutationFn: () => workflowsApi.exportToMistral(workflowName),
    onSuccess: (res) => {
      toast.success(
        res.file_path ? `Workflow exported to ${res.file_path}` : (res.error ?? "Workflow exported"),
      );
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const graph = useMemo(
    () =>
      definition
        ? stepsToGraph(definition, validation.data?.issues ?? [], direction)
        : { nodes: [], edges: [] },
    [definition, validation.data, direction],
  );

  if (wf.isLoading) {
    return (
      <div className="px-6 py-8">
        <DetailSkeleton />
      </div>
    );
  }
  if (wf.isError) {
    return (
      <div className="px-6 py-8">
        <ErrorState error={wf.error} onRetry={() => wf.refetch()} />
      </div>
    );
  }
  if (!definition) {
    return (
      <div className="px-6 py-8">
        <EmptyState title="Workflow not found." />
      </div>
    );
  }

  const m = metrics.data;
  const metricsUnavailable = m?.available === false;

  return (
    <div className="space-y-6 px-6 py-8">
      <PageHeader
        eyebrow="Workflow"
        title={
          <span className="flex flex-wrap items-center gap-2.5">
            <span className="break-all">{definition.name}</span>
            <SourceBadge source={definition.source} />
            <DeployBadge workflow={definition} />
          </span>
        }
        description={definition.description || "No description."}
        actions={
          <>
            <Button variant="outline" size="sm" asChild>
              <Link to="/workflows">
                <ArrowLeft className="size-3.5" /> All
              </Link>
            </Button>
            <Button variant="outline" size="sm" onClick={() => setHistoryOpen(true)}>
              <History className="size-3.5" /> History
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => exportMutation.mutate()}
              disabled={exportMutation.isPending}
              title="Export to Mistral workflow format"
            >
              {exportMutation.isPending ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Download className="size-3.5" />
              )}
              Export
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setDeployOpen(true)}
              title="Package workflow for deployment"
            >
              <Package className="size-3.5" /> Package
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setClassifyOpen(true)}
              title="Classify workflow domain"
            >
              <Tag className="size-3.5" /> Classify
            </Button>
            {!remoteOnly ? (
              <>
                <Button variant="outline" size="sm" asChild>
                  <Link to="/workflows/$workflowName/edit" params={{ workflowName }}>
                    <Pencil className="size-3.5" /> Edit
                  </Link>
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => publish.mutate()}
                  disabled={publish.isPending}
                >
                  {publish.isPending ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : (
                    <Rocket className="size-3.5" />
                  )}
                  {definition.has_unpublished_changes || !definition.is_deployed
                    ? "Publish"
                    : "Republish"}
                </Button>
              </>
            ) : null}
            <Button size="sm" asChild>
              <Link to="/workflows/$workflowName/execute" params={{ workflowName }}>
                <Play className="size-3.5" /> Run
              </Link>
            </Button>
          </>
        }
      />

      <div
        className="grid grid-cols-2 gap-3 sm:grid-cols-5"
        title={metricsUnavailable ? (m?.detail ?? "") : ""}
      >
        <StatTile label="Steps" value={remoteOnly ? "—" : definition.steps.length} />
        <StatTile label="Runs" value={metricsUnavailable ? "—" : (m?.execution_count ?? "—")} />
        <StatTile
          label="Succeeded"
          value={metricsUnavailable ? "—" : (m?.success_count ?? "—")}
          tone="emerald"
        />
        <StatTile
          label="Failed"
          value={metricsUnavailable ? "—" : (m?.error_count ?? "—")}
          tone="red"
        />
        <StatTile
          label="Avg latency"
          value={metricsUnavailable ? "—" : formatDuration(m?.average_latency_ms ?? null)}
          tone="blue"
        />
      </div>

      {remoteOnly ? (
        <GlassPanel className="border-amber/25 bg-amber/5 p-4">
          <p className="text-sm font-semibold text-foreground">Registered remotely</p>
          <p className="mt-1 text-xs text-muted-foreground">
            This workflow exists on the Mistral server but has no local definition, so there is no
            graph, script or validation to show. It can still be run and monitored.
          </p>
        </GlassPanel>
      ) : (
        <Tabs defaultValue="graph">
          <TabsList>
            <TabsTrigger value="graph">Graph</TabsTrigger>
            <TabsTrigger value="steps">Steps</TabsTrigger>
            <TabsTrigger value="script">Compiled module</TabsTrigger>
            <TabsTrigger value="issues">
              Validation
              {validation.data && validation.data.issues.length > 0
                ? ` (${validation.data.issues.length})`
                : ""}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="graph" className="mt-4">
            <GlassPanel className="overflow-hidden">
              <GraphCanvas
                nodes={graph.nodes}
                edges={graph.edges}
                readOnly
                showMinimap={showMinimap}
                className="h-[540px] w-full"
                overlay={
                  <>
                    <GraphLegend />
                    <div className="pointer-events-auto flex items-center gap-1.5 rounded-lg border border-border bg-background-elevated/90 p-1 backdrop-blur-sm shadow-sm">
                      <Button
                        size="sm"
                        variant={direction === "LR" ? "secondary" : "ghost"}
                        onClick={() => setDirection("LR")}
                        title="Horizontal layout (Left to Right)"
                        className="h-7 text-xs"
                      >
                        <Columns className="size-3" /> LR
                      </Button>
                      <Button
                        size="sm"
                        variant={direction === "TB" ? "secondary" : "ghost"}
                        onClick={() => setDirection("TB")}
                        title="Vertical layout (Top to Bottom)"
                        className="h-7 text-xs"
                      >
                        <Rows className="size-3" /> TB
                      </Button>
                      <div className="h-3 w-px bg-border mx-0.5" />
                      <Button
                        size="sm"
                        variant={showMinimap ? "secondary" : "ghost"}
                        onClick={() => setShowMinimap(!showMinimap)}
                        title="Toggle minimap"
                        className="h-7 text-xs"
                      >
                        <Map className="size-3" /> Minimap
                      </Button>
                    </div>
                  </>
                }
              />
            </GlassPanel>
          </TabsContent>

          <TabsContent value="steps" className="mt-4">
            <GlassPanel>
              <GlassPanelHeader
                title="Steps"
                description={`Entry point: ${definition.entry_step || "—"}`}
              />
              <div className="divide-y divide-border">
                {definition.steps.map((s) => (
                  <div key={s.id} className="px-5 py-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-xs font-semibold text-foreground">
                        {s.id}
                      </span>
                      <span className="technical-label">{s.type}</span>
                      {s.tier ? <span className="technical-label">tier · {s.tier}</span> : null}
                      {s.parallel_group ? (
                        <span className="font-mono text-[10px] text-cyan">
                          ∥ {s.parallel_group}
                        </span>
                      ) : null}
                      {s.id === definition.entry_step ? (
                        <span className="rounded border border-emerald/30 bg-emerald/10 px-1.5 py-0.5 font-mono text-[9px] font-bold text-emerald uppercase">
                          entry
                        </span>
                      ) : null}
                    </div>
                    {s.description ? (
                      <p className="mt-1 text-xs text-muted-foreground">{s.description}</p>
                    ) : null}
                    {s.next_steps.length > 0 ? (
                      <p className="mt-1 font-mono text-[10px] text-muted-foreground">
                        → {s.next_steps.join(", ")}
                      </p>
                    ) : null}
                  </div>
                ))}
              </div>
            </GlassPanel>
          </TabsContent>

          <TabsContent value="script" className="mt-4">
            <GlassPanel>
              <GlassPanelHeader
                title="Compiled module"
                description={
                  script.data
                    ? `${script.data.line_count} lines${script.data.stale ? " · stale — republish to refresh" : ""}`
                    : "Generated from the definition"
                }
                actions={
                  <Button size="sm" variant="ghost" onClick={() => script.refetch()}>
                    <RefreshCw className="size-3.5" />
                  </Button>
                }
              />
              <div className="p-4">
                {script.isLoading ? (
                  <TableSkeleton rows={6} />
                ) : script.isError ? (
                  <ErrorState error={script.error} onRetry={() => script.refetch()} />
                ) : script.data ? (
                  <CodeBlock
                    code={script.data.code}
                    className="custom-scrollbar max-h-[540px] overflow-auto"
                  />
                ) : (
                  <EmptyState title="No compiled module yet." />
                )}
              </div>
            </GlassPanel>
          </TabsContent>

          <TabsContent value="issues" className="mt-4">
            <GlassPanel>
              <GlassPanelHeader
                title="Validation"
                description="Errors block publishing; warnings do not."
                actions={
                  <ValidationSummary result={validation.data} pending={validation.isFetching} />
                }
              />
              <div className="p-4">
                <IssueList issues={validation.data?.issues ?? []} />
              </div>
            </GlassPanel>
          </TabsContent>
        </Tabs>
      )}

      <GlassPanel>
        <GlassPanelHeader
          title="Recent runs"
          description={runs.data ? `${runs.data.count} shown` : undefined}
          actions={
            <Button size="sm" variant="ghost" asChild>
              <Link to="/workflows/$workflowName/execute" params={{ workflowName }}>
                New run
              </Link>
            </Button>
          }
        />
        <div className="p-4">
          {runs.isLoading ? (
            <TableSkeleton rows={4} />
          ) : runs.isError ? (
            <ErrorState error={runs.error} onRetry={() => runs.refetch()} />
          ) : (runs.data?.executions.length ?? 0) === 0 ? (
            <EmptyState title="No runs yet." description="Execute the workflow to see runs here." />
          ) : (
            <ul className="space-y-2">
              {runs.data?.executions.map((e) => (
                <li
                  key={e.execution_id}
                  className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-background-elevated/60 px-3 py-2"
                >
                  <Link
                    to="/workflows/$workflowName/execute"
                    params={{ workflowName: e.workflow_name }}
                    search={{ execId: e.execution_id }}
                    className="min-w-0 flex-1 truncate font-mono text-xs text-foreground hover:text-primary"
                  >
                    {e.execution_id}
                  </Link>
                  <span className="technical-label">{formatTimestamp(e.start_time)}</span>
                  <span className="technical-label">{formatDuration(e.total_duration_ms)}</span>
                  <StatusPill identity={executionStatusIdentity(e.status)} size="xs" />
                </li>
              ))}
            </ul>
          )}
        </div>
      </GlassPanel>

      <WorkflowHistoryPanel
        workflowName={workflowName}
        open={historyOpen}
        onOpenChange={setHistoryOpen}
      />
      {definition && (
        <>
          <DeployPackageModal
            open={deployOpen}
            onOpenChange={setDeployOpen}
            workflowName={workflowName}
          />
          <WorkflowClassificationModal
            open={classifyOpen}
            onOpenChange={setClassifyOpen}
            workflowName={workflowName}
          />
        </>
      )}
    </div>
  );
}
