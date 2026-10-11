import { stepsToGraph } from "@/components/graph/fromDefinition";
import type { StepDiffKind, StepFlowEdge, StepFlowNode } from "@/components/graph/types";
import type { ValidationIssue, WorkflowDefinition, WorkflowRevision, WorkflowStep } from "@/types";

const ADDED_EDGE = { stroke: "var(--emerald)", strokeWidth: 2 };
const REMOVED_EDGE = { stroke: "var(--red)", strokeDasharray: "6 4", opacity: 0.7 };

/**
 * The graph the refine canvas draws: the workflow as it is, or — while a
 * proposal is previewed — as it would be, with what the proposal adds,
 * changes and removes marked. Removed steps stay on the canvas as ghosts so
 * the user sees where they were, not just that they are gone.
 */
export function revisionGraph({
  current,
  preview,
  issues,
  direction,
  focus,
}: {
  current: WorkflowDefinition;
  preview: WorkflowRevision | null;
  issues: ValidationIssue[];
  direction: "LR" | "TB";
  focus: ReadonlySet<string>;
}): { nodes: StepFlowNode[]; edges: StepFlowEdge[] } {
  const proposed = preview?.proposed_definition;
  const diff = preview?.diff;

  if (!proposed || !diff) {
    const graph = stepsToGraph({ ...current, ui_layout: {} }, issues, direction);
    return {
      edges: graph.edges,
      nodes: graph.nodes.map((n) => ({ ...n, data: { ...n.data, focused: focus.has(n.id) } })),
    };
  }

  const removed = new Set(diff.steps_removed);
  const modified = new Set(diff.steps_modified.map((m) => m.step_id));
  const added = new Set(diff.steps_added);
  const removedEdges = new Set(diff.edges_removed.map(([s, t]) => `${s}->${t}`));
  const addedEdges = new Set(diff.edges_added.map(([s, t]) => `${s}->${t}`));

  // Draw the proposed steps plus ghosts of the removed ones, and every link
  // the proposal cuts, so the before and after read as one picture.
  const ghostSteps: WorkflowStep[] = current.steps
    .filter((s) => removed.has(s.id))
    .map((s) => ({ ...s, parallel_group: null }));
  const steps: WorkflowStep[] = [...proposed.steps, ...ghostSteps].map((s) => {
    const cut = diff.edges_removed.filter(([from]) => from === s.id).map(([, to]) => to);
    return cut.length ? { ...s, next_steps: Array.from(new Set([...s.next_steps, ...cut])) } : s;
  });

  const graph = stepsToGraph(
    { steps, entry_step: proposed.entry_step, ui_layout: {} },
    preview?.validation?.issues ?? [],
    direction,
  );

  const kindOf = (id: string): StepDiffKind | undefined =>
    removed.has(id)
      ? "removed"
      : added.has(id)
        ? "added"
        : modified.has(id)
          ? "modified"
          : undefined;

  return {
    nodes: graph.nodes.map((n) => ({
      ...n,
      data: { ...n.data, diff: kindOf(n.id), focused: focus.has(n.id) },
    })),
    edges: graph.edges.map((e) =>
      removedEdges.has(e.id)
        ? { ...e, style: REMOVED_EDGE }
        : addedEdges.has(e.id)
          ? { ...e, style: ADDED_EDGE, animated: true }
          : e,
    ),
  };
}
