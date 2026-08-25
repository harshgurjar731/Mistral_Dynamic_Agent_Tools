/* Shared models — mirror the backend Pydantic models. Copied from the spec. */

/* ── Agents ─────────────────────────────────────────────────────────── */
export interface Agent {
  id: string;
  name: string;
  model: string;
  description?: string;
  instructions?: string;
  tools?: unknown[];
  connectors?: ConnectorRef[];
  tier?: string;
  /** Platform-owned; DELETE returns 403. Hide the delete control. */
  protected?: boolean;
  created_at?: string;
  temperature?: number | null;
  top_p?: number | null;
  max_tokens?: number | null;
  random_seed?: number | null;
  frequency_penalty?: number | null;
  presence_penalty?: number | null;
  document_library_ids?: string[];
}

export interface PaginatedAgents {
  items: Agent[];
  page: number;
  page_size: number;
  total_pages: number;
  count: number;
}

/* ── Workflow definition ────────────────────────────────────────────── */
export type StepType = "agent" | "tool" | "connector" | "condition" | "transform";
export type WorkflowSourceKind = "planner" | "builder";

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
  /** Steps sharing a group id run concurrently. */
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
  /** Canvas coordinates; excluded from the semantic hash. */
  ui_layout: Record<string, NodeLayout>;
  published_hash?: string | null;
  has_unpublished_changes?: boolean;
}

/* ── Validation ─────────────────────────────────────────────────────── */
export type IssueSeverity = "error" | "warning";
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

export interface ScriptResult {
  workflow_name: string;
  code: string;
  line_count: number;
  stale: boolean;
}

/* ── Builder catalog ────────────────────────────────────────────────── */
export interface CatalogAgent {
  id: string;
  name: string;
  model: string;
  description?: string | null;
  tier?: string | null;
  tools: string[];
  connectors: string[];
  domains: string[];
}
export interface CatalogTool {
  name: string;
  description?: string | null;
  parameters: Record<string, { type?: string; description?: string }>;
  required: string[];
  status: string;
  source: "builtin" | "native" | "dynamic";
}
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
export interface CatalogDomain {
  id: string;
  label: string;
  parent_id?: string | null;
  agent_count: number;
}
export interface BuilderCatalog {
  agents: CatalogAgent[];
  tools: CatalogTool[];
  connectors: CatalogConnector[];
  domains: CatalogDomain[];
  models: string[];
  tiers: string[];
}

/* ── Tools ──────────────────────────────────────────────────────────── */
export type ToolSource = "builtin" | "native" | "dynamic";
export interface Tool {
  id: string;
  name: string;
  version?: number | string;
  status?: string;
  description?: string;
  schema_json?: Record<string, unknown> | string | null;
  source_code?: string | null;
  hash?: string | null;
  sandbox_output?: string | null;
  mcp_published?: boolean;
  mcp_server_name?: string | null;
  created_at?: string;
}

/* ── Executions ─────────────────────────────────────────────────────── */
export const EXECUTION_STATUSES = [
  "PENDING",
  "RUNNING",
  "RETRYING_AFTER_ERROR",
  "COMPLETED",
  "FAILED",
  "CANCELLED",
  "TERMINATED",
  "TIMED_OUT",
  "CONTINUED_AS_NEW",
] as const;
export type ExecutionStatus = (typeof EXECUTION_STATUSES)[number];

export const TERMINAL_STATUSES: ReadonlySet<string> = new Set([
  "COMPLETED",
  "FAILED",
  "CANCELLED",
  "TERMINATED",
  "TIMED_OUT",
  "CONTINUED_AS_NEW",
]);
export const ACTIVE_STATUSES: ReadonlySet<string> = new Set([
  "PENDING",
  "RUNNING",
  "RETRYING_AFTER_ERROR",
]);
export const isTerminal = (s?: string | null) => TERMINAL_STATUSES.has((s ?? "").toUpperCase());
export const isActive = (s?: string | null) => ACTIVE_STATUSES.has((s ?? "").toUpperCase());

