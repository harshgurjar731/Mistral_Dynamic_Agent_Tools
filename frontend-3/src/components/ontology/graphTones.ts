/**
 * One accent per tone, wired to the theme tokens so the canvas, the minimap,
 * the legend and the inspector always agree on what a colour means.
 */
export type GraphTone =
  "indigo" | "amber" | "emerald" | "cyan" | "purple" | "slate" | "blue" | "orange" | "pink" | "red";

export const TONE_VAR: Record<GraphTone, string> = {
  indigo: "var(--indigo)",
  amber: "var(--amber)",
  emerald: "var(--emerald)",
  cyan: "var(--cyan)",
  purple: "var(--purple)",
  slate: "var(--slate)",
  blue: "var(--blue)",
  orange: "var(--orange)",
  pink: "var(--pink)",
  red: "var(--red)",
};

/** A lighter variant of a token, for kinds that sit one level under another. */
const light = (token: string) => `color-mix(in oklch, var(--${token}) 55%, var(--foreground))`;

interface KindMeta {
  label: string;
  color: string;
}

/**
 * Every node kind the ontology graph can contain, in the order their clusters
 * are arranged around the canvas — related kinds sit next to each other.
 */
export const KIND_META: Record<string, KindMeta> = {
  industry: { label: "Industry", color: "var(--purple)" },
  scheme: { label: "Scheme", color: "var(--purple)" },
  domain: { label: "Domain", color: "var(--pink)" },
  concept: { label: "Concept", color: "var(--pink)" },
  subdomain: { label: "Subdomain", color: light("pink") },
  capability: { label: "Capability", color: "var(--cyan)" },
  data_class: { label: "Data class", color: "var(--amber)" },
  agent_tier: { label: "Agent tier", color: "var(--slate)" },
  agent: { label: "Agent", color: "var(--emerald)" },
  workflow: { label: "Workflow", color: "var(--blue)" },
  tool: { label: "Tool", color: "var(--orange)" },
  connector: { label: "Connector", color: "var(--red)" },
  library: { label: "Library", color: light("emerald") },
};

export const KIND_ORDER = Object.keys(KIND_META);

const FALLBACK = ["var(--cyan)", "var(--amber)", "var(--pink)", "var(--blue)", "var(--emerald)"];

/** A stable colour for any kind, including ones the platform adds later. */
export function kindColor(kind: string): string {
  const known = KIND_META[kind];
  if (known) return known.color;
  let h = 0;
  for (const ch of kind) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return FALLBACK[h % FALLBACK.length]!;
}

export function kindLabel(kind: string): string {
  return (
    KIND_META[kind]?.label ?? kind.replace(/[_-]+/g, " ").replace(/^\w/, (c) => c.toUpperCase())
  );
}
