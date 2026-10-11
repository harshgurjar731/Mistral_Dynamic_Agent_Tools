import { memo } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import {
  AlertTriangle,
  Bot,
  Crosshair,
  Minus,
  PencilLine,
  Plus,
  Braces,
  Code,
  Flag,
  GitBranch,
  Info,
  Plug,
  Sparkles,
  Wrench,
} from "lucide-react";
import { STEP_TYPE_IDENTITY } from "@/lib/status";
import { cn } from "@/lib/utils";
import type { StepType } from "@/types";
import { summarizeStep, useStepCatalog } from "./stepSummary";
import type { StepFlowNode } from "./types";

const TYPE_ICON: Record<StepType, typeof Bot> = {
  agent: Bot,
  tool: Sparkles,
  connector: Plug,
  condition: GitBranch,
  transform: Code,
};

const MAX_CHIPS = 4;

/** How a proposed revision marks a step. */
const DIFF_STYLE = {
  added: {
    ring: "border-emerald/70 ring-2 ring-emerald/30",
    badge: "border-emerald/40 bg-emerald/15 text-emerald",
    icon: Plus,
    label: "New",
  },
  modified: {
    ring: "border-amber/70 ring-2 ring-amber/25",
    badge: "border-amber/40 bg-amber/15 text-amber",
    icon: PencilLine,
    label: "Changed",
  },
  removed: {
    ring: "border-red/60 border-dashed opacity-55",
    badge: "border-red/40 bg-red/15 text-red",
    icon: Minus,
    label: "Removed",
  },
} as const;

