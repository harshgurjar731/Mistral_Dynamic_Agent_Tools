import { STEP_TYPE_IDENTITY } from "@/lib/status";
import type { StepType } from "@/types";

const ORDER: StepType[] = ["agent", "tool", "connector", "condition", "transform"];

export function GraphLegend() {
  return (
    <div className="glass flex flex-wrap items-center gap-2 rounded-xl border border-border px-3 py-2 text-[10px]">
      {ORDER.map((t) => {
        const identity = STEP_TYPE_IDENTITY[t];
        return (
          <span key={t} className="inline-flex items-center gap-1.5">
            <span className={`size-2 rounded-full ${identity.bg} border ${identity.border}`} />
            <span className="text-muted-foreground">{identity.label}</span>
          </span>
        );
      })}
    </div>
  );
}
