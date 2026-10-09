import { del, get, post, put } from "./client";

/* ── Remote servers — deployment targets for tools and workflow packages ── */

export type ServerPurpose = "tool" | "workflow";
export type ServerStatus = "healthy" | "degraded" | "unreachable";
export type CheckStatus = "pass" | "warn" | "fail" | "skip";
export type DeploymentStatus = "queued" | "running" | "succeeded" | "failed";

export interface ProviderField {
  key: string;
  label: string;
  type: "text" | "number" | "password" | "textarea" | "select";
  required: boolean;
  secret: boolean;
  placeholder: string;
  help: string;
  group: "connection" | "provider" | "deployment";
  default?: string | number;
  options?: { value: string; label: string }[];
  /** Field is shown only when every key matches (a list means "any of"). */
  show_if?: Record<string, string | string[]>;
}

export interface ServerProvider {
  id: string;
  label: string;
  transport: "http" | "ssh";
  purposes: ServerPurpose[];
  icon: string;
  description: string;
  fields: ProviderField[];
  hints?: string[];
  /** Connection details come from provisioning (e.g. Brev), not the form. */
  provisioned?: boolean;
}

export interface CommandPreset {
  label: string;
  /** "workflow": runs in a deployed workflow's directory; "server": in the deploy directory. */
  scope: "workflow" | "server";
  command: string;
  /** Streams until stopped (e.g. following logs). */
  long_running?: boolean;
}

export interface ProviderCatalog {
  purposes: Record<ServerPurpose, { label: string; description: string }>;
  providers: ServerProvider[];
  workflow_actions: Record<string, string>;
  command_presets: Record<string, CommandPreset>;
}

export interface ServerCheck {
  id: string;
  label: string;
  status: CheckStatus;
  detail: string;
  latency_ms?: number;
}

export interface CheckReport {
  status: ServerStatus;
  ok: boolean;
  reachable: boolean;
  checked_at?: string;
  duration_ms?: number;
  latency_ms?: number;
  host_fingerprint?: string;
  checks: ServerCheck[];
  system: Record<string, string>;
}

export interface RemoteServer {
  id: number;
  name: string;
  url: string;
  description: string;
  purpose: ServerPurpose;
  provider: string;
  provider_label: string;
  transport: "http" | "ssh";
  config: Record<string, unknown>;
  /** Names of stored secrets — values are never returned. */
  secrets_set: string[];
  last_status: ServerStatus | null;
  last_checked_at: string | null;
  last_check: CheckReport | null;
  created_at: string | null;
  updated_at: string | null;
  /** Set on create for provisioned providers — the provisioning run to follow. */
  provision_deployment_id?: number;
}

export interface ServerInput {
  name?: string | undefined;
  description?: string | undefined;
  purpose?: ServerPurpose | undefined;
  provider?: string | undefined;
  config?: Record<string, unknown> | undefined;
  /** A non-empty value replaces, "" keeps the stored one, null clears it. */
  secrets?: Record<string, string | null> | undefined;
  initial_check?: CheckReport | null | undefined;
}

export interface RemoteDeployment {
  id: number;
  server_id: number;
  server_name?: string | null;
  kind: "tool" | "workflow" | "provision" | "command";
  target: string;
  status: DeploymentStatus;
  options: Record<string, unknown>;
  error: string | null;
  log?: string;
  created_at: string | null;
  finished_at: string | null;
}

export interface RemoteWorkflow {
  name: string;
  modified?: string;
  generated_at?: string;
  env: boolean;
  containers: { name: string; status: string; project: string }[];
}

export interface WorkflowDeployOptions {
  workflow_name: string;
  action: string;
  mistral_api_key?: string | undefined;
  custom_command?: string | undefined;
  /** Merged into the workflow's .env on the server (names only are recorded). */
  env?: Record<string, string> | undefined;
  /** "full" action: rebuild every image layer. */
  no_cache?: boolean | undefined;
}

export type BuildService = "backend" | "tool-service" | "neo4j";

export interface WorkflowBuildOptions {
  workflow: string;
  services: BuildService[];
  no_cache: boolean;
  pull: boolean;
  run_bootstrap: boolean;
  start: boolean;
  force_recreate: boolean;
  remove_orphans: boolean;
  build_args: Record<string, string>;
  /** Merged into the workflow's .env on the server before building. */
  env: Record<string, string>;
}

