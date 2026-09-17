/**
 * Decision cards for the agent orchestrator. Each attaches to the layer that
 * produced it in the PipelineTimeline, so the reasoning sits beside the decision
 * rather than in a separate log.
 */
import type { ReactNode } from "react";
import { Cpu, Wrench } from "lucide-react";
import { tierIdentity } from "@/lib/status";
import { cn } from "@/lib/utils";
import type { RuleOutcome } from "@/types";
import {
  LibraryProvisionedCard,
  ModerationGuardrailCard,
  Rationale,
  RuleOutcomesCard,
  RulesSelectedCard,
  type GuardrailView,
  type LibraryProvisionedView,
  type RulesSelectedView,
} from "@/components/pipeline/DecisionCards";

export interface RequirementsView {
  intent?: string;
  task_type?: string;
  domain?: string;
  deliverable?: string;
  complexity?: string;
  success_criteria?: string[];
  risk_factors?: string[];
  reasoning?: string;
}

export interface ToolBuiltView {
  tool_name?: string;
  status?: string;
}

export interface AgentConfigView {
  agent_name?: string;
  description?: string;
  model?: string;
  temperature?: number;
  tools?: string[];
  connectors?: string[];
  libraries?: Array<{ id: string; name: string; created?: boolean }>;
  document_library_ids?: string[];
  knowledge_graph?: boolean;
  tier?: string;
}

/** Every payload the agent pipeline streams, keyed by SSE event name. */
export interface AgentDecisions {
  requirements?: RequirementsView;
  tool_new?: ToolBuiltView;
  library_provisioned?: LibraryProvisionedView;
  guardrails?: GuardrailView;
  agent_config?: AgentConfigView;
  rules_selected?: RulesSelectedView;
  rules_applied?: { outcomes?: RuleOutcome[] };
  rule_outcomes?: RuleOutcome[];
}

export const AGENT_DECISION_EVENTS = new Set<keyof AgentDecisions>([
  "requirements",
  "tool_new",
  "library_provisioned",
  "guardrails",
  "agent_config",
  "rules_selected",
  "rules_applied",
  "rule_outcomes",
]);

