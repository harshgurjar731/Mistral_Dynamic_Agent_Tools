/**
 * Decision cards for the workflow planner.
 *
 * The planner is a chain of single-decision layers, so every payload it emits
 * belongs to exactly one of them. `PLANNER_CARD_OWNER` attaches each card to its
 * layer's row in the PipelineTimeline; `LegacyPlannerTimeline` renders whatever
 * no layer owns (errors, and history entries recorded without a manifest).
 */
import { motion } from "framer-motion";
import type { ReactNode } from "react";
import {
  AlertCircle,
  AlertTriangle,
  ArrowRight,
  Check,
  CheckCircle2,
  Code2,
  Cpu,
  GitBranch,
  ListChecks,
  PackageCheck,
  PackagePlus,
  RefreshCw,
  Repeat,
  Server,
  Share2,
  Shield,
  ShieldAlert,
  Split,
  Wrench,
  Zap,
} from "lucide-react";
import { tierIdentity } from "@/lib/status";
import { BLOCK, blockForMode, type BuildingBlock } from "@/lib/terminology";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  LibraryProvisionedCard,
  ModerationGuardrailCard,
  Rationale,
  RulesSelectedCard,
  type GuardrailView,
  type LibraryProvisionedView,
  type RulesSelectedView,
} from "@/components/pipeline/DecisionCards";

/* ── Step model ────────────────────────────────────────────────────────── */

export type PlannerStepType =
  | "capabilities"
  | "execution_modes"
  | "reuse_plan"
  | "activity_plan"
  | "agent_designed"
  | "library_provisioned"
  | "topology"
  | "data_flow"
  | "workflow_guardrails"
  | "validation"
  | "tool_exists"
  | "tool_new"
  | "activity_new"
  | "agent_exists"
  | "agent_new"
  | "agent_rules_selected"
  | "workflow_rules_selected"
  | "workflow_ready"
  | "compiled"
  | "registered"
  | "fatal_error"
  | "error";

export interface PlannerStep {
  id: string;
  type: PlannerStepType;
  /** Parsed event payload, or the message for error steps. */
  content: unknown;
}

/** Which layer produced each kind of card. */
export const PLANNER_CARD_OWNER: Partial<Record<PlannerStepType, string>> = {
  capabilities: "goal_decomposition",
  execution_modes: "execution_mode",
  reuse_plan: "capability_reuse",
  // One consolidated plan per layer; the per-activity events are still
  // accepted for older history entries.
  activity_plan: "activity_gap",
  tool_exists: "activity_gap",
  tool_new: "activity_gap",
  activity_new: "activity_gap",
  agent_designed: "agent_design",
  library_provisioned: "agent_provisioning",
  agent_exists: "agent_provisioning",
  agent_new: "agent_provisioning",
  agent_rules_selected: "agent_rule_selection",
  topology: "step_topology",
  data_flow: "data_flow",
  workflow_guardrails: "workflow_guardrail",
  workflow_rules_selected: "workflow_rule_selection",
  validation: "workflow_validation",
  workflow_ready: "workflow_persistence",
  compiled: "workflow_compilation",
  registered: "workflow_registration",
};

export const PLANNER_CARD_EVENTS = new Set<string>(Object.keys(PLANNER_CARD_OWNER));

/* ── Payload shapes ────────────────────────────────────────────────────── */

type Kind = "agent" | "activity" | "connector";

interface CapabilitiesData {
  description?: string;
  capabilities?: Array<{
    id: string;
    name: string;
    purpose?: string;
    tier?: string;
    kind?: Kind;
    parallelisable?: boolean;
  }>;
  reasoning?: string;
}

interface ExecutionModesData {
  counts?: Partial<Record<Kind, number>>;
  pruned?: Array<{ capability: string; merged_into: string }>;
  decisions?: Array<{
    id: string;
    name: string;
    mode: Kind;
    agent_needs_tools?: boolean;
    rationale?: string;
  }>;
  reasoning?: string;
}

interface ReusePlanData {
  reused?: Array<{
    capability: string;
    agent_id?: string;
    reason?: string;
    guardrail_fit?: string;
  }>;
  to_create?: Array<{
    capability: string;
    name?: string;
    reason?: string;
    guardrail_fit?: string;
    guardrail_gap?: string;
  }>;
  reasoning?: string;
}

interface ActivityPlanData {
  note?: string;
  reused?: Array<{
    capability: string;
    capability_name?: string;
    tool_name: string;
    /** Why this unit of work is an activity rather than an agent. */
    why_activity?: string;
    /** Why this existing activity covers it. */
    reason?: string;
  }>;
  built?: Array<{
    capability?: string;
    capability_name?: string;
    tool_name: string;
    description?: string;
    parameters?: string[];
    required?: string[];
    status?: string;
    why_activity?: string;
    /** Why nothing existing covered it. */
    reason?: string;
  }>;
  failed?: Array<{ capability?: string; tool_name: string; error?: string; why_activity?: string }>;
  reasoning?: string;
}

/** One agent tool and why the agent calls it itself. */
interface ToolRationale {
  tool: string;
  why?: string;
  description?: string;
}

interface AgentDesignedData {
  capability?: string;
  agent_name?: string;
  tier?: string;
  model?: string;
  temperature?: number;
  tools?: string[];
  tool_rationale?: ToolRationale[];
  why_agent?: string;
  agent_needs_tools?: boolean;
  output_contract?: string;
  instruction_chars?: number;
  guardrails?: GuardrailView | null;
  requested_library?: { name?: string } | null;
  reasoning?: string;
}

interface AgentRecordData {
  capability_id?: string;
  agent_name?: string;
  model?: string;
  tier?: string;
  tools?: string[];
  tool_rationale?: ToolRationale[];
  why_agent?: string;
  output_contract?: string;
  reused?: boolean;
}

interface TopologyData {
  entry_step?: string;
  steps?: Array<{
    id: string;
    type?: string;
    next_steps?: string[];
    parallel_group?: string | null;
  }>;
  reasoning?: string;
}

interface DataFlowData {
  input_schema?: Array<{ name: string; required?: boolean }>;
  steps?: Array<{ id: string; config_keys?: string[] }>;
  reasoning?: string;
}

