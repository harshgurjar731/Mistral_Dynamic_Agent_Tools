import { api } from './client';

/**
 * Graph RAG — documents in, a knowledge graph out.
 *
 * Two retrieval paths over one upload: Mistral's own document library searches
 * the text, and the knowledge graph traverses the entities and relations
 * extracted from that same text. Nothing extracted reaches the graph without a
 * human approving it, which is why a document has a *draft* between being
 * uploaded and being graphed.
 */

/** Where a document is in the pipeline. See app/rag/models.py. */
export type DocumentStatus =
  | 'uploaded'
  | 'indexing'
  | 'extracted'
  | 'extracting'
  | 'proposed'
  | 'graphed'
  | 'unsupported'
  | 'failed';

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
  /** Present on the listing: the document is still in the Mistral library. */
  in_library?: boolean;
  size?: number;
}

/** One proposed entity, before or after a reviewer edits it. */
export interface DraftEntity {
  name: string;
  normalized: string;
  type: string;
  description: string;
  aliases: string[];
  confidence: number;
  source: string;
  /** Where in the document it was found, and the verbatim span. */
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
  status: 'pending' | 'edited' | 'committed';
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
  serves_domain: string[];
  ontology_version: number | null;
  content_types: string[];
}

export interface GraphStatus {
  available: boolean;
  uri: string;
  database: string;
  reason: string | null;
}

export interface GraphNode {
  id: string;
  label: string;
  type: string;
  description: string;
  library_id: string | null;
  confidence: number | null;
  degree: number;
}

export interface GraphEdge {
  source: string;
  target: string;
  predicate: string;
  evidence: string;
  doc_id: string | null;
  confidence: number | null;
}

export interface GraphSnapshot {
  available: boolean;
  nodes: GraphNode[];
  edges: GraphEdge[];
  truncated: boolean;
  scope: 'document' | 'library' | 'all';
  library_id: string | null;
  document_id: number | null;
}

/** One stage of one processing run. `parent_id` makes the timeline a tree. */
export interface TimelineEvent {
  id: number;
  trace_id: string;
  parent_id: number | null;
  scope: 'ingest' | 'query';
  subject: string;
  stage: string;
  status: 'running' | 'ok' | 'failed' | 'skipped';
  message: string | null;
  meta: Record<string, unknown>;
  seq: number;
  started_at: string | null;
  ended_at: string | null;
  duration_ms: number | null;
}

export interface TimelineTrace {
  trace_id: string;
  scope: 'ingest' | 'query';
  subject: string;
  stages: number;
  failed: number;
  running: number;
  duration_ms: number;
  started_at: string | null;
  ended_at: string | null;
  root_stage: string | null;
  status: 'ok' | 'failed' | 'running';
}

/** What the optimiser did to a query, before anything was searched. */
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

/** One curated industry-knowledge entry. */
export interface KnowledgeEntry {
  id: number;
  concept_id: string;
  kind: string;
  title: string;
  body: string;
  as_of: string | null;
  score?: number;
}

/**
 * What `search_domain_knowledge` returns: both sources, kept separate.
 *
 * They are deliberately not merged into one ranking — a Lucene score over
 * entity names and token overlap over prose are not comparable numbers.
 */
export interface SearchResult {
  query: string;
  graph: {
    plan?: QueryPlan;
    entities?: MatchedEntity[];
    relations?: RetrievedRelation[];
    passages?: {
      name: string; type: string; description: string;
      doc_id: string; filename: string; quote: string; chunk_index: number;
    }[];
    available: boolean;
    reason?: string;
  };
  knowledge: { available: boolean; entries: KnowledgeEntry[]; reason?: string };
  libraries: string[];
  domains: string[];
  found: boolean;
  /** Exactly what the agent's tool would hand the model. */
  rendered: string;
}

/** One entity type in a library's ontology. */
export interface OntologyType {
  name: string;
  description: string;
  examples: string[];
}

/** One predicate. `source_types`/`target_types` are advisory, shown to the extractor. */
export interface OntologyPredicate {
  name: string;
  description: string;
  source_types: string[];
  target_types: string[];
}

export interface LibraryOntology {
  id: number;
  library_id: string;
  version: number;
  status: 'draft' | 'approved' | 'superseded';
  summary: string;
  entity_types: OntologyType[];
  predicates: OntologyPredicate[];
  prompt: string;
  source_document_ids: string[];
  model: string | null;
  created_at: string | null;
  approved_at: string | null;
}

export interface StaleDocument {
  id: number;
  filename: string;
  ontology_version: number | null;
  current_version: number;
}

