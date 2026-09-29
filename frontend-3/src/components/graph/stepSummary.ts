import { createContext, useContext } from "react";
import type {
  BuilderCatalog,
  CatalogAgent,
  CatalogConnector,
  CatalogTool,
  WorkflowStep,
} from "@/types";

/**
 * The builder catalog, made available to step nodes so a card can show what a
 * step is configured with (agent model, tools, activity parameters…) instead
 * of just its id. Optional — without it cards fall back to the raw config.
 */
export const StepCatalogContext = createContext<BuilderCatalog | undefined>(undefined);
export const useStepCatalog = () => useContext(StepCatalogContext);

export interface StepFact {
  label: string;
  value: string;
  tone?: "warn";
}

export interface StepSummary {
  /** Human name — agent / activity / connector name, else the step id. */
  title: string;
  /** Short key facts shown as pills (model, tier, branches…). */
  facts: StepFact[];
  /** Named capabilities: agent tools & connectors, activity parameters. */
  chips: { kind: "tool" | "connector" | "param"; label: string }[];
  /** One mono line of the most telling config (query, expression, code). */
  preview?: string;
  /** Something is missing that the step needs to run. */
  problem?: string;
  agent?: CatalogAgent;
  activity?: CatalogTool;
  connector?: CatalogConnector;
}

const str = (v: unknown) => (typeof v === "string" ? v : "");

function findTool(catalog: BuilderCatalog | undefined, name: string) {
  return (
    catalog?.activities?.find((t) => t.name === name) ?? catalog?.tools.find((t) => t.name === name)
  );
}

export function summarizeStep(step: WorkflowStep, catalog?: BuilderCatalog): StepSummary {
  const cfg = step.config ?? {};

  switch (step.type) {
    case "agent": {
      const agentId = str(cfg["agent_id"]);
      const agent = agentId ? catalog?.agents.find((a) => a.id === agentId) : undefined;
      const connectorNames = (agent?.connectors ?? []).map(
        (id) => catalog?.connectors.find((c) => c.id === id)?.name ?? id,
      );
      const inlineModel = str(cfg["model"]);
      const facts: StepFact[] = [];
      const model = agent?.model || inlineModel;
      if (model) facts.push({ label: "model", value: model.replace(/-latest$/, "") });
      const tier = step.tier || agent?.tier;
      if (tier) facts.push({ label: "tier", value: tier.replace("_", " ") });
      return {
        title: agent?.name ?? (agentId ? agentId : inlineModel ? "Inline agent" : step.id),
        facts,
        chips: [
          ...(agent?.tools ?? []).map((t) => ({ kind: "tool" as const, label: t })),
          ...connectorNames.map((c) => ({ kind: "connector" as const, label: c })),
        ],
        ...(str(cfg["query_template"]) ? { preview: str(cfg["query_template"]) } : {}),
        ...(!agentId && !inlineModel ? { problem: "No agent selected" } : {}),
        ...(agentId && catalog && !agent ? { problem: "Agent not found" } : {}),
        ...(agent ? { agent } : {}),
      };
    }

    case "tool": {
      const name = str(cfg["tool_name"]);
      const tool = name ? findTool(catalog, name) : undefined;
      const args = (cfg["arguments"] ?? cfg["arguments_template"] ?? {}) as Record<string, unknown>;
      const params = tool ? Object.keys(tool.parameters ?? {}) : Object.keys(args);
      const missing = (tool?.required ?? []).filter((p) => !(p in args));
      const mapped = Object.entries(args)
        .map(([k, v]) => `${k}=${typeof v === "string" ? v : JSON.stringify(v)}`)
        .join(", ");
      return {
        title: name || step.id,
        facts: [
          { label: "params", value: String(params.length) },
          ...(missing.length
            ? [{ label: "unmapped", value: String(missing.length), tone: "warn" as const }]
            : []),
        ],
        chips: params.map((p) => ({ kind: "param" as const, label: p })),
        ...(mapped ? { preview: mapped } : {}),
        ...(!name ? { problem: "No activity selected" } : {}),
        ...(tool ? { activity: tool } : {}),
      };
    }

    case "connector": {
      const id = str(cfg["connector_id"]);
      const connector = catalog?.connectors.find((c) => c.id === id);
      const toolName = str(cfg["tool_name"]);
      return {
        title: connector?.name ?? (str(cfg["connector_name"]) || id || step.id),
        facts: [
          ...(toolName ? [{ label: "tool", value: toolName }] : []),
          ...(connector && !connector.is_authenticated
            ? [{ label: "auth", value: "needed", tone: "warn" as const }]
            : []),
        ],
        chips: [],
        ...(!id ? { problem: "No connector selected" } : {}),
        ...(connector ? { connector } : {}),
      };
    }

    case "condition": {
      const t = str(cfg["true_step"]);
      const f = str(cfg["false_step"]);
      return {
        title: step.id,
        facts: [
          { label: "true →", value: t || "end" },
          { label: "false →", value: f || "end" },
        ],
        chips: [],
        ...(str(cfg["expression"]) ? { preview: str(cfg["expression"]) } : {}),
        ...(!str(cfg["expression"]) ? { problem: "No expression" } : {}),
      };
    }

    case "transform": {
      const code = str(cfg["transform_code"]);
      const firstLine = code.split("\n").find((l) => l.trim()) ?? "";
      const lines = code.split("\n").filter((l) => l.trim()).length;
      return {
        title: step.id,
        facts: lines ? [{ label: "lines", value: String(lines) }] : [],
        chips: [],
        ...(firstLine ? { preview: firstLine.trim() } : {}),
        ...(!code.trim() ? { problem: "No code" } : {}),
      };
    }
  }
}