interface WorkflowGuardrailData {
  reviewed?: boolean;
  has_input_gate?: boolean;
  has_output_gate?: boolean;
  missing_gates?: Array<{ after_step?: string; purpose?: string }>;
  data_exposure?: Array<{ from?: string; to?: string; risk?: string }>;
  workflow_policy?: { pii_policy?: string };
  reasoning?: string;
}

interface ValidationData {
  valid?: boolean;
  error_count?: number;
  issues?: Array<{ severity?: string; message?: string; step_id?: string | null }>;
}

interface ToolData {
  tool_name?: string;
  status?: string;
}

interface WorkflowReadyData {
  workflow_name?: string;
  description?: string;
  step_count?: number;
  entry_step?: string;
  agents?: string[];
  dag?: { steps?: Array<{ type?: string }> };
}

interface CompiledData {
  file_path?: string;
  error?: string;
}

interface RegisteredData {
  mistral_workflow_id?: string | null;
  error?: string;
}

/* ── Shared bits ───────────────────────────────────────────────────────── */

const KIND_BLOCK: Record<Kind, BuildingBlock> = {
  agent: "agent",
  activity: "activity",
  connector: "integration",
};

const KIND_STYLE: Record<
  Kind,
  { icon: typeof Cpu; text: string; chip: string; label: string; plural: string }
> = {
  agent: BLOCK.agent,
  activity: BLOCK.activity,
  connector: BLOCK.integration,
};

/** A labelled reason line — "Why an activity: …". */
function Why({
  label,
  text,
  className,
}: {
  label: string;
  text?: string | undefined;
  className?: string;
}) {
  if (!text) return null;
  return (
    <p className={cn("mt-1 text-[11px] leading-relaxed text-muted-foreground", className)}>
      <span className="font-medium text-foreground/75">{label} </span>
      {text}
    </p>
  );
}

/** The one-line definition shown at the top of an activity or agent-tool section. */
function BlockDefinition({ block }: { block: BuildingBlock }) {
  const meta = BLOCK[block];
  const Icon = meta.icon;
  return (
    <div className={cn("mb-3 flex items-start gap-2 rounded-lg border px-3 py-2", meta.box)}>
      <Icon className={cn("mt-0.5 size-3 shrink-0", meta.text)} />
      <p className="text-[11px] leading-relaxed text-muted-foreground">
        <span className={cn("font-semibold", meta.text)}>{meta.label}: </span>
        {meta.definition} <span className="text-foreground/80">{meta.placement}</span>
      </p>
    </div>
  );
}

