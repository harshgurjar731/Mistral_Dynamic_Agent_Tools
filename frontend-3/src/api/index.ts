import { del, get, patch, post, put } from "./client";
import type {
  BuilderCatalog,
  Connector,
  ConnectorScope,
  ConnectorTool,
  ExecutionDetail,
  ExecutionListResponse,
  ExecutionLogsResponse,
  ExecutionStep,
  ExtractionDraft,
  GraphSnapshot,
  GraphStatus,
  HealthResponse,
  KnowledgeEntry,
  Library,
  LibraryCard,
  LibraryDocument,
  OntologyGraph,
  OntologyOverview,
  AnnotationMap,
  AnnotationRow,
  ClassificationResult,
  Concept,
  ConceptScheme,
  ConceptUsage,
  QueryPlan,
  RagDocument,
  ScriptResult,
  SearchResult,
  TierOption,
  TimelineEvent,
  TimelineTrace,
  Tool,
  TraceSummary,
  UploadResult,
  ValidationResult,
  WorkflowDefinition,
  WorkflowMetrics,
} from "@/types";

export { api, errorMessage, errorDetails, unwrap } from "./client";
export { QK } from "./queryKeys";
export { agentsApi } from "./agents";

/* ── Health ─────────────────────────────────────────────────────────── */
export const healthApi = {
  get: () => get<HealthResponse>("/health"),
};

/* ── Conversations ──────────────────────────────────────────────────── */
export const conversationsApi = {
  list: () => get<unknown>("/api/conversations"),
  get: (id: string) => get<unknown>(`/api/conversations/${id}`),
  history: (id: string) => get<unknown>(`/api/conversations/${id}/history`),
  remove: (id: string) => del<unknown>(`/api/conversations/${id}`),
};

/* ── Chat / Orchestrator (non-streaming) ────────────────────────────── */
export interface ChatMessagePayload {
  role: string;
  content: unknown;
  name?: string | null;
  tool_call_id?: string | null;
  tool_calls?: unknown[] | null;
}
export interface ChatCompletionRequest {
  model: string;
  messages: ChatMessagePayload[];
  agent_id?: string | null;
  temperature?: number | null;
  top_p?: number | null;
  max_tokens?: number | null;
  stream?: boolean;
  stop?: unknown;
  random_seed?: number | null;
  tools?: unknown[] | null;
  tool_choice?: unknown;
  response_format?: unknown;
  safe_prompt?: boolean;
  parallel_tool_calls?: boolean | null;
}
export interface OrchestrateRequest {
  query: string;
  agent_id?: string | null;
  conversation_id?: string | null;
  cleanup_agent?: boolean;
  workflow?: boolean;
  tier?: string | null;
  image_base64?: string | null;
  image_mime?: string | null;
}
export const chatApi = {
  completions: (body: ChatCompletionRequest) => post<unknown>("/api/chat/completions", body),
};
export const orchestratorApi = {
  run: (body: OrchestrateRequest) => post<unknown>("/api/orchestrate", body),
};

/* ── Uploads ────────────────────────────────────────────────────────── */
export async function uploadImage(file: File): Promise<UploadResult> {
  const form = new FormData();
  form.append("file", file);
  const res = await fetch("/api/uploads/image", { method: "POST", body: form });
  if (!res.ok) throw new Error((await res.text()) || `HTTP ${res.status}`);
  return (await res.json()) as UploadResult;
}

