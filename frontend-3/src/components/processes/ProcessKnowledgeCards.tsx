/**
 * Timeline evidence for process knowledge, shared by both orchestration pages:
 *
 * * ``ProcessKnowledgeCard`` — under the process-knowledge row: what was used
 *   (uploaded / matched from inventory), or why nothing was, with the scored
 *   candidates so a miss is explainable.
 * * ``ProcessAppliedCard`` — once the build finishes: every element used, per
 *   layer, which is what makes a with/without comparison readable.
 */
import { Link } from "@tanstack/react-router";
import { BookOpenCheck, Info } from "lucide-react";
import type { DocumentStats, ProcessUse } from "@/api/processes";
import { cn } from "@/lib/utils";
import { ProcessUseList, StatsLine } from "./shared";

export interface ProcessKnowledgeEvent {
  enabled: boolean;
  mode: "uploaded" | "inventory" | "workflow" | "none";
  message: string;
  scope_label?: string;
  documents: Array<{
    id: number;
    title: string;
    version: number;
    concept_id: string | null;
    source?: string;
    path?: string;
    label?: string;
    role?: "primary" | "related";
    stats?: DocumentStats | undefined;
  }>;
  candidates: Array<{
    concept_id: string;
    label: string;
    score: number;
    why: string[];
    has_document: boolean;
    path: string;
  }>;
  elements?: Record<string, number>;
  objective?: string;
}

export interface ProcessAppliedEvent {
  usage: Record<string, ProcessUse[]>;
  documents: ProcessKnowledgeEvent["documents"];
  subject: { type: string; id: string | null; name?: string | null };
}

const MODE: Record<ProcessKnowledgeEvent["mode"], string> = {
  uploaded: "Uploaded with this request",
  inventory: "Matched from the process inventory",
  workflow: "The workflow's own process",
  none: "Not used",
};

export function ProcessKnowledgeCard({ data }: { data: ProcessKnowledgeEvent }) {
  if (!data.enabled) {
    return (
      <div className="mt-2.5 rounded-xl border border-border bg-background-elevated/40 p-3 text-xs text-muted-foreground">
        Process knowledge was off for this run — every layer used its usual prompt. Turn it on above
        the composer to compare.
      </div>
    );
  }
  const used = data.documents.length > 0;
  return (
    <div
      className={cn(
        "mt-2.5 rounded-xl border p-3.5 text-xs",
        used ? "border-indigo/25 bg-indigo/5" : "border-amber/25 bg-amber/5",
      )}
    >
      <p
        className={cn("flex items-center gap-1.5 font-medium", used ? "text-indigo" : "text-amber")}
      >
        {used ? <BookOpenCheck className="size-3.5" /> : <Info className="size-3.5" />}
        {MODE[data.mode]}
      </p>
      {data.message ? <p className="mt-1 text-muted-foreground">{data.message}</p> : null}

      {used ? (
        <ul className="mt-2.5 space-y-1.5">
          {data.documents.map((d) => (
            <li
              key={d.id}
              className="rounded-lg border border-border/60 bg-background px-2.5 py-1.5"
            >
              <div className="flex flex-wrap items-baseline gap-2">
                <span className="font-medium text-foreground">
                  {d.title} <span className="text-muted-foreground">v{d.version}</span>
                </span>
                {d.role === "related" ? (
                  <span className="text-[10px] text-muted-foreground">subprocess</span>
                ) : null}
                <StatsLine stats={d.stats} />
              </div>
              {d.path ? <p className="mt-0.5 text-[10px] text-muted-foreground">{d.path}</p> : null}
            </li>
          ))}
        </ul>
      ) : null}

      {data.candidates.length ? (
        <details className="mt-2.5">
          <summary className="cursor-pointer text-[11px] text-muted-foreground hover:text-foreground">
            {data.candidates.length} candidate process{data.candidates.length === 1 ? "" : "es"}{" "}
            scored
            {data.scope_label ? ` in ${data.scope_label}` : ""}
          </summary>
          <table className="mt-1.5 w-full text-[11px]">
            <tbody>
              {data.candidates.map((c) => (
                <tr key={c.concept_id} className="border-t border-border/40">
                  <td className="py-1 pr-2 text-foreground">{c.label}</td>
                  <td className="py-1 pr-2 font-mono tabular-nums">{c.score}</td>
                  <td className="py-1 pr-2 text-muted-foreground">
                    {c.has_document ? c.why.join("; ") || "scope" : "no valid document"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      ) : null}

      {!used ? (
        <p className="mt-2 text-[11px]">
          <Link to="/processes" className="text-primary hover:underline">
            Add a process for this scope
          </Link>{" "}
          or attach a document above the composer.
        </p>
      ) : null}
    </div>
  );
}

/** Layer names to readable labels, for the summary. Unknown names fall back. */
const LAYER_LABEL: Record<string, string> = {
  goal_decomposition: "Decompose the goal",
  execution_mode: "Choose how each step runs",
  agent_design: "Design each new agent",
  agent_rule_selection: "Rules for each agent",
  step_topology: "Graph shape",
  data_flow: "Data flow",
  workflow_guardrail: "Workflow guardrails",
  workflow_rule_selection: "Workflow rules",
  workflow_validation: "Validate",
  tool_selection: "Choose tools",
  connector_selection: "Choose integrations",
  library_selection: "Choose knowledge",
  identity: "Identity",
  guardrail_config: "Guardrails",
  rule_selection: "Rules",
  instruction_authoring: "Write instructions",
  revision_intent: "Understand the request",
};

export function ProcessAppliedCard({ data }: { data: ProcessAppliedEvent }) {
  const layers = Object.entries(data.usage).filter(([, uses]) => uses.length);
  const total = layers.reduce((n, [, u]) => n + u.length, 0);
  return (
    <div className="mt-2.5 rounded-xl border border-indigo/25 bg-indigo/5 p-3.5 text-xs">
      <p className="flex items-center gap-1.5 font-medium text-indigo">
        <BookOpenCheck className="size-3.5" />
        Process knowledge applied — {total} use{total === 1 ? "" : "s"} across {layers.length} layer
        {layers.length === 1 ? "" : "s"}
      </p>
      {data.subject?.id ? (
        <p className="mt-0.5 text-[11px] text-muted-foreground">
          Recorded against this {data.subject.type}; it now appears under its process on the
          ontology graph.
        </p>
      ) : null}
      <div className="mt-2.5 space-y-2.5">
        {layers.map(([layer, uses]) => (
          <div key={layer}>
            <p className="eyebrow mb-1">{LAYER_LABEL[layer] ?? layer.replace(/_/g, " ")}</p>
            <ProcessUseList uses={uses} />
          </div>
        ))}
        {!layers.length ? (
          <p className="text-muted-foreground">
            The documents were offered to every layer, but no layer reported relying on a specific
            element.
          </p>
        ) : null}
      </div>
    </div>
  );
}
