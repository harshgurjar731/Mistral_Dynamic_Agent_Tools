import { AlertTriangle, Check, Loader2 } from "lucide-react";
import type { AgentConfigEvent } from "@/types";
import { cn } from "@/lib/utils";
import { tierIdentity } from "@/lib/status";

export interface TimelineStep {
  id: string;
  label: string;
  state: "active" | "completed" | "error";
  config?: AgentConfigEvent;
}

export function Timeline({ steps }: { steps: TimelineStep[] }) {
  if (steps.length === 0) return null;
  return (
    <ol className="relative space-y-3 pl-7">
      <span
        aria-hidden
        className="absolute top-2 bottom-2 left-[11px] w-px bg-gradient-to-b from-primary/50 via-border to-transparent"
      />
      {steps.map((step) => (
        <li key={step.id} className="relative">
          <span
            className={cn(
              "absolute top-0.5 -left-7 grid size-[22px] place-items-center rounded-full border",
              step.state === "completed" && "border-emerald/40 bg-emerald/15 text-emerald",
              step.state === "active" && "border-primary/50 bg-primary/15 text-primary",
              step.state === "error" && "border-red/40 bg-red/15 text-red",
            )}
          >
            {step.state === "completed" ? (
              <Check className="size-3" />
            ) : step.state === "error" ? (
              <AlertTriangle className="size-3" />
            ) : (
              <Loader2 className="size-3 animate-spin" />
            )}
          </span>

          <p
            className={cn(
              "text-sm",
              step.state === "active"
                ? "font-medium text-foreground"
                : step.state === "error"
                  ? "text-red"
                  : "text-muted-foreground",
            )}
          >
            {step.label}
          </p>

          {step.config ? <AgentConfigCard config={step.config} /> : null}
        </li>
      ))}
    </ol>
  );
}

function AgentConfigCard({ config }: { config: AgentConfigEvent }) {
  const tier = tierIdentity(config.tier);
  return (
    <div className="mt-2.5 rounded-2xl border border-border glass p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-semibold text-foreground">{config.agent_name}</span>
        {config.model ? (
          <span className="rounded-full border border-blue/30 bg-blue/10 px-2 py-0.5 font-mono text-[10px] text-blue">
            {config.model}
          </span>
        ) : null}
        {config.tier ? (
          <span
            className={cn(
              "rounded-full border px-2 py-0.5 text-[10px] font-medium",
              tier.bg,
              tier.border,
              tier.text,
            )}
          >
            {tier.label}
          </span>
        ) : null}
      </div>

      {config.tools?.length ? (
        <div className="mt-3">
          <p className="eyebrow">Equipped tools</p>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {config.tools.map((tool, i) => (
              <span
                key={`${tool}-${i}`}
                className="rounded-lg border border-border bg-background-elevated px-2 py-1 font-mono text-[10px] text-muted-foreground"
              >
                {typeof tool === "string" ? tool : JSON.stringify(tool)}
              </span>
            ))}
          </div>
        </div>
      ) : null}

      {config.connectors?.length ? (
        <div className="mt-3">
          <p className="eyebrow">Connectors</p>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {config.connectors.map((c, i) => (
              <span
                key={i}
                className="rounded-lg border border-cyan/25 bg-cyan/10 px-2 py-1 text-[10px] text-cyan"
              >
                {typeof c === "string" ? c : ((c as { name?: string }).name ?? "connector")}
              </span>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