/* ── Tools ──────────────────────────────────────────────────────────── */
export const toolsApi = {
  list: () => get<Tool[]>("/api/tools"),
  get: (id: string | number) => get<Tool>(`/api/tools/${id}`),
  pending: () => get<{ tools: Tool[]; count: number }>("/api/tools/pending"),
  synthesize: (task: string, purpose: "tool" | "activity" = "tool") =>
    post<{ status?: string; tool_name?: string; message?: string }>("/api/tools/synthesize", { task, purpose }),
  approve: (id: string | number) => post<unknown>(`/api/tools/${id}/approve`),
  reject: (id: string | number) => post<unknown>(`/api/tools/${id}/reject`),
  update: (
    id: string | number,
    body: { source_code?: string; description?: string; purpose?: string },
  ) => put<unknown>(`/api/tools/${id}`, body),
  remove: (id: string | number) => del<unknown>(`/api/tools/${id}`),
  delete: (id: string | number) => del<unknown>(`/api/tools/${id}`),
  execute: (name: string, args: Record<string, unknown> = {}) =>
    post<unknown>(`/api/tools/execute/${name}`, { arguments: args }),
  byHash: (hash: string) => get<Tool>(`/api/tools/by-hash/${hash}`),
  publishMcp: (id: string | number, serverName: string) =>
    post<unknown>(`/api/tools/${id}/publish-mcp`, { server_name: serverName }),
};

/* ── MCP ────────────────────────────────────────────────────────────── */
export const mcpApi = {
  servers: () => get<unknown>("/api/mcp/servers"),
  addServer: (config: Record<string, unknown>) => post<unknown>("/api/mcp/servers", config),
  removeServer: (name: string) => del<unknown>(`/api/mcp/servers/${name}`),
  disconnect: (name: string) => post<unknown>(`/api/mcp/servers/${name}/disconnect`),
  reconnect: (name: string) => post<unknown>(`/api/mcp/servers/${name}/reconnect`),
  tools: (name: string) => get<unknown>(`/api/mcp/servers/${name}/tools`),
  execute: (server: string, tool: string, args: Record<string, unknown>) =>
    post<unknown>(`/api/mcp/execute/${server}/${tool}`, { arguments: args }),
  healthCheck: () => post<unknown>("/api/mcp/health-check"),
};

/* ── Remote servers ─────────────────────────────────────────────────── */
export const remoteServersApi = {
  list: () => get<unknown>("/api/remote-servers"),
  create: (body: { name: string; url: string; description: string }) =>
    post<unknown>("/api/remote-servers", body),
  get: (id: string) => get<unknown>(`/api/remote-servers/${id}`),
  update: (id: string, body: { name?: string; url?: string; description?: string }) =>
    put<unknown>(`/api/remote-servers/${id}`, body),
  remove: (id: string) => del<unknown>(`/api/remote-servers/${id}`),
  check: (url: string) =>
    post<{ reachable: boolean; url: string; health?: unknown }>("/api/remote-servers/check", {
      url,
    }),
  sendTool: (id: string, toolId: string | number) =>
    post<unknown>(`/api/remote-servers/${id}/send-tool`, { tool_id: String(toolId) }),
};

/* ── Libraries ──────────────────────────────────────────────────────── */
export const librariesApi = {
  list: () => get<Library[]>("/api/libraries"),
  create: (body: { name: string; description: string }) => post<Library>("/api/libraries", body),
  update: (id: string, body: { name?: string; description?: string }) =>
    put<Library>(`/api/libraries/${id}`, body),
  remove: (id: string) => del<unknown>(`/api/libraries/${id}`),
  documents: (id: string) => get<LibraryDocument[]>(`/api/libraries/${id}/documents`),
  addWebpage: (id: string, url: string) =>
    post<unknown>(`/api/libraries/${id}/documents/webpage`, { url }),
  removeDocument: (id: string, docId: string) =>
    del<unknown>(`/api/libraries/${id}/documents/${docId}`),
  async uploadDocument(id: string, file: File) {
    const form = new FormData();
    form.append("file", file);
    const res = await fetch(`/api/libraries/${id}/documents`, { method: "POST", body: form });
    if (!res.ok) throw new Error((await res.text()) || `HTTP ${res.status}`);
    return res.json();
  },
};

