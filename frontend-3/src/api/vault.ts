/**
 * Vault — Settings → Vault, and the build prerequisites dialog.
 *
 * Values go in and never come back out: every read returns a hint ("••••3f9a")
 * instead, except a non-sensitive value (a URL, a region) and an explicit,
 * audited reveal when the Settings page allows it.
 */
import { del, get, patch, post, put } from "./client";

export type VaultKind =
  | "api_key"
  | "token"
  | "password"
  | "username"
  | "url"
  | "connection_string"
  | "client_id"
  | "client_secret"
  | "certificate"
  | "config"
  | "other";

export type VaultStatus = "active" | "expired" | "disabled";
export type VaultFlag = "expiring_soon" | "rotation_due" | "old_key";

export interface VaultSecret {
  id: string;
  /** What code reads: `kwargs["_secrets"]["OPENWEATHER_API_KEY"]`. */
  name: string;
  label: string;
  kind: VaultKind;
  kind_label: string;
  service: string;
  description: string;
  sensitive: boolean;
  tags: string[];
  /** Tool / activity names allowed to receive it; empty = any. `prefix_*` matches a prefix. */
  allowed_consumers: string[];
  hint: string;
  version: number;
  status: VaultStatus;
  flags: VaultFlag[];
  usable: boolean;
  disabled: boolean;
  expires_at: string | null;
  value_changed_at: string | null;
  last_used_at: string | null;
  last_used_by: string | null;
  use_count: number;
  origin: "settings" | "build" | "connector" | "import";
  origin_ref: string | null;
  created_at: string | null;
  updated_at: string | null;
  /** Only on a single-entry read. */
  used_by?: string[];
}

export interface VaultKindInfo {
  key: VaultKind;
  label: string;
  sensitive: boolean;
  placeholder: string;
}

export interface VaultOverview {
  secrets: VaultSecret[];
  kinds: VaultKindInfo[];
  summary: {
    total: number;
    active: number;
    expired: number;
    disabled: number;
    attention: number;
    on_old_key: number;
  };
  key: {
    source: "environment" | "file";
    primary_key_id: string;
    key_ids: string[];
    key_file: string | null;
    on_old_key: number;
  };
  enabled: boolean;
  allow_reveal: boolean;
  admin_token_required: boolean;
  env_fallback: boolean;
}

export interface VaultSecretInput {
  name: string;
  value: string;
  label?: string;
  kind?: VaultKind;
  service?: string;
  description?: string;
  sensitive?: boolean;
  tags?: string[];
  allowed_consumers?: string[];
  expires_at?: string | null;
  origin?: "settings" | "build" | "connector";
  origin_ref?: string | null;
}

export interface VaultSecretUpdate {
  label?: string;
  service?: string;
  description?: string;
  sensitive?: boolean;
  tags?: string[];
  allowed_consumers?: string[];
  expires_at?: string | null;
  clear_expiry?: boolean;
  disabled?: boolean;
}

export interface VaultVersion {
  version: number;
  hint: string;
  current: boolean;
  created_at: string | null;
}

export interface VaultAuditEvent {
  id: number;
  at: string | null;
  action: string;
  secret_id: string | null;
  secret_name: string | null;
  actor: string;
  consumer: string | null;
  outcome: "ok" | "denied" | "error";
  detail: string;
}

export interface VaultCandidate {
  id: string;
  name: string;
  label: string;
  service: string;
  kind: VaultKind;
  usable: boolean;
  status: VaultStatus;
  hint: string;
  score: number;
}

const enc = encodeURIComponent;

export const vaultApi = {
  overview: () => get<VaultOverview>("/api/vault"),
  get: (ref: string) => get<VaultSecret>(`/api/vault/secrets/${enc(ref)}`),
  create: (body: VaultSecretInput) => post<VaultSecret>("/api/vault/secrets", body),
  update: (ref: string, body: VaultSecretUpdate) =>
    patch<VaultSecret>(`/api/vault/secrets/${enc(ref)}`, body),
  setValue: (ref: string, value: string) =>
    put<VaultSecret>(`/api/vault/secrets/${enc(ref)}/value`, { value }),
  reveal: (ref: string) =>
    post<{ id: string; name: string; value: string }>(`/api/vault/secrets/${enc(ref)}/reveal`),
  versions: (ref: string) =>
    get<{ versions: VaultVersion[] }>(`/api/vault/secrets/${enc(ref)}/versions`),
  rollback: (ref: string, version: number) =>
    post<VaultSecret>(`/api/vault/secrets/${enc(ref)}/rollback`, { version }),
  remove: (ref: string) =>
    del<{ deleted: { id: string; name: string } }>(`/api/vault/secrets/${enc(ref)}`),
  audit: (params: { secret_id?: string; action?: string; limit?: number } = {}) =>
    get<{ events: VaultAuditEvent[] }>("/api/vault/audit", params),
  candidates: (params: { name?: string; service?: string; label?: string; kind?: string }) =>
    get<{ candidates: VaultCandidate[] }>("/api/vault/candidates", params),
  rotateKey: () =>
    post<{ re_encrypted: number; unreadable: string[]; primary_key_id: string }>(
      "/api/vault/rotate-key",
    ),
  generateKey: () => post<{ key: string; instructions: string[] }>("/api/vault/generate-key"),
};

const TOKEN_KEY = "vault_admin_token";

/** The vault admin token for this tab (sessionStorage; gone when the tab closes). */
export const vaultToken = {
  get(): string | null {
    try {
      return window.sessionStorage.getItem(TOKEN_KEY);
    } catch {
      return null;
    }
  },
  set(token: string | null) {
    try {
      if (token) window.sessionStorage.setItem(TOKEN_KEY, token);
      else window.sessionStorage.removeItem(TOKEN_KEY);
    } catch {
      /* private mode: the token simply is not remembered */
    }
  },
};

/** `OpenWeather api-key` → `OPENWEATHER_API_KEY`, as the backend normalises names. */
export function normaliseVaultName(text: string): string {
  let value = text
    .trim()
    .replace(/[^A-Za-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toUpperCase();
  if (value && !/^[A-Z]/.test(value)) value = `S_${value}`;
  return value.slice(0, 64);
}

export const VAULT_NAME_RE = /^[A-Z][A-Z0-9_]{1,63}$/;
