/**
 * Process knowledge — the Processes page, the Settings template section and
 * the orchestration pages' process controls all go through here.
 */
import { api, del, get, patch, post, unwrap } from "./client";

export type ProcessLevel = "industry" | "domain" | "subdomain" | "process" | "subprocess";
export type DocumentStatus = "valid" | "invalid" | "stale";

export interface ValidationIssue {
  severity: "error" | "warning";
  code: string;
  path: string;
  message: string;
  expected?: string | null;
  found?: string | null;
  fix?: string;
}

export interface DocumentStats {
  stages?: number;
  controls?: number;
  mandatory_controls?: number;
  risks?: number;
  regulations?: number;
  exceptions?: number;
  actors?: number;
  kpis?: number;
}

export interface ValidationReport {
  valid: boolean;
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
  issues: ValidationIssue[];
  summary: string;
  template: TemplateRef;
  stats: DocumentStats;
  /** Unfiled uploads: where it was classified, which chose the template. */
  classification?: Classification;
}

/** Which template checked a document, and which node of the classification set it. */
export interface TemplateRef {
  id: number | null;
  name: string;
  version: number;
  kind?: "schema" | "inferred";
  /** The node that set it; null: the global default. */
  concept_id?: string | null;
  scope_path?: string;
  /** True when set above the node asked about. */
  inherited?: boolean;
  applies_to?: string | null;
  builtin?: boolean;
}

export interface Classification {
  concept_id: string | null;
  label: string | null;
  level: string | null;
  path: string;
  method: "chosen" | "document" | "request" | "none";
  detail: string;
}

export interface ProcessDocument {
  id: number;
  concept_id: string | null;
  version: number;
  is_active: boolean;
  title: string;
  status: DocumentStatus;
  source: "upload" | "ai_fixed" | "ai_drafted" | "orchestration";
  filename: string | null;
  template_id: number | null;
  template_version: number | null;
  summary: string | null;
  error_count: number;
  warning_count: number;
  stats: DocumentStats;
  created_at: string | null;
  updated_at: string | null;
  content?: Record<string, unknown> | null;
  raw?: string;
  report?: ValidationReport;
  path?: string;
}

export interface SaveResult {
  document: ProcessDocument;
  report: ValidationReport;
}

export interface DocCounts {
  total: number;
  valid: number;
  invalid: number;
  stale: number;
  active_id: number | null;
  active_version: number | null;
  active_title?: string | null;
}

export interface UsageCounts {
  agents: number;
  workflows: number;
  last_used: string | null;
}

export interface TreeConcept {
  id: string;
  scheme_id: string;
  parent_id: string | null;
  label: string;
  definition: string;
  synonyms: string[];
  level?: number;
  level_name?: string;
}

export interface TreeProcess extends TreeConcept {
  domain_id: string | null;
  documents: DocCounts;
  usage: UsageCounts;
}

export interface ProcessTree {
  domains: TreeConcept[];
  processes: TreeProcess[];
}

export interface IndustryCard extends TreeConcept {
  counts: {
    domains: number;
    subdomains: number;
    processes: number;
    subprocesses: number;
    documents: number;
    valid_documents: number;
    needs_attention: number;
    agents: number;
    workflows: number;
  };
  last_used: string | null;
}

export interface UsageRow {
  document_id: number;
  document_version: number | null;
  concept_id: string | null;
  subject_type: "agent" | "workflow";
  subject_id: string;
  subject_name: string | null;
  layer: string;
  element: string;
  how: string | null;
  created_at: string | null;
}

export interface ProcessNode extends TreeConcept {
  children: TreeConcept[];
  path: string;
  /** The template documents here are checked against. */
  template?: TemplateRef;
  domain_id?: string | null;
  documents?: ProcessDocument[];
  usage?: UsageRow[];
  processes?: string[];
  usage_counts: {
    children: string[];
    annotations: number;
    processes: string[];
    documents: number;
  };
}

export interface ProcessTemplate {
  id: number | null;
  name: string;
  version: number;
  description: string;
  kind: "schema" | "inferred";
  /** Active at its scope. */
  is_default: boolean;
  builtin: boolean;
  /** The node it is set on; null: global. */
  concept_id: string | null;
  scope_path: string;
  created_at?: string | null;
  schema?: Record<string, unknown>;
  example?: unknown;
}

/** The template that applies at a node, with the versions set on it directly. */
export interface EffectiveTemplate extends ProcessTemplate {
  inherited: boolean;
  applies_to: string | null;
  applies_to_path: string;
  own_versions: ProcessTemplate[];
}

export interface TemplateScope {
  concept_id: string | null;
  scope_path: string;
  template: ProcessTemplate;
  documents: number;
}

