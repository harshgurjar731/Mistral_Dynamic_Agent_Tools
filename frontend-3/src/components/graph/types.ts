import type { Edge, Node } from "@xyflow/react";
import type { ValidationIssue, WorkflowStep } from "@/types";

export interface StepNodeData extends Record<string, unknown> {
  step: WorkflowStep;
  isEntry: boolean;
  errorCount: number;
  warningCount: number;
  onSelect?: (id: string) => void;
}

export type StepFlowNode = Node<StepNodeData, "step">;
export type StepFlowEdge = Edge;

export type LayoutDirection = "LR" | "TB";