/* ── Connectors (Mistral Connectors registry — distinct from /mcp) ──── */
export const connectorsApi = {
  list: (params?: { page_size?: number; cursor?: string }) =>
    get<{ items: Connector[]; count: number; next_cursor?: string | null }>("/api/connectors", {
      page_size: 200,
      ...params,
    }),
  create: (body: Record<string, unknown>) => post<Connector>("/api/connectors", body),
  remove: (id: string) => del<unknown>(`/api/connectors/${id}`),
  get: (id: string) => get<Connector>(`/api/connectors/${id}`),
  update: (id: string, body: Record<string, unknown>) =>
    patch<Connector>(`/api/connectors/${id}`, body),
  tools: (id: string) =>
    get<{ tools: ConnectorTool[]; count: number }>(`/api/connectors/${id}/tools`),
  callTool: (
    id: string,
    tool: string,
    body: { arguments: Record<string, unknown>; credentials_name?: string },
  ) => post<{ result: unknown; output: unknown }>(`/api/connectors/${id}/tools/${tool}/call`, body),
  authentication: (id: string) => get<unknown>(`/api/connectors/${id}/authentication`),
  /** Short-lived — fetch on click, never cache. */
  authUrl: (id: string, credentialsName?: string) =>
    get<{ auth_url: string; ttl: number }>(
      `/api/connectors/${id}/auth-url`,
      credentialsName ? { credentials_name: credentialsName } : {},
    ),
  credentials: (id: string, scope: ConnectorScope = "user") =>
    get<{ credentials: unknown[]; scope: string; count: number }>(
      `/api/connectors/${id}/credentials`,
      { scope },
    ),
  createCredentials: (
    id: string,
    body: { name: string; credentials: Record<string, unknown>; is_default?: boolean },
    scope: ConnectorScope = "user",
  ) => post<unknown>(`/api/connectors/${id}/credentials?scope=${scope}`, body),
  deleteCredentials: (id: string, credentialsName: string, scope: ConnectorScope = "user") =>
    del<unknown>(`/api/connectors/${id}/credentials`, { scope, credentials_name: credentialsName }),
  setActivation: (
    id: string,
    body: {
      active: boolean;
      include?: string[];
      exclude?: string[];
      requires_confirmation?: string[];
      skip_confirmation?: string[];
    },
    scope: ConnectorScope = "organization",
  ) => post<unknown>(`/api/connectors/${id}/activation?scope=${scope}`, body),
};

