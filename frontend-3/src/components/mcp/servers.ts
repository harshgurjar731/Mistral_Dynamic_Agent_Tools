import type { HealthState } from "@/components/shared/ReachabilityBadge";

export interface McpServer {
  name: string;
  url?: string;
  description?: string;
  status?: string;
  connected?: boolean;
  tool_count?: number;
  [k: string]: unknown;
}

/** The registry endpoint has returned a few different shapes over time. */
export function serverList(data: unknown): McpServer[] {
  if (Array.isArray(data)) return data as McpServer[];
  const obj = data as { servers?: McpServer[]; items?: McpServer[] } | undefined;
  return obj?.servers ?? obj?.items ?? [];
}

export function healthState(server: McpServer): HealthState {
  const status = String(server.status ?? "").toLowerCase();
  if (status.includes("health")) return "healthy";
  if (status.includes("disconnect")) return "disconnected";
  if (status.includes("unreach") || status.includes("error")) return "unreachable";
  if (status.includes("check")) return "checking";
  if (server.connected === true) return "healthy";
  if (server.connected === false) return "disconnected";
  return "unknown";
}
