import { del, get, patch, post, put } from "./client";

/* ── Types ─────────────────────────────────────────────────────────────── */

export interface WorkspaceMembershipSummary {
  id: string;
  name: string;
  description: string;
  role_id: string;
  role_name: string;
  key_status: KeyStatus;
  active: boolean;
}

export interface AccountFlags {
  must_change_password?: boolean;
  last_login_at?: string | null;
  password_changed_at?: string | null;
  created_at?: string | null;
}

export interface SessionUser extends AccountFlags {
  id: string;
  email: string;
  name: string;
  workspace: { id: string; name: string; role_id: string | null; role_name: string | null };
  permissions: string[];
  workspaces: WorkspaceMembershipSummary[];
}

export interface SessionAdmin extends AccountFlags {
  id: string;
  email: string;
  name: string;
}

export interface AuthSessionState {
  user: SessionUser | null;
  admin: SessionAdmin | null;
}

export interface BrowserSession {
  id: string;
  current: boolean;
  created_at: string | null;
  last_seen_at: string | null;
  expires_at: string | null;
  ip: string | null;
  user_agent: string | null;
  workspace_name?: string | null;
}

export interface LinkInfo {
  kind: "invite" | "reset";
  account: "user" | "admin";
  email: string;
  name: string;
  expires_at: string;
  workspaces: { name: string; role: string }[];
}

export interface IssuedLink {
  kind: "invite" | "reset";
  path: string;
  token: string;
  expires_at: string;
}

export type KeyStatus = "valid" | "invalid" | "unchecked";

export type WorkerState = "running" | "starting" | "crashed" | "stopped" | "idle";

/** The workspace's Mistral Workflows worker (one process per workspace). */
export interface WorkspaceWorker {
  enabled: boolean;
  stale: boolean;
  state: WorkerState;
  deployment: string;
  published_workflows: number;
  pid?: number | null;
  started_at?: number | null;
  restarts?: number;
  last_error?: string | null;
  updated_at?: number | null;
}

export interface Workspace {
  id: string;
  name: string;
  description: string;
  key_source: "platform" | "stored";
  key_hint: string | null;
  key_status: KeyStatus;
  key_checked_at: string | null;
  key_error: string | null;
  key_rotated_at: string | null;
  is_default: boolean;
  disabled: boolean;
  members: number;
  created_by: string | null;
  created_at: string | null;
  updated_at: string | null;
  /** Rows the workspace owns, per table (detail only). */
  data?: Record<string, number>;
  same_mistral_workspace?: boolean | null;
  worker?: WorkspaceWorker;
}

export interface WorkspaceMember {
  user_id: string;
  name: string;
  email: string;
  status: UserStatus;
  role_id: string;
  role_name: string;
  since: string | null;
}

export type UserStatus = "invited" | "active" | "disabled" | "deleted";

export interface UserMembership {
  workspace_id: string;
  workspace_name: string;
  workspace_disabled: boolean;
  role_id: string;
  role_name: string;
}

export interface AuditEvent {
  id: number;
  at: string | null;
  actor_kind: string | null;
  actor_id: string | null;
  actor_email: string | null;
  action: string;
  target_type: string | null;
  target_id: string | null;
  workspace_id: string | null;
  outcome: "ok" | "denied" | "failed";
  detail: Record<string, unknown> | null;
  ip: string | null;
}

export interface PlatformUser {
  id: string;
  email: string;
  name: string;
  status: UserStatus;
  locked: boolean;
  must_change_password: boolean;
  last_login_at: string | null;
  created_at: string | null;
  created_by: string | null;
  memberships: UserMembership[];
  active_sessions?: number;
  pending_link?: { kind: "invite" | "reset"; expires_at: string } | null;
  password_changed_at?: string | null;
  link?: IssuedLink;
  activity?: AuditEvent[];
}

export interface Role {
  id: string;
  name: string;
  description: string;
  permissions: string[];
  system: boolean;
  system_key: string | null;
  members: number;
  created_at: string | null;
  updated_at: string | null;
}

export interface PermissionDef {
  key: string;
  group: string;
  label: string;
  description: string;
  shared: boolean;
}

export interface AdminAccount {
  id: string;
  email: string;
  name: string;
  status: "invited" | "active" | "disabled";
  locked: boolean;
  must_change_password: boolean;
  last_login_at: string | null;
  created_at: string | null;
  created_by: string | null;
  active_sessions: number;
  link?: IssuedLink;
}

export interface AdminOverview {
  users: { total: number; active: number; invited: number; disabled: number };
  workspaces: {
    total: number;
    disabled: number;
    key_problems: { id: string; name: string; status: KeyStatus; error: string | null }[];
  };
  roles: number;
  admins: number;
  active_sessions: number;
  last_24h: { sign_ins: number; failed_sign_ins: number };
  recent: AuditEvent[];
}

