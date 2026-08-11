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

  /** Replaces the whole set for one (subject, predicate) pair. */
  setAnnotations: (body: {
    subject_type: SubjectType;
    subject_id: string;
    predicate: Predicate;
    concept_ids: string[];
    source?: string;
  }) => api.put<{ status: string; annotations: AnnotationMap }>('/api/ontology/annotations', body),

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