export interface TemplatePreview {
  kind: "schema" | "inferred";
  schema: Record<string, unknown>;
  example: unknown;
  problems: string[];
  suggested_name: string;
}

export interface FixResult {
  document: Record<string, unknown> | null;
  report: ValidationReport;
  valid: boolean;
  changes: Array<{ path?: string; change?: string }>;
  placeholders: string[];
  notes: string;
  attempts: number;
  before?: ValidationReport;
}

export interface ProcessCandidate {
  concept_id: string;
  label: string;
  level: string;
  score: number;
  why: string[];
  has_document: boolean;
  document_id: number | null;
  document_version: number | null;
  path: string;
}

export interface ResolvePreview {
  goal: string;
  scope: { scoped: boolean; domains: string[]; label: string };
  mode: "uploaded" | "inventory" | "none";
  message: string;
  candidates: ProcessCandidate[];
  documents: Array<{
    id: number;
    title: string;
    version: number;
    concept_id: string | null;
    path: string;
    label: string;
    stats: DocumentStats;
  }>;
  threshold: number;
}

export interface ProcessConfig {
  default_enabled: boolean;
  max_kb: number;
  min_score: number;
  template: TemplateRef;
  levels: ProcessLevel[];
}

/** What the orchestration pages send with a run. */
export interface ProcessKnowledgeRequest {
  enabled: boolean;
  document_ids: number[];
}

/** One element a layer used — attached to its timeline row. */
export interface ProcessUse {
  ref: string;
  type: string;
  label: string;
  how: string;
  target?: string | null;
  document_id: number;
  document_version?: number | null;
  concept_id?: string | null;
}

export interface UnfiledOptions {
  goal?: string | undefined;
  classifyAs?: string | null | undefined;
}

function unfiledFields(opts: UnfiledOptions): Record<string, string> {
  const out: Record<string, string> = {};
  if (opts.goal?.trim()) out["goal"] = opts.goal.trim();
  if (opts.classifyAs) out["classify_as"] = opts.classifyAs;
  return out;
}

async function upload<T>(
  url: string,
  file: File,
  fields: Record<string, string> = {},
  method: "post" | "put" = "post",
): Promise<T> {
  const form = new FormData();
  form.append("file", file);
  for (const [k, v] of Object.entries(fields)) form.append(k, v);
  const res = await api.request<T>({
    url,
    method,
    data: form,
    headers: { "Content-Type": "multipart/form-data" },
  });
  return unwrap(res.data);
}

/** Download a server-generated file through the API client (keeps auth headers). */
export async function downloadFrom(url: string, fallbackName: string): Promise<void> {
  const res = await api.get<Blob>(url, { responseType: "blob" });
  const disposition = String(res.headers["content-disposition"] ?? "");
  const name = /filename="?([^"]+)"?/.exec(disposition)?.[1] ?? fallbackName;
  const href = URL.createObjectURL(res.data);
  const a = document.createElement("a");
  a.href = href;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(href);
}

/** Save JSON produced in the browser (an AI fix, a report) as a file. */
export function downloadJson(data: unknown, name: string): void {
  const href = URL.createObjectURL(
    new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }),
  );
  const a = document.createElement("a");
  a.href = href;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(href);
}

const B = "/api/processes";

