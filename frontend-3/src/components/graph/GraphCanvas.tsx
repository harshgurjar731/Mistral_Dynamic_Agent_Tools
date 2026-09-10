import { useCallback, type ReactNode } from "react";
import {
  Background,
  BackgroundVariant,
  Controls,
  ReactFlow,
  ReactFlowProvider,
  type NodeMouseHandler,
  type OnConnect,
  type OnNodesChange,
  type OnEdgesChange,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { stepNodeTypes } from "./nodes";
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
  overlay,
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
  overlay?: ReactNode;
  className?: string;
}) {
  const handlePaneClick = useCallback(() => onPaneClick?.(), [onPaneClick]);

  return (
    <div className={className ?? "relative h-full w-full"}>
      <ReactFlowProvider>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={stepNodeTypes}
          {...(onNodesChange ? { onNodesChange } : {})}
          {...(onEdgesChange ? { onEdgesChange } : {})}
          {...(onConnect ? { onConnect } : {})}
          {...(onNodeClick ? { onNodeClick } : {})}
          onPaneClick={handlePaneClick}
          nodesDraggable={!readOnly}
          nodesConnectable={!readOnly}
          elementsSelectable
          fitView
          proOptions={{ hideAttribution: true }}
        >
          <Background variant={BackgroundVariant.Dots} gap={20} size={1} />
          <Controls showInteractive={false} />
        </ReactFlow>
      </ReactFlowProvider>
      {overlay ? <div className="pointer-events-none absolute inset-x-3 top-3 z-10 flex flex-wrap items-start justify-between gap-2">{overlay}</div> : null}
    </div>
  );
}
