import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Check, Plus, X } from "lucide-react";
import { connectorsApi, QK, toolsApi } from "@/api";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { CHAT_MODELS } from "@/lib/models";
import { cn } from "@/lib/utils";
import type { RuleParamField } from "@/types";

type Option = { value: string; label: string };

/** Options for a field whose choices are live inventory rather than fixed. */
function useOptions(field: RuleParamField): Option[] {
  const source = field.options_source;
  const tools = useQuery({
    queryKey: QK.tools(),
    queryFn: toolsApi.list,
    enabled: source === "tools",
  });
  const connectors = useQuery({
    queryKey: QK.connectors(),
    queryFn: () => connectorsApi.list(),
    enabled: source === "connectors",
  });

  if (source === "tools") {
    return (tools.data ?? []).map((t: { name: string }) => ({ value: t.name, label: t.name }));
  }
  if (source === "connectors") {
    return (connectors.data?.items ?? []).map((c: { id: string; name?: string }) => ({
      value: c.id,
      label: c.name ?? c.id,
    }));
  }
  if (source === "models") return CHAT_MODELS.map((m) => ({ value: m.value, label: m.label }));
  return field.options ?? [];
}

/**
 * The settings form for one rule, generated from its type's schema.
 * Nothing here is ever edited as JSON.
 */
export function RuleParamsForm({
  fields,
  value,
  onChange,
}: {
  fields: RuleParamField[];
  value: Record<string, unknown>;
  onChange: (next: Record<string, unknown>) => void;
}) {
  if (!fields.length) {
    return (
      <p className="rounded-lg border border-dashed border-border px-3 py-2.5 text-xs text-muted-foreground">
        This rule has no settings — it works as it is.
      </p>
    );
  }
  return (
    <div className="space-y-4">
      {fields.map((field) => (
        <div key={field.key}>
          <label className="eyebrow mb-1.5 block">{field.label}</label>
          <FieldControl
            field={field}
            value={value[field.key] ?? field.default}
            onChange={(v) => onChange({ ...value, [field.key]: v })}
          />
          {field.help ? (
            <p className="mt-1.5 text-[11px] text-muted-foreground">{field.help}</p>
          ) : null}
        </div>
      ))}
    </div>
  );
}

function FieldControl({
  field,
  value,
  onChange,
}: {
  field: RuleParamField;
  value: unknown;
  onChange: (v: unknown) => void;
}) {
  const options = useOptions(field);
  const list = Array.isArray(value) ? (value as string[]) : [];

  switch (field.kind) {
    case "tags":
      return <TagInput value={list} onChange={onChange} />;
    case "checkboxes":
    case "multiselect":
      return (
        <ChoiceChips
          options={options}
          value={list}
          onChange={onChange}
          emptyHint={
            field.options_source ? `No ${field.options_source} available yet.` : "No options."
          }
        />
      );
    case "number": {
      const n = typeof value === "number" ? value : Number(value ?? field.default ?? 0);
      const min = field.min ?? 0;
      const max = field.max ?? 100;
      return (
        <div className="flex items-center gap-3">
          <Slider
            value={[n]}
            min={min}
            max={max}
            step={max - min > 200 ? 50 : 1}
            onValueChange={(v) => onChange(v[0])}
            className="flex-1"
          />
          <input
            type="number"
            min={min}
            max={max}
            value={n}
            onChange={(e) => onChange(Number(e.target.value))}
            className="h-8 w-20 rounded-md border border-input bg-background-elevated px-2 text-right font-mono text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </div>
      );
    }
    case "select":
      return (
        <div className="inline-flex flex-wrap gap-1 rounded-lg border border-border bg-background-elevated p-0.5">
          {options.map((o) => (
            <button
              key={o.value}
              type="button"
              onClick={() => onChange(o.value)}
              className={cn(
                "rounded-md px-3 py-1 text-xs font-medium transition-colors",
                value === o.value
                  ? "bg-primary/15 text-primary"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {o.label}
            </button>
          ))}
        </div>
      );
    case "toggle":
      return <Switch checked={Boolean(value)} onCheckedChange={onChange} />;
    default:
      return null;
  }
}

function ChoiceChips({
  options,
  value,
  onChange,
  emptyHint,
}: {
  options: Option[];
  value: string[];
  onChange: (v: string[]) => void;
  emptyHint: string;
}) {
  // Keep selected values visible even if they vanished from the inventory,
  // so a deleted connector can still be removed from the rule.
  const known = new Set(options.map((o) => o.value));
  const all = [
    ...options,
    ...value.filter((v) => !known.has(v)).map((v) => ({ value: v, label: v })),
  ];
  if (!all.length) return <p className="text-xs text-muted-foreground">{emptyHint}</p>;

  return (
    <div className="flex flex-wrap gap-1.5">
      {all.map((o) => {
        const on = value.includes(o.value);
        return (
          <button
            key={o.value}
            type="button"
            onClick={() => onChange(on ? value.filter((v) => v !== o.value) : [...value, o.value])}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs transition",
              on
                ? "border-primary/40 bg-primary/10 text-foreground"
                : "border-border text-muted-foreground hover:border-border-strong hover:text-foreground",
            )}
          >
            <span
              className={cn(
                "grid size-3.5 place-items-center rounded border",
                on ? "border-primary bg-primary text-primary-foreground" : "border-border",
              )}
            >
              {on ? <Check className="size-2.5" /> : null}
            </span>
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

function TagInput({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  const [draft, setDraft] = useState("");
  const add = () => {
    const parts = draft
      .split(/[,\n]/)
      .map((s) => s.trim())
      .filter(Boolean)
      .filter((s) => !value.some((v) => v.toLowerCase() === s.toLowerCase()));
    if (parts.length) onChange([...value, ...parts]);
    setDraft("");
  };
  return (
    <div className="rounded-lg border border-border bg-background p-2">
      {value.length ? (
        <div className="mb-2 flex flex-wrap gap-1.5">
          {value.map((tag) => (
            <span
              key={tag}
              className="inline-flex items-center gap-1 rounded-md border border-border bg-background-elevated px-2 py-1 text-[11px] text-foreground"
            >
              {tag}
              <button
                type="button"
                aria-label={`Remove ${tag}`}
                onClick={() => onChange(value.filter((v) => v !== tag))}
                className="text-muted-foreground hover:text-red"
              >
                <X className="size-3" />
              </button>
            </span>
          ))}
        </div>
      ) : null}
      <div className="flex items-center gap-1.5">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === ",") {
              e.preventDefault();
              add();
            }
          }}
          placeholder="Type and press Enter"
          className="h-7 flex-1 bg-transparent px-1 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none"
        />
        <button
          type="button"
          onClick={add}
          disabled={!draft.trim()}
          className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] text-muted-foreground transition hover:bg-surface-hover hover:text-foreground disabled:opacity-40"
        >
          <Plus className="size-3" /> Add
        </button>
      </div>
    </div>
  );
}
