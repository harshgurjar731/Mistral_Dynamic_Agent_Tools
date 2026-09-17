/**
 * One accent per tone, wired to the theme tokens so the canvas, the minimap,
 * the legend and the inspector always agree on what a colour means.
 */
export type GraphTone =
  "indigo" | "amber" | "emerald" | "cyan" | "purple" | "slate" | "blue" | "orange";

export const TONE_VAR: Record<GraphTone, string> = {
  indigo: "var(--indigo)",
  amber: "var(--amber)",
  emerald: "var(--emerald)",
  cyan: "var(--cyan)",
  purple: "var(--purple)",
  slate: "var(--slate)",
  blue: "var(--blue)",
  orange: "var(--orange)",
};
