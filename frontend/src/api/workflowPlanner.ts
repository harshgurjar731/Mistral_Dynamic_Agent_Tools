import { createSSEStream, type SSEEvent } from './sse';

export interface PlannerEvent extends SSEEvent {
  type:
    | 'status'
    // One event per planning decision. The planner is a chain of
    // single-decision layers, and each announces its own verdict.
    | 'capabilities'
    | 'execution_modes'
    | 'reuse_plan'
    | 'activity_plan'
    | 'library_provisioned'
    | 'agent_designed'
    | 'topology'
    | 'data_flow'
    | 'workflow_guardrails'
    | 'validation'
    | 'tool_exists'
    | 'tool_new'
    | 'activity_new'
    | 'agent_exists'
    | 'agent_new'
    | 'workflow_ready'
    | 'compiled'
    | 'registered'
    | 'fatal_error'
    | 'error'
    | 'done';
}

export const workflowPlannerApi = {
  plan: (
    goal: string,
    onEvent: (e: PlannerEvent) => void,
    onDone?: () => void,
    signal?: AbortSignal,
  ) =>
    createSSEStream(
      '/api/workflows/plan',
      { goal },
      onEvent as (e: SSEEvent) => void,
      onDone,
      signal,
    ),
};
