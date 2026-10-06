import {
  Activity,
  BotMessageSquare,
  Cpu,
  GitBranch,
  HardDrive,
  Library,
  Network,
  Plug,
  ScrollText,
  Server,
  ShieldCheck,
  Terminal,
  Wrench,
  Zap,
  type LucideIcon,
} from "lucide-react";

export interface NavItem {
  label: string;
  to: string;
  icon: LucideIcon;
  expandable?: "playground";
}

/** Order matches frontend navigation */
export const NAV_ITEMS: NavItem[] = [
  { label: "Orchestrator", to: "/", icon: BotMessageSquare },
  { label: "Playground", to: "/playground", icon: Terminal, expandable: "playground" },
  { label: "Agents", to: "/agents", icon: Cpu },
  { label: "Tools", to: "/tools", icon: Wrench },
  { label: "Workflows", to: "/workflows", icon: GitBranch },
  { label: "Activities", to: "/workflows/activities", icon: Zap },
  { label: "Connectors", to: "/connectors", icon: Plug },
  { label: "Rules", to: "/rules", icon: ShieldCheck },
  { label: "Logs", to: "/logs", icon: ScrollText },
  { label: "Ontology", to: "/ontology", icon: Network },
  { label: "MCP Servers", to: "/mcp", icon: Server },
  { label: "Remote Servers", to: "/remote-servers", icon: HardDrive },
  { label: "Libraries", to: "/libraries", icon: Library },
  { label: "Health", to: "/health", icon: Activity },
];
