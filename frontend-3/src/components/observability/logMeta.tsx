import {
  Bot,
  Circle,
  GitBranch,
  Globe,
  Layers,
  ListTree,
  PlayCircle,
  ShieldCheck,
  Sparkles,
  Workflow,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import { Pill, type Tone } from "@/components/rules/RulePills";
import type { RuleVerdict, SpanRow, TraceKind } from "@/api/observability";

/*
 * How each kind of span and trace is drawn on the Logs pages.
 * Same colour language as the Rules page: red is a failure, amber a warning,
 * emerald a pass, cyan a rule that fixed something.
 */

interface KindMeta {
  label: string;
  icon: LucideIcon;
  tone: Tone;
}

const OTHER_KIND: KindMeta = { label: "Span", icon: Circle, tone: "muted" };

export const KIND_META: Record<string, KindMeta> = {
  workflow: { label: "Workflow", icon: GitBranch, tone: "blue" },
  step: { label: "Step", icon: ListTree, tone: "primary" },
  rule: { label: "Rule", icon: ShieldCheck, tone: "emerald" },
  tool: { label: "Tool", icon: Wrench, tone: "amber" },
  llm: { label: "Model", icon: Sparkles, tone: "purple" },
  agent: { label: "Agent", icon: Bot, tone: "purple" },
  pipeline: { label: "Pipeline", icon: Workflow, tone: "cyan" },
  layer: { label: "Layer", icon: Layers, tone: "slate" },
  run: { label: "Run", icon: PlayCircle, tone: "cyan" },
  http: { label: "Action", icon: Globe, tone: "muted" },
  other: OTHER_KIND,
};

export function kindMeta(kind: string | null | undefined): KindMeta {
  return KIND_META[kind ?? "other"] ?? OTHER_KIND;
}

export const TRACE_KINDS: { value: TraceKind | ""; label: string }[] = [
  { value: "", label: "All actions" },
  { value: "workflow", label: "Workflow runs" },
  { value: "run", label: "Background runs" },
  { value: "http", label: "API actions" },
  { value: "pipeline", label: "Pipelines" },
  { value: "llm", label: "Background model calls" },
];

export const VERDICT_META: Record<RuleVerdict, { label: string; tone: Tone }> = {
  pass: { label: "Passed", tone: "emerald" },
  fixed: { label: "Fixed", tone: "cyan" },
  warn: { label: "Warned", tone: "amber" },
  fail: { label: "Failed", tone: "red" },
};

export function VerdictPill({ verdict }: { verdict: string | null | undefined }) {
  const meta = VERDICT_META[(verdict ?? "pass") as RuleVerdict] ?? VERDICT_META.pass;
  return <Pill tone={meta.tone}>{meta.label}</Pill>;
}

export function KindPill({ kind }: { kind: string | null | undefined }) {
  const meta = kindMeta(kind);
  const Icon = meta.icon;
  return (
    <Pill tone={meta.tone}>
      <Icon className="size-2.5" />
      {meta.label}
    </Pill>
  );
}

export const isErrorSpan = (s: Pick<SpanRow, "status_code">) => s.status_code === "Error";

/** A span attribute value as readable text — JSON is pretty-printed. */
export function pretty(value: unknown): string {
  if (value == null) return "";
  if (typeof value !== "string") return JSON.stringify(value, null, 2);
  const text = value.trim();
  if (
    (text.startsWith("{") && text.endsWith("}")) ||
    (text.startsWith("[") && text.endsWith("]"))
  ) {
    try {
      return JSON.stringify(JSON.parse(text), null, 2);
    } catch {
      return value;
    }
  }
  return value;
}

export function formatTokens(n: number | null | undefined): string {
  if (!n) return "0";
  return n >= 10_000 ? `${(n / 1000).toFixed(1)}k` : String(n);
}

export const TIME_RANGES = [
  { value: 1, label: "Last hour" },
  { value: 24, label: "Last 24 hours" },
  { value: 24 * 7, label: "Last 7 days" },
  { value: 24 * 30, label: "Last 30 days" },
];
