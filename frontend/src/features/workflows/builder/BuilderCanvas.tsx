/**
 * BuilderCanvas — the ReactFlow surface.
 *
 * Holds no authoritative state: nodes and edges are derived from the store's
 * definition on every render, and every gesture is translated back into a store
 * action. That one-way flow is what keeps the canvas, JSON and script views in
 * agreement.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Background,
  BackgroundVariant,
  ConnectionLineType,
  Controls,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  applyNodeChanges,
  type Connection,
  type Edge,
  type Node,
  type NodeChange,
  type OnConnect,
  type ReactFlowInstance,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import {
  Columns,
  Copy as CopyIcon,
  Eye,
  EyeOff,
  Flag,
  Grid3x3,
  Keyboard,
  LayoutGrid,
  Maximize2,
  Redo2,
  Rows,
  Trash2,
  Undo2,
  X as XIcon,
} from 'lucide-react';
import { useBuilderStore } from './useBuilderStore';
import {
  BuilderAgentNode,
  BuilderConditionNode,
  BuilderConnectorNode,
  BuilderToolNode,
  BuilderTransformNode,
} from './BuilderNodes';
import {
  agentStepAt,
  definitionToFlow,
  makeAgentStep,
  makeActivityStep,
  makeLogicStep,
  uniqueStepId,
} from './graphModel';
import type {
  CatalogAgent,
  CatalogConnector,
  CatalogTool,
  WorkflowStep,
} from '../../../api/workflowBuilder';
import { cn } from '../../../lib/utils';

/** Payload written to dataTransfer by palette items. */
export interface DragPayload {
  kind: 'agent' | 'tool' | 'connector' | 'logic' | 'activity';
  agent?: CatalogAgent;
  tool?: CatalogTool;
  connector?: CatalogConnector;
  logic?: 'condition' | 'transform';
  /** A standalone Activity — always becomes a step of its own, never attaches. */
  activity?: CatalogTool;
}

export const DRAG_MIME = 'application/x-mistral-workflow-step';

/**
 * A second, payload-free MIME type set when dragging something that only
 * attaches to an agent — a tool or a connector — rather than becoming a step
 * of its own.
 *
 * `dataTransfer.getData()` returns "" during dragover for security reasons —
 * only `types` is readable. Advertising the kind as its own type is what lets
 * the canvas highlight valid agent targets while the drag is still in flight.
 * An Activity drag sets neither hint: it always has somewhere to go, so
 * dragover never needs to gate or highlight it.
 */
export const DRAG_ATTACH_HINT = 'application/x-mistral-agent-attachment';

/** Snap grid, in flow units. Matches the Background dot spacing. */
const GRID: [number, number] = [22, 22];

// Module-level so the identity is stable — a new object each render makes
// ReactFlow remount every node.
const BUILDER_NODE_TYPES = {
  agent: BuilderAgentNode,
  tool: BuilderToolNode,
  connector: BuilderConnectorNode,
  condition: BuilderConditionNode,
  transform: BuilderTransformNode,
};

/** Shown in the shortcuts overlay. Keys are split on "+" to render as chips. */
const SHORTCUTS: [string, string][] = [
  ['Ctrl+Z', 'Undo'],
  ['Ctrl+Shift+Z', 'Redo'],
  ['Ctrl+A', 'Select all steps'],
  ['Ctrl+C', 'Copy selection'],
  ['Ctrl+V', 'Paste (keeps edges inside the copy)'],
  ['Ctrl+D', 'Duplicate selection'],
  ['Del', 'Delete selection or picked connection'],
  ['F', 'Zoom to selection, or fit the whole graph'],
  ['Shift+drag', 'Rubber-band select'],
  ['Ctrl+click', 'Add or remove one node from the selection'],
  ['Right-click', 'Node menu'],
  ['Esc', 'Clear selection'],
  ['?', 'This panel'],
];

function MenuItem({
  icon,
  label,
  onClick,
  disabled,
  danger,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'w-full flex items-center gap-2 px-3 py-1.5 text-[11px] text-left transition-colors',
        disabled
          ? 'text-[var(--color-text-muted)] opacity-40 cursor-not-allowed'
          : danger
            ? 'text-[var(--color-text-secondary)] hover:bg-red-500/10 hover:text-red-400'
            : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover)] hover:text-white',
      )}
    >
      <span className="shrink-0">{icon}</span>
      {label}
    </button>
  );
}

