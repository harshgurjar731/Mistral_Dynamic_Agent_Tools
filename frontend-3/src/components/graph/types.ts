import type { Edge, Node } from "@xyflow/react";
import type { ValidationIssue, WorkflowStep } from "@/types";

export interface StepNodeData extends Record<string, unknown> {
  step: WorkflowStep;
  isEntry: boolean;
  errorCount: number;
  warningCount: number;
  onSelect?: (id: string) => void;
  /** How a proposed revision changes this step — drawn as a ring and a badge. */
  diff?: StepDiffKind | undefined;
  /** Picked as the subject of the next revision instruction. */
  focused?: boolean | undefined;
}

export type StepDiffKind = "added" | "modified" | "removed";

export type StepFlowNode = Node<StepNodeData, "step">;
export type StepFlowEdge = Edge;

export type LayoutDirection = "LR" | "TB";
