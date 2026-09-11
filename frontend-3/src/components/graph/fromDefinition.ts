import type { MarkerType } from "@xyflow/react";
import type { ValidationIssue, WorkflowDefinition } from "@/types";
import { layoutGraph } from "./layout";
import type { StepFlowEdge, StepFlowNode } from "./types";

/** Builds React Flow nodes/edges from a WorkflowDefinition, applying `ui_layout` when present. */
export function stepsToGraph(
  definition: Pick<WorkflowDefinition, "steps" | "entry_step" | "ui_layout">,
  issues: ValidationIssue[] = [],
  direction: "LR" | "TB" = "LR",
): { nodes: StepFlowNode[]; edges: StepFlowEdge[] } {
  const layout = definition.ui_layout ?? {};
  const hasLayout = Object.keys(layout).length > 0;

  let nodes: StepFlowNode[] = definition.steps.map((step, i) => {
    const stepIssues = issues.filter((iss) => iss.step_id === step.id);
    return {
      id: step.id,
      type: "step",
      position: layout[step.id] ?? { x: (i % 4) * 260, y: Math.floor(i / 4) * 140 },
      data: {
        step,
        isEntry: step.id === definition.entry_step,
        errorCount: stepIssues.filter((x) => x.severity === "error").length,
        warningCount: stepIssues.filter((x) => x.severity === "warning").length,
      },
    };
  });

  const edges: StepFlowEdge[] = definition.steps.flatMap((step) =>
    step.next_steps.map((target) => ({
      id: `${step.id}->${target}`,
      source: step.id,
      target,
      animated: false,
      type: "smoothstep",
      markerEnd: { type: "arrowclosed" as MarkerType },
      style: { stroke: "var(--color-border)" },
    })),
  );

  if (!hasLayout) nodes = layoutGraph(nodes, edges, direction);

  return { nodes, edges };
}