/** A node in the unified graph. `kind` is the level it belongs to. */
export interface UnifiedNode {
  id: string;
  kind: 'concept' | 'library' | 'document' | 'entity';
  label: string;
  type: string;
  degree: number;
  description?: string;
  library_id?: string | null;
  concept_id?: string;
  level?: number;
  /** Ad hoc query results only: the node's real Neo4j labels and element id. */
  labels?: string[];
  element_id?: string;
  [property: string]: unknown;
}

export interface UnifiedEdge {
  source: string;
  target: string;
  predicate: string;
  evidence?: string;
  confidence?: number | null;
  [property: string]: unknown;
}

export interface UnifiedGraph {
  available: boolean;
  nodes: UnifiedNode[];
  edges: UnifiedEdge[];
  truncated: boolean;
  counts: Record<string, number>;
  library_id?: string | null;
  reason?: string;
}

/** Result of an ad hoc Cypher query — a graph slice, a row table, or both. */
export interface CypherQueryResult extends UnifiedGraph {
  rows: Record<string, unknown>[];
  columns: string[];
  row_count?: number;
}

export interface Concept {
  id: string;
  label: string;
  definition?: string;
  level?: number;
}

export const ragApi = {
  // ── Overview ────────────────────────────────────────────────────────────
  overview: () =>
    api.get<{
      libraries: LibraryCard[];
      graph: GraphStatus;
      totals: { entities?: number; relations?: number; documents?: number; libraries?: number };
      entity_types: string[];
    }>('/api/rag/overview'),

  status: () => api.get<{ graph: GraphStatus }>('/api/rag/status'),

  // ── Documents ───────────────────────────────────────────────────────────
  documents: (libraryId: string) =>
    api.get<{ library_id: string; documents: RagDocument[]; rules: string; count: number }>(
      `/api/rag/libraries/${encodeURIComponent(libraryId)}/documents`,
    ),

  /**
   * Upload and, by default, start building the graph.
   *
   * Multipart rather than JSON because the document itself goes to the Mistral
   * library — the same upload the document_library tool searches.
   */
  upload: (libraryId: string, file: File, rules = '', autoExtract = true) => {
    const form = new FormData();
    form.append('file', file);
    form.append('rules', rules);
    form.append('auto_extract', String(autoExtract));
    return api.post<RagDocument>(
      `/api/rag/libraries/${encodeURIComponent(libraryId)}/documents`,
      form,
    );
  },

  extract: (documentId: number, rules?: string) =>
    api.post<{ document_id: number; status: string; rules: string }>(
      `/api/rag/documents/${documentId}/extract`,
      { rules: rules ?? null },
    ),

  deleteDocument: (documentId: number, dropFromLibrary = true) =>
    api.delete(`/api/rag/documents/${documentId}`, {
      params: { drop_from_library: dropFromLibrary },
    }),

  // ── Rules ───────────────────────────────────────────────────────────────
  rules: (libraryId: string) =>
    api.get<{
      library_id: string;
      rules: string;
      default_instructions: string;
      entity_types: string[];
    }>(`/api/rag/libraries/${encodeURIComponent(libraryId)}/rules`),

  setRules: (libraryId: string, rules: string) =>
    api.put<{ library_id: string; rules: string }>(
      `/api/rag/libraries/${encodeURIComponent(libraryId)}/rules`,
      { rules },
    ),

  // ── Drafts ──────────────────────────────────────────────────────────────
  draft: (documentId: number) =>
    api.get<{ document: RagDocument; draft: ExtractionDraft | null }>(
      `/api/rag/documents/${documentId}/draft`,
    ),

  saveDraft: (documentId: number, entities: DraftEntity[], relations: DraftRelation[]) =>
    api.put<{ draft: ExtractionDraft; dropped_relations: number }>(
      `/api/rag/documents/${documentId}/draft`,
      { entities, relations },
    ),

  commit: (documentId: number) =>
    api.post<{
      status: string; document_id: number; trace_id: string | null;
      entities: number; relations: number; orphans_removed: number;
    }>(`/api/rag/documents/${documentId}/commit`),

  // ── Graph ───────────────────────────────────────────────────────────────
  graph: (params: { library_id?: string; document_id?: number; limit?: number } = {}) =>
    api.get<GraphSnapshot>('/api/rag/graph', { params }),

  // ── Retrieval ───────────────────────────────────────────────────────────
  search: (body: {
    query: string;
    library_ids?: string[];
    domains?: string[];
    hops?: number;
    limit?: number;
    optimize?: boolean;
  }) => api.post<SearchResult>('/api/rag/search', body),

  optimizer: () =>
    api.get<{
      agent_id: string | null; name: string; model: string | null;
      backend: string; toolkit_available: boolean; protected: boolean;
      cached_queries: number;
    }>('/api/rag/optimizer'),

  ensureOptimizer: (reset = false) =>
    api.post('/api/rag/optimizer/ensure', null, { params: { reset } }),

  previewOptimizer: (query: string) =>
    api.post<QueryPlan>('/api/rag/optimizer/preview', { query }),

  // ── Library ontology ────────────────────────────────────────────────────
  ontology: (libraryId: string) =>
    api.get<{
      library_id: string;
      approved: LibraryOntology | null;
      draft: LibraryOntology | null;
      history: LibraryOntology[];
      stale_documents: StaleDocument[];
      architect: { agent_id: string | null; name: string; protected: boolean };
      fallback_types: string[];
      effective_prompt: string;
    }>(`/api/rag/libraries/${encodeURIComponent(libraryId)}/ontology`),

  /** Have the architect read a sample of the library and propose a schema. */
  proposeOntology: (libraryId: string) =>
    api.post<LibraryOntology & { trace_id: string }>(
      `/api/rag/libraries/${encodeURIComponent(libraryId)}/ontology/propose`,
    ),

  saveOntology: (libraryId: string, body: {
    entity_types: OntologyType[];
    predicates: OntologyPredicate[];
    prompt?: string;
    summary?: string;
  }) =>
    api.put<LibraryOntology>(
      `/api/rag/libraries/${encodeURIComponent(libraryId)}/ontology`, body,
    ),

  approveOntology: (libraryId: string) =>
    api.post<{ ontology: LibraryOntology; stale_documents: StaleDocument[] }>(
      `/api/rag/libraries/${encodeURIComponent(libraryId)}/ontology/approve`,
    ),

  discardOntologyDraft: (libraryId: string) =>
    api.delete(`/api/rag/libraries/${encodeURIComponent(libraryId)}/ontology/draft`),

  // ── Library domain ──────────────────────────────────────────────────────
  domains: (libraryId: string) =>
    api.get<{ library_id: string; domains: string[]; available: Concept[] }>(
      `/api/rag/libraries/${encodeURIComponent(libraryId)}/domains`,
    ),

  setDomains: (libraryId: string, domains: string[]) =>
    api.put<{ library_id: string; domains: string[] }>(
      `/api/rag/libraries/${encodeURIComponent(libraryId)}/domains`, { domains },
    ),

  classifyDomain: (libraryId: string) =>
    api.post<{ library_id: string; domains: string[] }>(
      `/api/rag/libraries/${encodeURIComponent(libraryId)}/domains/classify`,
    ),

  // ── The unified graph ───────────────────────────────────────────────────
  unifiedGraph: (params: {
    library_id?: string;
    /** Narrows to one document — and to the concepts its library serves. */
    document_id?: number;
    entity_limit?: number;
    include_documents?: boolean;
  } = {}) => api.get<UnifiedGraph>('/api/rag/graph/unified', { params }),

  syncTaxonomy: () =>
    api.post<{ synced: boolean; concepts?: number; library_links?: number; reason?: string }>(
      '/api/rag/graph/sync-taxonomy',
    ),

  /** Run an arbitrary, read-only Cypher query and get back a graph and/or rows. */
  queryGraph: (query: string, params: Record<string, unknown> = {}, limit = 200) =>
    api.post<CypherQueryResult>('/api/rag/graph/query', { query, params, limit }),

  /** Reconcile the grounded-knowledge tool across every agent. */
  syncAgents: () =>
    api.post<{
      checked: number; attached: number; detached: number;
      unchanged: number; failed: number; skipped?: string;
    }>('/api/rag/agents/sync'),

  // ── Timeline ────────────────────────────────────────────────────────────
  traces: (params: { subject?: string; scope?: string; limit?: number } = {}) =>
    api.get<{ traces: TimelineTrace[] }>('/api/rag/timeline', { params }),

  trace: (traceId: string) =>
    api.get<{ trace_id: string; events: TimelineEvent[] }>(
      `/api/rag/timeline/${encodeURIComponent(traceId)}`,
    ),

  /**
   * SSE endpoint path — consume with EventSource, not axios.
   *
   * Emits `stage` per stage change, `ping` while idle, and `done` when nothing
   * is running any more. Each stage arrives twice: once when it opens and once
   * when it closes with its duration.
   */
  traceStreamUrl: (traceId: string) =>
    `/api/rag/timeline/${encodeURIComponent(traceId)}/stream`,
};