/* ── Ontology ───────────────────────────────────────────────────────── */
export const ontologyApi = {
  overview: () => get<OntologyOverview & { level_names?: string[] }>("/api/ontology"),
  tiers: () => get<{ tiers: TierOption[] }>("/api/ontology/tiers"),
  schemes: () => get<{ schemes: ConceptScheme[] } | ConceptScheme[]>("/api/ontology/schemes"),
  createScheme: (body: { id: string; label: string; description?: string }) =>
    post<unknown>("/api/ontology/schemes", body),
  updateScheme: (id: string, body: { label?: string; description?: string }) =>
    patch<unknown>(`/api/ontology/schemes/${id}`, body),
  deleteScheme: (id: string, cascade = false) =>
    del<unknown>(`/api/ontology/schemes/${id}`, { cascade }),
  concepts: (scheme?: string) =>
    get<{ concepts: Concept[] } | Concept[]>("/api/ontology/concepts", scheme ? { scheme } : {}),
  createConcept: (body: {
    id: string;
    scheme_id: string;
    label: string;
    parent_id?: string | null;
    definition?: string;
    synonyms?: string[];
  }) => post<unknown>("/api/ontology/concepts", body),
  updateConcept: (
    id: string,
    body: {
      label?: string;
      parent_id?: string | null;
      definition?: string;
      synonyms?: string[];
      clear_parent?: boolean;
    },
  ) => patch<unknown>(`/api/ontology/concepts/${id}`, body),
  deleteConcept: (id: string, cascade = false) =>
    del<unknown>(`/api/ontology/concepts/${id}`, { cascade }),
  descendants: (id: string) => get<unknown>(`/api/ontology/concepts/${id}/descendants`),
  usage: (id: string) => get<ConceptUsage>(`/api/ontology/concepts/${id}/usage`),
  annotations: (params: Record<string, unknown>) =>
    get<{ annotations: AnnotationRow[] } | AnnotationRow[]>("/api/ontology/annotations", {
      limit: 500,
      ...params,
    }),
  /** Backend wraps the map: `{ subject_type, annotations: { [subjectId]: AnnotationMap } }`. */
  annotationsBulk: (body: { subject_type: string; subject_ids: string[] }) =>
    post<{ subject_type: string; annotations: Record<string, AnnotationMap> }>(
      "/api/ontology/annotations/bulk",
      body,
    ).then((res) => res.annotations ?? {}),
  annotationsFor: (subjectType: string, subjectId: string) =>
    get<AnnotationMap | { annotations: AnnotationMap }>(
      `/api/ontology/annotations/${subjectType}/${subjectId}`,
    ),
  /** Replaces the whole set for one predicate. */
  setAnnotations: (body: {
    subject_type: string;
    subject_id: string;
    predicate: string;
    concept_ids: string[];
    source?: string;
  }) => put<unknown>("/api/ontology/annotations", body),
  addAnnotation: (body: {
    subject_type: string;
    subject_id: string;
    predicate: string;
    concept_id: string;
  }) => post<unknown>("/api/ontology/annotations/one", body),
  deleteAnnotation: (params: Record<string, unknown>) =>
    del<unknown>("/api/ontology/annotations/one", params),
  clearAnnotations: (subjectType: string, subjectId: string) =>
    del<unknown>(`/api/ontology/annotations/${subjectType}/${subjectId}`),
  graph: (params: Record<string, unknown>) => get<OntologyGraph>("/api/ontology/graph", params),
  scope: (goal: string) =>
    get<{
      goal: string;
      scoped: boolean;
      domains: string[];
      label: string;
      concepts: Concept[];
      scores: Array<[string, number]>;
    }>("/api/ontology/scope", { goal }),
  scopeGraph: (goal: string) => get<OntologyGraph>("/api/ontology/scope/graph", { goal }),
  classify: (body: {
    name: string;
    description?: string;
    instructions?: string;
    subject_kind?: string;
    subject_type?: string;
    subject_id?: string;
  }) =>
    post<{
      classified: boolean;
      result: ClassificationResult;
      written?: boolean;
      detail?: string;
    }>("/api/ontology/classify", body),
  knowledge: (params: Record<string, unknown>) =>
    get<{ entries: KnowledgeEntry[]; count: number; kinds: string[] }>("/api/ontology/knowledge", {
      limit: 500,
      ...params,
    }),
  knowledgeSearch: (params: Record<string, unknown>) =>
    get<{
      query: string;
      domains: string[];
      results: KnowledgeEntry[];
      count: number;
      rendered: string;
    }>("/api/ontology/knowledge/search", { limit: 5, ...params }),
  createKnowledge: (body: {
    concept_id: string;
    title: string;
    body: string;
    kind?: string;
    tags?: string[];
    as_of?: string | null;
  }) => post<unknown>("/api/ontology/knowledge", body),
  deleteKnowledge: (id: number) => del<unknown>(`/api/ontology/knowledge/${id}`),
  agentKnowledge: (agentId: string, query?: string) =>
    get<{ agent_id: string; domains: string[]; scoped: boolean; results: KnowledgeEntry[] }>(
      `/api/ontology/knowledge/agent/${agentId}`,
      query ? { query } : {},
    ),
  attachKnowledgeTool: () =>
    post<{
      checked: number;
      attached: number;
      detached: number;
      unchanged: number;
      failed: number;
    }>("/api/ontology/knowledge/attach-tool"),
  rules: (status?: string) =>
    get<{ rules: any[]; count: number }>("/api/ontology/rules", status ? { status } : {}),
  createRule: (body: unknown) => post<any>("/api/ontology/rules", body),
  updateRule: (id: string, body: unknown) =>
    patch<any>(`/api/ontology/rules/${encodeURIComponent(id)}`, body),
  approveRule: (id: string) =>
    post<any>(`/api/ontology/rules/${encodeURIComponent(id)}/approve`),
  deleteRule: (id: string) => del<unknown>(`/api/ontology/rules/${encodeURIComponent(id)}`),
  ruleExceptions: (ruleId: string) =>
    get<{ exceptions: any[]; count: number }>(
      `/api/ontology/rules/${encodeURIComponent(ruleId)}/exceptions`,
    ),
  addRuleException: (ruleId: string, body: unknown) =>
    post<any>(`/api/ontology/rules/${encodeURIComponent(ruleId)}/exceptions`, body),
  deleteRuleException: (exceptionId: string | number) =>
    del<unknown>(`/api/ontology/rules/exceptions/${exceptionId}`),
};


