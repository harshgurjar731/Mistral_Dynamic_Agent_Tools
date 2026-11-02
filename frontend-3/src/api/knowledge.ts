/**
 * Knowledge — build guidance and reference items, the sources they were
 * distilled from, the recommendation import, and the human review inbox.
 */
import { del, get, post, postForm, put } from "./client";

export type KnowledgeKind = "reference" | "guidance";
export type Strength = "must" | "should" | "may" | "avoid";
export type ItemStatus = "proposed" | "active" | "retired" | "conflicting";

export interface Condition {
  attr: string;
  op: "eq" | "ne" | "in" | "not_in" | "exists" | "contains";
  value?: unknown;
}

export interface KnowledgeItem {
  id: number;
  kind: KnowledgeKind;
  category: string;
  concept_id: string | null;
  title: string;
  body: string;
  tags: string[];
  audience: "builder" | "runtime" | "both";
  subject: "agent" | "workflow" | "both";
  strength: Strength | null;
  conditions: Condition[];
  effect: Record<string, unknown>;
  layers: string[];
  rationale: string;
  status: ItemStatus;
  confidence: "low" | "medium" | "high" | null;
  origin: string;
  source_id: number | null;
  source_ref: { page?: number | null; quote?: string; document_id?: string | null };
  as_of: string | null;
  stats: { used: number; accepted_builds: number; rolled_back_builds: number };
  has_embedding: boolean;
  /** Only on retrieval results. */
  score?: number;
  applies?: "true" | "unknown";
}

export type ItemInput = Partial<Omit<KnowledgeItem, "id" | "stats" | "has_embedding">> & {
  title: string;
  body: string;
};

export interface KnowledgeSource {
  id: number;
  title: string;
  source_type: "file" | "url" | "text" | "library_document";
  filename: string | null;
  url: string | null;
  library_id: string | null;
  document_id: string | null;
  concept_id: string | null;
  status: "pending" | "extracted" | "distilled" | "failed";
  message: string;
  item_count: number;
  version: number;
  text_chars: number;
  created_at: string | null;
}

export interface DistillResult {
  source_id: number;
  created: number;
  skipped_duplicates: number;
  embedded: number;
  duplicates: number;
  conflicts: number;
  notes: string[];
  item_ids: number[];
}

export interface KnowledgeVocabulary {
  kinds: KnowledgeKind[];
  reference_categories: string[];
  guidance_categories: string[];
  strengths: Strength[];
  audiences: string[];
  subjects: string[];
  statuses: ItemStatus[];
  category_views: Record<string, string[]>;
  condition_attributes: Record<string, string[]>;
  condition_ops: string[];
  effect_keys: Record<string, string[]>;
  default_mode: "auto" | "off";
  auto_approve: boolean;
}

export interface RetrieveResult {
  items: KnowledgeItem[];
  views: Record<string, number[]>;
  rendered: Record<string, string>;
  embedding_used: boolean;
}

export interface FeedbackRow {
  id: number;
  title: string;
  strength: Strength | null;
  status: ItemStatus;
  stats: KnowledgeItem["stats"];
  rationale: string;
}

export interface MissingAttribute {
  path: string;
  why: string;
}

export interface ImportedRecommendation {
  recommendation_id: string | null;
  title: string | null;
  l3: string | null;
  missing: MissingAttribute[];
  inferred: string[];
  domain_id?: string;
  path?: string[];
  concept_id?: string | null;
  document_id?: number | null;
  status?: string | null;
  issues?: { severity: string; code: string; path: string; message: string }[];
  candidates?: { concept_id: string; label: string; score: number }[];
}

export interface ImportReport {
  shape: "flat" | "structured";
  imported: ImportedRecommendation[];
  needs_domain: ImportedRecommendation[];
  errors: { recommendation_id: string | null; error: string }[];
  summary: string;
}

