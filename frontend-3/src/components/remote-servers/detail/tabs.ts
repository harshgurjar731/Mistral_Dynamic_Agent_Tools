import {
  Boxes,
  History,
  LayoutDashboard,
  Send,
  Settings2,
  SquareTerminal,
  type LucideIcon,
} from "lucide-react";
import type { RemoteServer, RemoteWorkflow } from "@/api/remoteServers";

export const SERVER_TABS = [
  "overview",
  "workflows",
  "push",
  "console",
  "activity",
  "settings",
] as const;
export type ServerTab = (typeof SERVER_TABS)[number];

const META: Record<ServerTab, { label: string; icon: LucideIcon }> = {
  overview: { label: "Overview", icon: LayoutDashboard },
  workflows: { label: "Workflows", icon: Boxes },
  push: { label: "Push tool", icon: Send },
  console: { label: "Console", icon: SquareTerminal },
  activity: { label: "Activity", icon: History },
  settings: { label: "Settings", icon: Settings2 },
};

/** The tabs a server offers: what you can do depends on its purpose and transport. */
export function tabsFor(
  server: RemoteServer,
): { id: ServerTab; label: string; icon: LucideIcon }[] {
  const ids: ServerTab[] = ["overview"];
  if (server.purpose === "workflow") ids.push("workflows");
  else ids.push("push");
  if (server.transport === "ssh") ids.push("console");
  ids.push("activity", "settings");
  return ids.map((id) => ({ id, ...META[id] }));
}

export function containersUp(w: RemoteWorkflow): number {
  return w.containers.filter((c) => c.status.startsWith("Up")).length;
}
