import { api } from "@/api";

/* ── The deployment manifest, as the backend describes it ── */

export interface DeploymentAgentSpec {
  name: string;
  model: string;
  tier?: string | null;
}
export interface DeploymentDynamicTool {
  name: string;
  /** "activity" — a workflow step on its own; "tool" — called by an agent. */
  purpose?: string;
  version_no?: number | null;
}
export interface DeploymentConnector {
  connector_id?: string | null;
  connector_name?: string | null;
  credentials_name?: string | null;
  is_directory?: boolean;
  server?: string | null;
  /** "bearer" | "oauth2" | "none" */
  auth?: string;
  used_by?: string[];
}
export interface DeploymentSetupField {
  key: string;
  label: string;
  help: string;
  secret: boolean;
  required: boolean;
  default?: string | null;
  /** "worker" | "tool" | "connector" | "database" */
  group: string;
}
export interface DeploymentManifest {
  workflow_name: string;
  agents: DeploymentAgentSpec[];
  native_tools: string[];
  dynamic_tools: DeploymentDynamicTool[];
  connectors: DeploymentConnector[];
  uses_knowledge_graph?: boolean;
  graph_library_ids?: string[];
  uses_sql_tools?: boolean;
  setup?: DeploymentSetupField[];
}

/* ── The operator's answers ── */

export interface SetupState {
  env: Record<string, string>;
  sqlMode: "container" | "external";
  sqlUrl: string;
  seedSql: string;
  seedName: string;
}

export const emptySetup = (): SetupState => ({
  env: {},
  sqlMode: "container",
  sqlUrl: "",
  seedSql: "",
  seedName: "",
});

/** The body the backend takes as ``DeploymentSetup``. Blank values are left out. */
export function setupRequest(manifest: DeploymentManifest | undefined, s: SetupState) {
  const env = Object.fromEntries(Object.entries(s.env).filter(([, v]) => v.trim() !== ""));
  const sql = manifest?.uses_sql_tools
    ? {
        mode: s.sqlMode,
        url: s.sqlMode === "external" ? s.sqlUrl.trim() || undefined : undefined,
        seed_sql: s.sqlMode === "container" ? s.seedSql || undefined : undefined,
      }
    : undefined;
  return { env, sql };
}

/** What still blocks a build, in words; ``optionalKeys`` may stay blank (e.g. kept on the server). */
export function setupProblems(
  manifest: DeploymentManifest | undefined,
  s: SetupState,
  optionalKeys: string[] = [],
): string[] {
  if (!manifest) return [];
  const problems = (manifest.setup ?? [])
    .filter(
      (f) => f.required && !f.default && !optionalKeys.includes(f.key) && !s.env[f.key]?.trim(),
    )
    .map((f) => `${f.label} is required`);
  if (manifest.uses_sql_tools && s.sqlMode === "external" && !s.sqlUrl.includes("://")) {
    problems.push("The SQL database's connection URL is required");
  }
  return problems;
}

/** Build the package with the answers and save it. The .env inside holds them. */
export async function downloadPackage(workflowName: string, body: ReturnType<typeof setupRequest>) {
  const res = await api.post(`/api/workflows/${workflowName}/deployment/package`, body, {
    responseType: "blob",
  });
  const url = URL.createObjectURL(res.data as Blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${workflowName}_deployment.zip`;
  a.click();
  URL.revokeObjectURL(url);
}