export interface HumanReview {
  id: number;
  execution_id: string;
  workflow_name: string | null;
  step_id: string;
  engine: "local" | "mistral" | "monitor";
  status: "pending" | "approved" | "edited" | "rejected" | "timed_out" | "escalated";
  title: string | null;
  instructions: string;
  reviewer_role: string | null;
  payload: unknown;
  editable: string[];
  comment: string;
  edits: Record<string, unknown>;
  decided_by: string | null;
  sla_seconds: number | null;
  created_at: string | null;
  decided_at: string | null;
}

export const knowledgeApi = {
  items: (params: { kind?: string; status?: string; category?: string; concept_id?: string; source_id?: number } = {}) =>
    get<{ items: KnowledgeItem[]; count: number }>("/api/knowledge/items", params),
  create: (body: ItemInput) => post<KnowledgeItem>("/api/knowledge/items", body),
  update: (id: number, body: Partial<ItemInput>) => put<KnowledgeItem>(`/api/knowledge/items/${id}`, body),
  remove: (id: number) => del<{ deleted: number }>(`/api/knowledge/items/${id}`),
  setStatus: (ids: number[], status: ItemStatus) =>
    post<{ updated: number }>("/api/knowledge/items/status", { ids, status }),
  counts: () =>
    get<{ counts: Partial<Record<KnowledgeKind, Partial<Record<ItemStatus, number>>>>; sources: number }>(
      "/api/knowledge/counts",
    ),
  vocabulary: () => get<KnowledgeVocabulary>("/api/knowledge/vocabulary"),
  sources: () => get<{ sources: KnowledgeSource[] }>("/api/knowledge/sources"),
  addSource: (input: { file?: File; url?: string; text?: string; title?: string; concept_id?: string }) => {
    const form = new FormData();
    if (input.file) form.append("file", input.file);
    if (input.url) form.append("url", input.url);
    if (input.text) form.append("text", input.text);
    if (input.title) form.append("title", input.title);
    if (input.concept_id) form.append("concept_id", input.concept_id);
    return postForm<{ source: KnowledgeSource; result: DistillResult }>("/api/knowledge/sources", form);
  },
  redistill: (id: number) => post<DistillResult>(`/api/knowledge/sources/${id}/distill`),
  removeSource: (id: number, items = true) =>
    del<{ deleted: boolean; items_removed: number }>(`/api/knowledge/sources/${id}`, { items }),
  retrieve: (body: { goal: string; concept_ids?: string[]; facts?: Record<string, unknown>; subject?: string; include_proposed?: boolean }) =>
    post<RetrieveResult>("/api/knowledge/retrieve", body),
  feedback: () => get<{ items: FeedbackRow[]; rollback_threshold: number }>("/api/knowledge/feedback"),
  embedMissing: () => post<{ embedded: number }>("/api/knowledge/embed"),
};

export const recommendationsApi = {
  import: (input: { file?: File; content?: string; domain_id?: string; save: boolean }) => {
    const form = new FormData();
    if (input.file) form.append("file", input.file);
    if (input.content) form.append("content", input.content);
    if (input.domain_id) form.append("domain_id", input.domain_id);
    form.append("save", input.save ? "true" : "false");
    return postForm<ImportReport>("/api/processes/recommendations/import", form);
  },
  missing: (document: Record<string, unknown>) =>
    post<{ missing: MissingAttribute[] }>("/api/processes/recommendations/missing", document),
};

export const reviewsApi = {
  list: (status: string | null = "pending") =>
    get<{ reviews: HumanReview[]; count: number }>("/api/reviews", status ? { status } : {}),
  get: (id: number) => get<HumanReview>(`/api/reviews/${id}`),
  decide: (id: number, body: { decision: "approve" | "edit" | "reject"; comment?: string; edits?: Record<string, unknown>; decided_by?: string }) =>
    post<HumanReview>(`/api/reviews/${id}/decision`, body),
};
