import { api } from './client';

/* ── Definition types (mirror backend workflow_engine/models.py) ────────── */

export type StepType = 'agent' | 'tool' | 'connector' | 'condition' | 'transform';
export type WorkflowSourceKind = 'planner' | 'builder';

export interface NodeLayout {
  x: number;
  y: number;
}

export interface WorkflowStep {
  id: string;
  type: StepType;
  tier?: string | null;
  config: Record<string, unknown>;
  next_steps: string[];
  description?: string | null;
  parallel_group?: string | null;
}

export interface InputField {
  name: string;
  type: string;
  description?: string;
  required?: boolean;
}

export interface WorkflowDefinition {
  id?: string | null;
  name: string;
  description?: string | null;
  steps: WorkflowStep[];
  entry_step: string;
  input_schema: InputField[];
  variables: Record<string, unknown>;
  is_deployed: boolean;
  archived: boolean;
  source: WorkflowSourceKind;
  ui_layout: Record<string, NodeLayout>;
  published_hash?: string | null;
  /** Computed server-side: definition has diverged from what is live on Mistral. */
  has_unpublished_changes?: boolean;
}

/* ── Validation ─────────────────────────────────────────────────────────── */

export type IssueSeverity = 'error' | 'warning';

export interface ValidationIssue {
  severity: IssueSeverity;
  code: string;
  message: string;
  step_id?: string | null;
  field?: string | null;
}

export interface ValidationResult {
  valid: boolean;
  issues: ValidationIssue[];
  error_count: number;
  warning_count: number;
}

/* ── Script ─────────────────────────────────────────────────────────────── */

export interface ScriptResult {
  workflow_name: string;
  code: string;
  line_count: number;
  /** True when the file the worker has loaded differs from this output. */
  stale: boolean;
}

/* ── Palette catalog ────────────────────────────────────────────────────── */

export interface CatalogAgent {
  id: string;
  name: string;
  model: string;
  description?: string | null;
  tier?: string | null;
  tools: string[];
  /** Connector ids already attached to this agent. */
  connectors: string[];
}

export interface CatalogTool {
  name: string;
  description?: string | null;
  parameters: Record<string, { type?: string; description?: string }>;
  required: string[];
  status: string;
  source: 'builtin' | 'native' | 'dynamic';
}

/**
 * A Mistral Connector available to the builder. Its tools are *not* included —
 * the catalog would need one extra API call per connector to expand them, so
 * the inspector fetches them for the selected connector instead.
 */
export interface CatalogConnector {
  id: string;
  name: string;
  description?: string | null;
  icon_url?: string | null;
  is_directory: boolean;
  is_authenticated: boolean;
  active: boolean;
  tools: CatalogTool[];
}

export interface BuilderCatalog {
  agents: CatalogAgent[];
  tools: CatalogTool[];
  connectors: CatalogConnector[];
  models: string[];
  tiers: string[];
}

/* ── Client ─────────────────────────────────────────────────────────────── */

export const workflowBuilderApi = {
  /** Palette contents — agents, tools, models, tiers — in one round trip. */
  catalog: () => api.get<BuilderCatalog>('/api/workflows/builder/catalog'),

  /** Structural check. Always resolves 200; issues are the payload. */
  validate: (definition: WorkflowDefinition) =>
    api.post<ValidationResult>('/api/workflows/validate', { definition }),

  /** Create a new draft. 409 if the name is taken, 422 if invalid. */
  create: (definition: WorkflowDefinition) =>
    api.post('/api/workflows', { definition }),

  /** Draft-save an existing workflow. Does not publish. */
  update: (name: string, definition: WorkflowDefinition) =>
    api.put(`/api/workflows/${encodeURIComponent(name)}`, { definition }),

  /** Compile + register on Mistral, then stamp the published hash. */
  publish: (name: string) =>
    api.post(`/api/workflows/${encodeURIComponent(name)}/publish`, {}),

  /** Generated Python for a saved workflow, with a staleness flag. */
  script: (name: string) =>
    api.get<ScriptResult>(`/api/workflows/${encodeURIComponent(name)}/script`),

  /** Generated Python for a definition that has not been saved yet. */
  previewScript: (definition: WorkflowDefinition) =>
    api.post<ScriptResult>('/api/workflows/script/preview', { definition }),
};
