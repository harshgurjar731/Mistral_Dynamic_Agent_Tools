import {
  AlertCircle,
  AlertTriangle,
  Bot,
  CheckCircle2,
  CircleSlash,
  GitBranch,
  Loader2,
  Wrench,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { useNavigate } from "@tanstack/react-router";
import { useCallback } from "react";
import type { RunKind, RunStatus } from "@/api/runs";
import type { TrackedRun } from "@/stores/runs";

export const RUN_KIND_META: Record<
  RunKind,
  {
    label: string;
    noun: string;
    icon: LucideIcon;
    text: string;
    chip: string;
    box: string;
    bar: string;
  }
> = {
  workflow_plan: {
    label: "Workflow plan",
    noun: "Workflow",
    icon: GitBranch,
    text: "text-primary",
    chip: "border-primary/25 bg-primary/10 text-primary",
    box: "border-primary/20 bg-primary/5",
    bar: "bg-primary",
  },
  agent: {
    label: "Agent creation",
    noun: "Agent",
    icon: Bot,
    text: "text-indigo",
    chip: "border-indigo/25 bg-indigo/10 text-indigo",
    box: "border-indigo/20 bg-indigo/5",
    bar: "bg-indigo",
  },
  tool_synthesis: {
    label: "Agent tool synthesis",
    noun: "Agent tool",
    icon: Wrench,
    text: "text-emerald",
    chip: "border-emerald/25 bg-emerald/10 text-emerald",
    box: "border-emerald/20 bg-emerald/5",
    bar: "bg-emerald",
  },
  activity_synthesis: {
    label: "Activity synthesis",
    noun: "Activity",
    icon: Zap,
    text: "text-pink",
    chip: "border-pink/25 bg-pink/10 text-pink",
    box: "border-pink/20 bg-pink/5",
    bar: "bg-pink",
  },
};

export const RUN_STATUS_META: Record<
  RunStatus,
  { label: string; icon: LucideIcon; chip: string; text: string; bar: string }
> = {
  running: {
    label: "Running",
    icon: Loader2,
    chip: "border-primary/25 bg-primary/10 text-primary",
    text: "text-primary",
    bar: "bg-primary",
  },
  completed: {
    label: "Done",
    icon: CheckCircle2,
    chip: "border-emerald/25 bg-emerald/10 text-emerald",
    text: "text-emerald",
    bar: "bg-emerald",
  },
  failed: {
    label: "Failed",
    icon: AlertCircle,
    chip: "border-red/25 bg-red/10 text-red",
    text: "text-red",
    bar: "bg-red",
  },
  cancelled: {
    label: "Stopped",
    icon: CircleSlash,
    chip: "border-border bg-background-elevated text-muted-foreground",
    text: "text-muted-foreground",
    bar: "bg-muted-foreground/60",
  },
  interrupted: {
    label: "Interrupted",
    icon: AlertTriangle,
    chip: "border-amber/25 bg-amber/10 text-amber",
    text: "text-amber",
    bar: "bg-amber",
  },
};

const str = (v: unknown) => (typeof v === "string" && v ? v : null);

/** What the run produced, by name — the workflow, agent, tool or activity. */
export function runOutputName(run: Pick<TrackedRun, "result">): string | null {
  const r = run.result ?? {};
  return str(r["workflow_name"]) ?? str(r["agent_name"]) ?? str(r["tool_name"]) ?? str(r["name"]);
}

/** `1:05`, `12:30`, `1:02:03`. */
export function formatElapsed(ms: number | null | undefined): string {
  if (ms == null) return "";
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

/** Open the page that shows a run. */
export function useOpenRun() {
  const navigate = useNavigate();
  return useCallback(
    (run: Pick<TrackedRun, "id" | "kind">) => {
      switch (run.kind) {
        case "workflow_plan":
          void navigate({ to: "/workflows/new/ai", search: { run: run.id } });
          break;
        case "agent":
          void navigate({ to: "/", search: { run: run.id } });
          break;
        case "tool_synthesis":
          void navigate({ to: "/tools" });
          break;
        case "activity_synthesis":
          void navigate({ to: "/workflows/activities" });
          break;
      }
    },
    [navigate],
  );
}