export interface WorkflowDeleteOptions {
  workflow: string;
  /** Must repeat the workflow name. */
  confirm: string;
  /** docker compose down first; without it the containers keep running. */
  stop_containers: boolean;
  /** Also delete named volumes (Neo4j graph, tool data). Needs stop_containers. */
  remove_volumes: boolean;
  /** Also delete the images built for this workflow. Needs stop_containers. */
  remove_images: boolean;
}

export interface RemoteRunResponse {
  execution_id: string;
  status: string;
  workflow_name: string;
  /** The task queue the run was routed to — the server worker's DEPLOYMENT_NAME. */
  deployment_name: string;
  warnings: string[];
}

export const remoteServersApi = {
  providers: () => get<ProviderCatalog>("/api/remote-servers/providers"),
  list: (purpose?: ServerPurpose) =>
    get<RemoteServer[]>("/api/remote-servers", purpose ? { purpose } : undefined),
  get: (id: string | number) => get<RemoteServer>(`/api/remote-servers/${id}`),
  create: (body: ServerInput) => post<RemoteServer>("/api/remote-servers", body),
  update: (id: string | number, body: ServerInput) =>
    put<RemoteServer>(`/api/remote-servers/${id}`, body),
  remove: (id: string | number) => del<unknown>(`/api/remote-servers/${id}`),

  /** Diagnostics on unsaved settings; `server_id` reuses that server's stored secrets. */
  test: (body: ServerInput & { server_id?: number | undefined }) =>
    post<CheckReport>("/api/remote-servers/test", body),
  check: (id: string | number) => post<CheckReport>(`/api/remote-servers/${id}/check`),
  checkAll: (purpose?: ServerPurpose) =>
    post<{ summary: Record<ServerStatus, number>; results: unknown[] }>(
      `/api/remote-servers/check-all${purpose ? `?purpose=${purpose}` : ""}`,
    ),
  remoteWorkflows: (id: string | number) =>
    get<{ supported: boolean; items: RemoteWorkflow[]; error?: string }>(
      `/api/remote-servers/${id}/remote-workflows`,
    ),

  /** Run a console command or preset over SSH; follow the returned deployment's log. */
  runCommand: (
    id: string | number,
    body: {
      command?: string | undefined;
      preset?: string | undefined;
      workflow?: string | undefined;
      timeout?: number | undefined;
    },
  ) => post<RemoteDeployment>(`/api/remote-servers/${id}/commands`, body),
  /** Stop a running console command. */
  cancelCommand: (deploymentId: number) =>
    post<unknown>(`/api/remote-servers/deployments/${deploymentId}/cancel`),

  /** Build (and optionally start) a deployed workflow's Docker stack; follow the log. */
  build: (id: string | number, body: WorkflowBuildOptions) =>
    post<RemoteDeployment>(`/api/remote-servers/${id}/build`, body),
  /** Delete a deployed workflow package (and optionally its containers); follow the log. */
  deleteWorkflow: (id: string | number, body: WorkflowDeleteOptions) =>
    post<RemoteDeployment>(`/api/remote-servers/${id}/delete-workflow`, body),
  /** Start a run on this server's worker (routed by the DEPLOYMENT_NAME in its .env). */
  runWorkflow: (
    id: string | number,
    body: {
      workflow: string;
      input: Record<string, unknown>;
      deployment_name?: string | undefined;
    },
  ) => post<RemoteRunResponse>(`/api/remote-servers/${id}/run-workflow`, body),

  /** Re-resolve a Brev server's SSH access and prepare the VM. */
  provision: (id: string | number) => post<RemoteDeployment>(`/api/remote-servers/${id}/provision`),

  sendTool: (id: string | number, toolId: string | number) =>
    post<unknown>(`/api/remote-servers/${id}/send-tool`, { tool_id: String(toolId) }),
  deployWorkflow: (id: string | number, body: WorkflowDeployOptions) =>
    post<RemoteDeployment>(`/api/remote-servers/${id}/deploy-workflow`, body),
  deployments: (id: string | number) =>
    get<RemoteDeployment[]>(`/api/remote-servers/${id}/deployments`),
  deployment: (deploymentId: number) =>
    get<RemoteDeployment>(`/api/remote-servers/deployments/${deploymentId}`),
  workflowDeployments: (workflowName: string) =>
    get<RemoteDeployment[]>("/api/remote-servers/deployments", {
      workflow_name: workflowName,
      limit: 10,
    }),
};
