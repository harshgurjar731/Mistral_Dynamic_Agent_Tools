import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState, type ReactNode } from "react";
import { toast } from "sonner";
import {
  Activity,
  ArrowLeft,
  Columns,
  Download,
  FileCode,
  History,
  ListOrdered,
  Loader2,
  Map,
  Package,
  Pencil,
  Play,
  RefreshCw,
  Rocket,
  Rows,
  ShieldCheck,
  Tag,
  type LucideIcon,
} from "lucide-react";
import { errorMessage, executionsApi, QK, workflowsApi } from "@/api";
import { WorkflowRulesPanel } from "@/components/rules/WorkflowRulesPanel";
import { GraphCanvas } from "@/components/graph/GraphCanvas";
import { GraphLegend } from "@/components/graph/Legend";
import { stepsToGraph } from "@/components/graph/fromDefinition";
import { CodeBlock } from "@/components/shared/CodeBlock";
import { DeployBadge, SourceBadge } from "@/components/workflows/WorkflowCard";
import { WorkflowHistoryPanel } from "@/components/workflows/HistoryPanel";
import { IssueList, ValidationSummary } from "@/components/workflows/ValidationPanel";
import { DeployPackageModal } from "@/components/workflows/DeployPackageModal";
import { WorkflowClassificationModal } from "@/components/workflows/WorkflowClassificationModal";
import { StepDetailsDialog } from "@/components/workflows/StepDetailsDialog";
import { WorkflowPrerequisites } from "@/components/workflows/WorkflowPrerequisites";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { StatusPill } from "@/components/ui/StatusPill";
import { DetailSkeleton, TableSkeleton } from "@/components/ui/Skeletons";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { executionStatusIdentity, formatDuration, formatTimestamp } from "@/lib/status";
import { cn } from "@/lib/utils";

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

/* Surfaces follow the orchestrator landing page: soft rounded glass, uppercase section labels. */
const panel = "rounded-2xl border border-border/50 bg-surface/40 backdrop-blur-sm";

const secondaryButton =
  "inline-flex items-center gap-1.5 rounded-xl border border-border/60 px-3 py-2 text-xs font-medium text-muted-foreground transition hover:border-border hover:bg-surface-hover hover:text-foreground disabled:opacity-50";

const tabTrigger =
  "rounded-lg px-3 text-xs data-[state=active]:bg-primary/10 data-[state=active]:text-primary data-[state=active]:shadow-none";

function Section({
  icon: Icon,
  title,
  description,
  actions,
  children,
}: {
  icon: LucideIcon;
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className={panel}>
      <div className="flex flex-wrap items-center gap-2 border-b border-border/40 px-5 py-3.5">
        <Icon className="size-3.5 text-primary" />
        <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          {title}
        </span>
        {description ? (
          <span className="text-[11px] text-muted-foreground/60">· {description}</span>
        ) : null}
        {actions ? <div className="ml-auto flex items-center gap-2">{actions}</div> : null}
      </div>
      {children}
    </section>
  );
}

