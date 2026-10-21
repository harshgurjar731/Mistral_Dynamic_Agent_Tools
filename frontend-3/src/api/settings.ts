import { get, post, put } from "./client";

export type SettingTarget = "backend" | "tool_service";
export type SettingType =
  "string" | "int" | "float" | "bool" | "enum" | "model" | "model_list" | "secret";
export type SettingValue = string | number | boolean | string[] | null;

export interface ModelStatus {
  status: "ok" | "unchecked" | "unknown" | "deprecated" | "retired" | "incapable";
  message: string;
  replacement?: string | null;
  deprecation?: string | null;
}

export interface SettingItem {
  key: string;
  target: SettingTarget;
  section: string;
  label: string;
  description: string;
  type: SettingType;
  value: SettingValue;
  is_set: boolean;
  /** The value without a Settings-page override: .env, else built-in. */
  default: SettingValue;
  builtin_default: SettingValue;
  source: "override" | "env" | "default";
  apply: "live" | "restart";
  restart_pending: boolean;
  editable: boolean;
  used_in: string[];
  /** Plain-language areas of the product a change affects. */
  impact: string[];
  options: string[];
  option_labels: Record<string, string>;
  unit: string | null;
  min: number | null;
  max: number | null;
  capability: string | null;
  group: string | null;
  allow_none: boolean;
  model_status?: Record<string, ModelStatus>;
}

export interface SettingsSection {
  id: string;
  title: string;
  description: string;
  icon: string;
  category: "models" | "tool_service" | "platform" | "frontend" | string;
  target: SettingTarget;
  settings: SettingItem[];
}

export interface CatalogMeta {
  fetched_at: number | null;
  source: string | null;
  model_count: number;
  error: string | null;
  error_at?: number | null;
  refresh_hours: number;
}

export interface SettingsPayload {
  sections: SettingsSection[];
  tool_service: { reachable: boolean; error: string | null; url: string };
  catalog: CatalogMeta;
  restart_pending: boolean;
}

export interface CatalogModel {
  id: string;
  name: string | null;
  description: string | null;
  type: string;
  owned_by: string | null;
  created: number | null;
  max_context_length: number | null;
  aliases: string[];
  deprecation: string | null;
  deprecation_replacement_model: string | null;
  default_model_temperature: number | null;
  capabilities: Record<string, boolean>;
}

export interface CatalogIssue {
  target: SettingTarget;
  key: string;
  label: string;
  model: string;
  status: ModelStatus["status"];
  message: string;
  replacement?: string | null;
}

export interface RefreshReport {
  issues: CatalogIssue[];
  upgraded: { target: SettingTarget; key: string; model: string }[];
  fetched_at: number;
  model_count: number;
  added: string[];
  removed: string[];
}

export interface PublicConfig {
  models: {
    default_agent_model: string;
    chat_default_model: string;
    orchestrator_model: string;
    tiers: { large: string; medium: string; small: string };
    choices: { value: string; label: string }[];
    /** Every model the account can call. */
    catalog: SlimModel[];
  };
  /** The frontend's own settings (UI_*). */
  ui: Record<string, SettingValue>;
  catalog: CatalogMeta;
}

export interface SlimModel {
  id: string;
  aliases: string[];
  max_context_length: number | null;
  deprecation: string | null;
  capabilities: Record<string, boolean>;
}

export type SettingsChanges = Partial<Record<SettingTarget, Record<string, SettingValue>>>;

export const settingsApi = {
  get: () => get<SettingsPayload>("/api/settings"),
  update: (changes: SettingsChanges) =>
    put<SettingsPayload & { changed: Record<SettingTarget, string[]> }>("/api/settings", changes),
  reset: (body: { target?: SettingTarget; section?: string; keys?: string[] }) =>
    post<SettingsPayload & { reset: Record<SettingTarget, string[]> }>("/api/settings/reset", body),
  catalog: () => get<CatalogMeta & { models: CatalogModel[] }>("/api/settings/models/catalog"),
  refreshModels: () =>
    post<{ report: RefreshReport; catalog: CatalogMeta }>("/api/settings/models/refresh"),
  reviewModels: (apply: boolean) =>
    post<{ issues: CatalogIssue[]; upgraded: RefreshReport["upgraded"] }>(
      `/api/settings/models/review?apply=${apply}`,
    ),
  public: () => get<PublicConfig>("/api/settings/public"),
};
