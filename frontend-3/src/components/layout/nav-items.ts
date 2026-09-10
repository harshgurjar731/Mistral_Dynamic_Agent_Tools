import {
  Activity,
  BotMessageSquare,
  Cpu,
  GitBranch,
  Library,
  MessageSquare,
  Network,
  Plug,
  Radio,
  Server,
  Terminal,
  Wrench,
  type LucideIcon,
} from "lucide-react";

export interface NavItem {
  label: string;
  to: string;
  icon: LucideIcon;
  expandable?: "playground" | "agents";
}

/** Order matters — matches the spec's navigation table. */
export const NAV_ITEMS: NavItem[] = [
  { label: "Orchestrator", to: "/", icon: BotMessageSquare },
  { label: "Playground", to: "/playground", icon: Terminal, expandable: "playground" },
  { label: "Agents", to: "/agents", icon: Cpu, expandable: "agents" },
  { label: "Tools", to: "/tools", icon: Wrench },
  { label: "Workflows", to: "/workflows", icon: GitBranch },
  { label: "Executions", to: "/executions", icon: Radio },
  { label: "Conversations", to: "/conversations", icon: MessageSquare },
  { label: "Connectors", to: "/connectors", icon: Plug },
  { label: "Ontology", to: "/ontology", icon: Network },
  { label: "MCP Servers", to: "/mcp", icon: Server },
  { label: "Libraries", to: "/libraries", icon: Library },
  { label: "Health", to: "/health", icon: Activity },
];
