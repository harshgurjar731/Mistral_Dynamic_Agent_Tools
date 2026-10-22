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
  Settings,
  ShieldCheck,
  Terminal,
  Workflow,
  Wrench,
  Zap,
  type LucideIcon,
} from "lucide-react";

/** The built-in words of a feature's own page, as plain text. */
export interface PageText {
  /** Page heading. */
  title: string;
  /** The line under the heading; null when the page has none. */
  description: string | null;
  /** Name in the browser tab, before " — <product>". */
  tab: string;
}

export interface NavItem {
  label: string;
  to: string;
  icon: LucideIcon;
  expandable?: "playground";
  page: PageText;
}

/** Order matches frontend navigation */
export const NAV_ITEMS: NavItem[] = [
  {
    label: "Orchestrator",
    to: "/",
    icon: BotMessageSquare,
    page: {
      title: "Describe your goal.\nWe design the agent.",
      description: null,
      tab: "Orchestrator",
    },
  },
  {
    label: "Playground",
    to: "/playground",
    icon: Terminal,
    expandable: "playground",
    page: { title: "Playground", description: null, tab: "Playground" },
  },
  {
    label: "Agents",
    to: "/agents",
    icon: Cpu,
    page: {
      title: "Agent Studio",
      description: "Create, configure, and manage your AI agents.",
      tab: "Agent Studio",
    },
  },
  {
    label: "Tools",
    to: "/tools",
    icon: Wrench,
    page: {
      title: "Tool Lifecycle",
      description: "Synthesize, review, and manage dynamic tools.",
      tab: "Tool Lifecycle",
    },
  },
  {
    label: "Workflows",
    to: "/workflows",
    icon: GitBranch,
    page: {
      title: "Workflows",
      description:
        "Deterministic multi-step pipelines. Save keeps edits local; publish compiles the definition and registers it with the Mistral worker.",
      tab: "Workflows",
    },
  },
  {
    label: "Activities",
    to: "/workflows/activities",
    icon: Zap,
    page: {
      title: "Activity Gallery",
      description:
        "Isolated, retryable units of work a workflow can run directly — no LLM in the loop.",
      tab: "Activity Gallery",
    },
  },
  {
    label: "Connectors",
    to: "/connectors",
    icon: Plug,
    page: {
      title: "Connector Registry",
      description: "Manage MCP connectors registered with Mistral.",
      tab: "Connectors",
    },
  },
  {
    label: "Rules",
    to: "/rules",
    icon: ShieldCheck,
    page: {
      title: "Rules & Gates",
      description:
        "The rules your agents and workflows must follow. Always-on rules apply everywhere; the orchestrator adds the others where they fit — and you can add them by hand.",
      tab: "Rules",
    },
  },
  {
    label: "Logs",
    to: "/logs",
    icon: ScrollText,
    page: {
      title: "Logs & Traces",
      description:
        "Every action this platform takes — API calls, workflow runs and each of their steps, rule verdicts, tool calls, pipeline layers and model calls — is traced to Mistral Observability and read back here.",
      tab: "Logs",
    },
  },
  {
    label: "Ontology",
    to: "/ontology",
    icon: Network,
    page: {
      title: "Ontology",
      description:
        "A shared vocabulary the planner narrows on before it chooses agents. Concepts live in schemes; annotations bind them to agents, tools, connectors, workflows and libraries.",
      tab: "Ontology",
    },
  },
  {
    label: "MCP Servers",
    to: "/mcp",
    icon: Server,
    page: {
      title: "MCP Servers",
      description:
        "Model Context Protocol servers whose tools your agents can call. Register one, check its health, and try its tools before wiring them in.",
      tab: "MCP Servers",
    },
  },
  {
    label: "Remote Servers",
    to: "/remote-servers",
    icon: HardDrive,
    page: {
      title: "Remote Servers",
      description:
        "Where dynamic tools and workflow packages get deployed. Add a VM or endpoint, check it, then deploy to it from a tool or a workflow.",
      tab: "Remote Servers",
    },
  },
  {
    label: "Libraries",
    to: "/libraries",
    icon: Library,
    page: {
      title: "Libraries",
      description:
        "Document sets an agent can be pointed at. Attach one to an agent from its detail page to give it retrieval over these files.",
      tab: "Libraries",
    },
  },
  {
    label: "Processes",
    to: "/processes",
    icon: Workflow,
    page: {
      title: "Processes",
      description:
        "The business processes each industry runs, filed by domain and subdomain like the ontology, with a process and subprocess level below. A process document attached here grounds agent and workflow design when Process knowledge is turned on.",
      tab: "Processes",
    },
  },
  {
    label: "Health",
    to: "/health",
    icon: Activity,
    page: {
      title: "System Health",
      description: "Live status of all core microservices.",
      tab: "Health",
    },
  },
  {
    label: "Settings",
    to: "/settings",
    icon: Settings,
    page: {
      title: "Settings",
      description:
        "Every model and configuration value of the backend, the Tool Service and this interface. Saved values take effect immediately wherever they are used.",
      tab: "Settings",
    },
  },
];

