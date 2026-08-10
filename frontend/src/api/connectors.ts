import { api } from './client';

/**
 * Mistral Connectors — MCP servers registered with Mistral, which holds their
 * credentials and executes their tools.
 *
 * Distinct from `mcp.ts`, which drives the Docker Tool Service's own MCP
 * registry. The two registries share no state.
 */

/** Visibilities we can *set*. Directory connectors also report `shared_global`. */
export type ConnectorVisibility = 'shared_org' | 'shared_workspace' | 'private';
export type ConnectorScope = 'organization' | 'workspace' | 'user';

export interface Connector {
  id: string;
  name: string;
  title?: string;
  description: string;
  server?: string | null;
  icon_url?: string | null;
  system_prompt?: string | null;
  protocol: string;
  /** Read-side: the API also returns values we cannot set, e.g. `shared_global`. */
  visibility: ConnectorVisibility | string;
  /** Installed from the Mistral connector directory — read-only here. */
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

/** A connector attached to an agent, with an optional tool allow/deny list. */
export interface ConnectorRef {
  connector_id: string;
  include?: string[];
  exclude?: string[];
  requires_confirmation?: string[];
}

export interface ConnectorList {
  items: Connector[];
  count: number;
  next_cursor?: string | null;
}

export interface CreateConnectorBody {
  name: string;
  description: string;
  server: string;
  icon_url?: string;
  system_prompt?: string;
  visibility?: ConnectorVisibility;
  headers?: Record<string, string>;
  auth_data?: { client_id: string; client_secret: string };
}

export const connectorsApi = {
  list:   () => api.get<ConnectorList>('/api/connectors'),
  get:    (id: string) => api.get<Connector>(`/api/connectors/${id}`),
  create: (body: CreateConnectorBody) => api.post<Connector>('/api/connectors', body),
  update: (id: string, body: Partial<CreateConnectorBody>) =>
    api.patch<Connector>(`/api/connectors/${id}`, body),
  delete: (id: string) => api.delete(`/api/connectors/${id}`),

  tools: (id: string) =>
    api.get<{ tools: ConnectorTool[]; count: number }>(`/api/connectors/${id}/tools`),

  callTool: (id: string, tool: string, args: Record<string, unknown>, credentialsName?: string) =>
    api.post<{ result: unknown; output: unknown }>(
      `/api/connectors/${id}/tools/${tool}/call`,
      { arguments: args, credentials_name: credentialsName ?? null },
    ),

  /** Returns a short-lived OAuth URL — fetch on click, never cache. */
  authUrl: (id: string, credentialsName?: string) =>
    api.get<{ auth_url: string | null; ttl: number | null }>(
      `/api/connectors/${id}/auth-url`,
      { params: credentialsName ? { credentials_name: credentialsName } : {} },
    ),

  authMethods: (id: string) => api.get(`/api/connectors/${id}/authentication`),

  listCredentials: (id: string, scope: ConnectorScope = 'user') =>
    api.get<{ credentials: Record<string, unknown>[]; scope: string; count: number }>(
      `/api/connectors/${id}/credentials`, { params: { scope } },
    ),

  setCredentials: (
    id: string,
    body: { name: string; credentials: Record<string, string>; is_default?: boolean },
    scope: ConnectorScope = 'user',
  ) => api.post(`/api/connectors/${id}/credentials`, body, { params: { scope } }),

  deleteCredentials: (id: string, credentialsName?: string, scope: ConnectorScope = 'user') =>
    api.delete(`/api/connectors/${id}/credentials`, {
      params: { scope, ...(credentialsName ? { credentials_name: credentialsName } : {}) },
    }),

  setActivation: (
    id: string,
    body: {
      active: boolean;
      include?: string[];
      exclude?: string[];
      requires_confirmation?: string[];
      skip_confirmation?: string[];
    },
    scope: ConnectorScope = 'organization',
  ) => api.post(`/api/connectors/${id}/activation`, body, { params: { scope } }),
};