export interface MembershipInput {
  workspace_id: string;
  role_id: string;
}

/* ── System status / health ────────────────────────────────────────────── */

export type SystemVerdict = "operational" | "degraded" | "outage";
export type ComponentState = "ok" | "degraded" | "down" | "off";

export interface StatusComponent {
  key: string;
  name: string;
  state: ComponentState;
  message: string;
  impact: string | null;
}

/** What a signed-in user sees: no internals. */
export interface SystemStatus {
  status: SystemVerdict;
  headline: string;
  checked_at: number;
  components: StatusComponent[];
  issues: StatusComponent[];
}

export interface HealthComponent extends StatusComponent {
  severity: "critical" | "major" | "minor";
  latency_ms: number | null;
  details: Record<string, unknown>;
}

export interface HealthWorkspaceRow {
  id: string;
  name: string;
  disabled: boolean;
  is_default: boolean;
  members: number;
  key_status: KeyStatus;
  key_checked_at: string | null;
  key_error: string | null;
  worker: {
    state: WorkerState;
    published_workflows: number;
    deployment: string;
    restarts: number;
    last_error: string | null;
  };
}

export interface SystemHealth {
  status: SystemVerdict;
  headline: string;
  checked_at: number;
  environment: string;
  components: HealthComponent[];
  workspaces: HealthWorkspaceRow[];
}

export const statusApi = {
  get: () => get<SystemStatus>("/api/status"),
};

/* ── Signed-in user ────────────────────────────────────────────────────── */

export const authApi = {
  session: () => get<AuthSessionState>("/api/auth/session"),
  login: (email: string, password: string) =>
    post<{ ok: true; must_change_password: boolean }>("/api/auth/login", { email, password }),
  logout: () => post<{ ok: true }>("/api/auth/logout"),
  logoutAll: () => post<{ ok: true; sessions_ended: number }>("/api/auth/logout-all"),
  switchWorkspace: (workspace_id: string) =>
    post<SessionUser>("/api/auth/workspace", { workspace_id }),
  changePassword: (current_password: string, new_password: string) =>
    post<{ ok: true }>("/api/auth/password", { current_password, new_password }),
  updateProfile: (name: string) => patch<{ name: string }>("/api/auth/profile", { name }),
  sessions: () => get<{ sessions: BrowserSession[] }>("/api/auth/sessions"),
  revokeSession: (id: string) => del<{ ok: true }>(`/api/auth/sessions/${encodeURIComponent(id)}`),
  linkInfo: (token: string) => get<LinkInfo>(`/api/auth/links/${encodeURIComponent(token)}`),
  acceptLink: (token: string, password: string, name?: string) =>
    post<{ ok: true; account: "user" | "admin" }>(`/api/auth/links/${encodeURIComponent(token)}`, {
      password,
      name,
    }),
};

/* ── Admin portal ──────────────────────────────────────────────────────── */

const A = "/api/admin";
const enc = encodeURIComponent;

