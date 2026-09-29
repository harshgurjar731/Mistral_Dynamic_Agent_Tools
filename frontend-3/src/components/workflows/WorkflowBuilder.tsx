import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import {
  applyNodeChanges,
  type Connection,
  type EdgeChange,
  type MarkerType,
  type NodeChange,
  type XYPosition,
} from "@xyflow/react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { toast } from "sonner";
import {
  Blocks,
  Code2,
  Columns,
  Loader2,
  Map,
  Plus,
  Redo2,
  Rocket,
  Rows,
  Save,
  Settings2,
  SlidersHorizontal,
  Trash2,
  Undo2,
  X,
} from "lucide-react";
import { errorMessage, QK, rulesApi, workflowsApi } from "@/api";
import { RuleSelector } from "@/components/rules/RuleSelector";
import type {
  BuilderCatalog,
  InputField,
  StepType,
  ValidationResult,
  WorkflowDefinition,
  WorkflowStep,
} from "@/types";
import { GraphCanvas } from "@/components/graph/GraphCanvas";
import { GraphLegend } from "@/components/graph/Legend";
import { stepsToGraph } from "@/components/graph/fromDefinition";
import { layoutGraph, NODE_HEIGHT, NODE_WIDTH } from "@/components/graph/layout";
import type { StepFlowEdge, StepFlowNode } from "@/components/graph/types";
import { GlassPanel, GlassPanelHeader } from "@/components/glass/GlassPanel";
import { CodeBlock } from "@/components/shared/CodeBlock";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { IssueList, ValidationSummary } from "./ValidationPanel";
import { StepInspector } from "./StepInspector";
import { MAX_STEPS, WORKFLOW_NAME_RE } from "./builderModel";
import {
  BuilderPalette,
  PALETTE_MIME,
  PaletteToggle,
  parsePaletteItem,
  type PaletteItem,
} from "./BuilderPalette";
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

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
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

function blankStep(id: string, type: StepType): WorkflowStep {
  return {
    id,
    type,
    tier: null,
    config: defaultConfig(type),
    next_steps: [],
    description: "",
    parallel_group: null,
  };
}

/** Turns a palette entry into a new step with a unique id. */
function stepFromItem(item: PaletteItem, existing: string[]): WorkflowStep {
  switch (item.kind) {
    case "type":
      return blankStep(uniqueStepId(existing, `${item.type}_step`), item.type);
    case "agent":
      // Named after the agent, so the card and the compiled module both read naturally.
      return {
        ...blankStep(uniqueStepId(existing, item.agent.name), "agent"),
        tier: (item.agent.tier as WorkflowStep["tier"]) ?? null,
        config: { agent_id: item.agent.id, query_template: "" },
        description: item.agent.description || item.agent.name,
      };
    case "activity":
      return {
        ...blankStep(uniqueStepId(existing, item.activity.name), "tool"),
        config: { tool_name: item.activity.name, arguments: {} },
        description: item.activity.description || item.activity.name,
      };
  }
}

/** A valid step id (see validation `_STEP_ID_RE`) derived from a display name. */
function stepIdBase(name: string): string {
  let base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 56);
  if (!base) base = "step";
  if (/^[0-9]/.test(base)) base = `s_${base}`;
  return base;
}

/** Just past the furthest node in the flow direction, so a clicked-in step never lands on another. */
function nextFreePosition(
  layout: Record<string, { x: number; y: number }>,
  dir: "LR" | "TB",
): XYPosition {
  const points = Object.values(layout);
  if (points.length === 0) return { x: 0, y: 0 };
  if (dir === "LR") {
    const far = points.reduce((a, b) => (b.x > a.x ? b : a));
    return { x: far.x + NODE_WIDTH + 80, y: far.y };
  }
  const far = points.reduce((a, b) => (b.y > a.y ? b : a));
  return { x: far.x, y: far.y + NODE_HEIGHT + 60 };
}

type DetailsTab = "step" | "workflow" | "issues";