/* ── Workflows ──────────────────────────────────────────────────────── */
export const workflowsApi = {
  list: () => get<{ workflows: WorkflowDefinition[]; count: number }>("/api/workflows"),
  get: async (name: string): Promise<WorkflowDefinition> => {
    const res = await get<WorkflowDefinition | { workflow: WorkflowDefinition }>(
      `/api/workflows/${name}`,
    );
    if (res && typeof res === "object" && "workflow" in res && res.workflow) {
      return res.workflow;
    }
    return res as WorkflowDefinition;
  },
  create: (definition: WorkflowDefinition) => post<unknown>("/api/workflows", { definition }),
  update: (name: string, definition: WorkflowDefinition) =>
    put<unknown>(`/api/workflows/${name}`, { definition }),
  validate: (definition: WorkflowDefinition) =>
    post<ValidationResult>("/api/workflows/validate", { definition }),
  scriptPreview: (definition: WorkflowDefinition) =>
    post<ScriptResult>("/api/workflows/script/preview", { definition }),
  script: (name: string) => get<ScriptResult>(`/api/workflows/${name}/script`),
  publish: (name: string) => post<Record<string, unknown>>(`/api/workflows/${name}/publish`),
  register: (name: string) => post<Record<string, unknown>>(`/api/workflows/${name}/register`),
  exportToMistral: (name: string) =>
    post<{ success?: boolean; file_path?: string; error?: string }>(
      `/api/workflows/${name}/export`,
      {},
    ),
  exportLegacy: (name: string) => post<unknown>(`/api/workflows/${name}/export`),
  getDeploymentManifest: (name: string) =>
    get<any>(`/api/workflows/${name}/deployment/manifest`),
  deploymentPackageUrl: (name: string) => `/api/workflows/${name}/deployment/package`,
  uploadImage: async (file: File) => {
    const form = new FormData();
    form.append("file", file);
    const res = await fetch("/api/uploads/image", { method: "POST", body: form });
    if (!res.ok) throw new Error((await res.text()) || `HTTP ${res.status}`);
    return unwrapJson(await res.json());
  },
  catalog: () => get<BuilderCatalog>("/api/workflows/builder/catalog"),
  archive: (name: string) => put<unknown>(`/api/workflows/${name}/archive`),
  unarchive: (name: string) => put<unknown>(`/api/workflows/${name}/unarchive`),
  execute: (
    name: string,
    body: {
      input: Record<string, unknown>;
      wait_for_result: boolean;
      timeout_seconds?: number;
      execution_id?: string;
    },
  ) => post<Record<string, unknown>>(`/api/workflows/${name}/execute`, body),
  executionsFor: (name: string) => get<ExecutionListResponse>(`/api/workflows/${name}/executions`),
  metrics: (name: string, params?: Record<string, unknown>) =>
    get<WorkflowMetrics>(`/api/workflows/${name}/metrics`, params),
};

