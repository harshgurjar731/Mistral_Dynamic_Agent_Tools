import { useCallback, useEffect, useRef, type DragEvent, type ReactNode } from "react";
import {
  Background,
  BackgroundVariant,
  ControlButton,
  Controls,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type NodeMouseHandler,
  type OnConnect,
  type OnNodesChange,
  type OnEdgesChange,
  type ReactFlowInstance,
  type XYPosition,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { Maximize2, Minimize2 } from "lucide-react";
import { useFullscreen } from "@/lib/useFullscreen";
import { cn } from "@/lib/utils";
import { stepNodeTypes } from "./nodes";
import { StepCatalogContext } from "./stepSummary";
import type { BuilderCatalog } from "@/types";
import type { StepFlowEdge, StepFlowNode } from "./types";

export function GraphCanvas({
  nodes,
  edges,
  onNodesChange,
  onEdgesChange,
  onConnect,
  onNodeClick,
  onPaneClick,
  readOnly = false,
  showMinimap = false,
  overlay,
  catalog,
  onDropItem,
  dropMimeType = "application/x-workflow-item",
  children,
  className,
}: {
  nodes: StepFlowNode[];
  edges: StepFlowEdge[];
  onNodesChange?: OnNodesChange<StepFlowNode>;
  onEdgesChange?: OnEdgesChange<StepFlowEdge>;
  onConnect?: OnConnect;
  onNodeClick?: NodeMouseHandler<StepFlowNode>;
  onPaneClick?: () => void;
  readOnly?: boolean;
  showMinimap?: boolean;
  overlay?: ReactNode;
  /** Lets cards show each step's configuration (agent model, tools, activity params). */
  catalog?: BuilderCatalog | undefined;
  /** Called when a palette item carrying `dropMimeType` is dropped; `position` is in flow coordinates. */
  onDropItem?: (payload: string, position: XYPosition) => void;
  dropMimeType?: string;
  /** Floating layer drawn over the whole canvas (kept inside it in full screen). */
  children?: ReactNode;
  className?: string;
}) {
  const handlePaneClick = useCallback(() => onPaneClick?.(), [onPaneClick]);
  const frameRef = useRef<HTMLDivElement>(null);
  const flowRef = useRef<ReactFlowInstance<StepFlowNode, StepFlowEdge> | null>(null);
  const { isFullscreen, isFallback, toggle } = useFullscreen(frameRef);

  const handleDragOver = useCallback(
    (e: DragEvent) => {
      if (!onDropItem || !e.dataTransfer.types.includes(dropMimeType)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
    },
    [onDropItem, dropMimeType],
  );

  const handleDrop = useCallback(
    (e: DragEvent) => {
      const payload = e.dataTransfer.getData(dropMimeType);
      if (!onDropItem || !payload || !flowRef.current) return;
      e.preventDefault();
      onDropItem(payload, flowRef.current.screenToFlowPosition({ x: e.clientX, y: e.clientY }));
    },
    [onDropItem, dropMimeType],
  );

  return (
    <div
      ref={frameRef}
      className={cn(
        className ?? "relative h-full w-full",
        isFullscreen && "bg-background",
        isFallback && "!fixed !inset-0 !z-[70] !h-screen !w-screen",
      )}
    >
      <StepCatalogContext.Provider value={catalog}>
        <ReactFlowProvider>
          <ReactFlow
            colorMode="dark"
            nodes={nodes}
            edges={edges}
            nodeTypes={stepNodeTypes}
            {...(onNodesChange ? { onNodesChange } : {})}
            {...(onEdgesChange ? { onEdgesChange } : {})}
            {...(onConnect ? { onConnect } : {})}
            {...(onNodeClick ? { onNodeClick } : {})}
            onPaneClick={handlePaneClick}
            onInit={(instance) => {
              flowRef.current = instance;
            }}
            onDragOver={handleDragOver}
            onDrop={handleDrop}
            nodesDraggable={!readOnly}
            nodesConnectable={!readOnly}
            elementsSelectable
            fitView
            fitViewOptions={{ maxZoom: 1, padding: 0.25 }}
            proOptions={{ hideAttribution: true }}
          >
            <Background
              variant={BackgroundVariant.Dots}
              gap={22}
              size={1}
              color="var(--border-strong)"
            />
            <Controls
              showInteractive={false}
              className="!overflow-hidden !rounded-lg !border !border-border/60 !shadow-none"
            >
              <ControlButton
                onClick={() => void toggle()}
                aria-label={isFullscreen ? "Exit full screen" : "Full screen"}
                title={isFullscreen ? "Exit full screen (Esc)" : "Full screen"}
              >
                {isFullscreen ? <Minimize2 /> : <Maximize2 />}
              </ControlButton>
            </Controls>
            <RefitOnResize trigger={isFullscreen} />
            {showMinimap && (
              <MiniMap
                pannable
                zoomable
                nodeStrokeColor="var(--primary)"
                nodeColor="var(--muted)"
                bgColor="transparent"
                maskColor="color-mix(in oklch, var(--background) 72%, transparent)"
                className="!right-3 !bottom-3 !rounded-lg !border !border-border/60 !bg-background-elevated/90"
              />
            )}
          </ReactFlow>
        </ReactFlowProvider>
      </StepCatalogContext.Provider>
      {overlay ? (
        <div className="pointer-events-none absolute inset-x-3 top-3 z-10 flex flex-wrap items-start justify-between gap-2">
          {overlay}
        </div>
      ) : null}
      {children ? (
        <div className="pointer-events-none absolute inset-0 z-20">{children}</div>
      ) : null}
    </div>
  );
}

/** Re-frames the drawing when the canvas changes size (entering full screen). */
function RefitOnResize({ trigger }: { trigger: boolean }) {
  const rf = useReactFlow();
  useEffect(() => {
    const t = window.setTimeout(
      () => void rf.fitView({ duration: 300, maxZoom: 1, padding: 0.25 }),
      80,
    );
    return () => window.clearTimeout(t);
  }, [trigger, rf]);
  return null;
}