function ToolbarButton({
  onClick,
  disabled,
  title,
  active,
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  title: string;
  active?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-label={title}
      aria-pressed={active}
      className={cn(
        'w-8 h-8 rounded-lg flex items-center justify-center border transition-colors',
        disabled
          ? 'opacity-35 cursor-not-allowed border-transparent text-[var(--color-text-muted)]'
          : active
            ? 'bg-[rgba(99,102,241,0.18)] border-[rgba(99,102,241,0.45)] text-[#a5b4fc]'
            : 'bg-[rgba(255,255,255,0.03)] border-[var(--color-border-subtle)] text-[var(--color-text-muted)] hover:text-white hover:border-[rgba(99,102,241,0.4)]',
      )}
    >
      {children}
    </button>
  );
}

export interface CanvasProps {
  /** Catalog agents, keyed by id — agent nodes read their tools from here. */
  agentsById: Record<string, CatalogAgent>;
  /** Catalog connectors, keyed by id — agent nodes resolve names from here. */
  connectorsById: Record<string, CatalogConnector>;
  /** Attach a tool to the agent bound to a step. Resolves when Mistral is updated. */
  onAttachTool: (stepId: string, tool: CatalogTool) => void;
  /** Attach a connector to the agent bound to a step. Same contract as a tool. */
  onAttachConnector: (stepId: string, connector: CatalogConnector) => void;
  /** Surface a message when a gesture cannot be completed. */
  onNotify: (kind: 'success' | 'error', message: string) => void;
}

