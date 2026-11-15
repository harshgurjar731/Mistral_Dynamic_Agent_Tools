import { useEffect, useMemo, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { FlaskConical, Flag, Loader2, Trash2, Wand2 } from "lucide-react";
import { errorMessage, workflowsApi, type WireArgumentsResult } from "@/api";
import type { BuilderCatalog, WorkflowDefinition, WorkflowStep } from "@/types";
import { GlassPanel, GlassPanelHeader } from "@/components/glass/GlassPanel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { EmptyState } from "@/components/ui/EmptyState";
import { STEP_TYPE_IDENTITY } from "@/lib/status";
import { cn } from "@/lib/utils";

const SELECT_CLASS =
  "h-9 w-full rounded-md border border-input bg-background-elevated/70 px-2 text-xs text-foreground focus-visible:border-primary/70 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="eyebrow mb-1.5 block">{label}</label>
      {children}
      {hint ? <p className="mt-1 text-[11px] text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

/** JSON object editor that only commits a parseable value upstream. */
function JsonField({
  label,
  hint,
  value,
  onChange,
}: {
  label: string;
  hint?: string;
  value: unknown;
  onChange: (v: Record<string, unknown>) => void;
}) {
  const serialised = useMemo(
    () => JSON.stringify(value && typeof value === "object" ? value : {}, null, 2),
    [value],
  );
  const [text, setText] = useState(serialised);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setText(serialised);
    setError(null);
  }, [serialised]);

  return (
    <Field label={label} hint={hint ?? ""}>
      <Textarea
        rows={6}
        value={text}
        spellCheck={false}
        className={cn("font-mono text-xs", error && "border-red/60")}
        onChange={(e) => {
          const next = e.target.value;
          setText(next);
          try {
            const parsed = JSON.parse(next || "{}");
            if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
              setError("Must be a JSON object.");
              return;
            }
            setError(null);
            onChange(parsed as Record<string, unknown>);
          } catch {
            setError("Invalid JSON.");
          }
        }}
      />
      {error ? <p className="mt-1 text-[11px] text-red">{error}</p> : null}
    </Field>
  );
}

/**
 * An agent step's typed answer. With a schema the run holds the agent's answer
 * to it (and repairs a reply that does not fit), later steps can reference its
 * fields, and the argument checks know their types. Without one the answer is text.
 */