function StepNodeImpl({ data, selected }: NodeProps<StepFlowNode>) {
  const { step, isEntry, errorCount, warningCount, diff, focused } = data;
  const diffStyle = diff ? DIFF_STYLE[diff] : null;
  const catalog = useStepCatalog();
  const identity = STEP_TYPE_IDENTITY[step.type];
  const summary = summarizeStep(step, catalog);
  const Icon = TYPE_ICON[step.type];
  const extraChips = summary.chips.length - MAX_CHIPS;

  return (
    <div
      className={cn(
        "relative w-[280px] cursor-pointer rounded-2xl border backdrop-blur-xl transition glass hover:border-border-strong",
        selected ? "glow-ring border-primary/60" : "border-border",
        errorCount > 0 && "border-red/50",
        diffStyle?.ring,
        focused && !diffStyle && "border-primary/70 ring-2 ring-primary/30",
      )}
    >
      <Handle type="target" position={Position.Left} className="!bg-primary" />

      {diffStyle || focused ? (
        <div className="pointer-events-none absolute -top-2.5 left-3 flex gap-1">
          {diffStyle ? (
            <span
              className={cn(
                "inline-flex items-center gap-0.5 rounded-full border px-1.5 py-px text-[9px] font-semibold uppercase tracking-wide backdrop-blur-sm",
                diffStyle.badge,
              )}
            >
              <diffStyle.icon className="size-2.5" /> {diffStyle.label}
            </span>
          ) : null}
          {focused ? (
            <span className="inline-flex items-center gap-0.5 rounded-full border border-primary/40 bg-primary/15 px-1.5 py-px text-[9px] font-semibold uppercase tracking-wide text-primary backdrop-blur-sm">
              <Crosshair className="size-2.5" /> Focus
            </span>
          ) : null}
        </div>
      ) : null}

      {/* Type, entry flag and validation counts */}
      <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
        <span
          className={cn(
            "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium",
            identity.bg,
            identity.border,
            identity.text,
          )}
        >
          <Icon className="size-2.5" />
          {identity.label}
        </span>
        <div className="flex items-center gap-1">
          {step.parallel_group ? (
            <span
              title={`Parallel group ${step.parallel_group}`}
              className="max-w-20 truncate rounded-full border border-cyan/30 bg-cyan/10 px-1.5 py-0.5 font-mono text-[9px] text-cyan"
            >
              ∥ {step.parallel_group}
            </span>
          ) : null}
          {isEntry ? (
            <span
              title="Entry step"
              className="inline-flex items-center gap-0.5 rounded-full border border-emerald/30 bg-emerald/10 px-1.5 py-0.5 text-[9px] text-emerald"
            >
              <Flag className="size-2.5" /> Entry
            </span>
          ) : null}
          {errorCount > 0 ? (
            <span
              title="This step has errors"
              className="inline-flex items-center gap-0.5 rounded-full border border-red/30 bg-red/10 px-1.5 py-0.5 text-[9px] text-red"
            >
              <AlertTriangle className="size-2.5" /> {errorCount}
            </span>
          ) : null}
          {warningCount > 0 ? (
            <span
              title="This step has warnings"
              className="inline-flex items-center gap-0.5 rounded-full border border-amber/30 bg-amber/10 px-1.5 py-0.5 text-[9px] text-amber"
            >
              <Info className="size-2.5" /> {warningCount}
            </span>
          ) : null}
        </div>
      </div>

      <div className="space-y-2 px-3 py-2.5">
        {/* Name + step id */}
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-foreground" title={summary.title}>
            {summary.title}
          </p>
          {summary.title !== step.id ? (
            <p className="truncate font-mono text-[10px] text-muted-foreground">{step.id}</p>
          ) : null}
        </div>

        {step.description && step.description !== summary.title ? (
          <p className="line-clamp-2 text-[11px] leading-snug text-muted-foreground">
            {step.description}
          </p>
        ) : null}

        {/* Key facts */}
        {summary.facts.length > 0 ? (
          <div className="flex flex-wrap gap-1">
            {summary.facts.map((f) => (
              <span
                key={f.label}
                className={cn(
                  "inline-flex max-w-full items-center gap-1 truncate rounded-md border px-1.5 py-0.5 font-mono text-[9px]",
                  f.tone === "warn"
                    ? "border-amber/30 bg-amber/10 text-amber"
                    : "border-border bg-background-elevated/60 text-muted-foreground",
                )}
              >
                <span className="opacity-70">{f.label}</span>
                <span className="truncate text-foreground/90">{f.value}</span>
              </span>
            ))}
          </div>
        ) : null}

        {/* Tools / connectors / parameters */}
        {summary.chips.length > 0 ? (
          <div className="flex flex-wrap gap-1">
            {summary.chips.slice(0, MAX_CHIPS).map((c) => {
              const ChipIcon = c.kind === "tool" ? Wrench : c.kind === "connector" ? Plug : Braces;
              return (
                <span
                  key={`${c.kind}:${c.label}`}
                  className={cn(
                    "inline-flex max-w-[120px] items-center gap-1 rounded border px-1.5 py-0.5 text-[9px]",
                    c.kind === "tool" && "border-blue/25 bg-blue/5 text-blue",
                    c.kind === "connector" && "border-violet/25 bg-violet/5 text-violet",
                    c.kind === "param" && "border-cyan/25 bg-cyan/5 text-cyan",
                  )}
                >
                  <ChipIcon className="size-2.5 shrink-0" />
                  <span className="truncate font-mono">{c.label}</span>
                </span>
              );
            })}
            {extraChips > 0 ? (
              <span className="rounded border border-border px-1.5 py-0.5 font-mono text-[9px] text-muted-foreground">
                +{extraChips}
              </span>
            ) : null}
          </div>
        ) : null}

        {summary.preview ? (
          <p
            className="line-clamp-2 rounded-md bg-background-elevated/70 px-2 py-1 font-mono text-[10px] leading-snug text-muted-foreground"
            title={summary.preview}
          >
            {summary.preview}
          </p>
        ) : null}

        {summary.problem ? (
          <p className="inline-flex items-center gap-1 text-[10px] text-amber">
            <AlertTriangle className="size-2.5" /> {summary.problem}
          </p>
        ) : null}
      </div>

      <Handle type="source" position={Position.Right} className="!bg-primary" />
    </div>
  );
}

export const StepNode = memo(StepNodeImpl);

export const stepNodeTypes = { step: StepNode };