/** Always shown — hiding it would leave no way back to this setting. */
export const LOCKED_NAV = new Set(["/settings"]);

/** The texts of one feature that can be renamed; a missing field keeps the built-in one. */
export interface FeatureTextOverride {
  label?: string;
  title?: string;
  description?: string;
  tab?: string;
}

export const TEXT_FIELDS = ["label", "title", "description", "tab"] as const;
export type TextField = (typeof TEXT_FIELDS)[number];

/** The UI_NAV_LAYOUT setting: page order, hidden pages and renamed texts, by route. */
export interface NavLayout {
  order: string[];
  hidden: string[];
  text: Record<string, FeatureTextOverride>;
}

export interface NavRow {
  item: NavItem;
  hidden: boolean;
  text: FeatureTextOverride;
}

function cleanText(raw: unknown): Record<string, FeatureTextOverride> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Record<string, FeatureTextOverride> = {};
  for (const [route, fields] of Object.entries(raw as Record<string, unknown>)) {
    if (!fields || typeof fields !== "object") continue;
    const kept: FeatureTextOverride = {};
    for (const f of TEXT_FIELDS) {
      const v = (fields as Record<string, unknown>)[f];
      if (typeof v === "string" && v.trim()) kept[f] = v;
    }
    if (Object.keys(kept).length) out[route] = kept;
  }
  return out;
}

export function parseNavLayout(raw: unknown): NavLayout {
  const empty: NavLayout = { order: [], hidden: [], text: {} };
  if (typeof raw !== "string" || !raw.trim()) return empty;
  try {
    const data = JSON.parse(raw) as Partial<NavLayout>;
    const strings = (v: unknown) =>
      Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
    return { order: strings(data.order), hidden: strings(data.hidden), text: cleanText(data.text) };
  } catch {
    return empty;
  }
}

/**
 * Every nav item in the saved order, flagged hidden or not, with its renamed
 * texts. Pages the saved layout does not mention (added since it was saved)
 * keep their built-in position; routes that no longer exist are dropped.
 */
export function arrangeNav(layout: NavLayout): NavRow[] {
  const byRoute = new Map(NAV_ITEMS.map((i) => [i.to, i]));
  const ordered: NavItem[] = [];
  for (const to of layout.order) {
    const item = byRoute.get(to);
    if (item && !ordered.includes(item)) ordered.push(item);
  }
  NAV_ITEMS.forEach((item, index) => {
    if (ordered.includes(item)) return;
    // Slot it after the nearest built-in predecessor that is already placed.
    const before = NAV_ITEMS.slice(0, index)
      .reverse()
      .find((p) => ordered.includes(p));
    ordered.splice(before ? ordered.indexOf(before) + 1 : 0, 0, item);
  });
  const hidden = new Set(layout.hidden);
  return ordered.map((item) => ({
    item,
    hidden: hidden.has(item.to) && !LOCKED_NAV.has(item.to),
    text: layout.text[item.to] ?? {},
  }));
}

/** Back to the setting's text; the built-in layout is saved as "" (no override). */
export function serializeNavLayout(rows: NavRow[]): string {
  const order = rows.map((r) => r.item.to);
  const hidden = rows.filter((r) => r.hidden).map((r) => r.item.to);
  const text = cleanText(Object.fromEntries(rows.map((r) => [r.item.to, r.text])));
  const isDefault =
    !hidden.length && !Object.keys(text).length && order.every((to, i) => NAV_ITEMS[i]?.to === to);
  if (isDefault) return "";
  return JSON.stringify(Object.keys(text).length ? { order, hidden, text } : { order, hidden });
}

/** Built-in tab name → renamed one, for every feature with a renamed tab. */
export function tabRenames(layoutRaw: unknown): Record<string, string> {
  const text = parseNavLayout(layoutRaw).text;
  const out: Record<string, string> = {};
  for (const item of NAV_ITEMS) {
    const tab = text[item.to]?.tab?.trim();
    if (tab && tab !== item.page.tab) out[item.page.tab] = tab;
  }
  return out;
}

/** A feature's label as shown: the renamed one, else the built-in. */
export function navLabel(row: NavRow): string {
  return row.text.label?.trim() || row.item.label;
}