export interface ExecutionStep {
  id: string;
  name: string;
  /** RUNNING | COMPLETED | FAILED */
  status: string;
  start_time_ms?: number | null;
  end_time_ms?: number | null;
  duration_ms?: number | null;
  error?: string | null;
  internal?: boolean;
  attributes?: Record<string, unknown>;
  input_preview?: string | null;
  output_preview?: string | null;
  parallel_group?: string | null;
}

export interface ExecutionDetail {
  execution_id: string;
  workflow_name: string;
  status: string;
  start_time?: string | null;
  end_time?: string | null;
  result?: unknown;
  error?: string | null;
  root_execution_id?: string | null;
  parent_execution_id?: string | null;
  run_id?: string | null;
  user_id?: string | null;
  deployment_name?: string | null;
  total_duration_ms?: number | null;
  source: "mistral" | "local";
  steps: ExecutionStep[];
}

export interface ExecutionSummary {
  execution_id: string;
  workflow_name: string;
  status: string;
  start_time?: string | null;
  end_time?: string | null;
  total_duration_ms?: number | null;
  run_id?: string | null;
  root_execution_id?: string | null;
  parent_execution_id?: string | null;
  user_id?: string | null;
  source: "mistral" | "local";
}

export interface ExecutionListResponse {
  executions: ExecutionSummary[];
  next_page_token?: string | null;
  count: number;
  remote_available: boolean;
}

export interface TraceSpan {
  span_id: string;
  name: string;
  start_time_unix_nano: number;
  end_time_unix_nano?: number | null;
  attributes?: Record<string, unknown>;
  events?: Array<Record<string, unknown>>;
  children?: TraceSpan[] | null;
}
export interface TraceSummary {
  workflow_name?: string;
  execution_id?: string;
  status?: string;
  start_time?: string | null;
  end_time?: string | null;
  total_duration_ms?: number | null;
  span_tree?: TraceSpan | null;
}
export interface LogLine {
  seq: number;
  timestamp: string;
  level: "DEBUG" | "INFO" | "WARNING" | "ERROR" | "CRITICAL" | string;
  logger: string;
  message: string;
  step_id?: string | null;
}
export interface ExecutionLogsResponse {
  execution_id: string;
  logs: LogLine[];
  platform_logs: unknown[];
  next_seq: number;
  source: "local" | "mistral" | "none";
  detail?: string;
}
export interface WorkflowMetrics {
  execution_count?: number | null;
  success_count?: number | null;
  error_count?: number | null;
  average_latency_ms?: number | null;
  latency_over_time?: unknown;
  retry_rate?: number | null;
  available?: boolean;
  detail?: string;
}

/* ── Connectors ─────────────────────────────────────────────────────── */
export type ConnectorVisibility = "shared_org" | "shared_workspace" | "private";
export type ConnectorScope = "organization" | "workspace" | "user";

export interface Connector {
  id: string;
  name: string;
  title?: string;
  description: string;
  server?: string | null;
  icon_url?: string | null;
  system_prompt?: string | null;
  protocol: string;
  visibility: ConnectorVisibility | string;
  is_directory: boolean;
  is_authenticated: boolean;
  active: boolean;
  auth_type?: string | null;
  supported_auth_methods: string[];
  tool_count?: number | null;
  created_at?: string;
  modified_at?: string;
}
export interface ConnectorTool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  required: string[];
}
export interface ConnectorRef {
  connector_id: string;
  include?: string[];
  exclude?: string[];
  requires_confirmation?: string[];
}

/* ── Libraries ──────────────────────────────────────────────────────── */
export interface Library {
  id: string;
  name: string;
  description?: string;
  document_count?: number;
  created_at?: string;
}
export interface LibraryDocument {
  id: string;
  filename: string;
  size?: number;
  created_at?: string;
  mime_type?: string;
}

/* ── Ontology ───────────────────────────────────────────────────────── */
export type SchemeId = "agent_tier" | "domain" | "capability" | "data_class";
export type Predicate =
  | "has_tier"
  | "serves_domain"
  | "handles_data_class"
  | "requires_capability"
  | "provides_capability"
  | "egresses_to";
export type SubjectType = "agent" | "tool" | "connector" | "workflow" | "library";

