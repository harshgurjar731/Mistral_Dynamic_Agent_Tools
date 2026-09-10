import { useEffect, useMemo, useState } from "react";
import { Flag, Trash2 } from "lucide-react";
import type { BuilderCatalog, WorkflowStep } from "@/types";
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

export function StepInspector({
  step,
  catalog,
  stepIds,
  tiers,
  isEntry,
  onChange,
  onDelete,
  onSetEntry,
}: {
  step: WorkflowStep | null;
  catalog: BuilderCatalog | undefined;
  stepIds: string[];
  tiers: string[];
  isEntry: boolean;
  onChange: (next: WorkflowStep) => void;
  onDelete: (id: string) => void;
  onSetEntry: (id: string) => void;
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
          </>
        ) : null}

        {step.type === "tool" ? (
          <>
            <Field
              label="Tool"
              hint="A tool step calls the function directly — no model decides the arguments."
            >
              <select
                className={SELECT_CLASS}
                value={String(cfg["tool_name"] ?? "")}
                onChange={(e) => setCfg({ tool_name: e.target.value || undefined })}
              >
                <option value="">— none —</option>
                {(catalog?.tools ?? []).map((t) => (
                  <option key={t.name} value={t.name}>
                    {t.name} · {t.source}
                  </option>
                ))}
              </select>
            </Field>
            <JsonField
              label="Arguments"
              hint="Object of parameter → value. {{placeholders}} are substituted at run time."
              value={cfg["arguments_template"] ?? cfg["arguments"] ?? {}}
              onChange={(v) => setCfg({ arguments: v })}
            />
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
