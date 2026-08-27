import { AlertTriangle, Check, Cpu, Loader2, Wrench } from "lucide-react";
import { cn } from "@/lib/utils";

export interface PlannerPhase {
  id: string;
  label: string;
  state: "active" | "completed" | "error";
}

export interface PlannerArtifact {
  id: string;
  kind: "tool" | "agent";
  name: string;
  /** `reused` when the planner found an existing resource instead of making one. */
  reused: boolean;
  detail?: string;
}

export function PlannerPhases({ phases }: { phases: PlannerPhase[] }) {
  if (phases.length === 0) return null;
  return (
    <ol className="relative space-y-3 pl-7">
      <span
        aria-hidden
        className="absolute top-2 bottom-2 left-[11px] w-px bg-gradient-to-b from-primary/50 via-border to-transparent"
      />
      {phases.map((phase) => (
        <li key={phase.id} className="relative">
          <span
            className={cn(
              "absolute top-0.5 -left-7 grid size-[22px] place-items-center rounded-full border",
              phase.state === "completed" && "border-emerald/40 bg-emerald/15 text-emerald",
              phase.state === "active" && "border-primary/50 bg-primary/15 text-primary",
              phase.state === "error" && "border-red/40 bg-red/15 text-red",
            )}
          >
            {phase.state === "completed" ? (
              <Check className="size-3" />
            ) : phase.state === "error" ? (
              <AlertTriangle className="size-3" />
            ) : (
              <Loader2 className="size-3 animate-spin" />
            )}
          </span>
          <p
            className={cn(
              "text-sm",
              phase.state === "active"
                ? "font-medium text-foreground"
                : phase.state === "error"
                  ? "text-red"
                  : "text-muted-foreground",
            )}
          >
            {phase.label}
          </p>
        </li>
      ))}
    </ol>
  );
}

export function ArtifactList({ artifacts }: { artifacts: PlannerArtifact[] }) {
  if (artifacts.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">
        Tools and agents appear here as the planner reuses or builds them.
      </p>
    );
  }
  return (
    <ul className="space-y-1.5">
      {artifacts.map((a) => {
        const Icon = a.kind === "tool" ? Wrench : Cpu;
        return (
          <li
            key={a.id}
            className="flex items-center gap-2 rounded-lg border border-border bg-background-elevated/60 px-2.5 py-2"
          >
            <Icon
              className={cn("size-3.5 shrink-0", a.kind === "tool" ? "text-blue" : "text-purple")}
            />
            <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-foreground">
              {a.name}
            </span>
            <span
              className={cn(
                "shrink-0 rounded border px-1.5 py-0.5 font-mono text-[9px] font-bold uppercase",
                a.reused
                  ? "border-slate/30 bg-slate/10 text-slate"
                  : "border-emerald/30 bg-emerald/10 text-emerald",
              )}
            >
              {a.reused ? "reused" : "new"}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
