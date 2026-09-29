/**
 * The words the planner uses for the things a workflow is built from, and how
 * each one looks. Every planner card reads from here so an activity is never
 * called a "function" in one place and a "tool" in another, and an agent tool
 * is never drawn in an activity's colour.
 */
import { Cpu, Server, Wrench, Zap, type LucideIcon } from "lucide-react";

export type BuildingBlock = "activity" | "agent_tool" | "agent" | "integration";

export interface BuildingBlockMeta {
  label: string;
  plural: string;
  icon: LucideIcon;
  text: string;
  chip: string;
  box: string;
  /** One line: what it is. */
  definition: string;
  /** Where it lives in the workflow — the distinction that matters most. */
  placement: string;
}

export const BLOCK: Record<BuildingBlock, BuildingBlockMeta> = {
  activity: {
    label: "Activity",
    plural: "Activities",
    icon: Zap,
    text: "text-pink",
    chip: "border-pink/25 bg-pink/10 text-pink",
    box: "border-pink/20 bg-pink/5",
    definition: "Deterministic code — the same input always gives the same output. No LLM.",
    placement: "Runs as its own step in the workflow graph.",
  },
  agent_tool: {
    label: "Agent tool",
    plural: "Agent tools",
    icon: Wrench,
    text: "text-cyan",
    chip: "border-cyan/25 bg-cyan/10 text-cyan",
    box: "border-cyan/20 bg-cyan/5",
    definition:
      "A capability an agent calls for itself while it reasons, when it decides it needs it.",
    placement: "Attached to an agent — never a step in the graph.",
  },
  agent: {
    label: "Agent",
    plural: "Agents",
    icon: Cpu,
    text: "text-indigo",
    chip: "border-indigo/25 bg-indigo/10 text-indigo",
    box: "border-indigo/20 bg-indigo/5",
    definition: "An LLM step, for work that needs judgement, interpretation or writing.",
    placement: "Runs as its own step in the workflow graph.",
  },
  integration: {
    label: "Integration",
    plural: "Integrations",
    icon: Server,
    text: "text-emerald",
    chip: "border-emerald/25 bg-emerald/10 text-emerald",
    box: "border-emerald/20 bg-emerald/5",
    definition: "Reads from or writes to a connected third-party system.",
    placement: "Runs as its own step in the workflow graph.",
  },
};

/** Execution modes and DAG step types, mapped onto the words above. */
export function blockForMode(mode: string | undefined | null): BuildingBlock | null {
  switch (mode) {
    case "activity":
    case "tool": // a DAG step of type "tool" is a standalone activity
      return "activity";
    case "agent":
      return "agent";
    case "connector":
      return "integration";
    default:
      return null;
  }
}
