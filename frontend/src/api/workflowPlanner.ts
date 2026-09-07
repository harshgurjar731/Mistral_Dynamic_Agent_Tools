import { createSSEStream, type SSEEvent } from './sse';

export interface PlannerEvent extends SSEEvent {
  type:
    | 'status'
    | 'requirements'
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