/* ── Workflow executions ────────────────────────────────────────────── */
export const executionsApi = {
  list: (params: Record<string, unknown>) =>
    get<ExecutionListResponse>("/api/workflows/executions", { page_size: 50, ...params }),
  cancelMany: (ids: string[]) =>
    post<unknown>("/api/workflows/executions/cancel", { execution_ids: ids }),
  terminateMany: (ids: string[]) =>
    post<unknown>("/api/workflows/executions/terminate", { execution_ids: ids }),
  get: (id: string) => get<ExecutionDetail>(`/api/workflows/executions/${id}`, { with_steps: true }),
  steps: (id: string, includeInternal = false) =>
    get<{ steps: ExecutionStep[] } | ExecutionStep[]>(`/api/workflows/executions/${id}/steps`, {
      include_internal: includeInternal,
    }),
  history: (id: string) =>
    get<unknown>(`/api/workflows/executions/${id}/history`, { decode_payloads: true }),
  traceInfo: (id: string) => get<unknown>(`/api/workflows/executions/${id}/trace/info`),
  traceSummary: (id: string) => get<TraceSummary>(`/api/workflows/executions/${id}/trace/summary`),
  traceEvents: (id: string) =>
    get<unknown>(`/api/workflows/executions/${id}/trace/events`, {
      merge_same_id_events: true,
      include_internal_events: false,
    }),
  traceOtel: (id: string) => get<unknown>(`/api/workflows/executions/${id}/trace/otel`),
  logs: (id: string, since = 0, limit = 500) =>
    get<ExecutionLogsResponse>(`/api/workflows/executions/${id}/logs`, { limit, since }),
  signal: (id: string, body: { name: string; input: unknown }) =>
    post<unknown>(`/api/workflows/executions/${id}/signals`, body),
  query: (id: string, body: { name: string; input: unknown }) =>
    post<unknown>(`/api/workflows/executions/${id}/queries`, body),
  update: (id: string, body: { name: string; input: unknown }) =>
    post<unknown>(`/api/workflows/executions/${id}/updates`, body),
  cancel: (id: string) => post<unknown>(`/api/workflows/executions/${id}/cancel`),
  terminate: (id: string) => post<unknown>(`/api/workflows/executions/${id}/terminate`),
  reset: (
    id: string,
    body: {
      event_id: number;
      reason?: string;
      exclude_signals?: boolean;
      exclude_updates?: boolean;
    },
  ) => post<unknown>(`/api/workflows/executions/${id}/reset`, body),
};