/** The agent tools one agent carries, each with why it is the agent's to call. */
function AgentToolList({
  tools,
  rationale,
  title = "Agent tools",
}: {
  tools: string[];
  rationale?: ToolRationale[] | undefined;
  title?: string;
}) {
  const meta = BLOCK.agent_tool;
  const byTool = new Map((rationale ?? []).map((r) => [r.tool, r]));
  return (
    <div className={cn("mt-3 rounded-lg border p-3", meta.box)}>
      <p
        className={cn(
          "mb-1 flex items-center gap-1.5 text-[10px] font-semibold tracking-wider uppercase",
          meta.text,
        )}
      >
        <Wrench className="size-3" /> {title} ({tools.length})
        <span className="font-normal tracking-normal normal-case text-muted-foreground">
          · attached to this agent, not steps in the graph
        </span>
      </p>
      {tools.length === 0 ? (
        <p className="text-[11px] text-muted-foreground">
          None — this agent reasons only over what the previous step hands it.
        </p>
      ) : (
        <div className="space-y-2">
          {tools.map((t) => {
            const r = byTool.get(t);
            return (
              <div key={t}>
                <div className="flex flex-wrap items-center gap-2">
                  <Chip className={meta.chip}>{t}</Chip>
                  {r?.description ? (
                    <span className="text-[10px] text-muted-foreground">{r.description}</span>
                  ) : null}
                </div>
                <Why label="Why an agent tool:" text={r?.why} />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function CardShell({
  icon,
  title,
  tone = "border-border bg-background-elevated/40",
  children,
}: {
  icon?: ReactNode;
  title?: ReactNode;
  tone?: string;
  children: ReactNode;
}) {
  return (
    <div className={cn("mt-2.5 rounded-xl border p-4 text-xs", tone)}>
      {title ? (
        <p className="eyebrow mb-3 flex items-center gap-1.5">
          {icon}
          {title}
        </p>
      ) : null}
      {children}
    </div>
  );
}

function Chip({ className, children }: { className: string; children: ReactNode }) {
  return (
    <span className={cn("rounded border px-1.5 py-0.5 font-mono text-[9px]", className)}>
      {children}
    </span>
  );
}

function StatusBadge({ className, children }: { className: string; children: ReactNode }) {
  return (
    <span
      className={cn(
        "ml-auto shrink-0 rounded-full border px-2 py-0.5 text-[9px] font-semibold tracking-wider uppercase",
        className,
      )}
    >
      {children}
    </span>
  );
}

/* ── Cards ─────────────────────────────────────────────────────────────── */

function CapabilitiesCard({ data }: { data: CapabilitiesData }) {
  const caps = data.capabilities ?? [];
  return (
    <CardShell title={`Required capabilities (${caps.length})`}>
      {data.description ? (
        <p className="mb-3 text-sm text-muted-foreground italic">“{data.description}”</p>
      ) : null}
      <div className="space-y-1.5">
        {caps.map((c, i) => {
          const style = c.kind ? KIND_STYLE[c.kind] : undefined;
          const Icon = style?.icon;
          return (
            <div key={c.id} className="flex items-start gap-2.5">
              <span className="w-5 shrink-0 pt-0.5 font-mono text-[10px] text-muted-foreground">
                {i + 1}.
              </span>
              {Icon && style ? <Icon className={cn("mt-0.5 size-3 shrink-0", style.text)} /> : null}
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium text-foreground">{c.name}</span>
                  {style && c.kind ? <Chip className={style.chip}>{style.label}</Chip> : null}
                  {c.tier ? (
                    <Chip className={cn(tierIdentity(c.tier).border, tierIdentity(c.tier).text)}>
                      {tierIdentity(c.tier).label}
                    </Chip>
                  ) : null}
                  {c.parallelisable ? (
                    <span className="text-[9px] tracking-wider text-amber/80 uppercase">
                      parallel
                    </span>
                  ) : null}
                </div>
                {c.purpose ? <p className="mt-0.5 text-muted-foreground">{c.purpose}</p> : null}
              </div>
            </div>
          );
        })}
      </div>
      <Rationale text={data.reasoning} />
    </CardShell>
  );
}

function ExecutionModesCard({ data }: { data: ExecutionModesData }) {
  const decisions = data.decisions ?? [];
  const counts = data.counts ?? {};
  const pruned = data.pruned ?? [];
  return (
    <CardShell icon={<Split className="size-3" />} title="How each step runs">
      <div className="mb-3 space-y-1">
        {(Object.keys(KIND_STYLE) as Kind[]).map((mode) => {
          const meta = BLOCK[KIND_BLOCK[mode]];
          return (
            <p key={mode} className="text-[11px] leading-relaxed text-muted-foreground">
              <span className={cn("font-semibold", meta.text)}>{meta.label}</span> —{" "}
              {meta.definition}
            </p>
          );
        })}
      </div>
      <div className="mb-4 flex flex-wrap gap-2 text-[11px]">
        {(Object.keys(KIND_STYLE) as Kind[]).map((mode) => {
          const n = counts[mode] ?? 0;
          return (
            <span key={mode} className={cn("rounded border px-2 py-0.5", KIND_STYLE[mode].chip)}>
              {n} {(n === 1 ? KIND_STYLE[mode].label : KIND_STYLE[mode].plural).toLowerCase()}
            </span>
          );
        })}
        {pruned.length > 0 ? (
          <span className="rounded border border-amber/25 bg-amber/10 px-2 py-0.5 text-amber">
            {pruned.length} removed
          </span>
        ) : null}
      </div>
      <div className="space-y-2">
        {decisions.map((d) => {
          const style = KIND_STYLE[d.mode] ?? KIND_STYLE.agent;
          const Icon = style.icon;
          return (
            <div key={d.id} className="flex items-start gap-2.5">
              <Icon className={cn("mt-0.5 size-3 shrink-0", style.text)} />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium text-foreground">{d.name}</span>
                  <Chip className={style.chip}>{style.label}</Chip>
                  {d.mode === "agent" ? (
                    d.agent_needs_tools ? (
                      <Chip className={BLOCK.agent_tool.chip}>needs agent tools</Chip>
                    ) : (
                      <span className="text-[9px] tracking-wider text-muted-foreground uppercase">
                        no agent tools
                      </span>
                    )
                  ) : null}
                </div>
                <Why
                  label={`Why ${d.mode === "activity" ? "an activity" : d.mode === "connector" ? "an integration" : "an agent"}:`}
                  text={d.rationale}
                />
              </div>
            </div>
          );
        })}
      </div>
      {pruned.length > 0 ? (
        <div className="mt-3 border-t border-border pt-3">
          <p className="mb-1.5 text-[10px] tracking-wider text-amber/80 uppercase">
            Removed as redundant
          </p>
          {pruned.map((pr, i) => (
            <p key={i} className="text-[11px] text-muted-foreground">
              <span className="font-mono text-foreground">{pr.capability}</span> merged into{" "}
              <span className="font-mono text-foreground">{pr.merged_into}</span>
            </p>
          ))}
        </div>
      ) : null}
      <Rationale text={data.reasoning} />
    </CardShell>
  );
}

function ReusePlanCard({ data }: { data: ReusePlanData }) {
  const reused = data.reused ?? [];
  const toCreate = data.to_create ?? [];
  return (
    <CardShell icon={<Repeat className="size-3" />} title="Reuse decision">
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <p className="mb-2 text-[10px] font-medium tracking-wider text-emerald/80 uppercase">
            Reusing ({reused.length})
          </p>
          <div className="space-y-1.5">
            {reused.map((r) => (
              <div key={r.capability} className="text-[11px]">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="font-mono text-foreground">{r.capability}</span>
                  {r.guardrail_fit === "adequate" ? (
                    <span className="flex items-center gap-1 text-[9px] tracking-wider text-emerald/80 uppercase">
                      <Shield className="size-2.5" /> safety ok
                    </span>
                  ) : null}
                </div>
                {r.reason ? <p className="mt-0.5 text-muted-foreground">{r.reason}</p> : null}
              </div>
            ))}
            {reused.length === 0 ? (
              <span className="text-muted-foreground">Nothing reusable</span>
            ) : null}
          </div>
        </div>
        <div>
          <p className="mb-2 text-[10px] font-medium tracking-wider text-indigo uppercase">
            Creating ({toCreate.length})
          </p>
          <div className="space-y-1.5">
            {toCreate.map((c) => (
              <div key={c.capability} className="text-[11px]">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="font-mono text-foreground">{c.name ?? c.capability}</span>
                  {c.guardrail_fit === "insufficient" ? (
                    <span className="flex items-center gap-1 rounded border border-amber/25 bg-amber/10 px-1.5 py-0.5 text-[9px] tracking-wider text-amber uppercase">
                      <ShieldAlert className="size-2.5" /> safety gap
                    </span>
                  ) : null}
                </div>
                {c.reason ? <p className="mt-0.5 text-muted-foreground">{c.reason}</p> : null}
                {c.guardrail_gap ? (
                  <p className="mt-0.5 text-amber">Missing: {c.guardrail_gap}</p>
                ) : null}
              </div>
            ))}
            {toCreate.length === 0 ? (
              <span className="text-muted-foreground">Nothing new needed</span>
            ) : null}
          </div>
        </div>
      </div>
      <Rationale text={data.reasoning} />
    </CardShell>
  );
}

/** The activities a workflow runs as steps: which were reused, which built, and why. */
function ActivityPlanCard({ data }: { data: ActivityPlanData }) {
  const reused = data.reused ?? [];
  const built = data.built ?? [];
  const failed = data.failed ?? [];
  const meta = BLOCK.activity;
  if (data.note && reused.length === 0 && built.length === 0) {
    return (
      <CardShell>
        <p className="text-muted-foreground">{data.note}</p>
      </CardShell>
    );
  }
  return (
    <CardShell
      icon={<Zap className={cn("size-3", meta.text)} />}
      title={`Activities (${reused.length + built.length})`}
      tone={meta.box}
    >
      <BlockDefinition block="activity" />

      {reused.length > 0 ? (
        <div className="mb-4">
          <p className="mb-2 text-[10px] tracking-wider text-emerald/80 uppercase">
            Reused existing activities ({reused.length})
          </p>
          <div className="space-y-2">
            {reused.map((r) => (
              <div
                key={r.capability}
                className="rounded-lg border border-border bg-background-elevated/50 px-3 py-2"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <PackageCheck className="size-3 shrink-0 text-muted-foreground" />
                  <span className="font-mono text-[11px] text-foreground">{r.tool_name}</span>
                  {r.capability_name ? (
                    <span className="text-[10px] text-muted-foreground">
                      step for {r.capability_name}
                    </span>
                  ) : null}
                  <StatusBadge className="border-border bg-background-elevated text-muted-foreground">
                    Reused activity
                  </StatusBadge>
                </div>
                <Why label="Why an activity:" text={r.why_activity} />
                <Why label="Why this one:" text={r.reason} />
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {built.length > 0 ? (
        <div>
          <p className={cn("mb-2 text-[10px] tracking-wider uppercase", meta.text)}>
            New activities built ({built.length})
          </p>
          <div className="space-y-2">
            {built.map((b) => (
              <div
                key={b.tool_name}
                className="rounded-lg border border-pink/20 bg-background-elevated/50 px-3 py-2"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <PackagePlus className={cn("size-3 shrink-0", meta.text)} />
                  <span className="font-mono text-[11px] text-foreground">{b.tool_name}</span>
                  {b.capability_name ? (
                    <span className="text-[10px] text-muted-foreground">
                      step for {b.capability_name}
                    </span>
                  ) : null}
                  <StatusBadge className={meta.chip}>
                    New activity{b.status === "approved" ? " · approved" : ""}
                  </StatusBadge>
                </div>
                {b.description ? (
                  <p className="mt-1 text-[11px] text-muted-foreground">{b.description}</p>
                ) : null}
                <Why label="Why an activity:" text={b.why_activity} />
                <Why label="Why a new one:" text={b.reason} />
                {b.parameters?.length ? (
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    {b.parameters.map((pn) => (
                      <span
                        key={pn}
                        className="rounded bg-pink/10 px-1.5 py-0.5 font-mono text-[10px] text-pink"
                      >
                        {pn}
                        {b.required?.includes(pn) ? "" : "?"}
                      </span>
                    ))}
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {failed.length > 0 ? (
        <div className="mt-3 border-t border-border pt-3">
          <p className="mb-1.5 text-[10px] tracking-wider text-amber/80 uppercase">
            Activities that could not be built ({failed.length}) — built at run time instead
          </p>
          {failed.map((f, i) => (
            <p key={i} className="text-[11px] text-amber">
              <span className="font-mono">{f.tool_name}</span>: {f.error}
            </p>
          ))}
        </div>
      ) : null}
      <Rationale text={data.reasoning} />
    </CardShell>
  );
}

function AgentDesignedCard({ data }: { data: AgentDesignedData }) {
  const tools = data.tools ?? [];
  const tier = tierIdentity(data.tier);
  return (
    <div className={cn("mt-2.5 rounded-xl border p-4 text-xs glass", tier.border)}>
      <div className="flex flex-wrap items-center gap-2">
        <Cpu className={cn("size-3.5", tier.text)} />
        <span className="font-semibold text-foreground">{data.agent_name}</span>
        <Chip className={cn(tier.bg, tier.border, tier.text)}>{tier.label}</Chip>
        {data.model ? (
          <span className="font-mono text-[10px] text-muted-foreground">
            {data.model}
            {data.temperature !== undefined ? ` · ${data.temperature}` : ""}
          </span>
        ) : null}
        {data.instruction_chars !== undefined ? (
          <span className="ml-auto text-[10px] text-muted-foreground">
            {data.instruction_chars} chars of instructions
          </span>
        ) : null}
      </div>
      {data.output_contract ? (
        <p className="mt-2 text-[11px] text-muted-foreground">
          <span className="text-muted-foreground/70">Returns — </span>
          <span className="text-foreground">{data.output_contract}</span>
        </p>
      ) : null}
      <Why label="Why an agent:" text={data.why_agent} className="mt-2" />
      <AgentToolList tools={tools} rationale={data.tool_rationale} />
      {data.requested_library?.name ? (
        <p className="mt-2 text-[11px] text-cyan">
          Needs a document library that does not exist yet — “{data.requested_library.name}” will be
          created empty.
        </p>
      ) : null}
      {data.guardrails ? <ModerationGuardrailCard data={data.guardrails} compact /> : null}
      <Rationale text={data.reasoning} />
    </div>
  );
}

function AgentRecordCard({ data, reused }: { data: AgentRecordData; reused: boolean }) {
  const tools = data.tools ?? [];
  const tier = tierIdentity(data.tier);
  return (
    <div className={cn("mt-2.5 rounded-xl border p-4 text-xs glass", tier.border)}>
      <div className="flex items-center gap-3">
        <div
          className={cn(
            "grid size-8 shrink-0 place-items-center rounded-lg border",
            tier.bg,
            tier.border,
          )}
        >
          <Cpu className={cn("size-3.5", tier.text)} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold text-foreground">{data.agent_name}</span>
            <Chip className={cn(tier.bg, tier.border, tier.text)}>{tier.label}</Chip>
          </div>
          {data.model ? (
            <p className="font-mono text-[10px] text-muted-foreground">{data.model}</p>
          ) : null}
        </div>
        <StatusBadge
          className={
            reused
              ? "border-border bg-background-elevated text-muted-foreground"
              : "border-emerald/25 bg-emerald/10 text-emerald"
          }
        >
          {reused ? "Reused" : "Created"}
        </StatusBadge>
      </div>
      <Why label="Why an agent:" text={data.why_agent} className="mt-2" />
      {reused ? (
        tools.length > 0 ? (
          <AgentToolList tools={tools} rationale={data.tool_rationale} />
        ) : (
          <p className="mt-2 text-[11px] text-muted-foreground">
            Reused as it is — keeps the agent tools it already has.
          </p>
        )
      ) : (
        <AgentToolList tools={tools} rationale={data.tool_rationale} title="Agent tools attached" />
      )}
    </div>
  );
}

function TopologyCard({ data }: { data: TopologyData }) {
  const steps = data.steps ?? [];
  return (
    <CardShell icon={<Share2 className="size-3" />} title={`Graph shape (${steps.length} steps)`}>
      <div className="space-y-1">
        {steps.map((st) => (
          <div key={st.id} className="flex flex-wrap items-center gap-2 text-[11px]">
            <span className="font-mono text-foreground">{st.id}</span>
            {st.id === data.entry_step ? (
              <Chip className="border-primary/25 bg-primary/10 text-primary">entry</Chip>
            ) : null}
            {st.type
              ? (() => {
                  const block = blockForMode(st.type);
                  return (
                    <Chip
                      className={
                        block
                          ? BLOCK[block].chip
                          : "border-border bg-background-elevated text-muted-foreground"
                      }
                    >
                      {block ? BLOCK[block].label : st.type}
                    </Chip>
                  );
                })()
              : null}
            {st.parallel_group ? (
              <span className="text-[9px] tracking-wider text-amber/80 uppercase">
                concurrent: {st.parallel_group}
              </span>
            ) : null}
            {st.next_steps?.length ? (
              <>
                <ArrowRight className="size-2.5 text-muted-foreground" />
                <span className="font-mono text-muted-foreground">{st.next_steps.join(", ")}</span>
              </>
            ) : null}
          </div>
        ))}
      </div>
      <Rationale text={data.reasoning} />
    </CardShell>
  );
}

function DataFlowCard({ data }: { data: DataFlowData }) {
  const inputs = data.input_schema ?? [];
  const steps = data.steps ?? [];
  return (
    <CardShell icon={<ArrowRight className="size-3" />} title="Data flow">
      {inputs.length > 0 ? (
        <div className="mb-3">
          <p className="mb-1.5 text-[10px] font-medium tracking-wider text-muted-foreground uppercase">
            Workflow inputs
          </p>
          <div className="flex flex-wrap gap-1.5">
            {inputs.map((i) => (
              <Chip key={i.name} className="border-indigo/25 bg-indigo/10 text-indigo">
                {i.name}
                {i.required ? "" : "?"}
              </Chip>
            ))}
          </div>
        </div>
      ) : null}
      <div className="space-y-1">
        {steps.map((st) => (
          <div key={st.id} className="flex items-center gap-2 text-[11px]">
            <span className="font-mono text-foreground">{st.id}</span>
            <span className="font-mono text-[10px] text-muted-foreground">
              {st.config_keys?.join(" / ") || "no config"}
            </span>
          </div>
        ))}
      </div>
      <Rationale text={data.reasoning} />
    </CardShell>
  );
}

function WorkflowGuardrailCard({ data }: { data: WorkflowGuardrailData }) {
  if (data.reviewed === false) {
    return (
      <div className="mt-2.5 flex items-center gap-2.5 rounded-xl border border-amber/25 bg-amber/5 p-3.5 text-xs">
        <AlertCircle className="size-3.5 shrink-0 text-amber" />
        <p className="text-amber">{data.reasoning}</p>
      </div>
    );
  }
  const missing = data.missing_gates ?? [];
  const exposure = data.data_exposure ?? [];
  const gate = (ok: boolean | undefined, label: string) => (
    <span className={cn("flex items-center gap-1", ok ? "text-emerald" : "text-amber")}>
      {ok ? <CheckCircle2 className="size-3" /> : <AlertCircle className="size-3" />} {label}
    </span>
  );
  return (
    <CardShell
      icon={<Shield className="size-3" />}
      title="Safety review"
      tone="border-emerald/20 bg-emerald/5"
    >
      <div className="mb-3 flex flex-wrap gap-3 text-[11px]">
        {gate(data.has_input_gate, "Input gate")}
        {gate(data.has_output_gate, "Output gate")}
        {data.workflow_policy?.pii_policy ? (
          <span className="text-muted-foreground">
            PII: <strong className="text-foreground">{data.workflow_policy.pii_policy}</strong>
          </span>
        ) : null}
      </div>
      {missing.length > 0 ? (
        <div className="mb-3">
          <p className="mb-1.5 text-[10px] font-medium tracking-wider text-amber/80 uppercase">
            Missing gates
          </p>
          {missing.map((g, i) => (
            <p key={i} className="text-[11px] text-muted-foreground">
              After <span className="font-mono text-foreground">{g.after_step}</span> — {g.purpose}
            </p>
          ))}
        </div>
      ) : null}
      {exposure.length > 0 ? (
        <div>
          <p className="mb-1.5 text-[10px] font-medium tracking-wider text-muted-foreground uppercase">
            Data exposure
          </p>
          {exposure.map((e, i) => (
            <p key={i} className="text-[11px] text-muted-foreground">
              <span className="font-mono text-foreground">{e.from}</span> →{" "}
              <span className="font-mono text-foreground">{e.to}</span>: {e.risk}
            </p>
          ))}
        </div>
      ) : null}
      <Rationale text={data.reasoning} />
    </CardShell>
  );
}

function ValidationCard({ data }: { data: ValidationData }) {
  const issues = data.issues ?? [];
  const valid = Boolean(data.valid);
  return (
    <div
      className={cn(
        "mt-2.5 rounded-xl border p-3.5 text-xs",
        valid ? "border-emerald/25 bg-emerald/5" : "border-red/25 bg-red/5",
      )}
    >
      <div className="flex items-center gap-2.5">
        <ListChecks className={cn("size-3.5", valid ? "text-emerald" : "text-red")} />
        <p className="font-semibold text-foreground">
          {valid
            ? "Validated — ready to register"
            : `${data.error_count ?? issues.length} error(s) — saved, but not registered`}
        </p>
      </div>
      {issues.length > 0 ? (
        <div className="mt-2.5 space-y-1">
          {issues.map((iss, i) => (
            <p
              key={i}
              className={cn("text-[11px]", iss.severity === "error" ? "text-red" : "text-amber")}
            >
              {iss.step_id ? <span className="font-mono">{iss.step_id}: </span> : null}
              {iss.message}
            </p>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function ToolRowCard({
  data,
  variant,
}: {
  data: ToolData;
  variant: "exists" | "new" | "activity";
}) {
  const style = {
    exists: {
      tone: BLOCK.agent_tool.box,
      icon: <Wrench className={cn("size-3.5", BLOCK.agent_tool.text)} />,
      badge: "border-border bg-background-elevated text-muted-foreground",
      label: "Existing agent tool",
    },
    new: {
      tone: BLOCK.agent_tool.box,
      icon: <PackagePlus className={cn("size-3.5", BLOCK.agent_tool.text)} />,
      badge: BLOCK.agent_tool.chip,
      label: data.status === "approved" ? "New agent tool · approved" : "New agent tool",
    },
    activity: {
      tone: BLOCK.activity.box,
      icon: <Zap className={cn("size-3.5", BLOCK.activity.text)} />,
      badge: BLOCK.activity.chip,
      label:
        data.status === "existing"
          ? "Activity step"
          : data.status === "approved"
            ? "New activity · approved"
            : "Activity",
    },
  }[variant];
  return (
    <div
      className={cn(
        "mt-2 flex items-center gap-2.5 rounded-lg border px-3.5 py-2 text-xs",
        style.tone,
      )}
    >
      {style.icon}
      <span className="font-mono text-foreground">{data.tool_name}</span>
      <StatusBadge className={style.badge}>{style.label}</StatusBadge>
    </div>
  );
}

function WorkflowReadyCard({ data }: { data: WorkflowReadyData }) {
  // Break the step count down by kind rather than reporting a bare total.
  const activityCount = (data.dag?.steps ?? []).filter((s) => s.type === "tool").length;
  return (
    <div className="mt-2.5 rounded-xl border border-primary/25 bg-primary/5 p-4 text-xs">
      <div className="mb-3 flex items-center gap-3">
        <div className="grid size-9 place-items-center rounded-lg bg-primary/15">
          <GitBranch className="size-4 text-primary" />
        </div>
        <div className="min-w-0">
          <p className="font-mono text-sm font-bold text-foreground">{data.workflow_name}</p>
          {data.description ? <p className="text-muted-foreground">{data.description}</p> : null}
        </div>
      </div>
      <div className="flex flex-wrap gap-4 text-muted-foreground">
        <span>
          <strong className="text-foreground">{data.step_count ?? 0}</strong> steps
        </span>
        <span>
          <strong className="text-foreground">{data.agents?.length ?? 0}</strong> agents
        </span>
        {activityCount > 0 ? (
          <span className="flex items-center gap-1">
            <Zap className="size-3 text-pink" />
            <strong className="text-foreground">{activityCount}</strong>{" "}
            {activityCount === 1 ? "activity step" : "activity steps"}
          </span>
        ) : null}
        {data.entry_step ? (
          <span>
            Entry: <strong className="font-mono text-foreground">{data.entry_step}</strong>
          </span>
        ) : null}
      </div>
    </div>
  );
}

function CompiledCard({ data }: { data: CompiledData }) {
  if (data.error) {
    return (
      <div className="mt-2.5 rounded-xl border border-red/25 bg-red/5 p-3.5">
        <p className="font-mono text-xs text-red">{data.error}</p>
      </div>
    );
  }
  return (
    <div className="mt-2.5 flex items-center gap-3 rounded-xl border border-primary/20 bg-background-elevated/40 p-3.5 text-xs">
      <div className="grid size-8 shrink-0 place-items-center rounded-lg bg-primary/15">
        <Code2 className="size-3.5 text-primary" />
      </div>
      <div className="min-w-0">
        <p className="font-semibold text-foreground">Compiled to Workflows SDK</p>
        {data.file_path ? (
          <p className="mt-0.5 truncate font-mono text-[10px] text-muted-foreground">
            {data.file_path}
          </p>
        ) : null}
      </div>
      <StatusBadge className="border-emerald/25 bg-emerald/10 text-emerald">Done</StatusBadge>
    </div>
  );
}

function RegisteredCard({ data }: { data: RegisteredData }) {
  if (data.error) {
    return (
      <div className="mt-2.5 rounded-xl border border-amber/25 bg-amber/5 p-3.5 text-xs">
        <div className="flex items-center gap-2">
          <Server className="size-3 shrink-0 text-amber" />
          <p className="font-medium text-amber">Registration pending</p>
        </div>
        <p className="mt-1 text-[10px] text-muted-foreground">{data.error}</p>
      </div>
    );
  }
  return (
    <div className="mt-2.5 flex items-center gap-3 rounded-xl border border-emerald/25 bg-emerald/5 p-3.5 text-xs">
      <div className="grid size-8 shrink-0 place-items-center rounded-lg bg-emerald/10">
        <Server className="size-3.5 text-emerald" />
      </div>
      <div className="min-w-0">
        <p className="font-semibold text-foreground">Registered on Workflow Server</p>
        {data.mistral_workflow_id ? (
          <p className="mt-0.5 truncate font-mono text-[10px] text-emerald">
            ID: {data.mistral_workflow_id}
          </p>
        ) : null}
      </div>
      <StatusBadge className="border-emerald/25 bg-emerald/10 text-emerald">Live</StatusBadge>
    </div>
  );
}

/* ── Activities vs agent tools, for the whole plan ─────────────────────── */

interface LedgerActivity {
  name: string;
  capability: string | undefined;
  status: "reused" | "new" | "failed";
  whyActivity: string | undefined;
  reason: string | undefined;
}

interface LedgerTool {
  tool: string;
  uses: Array<{ agent: string; why: string | undefined }>;
}

/**
 * What the plan ended up with, split by kind. Reasons missing from older runs
 * are recovered from the execution-mode decision for the same capability.
 */
function buildLedger(steps: PlannerStep[]): {
  activities: LedgerActivity[];
  tools: LedgerTool[];
} {
  const modeWhy = new Map<string, string>();
  for (const st of steps) {
    if (st.type !== "execution_modes") continue;
    for (const d of (st.content as ExecutionModesData).decisions ?? []) {
      if (d.rationale) modeWhy.set(d.id, d.rationale);
    }
  }
  const why = (cap: string | undefined, own: string | undefined) =>
    own || (cap ? modeWhy.get(cap) : undefined);

  const activities: LedgerActivity[] = [];
  const tools = new Map<string, LedgerTool>();
  const addTool = (tool: string, agent: string, reason: string | undefined) => {
    const entry = tools.get(tool) ?? { tool, uses: [] };
    const existing = entry.uses.find((u) => u.agent === agent);
    if (existing) existing.why = existing.why || reason;
    else entry.uses.push({ agent, why: reason });
    tools.set(tool, entry);
  };

  for (const st of steps) {
    if (st.type === "activity_plan") {
      const d = st.content as ActivityPlanData;
      for (const r of d.reused ?? []) {
        activities.push({
          name: r.tool_name,
          capability: r.capability_name ?? r.capability,
          status: "reused",
          whyActivity: why(r.capability, r.why_activity),
          reason: r.reason,
        });
      }
      for (const b of d.built ?? []) {
        activities.push({
          name: b.tool_name,
          capability: b.capability_name ?? b.capability,
          status: "new",
          whyActivity: why(b.capability, b.why_activity),
          reason: b.reason,
        });
      }
      for (const f of d.failed ?? []) {
        activities.push({
          name: f.tool_name,
          capability: f.capability,
          status: "failed",
          whyActivity: why(f.capability, f.why_activity),
          reason: f.error,
        });
      }
    } else if (
      st.type === "agent_designed" ||
      st.type === "agent_new" ||
      st.type === "agent_exists"
    ) {
      const a = st.content as AgentDesignedData & AgentRecordData;
      const agent = a.agent_name ?? "agent";
      const reasons = new Map((a.tool_rationale ?? []).map((r) => [r.tool, r.why]));
      for (const t of a.tools ?? []) addTool(t, agent, reasons.get(t));
    }
  }
  return { activities, tools: [...tools.values()] };
}

function BuildLedgerCard({ steps }: { steps: PlannerStep[] }) {
  const { activities, tools } = buildLedger(steps);
  if (activities.length === 0 && tools.length === 0) return null;
  const act = BLOCK.activity;
  const tool = BLOCK.agent_tool;
  const STATUS = {
    reused: { label: "Reused", cls: "border-border bg-background-elevated text-muted-foreground" },
    new: { label: "New", cls: act.chip },
    failed: { label: "Not built", cls: "border-amber/25 bg-amber/10 text-amber" },
  } as const;
  return (
    <CardShell
      icon={<ListChecks className="size-3" />}
      title="Activities vs agent tools in this workflow"
    >
      <div className="grid gap-3 md:grid-cols-2">
        <div className={cn("rounded-lg border p-3", act.box)}>
          <p className={cn("flex items-center gap-1.5 text-[11px] font-semibold", act.text)}>
            <Zap className="size-3" /> {act.plural} ({activities.length})
          </p>
          <p className="mt-0.5 mb-2.5 text-[10px] leading-relaxed text-muted-foreground">
            {act.placement} {act.definition}
          </p>
          {activities.length === 0 ? (
            <p className="text-[11px] text-muted-foreground">
              None — every step needs judgement, so each one is an agent.
            </p>
          ) : (
            <div className="space-y-2.5">
              {activities.map((a) => (
                <div key={`${a.status}-${a.name}`}>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="font-mono text-[11px] text-foreground">{a.name}</span>
                    <Chip className={STATUS[a.status].cls}>{STATUS[a.status].label}</Chip>
                  </div>
                  {a.capability ? (
                    <p className="text-[10px] text-muted-foreground">step for {a.capability}</p>
                  ) : null}
                  <Why label="Why an activity:" text={a.whyActivity} />
                  <Why
                    label={
                      a.status === "reused"
                        ? "Why this one:"
                        : a.status === "new"
                          ? "Why a new one:"
                          : "Error:"
                    }
                    text={a.reason}
                  />
                </div>
              ))}
            </div>
          )}
        </div>

        <div className={cn("rounded-lg border p-3", tool.box)}>
          <p className={cn("flex items-center gap-1.5 text-[11px] font-semibold", tool.text)}>
            <Wrench className="size-3" /> {tool.plural} ({tools.length})
          </p>
          <p className="mt-0.5 mb-2.5 text-[10px] leading-relaxed text-muted-foreground">
            {tool.placement} {tool.definition}
          </p>
          {tools.length === 0 ? (
            <p className="text-[11px] text-muted-foreground">
              None — no agent in this workflow needs to call anything for itself.
            </p>
          ) : (
            <div className="space-y-2.5">
              {tools.map((t) => (
                <div key={t.tool}>
                  <span className="font-mono text-[11px] text-foreground">{t.tool}</span>
                  {t.uses.map((u) => (
                    <div key={u.agent} className="mt-0.5">
                      <p className="flex items-center gap-1 text-[10px] text-muted-foreground">
                        <Cpu className="size-2.5 text-indigo" /> attached to {u.agent}
                      </p>
                      <Why label="Why an agent tool:" text={u.why} />
                    </div>
                  ))}
                </div>
              ))}
            </div>
          )}
          <p className="mt-3 border-t border-cyan/15 pt-2 text-[10px] leading-relaxed text-muted-foreground">
            Planning attaches agent tools from the existing catalogue — it does not build new ones.
          </p>
        </div>
      </div>
    </CardShell>
  );
}

/** The card for one payload. */
export function renderPlannerCard(step: PlannerStep): ReactNode {
  const c = step.content;
  switch (step.type) {
    case "capabilities":
      return <CapabilitiesCard data={c as CapabilitiesData} />;
    case "execution_modes":
      return <ExecutionModesCard data={c as ExecutionModesData} />;
    case "reuse_plan":
      return <ReusePlanCard data={c as ReusePlanData} />;
    case "activity_plan":
      return <ActivityPlanCard data={c as ActivityPlanData} />;
    case "agent_designed":
      return <AgentDesignedCard data={c as AgentDesignedData} />;
    case "library_provisioned":
      return <LibraryProvisionedCard data={c as LibraryProvisionedView} />;
    case "topology":
      return <TopologyCard data={c as TopologyData} />;
    case "data_flow":
      return <DataFlowCard data={c as DataFlowData} />;
    case "workflow_guardrails":
      return <WorkflowGuardrailCard data={c as WorkflowGuardrailData} />;
    case "validation":
      return <ValidationCard data={c as ValidationData} />;
    case "tool_exists":
      return <ToolRowCard data={c as ToolData} variant="exists" />;
    case "tool_new":
      return <ToolRowCard data={c as ToolData} variant="new" />;
    case "activity_new":
      return <ToolRowCard data={c as ToolData} variant="activity" />;
    case "agent_exists":
      return <AgentRecordCard data={c as AgentRecordData} reused />;
    case "agent_new":
      return <AgentRecordCard data={c as AgentRecordData} reused={false} />;
    case "agent_rules_selected":
    case "workflow_rules_selected":
      return <RulesSelectedCard data={c as RulesSelectedView} />;
    case "workflow_ready":
      return <WorkflowReadyCard data={c as WorkflowReadyData} />;
    case "compiled":
      return <CompiledCard data={c as CompiledData} />;
    case "registered":
      return <RegisteredCard data={c as RegisteredData} />;
    default:
      return null;
  }
}

/** Cards grouped under the layer that produced them. */
export function plannerLayerCards(steps: PlannerStep[]): Record<string, ReactNode> {
  const byLayer: Record<string, ReactNode[]> = {};
  for (const step of steps) {
    const owner = PLANNER_CARD_OWNER[step.type];
    if (!owner) continue;
    (byLayer[owner] ??= []).push(<div key={step.id}>{renderPlannerCard(step)}</div>);
  }
  const ready = steps.find((s) => s.type === "workflow_ready");
  if (ready) {
    (byLayer["workflow_persistence"] ??= []).push(
      <div key="build-ledger">
        <BuildLedgerCard steps={steps} />
      </div>,
    );
  }
  return Object.fromEntries(
    Object.entries(byLayer).map(([layer, nodes]) => [
      layer,
      <div className="space-y-2">{nodes}</div>,
    ]),
  );
}

/** The decision payloads behind each layer, for the raw JSON view. */
export function plannerLayerRaw(steps: PlannerStep[]): Record<string, unknown> {
  const byLayer: Record<string, unknown[]> = {};
  for (const step of steps) {
    const owner = PLANNER_CARD_OWNER[step.type];
    if (!owner || typeof step.content === "string") continue;
    (byLayer[owner] ??= []).push(step.content);
  }
  return Object.fromEntries(
    Object.entries(byLayer).map(([k, v]) => [k, v.length === 1 ? v[0] : v]),
  );
}

/* ── Rows no layer owns ────────────────────────────────────────────────── */

/**
 * Consecutive tool events and consecutive activity events collapse into one
 * labelled section each, so the timeline reads as "what was built for the
 * agents to call" and "what became a step of its own". Grouping is consecutive
 * only — the two kinds are synthesised in different phases.
 */
type PlannerRow =
  | { kind: "single"; key: string; step: PlannerStep }
  | { kind: "group"; family: "tool" | "activity"; key: string; steps: PlannerStep[] };

const GROUP_META = {
  tool: {
    label: BLOCK.agent_tool.plural,
    caption: "attached to agents — not steps in the graph",
    icon: Wrench,
    dot: "border-cyan/40 bg-cyan/15 text-cyan",
    text: BLOCK.agent_tool.text,
    box: BLOCK.agent_tool.box,
  },
  activity: {
    label: BLOCK.activity.plural,
    caption: "each one is its own step in the graph",
    icon: Zap,
    dot: "border-pink/40 bg-pink/15 text-pink",
    text: BLOCK.activity.text,
    box: BLOCK.activity.box,
  },
} as const;

function familyOf(type: PlannerStepType): "tool" | "activity" | null {
  if (type === "tool_exists" || type === "tool_new") return "tool";
  if (type === "activity_new") return "activity";
  return null;
}

function groupPlannerSteps(steps: PlannerStep[]): PlannerRow[] {
  const rows: PlannerRow[] = [];
  for (const step of steps) {
    const family = familyOf(step.type);
    if (!family) {
      rows.push({ kind: "single", key: step.id, step });
      continue;
    }
    const last = rows[rows.length - 1];
    if (last?.kind === "group" && last.family === family) last.steps.push(step);
    else rows.push({ kind: "group", family, key: step.id, steps: [step] });
  }
  return rows;
}

const isErrorStep = (s: PlannerStep) => s.type === "error" || s.type === "fatal_error";

/**
 * Rows drawn outside the layer chain. A live run leaves only errors here;
 * history entries recorded without a manifest render all their steps this way.
 */
export function LegacyPlannerTimeline({
  steps,
  onRestart,
  restartDisabled,
}: {
  steps: PlannerStep[];
  onRestart?: () => void;
  restartDisabled?: boolean;
}) {
  const rows = groupPlannerSteps(steps);
  if (rows.length === 0) return null;
  return (
    <ol className="relative space-y-4 pl-7">
      <span
        aria-hidden
        className="absolute top-2 bottom-2 left-[11px] w-px bg-gradient-to-b from-primary/50 via-border to-transparent"
      />
      {rows.map((row) => {
        if (row.kind === "group") {
          const meta = GROUP_META[row.family];
          const Icon = meta.icon;
          return (
            <motion.li
              key={row.key}
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              className="relative"
            >
              <span
                className={cn(
                  "absolute top-0.5 -left-7 grid size-[22px] place-items-center rounded-full border",
                  meta.dot,
                )}
              >
                <Check className="size-3" />
              </span>
              <div className={cn("rounded-xl border px-3 pt-2.5 pb-3", meta.box)}>
                <div className="flex items-center gap-1.5">
                  <Icon className={cn("size-3", meta.text)} />
                  <span className={cn("text-[10px] font-bold tracking-wider uppercase", meta.text)}>
                    {meta.label}
                  </span>
                  <span className={cn("text-[10px] opacity-60", meta.text)}>
                    {row.steps.length} · {meta.caption}
                  </span>
                </div>
                {row.steps.map((s) => (
                  <div key={s.id}>{renderPlannerCard(s)}</div>
                ))}
              </div>
            </motion.li>
          );
        }

        const step = row.step;
        const failed = isErrorStep(step);
        const tier =
          step.type === "agent_exists" || step.type === "agent_new"
            ? tierIdentity((step.content as AgentRecordData).tier)
            : null;
        return (
          <motion.li
            key={step.id}
            initial={{ opacity: 0, x: -8 }}
            animate={{ opacity: 1, x: 0 }}
            className="relative"
          >
            <span
              className={cn(
                "absolute top-0.5 -left-7 grid size-[22px] place-items-center rounded-full border",
                failed
                  ? "border-red/40 bg-red/15 text-red"
                  : tier
                    ? cn(tier.border, tier.bg, tier.text)
                    : "border-emerald/40 bg-emerald/15 text-emerald",
              )}
            >
              {failed ? <AlertTriangle className="size-3" /> : <Check className="size-3" />}
            </span>
            {failed ? (
              <div className="flex flex-col items-start gap-3 rounded-xl border border-red/25 bg-red/5 p-4">
                <p className="font-mono text-xs break-words text-red">{String(step.content)}</p>
                {onRestart ? (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={onRestart}
                    disabled={restartDisabled}
                  >
                    <RefreshCw className="size-3.5" /> Restart planning
                  </Button>
                ) : null}
              </div>
            ) : (
              renderPlannerCard(step)
            )}
          </motion.li>
        );
      })}
    </ol>
  );
}
