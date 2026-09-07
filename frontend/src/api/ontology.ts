import { api } from './client';

/**
 * Ontology — the platform's controlled vocabulary.
 *
 * Taxonomy (schemes and concepts) drives faceting and planner scoping.
 * Annotations are the typed links from a resource to a concept; the validator
 * reasons over them.
 */

export type SchemeId = 'agent_tier' | 'domain' | 'capability' | 'data_class';

export type Predicate =
  | 'has_tier'
  | 'serves_domain'
  | 'handles_data_class'
  | 'requires_capability'
  | 'provides_capability'
  | 'egresses_to';

export type SubjectType = 'agent' | 'tool' | 'connector' | 'workflow' | 'library';

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
  /** Depth in the hierarchy, derived server-side from parent_id. */
  level?: number;
  /** For the domain scheme: industry | domain | subdomain. */
  level_name?: string;
}

/** A node in the knowledge graph. */
export interface GraphNode {
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
  /** Concepts only: resources at or below this node, by subject type. */
  rollup?: Record<string, number>;
  rollup_total?: number;
}

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  /** 'hierarchy', a `uses_*` composition kind, or an annotation predicate. */
  kind: string;
  label: string;
  source_of?: string;
  /**
   * Which end contains the other, for progressive disclosure.
   * 'forward' — source reveals target (hierarchy, composition).
   * 'reverse' — target reveals source (annotations point resource → concept).
   */
  reveal?: 'forward' | 'reverse';
}

export interface OntologyGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
  counts: Record<string, number>;
  totals: { nodes: number; edges: number; concepts: number; annotations: number };
  kinds: string[];
  predicates: string[];
  /** Present only on the scope-preview variant. */
  scoped?: boolean;
  label?: string;
  matched_domains?: string[];
  goal?: string;
}

export interface GraphFilters {
  kinds?: string[];
  scheme?: string;
  root_concept?: string;
  subject_type?: string;
  search?: string;
  include_orphans?: boolean;
  hops?: number;
}

export interface AnnotationRow {
  id: number;
  subject_type: string;
  subject_id: string;
  predicate: string;
  concept_id: string;
  source: string;
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
  /** When the content was last known good. Required on figures. */
  as_of?: string | null;
  source: string;
  /** Only present on search results. */
  score?: number;
}

export type RuleKind =
  | 'capability_gap'
  | 'egress'
  | 'guardrail'
  | 'library_domain'
  | 'cardinality'
  | 'derives_annotation';

export interface OntologyRule {
  id: string;
  kind: RuleKind | string;
  label: string;
  params: Record<string, unknown>;
  severity: string;
  message_template: string;
  status: 'draft' | 'approved' | 'superseded';
  source: 'seed' | 'user';
}

export interface RuleException {
  id: number;
  rule_id: string;
  subject_type: string;
  subject_id: string;
  reason: string;
  granted_by: string;
  expires_at: string | null;
}