export const processesApi = {
  config: () => get<ProcessConfig>(`${B}/config`),
  industries: () =>
    get<{ industries: IndustryCard[] }>(`${B}/industries`).then((r) => r.industries),
  tree: () => get<ProcessTree>(`${B}/tree`),
  node: (id: string) => get<ProcessNode>(`${B}/concepts/${encodeURIComponent(id)}`),
  createNode: (body: {
    level: ProcessLevel;
    label: string;
    parent_id?: string | null;
    definition?: string;
    synonyms?: string[];
  }) => post<TreeConcept>(`${B}/concepts`, body),
  updateNode: (
    id: string,
    body: { label?: string; definition?: string; synonyms?: string[]; domain_id?: string },
  ) => patch<TreeConcept>(`${B}/concepts/${encodeURIComponent(id)}`, body),
  deleteNode: (id: string, cascade = false) =>
    del<unknown>(`${B}/concepts/${encodeURIComponent(id)}`, { cascade }),

  uploadTo: (conceptId: string, file: File, replaceId?: number) =>
    upload<SaveResult>(
      `${B}/concepts/${encodeURIComponent(conceptId)}/documents`,
      file,
      replaceId ? { replace_id: String(replaceId) } : {},
    ),
  saveJsonTo: (
    conceptId: string,
    content: unknown,
    opts: { filename?: string; source?: string; replace_id?: number | null } = {},
  ) =>
    post<SaveResult>(`${B}/concepts/${encodeURIComponent(conceptId)}/documents/json`, {
      content,
      ...opts,
    }),
  /**
   * An orchestration-page upload. Checked against the template of where it is
   * classified: ``classifyAs`` when chosen, else what the document names, else
   * the request ``goal``.
   */
  uploadUnfiled: (file: File, opts: UnfiledOptions = {}) =>
    upload<SaveResult>(`${B}/documents`, file, unfiledFields(opts)),
  saveJsonUnfiled: (
    content: unknown,
    opts: {
      filename?: string;
      source?: string;
      replace_id?: number | null;
      goal?: string;
      classify_as?: string | null;
    } = {},
  ) => post<SaveResult>(`${B}/documents/json`, { content, ...opts }),
  classify: (file: File, opts: UnfiledOptions = {}) =>
    upload<{ classification: Classification; template: TemplateRef }>(
      `${B}/classify`,
      file,
      unfiledFields(opts),
    ),
  validate: (file: File, conceptId?: string) =>
    upload<ValidationReport>(`${B}/validate`, file, conceptId ? { concept_id: conceptId } : {}),
  documents: (params: { concept_id?: string; unfiled?: boolean } = {}) =>
    get<{ documents: ProcessDocument[] }>(`${B}/documents`, params).then((r) => r.documents),
  document: (id: number) => get<ProcessDocument>(`${B}/documents/${id}`),
  reupload: (id: number, file: File) => upload<SaveResult>(`${B}/documents/${id}`, file, {}, "put"),
  activate: (id: number) => post<ProcessDocument>(`${B}/documents/${id}/activate`),
  fileUnder: (id: number, conceptId: string) =>
    post<SaveResult>(`${B}/documents/${id}/file`, { concept_id: conceptId }),
  deleteDocument: (id: number, force = false) => del<unknown>(`${B}/documents/${id}`, { force }),
  downloadDocument: (id: number) =>
    downloadFrom(`${B}/documents/${id}/download`, `process_${id}.json`),

  fix: (body: {
    document_id?: number;
    raw?: unknown;
    concept_id?: string | null;
    goal?: string;
    classify_as?: string | null;
  }) => post<FixResult>(`${B}/fix`, body),
  draft: (body: { text: string; concept_id?: string | null; classify_as?: string | null }) =>
    post<FixResult>(`${B}/draft`, body),

  /** Versions set at one scope (none: the global scope), or at every scope. */
  templates: (params: { concept_id?: string; all?: boolean } = {}) =>
    get<{ templates: ProcessTemplate[] }>(`${B}/templates`, params).then((r) => r.templates),
  templateScopes: () =>
    get<{ scopes: TemplateScope[] }>(`${B}/templates/scopes`).then((r) => r.scopes),
  /** The template that applies at a node ("global" for the default). */
  templateFor: (conceptId: string | null) =>
    get<EffectiveTemplate>(`${B}/templates/for/${encodeURIComponent(conceptId ?? "global")}`),
  downloadTemplateFor: (conceptId: string | null, kind: "blank" | "example" | "schema" = "blank") =>
    downloadFrom(
      `${B}/templates/for/${encodeURIComponent(conceptId ?? "global")}/download?kind=${kind}`,
      `process_template_${kind}.json`,
    ),
  clearTemplateScope: (conceptId: string) =>
    post<{ cleared: number; revalidated: Record<string, number>; now: TemplateRef }>(
      `${B}/templates/scope/${encodeURIComponent(conceptId)}/clear`,
    ),
  template: (ref: number | "default") => get<ProcessTemplate>(`${B}/templates/${ref}`),
  downloadTemplate: (
    ref: number | "default" = "default",
    kind: "blank" | "example" | "schema" = "blank",
  ) => downloadFrom(`${B}/templates/${ref}/download?kind=${kind}`, `process_template_${kind}.json`),
  previewTemplate: (file: File) => upload<TemplatePreview>(`${B}/templates/preview`, file),
  createTemplate: (body: {
    name: string;
    schema: Record<string, unknown>;
    example?: unknown;
    kind: "schema" | "inferred";
    description?: string;
    make_default?: boolean;
    /** The node it applies to; omitted: the global scope. */
    concept_id?: string | null;
  }) =>
    post<ProcessTemplate & { revalidated: Record<string, number> | null }>(`${B}/templates`, body),
  makeDefault: (id: number) =>
    post<ProcessTemplate & { revalidated: Record<string, number> }>(`${B}/templates/${id}/default`),
  deleteTemplate: (id: number) => del<unknown>(`${B}/templates/${id}`),

  usage: (params: {
    document_id?: number;
    concept_id?: string;
    subject_type?: string;
    subject_id?: string;
  }) => get<{ usage: UsageRow[] }>(`${B}/usage`, params).then((r) => r.usage),
  resolve: (goal: string) => get<ResolvePreview>(`${B}/resolve`, { goal }),
};
