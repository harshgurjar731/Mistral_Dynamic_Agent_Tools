import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Loader2 } from "lucide-react";
import { QK, rulesApi } from "@/api";
import { formatRelative } from "@/lib/status";
import { OutcomePill, RuleIcon, SourcePill } from "./RulePills";

/** A workflow's rules — who put each one there — and what they decided recently. */
export function WorkflowRulesPanel({ workflowName }: { workflowName: string }) {
  const query = useQuery({
    queryKey: QK.workflowRules(workflowName),
    queryFn: () => rulesApi.workflowRules(workflowName),
  });

  if (query.isLoading) {
    return (
      <div className="flex items-center gap-2 p-4 text-xs text-muted-foreground">
        <Loader2 className="size-3.5 animate-spin" /> Loading rules…
      </div>
    );
  }
  const rules = query.data?.rules ?? [];
  const events = (query.data?.events ?? []).filter((e) => e.outcome !== "passed").slice(0, 8);

  return (
    <div className="grid gap-4 p-4 lg:grid-cols-2">
      <div>
        <p className="eyebrow mb-2">Rules on this workflow</p>
        {rules.length ? (
          <ul className="space-y-2">
            {rules.map((r) => (
              <li key={r.id} className="flex items-start gap-2 text-xs">
                <RuleIcon name={r.icon} className="mt-0.5 size-3.5 shrink-0 text-blue" />
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="font-medium text-foreground">{r.name}</span>
                    <SourcePill source={r.applied_by} />
                  </div>
                  <p className="text-[11px] text-muted-foreground">{r.reason || r.summary}</p>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-xs text-muted-foreground">No workflow rules apply.</p>
        )}
        <p className="mt-3 text-[11px] text-muted-foreground">
          Change optional rules in the builder; manage all rules on the{" "}
          <Link to="/rules" className="text-primary hover:underline">
            Rules page
          </Link>
          .
        </p>
      </div>
      <div>
        <p className="eyebrow mb-2">Recent decisions</p>
        {events.length ? (
          <ul className="space-y-1.5">
            {events.map((e) => (
              <li key={e.id} className="flex items-start gap-2 text-[11px]">
                <OutcomePill outcome={e.outcome} />
                <span className="min-w-0 flex-1 text-muted-foreground">
                  <span className="text-foreground">{e.rule_name}</span> — {e.message}
                  {e.step_id ? (
                    <span className="text-muted-foreground/70"> (step {e.step_id})</span>
                  ) : null}
                </span>
                <span className="shrink-0 text-muted-foreground/70">
                  {formatRelative(e.created_at ? `${e.created_at}Z` : null)}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-xs text-muted-foreground">Nothing blocked, fixed or flagged yet.</p>
        )}
      </div>
    </div>
  );
}
