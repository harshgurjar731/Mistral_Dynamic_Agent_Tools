import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, Loader2 } from "lucide-react";
import { QK, rulesApi } from "@/api";
import { formatRelative } from "@/lib/status";
import { cn } from "@/lib/utils";
import type { RuleOutcomeKind } from "@/types";
import { OutcomePill, RuleIcon, SourcePill } from "./RulePills";

const CHECKPOINT_LABEL: Record<string, string> = {
  creation: "At creation",
  message: "User message",
  tool_call: "Tool call",
  answer: "Answer",
  run: "Run",
  synthesis: "Tool generation",
};

const COUNT_ORDER: { key: RuleOutcomeKind; label: string; className: string }[] = [
  { key: "blocked", label: "blocked", className: "text-red" },
  { key: "fixed", label: "fixed", className: "text-cyan" },
  { key: "warned", label: "warned", className: "text-amber" },
  { key: "passed", label: "passed", className: "text-emerald" },
];

/** Every rule on one agent, with what it has decided — the agent's rule output. */
export function RuleActivityList({ agentId }: { agentId: string }) {
  const [open, setOpen] = useState<string | null>(null);
  const query = useQuery({
    queryKey: QK.agentRuleActivity(agentId),
    queryFn: () => rulesApi.agentActivity(agentId),
  });

  if (query.isLoading) {
    return (
      <div className="flex items-center gap-2 p-5 text-xs text-muted-foreground">
        <Loader2 className="size-3.5 animate-spin" /> Loading rule activity…
      </div>
    );
  }
  const activity = query.data?.activity ?? [];
  if (!activity.length) {
    return <p className="p-5 text-xs text-muted-foreground">No rules apply to this agent.</p>;
  }

  return (
    <ul className="divide-y divide-border">
      {activity.map(({ rule, counts, last, recent }) => {
        const expanded = open === rule.id;
        return (
          <li key={rule.id}>
            <button
              type="button"
              onClick={() => setOpen(expanded ? null : rule.id)}
              className="flex w-full items-start gap-2.5 px-5 py-3 text-left transition hover:bg-surface-hover/40"
            >
              <RuleIcon name={rule.icon} className="mt-0.5 size-3.5 shrink-0 text-primary" />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-xs font-semibold text-foreground">{rule.name}</span>
                  <SourcePill source={rule.applied_by} />
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-2">
                  {last ? (
                    <>
                      <OutcomePill outcome={last.outcome} />
                      <span className="truncate text-[11px] text-muted-foreground">
                        {last.message} ·{" "}
                        {formatRelative(last.created_at ? `${last.created_at}Z` : null)}
                      </span>
                    </>
                  ) : (
                    <span className="text-[11px] text-muted-foreground">Not triggered yet</span>
                  )}
                </div>
                <div className="mt-1 flex flex-wrap gap-2 text-[10px]">
                  {COUNT_ORDER.filter((c) => counts[c.key]).map((c) => (
                    <span key={c.key} className={c.className}>
                      {counts[c.key]} {c.label}
                    </span>
                  ))}
                </div>
              </div>
              <ChevronDown
                className={cn(
                  "mt-0.5 size-3.5 text-muted-foreground transition-transform",
                  expanded && "rotate-180",
                )}
              />
            </button>
            {expanded ? (
              <div className="space-y-2 bg-background/40 px-5 pb-3 pt-1">
                <p className="text-[11px] text-muted-foreground">{rule.reason || rule.summary}</p>
                {recent.length ? (
                  <ul className="space-y-1.5">
                    {recent.map((e) => (
                      <li key={e.id} className="flex items-start gap-2 text-[11px]">
                        <OutcomePill outcome={e.outcome} />
                        <span className="min-w-0 flex-1 text-muted-foreground">
                          <span className="text-foreground">
                            {CHECKPOINT_LABEL[e.checkpoint] ?? e.checkpoint}
                          </span>
                          {" — "}
                          {e.message}
                        </span>
                        <span className="shrink-0 text-muted-foreground/70">
                          {formatRelative(e.created_at ? `${e.created_at}Z` : null)}
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
