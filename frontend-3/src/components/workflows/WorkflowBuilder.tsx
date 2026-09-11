import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import {
  applyNodeChanges,
  type Connection,
  type EdgeChange,
  type MarkerType,
  type NodeChange,
} from "@xyflow/react";
import { toast } from "sonner";
import {
  Bot,
  Code2,
  Columns,
  Loader2,
  Map,
  Plug,
  Plus,
  Redo2,
  Rocket,
  Rows,
  Save,
  Sparkles,
  Trash2,
  Undo2,
  Wrench,
} from "lucide-react";
import { errorMessage, QK, workflowsApi } from "@/api";
import type {
  BuilderCatalog,
  CatalogAgent,
  CatalogConnector,
  CatalogTool,
  InputField,
  StepType,
  ValidationResult,
  WorkflowDefinition,
  WorkflowStep,
} from "@/types";
import { GraphCanvas } from "@/components/graph/GraphCanvas";
import { GraphLegend } from "@/components/graph/Legend";
import { stepsToGraph } from "@/components/graph/fromDefinition";
import { layoutGraph } from "@/components/graph/layout";
import type { StepFlowEdge, StepFlowNode } from "@/components/graph/types";
import { GlassPanel, GlassPanelHeader } from "@/components/glass/GlassPanel";
import { CodeBlock } from "@/components/shared/CodeBlock";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { STEP_TYPE_IDENTITY } from "@/lib/status";
import { cn } from "@/lib/utils";
import { IssueList, ValidationSummary } from "./ValidationPanel";
import { StepInspector } from "./StepInspector";
import { MAX_STEPS, STEP_TYPES, WORKFLOW_NAME_RE } from "./builderModel";
import { CreateAgentModal, CreateToolModal } from "./CreateModals";

/** Fills in canvas coordinates for any step that has none, using dagre once. */
function ensureLayout(def: WorkflowDefinition): WorkflowDefinition {
  const missing = def.steps.filter((s) => !def.ui_layout[s.id]);
  if (missing.length === 0) return def;
  const { nodes } = stepsToGraph({
    steps: def.steps,
    entry_step: def.entry_step,
    ui_layout: {},
  });
  const layout = { ...def.ui_layout };
  for (const n of nodes) {
    if (!layout[n.id]) layout[n.id] = { x: n.position.x, y: n.position.y };
  }
  return { ...def, ui_layout: layout };
}

function defaultConfig(type: StepType): Record<string, unknown> {
  switch (type) {
    case "agent":
      return { agent_id: "", query_template: "" };
    case "tool":
      return { tool_name: "", arguments: {} };
    case "connector":
      return { connector_id: "", tool_name: "", arguments: {} };
    case "condition":
      return { expression: "", true_step: "", false_step: "" };
    case "transform":
      return { transform_code: "" };
    default:
      return {};
  }
}

function uniqueStepId(existing: string[], type: StepType): string {
  let i = 1;
  let candidate = `${type}_step`;
  while (existing.includes(candidate)) {
    i += 1;
    candidate = `${type}_step_${i}`;
  }
  return candidate;
}

