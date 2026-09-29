import {
  BadgeCheck,
  Ban,
  Bookmark,
  Braces,
  Briefcase,
  Building2,
  CheckCircle2,
  Cpu,
  DatabaseZap,
  EyeOff,
  FileText,
  Filter,
  Flag,
  Gauge,
  Globe,
  Library,
  ListOrdered,
  Lock,
  MessageSquareOff,
  PlugZap,
  Puzzle,
  Ruler,
  Scale,
  ScanSearch,
  Shield,
  ShieldAlert,
  Sparkles,
  Star,
  Tag,
  Unplug,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import type { RuleAppliedBy, RuleEnforcement, RuleOutcomeKind } from "@/types";

/*
 * Colour meaning, used everywhere rules appear:
 *   outcomes    emerald passed · amber warned · red blocked · cyan fixed · slate applied
 *   sources     slate always on · purple AI picked · primary added by you
 *   scopes      primary agent · blue workflow
 * Class strings are written out in full so Tailwind sees them.
 */

const TONES = {
  emerald: "border-emerald/30 bg-emerald/10 text-emerald",
  amber: "border-amber/30 bg-amber/10 text-amber",
  red: "border-red/30 bg-red/10 text-red",
  cyan: "border-cyan/30 bg-cyan/10 text-cyan",
  slate: "border-slate/30 bg-slate/10 text-slate",
  purple: "border-purple/30 bg-purple/10 text-purple",
  primary: "border-primary/30 bg-primary/10 text-primary",
  blue: "border-blue/30 bg-blue/10 text-blue",
  muted: "border-border bg-background-elevated text-muted-foreground",
} as const;

export type Tone = keyof typeof TONES;

export function Pill({
  tone,
  children,
  className,
  title,
}: {
  tone: Tone;
  children: ReactNode;
  className?: string | undefined;
  title?: string | undefined;
}) {
  return (
    <span
      title={title}
      className={cn(
        "inline-flex items-center gap-1 rounded border px-1.5 py-0.5 font-mono text-[9px] font-bold uppercase leading-none",
        TONES[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

export const OUTCOME_META: Record<RuleOutcomeKind, { label: string; tone: Tone }> = {
  passed: { label: "Passed", tone: "emerald" },
  warned: { label: "Warned", tone: "amber" },
  blocked: { label: "Blocked", tone: "red" },
  fixed: { label: "Fixed", tone: "cyan" },
  applied: { label: "Applied", tone: "slate" },
};

export const ENFORCEMENT_META: Record<
  RuleEnforcement,
  { label: string; tone: Tone; hint: string }
> = {
  block: { label: "Block", tone: "red", hint: "Stop the action and say why" },
  warn: { label: "Warn", tone: "amber", hint: "Allow it and record it" },
  fix: { label: "Auto-fix", tone: "cyan", hint: "Correct it automatically" },
};

export const SOURCE_META: Record<RuleAppliedBy, { label: string; tone: Tone }> = {
  always: { label: "Always on", tone: "slate" },
  ai: { label: "AI picked", tone: "purple" },
  user: { label: "Added by you", tone: "primary" },
  targeted: { label: "Targeted", tone: "blue" },
};

export const CATEGORY_META: Record<string, { label: string; icon: LucideIcon }> = {
  safety: { label: "Safety", icon: ShieldAlert },
  data: { label: "Data & privacy", icon: Lock },
  tools: { label: "Tools & access", icon: Wrench },
  quality: { label: "Quality", icon: Sparkles },
  limits: { label: "Limits", icon: Gauge },
};

export const CATEGORY_ORDER = ["safety", "data", "tools", "quality", "limits"];

const ICONS: Record<string, LucideIcon> = {
  BadgeCheck,
  Ban,
  Braces,
  Cpu,
  DatabaseZap,
  EyeOff,
  FileText,
  Filter,
  Gauge,
  Library,
  ListOrdered,
  Lock,
  MessageSquareOff,
  PlugZap,
  Puzzle,
  Ruler,
  ScanSearch,
  ShieldAlert,
  Unplug,
  // Category icons, built-in and the ones people can choose.
  Bookmark,
  Briefcase,
  Building2,
  Flag,
  Globe,
  Scale,
  Sparkles,
  Star,
  Tag,
  Wrench,
};

export function RuleIcon({ name, className }: { name: string; className?: string }) {
  const Icon = ICONS[name] ?? Shield;
  return <Icon className={className} />;
}

export function OutcomePill({ outcome }: { outcome: RuleOutcomeKind }) {
  const meta = OUTCOME_META[outcome] ?? OUTCOME_META.applied;
  return (
    <Pill tone={meta.tone}>
      {outcome === "passed" ? <CheckCircle2 className="size-2.5" /> : null}
      {meta.label}
    </Pill>
  );
}

export function EnforcementPill({ enforcement }: { enforcement: RuleEnforcement }) {
  const meta = ENFORCEMENT_META[enforcement] ?? ENFORCEMENT_META.warn;
  return (
    <Pill tone={meta.tone} title={meta.hint}>
      {meta.label}
    </Pill>
  );
}

export function SourcePill({ source }: { source: RuleAppliedBy }) {
  const meta = SOURCE_META[source] ?? SOURCE_META.user;
  return <Pill tone={meta.tone}>{meta.label}</Pill>;
}

/** Render a rule type's summary template locally, for the live editor preview. */
export function renderSummary(
  template: string,
  params: Record<string, unknown>,
  optionLabels: Record<string, Record<string, string>> = {},
): string {
  const values: Record<string, string> = {};
  for (const [key, value] of Object.entries(params)) {
    if (Array.isArray(value)) {
      const shown = value.map((v) => optionLabels[key]?.[String(v)] ?? String(v));
      values[key] = shown.length ? shown.join(", ") : "none";
    } else {
      values[key] = optionLabels[key]?.[String(value)] ?? String(value ?? "");
    }
  }
  const requiredKeys = params["required_keys"];
  const keys = Array.isArray(requiredKeys) ? (requiredKeys as string[]) : [];
  values["required_keys_suffix"] = keys.length ? ` with keys ${keys.join(", ")}` : "";
  if ("check_on" in params) {
    const checkOn: Record<string, string> = {
      message: "user message",
      answer: "agent answer",
      both: "messages and answers",
    };
    values["check_on"] = checkOn[String(params["check_on"])] ?? "user message";
  }
  return template.replace(/\{(\w+)\}/g, (_, k: string) => values[k] ?? "");
}
