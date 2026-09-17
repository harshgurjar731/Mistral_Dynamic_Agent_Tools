import { Link } from "@tanstack/react-router";
import { Switch } from "@/components/ui/switch";
import { formatRelative } from "@/lib/status";
import { cn } from "@/lib/utils";
import type { Rule } from "@/types";
import { EnforcementPill, Pill, RuleIcon } from "./RulePills";

/** One rule on the Rules page: what it does, how strict it is, and whether it is on. */
export function RuleCard({
  rule,
  onToggle,
  toggling,
}: {
  rule: Rule;
  onToggle: (enabled: boolean) => void;
  toggling?: boolean;
}) {
  const usage = rule.usage ?? { agents: 0 };
  const isAgent = rule.scope === "agent";

  return (
    <div
      className={cn(
        "group relative flex h-full flex-col rounded-2xl border border-border/60 backdrop-blur-md transition-all duration-300",
        isAgent
          ? "hover:border-primary/30 hover:shadow-[0_0_32px_-8px_var(--primary)]"
          : "hover:border-blue/30 hover:shadow-[0_0_32px_-8px_var(--blue)]",
        !rule.enabled && "opacity-60",
      )}
      style={{ background: "var(--surface)" }}
    >
      {/* Hover glow accent */}
      <div
        className="pointer-events-none absolute -inset-px rounded-2xl opacity-0 transition-opacity duration-300 group-hover:opacity-100"
        style={{
          background: isAgent
            ? "linear-gradient(135deg, oklch(0.65 0.18 36 / 0.06), oklch(0.71 0.14 55 / 0.04), transparent 70%)"
            : "linear-gradient(135deg, oklch(0.62 0.16 250 / 0.07), oklch(0.68 0.12 230 / 0.04), transparent 70%)",
        }}
      />

      {/* Whole card opens the rule; interactive children sit above it */}
      <Link
        to="/rules/$id"
        params={{ id: rule.id }}
        className="absolute inset-0 z-0 rounded-2xl"
        aria-label={rule.name}
      />

      <div className="pointer-events-none relative z-[1] flex flex-1 flex-col p-5">
        {/* Header */}
        <div className="flex items-start gap-3">
          <div
            className={cn(
              "grid size-11 shrink-0 place-items-center rounded-xl border transition-all duration-300",
              "border-border/60 bg-background-elevated text-muted-foreground",
              isAgent
                ? "group-hover:border-primary/30 group-hover:bg-primary/10 group-hover:text-primary group-hover:shadow-[0_0_12px_-4px_var(--primary)]"
                : "group-hover:border-blue/30 group-hover:bg-blue/10 group-hover:text-blue group-hover:shadow-[0_0_12px_-4px_var(--blue)]",
            )}
          >
            <RuleIcon name={rule.icon} className="size-5" />
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="truncate text-sm font-semibold text-foreground">{rule.name}</h3>
            <p className="mt-0.5 line-clamp-2 text-xs leading-relaxed text-muted-foreground/70">
              {rule.summary || rule.description || "No summary provided"}
            </p>
          </div>
          <Switch
            checked={rule.enabled}
            disabled={toggling}
            onCheckedChange={onToggle}
            aria-label={rule.enabled ? `Switch off ${rule.name}` : `Switch on ${rule.name}`}
            className="pointer-events-auto relative z-10 mt-0.5 shrink-0"
          />
        </div>

        {/* Enforcement + source badges */}
        <div className="mt-3.5 flex flex-wrap items-center gap-1.5">
          <EnforcementPill enforcement={rule.enforcement} />
          <Pill tone={rule.always_on ? "slate" : "purple"}>
            {rule.always_on ? "Always on" : "AI decides"}
          </Pill>
          {rule.source === "recommended" ? <Pill tone="muted">Recommended</Pill> : null}
        </div>

        {/* Footer — coverage + timestamp, pinned to the bottom so rows line up */}
        <div className="mt-auto flex items-center justify-between gap-2 border-t border-border/40 pt-3.5 text-[11px] text-muted-foreground">
          <span className="truncate">
            {isAgent
              ? rule.always_on
                ? "All agents"
                : `${usage.agents} agent${usage.agents === 1 ? "" : "s"}`
              : rule.always_on
                ? "All workflows"
                : "Selected workflows"}
          </span>
          <span className="shrink-0 text-[9px] tabular-nums text-muted-foreground/35">
            {rule.updated_at ? formatRelative(rule.updated_at) : null}
          </span>
        </div>
      </div>
    </div>
  );
}
