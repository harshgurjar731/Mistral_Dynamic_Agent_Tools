import { get, post } from "./client";
import type {
  ApplyRevisionResult,
  ProposeRevisionRequest,
  RestoreVersionResult,
  RevisionSuggestion,
  WorkflowDefinition,
  WorkflowRevision,
  WorkflowVersion,
  WorkflowVersionList,
} from "@/types";

/**
 * Workflow revisions — change a saved workflow by saying what should change.
 *
 * Proposing never touches the workflow; applying saves it and records a
 * version, so every change can be undone. Publishing stays a separate step
 * (`workflowsApi.publish`).
 */
const base = (name: string) => `/api/workflows/${encodeURIComponent(name)}`;

export const revisionsApi = {
  /** The conversation so far, oldest first. */
  list: (name: string) =>
    get<{ revisions: WorkflowRevision[] }>(`${base(name)}/revisions`).then((r) => r.revisions),
  propose: (name: string, body: ProposeRevisionRequest) =>
    post<WorkflowRevision>(`${base(name)}/revisions`, body),
  apply: (name: string, revisionId: string, allowErrors = false) =>
    post<ApplyRevisionResult>(`${base(name)}/revisions/${revisionId}/apply`, {
      allow_errors: allowErrors,
    }),
  discard: (name: string, revisionId: string) =>
    post<WorkflowRevision>(`${base(name)}/revisions/${revisionId}/discard`),
  suggestions: (name: string) =>
    get<{ valid: boolean; suggestions: RevisionSuggestion[] }>(
      `${base(name)}/revision-suggestions`,
    ),
  versions: (name: string) => get<WorkflowVersionList>(`${base(name)}/versions`),
  version: (name: string, versionNo: number) =>
    get<WorkflowVersion & { definition: WorkflowDefinition }>(
      `${base(name)}/versions/${versionNo}`,
    ),
  restore: (name: string, versionNo: number) =>
    post<RestoreVersionResult>(`${base(name)}/versions/${versionNo}/restore`),
  undo: (name: string) => post<RestoreVersionResult>(`${base(name)}/undo`),
};