function RequirementsCard({ data }: { data: RequirementsView }) {
  const criteria = data.success_criteria ?? [];
  const risks = data.risk_factors ?? [];
  const facts: Array<[string, string | undefined]> = [
    ["Task", data.task_type],
    ["Domain", data.domain],
    ["Complexity", data.complexity],
  ];
  return (
    <div className="mt-2.5 rounded-xl border border-indigo/25 bg-indigo/5 p-4 text-xs">
      <div className="mb-3 flex flex-wrap gap-x-5 gap-y-1.5 text-[11px]">
        {facts
          .filter(([, v]) => v)
          .map(([k, v]) => (
            <span key={k} className="text-muted-foreground">
              {k}: <strong className="text-foreground">{v}</strong>
            </span>
          ))}
      </div>
      {data.deliverable ? (
        <p className="mb-3 text-foreground">
          <span className="text-muted-foreground">Deliverable — </span>
          {data.deliverable}
        </p>
      ) : null}
      {criteria.length > 0 ? (
        <div className="mb-2">
          <p className="eyebrow mb-1.5">Done when</p>
          <ul className="space-y-1">
            {criteria.map((c, i) => (
              <li key={i} className="flex items-start gap-1.5 text-muted-foreground">
                <span className="text-indigo">•</span> {c}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {risks.length > 0 ? (
        <div>
          <p className="mb-1 text-[10px] font-semibold tracking-wider text-amber/80 uppercase">
            Risks noted
          </p>
          <p className="text-muted-foreground">{risks.join("; ")}</p>
        </div>
      ) : null}
      <Rationale text={data.reasoning} />
    </div>
  );
}

function ToolBuiltCard({ data }: { data: ToolBuiltView }) {
  return (
    <div className="mt-2.5 flex items-center gap-2.5 rounded-xl border border-pink/25 bg-pink/5 px-4 py-2.5 text-xs">
      <Wrench className="size-3.5 text-pink" />
      <span className="font-mono font-medium text-foreground">{data.tool_name}</span>
      <span className="ml-auto rounded-full border border-pink/25 bg-pink/10 px-2 py-0.5 text-[9px] font-semibold tracking-wider text-pink uppercase">
        built
      </span>
    </div>
  );
}

function AgentConfigCard({ data }: { data: AgentConfigView }) {
  const tier = tierIdentity(data.tier);
  const tools = data.tools ?? [];
  const connectors = data.connectors ?? [];
  // Prefer the named form; fall back to bare ids for older history entries.
  const libraries =
    data.libraries ??
    (data.document_library_ids ?? []).map((id) => ({ id, name: id, created: false }));

  return (
    <div className={cn("mt-2.5 rounded-2xl border p-4 glass", tier.border)}>
      <div className="flex items-center gap-3">
        <div
          className={cn(
            "grid size-9 shrink-0 place-items-center rounded-xl border",
            tier.bg,
            tier.border,
          )}
        >
          <Cpu className={cn("size-4", tier.text)} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold text-foreground">{data.agent_name}</span>
            {data.tier ? (
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
          {data.model ? (
            <p className="font-mono text-[11px] text-muted-foreground">
              {data.model}
              {data.temperature !== undefined ? ` · temp ${data.temperature}` : ""}
            </p>
          ) : null}
        </div>
      </div>

      {data.description ? (
        <p className="mt-3 text-xs text-muted-foreground">{data.description}</p>
      ) : null}

      {tools.length ? (
        <div className="mt-3">
          <p className="eyebrow">Tools</p>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {tools.map((t) => (
              <span
                key={t}
                className="rounded-lg border border-pink/25 bg-pink/10 px-2 py-0.5 font-mono text-[10px] text-pink"
              >
                {t}
              </span>
            ))}
          </div>
        </div>
      ) : null}

      {connectors.length ? (
        <div className="mt-3">
          <p className="eyebrow">Integrations</p>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {connectors.map((c) => (
              <span
                key={c}
                className="rounded-lg border border-emerald/25 bg-emerald/10 px-2 py-0.5 font-mono text-[10px] text-emerald"
              >
                {c}
              </span>
            ))}
          </div>
        </div>
      ) : null}

      {libraries.length || data.knowledge_graph ? (
        <div className="mt-3">
          <p className="eyebrow">Knowledge</p>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {libraries.map((l) => (
              <span
                key={l.id}
                title={l.id}
                className="inline-flex items-center gap-1.5 rounded-lg border border-cyan/25 bg-cyan/10 px-2 py-0.5 text-[10px] text-cyan"
              >
                {l.name}
                <span
                  className={cn(
                    "text-[9px] tracking-wider uppercase",
                    l.created ? "text-amber" : "text-muted-foreground",
                  )}
                >
                  {l.created ? "new · empty" : "existing"}
                </span>
              </span>
            ))}
            {data.knowledge_graph ? (
              <span className="rounded-lg border border-cyan/25 bg-cyan/10 px-2 py-0.5 text-[10px] text-cyan">
                knowledge graph
              </span>
            ) : null}
          </div>
          {libraries.some((l) => l.created) ? (
            <p className="mt-1.5 text-[10px] text-muted-foreground">
              Upload documents to the new library and this agent will use them — no changes needed.
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

const isNotable = (o: RuleOutcome) =>
  o.outcome === "blocked" || o.outcome === "fixed" || o.outcome === "warned";

/** Cards keyed by the layer that owns them. */
export function agentLayerCards(d: AgentDecisions): Record<string, ReactNode> {
  const applied = d.rules_applied?.outcomes ?? [];
  const changed = applied.filter(isNotable);
  return {
    requirement_analysis: d.requirements ? <RequirementsCard data={d.requirements} /> : null,
    capability_gap: d.tool_new ? <ToolBuiltCard data={d.tool_new} /> : null,
    library_provisioning: d.library_provisioned ? (
      <LibraryProvisionedCard data={d.library_provisioned} />
    ) : null,
    guardrail_config: d.guardrails ? <ModerationGuardrailCard data={d.guardrails} /> : null,
    rule_selection: d.rules_selected ? <RulesSelectedCard data={d.rules_selected} /> : null,
    agent_assembly:
      d.agent_config || applied.length ? (
        <>
          {d.agent_config ? <AgentConfigCard data={d.agent_config} /> : null}
          <RuleOutcomesCard
            title={
              changed.length
                ? `Rules enforced at creation — ${changed.length} correction${changed.length === 1 ? "" : "s"}`
                : "Rules enforced at creation"
            }
            outcomes={changed.length ? changed : applied}
          />
        </>
      ) : null,
    execution: d.rule_outcomes?.length ? (
      <RuleOutcomesCard title="Rules on this answer" outcomes={d.rule_outcomes} />
    ) : null,
  };
}

/** Raw payloads keyed by owning layer, for the JSON view. */
export function agentLayerRaw(d: AgentDecisions): Record<string, unknown> {
  return {
    requirement_analysis: d.requirements,
    capability_gap: d.tool_new,
    library_provisioning: d.library_provisioned,
    guardrail_config: d.guardrails,
    rule_selection: d.rules_selected,
    agent_assembly: d.agent_config,
  };
}
