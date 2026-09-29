import type { HealthState } from "@/components/shared/ReachabilityBadge";

/** A registry record, as the Tool Service's MCP manager reports it. */
export interface McpServer {
  name: string;
  url?: string;
  description?: string;
  protocol?: string;
  /** False after "Disconnect": the server stays registered but is not used. */
  enabled?: boolean;
  /** Result of the last initialize handshake. */
  healthy?: boolean;
  tools_count?: number;
  /** When it was registered; absent for servers registered before this was recorded. */
  created_at?: string | null;
  // Older shapes of the same record.
  status?: string;
  connected?: boolean;
  tool_count?: number;
  [k: string]: unknown;
}

export interface McpTool {
  name: string;
  description?: string;
  input_schema?: Record<string, unknown>;
  inputSchema?: Record<string, unknown>;
  parameters?: Record<string, unknown>;
  [k: string]: unknown;
}

/** The registry endpoint has returned a few different shapes over time. */
export function serverList(data: unknown): McpServer[] {
  if (Array.isArray(data)) return data as McpServer[];
  const obj = data as { servers?: McpServer[]; items?: McpServer[] } | undefined;
  return obj?.servers ?? obj?.items ?? [];
}

export function toolList(data: unknown): McpTool[] {
  if (Array.isArray(data)) return data as McpTool[];
  const obj = data as { tools?: McpTool[] } | undefined;
  return obj?.tools ?? [];
}

export function toolSchema(tool: McpTool): Record<string, unknown> | undefined {
  return tool.input_schema ?? tool.inputSchema ?? tool.parameters;
}

/** An arguments object pre-filled with each property's type, for the playground. */
export function argumentSkeleton(tool: McpTool): string {
  const props = (toolSchema(tool)?.["properties"] ?? {}) as Record<string, { type?: string }>;
  const out: Record<string, unknown> = {};
  for (const [key, spec] of Object.entries(props)) {
    const t = spec?.type;
    out[key] =
      t === "number" || t === "integer"
        ? 0
        : t === "boolean"
          ? false
          : t === "array"
            ? []
            : t === "object"
              ? {}
              : "";
  }
  return JSON.stringify(out, null, 2);
}

export function toolCount(server: McpServer): number | null {
  const n = server.tools_count ?? server.tool_count;
  return typeof n === "number" ? n : null;
}

export function healthState(server: McpServer): HealthState {
  if (server.enabled === false) return "disconnected";
  if (typeof server.healthy === "boolean") return server.healthy ? "healthy" : "unreachable";
  const status = String(server.status ?? "").toLowerCase();
  if (status.includes("health")) return "healthy";
  if (status.includes("disconnect")) return "disconnected";
  if (status.includes("unreach") || status.includes("error")) return "unreachable";
  if (status.includes("check")) return "checking";
  if (server.connected === true) return "healthy";
  if (server.connected === false) return "disconnected";
  return "unknown";
}

/** Accent classes per health state — dots and stripes, matching the Remote Servers page. */
export const HEALTH_TONE: Record<HealthState, { dot: string; text: string; stripe: string }> = {
  healthy: { dot: "bg-emerald", text: "text-emerald", stripe: "from-emerald/70" },
  unreachable: { dot: "bg-red", text: "text-red", stripe: "from-red/70" },
  disconnected: { dot: "bg-slate", text: "text-slate", stripe: "from-slate/60" },
  checking: { dot: "bg-amber animate-pulse", text: "text-amber", stripe: "from-amber/70" },
  unknown: { dot: "bg-muted-foreground/50", text: "text-muted-foreground", stripe: "from-border" },
};

export const HEALTH_LABEL: Record<HealthState, string> = {
  healthy: "Healthy",
  unreachable: "Unreachable",
  disconnected: "Disconnected",
  checking: "Checking…",
  unknown: "Not checked",
};

export function hostOf(url?: string): string {
  if (!url) return "";
  try {
    return new URL(url).host + new URL(url).pathname.replace(/\/$/, "");
  } catch {
    return url.replace(/^https?:\/\//, "");
  }
}
