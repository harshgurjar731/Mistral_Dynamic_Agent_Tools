import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
  AlertTriangle,
  ArrowRight,
  Braces,
  ExternalLink,
  Flag,
  Info,
  Library,
  Loader2,
  Plug,
  ShieldCheck,
  Wrench,
} from "lucide-react";
import { agentsApi, librariesApi, QK } from "@/api";
import type { BuilderCatalog, ValidationIssue, WorkflowDefinition, WorkflowStep } from "@/types";
import { summarizeStep } from "@/components/graph/stepSummary";
import { CodeBlock } from "@/components/shared/CodeBlock";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { STEP_TYPE_IDENTITY } from "@/lib/status";
import { cn } from "@/lib/utils";

/**
 * Read-only view of one step: what it runs, how it is configured and how it
 * connects. Agent steps also load the agent itself, so instructions, sampling,
 * libraries and guardrails are visible without leaving the workflow.
 */
export function StepDetailsDialog({
  step,
  definition,
  catalog,
  issues = [],
  onOpenChange,
  onSelectStep,
}: {
  step: WorkflowStep | null;
  definition: WorkflowDefinition;
  catalog: BuilderCatalog | undefined;
  issues?: ValidationIssue[];
  onOpenChange: (open: boolean) => void;
  /** Jump to a neighbouring step from the Flow section. */
  onSelectStep: (id: string) => void;
}) {
  return (
    <Dialog open={step !== null} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[88vh] max-w-2xl flex-col gap-0 overflow-hidden border-border bg-background-elevated/95 p-0 backdrop-blur-xl">
        {step ? (
          <StepDetailsBody
            step={step}
            definition={definition}
            catalog={catalog}
            issues={issues.filter((i) => i.step_id === step.id)}
            onSelectStep={onSelectStep}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function StepDetailsBody({
  step,
  definition,
  catalog,
  issues,
  onSelectStep,
}: {
  step: WorkflowStep;
  definition: WorkflowDefinition;
  catalog: BuilderCatalog | undefined;
  issues: ValidationIssue[];
  onSelectStep: (id: string) => void;
}) {
  const identity = STEP_TYPE_IDENTITY[step.type];
  const summary = summarizeStep(step, catalog);
  const cfg = step.config ?? {};
  const incoming = definition.steps.filter(
    (s) =>
      s.next_steps.includes(step.id) ||
      s.config?.["true_step"] === step.id ||
      s.config?.["false_step"] === step.id,
  );

  return (
    <>
      <DialogHeader className="space-y-1 border-b border-border px-5 py-4 pr-12 text-left">
        <div className="flex flex-wrap items-center gap-2">
          <span
            className={cn(
              "rounded-full border px-2 py-0.5 text-[10px] font-medium",
              identity.bg,
              identity.border,
              identity.text,
            )}
          >
            {identity.label}
          </span>
          {step.id === definition.entry_step ? (
            <span className="inline-flex items-center gap-1 rounded-full border border-emerald/30 bg-emerald/10 px-2 py-0.5 text-[10px] text-emerald">
              <Flag className="size-2.5" /> Entry step
            </span>
          ) : null}
          {step.tier ? <span className="technical-label">tier · {step.tier}</span> : null}
        </div>
        <DialogTitle className="text-lg font-semibold text-foreground">{summary.title}</DialogTitle>
        <DialogDescription className="font-mono text-[11px] text-muted-foreground">
          step id · {step.id}
        </DialogDescription>
      </DialogHeader>

      <div className="custom-scrollbar flex-1 space-y-5 overflow-y-auto px-5 py-4">
        {step.description ? (
          <p className="text-sm leading-relaxed text-muted-foreground">{step.description}</p>
        ) : null}

        {issues.length > 0 || summary.problem ? (
          <div className="space-y-1.5">
            {summary.problem ? <IssueRow severity="warning" message={summary.problem} /> : null}
            {issues.map((i, n) => (
              <IssueRow key={n} severity={i.severity} message={i.message} />
            ))}
          </div>
        ) : null}

        {step.type === "agent" ? <AgentSection step={step} catalog={catalog} /> : null}

        {step.type === "tool" ? (
          <Section title="Activity">
            <Facts
              rows={[
                ["Function", <Mono key="f">{String(cfg["tool_name"] ?? "—")}</Mono>],
                ["Source", summary.activity?.source ?? "—"],
              ]}
            />
            {summary.activity?.description ? (
              <p className="mt-2 text-xs text-muted-foreground">{summary.activity.description}</p>
            ) : null}
            <ParamsTable
              params={summary.activity?.parameters ?? {}}
              required={summary.activity?.required ?? []}
              args={
                (cfg["arguments"] ?? cfg["arguments_template"] ?? {}) as Record<string, unknown>
              }
            />
          </Section>
        ) : null}

        {step.type === "connector" ? (
          <Section title="Connector">
            <Facts
              rows={[
                ["Connector", summary.connector?.name ?? String(cfg["connector_id"] ?? "—")],
                ["Tool", <Mono key="t">{String(cfg["tool_name"] ?? "—")}</Mono>],
                [
                  "Authentication",
                  summary.connector
                    ? summary.connector.is_authenticated
                      ? "connected"
                      : "needs auth"
                    : "—",
                ],
                ...(cfg["credentials_name"]
                  ? ([["Credentials", String(cfg["credentials_name"])]] as [string, ReactNode][])
                  : []),
              ]}
            />
            <JsonBlock label="Arguments" value={cfg["arguments"]} />
          </Section>
        ) : null}

        {step.type === "condition" ? (
          <Section title="Condition">
            <CodeBlock code={String(cfg["expression"] ?? "")} className="text-xs" />
            <div className="mt-3 grid grid-cols-2 gap-2">
              <BranchCard
                label="When true"
                target={String(cfg["true_step"] ?? "")}
                tone="emerald"
                onSelect={onSelectStep}
              />
              <BranchCard
                label="When false"
                target={String(cfg["false_step"] ?? "")}
                tone="amber"
                onSelect={onSelectStep}
              />
            </div>
          </Section>
        ) : null}

        {step.type === "transform" ? (
          <Section title="Transform code">
            <CodeBlock
              code={String(cfg["transform_code"] ?? "")}
              className="custom-scrollbar max-h-72 overflow-auto text-xs"
            />
          </Section>
        ) : null}

        <Section title="Flow">
          <Facts
            rows={[
              [
                "Runs after",
                incoming.length ? (
                  <StepLinks key="in" ids={incoming.map((s) => s.id)} onSelect={onSelectStep} />
                ) : (
                  "— (start)"
                ),
              ],
              [
                "Continues to",
                step.next_steps.length ? (
                  <StepLinks key="out" ids={step.next_steps} onSelect={onSelectStep} />
                ) : (
                  "— (end)"
                ),
              ],
              ...(step.parallel_group
                ? ([["Parallel group", <Mono key="p">{step.parallel_group}</Mono>]] as [
                    string,
                    ReactNode,
                  ][])
                : []),
            ]}
          />
        </Section>
      </div>
    </>
  );
}

/* ── Agent: catalog summary plus the full agent record ─────────────────── */

function AgentSection({
  step,
  catalog,
}: {
  step: WorkflowStep;
  catalog: BuilderCatalog | undefined;
}) {
  const cfg = step.config ?? {};
  const agentId = typeof cfg["agent_id"] === "string" ? cfg["agent_id"] : "";
  const catalogAgent = agentId ? catalog?.agents.find((a) => a.id === agentId) : undefined;

  const agentQuery = useQuery({
    queryKey: QK.agent(agentId),
    queryFn: () => agentsApi.get(agentId),
    enabled: Boolean(agentId),
    staleTime: 60_000,
  });
  const librariesQuery = useQuery({
    queryKey: QK.libraries(),
    queryFn: librariesApi.list,
    enabled: Boolean(agentQuery.data?.document_library_ids?.length),
    staleTime: 60_000,
  });
  const agent = agentQuery.data;

  const tools = catalogAgent?.tools ?? [];
  const connectorNames = (catalogAgent?.connectors ?? []).map(
    (id) => catalog?.connectors.find((c) => c.id === id)?.name ?? id,
  );
  const libraryNames = (agent?.document_library_ids ?? []).map(
    (id) => librariesQuery.data?.find((l) => l.id === id)?.name ?? id,
  );
  const sampling = (
    [
      ["Temperature", agent?.temperature],
      ["Top P", agent?.top_p],
      ["Max tokens", agent?.max_tokens],
      ["Random seed", agent?.random_seed],
      ["Frequency penalty", agent?.frequency_penalty],
      ["Presence penalty", agent?.presence_penalty],
    ] as const
  ).filter(([, v]) => v !== null && v !== undefined);

  if (!agentId) {
    return (
      <Section title="Agent">
        <Facts
          rows={[
            ["Mode", "Inline (no registered agent)"],
            ["Model", <Mono key="m">{String(cfg["model"] ?? "—")}</Mono>],
          ]}
        />
        {cfg["instructions"] ? (
          <TextBlock label="Instructions" text={String(cfg["instructions"])} />
        ) : null}
        {cfg["query_template"] ? (
          <TextBlock label="Query template" text={String(cfg["query_template"])} mono />
        ) : null}
      </Section>
    );
  }

  return (
    <>
      <Section
        title="Agent"
        action={
          <Button variant="outline" size="sm" className="h-7 text-[11px]" asChild>
            <Link to="/agents/$id" params={{ id: agentId }}>
              Open in Agent Studio <ExternalLink className="size-3" />
            </Link>
          </Button>
        }
      >
        <Facts
          rows={[
            ["Agent id", <Mono key="id">{agentId}</Mono>],
            ["Model", <Mono key="m">{agent?.model ?? catalogAgent?.model ?? "—"}</Mono>],
            ["Tier", agent?.tier ?? catalogAgent?.tier ?? "—"],
          ]}
        />
        {agent?.description || catalogAgent?.description ? (
          <p className="mt-2 text-xs text-muted-foreground">
            {agent?.description ?? catalogAgent?.description}
          </p>
        ) : null}
        {cfg["query_template"] ? (
          <TextBlock label="Query template (this step)" text={String(cfg["query_template"])} mono />
        ) : null}
        {agentQuery.isLoading ? (
          <p className="mt-3 flex items-center gap-1.5 text-xs text-muted-foreground">
            <Loader2 className="size-3 animate-spin" /> Loading agent configuration…
          </p>
        ) : agentQuery.isError ? (
          <p className="mt-3 text-xs text-amber">
            Could not load the agent — it may have been deleted.
          </p>
        ) : agent?.instructions ? (
          <TextBlock label="Instructions" text={agent.instructions} />
        ) : null}
      </Section>

      <Section title="Capabilities">
        <ChipGroup label="Tools" icon={<Wrench className="size-2.5" />} items={tools} tone="blue" />
        <ChipGroup
          label="Connectors"
          icon={<Plug className="size-2.5" />}
          items={connectorNames}
          tone="violet"
        />
        <ChipGroup
          label="Document libraries"
          icon={<Library className="size-2.5" />}
          items={libraryNames}
          tone="emerald"
        />
      </Section>

      {agent ? (
        <Section title="Model settings & safety">
          <Facts
            rows={[
              ...sampling.map(
                ([k, v]) => [k, <Mono key={k}>{String(v)}</Mono>] as [string, ReactNode],
              ),
              ...(sampling.length === 0
                ? ([["Sampling", "model defaults"]] as [string, ReactNode][])
                : []),
              [
                "Guardrails",
                agent.guardrails ? (
                  <span key="g" className="inline-flex items-center gap-1 text-emerald">
                    <ShieldCheck className="size-3" /> moderation on
                  </span>
                ) : (
                  "none"
                ),
              ],
            ]}
          />
        </Section>
      ) : null}
    </>
  );
}

/* ── Small building blocks ─────────────────────────────────────────────── */

function Section({
  title,
  action,
  children,
}: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section>
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="eyebrow">{title}</h3>
        {action}
      </div>
      {children}
    </section>
  );
}

function Facts({ rows }: { rows: [string, ReactNode][] }) {
  return (
    <dl className="grid grid-cols-[140px_1fr] gap-x-3 gap-y-1.5 rounded-lg border border-border bg-background/40 p-3 text-xs">
      {rows.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="text-muted-foreground">{k}</dt>
          <dd className="min-w-0 break-words text-foreground">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

function Mono({ children }: { children: ReactNode }) {
  return <span className="font-mono text-[11px]">{children}</span>;
}

function TextBlock({ label, text, mono }: { label: string; text: string; mono?: boolean }) {
  return (
    <div className="mt-3">
      <p className="mb-1 text-[11px] font-medium text-muted-foreground">{label}</p>
      <pre
        className={cn(
          "custom-scrollbar max-h-56 overflow-auto whitespace-pre-wrap rounded-lg border border-border bg-background/60 p-3 text-xs leading-relaxed text-foreground",
          mono ? "font-mono" : "font-sans",
        )}
      >
        {text}
      </pre>
    </div>
  );
}

function JsonBlock({ label, value }: { label: string; value: unknown }) {
  if (!value || (typeof value === "object" && Object.keys(value).length === 0)) return null;
  return <TextBlock label={label} text={JSON.stringify(value, null, 2)} mono />;
}

function ChipGroup({
  label,
  icon,
  items,
  tone,
}: {
  label: string;
  icon: ReactNode;
  items: string[];
  tone: "blue" | "violet" | "emerald";
}) {
  return (
    <div className="mb-2.5 last:mb-0">
      <p className="mb-1 text-[11px] font-medium text-muted-foreground">
        {label} ({items.length})
      </p>
      {items.length === 0 ? (
        <p className="text-[11px] text-muted-foreground/70">None</p>
      ) : (
        <div className="flex flex-wrap gap-1">
          {items.map((i) => (
            <span
              key={i}
              className={cn(
                "inline-flex items-center gap-1 rounded border px-1.5 py-0.5 font-mono text-[10px]",
                tone === "blue" && "border-blue/25 bg-blue/5 text-blue",
                tone === "violet" && "border-violet/25 bg-violet/5 text-violet",
                tone === "emerald" && "border-emerald/25 bg-emerald/5 text-emerald",
              )}
            >
              {icon}
              {i}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function ParamsTable({
  params,
  required,
  args,
}: {
  params: Record<string, { type?: string; description?: string }>;
  required: string[];
  args: Record<string, unknown>;
}) {
  const names = Array.from(new Set([...Object.keys(params), ...Object.keys(args)]));
  if (names.length === 0) {
    return <p className="mt-3 text-[11px] text-muted-foreground">Takes no parameters.</p>;
  }
  return (
    <div className="mt-3 overflow-hidden rounded-lg border border-border">
      <table className="w-full text-left text-xs">
        <thead className="bg-background/60 text-[10px] uppercase tracking-wide text-muted-foreground">
          <tr>
            <th className="px-3 py-1.5 font-medium">Parameter</th>
            <th className="px-3 py-1.5 font-medium">Type</th>
            <th className="px-3 py-1.5 font-medium">Mapped to</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {names.map((n) => {
            const mapped = n in args;
            const isRequired = required.includes(n);
            return (
              <tr key={n}>
                <td className="px-3 py-1.5 align-top">
                  <span className="inline-flex items-center gap-1 font-mono text-[11px] text-foreground">
                    <Braces className="size-2.5 text-cyan" />
                    {n}
                    {isRequired ? <span className="text-red">*</span> : null}
                  </span>
                  {params[n]?.description ? (
                    <p className="text-[10px] text-muted-foreground">{params[n]?.description}</p>
                  ) : null}
                </td>
                <td className="px-3 py-1.5 align-top font-mono text-[11px] text-muted-foreground">
                  {params[n]?.type ?? "—"}
                </td>
                <td className="px-3 py-1.5 align-top font-mono text-[11px]">
                  {mapped ? (
                    <span className="text-foreground">
                      {typeof args[n] === "string" ? String(args[n]) : JSON.stringify(args[n])}
                    </span>
                  ) : (
                    <span className={isRequired ? "text-amber" : "text-muted-foreground"}>
                      {isRequired ? "not mapped" : "from run inputs"}
                    </span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function StepLinks({ ids, onSelect }: { ids: string[]; onSelect: (id: string) => void }) {
  return (
    <span className="flex flex-wrap gap-1">
      {ids.map((id) => (
        <button
          key={id}
          type="button"
          onClick={() => onSelect(id)}
          className="inline-flex items-center gap-1 rounded border border-border px-1.5 py-0.5 font-mono text-[10px] text-foreground transition hover:border-primary/50 hover:bg-surface-hover"
        >
          {id} <ArrowRight className="size-2.5" />
        </button>
      ))}
    </span>
  );
}

function BranchCard({
  label,
  target,
  tone,
  onSelect,
}: {
  label: string;
  target: string;
  tone: "emerald" | "amber";
  onSelect: (id: string) => void;
}) {
  return (
    <div
      className={cn(
        "rounded-lg border p-2.5",
        tone === "emerald" ? "border-emerald/30 bg-emerald/5" : "border-amber/30 bg-amber/5",
      )}
    >
      <p
        className={cn(
          "text-[10px] font-medium",
          tone === "emerald" ? "text-emerald" : "text-amber",
        )}
      >
        {label}
      </p>
      {target ? (
        <button
          type="button"
          onClick={() => onSelect(target)}
          className="mt-1 inline-flex items-center gap-1 font-mono text-xs text-foreground hover:underline"
        >
          {target} <ArrowRight className="size-3" />
        </button>
      ) : (
        <p className="mt-1 text-xs text-muted-foreground">end workflow</p>
      )}
    </div>
  );
}

function IssueRow({ severity, message }: { severity: string; message: string }) {
  const isError = severity === "error";
  return (
    <p
      className={cn(
        "flex items-start gap-2 rounded-lg border px-3 py-2 text-xs",
        isError ? "border-red/30 bg-red/10 text-red" : "border-amber/30 bg-amber/10 text-amber",
      )}
    >
      {isError ? (
        <AlertTriangle className="mt-0.5 size-3 shrink-0" />
      ) : (
        <Info className="mt-0.5 size-3 shrink-0" />
      )}
      {message}
    </p>
  );
}