function CanvasInner({
  agentsById,
  connectorsById,
  onAttachTool,
  onAttachConnector,
  onNotify,
}: CanvasProps) {
  const definition = useBuilderStore((s) => s.definition);
  const selectedStepId = useBuilderStore((s) => s.selectedStepId);
  const validation = useBuilderStore((s) => s.validation);
  const select = useBuilderStore((s) => s.select);
  const addStep = useBuilderStore((s) => s.addStep);
  const addSteps = useBuilderStore((s) => s.addSteps);
  const moveNodes = useBuilderStore((s) => s.moveNodes);
  const connect = useBuilderStore((s) => s.connect);
  const disconnect = useBuilderStore((s) => s.disconnect);
  const removeStep = useBuilderStore((s) => s.removeStep);
  const removeSteps = useBuilderStore((s) => s.removeSteps);
  const duplicateStep = useBuilderStore((s) => s.duplicateStep);
  const setEntryStep = useBuilderStore((s) => s.setEntryStep);
  const runAutoLayout = useBuilderStore((s) => s.runAutoLayout);
  const undo = useBuilderStore((s) => s.undo);
  const redo = useBuilderStore((s) => s.redo);
  const past = useBuilderStore((s) => s.past);
  const future = useBuilderStore((s) => s.future);

  const [instance, setInstance] = useState<ReactFlowInstance | null>(null);
  const [direction, setDirection] = useState<'TB' | 'LR'>('TB');
  const [showMinimap, setShowMinimap] = useState(true);
  // Agent step currently under a dragged tool, for the drop-target highlight.
  const [attachTargetId, setAttachTargetId] = useState<string | null>(null);
  // Picked connection. Held here rather than in the store because it is pure
  // canvas UI — nothing else in the builder needs to know which edge is
  // highlighted, and it must not survive into the saved definition.
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  // Multi-selection. The store keeps `selectedStepId` for the inspector, which
  // edits one step at a time; this set is what bulk actions operate on.
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(() => new Set());
  const [snapToGrid, setSnapToGrid] = useState(false);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; stepId: string } | null>(
    null,
  );
  const [showShortcuts, setShowShortcuts] = useState(false);
  // Copied steps live in a ref: the clipboard is not rendered, so holding it in
  // state would re-render the canvas for nothing.
  const clipboardRef = useRef<WorkflowStep[]>([]);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const didInitialFit = useRef(false);

  const derived = useMemo(
    () =>
      definitionToFlow(definition, {
        selectedIds,
        issues: validation?.issues ?? [],
        agentsById,
        connectorsById,
        attachTargetId,
        selectedEdgeId,
      }),
    [definition, selectedIds, validation, agentsById, connectorsById, attachTargetId, selectedEdgeId],
  );

  // The inspector follows the selection when exactly one node is picked;
  // with several, editing a single step's fields would be misleading.
  useEffect(() => {
    if (selectedIds.size === 1) {
      const [only] = selectedIds;
      if (only !== selectedStepId) select(only);
    } else if (selectedIds.size === 0 && selectedStepId) {
      select(null);
    }
  }, [selectedIds, selectedStepId, select]);

  /* ── Rendered graph ───────────────────────────────────────────────── */

  // Nodes are held locally rather than passed straight from `derived`.
  //
  // A drag emits a position change per animation frame. Writing those to the
  // store rebuilt the entire graph — every node object, every edge, every
  // node's `data` — 60 times a second, which is what made the canvas crawl.
  // Now ReactFlow mutates this local array during the gesture and the store
  // hears about it exactly once, on drag end. The definition stays the source
  // of truth; it just is not consulted mid-gesture.
  const [nodes, setNodes] = useState<Node[]>(derived.nodes);
  const edges = derived.edges;

  // While a drag is in flight the store must not clobber the live positions.
  const draggingRef = useRef(false);

  useEffect(() => {
    if (draggingRef.current) return;
    setNodes(derived.nodes);
  }, [derived.nodes]);

  // Fit the view once, when the first steps appear — refitting on every change
  // would yank the viewport out from under someone mid-edit.
  useEffect(() => {
    if (!instance || didInitialFit.current || nodes.length === 0) return;
    didInitialFit.current = true;
    const timer = setTimeout(() => instance.fitView({ padding: 0.2, duration: 500 }), 60);
    return () => clearTimeout(timer);
  }, [instance, nodes.length]);

  // Per frame this is the only work that runs: a plain array transform. No
  // store write, no graph rebuild, no validation, no re-derivation.
  const onNodesChange = useCallback(
    (changes: NodeChange[]) => {
      setNodes((current) => applyNodeChanges(changes, current));

      const removals = changes.filter((c) => c.type === 'remove').map((c) => c.id);
      if (removals.length > 0) removeSteps(removals);

      // Box-select and shift-click arrive here as `select` changes. Mirroring
      // them into our own set keeps ReactFlow's selection and the derived
      // `selected` flags from fighting each other.
      const selections = changes.filter(
        (c): c is NodeChange & { type: 'select'; id: string; selected: boolean } =>
          c.type === 'select',
      );
      if (selections.length > 0) {
        setSelectedIds((current) => {
          const next = new Set(current);
          for (const change of selections) {
            if (change.selected) next.add(change.id);
            else next.delete(change.id);
          }
          return next;
        });
        setSelectedEdgeId(null);
      }
    },
    [removeSteps],
  );

  const onNodeDragStart = useCallback(() => {
    draggingRef.current = true;
  }, []);

  // One store write per gesture. Reading from the instance rather than local
  // state picks up multi-node drags without tracking which nodes moved.
  const onNodeDragStop = useCallback(() => {
    draggingRef.current = false;
    if (!instance) return;

    const moved: Record<string, { x: number; y: number }> = {};
    for (const node of instance.getNodes()) {
      const at = definition.ui_layout?.[node.id];
      const x = Math.round(node.position.x);
      const y = Math.round(node.position.y);
      if (!at || at.x !== x || at.y !== y) moved[node.id] = { x, y };
    }
    moveNodes(moved);
  }, [instance, definition.ui_layout, moveNodes]);

  const onConnect: OnConnect = useCallback(
    (connection: Connection) => {
      if (!connection.source || !connection.target) return;
      const branch =
        connection.sourceHandle === 'true'
          ? 'true'
          : connection.sourceHandle === 'false'
            ? 'false'
            : undefined;
      connect(connection.source, connection.target, branch);
    },
    [connect],
  );

  const onEdgesDelete = useCallback(
    (deleted: Edge[]) => {
      for (const edge of deleted) {
        const kind = (edge.data?.kind as 'next' | 'true' | 'false') ?? 'next';
        disconnect(edge.source, edge.target, kind);
      }
    },
    [disconnect],
  );

  // ReactFlow already emits `select` changes for clicks, including shift-click
  // additive selection, so this only clears the edge picker and the menu.
  const onNodeClick = useCallback(() => {
    setSelectedEdgeId(null);
    setContextMenu(null);
  }, []);

  const onNodeContextMenu = useCallback(
    (event: React.MouseEvent, node: Node) => {
      event.preventDefault();
      const bounds = wrapperRef.current?.getBoundingClientRect();
      setContextMenu({
        x: event.clientX - (bounds?.left ?? 0),
        y: event.clientY - (bounds?.top ?? 0),
        stepId: node.id,
      });
      // Right-clicking outside the selection re-targets it, matching the way
      // file managers and design tools behave.
      setSelectedIds((current) => (current.has(node.id) ? current : new Set([node.id])));
    },
    [],
  );

  // Edge and step selection are mutually exclusive: Delete has to act on
  // exactly one thing, and picking an edge while a step is selected would make
  // it ambiguous which one the key removes.
  const onEdgeClick = useCallback(
    (event: React.MouseEvent, edge: Edge) => {
      event.stopPropagation();
      select(null);
      setSelectedEdgeId(edge.id);
    },
    [select],
  );

  const removeEdge = useCallback(
    (edgeId: string) => {
      const edge = edges.find((e) => e.id === edgeId);
      if (!edge) return;
      const kind = (edge.data?.kind as 'next' | 'true' | 'false') ?? 'next';
      disconnect(edge.source, edge.target, kind);
      setSelectedEdgeId(null);
    },
    [edges, disconnect],
  );

  const onPaneClick = useCallback(() => {
    select(null);
    setSelectedIds(new Set());
    setSelectedEdgeId(null);
    setContextMenu(null);
  }, [select]);

  /* ── Bulk actions ─────────────────────────────────────────────────── */

  const selectAll = useCallback(() => {
    setSelectedIds(new Set(definition.steps.map((s) => s.id)));
    setSelectedEdgeId(null);
  }, [definition.steps]);

  const copySelection = useCallback(() => {
    const picked = definition.steps.filter((s) => selectedIds.has(s.id));
    if (picked.length === 0) return 0;
    clipboardRef.current = picked;
    return picked.length;
  }, [definition.steps, selectedIds]);

  /**
   * Paste the clipboard as fresh steps.
   *
   * Edges between copied steps are preserved and rewritten to the new ids;
   * edges pointing outside the copied set are dropped, because duplicating a
   * fan-out into the rest of the graph is almost never what is wanted.
   */
  const pasteClipboard = useCallback(() => {
    const source = clipboardRef.current;
    if (source.length === 0) return 0;

    const taken = new Set(definition.steps.map((s) => s.id));
    const idMap = new Map<string, string>();
    for (const step of source) {
      const fresh = uniqueStepId(`${step.id}_copy`, taken);
      taken.add(fresh);
      idMap.set(step.id, fresh);
    }

    const remap = (target: string) => idMap.get(target);
    const layout: Record<string, { x: number; y: number }> = {};

    const pasted = source.map((step) => {
      const id = idMap.get(step.id)!;
      const at = definition.ui_layout?.[step.id] ?? { x: 0, y: 0 };
      layout[id] = { x: at.x + 40, y: at.y + 40 };

      const config = { ...step.config };
      if (step.type === 'condition') {
        for (const key of ['true_step', 'false_step'] as const) {
          const branch = config[key];
          config[key] = typeof branch === 'string' ? (remap(branch) ?? '') : '';
        }
      }

      return {
        ...step,
        id,
        config,
        next_steps: (step.next_steps ?? [])
          .map(remap)
          .filter((t: string | undefined): t is string => Boolean(t)),
      };
    });

    addSteps(pasted, layout);
    setSelectedIds(new Set(pasted.map((s) => s.id)));
    return pasted.length;
  }, [definition.steps, definition.ui_layout, addSteps]);

  const deleteSelection = useCallback(() => {
    if (selectedIds.size === 0) return;
    removeSteps([...selectedIds]);
    setSelectedIds(new Set());
    setContextMenu(null);
  }, [selectedIds, removeSteps]);

  // Resolved from the derived edges, so a selection left dangling by an edit
  // elsewhere (a step renamed or removed) simply stops rendering.
  const selectedEdge = useMemo(
    () => (selectedEdgeId ? (edges.find((e) => e.id === selectedEdgeId) ?? null) : null),
    [edges, selectedEdgeId],
  );

  /* ── Drop from palette ────────────────────────────────────────────── */

  // The drag payload is only readable on drop, so the palette also advertises
  // the kind as a bare MIME type that IS visible during dragover.
  const onDragOver = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();

      const draggingAttachment = event.dataTransfer.types.includes(DRAG_ATTACH_HINT);
      if (!draggingAttachment || !instance) {
        event.dataTransfer.dropEffect = 'copy';
        if (attachTargetId) setAttachTargetId(null);
        return;
      }

      const point = instance.screenToFlowPosition({ x: event.clientX, y: event.clientY });
      const target = agentStepAt(definition, point);
      // A tool or connector has nowhere to go except onto an agent, so say so
      // with the cursor.
      event.dataTransfer.dropEffect = target ? 'copy' : 'none';
      setAttachTargetId(target?.id ?? null);
    },
    [instance, definition, attachTargetId],
  );

  const onDragLeave = useCallback(() => setAttachTargetId(null), []);

  const onDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();
      setAttachTargetId(null);
      if (!instance) return;

      const raw = event.dataTransfer.getData(DRAG_MIME);
      if (!raw) return;

      let payload: DragPayload;
      try {
        payload = JSON.parse(raw) as DragPayload;
      } catch {
        return;
      }

      // Drop where the cursor is, not where the node list happens to end.
      const position = instance.screenToFlowPosition({
        x: event.clientX,
        y: event.clientY,
      });

      // ── Tools and connectors are not steps ───────────────────────────
      // Neither executes on its own: the agent's model decides when to call
      // them and with what arguments. So both drops attach to the agent
      // underneath, and both fail the same way when there isn't one.
      if (
        (payload.kind === 'tool' && payload.tool) ||
        (payload.kind === 'connector' && payload.connector)
      ) {
        const noun = payload.kind === 'tool' ? 'Tools' : 'Connectors';
        const target = agentStepAt(definition, position);
        if (!target) {
          onNotify(
            'error',
            `${noun} run through an agent — drop this onto an agent step to attach it.`,
          );
          return;
        }
        if (!target.config?.agent_id) {
          onNotify('error', `Step "${target.id}" has no agent bound yet — pick one first.`);
          select(target.id);
          return;
        }
        if (payload.kind === 'tool' && payload.tool) {
          onAttachTool(target.id, payload.tool);
        } else if (payload.connector) {
          onAttachConnector(target.id, payload.connector);
        }
        select(target.id);
        return;
      }

      const taken = definition.steps.map((s) => s.id);
      let step;
      if (payload.kind === 'agent' && payload.agent) {
        step = makeAgentStep(payload.agent, uniqueStepId(payload.agent.name, taken));
      } else if (payload.kind === 'activity' && payload.activity) {
        step = makeActivityStep(payload.activity, uniqueStepId(payload.activity.name, taken));
      } else if (payload.kind === 'logic' && payload.logic) {
        step = makeLogicStep(payload.logic, uniqueStepId(payload.logic, taken));
      }
      if (!step) return;

      addStep(step, { x: Math.round(position.x), y: Math.round(position.y) });
      select(step.id);
    },
    [instance, definition, addStep, select, onAttachTool, onAttachConnector, onNotify],
  );

  /* ── Keyboard ─────────────────────────────────────────────────────── */

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      // Never steal keys from a field the user is typing in.
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable)
      ) {
        return;
      }

      const key = event.key.toLowerCase();
      const mod = event.ctrlKey || event.metaKey;
      const take = () => event.preventDefault();

      if (mod && key === 'z') {
        take();
        if (event.shiftKey) redo();
        else undo();
      } else if (mod && key === 'y') {
        take();
        redo();
      } else if (mod && key === 'a') {
        take();
        selectAll();
      } else if (mod && key === 'c') {
        const n = copySelection();
        if (n > 0) {
          take();
          onNotify('success', `Copied ${n} step${n === 1 ? '' : 's'}.`);
        }
      } else if (mod && key === 'v') {
        const n = pasteClipboard();
        if (n > 0) {
          take();
          onNotify('success', `Pasted ${n} step${n === 1 ? '' : 's'}.`);
        }
      } else if (mod && key === 'd') {
        // Duplicate is copy+paste in one gesture, so it also keeps inner edges.
        if (selectedIds.size > 0) {
          take();
          copySelection();
          pasteClipboard();
        }
      } else if (event.key === 'Delete' || event.key === 'Backspace') {
        // ReactFlow's own delete handling is disabled (deleteKeyCode={null}),
        // so both step and connection deletion run through here.
        if (selectedEdgeId) {
          take();
          removeEdge(selectedEdgeId);
        } else if (selectedIds.size > 0) {
          take();
          deleteSelection();
        }
      } else if (key === 'f' && !mod) {
        take();
        // Frame the selection when there is one, otherwise the whole graph.
        instance?.fitView({
          padding: 0.2,
          duration: 400,
          nodes: selectedIds.size > 0 ? [...selectedIds].map((id) => ({ id })) : undefined,
        });
      } else if (key === '?' || (event.shiftKey && key === '/')) {
        take();
        setShowShortcuts((v) => !v);
      } else if (event.key === 'Escape') {
        select(null);
        setSelectedIds(new Set());
        setSelectedEdgeId(null);
        setContextMenu(null);
        setShowShortcuts(false);
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [
    undo,
    redo,
    select,
    selectedIds,
    selectedEdgeId,
    removeEdge,
    selectAll,
    copySelection,
    pasteClipboard,
    deleteSelection,
    instance,
    onNotify,
  ]);

  const isEmpty = definition.steps.length === 0;

  return (
    <div
      ref={wrapperRef}
      className="relative flex-1 min-h-0"
      onDrop={onDrop}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
    >
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={BUILDER_NODE_TYPES}
        onNodesChange={onNodesChange}
        onNodeDragStart={onNodeDragStart}
        onNodeDragStop={onNodeDragStop}
        onConnect={onConnect}
        onEdgesDelete={onEdgesDelete}
        onNodeClick={onNodeClick}
        onNodeContextMenu={onNodeContextMenu}
        onEdgeClick={onEdgeClick}
        onPaneClick={onPaneClick}
        onPaneContextMenu={(e) => e.preventDefault()}
        onInit={setInstance}
        connectionLineType={ConnectionLineType.SmoothStep}
        connectionLineStyle={{ stroke: '#818cf8', strokeWidth: 2 }}
        defaultViewport={{ x: 0, y: 0, zoom: 0.85 }}
        minZoom={0.2}
        maxZoom={1.6}
        deleteKeyCode={null}
        // Shift+drag rubber-bands a selection; plain drag still pans, which is
        // the muscle memory people bring from every other canvas tool.
        selectionKeyCode="Shift"
        multiSelectionKeyCode={['Meta', 'Control']}
        snapToGrid={snapToGrid}
        snapGrid={GRID}
        // Above ~40 nodes the win from skipping off-screen nodes outweighs the
        // per-viewport-change bookkeeping it costs.
        onlyRenderVisibleElements={nodes.length > 40}
        className="!bg-[rgba(8,11,19,0.95)]"
        proOptions={{ hideAttribution: true }}
      >
        <Background variant={BackgroundVariant.Dots} gap={22} size={1} color="rgba(148,163,184,0.16)" />
        <Controls
          showInteractive={false}
          className="!bg-[rgba(15,20,28,0.9)] !border !border-[var(--color-border-subtle)] !rounded-lg [&>button]:!bg-transparent [&>button]:!border-none [&>button]:!text-[var(--color-text-muted)] [&>button:hover]:!text-white"
        />
        {showMinimap && (
          <MiniMap
            pannable
            zoomable
            className="!bg-[rgba(15,20,28,0.92)] !border !border-[var(--color-border-subtle)] !rounded-lg"
            maskColor="rgba(8,11,19,0.7)"
            nodeColor={(node) => {
              if (node.type === 'agent') return '#818cf8';
              if (node.type === 'tool') return '#f472b6';
              if (node.type === 'connector') return '#34d399';
              if (node.type === 'condition') return '#fbbf24';
              return '#22d3ee';
            }}
          />
        )}
      </ReactFlow>

      {/* Selected connection — an explicit button, because a keyboard-only
          delete is undiscoverable on a line you just clicked. */}
      {selectedEdge && (
        <div className="absolute top-3 left-1/2 -translate-x-1/2 flex items-center gap-2 pl-3 pr-1.5 py-1.5 rounded-xl bg-[rgba(15,20,28,0.94)] border border-[rgba(129,140,248,0.45)] backdrop-blur-md shadow-lg z-10">
          <span className="text-[11px] text-[var(--color-text-secondary)] font-mono">
            {selectedEdge.source} → {selectedEdge.target}
          </span>
          <button
            type="button"
            onClick={() => removeEdge(selectedEdge.id)}
            title="Delete connection (Del)"
            aria-label="Delete connection"
            className="flex items-center gap-1 px-2 py-1 rounded-lg border border-[var(--color-border-subtle)] bg-[rgba(255,255,255,0.03)] text-[11px] text-[var(--color-text-muted)] hover:text-red-400 hover:border-red-400/40 transition-colors"
          >
            <Trash2 size={12} />
            Delete
          </button>
        </div>
      )}

      {/* Multi-selection summary — bulk actions need a visible home. */}
      {selectedIds.size > 1 && (
        <div className="absolute top-3 left-1/2 -translate-x-1/2 flex items-center gap-2 pl-3 pr-1.5 py-1.5 rounded-xl bg-[rgba(15,20,28,0.94)] border border-[rgba(129,140,248,0.45)] backdrop-blur-md shadow-lg z-10">
          <span className="text-[11px] text-[var(--color-text-secondary)]">
            {selectedIds.size} steps selected
          </span>
          <button
            type="button"
            onClick={() => {
              copySelection();
              pasteClipboard();
            }}
            title="Duplicate selection (Ctrl+D)"
            className="flex items-center gap-1 px-2 py-1 rounded-lg border border-[var(--color-border-subtle)] bg-[rgba(255,255,255,0.03)] text-[11px] text-[var(--color-text-muted)] hover:text-white transition-colors"
          >
            <CopyIcon size={12} />
            Duplicate
          </button>
          <button
            type="button"
            onClick={deleteSelection}
            title="Delete selection (Del)"
            className="flex items-center gap-1 px-2 py-1 rounded-lg border border-[var(--color-border-subtle)] bg-[rgba(255,255,255,0.03)] text-[11px] text-[var(--color-text-muted)] hover:text-red-400 hover:border-red-400/40 transition-colors"
          >
            <Trash2 size={12} />
            Delete
          </button>
        </div>
      )}

      {/* Right-click menu on a node */}
      {contextMenu && (
        <div
          className="absolute z-20 min-w-[178px] py-1 rounded-xl bg-[rgba(15,20,28,0.97)] border border-[var(--color-border-subtle)] backdrop-blur-md shadow-2xl"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onMouseLeave={() => setContextMenu(null)}
        >
          <MenuItem
            icon={<Flag size={12} />}
            label="Make entry step"
            disabled={definition.entry_step === contextMenu.stepId}
            onClick={() => {
              setEntryStep(contextMenu.stepId);
              setContextMenu(null);
            }}
          />
          <MenuItem
            icon={<CopyIcon size={12} />}
            label={selectedIds.size > 1 ? `Duplicate ${selectedIds.size} steps` : 'Duplicate'}
            onClick={() => {
              if (selectedIds.size > 1) {
                copySelection();
                pasteClipboard();
              } else {
                duplicateStep(contextMenu.stepId);
              }
              setContextMenu(null);
            }}
          />
          <MenuItem
            icon={<Maximize2 size={12} />}
            label="Zoom to this"
            onClick={() => {
              instance?.fitView({ padding: 0.4, duration: 400, nodes: [{ id: contextMenu.stepId }] });
              setContextMenu(null);
            }}
          />
          <div className="h-px bg-[var(--color-border-subtle)] my-1" />
          <MenuItem
            icon={<Trash2 size={12} />}
            label={selectedIds.size > 1 ? `Delete ${selectedIds.size} steps` : 'Delete'}
            danger
            onClick={() => {
              if (selectedIds.size > 1) deleteSelection();
              else removeStep(contextMenu.stepId);
              setContextMenu(null);
            }}
          />
        </div>
      )}

      {/* Shortcuts */}
      {showShortcuts && (
        <div
          className="absolute inset-0 z-30 flex items-center justify-center bg-black/50 backdrop-blur-sm"
          onClick={() => setShowShortcuts(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-[420px] max-h-[80%] overflow-y-auto custom-scrollbar rounded-xl bg-[rgba(15,20,28,0.98)] border border-[var(--color-border-subtle)] shadow-2xl p-5"
          >
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-semibold text-white">Keyboard shortcuts</h3>
              <button
                onClick={() => setShowShortcuts(false)}
                className="text-[var(--color-text-muted)] hover:text-white transition-colors"
              >
                <XIcon size={15} />
              </button>
            </div>
            <div className="space-y-1">
              {SHORTCUTS.map(([keys, description]) => (
                <div key={description} className="flex items-center justify-between py-1.5">
                  <span className="text-[11px] text-[var(--color-text-secondary)]">
                    {description}
                  </span>
                  <span className="flex items-center gap-1">
                    {keys.split('+').map((k) => (
                      <kbd
                        key={k}
                        className="px-1.5 py-0.5 rounded border border-[var(--color-border-subtle)] bg-[rgba(255,255,255,0.04)] text-[10px] font-mono text-[var(--color-text-muted)]"
                      >
                        {k}
                      </kbd>
                    ))}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Canvas toolbar */}
      <div className="absolute top-3 right-3 flex items-center gap-1.5 p-1.5 rounded-xl bg-[rgba(15,20,28,0.92)] border border-[var(--color-border-subtle)] backdrop-blur-md shadow-lg z-10">
        <ToolbarButton onClick={undo} disabled={past.length === 0} title="Undo (Ctrl+Z)">
          <Undo2 size={14} />
        </ToolbarButton>
        <ToolbarButton onClick={redo} disabled={future.length === 0} title="Redo (Ctrl+Shift+Z)">
          <Redo2 size={14} />
        </ToolbarButton>
        <div className="w-px h-5 bg-[var(--color-border-subtle)] mx-0.5" />
        <ToolbarButton onClick={() => runAutoLayout(direction)} title="Auto-arrange nodes">
          <LayoutGrid size={14} />
        </ToolbarButton>
        <ToolbarButton
          onClick={() => {
            const next = direction === 'TB' ? 'LR' : 'TB';
            setDirection(next);
            runAutoLayout(next);
          }}
          title={direction === 'TB' ? 'Switch to left-to-right' : 'Switch to top-to-bottom'}
        >
          {direction === 'TB' ? <Rows size={14} /> : <Columns size={14} />}
        </ToolbarButton>
        <ToolbarButton
          onClick={() => setSnapToGrid((v) => !v)}
          active={snapToGrid}
          title={snapToGrid ? 'Snap to grid: on' : 'Snap to grid: off'}
        >
          <Grid3x3 size={14} />
        </ToolbarButton>
        <div className="w-px h-5 bg-[var(--color-border-subtle)] mx-0.5" />
        <ToolbarButton
          onClick={() =>
            instance?.fitView({
              padding: 0.2,
              duration: 500,
              nodes: selectedIds.size > 0 ? [...selectedIds].map((id) => ({ id })) : undefined,
            })
          }
          title={selectedIds.size > 0 ? 'Zoom to selection (F)' : 'Fit to view (F)'}
        >
          <Maximize2 size={14} />
        </ToolbarButton>
        <ToolbarButton
          onClick={() => setShowMinimap((v) => !v)}
          active={showMinimap}
          title={showMinimap ? 'Hide minimap' : 'Show minimap'}
        >
          {showMinimap ? <Eye size={14} /> : <EyeOff size={14} />}
        </ToolbarButton>
        <div className="w-px h-5 bg-[var(--color-border-subtle)] mx-0.5" />
        <ToolbarButton
          onClick={deleteSelection}
          disabled={selectedIds.size === 0}
          title={
            selectedIds.size > 1
              ? `Delete ${selectedIds.size} selected steps (Del)`
              : 'Delete selected step (Del)'
          }
        >
          <Trash2 size={14} />
        </ToolbarButton>
        <ToolbarButton onClick={() => setShowShortcuts(true)} title="Keyboard shortcuts (?)">
          <Keyboard size={14} />
        </ToolbarButton>
      </div>

      {/* Empty state */}
      {isEmpty && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="text-center max-w-sm px-6">
            <div className="w-14 h-14 rounded-2xl border-2 border-dashed border-[var(--color-border-subtle)] flex items-center justify-center mx-auto mb-4">
              <LayoutGrid size={22} className="text-[var(--color-text-muted)]" />
            </div>
            <p className="text-sm font-semibold text-white mb-1.5">Drag an agent or activity onto the canvas</p>
            <p className="text-xs text-[var(--color-text-muted)] leading-relaxed">
              Agents and Activities are the steps. The first one you drop becomes the entry point.
              Connect steps by dragging from the dot at the bottom of a card, and drop a tool{' '}
              <em>onto</em> an agent to give it a new capability.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

export default function BuilderCanvas(props: CanvasProps) {
  return (
    <ReactFlowProvider>
      <CanvasInner {...props} />
    </ReactFlowProvider>
  );
}