export interface ConceptScheme {
  id: string;
  label: string;
  description: string;
}
export interface Concept {
  id: string;
  scheme_id: string;
  parent_id: string | null;
  label: string;
  definition: string;
  synonyms: string[];
  level?: number;
  /** domain scheme only: industry | domain | subdomain */
  level_name?: string;
}
export type AnnotationMap = Partial<Record<Predicate, string[]>>;
export interface AnnotationRow {
  id: number;
  subject_type: string;
  subject_id: string;
  predicate: string;
  concept_id: string;
  source: string;
}
export interface ConceptUsage {
  concept_id: string;
  children: string[];
  annotations: number;
  subjects: Array<{ subject_type: string; subject_id: string }>;
}
export interface ClassificationResult {
  domains: string[];
  requires_capability: string[];
  provides_capability: string[];
  data_classes: string[];
  tier: string;
  reasoning: string;
}
export interface KnowledgeEntry {
  id: number;
  concept_id: string;
  kind: string;
  title: string;
  body: string;
  tags: string[];
  as_of?: string | null;
  source: string;
  score?: number;
}
export interface TierOption {
  value: string;
  label: string;
  description: string;
}
export interface OntologyOverview {
  seeded: boolean;
  counts: { schemes: number; concepts: number; annotations: number };
  schemes: ConceptScheme[];
  predicates: Predicate[];
  subject_types: SubjectType[];
}

/* Ontology graph */
export interface OntologyGraphNode {
  id: string;
  kind: string;
  label: string;
  degree: number;
  scheme_id?: string;
  parent_id?: string | null;
  level?: number;
  definition?: string;
  synonyms?: string[];
  subject_id?: string;
  subject_type?: string;
  tier?: string;
  model?: string;
  status?: string;
  steps?: number;
  is_deployed?: boolean;
  archived?: boolean;
  description?: string;
  rollup?: Record<string, number>;
  rollup_total?: number;
}
export interface OntologyGraphEdge {
  id: string;
  source: string;
  target: string;
  kind: string;
  label: string;
  source_of?: string;
  /** forward: source reveals target. reverse: target reveals source. */
  reveal?: "forward" | "reverse";
}
export interface OntologyGraph {
  nodes: OntologyGraphNode[];
  edges: OntologyGraphEdge[];
  counts: Record<string, number>;
  totals: { nodes: number; edges: number; concepts: number; annotations: number };
  kinds: string[];
  predicates: string[];
  scoped?: boolean;
  label?: string;
  matched_domains?: string[];
  goal?: string;
}

export const PREDICATE_LABELS: Record<Predicate, string> = {
  has_tier: "Tier",
  serves_domain: "Serves domain",
  handles_data_class: "Handles data",
  requires_capability: "Requires capability",
  provides_capability: "Provides capability",
  egresses_to: "Sends data to",
};
export const PREDICATE_SCHEME: Record<Predicate, SchemeId> = {
  has_tier: "agent_tier",
  serves_domain: "domain",
  handles_data_class: "data_class",
  requires_capability: "capability",
  provides_capability: "capability",
  egresses_to: "data_class",
};

/* ── Graph RAG ──────────────────────────────────────────────────────── */
export type DocumentStatus =
  | "uploaded"
  | "indexing"
  | "extracted"
  | "extracting"
  | "proposed"
  | "graphed"
  | "unsupported"
  | "failed";

