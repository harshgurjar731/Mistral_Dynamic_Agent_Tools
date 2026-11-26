/**
 * Industry knowledge — reviewed facts filed on the industry › domain › subdomain
 * tree, read while agents and workflows are planned and while their tools and
 * activities are generated. Never searched by agents at run time.
 */
import { del, get, post, postForm, put } from "./client";
import type { ItemStatus, KnowledgeItem } from "./knowledge";

export type IndustryCategory =
  "regulation" | "standard" | "business_rule" | "metric" | "risk" | "process" | "definition";

/** Stored as `strength`: must = mandatory, avoid = prohibited, should = recommended, may = info. */
export type IndustryForce = "must" | "avoid" | "should" | "may";

export type IndustryRelation = "exact" | "inherited" | "narrower";

export interface IndustryItem extends KnowledgeItem {
  category: IndustryCategory;
  jurisdiction: string | null;
  /** "BFSI › Lending › Mortgage". */
  path?: string;
  level?: "industry" | "domain" | "subdomain" | "";
  /** How it relates to the selected node: filed on it, above it, or below it. */
  relation?: IndustryRelation;
}

export interface IndustryNode {
  id: string;
  label: string;
  parent_id: string | null;
  definition: string;
  level: "industry" | "domain" | "subdomain";
  counts: {
    active: number;
    proposed: number;
    conflicting: number;
    retired: number;
    /** Approved items filed anywhere below. */
    below: number;
  };
}

export interface IndustryConfig {
  mode: "auto" | "off";
  pack_size: number;
  view_size: number;
  include_narrower: boolean;
  jurisdictions: string[];
  in_codegen: boolean;
  code_items: number;
  auto_approve: boolean;
  source_max_mb: number;
  max_excerpts: number;
  categories: { id: IndustryCategory; label: string; views: string[] }[];
  forces: { id: IndustryForce; label: string }[];
  statuses: ItemStatus[];
  what_to_upload: {
    accepted: { kind: string; examples: string }[];
    elsewhere: { kind: string; page: string | null }[];
    formats: string[];
  };
}

export interface IndustrySource {
  id: number;
  title: string;
  source_type: "file" | "url" | "text";
  filename: string | null;
  url: string | null;
  concept_id: string | null;
  path: string;
  status: "pending" | "extracted" | "distilled" | "failed";
  message: string;
  item_count: number;
  text_chars: number;
  created_at: string | null;
}

export interface IndustryDistillResult {
  source_id: number;
  document_type: string;
  created: number;
  skipped_duplicates: number;
  duplicates: number;
  embedded: number;
  notes: string[];
  item_ids: number[];
}

export interface IndustryCodeItem {
  ref: string;
  title: string;
  category: IndustryCategory;
  force: string;
  jurisdiction: string;
  as_of: string | null;
  path: string;
  body: string;
}

export interface IndustryPreview {
  domains: { id: string; path: string }[];
  scope_source: string;
  items: (IndustryItem & { score: number })[];
  views: Record<string, number[]>;
  rendered: Record<string, string>;
  code_items: IndustryCodeItem[];
  code_rendered: string;
  embedding_used: boolean;
  mode: "auto" | "off";
}

export interface IndustryUsageRow {
  subject_type: string;
  subject_id: string;
  subject_name: string;
  layer: string;
  element: string;
  how: string;
  created_at?: string | null;
}

export type IndustryItemInput = {
  concept_id: string;
  category: IndustryCategory;
  title: string;
  body: string;
  strength: IndustryForce | null;
  jurisdiction: string;
  as_of: string | null;
  tags: string[];
  status?: ItemStatus;
};

const B = "/api/industry-knowledge";

export const industryApi = {
  config: () => get<IndustryConfig>(`${B}/config`),
  tree: () =>
    get<{ nodes: IndustryNode[]; totals: Record<ItemStatus, number>; sources: number }>(
      `${B}/tree`,
    ),
  items: (params: {
    concept_id?: string;
    inherit?: boolean;
    below?: boolean;
    status?: string;
    category?: string;
    source_id?: number;
    q?: string;
  }) => get<{ items: IndustryItem[]; count: number }>(`${B}/items`, params),
  create: (body: IndustryItemInput) => post<IndustryItem>(`${B}/items`, body),
  update: (id: number, body: Partial<IndustryItemInput>) =>
    put<IndustryItem>(`${B}/items/${id}`, body),
  remove: (id: number) => del<{ deleted: number }>(`${B}/items/${id}`),
  setStatus: (ids: number[], status: ItemStatus) =>
    post<{ updated: number }>(`${B}/items/status`, { ids, status }),
  usage: (id: number) =>
    get<{ item: IndustryItem; usage: IndustryUsageRow[]; count: number }>(`${B}/items/${id}/usage`),
  sources: () => get<{ sources: IndustrySource[] }>(`${B}/sources`),
  addSource: (input: {
    concept_id: string;
    file?: File;
    url?: string;
    text?: string;
    title?: string;
    jurisdiction?: string;
  }) => {
    const form = new FormData();
    form.append("concept_id", input.concept_id);
    if (input.file) form.append("file", input.file);
    if (input.url) form.append("url", input.url);
    if (input.text) form.append("text", input.text);
    if (input.title) form.append("title", input.title);
    form.append("jurisdiction", input.jurisdiction || "global");
    return postForm<{ source: IndustrySource; result: IndustryDistillResult }>(
      `${B}/sources`,
      form,
    );
  },
  redistill: (id: number) => post<IndustryDistillResult>(`${B}/sources/${id}/distill`),
  removeSource: (id: number, items = true) =>
    del<{ deleted: boolean; items_removed: number }>(`${B}/sources/${id}`, { items }),
  preview: (body: {
    goal: string;
    concept_ids?: string[];
    include_proposed?: boolean;
    code_purpose?: string;
  }) => post<IndustryPreview>(`${B}/preview`, body),
  templateUrl: (format: "json" | "yaml" | "csv") => `${B}/template?format=${format}`,
};
