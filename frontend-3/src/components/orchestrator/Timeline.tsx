import {
  AlertTriangle,
  BookOpen,
  Check,
  CheckCircle2,
  Cpu,
  Loader2,
  Shield,
  Wrench,
} from "lucide-react";
import type { AgentConfigEvent } from "@/types";
import { cn } from "@/lib/utils";
import { tierIdentity } from "@/lib/status";

export interface RequirementsData {
  deliverable?: string;
  criteria?: string[];
  risks?: string[];
}

export interface ToolBuiltData {
  tool_name: string;
  purpose?: string;
}

export interface GuardrailData {
  policy?: string;
  categories?: string[];
  action?: string;
}

export interface LibraryProvisionedData {
  name?: string;
  id?: string;
  created?: boolean;
}

export interface ValidationData {
  valid?: boolean;
  issues?: string[];
}

export interface TimelineStep {
  id: string;
  label: string;
  state: "active" | "completed" | "error";
  config?: AgentConfigEvent;
  requirements?: RequirementsData;
  toolBuilt?: ToolBuiltData;
  guardrail?: GuardrailData;
  libraryProvisioned?: LibraryProvisionedData;
  validation?: ValidationData;
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
          {step.requirements ? <RequirementsCard data={step.requirements} /> : null}
          {step.toolBuilt ? <ToolBuiltCard data={step.toolBuilt} /> : null}
          {step.guardrail ? <GuardrailCard data={step.guardrail} /> : null}
          {step.libraryProvisioned ? (
            <LibraryProvisionedCard data={step.libraryProvisioned} />
          ) : null}
          {step.validation ? <ValidationCard data={step.validation} /> : null}
        </li>
      ))}
    </ol>
  );
}

function RequirementsCard({ data }: { data: RequirementsData }) {
  const criteria = data.criteria ?? [];
  const risks = data.risks ?? [];
  return (
    <div className="mt-2.5 rounded-2xl border border-indigo-500/20 bg-indigo-500/5 p-4 text-xs">
      {data.deliverable && (
        <p className="mb-2.5 text-foreground">
          <span className="font-semibold text-muted-foreground">Deliverable — </span>
          {data.deliverable}
        </p>
      )}
      {criteria.length > 0 && (
        <div className="mb-2">
          <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Done when
          </p>
          <ul className="space-y-1">
            {criteria.map((c, i) => (
              <li key={i} className="flex items-start gap-1.5 text-muted-foreground">
                <span className="text-indigo-400">•</span> {c}
              </li>
            ))}
          </ul>
        </div>
      )}
      {risks.length > 0 && (
        <div>
          <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-amber/80">
            Risks noted
          </p>
          <p className="text-muted-foreground">{risks.join("; ")}</p>
        </div>
      )}
    </div>
  );
}

function ToolBuiltCard({ data }: { data: ToolBuiltData }) {
  return (
    <div className="mt-2.5 flex items-center gap-2.5 rounded-xl border border-pink-500/25 bg-pink-500/5 px-4 py-2 text-xs">
      <Wrench className="size-3.5 text-pink-400" />
      <span className="font-mono font-medium text-foreground">{data.tool_name}</span>
      <span className="ml-auto rounded-full border border-pink-500/25 bg-pink-500/10 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-pink-400">
        built
      </span>
    </div>
  );
}

function GuardrailCard({ data }: { data: GuardrailData }) {
  const categories = data.categories ?? [];
  return (
    <div className="mt-2.5 rounded-xl border border-emerald-500/25 bg-emerald-500/5 p-3.5 text-xs">
      <div className="flex items-center gap-2">
        <Shield className="size-3.5 text-emerald-400" />
        <span className="font-semibold text-foreground">
          Guardrail Active: {data.policy || "Mistral Moderation"}
        </span>
        {data.action && (
          <span className="ml-auto rounded border border-emerald-500/25 bg-emerald-500/10 px-1.5 py-0.5 font-mono text-[9px] uppercase text-emerald-400">
            {data.action}
          </span>
        )}
      </div>
      {categories.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {categories.map((c, i) => (
            <span
              key={i}
              className="rounded bg-background-elevated px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground"
            >
              {c}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function LibraryProvisionedCard({ data }: { data: LibraryProvisionedData }) {
  return (
    <div className="mt-2.5 flex items-center gap-2 rounded-xl border border-cyan/25 bg-cyan/5 px-4 py-2 text-xs">
      <BookOpen className="size-3.5 text-cyan" />
      <span className="font-medium text-foreground">{data.name || data.id}</span>
      <span
        className={cn(
          "ml-auto text-[9px] font-semibold uppercase tracking-wider",
          data.created ? "text-amber" : "text-muted-foreground",
        )}
      >
        {data.created ? "new · empty" : "existing"}
      </span>
    </div>
  );
}

function ValidationCard({ data }: { data: ValidationData }) {
  const valid = data.valid !== false;
  const issues = data.issues ?? [];
  return (
    <div
      className={cn(
        "mt-2.5 rounded-xl border p-3 text-xs",
        valid
          ? "border-emerald/25 bg-emerald/5 text-emerald"
          : "border-amber/25 bg-amber/5 text-amber",
      )}
    >
      <div className="flex items-center gap-2">
        {valid ? <CheckCircle2 className="size-3.5" /> : <AlertTriangle className="size-3.5" />}
        <span className="font-semibold">
          {valid ? "Workflow validated successfully" : "Validation warnings noted"}
        </span>
      </div>
      {issues.length > 0 && (
        <ul className="mt-1.5 list-disc space-y-0.5 pl-5 text-muted-foreground">
          {issues.map((issue, idx) => (
            <li key={idx}>{issue}</li>
          ))}
        </ul>
      )}
    </div>
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