function uniqueStepId(existing: string[], name: string): string {
  const base = stepIdBase(name);
  let i = 1;
  let candidate = base;
  while (existing.includes(candidate)) {
    i += 1;
    candidate = `${base}_${i}`;
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

  // Floating palette and the details modal (null = closed)
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [detailsTab, setDetailsTab] = useState<DetailsTab | null>(null);

  // Inline creation modals
  const [showAgentModal, setShowAgentModal] = useState(false);
  const [synthesizingActivity, setSynthesizingActivity] = useState(false);

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
      } else if (
        e.key.toLowerCase() === "p" &&
        !e.ctrlKey &&
        !e.metaKey &&
        !e.altKey &&
        !isTypingTarget(e.target) &&
        !document.querySelector("[role=dialog]")
      ) {
        e.preventDefault();
        setPaletteOpen((o) => !o);
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
    const withSelection = base.nodes.map((n) => ({
      ...n,
      selected: n.id === selectedId,
    }));
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
  const insertStep = useCallback(
    (step: WorkflowStep, position?: XYPosition) => {
      if (definition.steps.length >= MAX_STEPS) {
        toast.error(`A workflow is capped at ${MAX_STEPS} steps.`);
        return false;
      }
      update((d) => ({
        ...d,
        steps: [...d.steps, step],
        entry_step: d.entry_step || step.id,
        ui_layout: position ? { ...d.ui_layout, [step.id]: position } : d.ui_layout,
      }));
      setSelectedId(step.id);
      return true;
    },
    [definition.steps.length, update],
  );

  const addItem = useCallback(
    (item: PaletteItem, position?: XYPosition) => {
      const step = stepFromItem(
        item,
        definition.steps.map((s) => s.id),
      );
      if (
        insertStep(step, position ?? nextFreePosition(definition.ui_layout, direction)) &&
        item.kind !== "type"
      ) {
        toast.success(`Added ${step.type} step "${step.id}"`);
      }
    },
    [definition.steps, definition.ui_layout, direction, insertStep],
  );

  const onDropItem = useCallback(
    (payload: string, position: XYPosition) => {
      const item = parsePaletteItem(payload);
      // Centre the node under the cursor rather than hanging it off its corner.
      if (item) addItem(item, { x: position.x - NODE_WIDTH / 2, y: position.y - 30 });
    },
    [addItem],
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

  const openCreate = (kind: "agent" | "activity") => {
    // The create modals portal to <body>, which is hidden while the canvas is full screen.
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
    if (kind === "agent") setShowAgentModal(true);
    else setSynthesizingActivity(true);
  };

  const issueCount = validation?.issues.length ?? 0;

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      {/* Top bar: identity on the left, status and actions on the right. */}
      <GlassPanel tone="raised" className="flex flex-wrap items-center gap-2 px-3 py-2">
        <div className="w-full sm:w-60">
          <Input
            value={definition.name}
            disabled={mode === "edit"}
            placeholder="workflow_name"
            aria-label="Workflow name"
            title={nameError ?? "Workflow name"}
            onChange={(e) => update((d) => ({ ...d, name: e.target.value }))}
            className={cn("h-8 font-mono text-xs", nameError && "border-red/60")}
          />
        </div>
        <Input
          value={definition.description ?? ""}
          placeholder="What this workflow produces, in one line."
          aria-label="Description"
          onChange={(e) => update((d) => ({ ...d, description: e.target.value }))}
          className="h-8 min-w-[12rem] flex-1 text-xs"
        />
        <div className="ml-auto flex flex-wrap items-center gap-1.5">
          {dirty ? (
            <span
              className="inline-flex items-center gap-1.5 px-1 font-mono text-[10px] text-muted-foreground"
              title="Unsaved changes"
            >
              <span className="size-1.5 rounded-full bg-amber" /> Unsaved
            </span>
          ) : null}
          <button
            type="button"
            onClick={() => setDetailsTab("issues")}
            title={issueCount ? `${issueCount} issue(s) — click to review` : "Validation"}
            className="rounded transition hover:opacity-80"
          >
            <ValidationSummary result={validation} pending={validating} />
          </button>
          <Button size="sm" variant="outline" onClick={() => setDetailsTab("workflow")}>
            <Settings2 className="size-3.5" /> Settings
          </Button>
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
        {nameError ? <p className="w-full text-[11px] text-red">{nameError}</p> : null}
      </GlassPanel>

      {/* Canvas fills everything that is left. */}
      <GlassPanel className="relative min-h-[420px] flex-1 overflow-hidden">
        <GraphCanvas
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onNodeClick={(_, node) => {
            setSelectedId(node.id);
            setDetailsTab("step");
          }}
          onPaneClick={() => setSelectedId(null)}
          catalog={catalog}
          onDropItem={onDropItem}
          dropMimeType={PALETTE_MIME}
          showMinimap={showMinimap}
          className="relative h-full w-full"
          overlay={
            <>
              <div className="flex items-start gap-2">
                <PaletteToggle open={paletteOpen} onToggle={() => setPaletteOpen((o) => !o)} />
                <div className="hidden lg:block">
                  <GraphLegend />
                </div>
              </div>
              <div className="pointer-events-auto flex items-center gap-1 rounded-lg border border-border bg-background-elevated/90 p-1 shadow-sm backdrop-blur-sm">
                {selected ? (
                  <>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 max-w-40 px-2 text-xs"
                      onClick={() => setDetailsTab("step")}
                      title="Edit the selected step"
                    >
                      <SlidersHorizontal className="size-3" />
                      <span className="truncate font-mono">{selected.id}</span>
                    </Button>
                    <div className="mx-0.5 h-3 w-px bg-border" />
                  </>
                ) : null}
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
                <div className="mx-0.5 h-3 w-px bg-border" />
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
                <div className="mx-0.5 h-3 w-px bg-border" />
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
        >
          <BuilderPalette
            open={paletteOpen}
            onClose={() => setPaletteOpen(false)}
            catalog={catalog}
            stepCount={definition.steps.length}
            onAdd={(item) => addItem(item)}
            onCreate={openCreate}
          />
          {definition.steps.length === 0 ? (
            <div className="absolute inset-0 grid place-items-center p-6">
              <div className="glass max-w-sm rounded-xl border border-dashed border-border-strong px-6 py-5 text-center animate-in fade-in-0 zoom-in-95">
                <Blocks className="mx-auto mb-2 size-6 text-primary" />
                <p className="text-sm font-semibold text-foreground">Start with a step</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Open the palette and click a step, or drag one onto the canvas. Drag between
                  handles to wire steps together.
                </p>
                {!paletteOpen ? (
                  <Button
                    size="sm"
                    className="pointer-events-auto mt-3"
                    onClick={() => setPaletteOpen(true)}
                  >
                    <Blocks className="size-3.5" /> Open palette
                  </Button>
                ) : null}
              </div>
            </div>
          ) : null}
        </GraphCanvas>
      </GlassPanel>

      {/* Details: step inspector, workflow settings and issues, as a modal. */}
      <CanvasDialog
        open={detailsTab !== null}
        onOpenChange={(open) => !open && setDetailsTab(null)}
        title="Details"
        className="h-[min(85dvh,780px)] max-w-2xl"
      >
        <Tabs
          value={detailsTab ?? "step"}
          onValueChange={(v) => setDetailsTab(v as DetailsTab)}
          className="flex min-h-0 flex-1 flex-col"
        >
          <TabsList className="mr-8 justify-start self-start">
            <TabsTrigger value="step">Step</TabsTrigger>
            <TabsTrigger value="workflow">Workflow</TabsTrigger>
            <TabsTrigger value="issues">
              Issues{issueCount > 0 ? ` (${issueCount})` : ""}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="step" className="mt-3 min-h-0 flex-1">
            <StepInspector
              step={selected}
              catalog={catalog}
              stepIds={definition.steps.map((s) => s.id)}
              tiers={catalog?.tiers ?? ["foundation", "domain", "use_case"]}
              isEntry={selected?.id === definition.entry_step}
              onChange={changeStep}
              onDelete={(id) => {
                deleteStep(id);
                setDetailsTab(null);
              }}
              onSetEntry={(id) => update((d) => ({ ...d, entry_step: id }))}
            />
          </TabsContent>

          <TabsContent value="workflow" className="mt-3 min-h-0 flex-1">
            <WorkflowSettings definition={definition} update={update} />
          </TabsContent>

          <TabsContent value="issues" className="mt-3 min-h-0 flex-1">
            <GlassPanel className="custom-scrollbar h-full overflow-y-auto p-4">
              {validating ? (
                <p className="technical-label">Validating…</p>
              ) : (
                <IssueList
                  issues={validation?.issues ?? []}
                  onSelectStep={(id) => {
                    setSelectedId(id);
                    setDetailsTab("step");
                  }}
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
      </CanvasDialog>

      <CanvasDialog
        open={script !== null}
        onOpenChange={(open) => !open && setScript(null)}
        title="Compiled module"
        description="What the Mistral worker will run"
        className="h-[min(85dvh,820px)] max-w-4xl"
      >
        <CodeBlock code={script ?? ""} className="custom-scrollbar min-h-0 flex-1 overflow-auto" />
      </CanvasDialog>

      <CreateAgentModal
        open={showAgentModal}
        onOpenChange={setShowAgentModal}
        models={
          catalog?.models ?? ["mistral-large-latest", "mistral-small-latest", "codestral-latest"]
        }
        tiers={catalog?.tiers ?? ["foundation", "domain", "use_case"]}
        tools={catalog?.tools ?? []}
        connectors={catalog?.connectors ?? []}
        onCatalogChanged={() => {
          qc.invalidateQueries({ queryKey: QK.builderCatalog() });
          qc.invalidateQueries({ queryKey: QK.tools() });
        }}
        onCreated={(agentId, agentName) => {
          qc.invalidateQueries({ queryKey: QK.builderCatalog() });
          qc.invalidateQueries({ queryKey: QK.agents() });
          toast.success(`Agent "${agentName}" created`);
          insertStep({
            ...blankStep(
              uniqueStepId(
                definition.steps.map((s) => s.id),
                agentName,
              ),
              "agent",
            ),
            config: { agent_id: agentId, query_template: "" },
            description: agentName,
          });
        }}
      />

      {synthesizingActivity && (
        <CreateToolModal
          open={synthesizingActivity}
          onOpenChange={(open) => !open && setSynthesizingActivity(false)}
          purpose="activity"
          onCreated={(activityName) => {
            qc.invalidateQueries({ queryKey: QK.builderCatalog() });
            qc.invalidateQueries({ queryKey: QK.tools() });
            toast.success("Activity created");
            insertStep({
              ...blankStep(
                uniqueStepId(
                  definition.steps.map((s) => s.id),
                  activityName,
                ),
                "tool",
              ),
              config: { tool_name: activityName, arguments: {} },
            });
          }}
        />
      )}
    </div>
  );
}

/* ── Modal that stays visible when the canvas is full screen ───────────── */

/** Tracks the element currently in native full screen, so portals can render inside it. */
function useFullscreenElement() {
  const [el, setEl] = useState<HTMLElement | null>(null);
  useEffect(() => {
    const sync = () => setEl(document.fullscreenElement as HTMLElement | null);
    sync();
    document.addEventListener("fullscreenchange", sync);
    return () => document.removeEventListener("fullscreenchange", sync);
  }, []);
  return el;
}

function CanvasDialog({
  open,
  onOpenChange,
  title,
  description,
  className,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  className?: string;
  children: ReactNode;
}) {
  const container = useFullscreenElement();
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal container={container}>
        <DialogPrimitive.Overlay className="fixed inset-0 z-[80] bg-background/50 backdrop-blur-[2px] duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <DialogPrimitive.Content
          {...(description ? {} : { "aria-describedby": undefined })}
          className={cn(
            "fixed left-1/2 top-1/2 z-[80] flex w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2 flex-col gap-3 rounded-xl border border-border-strong bg-popover p-4 shadow-2xl duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[state=open]:slide-in-from-bottom-2",
            className,
          )}
        >
          {description ? (
            <div className="pr-8">
              <DialogPrimitive.Title className="font-display text-sm font-bold text-foreground">
                {title}
              </DialogPrimitive.Title>
              <DialogPrimitive.Description className="mt-1 text-xs text-muted-foreground">
                {description}
              </DialogPrimitive.Description>
            </div>
          ) : (
            <DialogPrimitive.Title className="sr-only">{title}</DialogPrimitive.Title>
          )}
          {children}
          <DialogPrimitive.Close
            className="absolute right-3 top-3 rounded-md p-1.5 text-muted-foreground transition hover:bg-surface-hover hover:text-foreground"
            aria-label="Close"
          >
            <X className="size-4" />
          </DialogPrimitive.Close>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

/* ── Compact page header for the full-height builder pages ─────────────── */

export function BuilderHeader({
  title,
  description,
  back,
}: {
  title: ReactNode;
  description?: ReactNode;
  back: ReactNode;
}) {
  return (
    <div className="flex min-w-0 items-center gap-3">
      {back}
      <div className="min-w-0">
        <p className="eyebrow text-[10px]">Builder</p>
        <h1 className="truncate text-lg font-semibold leading-tight tracking-tight text-foreground">
          {title}
        </h1>
      </div>
      {description ? (
        <p className="hidden min-w-0 flex-1 truncate border-l border-border pl-3 text-xs text-muted-foreground xl:block">
          {description}
        </p>
      ) : null}
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
    <GlassPanel className="flex h-full flex-col overflow-hidden">
      <GlassPanelHeader title="Workflow settings" description="Entry point and run inputs" />
      <div className="custom-scrollbar min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
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
          <label className="eyebrow mb-1.5 block">Rules</label>
          <p className="mb-2 text-[11px] text-muted-foreground">
            Checked when the workflow is saved and published, and while it runs.
          </p>
          <RuleSelector
            scope="workflow"
            value={definition.rules ?? []}
            onChange={(rules) => update((d) => ({ ...d, rules }))}
            suggestHint={definition.steps.length ? undefined : "Add steps first"}
            onSuggest={async () =>
              (
                await rulesApi.suggest({
                  scope: "workflow",
                  name: definition.name,
                  description: definition.description ?? "",
                  definition,
                })
              ).selected
            }
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
                      {["string", "number", "integer", "boolean", "object", "array"].map((t) => (
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
                  {/* Presentation hints for the run form; inferred when left blank. */}
                  <div className="mt-2 grid grid-cols-2 gap-2">
                    <Input
                      value={f.label ?? ""}
                      placeholder="Form label"
                      onChange={(e) => setField(i, { label: e.target.value || undefined })}
                      className="h-8 text-xs"
                    />
                    <select
                      title="How the run form collects this input"
                      className="h-8 rounded-md border border-input bg-background-elevated/70 px-2 text-xs text-foreground"
                      value={f.format ?? ""}
                      onChange={(e) => setField(i, { format: e.target.value || undefined })}
                    >
                      <option value="">Format: auto</option>
                      {[
                        "text",
                        "long_text",
                        "email",
                        "url",
                        "date",
                        "datetime",
                        "integer",
                        "currency",
                        "percent",
                      ].map((fmt) => (
                        <option key={fmt} value={fmt}>
                          {fmt.replace("_", " ")}
                        </option>
                      ))}
                    </select>
                    <Input
                      value={(f.enum ?? []).join(", ")}
                      placeholder="Allowed values (a, b, c)"
                      onChange={(e) => {
                        const opts = e.target.value
                          .split(",")
                          .map((o) => o.trim())
                          .filter(Boolean);
                        setField(i, { enum: opts.length ? opts : undefined });
                      }}
                      className="h-8 text-xs"
                    />
                    <Input
                      value={
                        f.example === undefined || f.example === null
                          ? ""
                          : typeof f.example === "string"
                            ? f.example
                            : JSON.stringify(f.example)
                      }
                      placeholder="Example value"
                      onChange={(e) => setField(i, { example: e.target.value || undefined })}
                      className="h-8 text-xs"
                    />
                  </div>
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