function WorkflowDetailPage() {
  const { workflowName } = Route.useParams();
  const qc = useQueryClient();
  const [historyOpen, setHistoryOpen] = useState(false);
  const [deployOpen, setDeployOpen] = useState(false);
  const [classifyOpen, setClassifyOpen] = useState(false);
  const [direction, setDirection] = useState<"LR" | "TB">("LR");
  const [showMinimap, setShowMinimap] = useState(true);
  const [openStepId, setOpenStepId] = useState<string | null>(null);

  const wf = useQuery({
    queryKey: QK.workflow(workflowName),
    queryFn: () => workflowsApi.get(workflowName),
  });

  const definition = wf.data;
  const remoteOnly = (definition?.steps?.length ?? 0) === 0;

  // Agent names, models, tools and activity parameters for the cards and the step modal.
  const catalog = useQuery({
    queryKey: QK.builderCatalog(),
    queryFn: workflowsApi.catalog,
    enabled: Boolean(definition) && !remoteOnly,
    staleTime: 60_000,
  });

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
        res.file_path
          ? `Workflow exported to ${res.file_path}`
          : (res.error ?? "Workflow exported"),
      );
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const graph = useMemo(
    () =>
      definition
        ? // Read-only: always lay out fresh, so the LR/TB toggle works and cards
          // never overlap because of positions saved for a different card size.
          stepsToGraph({ ...definition, ui_layout: {} }, validation.data?.issues ?? [], direction)
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

  return (
    <div className="space-y-6 px-6 py-8">
      {/* ── Header ── */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <Link
            to="/workflows"
            className="-ml-2 mb-3 inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs font-medium text-muted-foreground transition hover:bg-surface-hover hover:text-foreground"
          >
            <ArrowLeft className="size-3" />
            All workflows
          </Link>
          <h1 className="text-2xl font-semibold tracking-tight break-all sm:text-3xl">
            <span className="text-gradient-brand">{definition.name}</span>
          </h1>
          <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
            <SourceBadge source={definition.source} />
            <DeployBadge workflow={definition} />
          </div>
          <p className="mt-2.5 max-w-2xl text-sm leading-relaxed text-muted-foreground">
            {definition.description || "No description."}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className={secondaryButton} onClick={() => setHistoryOpen(true)}>
            <History className="size-3.5" /> History
          </button>
          <button
            type="button"
            className={secondaryButton}
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
          </button>
          <button
            type="button"
            className={secondaryButton}
            onClick={() => setDeployOpen(true)}
            title="Package workflow for deployment"
          >
            <Package className="size-3.5" /> Package
          </button>
          <button
            type="button"
            className={secondaryButton}
            onClick={() => setClassifyOpen(true)}
            title="Classify workflow domain"
          >
            <Tag className="size-3.5" /> Classify
          </button>
          {!remoteOnly ? (
            <>
              <Link
                to="/workflows/$workflowName/edit"
                params={{ workflowName }}
                className={secondaryButton}
              >
                <Pencil className="size-3.5" /> Edit
              </Link>
              <button
                type="button"
                className={secondaryButton}
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
              </button>
            </>
          ) : null}
          <Link
            to="/workflows/$workflowName/execute"
            params={{ workflowName }}
            className="inline-flex items-center gap-1.5 rounded-xl bg-gradient-brand px-4 py-2 text-sm font-medium text-primary-foreground transition hover:opacity-90"
          >
            <Play className="size-3.5" /> Run
          </Link>
        </div>
      </div>

      {remoteOnly ? (
        <div className="rounded-2xl border border-amber/20 bg-amber/5 p-4">
          <p className="text-sm font-semibold text-foreground">Registered remotely</p>
          <p className="mt-1 text-xs text-muted-foreground">
            This workflow exists on the Mistral server but has no local definition, so there is no
            graph, script or validation to show. It can still be run and monitored.
          </p>
        </div>
      ) : (
        <WorkflowPrerequisites workflowName={workflowName} />
      )}

      {remoteOnly ? null : (
        <Tabs defaultValue="graph">
          <TabsList className="h-10 rounded-xl border border-border/50 bg-surface/40 p-1 backdrop-blur-sm">
            <TabsTrigger value="graph" className={tabTrigger}>
              Graph
            </TabsTrigger>
            <TabsTrigger value="steps" className={tabTrigger}>
              Steps
            </TabsTrigger>
            <TabsTrigger value="script" className={tabTrigger}>
              Compiled module
            </TabsTrigger>
            <TabsTrigger value="issues" className={tabTrigger}>
              Validation
              {validation.data && validation.data.issues.length > 0
                ? ` (${validation.data.issues.length})`
                : ""}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="graph" className="mt-4">
            <div className={cn(panel, "overflow-hidden")}>
              <GraphCanvas
                nodes={graph.nodes}
                edges={graph.edges}
                readOnly
                catalog={catalog.data}
                onNodeClick={(_, node) => setOpenStepId(node.id)}
                showMinimap={showMinimap}
                className="relative h-[600px] w-full"
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
            </div>
          </TabsContent>

          <TabsContent value="steps" className="mt-4">
            <Section
              icon={ListOrdered}
              title="Steps"
              description={`Entry point: ${definition.entry_step || "—"}`}
            >
              <div className="divide-y divide-border/40">
                {definition.steps.map((s) => (
                  <div
                    key={s.id}
                    role="button"
                    tabIndex={0}
                    title="Show step details"
                    onClick={() => setOpenStepId(s.id)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        setOpenStepId(s.id);
                      }
                    }}
                    className="cursor-pointer px-5 py-3 transition-colors hover:bg-surface-hover/60"
                  >
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
                      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                        {s.description}
                      </p>
                    ) : null}
                    {s.next_steps.length > 0 ? (
                      <p className="mt-1 font-mono text-[10px] text-muted-foreground">
                        → {s.next_steps.join(", ")}
                      </p>
                    ) : null}
                  </div>
                ))}
              </div>
            </Section>
          </TabsContent>

          <TabsContent value="script" className="mt-4">
            <Section
              icon={FileCode}
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
            >
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
            </Section>
          </TabsContent>

          <TabsContent value="issues" className="mt-4">
            <Section
              icon={ShieldCheck}
              title="Validation"
              description="Errors block publishing; warnings do not."
              actions={
                <ValidationSummary result={validation.data} pending={validation.isFetching} />
              }
            >
              <div className="p-4">
                <IssueList issues={validation.data?.issues ?? []} />
              </div>
            </Section>
            <div className="mt-4">
              <Section
                icon={ShieldCheck}
                title="Rules"
                description="Checked on save and publish, and while the workflow runs."
              >
                <WorkflowRulesPanel workflowName={workflowName} />
              </Section>
            </div>
          </TabsContent>
        </Tabs>
      )}

      <Section
        icon={Activity}
        title="Recent runs"
        description={runs.data ? `${runs.data.count} shown` : undefined}
        actions={
          <Link
            to="/workflows/$workflowName/execute"
            params={{ workflowName }}
            className="rounded-lg px-2.5 py-1 text-xs font-medium text-primary transition hover:bg-primary/10"
          >
            New run
          </Link>
        }
      >
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
                  className="flex flex-wrap items-center gap-3 rounded-xl border border-border/50 bg-surface/30 px-3 py-2 transition hover:border-primary/30"
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
      </Section>

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
          <StepDetailsDialog
            step={definition.steps.find((s) => s.id === openStepId) ?? null}
            definition={definition}
            catalog={catalog.data}
            issues={validation.data?.issues ?? []}
            onOpenChange={(open) => !open && setOpenStepId(null)}
            onSelectStep={setOpenStepId}
          />
        </>
      )}
    </div>
  );
}