export const adminApi = {
  login: (email: string, password: string) =>
    post<{ ok: true; must_change_password: boolean }>(`${A}/auth/login`, { email, password }),
  logout: () => post<{ ok: true }>(`${A}/auth/logout`),
  me: () => get<SessionAdmin>(`${A}/auth/me`),
  changePassword: (current_password: string, new_password: string) =>
    post<{ ok: true }>(`${A}/auth/password`, { current_password, new_password }),
  sessions: () => get<{ sessions: BrowserSession[] }>(`${A}/auth/sessions`),
  revokeSession: (id: string) => del<{ ok: true }>(`${A}/auth/sessions/${enc(id)}`),

  overview: () => get<AdminOverview>(`${A}/overview`),
  permissions: () =>
    get<{ permissions: PermissionDef[]; system_roles: { key: string; name: string }[] }>(
      `${A}/permissions`,
    ),

  workspaces: () => get<{ workspaces: Workspace[] }>(`${A}/workspaces`),
  workspace: (id: string) => get<Workspace>(`${A}/workspaces/${enc(id)}`),
  checkKey: (api_key: string) =>
    post<{ ok: true; status: string; message: string; models: number }>(
      `${A}/workspaces/check-key`,
      { api_key },
    ),
  createWorkspace: (body: { name: string; api_key: string; description?: string }) =>
    post<Workspace>(`${A}/workspaces`, body),
  updateWorkspace: (
    id: string,
    body: { name?: string; description?: string; disabled?: boolean },
  ) => patch<Workspace>(`${A}/workspaces/${enc(id)}`, body),
  deleteWorkspace: (id: string) => del<{ deleted: string }>(`${A}/workspaces/${enc(id)}`),
  recheckKey: (id: string) => post<Workspace>(`${A}/workspaces/${enc(id)}/check`),
  rotateKey: (id: string, api_key: string, allow_other_workspace = false) =>
    post<Workspace>(`${A}/workspaces/${enc(id)}/rotate-key`, { api_key, allow_other_workspace }),
  workspaceMembers: (id: string) =>
    get<{ members: WorkspaceMember[] }>(`${A}/workspaces/${enc(id)}/members`),

  users: (params?: {
    q?: string | undefined;
    workspace_id?: string | undefined;
    status?: string | undefined;
  }) => get<{ users: PlatformUser[] }>(`${A}/users`, params),
  user: (id: string) => get<PlatformUser>(`${A}/users/${enc(id)}`),
  createUser: (body: { email: string; name: string; memberships: MembershipInput[] }) =>
    post<PlatformUser>(`${A}/users`, body),
  updateUser: (id: string, body: { name?: string; email?: string }) =>
    patch<PlatformUser>(`${A}/users/${enc(id)}`, body),
  setMemberships: (id: string, memberships: MembershipInput[]) =>
    put<PlatformUser>(`${A}/users/${enc(id)}/memberships`, { memberships }),
  userLink: (id: string) => post<IssuedLink>(`${A}/users/${enc(id)}/link`),
  disableUser: (id: string) => post<PlatformUser>(`${A}/users/${enc(id)}/disable`),
  enableUser: (id: string) => post<PlatformUser>(`${A}/users/${enc(id)}/enable`),
  unlockUser: (id: string) => post<PlatformUser>(`${A}/users/${enc(id)}/unlock`),
  revokeUserSessions: (id: string) =>
    post<{ sessions_ended: number }>(`${A}/users/${enc(id)}/sessions/revoke`),
  deleteUser: (id: string) =>
    del<{ deleted: string; mode: "removed" | "anonymised" }>(`${A}/users/${enc(id)}`),

  roles: () => get<{ roles: Role[] }>(`${A}/roles`),
  role: (id: string) => get<Role>(`${A}/roles/${enc(id)}`),
  createRole: (body: { name: string; description?: string; permissions: string[] }) =>
    post<Role>(`${A}/roles`, body),
  updateRole: (id: string, body: { name?: string; description?: string; permissions?: string[] }) =>
    patch<Role>(`${A}/roles/${enc(id)}`, body),
  deleteRole: (id: string, reassign_to?: string) =>
    del<{ deleted: string; moved: number }>(
      `${A}/roles/${enc(id)}`,
      reassign_to ? { reassign_to } : undefined,
    ),

  admins: () => get<{ admins: AdminAccount[]; me: string }>(`${A}/admins`),
  createAdmin: (body: { email: string; name: string }) => post<AdminAccount>(`${A}/admins`, body),
  updateAdmin: (id: string, body: { name?: string; disabled?: boolean }) =>
    patch<AdminAccount>(`${A}/admins/${enc(id)}`, body),
  adminLink: (id: string) => post<IssuedLink>(`${A}/admins/${enc(id)}/link`),
  deleteAdmin: (id: string) => del<{ deleted: string }>(`${A}/admins/${enc(id)}`),

  health: (refresh = false) =>
    get<SystemHealth>(`${A}/health`, refresh ? { refresh: true } : undefined),

  audit: (params?: {
    limit?: number | undefined;
    offset?: number | undefined;
    action?: string | undefined;
    actor?: string | undefined;
    workspace_id?: string | undefined;
  }) => get<{ total: number; events: AuditEvent[] }>(`${A}/audit`, params),
};

export const authKeys = {
  session: () => ["auth", "session"] as const,
  status: () => ["system", "status"] as const,
  sessions: () => ["auth", "sessions"] as const,
  link: (token: string) => ["auth", "link", token] as const,
  admin: {
    overview: () => ["admin", "overview"] as const,
    permissions: () => ["admin", "permissions"] as const,
    workspaces: () => ["admin", "workspaces"] as const,
    workspace: (id: string) => ["admin", "workspaces", id] as const,
    members: (id: string) => ["admin", "workspaces", id, "members"] as const,
    users: (params?: object) => ["admin", "users", params ?? {}] as const,
    user: (id: string) => ["admin", "user", id] as const,
    roles: () => ["admin", "roles"] as const,
    role: (id: string) => ["admin", "roles", id] as const,
    admins: () => ["admin", "admins"] as const,
    audit: (params?: object) => ["admin", "audit", params ?? {}] as const,
    sessions: () => ["admin", "sessions"] as const,
    health: () => ["admin", "health"] as const,
  },
};