export interface RagDocument {
  id: number;
  library_id: string;
  mistral_doc_id: string;
  filename: string;
  mime_type: string;
  status: DocumentStatus;
  error: string | null;
  char_count: number;
  chunk_count: number;
  rules: string;
  trace_id: string | null;
  created_at: string | null;
  updated_at: string | null;
  in_library?: boolean;
  size?: number;
}
export interface DraftEntity {
  name: string;
  normalized: string;
  type: string;
  description: string;
  aliases: string[];
  confidence: number;
  source: string;
  mentions: { chunk_index: number; quote: string }[];
}
export interface DraftRelation {
  source: string;
  source_normalized: string;
  source_type: string;
  predicate: string;
  target: string;
  target_normalized: string;
  target_type: string;
  evidence: string;
  confidence: number;
  source_kind?: string;
}
export interface ExtractionDraft {
  id: number;
  document_id: number;
  status: "pending" | "edited" | "committed";
  model: string | null;
  rules: string;
  entity_count: number;
  relation_count: number;
  entities: DraftEntity[];
  relations: DraftRelation[];
  created_at: string | null;
  updated_at: string | null;
}
export interface LibraryCard {
  id: string;
  name: string;
  description: string;
  document_count: number;
  created_at: string;
  tracked_documents: number;
  graphed_documents: number;
  pending_documents: number;
  failed_documents: number;
  entities: number;
  relations: number;
  has_rules: boolean;
}
export interface GraphStatus {
  available: boolean;
  uri: string;
  database: string;
  reason: string | null;
}
export interface RagGraphNode {
  id: string;
  label: string;
  type: string;
  description: string;
  library_id: string | null;
  confidence: number | null;
  degree: number;
}
export interface RagGraphEdge {
  source: string;
  target: string;
  predicate: string;
  evidence: string;
  doc_id: string | null;
  confidence: number | null;
}
export interface GraphSnapshot {
  available: boolean;
  nodes: RagGraphNode[];
  edges: RagGraphEdge[];
  truncated: boolean;
  scope: "document" | "library" | "all";
  library_id: string | null;
  document_id: number | null;
}
export interface TimelineEvent {
  id: number;
  trace_id: string;
  parent_id: number | null;
  scope: "ingest" | "query";
  subject: string;
  stage: string;
  status: "running" | "ok" | "failed" | "skipped";
  message: string | null;
  meta: Record<string, unknown>;
  seq: number;
  started_at: string | null;
  ended_at: string | null;
  duration_ms: number | null;
}
export interface TimelineTrace {
  trace_id: string;
  scope: "ingest" | "query";
  subject: string;
  stages: number;
  failed: number;
  running: number;
  duration_ms: number;
  started_at: string | null;
  ended_at: string | null;
  root_stage: string | null;
  status: "ok" | "failed" | "running";
}
export interface QueryPlan {
  query: string;
  rewritten: string;
  sub_queries: string[];
  entity_hints: string[];
  intent: string;
  backend: string;
  agent_id?: string | null;
  reason?: string;
  cached?: boolean;
}
export interface MatchedEntity {
  name: string;
  normalized: string;
  type: string;
  description: string;
  aliases: string[];
  library_id: string;
  confidence: number;
  score: number;
}
export interface RetrievedRelation {
  source_name: string;
  source_type: string;
  target_name: string;
  target_type: string;
  predicate: string;
  evidence: string;
  confidence: number;
  doc_id: string | null;
  filename: string | null;
  hops: number;
  score: number;
  sources: string[];
}
export interface SearchResult {
  plan: QueryPlan;
  entities: MatchedEntity[];
  relations: RetrievedRelation[];
  passages: {
    name: string;
    type: string;
    description: string;
    doc_id: string;
    filename: string;
    quote: string;
    chunk_index: number;
  }[];
  available: boolean;
  reason: string;
  /** Exactly what the agent's tool hands the model. */
  rendered: string;
}

/* ── Uploads ────────────────────────────────────────────────────────── */
export interface UploadResult {
  filename: string;
  content_type: string;
  size_bytes: number;
  image_base64: string;
  image_url: string;
  image_mime: string;
}

/* ── Chat sessions (client-side only, persisted) ────────────────────── */
export interface Message {
  id: string;
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  streaming?: boolean | undefined;
  timestamp?: string | undefined;
  imageUrl?: string | undefined;
  imageBase64?: string | undefined;
  imageMime?: string | undefined;
}
export interface ChatSession {
  id: string;
  type: "general" | "agent";
  agentId?: string | null;
  /** Mistral conversation id, once the first response arrives. */
  conversationId?: string | null;
  title: string;
  messages: Message[];
  updatedAt: number;
}

/* ── Health ─────────────────────────────────────────────────────────── */
export interface HealthResponse {
  status?: string;
  service?: string;
  version?: string;
  docker_tool_service?: string;
  [k: string]: unknown;
}

/* ── Orchestrator SSE payloads ──────────────────────────────────────── */
export interface AgentConfigEvent {
  agent_name: string;
  model?: string;
  tier?: string;
  tools?: Array<string | Record<string, unknown>>;
  connectors?: Array<string | Record<string, unknown>>;
}

export interface OrchestrateDoneEvent {
  agent_id: string;
  agent_name?: string;
}