/* ── Graph RAG ──────────────────────────────────────────────────────── */
export const ragApi = {
  status: () => get<{ graph: GraphStatus }>("/api/rag/status"),
  overview: () =>
    get<{
      libraries: LibraryCard[];
      graph: GraphStatus;
      totals: Record<string, number>;
      entity_types: string[];
    }>("/api/rag/overview"),
  documents: (libraryId: string) =>
    get<{ library_id: string; documents: RagDocument[]; rules: string; count: number }>(
      `/api/rag/libraries/${libraryId}/documents`,
    ),
  async uploadDocument(libraryId: string, file: File, rules = "", autoExtract = false) {
    const form = new FormData();
    form.append("file", file);
    form.append("rules", rules);
    form.append("auto_extract", String(autoExtract));
    const res = await fetch(`/api/rag/libraries/${libraryId}/documents`, {
      method: "POST",
      body: form,
    });
    if (!res.ok) throw new Error((await res.text()) || `HTTP ${res.status}`);
    return unwrapJson(await res.json());
  },
  extract: (documentId: number, rules?: string | null) =>
    post<unknown>(`/api/rag/documents/${documentId}/extract`, { rules: rules ?? null }),
  deleteDocument: (documentId: number, dropFromLibrary = true) =>
    del<unknown>(`/api/rag/documents/${documentId}`, { drop_from_library: dropFromLibrary }),
  rules: (libraryId: string) =>
    get<{ rules: string; default_instructions: string; entity_types: string[] }>(
      `/api/rag/libraries/${libraryId}/rules`,
    ),
  setRules: (libraryId: string, rules: string) =>
    put<unknown>(`/api/rag/libraries/${libraryId}/rules`, { rules }),
  draft: (documentId: number) =>
    get<{ document: RagDocument; draft: ExtractionDraft | null }>(
      `/api/rag/documents/${documentId}/draft`,
    ),
  saveDraft: (
    documentId: number,
    body: { entities: unknown[]; relations: unknown[] },
  ) =>
    put<{ draft: ExtractionDraft; dropped_relations: number }>(
      `/api/rag/documents/${documentId}/draft`,
      body,
    ),
  commit: (documentId: number) =>
    post<{
      status: string;
      document_id: number;
      trace_id: string;
      entities: number;
      relations: number;
      orphans_removed: number;
    }>(`/api/rag/documents/${documentId}/commit`),
  graph: (params: { library_id?: string; document_id?: number; limit?: number }) =>
    get<GraphSnapshot>("/api/rag/graph", params),
  search: (body: {
    query: string;
    library_ids?: string[];
    hops?: number;
    limit?: number;
    optimize?: boolean;
  }) => post<SearchResult>("/api/rag/search", body),
  optimizer: () => get<Record<string, unknown>>("/api/rag/optimizer"),
  ensureOptimizer: (reset = false) =>
    post<Record<string, unknown>>(`/api/rag/optimizer/ensure?reset=${reset}`),
  previewPlan: (query: string) => post<QueryPlan>("/api/rag/optimizer/preview", { query }),
  timelines: (params?: { subject?: string; scope?: string; limit?: number }) =>
    get<{ traces: TimelineTrace[] }>("/api/rag/timeline", { limit: 25, ...params }),
  timeline: (traceId: string) =>
    get<{ trace_id: string; events: TimelineEvent[] }>(`/api/rag/timeline/${traceId}`),
  proposeOntology: (libraryId: string, body?: unknown) =>
    post<{ draft: unknown; summary?: string }>(
      `/api/rag/libraries/${encodeURIComponent(libraryId)}/ontology/propose`,
      body ?? {},
    ),
  approveOntology: (libraryId: string, body?: unknown) =>
    post<{ status: string; applied?: boolean }>(
      `/api/rag/libraries/${encodeURIComponent(libraryId)}/ontology/approve`,
      body ?? {},
    ),
  deleteOntologyDraft: (libraryId: string) =>
    del<unknown>(`/api/rag/libraries/${encodeURIComponent(libraryId)}/ontology/draft`),
  getOntology: (libraryId: string) =>
    get<unknown>(`/api/rag/libraries/${encodeURIComponent(libraryId)}/ontology`),
  updateOntology: (libraryId: string, body: unknown) =>
    post<unknown>(`/api/rag/libraries/${encodeURIComponent(libraryId)}/ontology`, body),
  getDomains: (libraryId: string) =>
    get<{ library_id: string; domains: string[] }>(
      `/api/rag/libraries/${encodeURIComponent(libraryId)}/domains`,
    ),
  setDomains: (libraryId: string, domains: string[]) =>
    put<unknown>(`/api/rag/libraries/${encodeURIComponent(libraryId)}/domains`, { domains }),
  classifyDomains: (libraryId: string) =>
    post<{ domains: string[]; reasoning?: string }>(
      `/api/rag/libraries/${encodeURIComponent(libraryId)}/domains/classify`,
    ),
  getUnifiedGraph: (params?: Record<string, unknown>) =>
    get<any>("/api/rag/graph/unified", params),
  syncTaxonomy: () =>
    post<{ status: string; concepts_synced?: number }>("/api/rag/graph/sync-taxonomy"),
  queryCypher: (query: string, params?: Record<string, unknown>, limit = 100) =>
    post<{
      columns: string[];
      rows: Record<string, unknown>[];
      nodes?: any[];
      edges?: any[];
      execution_time_ms?: number;
      count?: number;
    }>("/api/rag/graph/query", { query, params, limit }),
  syncAgents: () =>
    post<{ status: string; synced?: number }>("/api/rag/agents/sync"),
  timelineStreamUrl: (traceId: string) =>
    `/api/rag/timeline/${encodeURIComponent(traceId)}/stream`,
};

function unwrapJson<T>(data: T): T {
  const err = (data as { error?: unknown } | null)?.error;
  if (typeof err === "string" && err.length > 0) throw new Error(err);
  return data;
}
