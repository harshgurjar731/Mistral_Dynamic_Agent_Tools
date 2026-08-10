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
  Eye,
  EyeOff,
  LayoutGrid,
  Maximize2,
  Redo2,
  Rows,
  Trash2,
  Undo2,
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
  makeLogicStep,
  uniqueStepId,
} from './graphModel';
import type { CatalogAgent, CatalogConnector, CatalogTool } from '../../../api/workflowBuilder';
import { cn } from '../../../lib/utils';

/** Payload written to dataTransfer by palette items. */
export interface DragPayload {
  kind: 'agent' | 'tool' | 'connector' | 'logic';
  agent?: CatalogAgent;
  tool?: CatalogTool;
  connector?: CatalogConnector;
  logic?: 'condition' | 'transform';
}

export const DRAG_MIME = 'application/x-mistral-workflow-step';

/**
 * A second, payload-free MIME type set when dragging anything that attaches to
 * an agent rather than becoming a step of its own — tools and connectors.
 *
 * `dataTransfer.getData()` returns "" during dragover for security reasons —
 * only `types` is readable. Advertising the kind as its own type is what lets
 * the canvas highlight valid agent targets while the drag is still in flight.
 */
export const DRAG_ATTACH_HINT = 'application/x-mistral-agent-attachment';

// Module-level so the identity is stable — a new object each render makes
// ReactFlow remount every node.
const BUILDER_NODE_TYPES = {
  agent: BuilderAgentNode,
  tool: BuilderToolNode,
  connector: BuilderConnectorNode,
  condition: BuilderConditionNode,
  transform: BuilderTransformNode,
};

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
  const moveNode = useBuilderStore((s) => s.moveNode);
  const commitLayout = useBuilderStore((s) => s.commitLayout);
  const connect = useBuilderStore((s) => s.connect);
  const disconnect = useBuilderStore((s) => s.disconnect);
  const removeStep = useBuilderStore((s) => s.removeStep);
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
  const wrapperRef = useRef<HTMLDivElement>(null);
  const didInitialFit = useRef(false);

  const { nodes, edges } = useMemo(
    () =>
      definitionToFlow(definition, {
        selectedId: selectedStepId,
        issues: validation?.issues ?? [],
        agentsById,
        connectorsById,
        attachTargetId,
        selectedEdgeId,
      }),
    [
      definition,
      selectedStepId,
      validation,
      agentsById,
      connectorsById,
      attachTargetId,
      selectedEdgeId,
    ],
  );

  // Fit the view once, when the first steps appear — refitting on every change
  // would yank the viewport out from under someone mid-edit.
  useEffect(() => {
    if (!instance || didInitialFit.current || nodes.length === 0) return;
    didInitialFit.current = true;
    const timer = setTimeout(() => instance.fitView({ padding: 0.2, duration: 500 }), 60);
    return () => clearTimeout(timer);
  }, [instance, nodes.length]);

  const onNodesChange = useCallback(
    (changes: NodeChange[]) => {
      for (const change of changes) {
        if (change.type === 'position' && change.position) {
          moveNode(change.id, { x: change.position.x, y: change.position.y });
          // dragging === false marks the end of the gesture: one history entry
          // for the whole drag rather than one per animation frame.
          if (change.dragging === false) commitLayout();
        } else if (change.type === 'remove') {
          removeStep(change.id);
        }
      }
    },
    [moveNode, commitLayout, removeStep],
  );

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

  const onNodeClick = useCallback(
    (_: React.MouseEvent, node: Node) => {
      setSelectedEdgeId(null);
      select(node.id);
    },
    [select],
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
    setSelectedEdgeId(null);
  }, [select]);

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
      // Tools and connectors have nowhere to go except onto an agent, so say so
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

      const mod = event.ctrlKey || event.metaKey;
      if (mod && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        if (event.shiftKey) redo();
        else undo();
      } else if (mod && event.key.toLowerCase() === 'y') {
        event.preventDefault();
        redo();
      } else if (event.key === 'Delete' || event.key === 'Backspace') {
        // ReactFlow's own delete handling is disabled (deleteKeyCode={null}),
        // so both step and connection deletion run through here.
        if (selectedEdgeId) {
          event.preventDefault();
          removeEdge(selectedEdgeId);
        } else if (selectedStepId) {
          event.preventDefault();
          removeStep(selectedStepId);
        }
      } else if (event.key === 'Escape') {
        select(null);
        setSelectedEdgeId(null);
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [undo, redo, removeStep, select, selectedStepId, selectedEdgeId, removeEdge]);

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
        onConnect={onConnect}
        onEdgesDelete={onEdgesDelete}
        onNodeClick={onNodeClick}
        onEdgeClick={onEdgeClick}
        onPaneClick={onPaneClick}
        onInit={setInstance}
        connectionLineType={ConnectionLineType.SmoothStep}
        connectionLineStyle={{ stroke: '#818cf8', strokeWidth: 2 }}
        defaultViewport={{ x: 0, y: 0, zoom: 0.85 }}
        minZoom={0.2}
        maxZoom={1.6}
        deleteKeyCode={null}
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
        <div className="w-px h-5 bg-[var(--color-border-subtle)] mx-0.5" />
        <ToolbarButton
          onClick={() => instance?.fitView({ padding: 0.2, duration: 500 })}
          title="Fit to view"
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
          onClick={() => selectedStepId && removeStep(selectedStepId)}
          disabled={!selectedStepId}
          title="Delete selected step (Del)"
        >
          <Trash2 size={14} />
        </ToolbarButton>
      </div>

      {/* Empty state */}
      {isEmpty && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="text-center max-w-sm px-6">
            <div className="w-14 h-14 rounded-2xl border-2 border-dashed border-[var(--color-border-subtle)] flex items-center justify-center mx-auto mb-4">
              <LayoutGrid size={22} className="text-[var(--color-text-muted)]" />
            </div>
            <p className="text-sm font-semibold text-white mb-1.5">Drag an agent onto the canvas</p>
            <p className="text-xs text-[var(--color-text-muted)] leading-relaxed">
              Agents are the steps. The first one you drop becomes the entry point. Connect steps by
              dragging from the dot at the bottom of a card, and drop tools <em>onto</em> an agent to
              give it new capabilities.
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
