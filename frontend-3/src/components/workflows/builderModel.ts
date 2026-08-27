import type { StepType, WorkflowDefinition } from "@/types";

/** Palette order — also the order the inspector's type list follows. */
export const STEP_TYPES: StepType[] = ["agent", "tool", "connector", "condition", "transform"];

/** Mirrors the backend's `_NAME_RE`, so the UI refuses names the API would. */
export const WORKFLOW_NAME_RE = /^[a-z][a-z0-9_]{2,63}$/;

/** Matches the engine's own safety cap in `execute_workflow()`. */
export const MAX_STEPS = 50;

export function emptyDefinition(): WorkflowDefinition {
  return {
    name: "",
    description: "",
    steps: [],
    entry_step: "",
    input_schema: [],
    variables: {},
    is_deployed: false,
    archived: false,
    source: "builder",
    ui_layout: {},
  };
}
