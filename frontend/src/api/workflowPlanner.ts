import { createSSEStream, type SSEEvent } from './sse';

export interface PlannerEvent extends SSEEvent {
  type:
    | 'status'
    | 'requirements'
    | 'tool_synthesised'
    | 'agent_created'
    | 'workflow_ready'
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