function OutputSchemaField({
  value,
  onChange,
}: {
  value: unknown;
  onChange: (schema: Record<string, unknown> | undefined) => void;
}) {
  const typed = Boolean(value && typeof value === "object" && Object.keys(value).length);
  const [fields, setFields] = useState("");
  const generate = () => {
    const names = fields
      .split(",")
      .map((f) => f.trim().replace(/[^A-Za-z0-9_]/g, "_"))
      .filter(Boolean);
    if (!names.length) return;
    onChange({
      type: "object",
      properties: Object.fromEntries(names.map((n) => [n, { type: "string" }])),
      required: names,
    });
    setFields("");
  };
  return (
    <div className="space-y-2">
      <label className="flex items-center gap-2 text-xs text-foreground">
        <input
          type="checkbox"
          checked={typed}
          onChange={(e) =>
            onChange(
              e.target.checked
                ? {
                    type: "object",
                    properties: { answer: { type: "string" } },
                    required: ["answer"],
                  }
                : undefined,
            )
          }
        />
        Typed output — hold the agent&apos;s answer to a schema
      </label>
      {typed ? (
        <>
          <JsonField
            label="Output schema"
            hint="JSON Schema of the answer. Later steps read fields as {{step_<id>_output.<field>}}; set types and enums to make the run check them."
            value={value}
            onChange={(v) => onChange(v)}
          />
          <div className="flex gap-1.5">
            <Input
              value={fields}
              onChange={(e) => setFields(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && generate()}
              placeholder="Start over from field names, e.g. decision, reason, risk_score"
              className="h-7 text-[11px]"
            />
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-7 text-[11px]"
              onClick={generate}
            >
              Generate
            </Button>
          </div>
        </>
      ) : null}
    </div>
  );
}

/**
 * Fill an activity step's arguments from what runs before it: arguments that
 * already fit are kept, same-name fields are wired exactly, and the rest are
 * matched by the model and checked against the schemas before they are used.
 */
function AutoWireArguments({
  definition,
  stepId,
  onWired,
}: {
  definition: WorkflowDefinition;
  stepId: string;
  onWired: (args: Record<string, unknown>) => void;
}) {
  const [last, setLast] = useState<WireArgumentsResult | null>(null);
  useEffect(() => setLast(null), [stepId]);
  const wire = useMutation({
    mutationFn: () => workflowsApi.wireArguments(definition, stepId),
    onSuccess: (res) => {
      setLast(res);
      onWired(res.arguments);
      const n = Object.keys(res.arguments).length;
      if (res.missing.length) toast.warning(`Wired ${n}; still open: ${res.missing.join(", ")}`);
      else toast.success(`Wired ${n} argument${n === 1 ? "" : "s"}`);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const counts = last
    ? Object.values(last.sources).reduce<Record<string, number>>(
        (acc, s) => ({ ...acc, [s]: (acc[s] ?? 0) + 1 }),
        {},
      )
    : null;
  return (
    <div className="space-y-1.5">
      <Button
        type="button"
        size="sm"
        variant="outline"
        className="h-7 gap-1.5 text-[11px]"
        disabled={wire.isPending}
        onClick={() => wire.mutate()}
      >
        {wire.isPending ? (
          <Loader2 className="size-3 animate-spin" />
        ) : (
          <Wand2 className="size-3" />
        )}
        {wire.isPending ? "Wiring…" : "Auto-wire arguments"}
      </Button>
      {last && counts ? (
        <div className="space-y-1 rounded-md border border-border/60 bg-background-elevated/50 p-2 text-[11px]">
          <p className="text-muted-foreground">
            {[
              counts["kept"] ? `${counts["kept"]} kept` : null,
              counts["exact"] ? `${counts["exact"]} by exact name` : null,
              counts["model"] ? `${counts["model"]} matched by the model` : null,
            ]
              .filter(Boolean)
              .join(" · ") || "Nothing could be wired."}
          </p>
          {Object.entries(last.notes).map(([param, note]) => (
            <p key={param}>
              <span className="font-mono">{param}</span>: {note}
            </p>
          ))}
          {last.missing.length ? (
            <p className="text-amber">
              Nothing earlier provides: <span className="font-mono">{last.missing.join(", ")}</span>{" "}
              — add a workflow input or a step that returns it.
            </p>
          ) : null}
          {last.issues.map((i, n) => (
            <p key={n} className="text-red">
              {i.message}
            </p>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function StepInspector({
  step,
  definition,
  catalog,
  stepIds,
  tiers,
  isEntry,
  onChange,
  onDelete,
  onSetEntry,
  onTestAgent,
}: {
  step: WorkflowStep | null;
  /** The whole draft, for helpers that look at the steps around this one. */
  definition?: WorkflowDefinition | undefined;
  catalog: BuilderCatalog | undefined;
  stepIds: string[];
  tiers: string[];
  isEntry: boolean;
  onChange: (next: WorkflowStep) => void;
  onDelete: (id: string) => void;
  onSetEntry: (id: string) => void;
  /** Test the agent on designed prompts (builder). */
  onTestAgent?: ((agentId: string) => void) | undefined;
}) {
  if (!step) {
    return (
      <GlassPanel className="h-full">
        <GlassPanelHeader title="Inspector" description="Select a step to edit it." />
        <div className="p-4">
          <EmptyState
            title="Nothing selected"
            description="Click a node on the canvas, or add one from the palette."
            className="py-10"
          />
        </div>
      </GlassPanel>
    );
  }

  const identity = STEP_TYPE_IDENTITY[step.type];
  const cfg = step.config ?? {};
  const setCfg = (patch: Record<string, unknown>) =>
    onChange({ ...step, config: { ...cfg, ...patch } });

  const otherSteps = stepIds.filter((id) => id !== step.id);

  return (
    <GlassPanel className="flex h-full flex-col overflow-hidden">
      <GlassPanelHeader
        title={
          <span className="flex items-center gap-2">
            <span
              className={cn(
                "rounded border px-1.5 py-0.5 font-mono text-[9px] font-bold uppercase",
                identity.bg,
                identity.border,
                identity.text,
              )}
            >
              {identity.label}
            </span>
            <span className="truncate">{step.id}</span>
          </span>
        }
        actions={
          <div className="flex items-center gap-1">
            <Button
              size="sm"
              variant={isEntry ? "default" : "outline"}
              onClick={() => onSetEntry(step.id)}
              title="Make this the entry step"
            >
              <Flag className="size-3.5" />
              {isEntry ? "Entry" : "Set entry"}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="text-muted-foreground hover:text-red"
              onClick={() => onDelete(step.id)}
              title="Delete step"
            >
              <Trash2 className="size-3.5" />
            </Button>
          </div>
        }
      />

      <div className="custom-scrollbar flex-1 space-y-4 overflow-y-auto p-4">
        <Field
          label="Step id"
          hint="Letters, digits and underscores. Becomes a function name in the compiled module."
        >
          <Input
            value={step.id}
            onChange={(e) => onChange({ ...step, id: e.target.value })}
            className="font-mono text-xs"
          />
        </Field>

        <Field label="Description">
          <Textarea
            rows={2}
            value={step.description ?? ""}
            onChange={(e) => onChange({ ...step, description: e.target.value })}
            className="text-xs"
          />
        </Field>

        {step.type === "agent" ? (
          <>
            <Field label="Agent" hint="Pick a registered agent, or leave blank to bind inline.">
              <select
                className={SELECT_CLASS}
                value={String(cfg["agent_id"] ?? "")}
                onChange={(e) => setCfg({ agent_id: e.target.value || undefined })}
              >
                <option value="">— none —</option>
                {(catalog?.agents ?? []).map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                    {a.tier ? ` · ${a.tier}` : ""}
                  </option>
                ))}
              </select>
            </Field>
            <Field
              label="Query template"
              hint="Reference earlier output with {{step_<id>_output}} and inputs with {{name}}."
            >
              <Textarea
                rows={6}
                value={String(cfg["query_template"] ?? "")}
                onChange={(e) => setCfg({ query_template: e.target.value })}
                className="font-mono text-xs"
              />
            </Field>
            {onTestAgent && cfg["agent_id"] ? (
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-7 gap-1.5 text-[11px]"
                title="Design test prompts, run the agent on them and judge the answers. Revised instructions are put to you first."
                onClick={() => onTestAgent(String(cfg["agent_id"]))}
              >
                <FlaskConical className="size-3" />
                Test this agent
              </Button>
            ) : null}
            <OutputSchemaField
              value={cfg["output_schema"]}
              onChange={(schema) => setCfg({ output_schema: schema })}
            />
          </>
        ) : null}

        {step.type === "tool" ? (
          <>
            <Field
              label="Activity"
              hint="An activity step calls the function directly — no model decides the arguments. Agent tools are configured on the agent instead."
            >
              <select
                className={SELECT_CLASS}
                value={String(cfg["tool_name"] ?? "")}
                onChange={(e) => setCfg({ tool_name: e.target.value || undefined })}
              >
                <option value="">— none —</option>
                {(catalog?.activities ?? []).map((t) => (
                  <option key={t.name} value={t.name}>
                    {t.name}
                  </option>
                ))}
                {/* Older workflows may call an agent tool directly; keep it selectable. */}
                {cfg["tool_name"] &&
                !(catalog?.activities ?? []).some((t) => t.name === cfg["tool_name"]) ? (
                  <option value={String(cfg["tool_name"])}>{String(cfg["tool_name"])}</option>
                ) : null}
              </select>
            </Field>
            <JsonField
              label="Arguments"
              hint="Object of parameter → value. {{placeholders}} are substituted at run time."
              value={cfg["arguments_template"] ?? cfg["arguments"] ?? {}}
              onChange={(v) => setCfg({ arguments: v })}
            />
            {definition && cfg["tool_name"] ? (
              <AutoWireArguments
                definition={definition}
                stepId={step.id}
                onWired={(args) =>
                  onChange({
                    ...step,
                    config: { ...cfg, arguments: args, arguments_template: undefined },
                  })
                }
              />
            ) : null}
          </>
        ) : null}

        {step.type === "connector" ? (
          <>
            <Field label="Connector">
              <select
                className={SELECT_CLASS}
                value={String(cfg["connector_id"] ?? "")}
                onChange={(e) => {
                  const found = (catalog?.connectors ?? []).find((c) => c.id === e.target.value);
                  setCfg({
                    connector_id: e.target.value || undefined,
                    connector_name: found?.name,
                  });
                }}
              >
                <option value="">— none —</option>
                {(catalog?.connectors ?? []).map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                    {c.is_authenticated ? "" : " (not authenticated)"}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Connector tool" hint="The tool name exactly as the connector exposes it.">
              <Input
                value={String(cfg["tool_name"] ?? "")}
                onChange={(e) => setCfg({ tool_name: e.target.value })}
                className="font-mono text-xs"
              />
            </Field>
            <Field
              label="Credentials name"
              hint="Optional — defaults to the connector's default set."
            >
              <Input
                value={String(cfg["credentials_name"] ?? "")}
                onChange={(e) => setCfg({ credentials_name: e.target.value || undefined })}
                className="font-mono text-xs"
              />
            </Field>
            <JsonField
              label="Arguments"
              value={cfg["arguments"] ?? cfg["arguments_template"] ?? {}}
              onChange={(v) => setCfg({ arguments: v })}
            />
          </>
        ) : null}

        {step.type === "condition" ? (
          <>
            <Field
              label="Expression"
              hint="Evaluated against the run context. Routes to the true or false branch."
            >
              <Textarea
                rows={3}
                value={String(cfg["expression"] ?? "")}
                onChange={(e) => setCfg({ expression: e.target.value })}
                className="font-mono text-xs"
              />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="True branch">
                <select
                  className={SELECT_CLASS}
                  value={String(cfg["true_step"] ?? "")}
                  onChange={(e) => setCfg({ true_step: e.target.value || undefined })}
                >
                  <option value="">— none —</option>
                  {otherSteps.map((id) => (
                    <option key={id} value={id}>
                      {id}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="False branch">
                <select
                  className={SELECT_CLASS}
                  value={String(cfg["false_step"] ?? "")}
                  onChange={(e) => setCfg({ false_step: e.target.value || undefined })}
                >
                  <option value="">— none —</option>
                  {otherSteps.map((id) => (
                    <option key={id} value={id}>
                      {id}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
          </>
        ) : null}

        {step.type === "transform" ? (
          <Field
            label="Transform code"
            hint="Python expression or statements applied to the context."
          >
            <Textarea
              rows={8}
              value={String(cfg["transform_code"] ?? "")}
              onChange={(e) => setCfg({ transform_code: e.target.value })}
              className="font-mono text-xs"
            />
          </Field>
        ) : null}

        {step.type === "human_review" ? (
          <>
            <Field
              label="Reviews the output of"
              hint="The step whose result the reviewer is shown."
            >
              <select
                className={SELECT_CLASS}
                value={String(cfg["review_of"] ?? "")}
                onChange={(e) => setCfg({ review_of: e.target.value })}
              >
                <option value="">— previous outputs —</option>
                {otherSteps.map((id) => (
                  <option key={id} value={id}>
                    {id}
                  </option>
                ))}
              </select>
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Reviewer role">
                <Input
                  value={String(cfg["reviewer_role"] ?? "")}
                  onChange={(e) => setCfg({ reviewer_role: e.target.value })}
                  placeholder="e.g. AP clerk"
                />
              </Field>
              <Field label="Decide within (hours)">
                <Input
                  type="number"
                  min={1}
                  value={Math.round(Number(cfg["sla_seconds"] ?? 86400) / 3600)}
                  onChange={(e) =>
                    setCfg({ sla_seconds: Math.max(1, Number(e.target.value) || 24) * 3600 })
                  }
                />
              </Field>
              <Field label="If no decision">
                <select
                  className={SELECT_CLASS}
                  value={String(cfg["on_timeout"] ?? "fail")}
                  onChange={(e) => setCfg({ on_timeout: e.target.value })}
                >
                  <option value="fail">Stop the run</option>
                  <option value="approve">Continue</option>
                  <option value="escalate">Escalate and stop</option>
                </select>
              </Field>
              <Field label="Sample (%)" hint="Blank: every run is reviewed.">
                <Input
                  type="number"
                  min={1}
                  max={100}
                  value={
                    cfg["sample_rate"] == null ? "" : Math.round(Number(cfg["sample_rate"]) * 100)
                  }
                  onChange={(e) =>
                    setCfg({
                      sample_rate: e.target.value
                        ? Math.min(100, Number(e.target.value)) / 100
                        : null,
                    })
                  }
                />
              </Field>
            </div>
            <Field label="Fields the reviewer may correct" hint="Comma-separated output fields.">
              <Input
                value={((cfg["editable"] as string[] | undefined) ?? []).join(", ")}
                onChange={(e) =>
                  setCfg({
                    editable: e.target.value
                      .split(",")
                      .map((v) => v.trim())
                      .filter(Boolean),
                  })
                }
              />
            </Field>
          </>
        ) : null}

        <div className="grid grid-cols-2 gap-3 border-t border-border pt-4">
          <Field label="Tier">
            <select
              className={SELECT_CLASS}
              value={step.tier ?? ""}
              onChange={(e) => onChange({ ...step, tier: e.target.value || null })}
            >
              <option value="">— none —</option>
              {tiers.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Parallel group" hint="Same id ⇒ runs concurrently.">
            <Input
              value={step.parallel_group ?? ""}
              onChange={(e) => onChange({ ...step, parallel_group: e.target.value || null })}
              className="font-mono text-xs"
            />
          </Field>
        </div>

        <Field label="Next steps" hint="Also editable by dragging between node handles.">
          <div className="space-y-1.5">
            {otherSteps.length === 0 ? (
              <p className="text-[11px] text-muted-foreground">No other steps yet.</p>
            ) : (
              otherSteps.map((id) => {
                const checked = step.next_steps.includes(id);
                return (
                  <label
                    key={id}
                    className="flex cursor-pointer items-center gap-2 rounded-lg border border-border bg-background-elevated/60 px-2.5 py-1.5"
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={(e) =>
                        onChange({
                          ...step,
                          next_steps: e.target.checked
                            ? [...step.next_steps, id]
                            : step.next_steps.filter((x) => x !== id),
                        })
                      }
                    />
                    <span className="truncate font-mono text-[11px] text-foreground">{id}</span>
                  </label>
                );
              })
            )}
          </div>
        </Field>
      </div>
    </GlassPanel>
  );
}