export function WorkflowBuilder({
  mode,
  initial,
}: {
  mode: "create" | "edit";
  initial: WorkflowDefinition;
}) {
  const navigate = useNavigate();
  const qc = useQueryClient();

  const [definition, setDefinition] = useState<WorkflowDefinition>(() => ensureLayout(initial));
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [validation, setValidation] = useState<ValidationResult | undefined>(undefined);
  const [validating, setValidating] = useState(false);
  const [script, setScript] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);

  // Undo / Redo history
  const [past, setPast] = useState<WorkflowDefinition[]>([]);
  const [future, setFuture] = useState<WorkflowDefinition[]>([]);

  // Minimap & direction
  const [showMinimap, setShowMinimap] = useState(false);
  const [direction, setDirection] = useState<"LR" | "TB">("LR");

  // Inline creation modals
  const [showAgentModal, setShowAgentModal] = useState(false);
  const [synthesizeKind, setSynthesizeKind] = useState<"tool" | "activity" | null>(null);

  const catalogQuery = useQuery({
    queryKey: QK.builderCatalog(),
    queryFn: workflowsApi.catalog,
    staleTime: 60_000,
  });
  const catalog: BuilderCatalog | undefined = catalogQuery.data;

  const update = useCallback((fn: (d: WorkflowDefinition) => WorkflowDefinition) => {
    setDefinition((current) => {
      const next = ensureLayout(fn(current));
      setPast((p) => [...p.slice(-40), current]);
      setFuture([]);
      setDirty(true);
      return next;
    });
  }, []);

  const undo = useCallback(() => {
    if (past.length === 0) return;
    const previous = past[past.length - 1];
    if (!previous) return;
    setPast((p) => p.slice(0, -1));
    setFuture((f) => [definition, ...f]);
    setDefinition(previous);
    setDirty(true);
  }, [past, definition]);

  const redo = useCallback(() => {
    if (future.length === 0) return;
    const next = future[0];
    if (!next) return;
    setFuture((f) => f.slice(1));
    setPast((p) => [...p, definition]);
    setDefinition(next);
    setDirty(true);
  }, [future, definition]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
        if (e.shiftKey) {
          e.preventDefault();
          redo();
        } else {
          e.preventDefault();
          undo();
        }
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "y") {
        e.preventDefault();
        redo();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [undo, redo]);

  const applyAutoLayout = useCallback((dir: "LR" | "TB") => {
    setDirection(dir);
    setDefinition((current) => {
      const { nodes: currentNodes } = stepsToGraph(
        {
          steps: current.steps,
          entry_step: current.entry_step,
          ui_layout: {},
        },
        [],
        dir,
      );
      const layout: Record<string, { x: number; y: number }> = {};
      for (const n of currentNodes) {
        layout[n.id] = { x: n.position.x, y: n.position.y };
      }
      setPast((p) => [...p.slice(-40), current]);
      setFuture([]);
      setDirty(true);
      return { ...current, ui_layout: layout };
    });
    toast.info(`Applied ${dir === "LR" ? "horizontal" : "vertical"} auto-layout`);
  }, []);

  /* ── Live validation (debounced) ──────────────────────────────────── */
  const validateTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => {
    if (definition.steps.length === 0 || !definition.name) {
      setValidation(undefined);
      return;
    }
    if (validateTimer.current) clearTimeout(validateTimer.current);
    setValidating(true);
    validateTimer.current = setTimeout(() => {
      workflowsApi
        .validate(definition)
        .then((r) => setValidation(r))
        .catch(() => setValidation(undefined))
        .finally(() => setValidating(false));
    }, 700);
    return () => {
      if (validateTimer.current) clearTimeout(validateTimer.current);
    };
  }, [definition]);

  /* ── Graph ────────────────────────────────────────────────────────── */
  const { nodes, edges } = useMemo(() => {
    const base = stepsToGraph(definition, validation?.issues ?? []);
    const branchEdges: StepFlowEdge[] = definition.steps.flatMap((step) => {
      if (step.type !== "condition") return [];
      const out: StepFlowEdge[] = [];
      for (const key of ["true_step", "false_step"] as const) {
        const target = step.config[key];
        if (typeof target === "string" && target && definition.steps.some((s) => s.id === target)) {
          out.push({
            id: `branch:${step.id}:${key}:${target}`,
            source: step.id,
            target,
            label: key === "true_step" ? "true" : "false",
            type: "smoothstep",
            animated: false,
            deletable: false,
            style: {
              stroke: key === "true_step" ? "var(--color-emerald)" : "var(--color-amber)",
              strokeDasharray: "4 4",
            },
            markerEnd: { type: "arrowclosed" as MarkerType },
          });
        }
      }
      return out;
    });
    const withSelection = base.nodes.map((n) => ({ ...n, selected: n.id === selectedId }));
    return { nodes: withSelection, edges: [...base.edges, ...branchEdges] };
  }, [definition, selectedId, validation]);

  const onNodesChange = useCallback(
    (changes: NodeChange<StepFlowNode>[]) => {
      const moved = applyNodeChanges(changes, nodes);
      const positionChanged = changes.some((c) => c.type === "position");
      if (!positionChanged) return;
      setDefinition((d) => {
        const layout = { ...d.ui_layout };
        for (const n of moved) layout[n.id] = { x: n.position.x, y: n.position.y };
        return { ...d, ui_layout: layout };
      });
      setDirty(true);
    },
    [nodes],
  );

  const onEdgesChange = useCallback(
    (changes: EdgeChange<StepFlowEdge>[]) => {
      const removals = changes.filter((c) => c.type === "remove");
      if (removals.length === 0) return;
      update((d) => {
        const steps = d.steps.map((s) => ({ ...s, next_steps: [...s.next_steps] }));
        for (const r of removals) {
          const [source, target] = String(r.id).split("->");
          if (!source || !target) continue;
          const step = steps.find((s) => s.id === source);
          if (step) step.next_steps = step.next_steps.filter((t) => t !== target);
        }
        return { ...d, steps };
      });
    },
    [update],
  );

  const onConnect = useCallback(
    (c: Connection) => {
      if (!c.source || !c.target || c.source === c.target) return;
      update((d) => ({
        ...d,
        steps: d.steps.map((s) =>
          s.id === c.source && !s.next_steps.includes(c.target)
            ? { ...s, next_steps: [...s.next_steps, c.target] }
            : s,
        ),
      }));
    },
    [update],
  );

  /* ── Step mutations ───────────────────────────────────────────────── */
  const addStep = useCallback(
    (type: StepType) => {
      if (definition.steps.length >= MAX_STEPS) {
        toast.error(`A workflow is capped at ${MAX_STEPS} steps.`);
        return;
      }
      const id = uniqueStepId(
        definition.steps.map((s) => s.id),
        type,
      );
      const step: WorkflowStep = {
        id,
        type,
        tier: null,
        config: defaultConfig(type),
        next_steps: [],
        description: "",
        parallel_group: null,
      };
      update((d) => ({
        ...d,
        steps: [...d.steps, step],
        entry_step: d.entry_step || id,
      }));
      setSelectedId(id);
    },
    [definition.steps, update],
  );

  const addAgentStep = useCallback(
    (agent: CatalogAgent) => {
      if (definition.steps.length >= MAX_STEPS) {
        toast.error(`A workflow is capped at ${MAX_STEPS} steps.`);
        return;
      }
      const id = uniqueStepId(definition.steps.map((s) => s.id), "agent");
      const step: WorkflowStep = {
        id,
        type: "agent",
        tier: (agent.tier as any) ?? null,
        config: { agent_id: agent.id, query_template: "" },
        next_steps: [],
        description: agent.description || agent.name,
        parallel_group: null,
      };
      update((d) => ({
        ...d,
        steps: [...d.steps, step],
        entry_step: d.entry_step || id,
      }));
      setSelectedId(id);
      toast.success(`Added agent step "${id}"`);
    },
    [definition.steps, update],
  );

  const addToolStep = useCallback(
    (tool: CatalogTool) => {
      if (definition.steps.length >= MAX_STEPS) {
        toast.error(`A workflow is capped at ${MAX_STEPS} steps.`);
        return;
      }
      const id = uniqueStepId(definition.steps.map((s) => s.id), "tool");
      const step: WorkflowStep = {
        id,
        type: "tool",
        tier: null,
        config: { tool_name: tool.name, arguments: {} },
        next_steps: [],
        description: tool.description || tool.name,
        parallel_group: null,
      };
      update((d) => ({
        ...d,
        steps: [...d.steps, step],
        entry_step: d.entry_step || id,
      }));
      setSelectedId(id);
      toast.success(`Added tool step "${id}"`);
    },
    [definition.steps, update],
  );

  const addConnectorStep = useCallback(
    (conn: CatalogConnector) => {
      if (definition.steps.length >= MAX_STEPS) {
        toast.error(`A workflow is capped at ${MAX_STEPS} steps.`);
        return;
      }
      const id = uniqueStepId(definition.steps.map((s) => s.id), "connector");
      const step: WorkflowStep = {
        id,
        type: "connector",
        tier: null,
        config: { connector_id: conn.id, tool_name: conn.tools?.[0]?.name ?? "", arguments: {} },
        next_steps: [],
        description: conn.name,
        parallel_group: null,
      };
      update((d) => ({
        ...d,
        steps: [...d.steps, step],
        entry_step: d.entry_step || id,
      }));
      setSelectedId(id);
      toast.success(`Added connector step "${id}"`);
    },
    [definition.steps, update],
  );

  const changeStep = useCallback(
    (next: WorkflowStep) => {
      const previousId = selectedId;
      update((d) => {
        const renamed = previousId !== null && next.id !== previousId;
        const steps = d.steps.map((s) => (s.id === previousId ? next : s));
        if (!renamed) return { ...d, steps };
        // A rename has to follow every reference: edges, branches and the entry.
        const rewired = steps.map((s) => ({
          ...s,
          next_steps: s.next_steps.map((t) => (t === previousId ? next.id : t)),
          config: Object.fromEntries(
            Object.entries(s.config).map(([k, v]) =>
              (k === "true_step" || k === "false_step") && v === previousId ? [k, next.id] : [k, v],
            ),
          ),
        }));
        const layout = { ...d.ui_layout };
        const old = previousId ? layout[previousId] : undefined;
        if (old) {
          layout[next.id] = old;
          delete layout[previousId as string];
        }
        return {
          ...d,
          steps: rewired,
          ui_layout: layout,
          entry_step: d.entry_step === previousId ? next.id : d.entry_step,
        };
      });
      if (previousId !== next.id) setSelectedId(next.id);
    },
    [selectedId, update],
  );

  const deleteStep = useCallback(
    (id: string) => {
      update((d) => {
        const layout = { ...d.ui_layout };
        delete layout[id];
        const steps = d.steps
          .filter((s) => s.id !== id)
          .map((s) => ({
            ...s,
            next_steps: s.next_steps.filter((t) => t !== id),
            config: Object.fromEntries(
              Object.entries(s.config).map(([k, v]) =>
                (k === "true_step" || k === "false_step") && v === id ? [k, ""] : [k, v],
              ),
            ),
          }));
        return {
          ...d,
          steps,
          ui_layout: layout,
          entry_step: d.entry_step === id ? (steps[0]?.id ?? "") : d.entry_step,
        };
      });
      setSelectedId(null);
    },
    [update],
  );

  /* ── Persistence ──────────────────────────────────────────────────── */
  const save = useMutation({
    mutationFn: async () => {
      if (mode === "create") return workflowsApi.create(definition);
      return workflowsApi.update(definition.name, definition);
    },
    onSuccess: () => {
      setDirty(false);
      toast.success(mode === "create" ? "Workflow created." : "Draft saved.");
      qc.invalidateQueries({ queryKey: QK.workflows() });
      qc.invalidateQueries({ queryKey: QK.workflow(definition.name) });
      if (mode === "create") {
        navigate({
          to: "/workflows/$workflowName/edit",
          params: { workflowName: definition.name },
        });
      }
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const publish = useMutation({
    mutationFn: async () => {
      if (dirty || mode === "create") {
        if (mode === "create") await workflowsApi.create(definition);
        else await workflowsApi.update(definition.name, definition);
        setDirty(false);
      }
      return workflowsApi.publish(definition.name);
    },
    onSuccess: (res) => {
      toast.success(String(res["message"] ?? "Workflow published"));
      qc.invalidateQueries({ queryKey: QK.workflows() });
      navigate({ to: "/workflows/$workflowName", params: { workflowName: definition.name } });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const preview = useMutation({
    mutationFn: () => workflowsApi.scriptPreview(definition),
    onSuccess: (res) => setScript(res.code),
    onError: (e) => toast.error(errorMessage(e)),
  });

  const nameError =
    definition.name.length > 0 && !WORKFLOW_NAME_RE.test(definition.name)
      ? "Lowercase letters, digits and underscores; 3–64 characters, starting with a letter."
      : null;

  const canSave =
    definition.name.length > 0 &&
    nameError === null &&
    definition.steps.length > 0 &&
    definition.entry_step.length > 0 &&
    (validation?.error_count ?? 0) === 0;

  const selected = definition.steps.find((s) => s.id === selectedId) ?? null;

  return (
    <div className="space-y-4">
      <GlassPanel tone="raised" className="p-4">
        <div className="grid gap-3 lg:grid-cols-[minmax(0,240px)_1fr_auto]">
          <div>
            <label className="eyebrow mb-1.5 block">Workflow name</label>
            <Input
              value={definition.name}
              disabled={mode === "edit"}
              placeholder="claim_settlement_workflow"
              onChange={(e) => update((d) => ({ ...d, name: e.target.value }))}
              className={cn("font-mono text-xs", nameError && "border-red/60")}
            />
            {nameError ? <p className="mt-1 text-[11px] text-red">{nameError}</p> : null}
          </div>
          <div>
            <label className="eyebrow mb-1.5 block">Description</label>
            <Input
              value={definition.description ?? ""}
              placeholder="What this workflow produces, in one line."
              onChange={(e) => update((d) => ({ ...d, description: e.target.value }))}
              className="text-xs"
            />
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <ValidationSummary result={validation} pending={validating} className="mr-1" />
            <Button
              size="sm"
              variant="outline"
              onClick={() => preview.mutate()}
              disabled={preview.isPending || definition.steps.length === 0}
            >
              {preview.isPending ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Code2 className="size-3.5" />
              )}
              Script
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => save.mutate()}
              disabled={!canSave || save.isPending}
            >
              {save.isPending ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Save className="size-3.5" />
              )}
              {mode === "create" ? "Create draft" : "Save draft"}
            </Button>
            <Button
              size="sm"
              onClick={() => publish.mutate()}
              disabled={!canSave || publish.isPending}
            >
              {publish.isPending ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Rocket className="size-3.5" />
              )}
              Publish
            </Button>
          </div>
        </div>
      </GlassPanel>

      <div className="grid gap-4 xl:grid-cols-[240px_minmax(0,1fr)_360px]">
        {/* Palette */}
        <GlassPanel className="flex h-[calc(100vh-19rem)] min-h-[460px] flex-col overflow-hidden">
          <GlassPanelHeader
            title="Palette"
            description={`${definition.steps.length} / ${MAX_STEPS} steps`}
            actions={
              catalog ? (
                <span className="font-mono text-[10px] text-muted-foreground">
                  {catalog.agents.length}A · {catalog.tools.length}T
                </span>
              ) : undefined
            }
          />
          <div className="custom-scrollbar flex-1 space-y-3.5 overflow-y-auto p-3">
            {/* Step types */}
            <div>
              <p className="eyebrow mb-1.5 text-[10px]">Step Types</p>
              <div className="space-y-1">
                {STEP_TYPES.map((type) => {
                  const identity = STEP_TYPE_IDENTITY[type];
                  return (
                    <button
                      key={type}
                      type="button"
                      onClick={() => addStep(type)}
                      className="flex w-full items-center gap-2 rounded-md border border-border bg-background-elevated/60 px-2 py-1.5 text-left transition hover:border-border-strong hover:bg-surface-hover"
                    >
                      <span
                        className={cn(
                          "size-2 shrink-0 rounded-full border",
                          identity.bg,
                          identity.border,
                        )}
                      />
                      <span className="flex-1 text-xs font-medium text-foreground">
                        {identity.label}
                      </span>
                      <Plus className="size-3 text-muted-foreground" />
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Quick Synthesis */}
            <div>
              <p className="eyebrow mb-1.5 text-[10px]">Inline Creation</p>
              <div className="space-y-1">
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 w-full justify-start text-[11px] gap-1.5"
                  onClick={() => setShowAgentModal(true)}
                >
                  <Bot className="size-3 text-primary" /> + Agent
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 w-full justify-start text-[11px] gap-1.5"
                  onClick={() => setSynthesizeKind("activity")}
                >
                  <Sparkles className="size-3 text-cyan" /> + Activity
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 w-full justify-start text-[11px] gap-1.5"
                  onClick={() => setSynthesizeKind("tool")}
                >
                  <Wrench className="size-3 text-amber" /> + Tool
                </Button>
              </div>
            </div>

            {/* Catalog Agents */}
            {catalog && catalog.agents.length > 0 && (
              <div>
                <p className="eyebrow mb-1.5 text-[10px]">Agents ({catalog.agents.length})</p>
                <div className="max-h-36 custom-scrollbar space-y-1 overflow-y-auto pr-1">
                  {catalog.agents.map((a) => (
                    <button
                      key={a.id}
                      type="button"
                      onClick={() => addAgentStep(a)}
                      title={a.description || a.name}
                      className="flex w-full items-center gap-2 rounded-md border border-border/70 bg-background-elevated/40 px-2 py-1 text-left text-xs transition hover:border-primary/50 hover:bg-surface-hover"
                    >
                      <Bot className="size-3 shrink-0 text-primary" />
                      <span className="truncate flex-1 font-mono text-[11px] text-foreground">
                        {a.name}
                      </span>
                      <Plus className="size-2.5 text-muted-foreground" />
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Catalog Tools / Activities */}
            {catalog && catalog.tools.length > 0 && (
              <div>
                <p className="eyebrow mb-1.5 text-[10px]">Tools & Activities ({catalog.tools.length})</p>
                <div className="max-h-36 custom-scrollbar space-y-1 overflow-y-auto pr-1">
                  {catalog.tools.map((t) => (
                    <button
                      key={`${t.source}:${t.name}`}
                      type="button"
                      onClick={() => addToolStep(t)}
                      title={t.description || t.name}
                      className="flex w-full items-center gap-2 rounded-md border border-border/70 bg-background-elevated/40 px-2 py-1 text-left text-xs transition hover:border-cyan/50 hover:bg-surface-hover"
                    >
                      <Wrench className="size-3 shrink-0 text-cyan" />
                      <span className="truncate flex-1 font-mono text-[11px] text-foreground">
                        {t.name}
                      </span>
                      <Plus className="size-2.5 text-muted-foreground" />
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Catalog Connectors */}
            {catalog && catalog.connectors.length > 0 && (
              <div>
                <p className="eyebrow mb-1.5 text-[10px]">Connectors ({catalog.connectors.length})</p>
                <div className="max-h-28 custom-scrollbar space-y-1 overflow-y-auto pr-1">
                  {catalog.connectors.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => addConnectorStep(c)}
                      title={c.name}
                      className="flex w-full items-center gap-2 rounded-md border border-border/70 bg-background-elevated/40 px-2 py-1 text-left text-xs transition hover:border-violet/50 hover:bg-surface-hover"
                    >
                      <Plug className="size-3 shrink-0 text-violet" />
                      <span className="truncate flex-1 text-[11px] text-foreground">
                        {c.name}
                      </span>
                      <Plus className="size-2.5 text-muted-foreground" />
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </GlassPanel>

        {/* Canvas */}
        <GlassPanel className="overflow-hidden">
          <GraphCanvas
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onNodeClick={(_, node) => setSelectedId(node.id)}
            onPaneClick={() => setSelectedId(null)}
            showMinimap={showMinimap}
            className="h-[calc(100vh-19rem)] min-h-[460px] w-full"
            overlay={
              <>
                <GraphLegend />
                <div className="pointer-events-auto flex items-center gap-1.5 rounded-lg border border-border bg-background-elevated/90 p-1 backdrop-blur-sm shadow-sm">
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 px-2"
                    onClick={undo}
                    disabled={past.length === 0}
                    title="Undo (Ctrl+Z)"
                  >
                    <Undo2 className="size-3" />
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 px-2"
                    onClick={redo}
                    disabled={future.length === 0}
                    title="Redo (Ctrl+Y)"
                  >
                    <Redo2 className="size-3" />
                  </Button>
                  <div className="h-3 w-px bg-border mx-0.5" />
                  <Button
                    size="sm"
                    variant={direction === "LR" ? "secondary" : "ghost"}
                    className="h-7 px-2 text-xs"
                    onClick={() => applyAutoLayout("LR")}
                    title="Horizontal auto-layout"
                  >
                    <Columns className="size-3" /> LR
                  </Button>
                  <Button
                    size="sm"
                    variant={direction === "TB" ? "secondary" : "ghost"}
                    className="h-7 px-2 text-xs"
                    onClick={() => applyAutoLayout("TB")}
                    title="Vertical auto-layout"
                  >
                    <Rows className="size-3" /> TB
                  </Button>
                  <div className="h-3 w-px bg-border mx-0.5" />
                  <Button
                    size="sm"
                    variant={showMinimap ? "secondary" : "ghost"}
                    className="h-7 px-2"
                    onClick={() => setShowMinimap(!showMinimap)}
                    title="Toggle minimap"
                  >
                    <Map className="size-3" />
                  </Button>
                </div>
              </>
            }
          />
        </GlassPanel>

        {/* Inspector */}
        <div className="min-w-0">
          <Tabs defaultValue="step" className="flex h-full flex-col">
            <TabsList className="w-full justify-start">
              <TabsTrigger value="step">Step</TabsTrigger>
              <TabsTrigger value="workflow">Workflow</TabsTrigger>
              <TabsTrigger value="issues">
                Issues
                {validation && validation.issues.length > 0 ? ` (${validation.issues.length})` : ""}
              </TabsTrigger>
            </TabsList>

            <TabsContent value="step" className="mt-3 h-[calc(100vh-22rem)] min-h-[420px]">
              <StepInspector
                step={selected}
                catalog={catalog}
                stepIds={definition.steps.map((s) => s.id)}
                tiers={catalog?.tiers ?? ["foundation", "domain", "use_case"]}
                isEntry={selected?.id === definition.entry_step}
                onChange={changeStep}
                onDelete={deleteStep}
                onSetEntry={(id) => update((d) => ({ ...d, entry_step: id }))}
              />
            </TabsContent>

            <TabsContent value="workflow" className="mt-3">
              <WorkflowSettings definition={definition} update={update} />
            </TabsContent>

            <TabsContent value="issues" className="mt-3">
              <GlassPanel className="p-4">
                {validating ? (
                  <p className="technical-label">Validating…</p>
                ) : (
                  <IssueList
                    issues={validation?.issues ?? []}
                    onSelectStep={(id) => setSelectedId(id)}
                    emptyLabel={
                      definition.steps.length === 0
                        ? "Add a step to start validating."
                        : "No issues — the definition is structurally sound."
                    }
                  />
                )}
              </GlassPanel>
            </TabsContent>
          </Tabs>
        </div>
      </div>

      {script !== null ? (
        <GlassPanel>
          <GlassPanelHeader
            title="Compiled module"
            description="What the Mistral worker will run"
            actions={
              <Button size="sm" variant="ghost" onClick={() => setScript(null)}>
                Hide
              </Button>
            }
          />
          <div className="p-4">
            <CodeBlock code={script} className="max-h-[420px] overflow-auto custom-scrollbar" />
          </div>
        </GlassPanel>
      ) : null}

      <CreateAgentModal
        open={showAgentModal}
        onOpenChange={setShowAgentModal}
        models={catalog?.models ?? ["mistral-large-latest", "mistral-small-latest", "codestral-latest"]}
        tiers={catalog?.tiers ?? ["foundation", "domain", "use_case"]}
        tools={catalog?.tools ?? []}
        onCreated={(agentId) => {
          qc.invalidateQueries({ queryKey: QK.builderCatalog() });
          qc.invalidateQueries({ queryKey: QK.agents() });
          toast.success("Agent created");
          const id = uniqueStepId(definition.steps.map((s) => s.id), "agent");
          const step: WorkflowStep = {
            id,
            type: "agent",
            tier: null,
            config: { agent_id: agentId, query_template: "" },
            next_steps: [],
            description: "",
            parallel_group: null,
          };
          update((d) => ({
            ...d,
            steps: [...d.steps, step],
            entry_step: d.entry_step || id,
          }));
          setSelectedId(id);
        }}
      />

      {synthesizeKind && (
        <CreateToolModal
          open={Boolean(synthesizeKind)}
          onOpenChange={(open) => !open && setSynthesizeKind(null)}
          purpose={synthesizeKind}
          onCreated={(toolName) => {
            qc.invalidateQueries({ queryKey: QK.builderCatalog() });
            qc.invalidateQueries({ queryKey: QK.tools() });
            toast.success(`${synthesizeKind === "activity" ? "Activity" : "Tool"} created`);
            const id = uniqueStepId(definition.steps.map((s) => s.id), "tool");
            const step: WorkflowStep = {
              id,
              type: "tool",
              tier: null,
              config: { tool_name: toolName, arguments: {} },
              next_steps: [],
              description: "",
              parallel_group: null,
            };
            update((d) => ({
              ...d,
              steps: [...d.steps, step],
              entry_step: d.entry_step || id,
            }));
            setSelectedId(id);
          }}
        />
      )}
    </div>
  );
}

/* ── Workflow-level settings (entry step + input schema) ───────────────── */

function WorkflowSettings({
  definition,
  update,
}: {
  definition: WorkflowDefinition;
  update: (fn: (d: WorkflowDefinition) => WorkflowDefinition) => void;
}) {
  const fields = definition.input_schema as InputField[];

  const setField = (index: number, patch: Partial<InputField>) =>
    update((d) => ({
      ...d,
      input_schema: (d.input_schema as InputField[]).map((f, i) =>
        i === index ? { ...f, ...patch } : f,
      ),
    }));

  return (
    <GlassPanel className="flex flex-col">
      <GlassPanelHeader title="Workflow settings" description="Entry point and run inputs" />
      <div className="custom-scrollbar max-h-[calc(100vh-24rem)] space-y-4 overflow-y-auto p-4">
        <div>
          <label className="eyebrow mb-1.5 block">Entry step</label>
          <select
            className="h-9 w-full rounded-md border border-input bg-background-elevated/70 px-2 text-xs text-foreground"
            value={definition.entry_step}
            onChange={(e) => update((d) => ({ ...d, entry_step: e.target.value }))}
          >
            <option value="">— none —</option>
            {definition.steps.map((s) => (
              <option key={s.id} value={s.id}>
                {s.id}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="eyebrow mb-1.5 block">Long description</label>
          <Textarea
            rows={3}
            value={definition.description ?? ""}
            onChange={(e) => update((d) => ({ ...d, description: e.target.value }))}
            className="text-xs"
          />
        </div>

        <div>
          <div className="mb-2 flex items-center justify-between">
            <label className="eyebrow">Run inputs</label>
            <Button
              size="sm"
              variant="outline"
              onClick={() =>
                update((d) => ({
                  ...d,
                  input_schema: [
                    ...(d.input_schema as InputField[]),
                    { name: "", type: "string", description: "", required: true },
                  ],
                }))
              }
            >
              <Plus className="size-3.5" /> Add
            </Button>
          </div>
          {fields.length === 0 ? (
            <p className="text-[11px] text-muted-foreground">
              No inputs. The run form will offer a free-form JSON payload instead.
            </p>
          ) : (
            <div className="space-y-2">
              {fields.map((f, i) => (
                <div
                  key={i}
                  className="rounded-lg border border-border bg-background-elevated/60 p-2.5"
                >
                  <div className="flex items-center gap-2">
                    <Input
                      value={f.name}
                      placeholder="field_name"
                      onChange={(e) => setField(i, { name: e.target.value })}
                      className="h-8 font-mono text-xs"
                    />
                    <select
                      className="h-8 rounded-md border border-input bg-background-elevated/70 px-2 text-xs text-foreground"
                      value={f.type}
                      onChange={(e) => setField(i, { type: e.target.value })}
                    >
                      {["string", "number", "boolean", "object", "array"].map((t) => (
                        <option key={t} value={t}>
                          {t}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      title="Remove input"
                      onClick={() =>
                        update((d) => ({
                          ...d,
                          input_schema: (d.input_schema as InputField[]).filter(
                            (_, idx) => idx !== i,
                          ),
                        }))
                      }
                      className="rounded-md border border-border p-1.5 text-muted-foreground hover:text-red"
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  </div>
                  <Input
                    value={f.description ?? ""}
                    placeholder="What this input is for"
                    onChange={(e) => setField(i, { description: e.target.value })}
                    className="mt-2 h-8 text-xs"
                  />
                  <label className="mt-2 flex cursor-pointer items-center gap-2 text-[11px] text-muted-foreground">
                    <input
                      type="checkbox"
                      checked={f.required !== false}
                      onChange={(e) => setField(i, { required: e.target.checked })}
                    />
                    Required
                  </label>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </GlassPanel>
  );
}