export interface ConceptUsage {
  concept_id: string;
  children: string[];
  annotations: number;
  subjects: Array<{ subject_type: string; subject_id: string }>;
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

/** Annotations grouped by predicate. Absent predicate = nothing recorded. */
export type AnnotationMap = Partial<Record<Predicate, string[]>>;

export const ontologyApi = {
  overview: () => api.get<OntologyOverview>('/api/ontology'),

  /** The single source for tier selects — replaces hardcoded option lists. */
  tiers: () => api.get<{ tiers: TierOption[] }>('/api/ontology/tiers'),

  schemes: () => api.get<{ schemes: ConceptScheme[] }>('/api/ontology/schemes'),

  concepts: (scheme?: SchemeId | string) =>
    api.get<{ concepts: Concept[]; count: number }>('/api/ontology/concepts', {
      params: scheme ? { scheme } : {},
    }),

  annotations: (subjectType: SubjectType, subjectId: string) =>
    api.get<{ subject_type: string; subject_id: string; annotations: AnnotationMap }>(
      `/api/ontology/annotations/${subjectType}/${encodeURIComponent(subjectId)}`,
    ),

  /**
   * Annotations for many subjects in one round trip, keyed by subject id.
   * Subjects with nothing recorded come back as empty maps, not missing keys.
   */
  annotationsBulk: (subjectType: SubjectType, subjectIds: string[]) =>
    api.post<{ subject_type: string; annotations: Record<string, AnnotationMap> }>(
      '/api/ontology/annotations/bulk',
      { subject_type: subjectType, subject_ids: subjectIds },
    ),

  /** Replaces the whole set for one (subject, predicate) pair. */
  setAnnotations: (body: {
    subject_type: SubjectType;
    subject_id: string;
    predicate: Predicate;
    concept_ids: string[];
    source?: string;
  }) => api.put<{ status: string; annotations: AnnotationMap }>('/api/ontology/annotations', body),

  // ── Vocabulary CRUD ─────────────────────────────────────────────────────
  createScheme: (body: { id: string; label: string; description?: string }) =>
    api.post('/api/ontology/schemes', body),

  updateScheme: (id: string, body: { label?: string; description?: string }) =>
    api.patch(`/api/ontology/schemes/${id}`, body),

  deleteScheme: (id: string, cascade = false) =>
    api.delete(`/api/ontology/schemes/${id}`, { params: { cascade } }),

  createConcept: (body: {
    id: string;
    scheme_id: string;
    label: string;
    parent_id?: string | null;
    definition?: string;
    synonyms?: string[];
  }) => api.post<Concept>('/api/ontology/concepts', body),

  updateConcept: (
    id: string,
    body: {
      label?: string;
      parent_id?: string | null;
      definition?: string;
      synonyms?: string[];
      clear_parent?: boolean;
    },
  ) => api.patch<Concept>(`/api/ontology/concepts/${encodeURIComponent(id)}`, body),

  deleteConcept: (id: string, cascade = false) =>
    api.delete(`/api/ontology/concepts/${encodeURIComponent(id)}`, { params: { cascade } }),

  /** What a delete would take with it — children and annotations. */
  conceptUsage: (id: string) =>
    api.get<ConceptUsage>(`/api/ontology/concepts/${encodeURIComponent(id)}/usage`),

  // ── Annotation CRUD ─────────────────────────────────────────────────────
  listAnnotations: (
    params: {
      subject_type?: string;
      predicate?: string;
      concept_id?: string;
      source?: string;
      limit?: number;
    } = {},
  ) =>
    api.get<{ annotations: AnnotationRow[]; count: number }>(
      '/api/ontology/annotations',
      { params },
    ),

  addAnnotation: (body: {
    subject_type: SubjectType;
    subject_id: string;
    predicate: Predicate;
    concept_id: string;
    source?: string;
  }) => api.post('/api/ontology/annotations/one', body),

  removeAnnotation: (params: {
    subject_type: string;
    subject_id: string;
    predicate: string;
    concept_id: string;
  }) => api.delete('/api/ontology/annotations/one', { params }),

  clearSubject: (subjectType: SubjectType, subjectId: string) =>
    api.delete(`/api/ontology/annotations/${subjectType}/${encodeURIComponent(subjectId)}`),

  // ── Graph ───────────────────────────────────────────────────────────────
  graph: (filters: GraphFilters = {}) =>
    api.get<OntologyGraph>('/api/ontology/graph', {
      params: {
        ...filters,
        // The API takes one comma-separated value, not a repeated param.
        kinds: filters.kinds?.length ? filters.kinds.join(',') : undefined,
      },
    }),

  scopeGraph: (goal: string) =>
    api.get<OntologyGraph>('/api/ontology/scope/graph', { params: { goal } }),

  // ── Classification ──────────────────────────────────────────────────────
  /** Ask an LLM to classify a resource. Persists when subject_type + id given. */
  classify: (body: {
    name: string;
    description?: string;
    instructions?: string;
    subject_kind?: string;
    subject_type?: SubjectType;
    subject_id?: string;
  }) =>
    api.post<{
      classified: boolean;
      result?: ClassificationResult;
      written?: Record<string, string[]>;
      detail?: string;
    }>('/api/ontology/classify', body),

  // ── Industry knowledge ──────────────────────────────────────────────────
  knowledge: (params: { concept_id?: string; kind?: string; limit?: number } = {}) =>
    api.get<{ entries: KnowledgeEntry[]; count: number; kinds: string[] }>(
      '/api/ontology/knowledge', { params },
    ),

  /** Rehearses exactly what the agent tool would retrieve. */
  searchKnowledge: (params: {
    query: string; domains?: string; kind?: string; limit?: number;
  }) =>
    api.get<{
      query: string;
      domains: string[];
      results: KnowledgeEntry[];
      count: number;
      rendered: string;
    }>('/api/ontology/knowledge/search', { params }),

  createKnowledge: (body: {
    concept_id: string; title: string; body: string; kind?: string; tags?: string[];
  }) => api.post<KnowledgeEntry>('/api/ontology/knowledge', body),

  deleteKnowledge: (id: number) => api.delete(`/api/ontology/knowledge/${id}`),

  /** What one specific agent would retrieve — its own scoping, shown. */
  knowledgeForAgent: (agentId: string, query = '') =>
    api.get<{
      agent_id: string; domains: string[]; scoped: boolean;
      results: KnowledgeEntry[]; count: number;
    }>(`/api/ontology/knowledge/agent/${encodeURIComponent(agentId)}`, { params: { query } }),

  /**
   * Reconcile every agent against knowledge coverage: attach where a lookup
   * would return something, detach where it would not. Idempotent both ways.
   */
  attachKnowledgeTool: () =>
    api.post<{
      checked: number; attached: number; detached: number;
      unchanged: number; failed: number;
    }>('/api/ontology/knowledge/attach-tool'),

  // ── Rules ───────────────────────────────────────────────────────────────
  rules: (status?: string) =>
    api.get<{ rules: OntologyRule[]; count: number }>('/api/ontology/rules', {
      params: status ? { status } : {},
    }),

  createRule: (body: {
    id: string;
    kind: RuleKind | string;
    label: string;
    params?: Record<string, unknown>;
    severity?: string;
    message_template?: string;
    status?: string;
  }) => api.post<OntologyRule>('/api/ontology/rules', body),

  updateRule: (
    id: string,
    body: {
      label?: string;
      params?: Record<string, unknown>;
      severity?: string;
      message_template?: string;
    },
  ) => api.patch<OntologyRule>(`/api/ontology/rules/${encodeURIComponent(id)}`, body),

  approveRule: (id: string) =>
    api.post<OntologyRule>(`/api/ontology/rules/${encodeURIComponent(id)}/approve`),

  deleteRule: (id: string) => api.delete(`/api/ontology/rules/${encodeURIComponent(id)}`),

  ruleExceptions: (ruleId: string) =>
    api.get<{ rule_id: string; exceptions: RuleException[] }>(
      `/api/ontology/rules/${encodeURIComponent(ruleId)}/exceptions`,
    ),

  addRuleException: (
    ruleId: string,
    body: { subject_type: string; subject_id: string; reason: string; granted_by: string; expires_at?: string },
  ) => api.post<RuleException>(`/api/ontology/rules/${encodeURIComponent(ruleId)}/exceptions`, body),

  removeRuleException: (exceptionId: number) =>
    api.delete(`/api/ontology/rules/exceptions/${exceptionId}`),

  /** What a goal would be narrowed to. Useful for explaining planner behaviour. */
  scope: (goal: string) =>
    api.get<{
      goal: string;
      scoped: boolean;
      domains: string[];
      label: string;
      concepts: string[];
      scores: [string, number][];
    }>('/api/ontology/scope', { params: { goal } }),
};

/** Human labels for the predicates, used in the annotation editor. */
export const PREDICATE_LABELS: Record<Predicate, string> = {
  has_tier: 'Tier',
  serves_domain: 'Serves domain',
  handles_data_class: 'Handles data',
  requires_capability: 'Requires capability',
  provides_capability: 'Provides capability',
  egresses_to: 'Sends data to',
};

/** Which scheme supplies the concepts for each predicate. */
export const PREDICATE_SCHEME: Record<Predicate, SchemeId> = {
  has_tier: 'agent_tier',
  serves_domain: 'domain',
  handles_data_class: 'data_class',
  requires_capability: 'capability',
  provides_capability: 'capability',
  egresses_to: 'data_class',
};
