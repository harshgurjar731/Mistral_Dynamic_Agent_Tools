import { useState } from "react";
import { ChevronDown, ShieldCheck } from "lucide-react";
import { cn } from "@/lib/utils";
import type { RuleOutcome } from "@/types";
import { OutcomePill } from "./RulePills";

/**
 * What the agent's rules decided on one turn, under the answer.
 *
 * Collapsed, it names only what needs attention ("1 fixed: Personal data
 * redaction") and counts the rest; expanded, it lists every rule's result.
 */
export function RuleOutcomeRow({ outcomes }: { outcomes: RuleOutcome[] }) {
  const [open, setOpen] = useState(false);
  if (!outcomes.length) return null;

  const notable = outcomes.filter(
    (o) => o.outcome === "blocked" || o.outcome === "fixed" || o.outcome === "warned",
  );
  const quiet = outcomes.length - notable.length;
  const worst = notable.some((o) => o.outcome === "blocked")
    ? "text-red"
    : notable.some((o) => o.outcome === "warned")
      ? "text-amber"
      : notable.length
        ? "text-cyan"
        : "text-emerald";

  return (
    <div className="mt-2 text-[11px]">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1.5 rounded-md px-1.5 py-0.5 text-muted-foreground transition hover:bg-surface-hover hover:text-foreground"
      >
        <ShieldCheck className={cn("size-3", worst)} />
        {notable.length ? (
          <span>
            {notable.map((o) => `${o.outcome}: ${o.name}`).join(" · ")}
            {quiet ? ` · ${quiet} passed` : ""}
          </span>
        ) : (
          <span>
            {outcomes.length} rule{outcomes.length === 1 ? "" : "s"} checked — all passed
          </span>
        )}
        <ChevronDown className={cn("size-3 transition-transform", open && "rotate-180")} />
      </button>
      {open ? (
        <ul className="mt-1.5 space-y-1 rounded-lg border border-border bg-background/50 p-2">
          {outcomes.map((o) => (
            <li key={o.rule_id} className="flex items-start gap-2">
              <OutcomePill outcome={o.outcome} />
              <span className="min-w-0 text-muted-foreground">
                <span className="text-foreground">{o.name}</span> — {o.message}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
