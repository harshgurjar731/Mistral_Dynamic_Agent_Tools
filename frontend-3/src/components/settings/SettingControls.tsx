import { useState } from "react";
import {
  AlertTriangle,
  ChevronDown,
  CircleCheck,
  Lock,
  MapPin,
  Plus,
  RotateCcw,
  RotateCw,
  X,
} from "lucide-react";
import type { CatalogModel, ModelStatus, SettingItem, SettingValue } from "@/api/settings";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { displayValue, formatContext, supports } from "./settingsModel";

/* ── Badges ─────────────────────────────────────────────────────────── */

function Chip({
  className,
  children,
  title,
}: {
  className?: string;
  children: React.ReactNode;
  title?: string;
}) {
  return (
    <span
      title={title}
      className={cn(
        "inline-flex items-center gap-1 rounded border px-1.5 py-0.5 font-mono text-[10px] font-semibold uppercase",
        className,
      )}
    >
      {children}
    </span>
  );
}

export function SourceChip({ item, dirty }: { item: SettingItem; dirty: boolean }) {
  if (dirty) return <Chip className="border-blue/30 bg-blue/10 text-blue">Unsaved</Chip>;
  if (item.source === "override")
    return (
      <Chip className="border-primary/30 bg-primary/10 text-primary" title="Changed on this page">
        Custom
      </Chip>
    );
  if (item.source === "env")
    return (
      <Chip className="border-border bg-secondary text-muted-foreground" title="Set in .env">
        .env
      </Chip>
    );
  return <Chip className="border-border bg-transparent text-muted-foreground">Default</Chip>;
}

const STATUS_TONE: Record<ModelStatus["status"], string> = {
  ok: "border-emerald/30 bg-emerald/10 text-emerald",
  unchecked: "border-border bg-secondary text-muted-foreground",
  unknown: "border-red/30 bg-red/10 text-red",
  retired: "border-red/30 bg-red/10 text-red",
  deprecated: "border-amber/30 bg-amber/10 text-amber",
  incapable: "border-amber/30 bg-amber/10 text-amber",
};

export function ModelStatusChip({ status }: { status: ModelStatus | undefined }) {
  if (!status || status.status === "unchecked") return null;
  const label =
    status.status === "ok"
      ? "Available"
      : status.status === "incapable"
        ? "Wrong type"
        : status.status;
  return (
    <Chip className={STATUS_TONE[status.status]} title={status.message}>
      {status.status === "ok" ? (
        <CircleCheck className="size-3" />
      ) : (
        <AlertTriangle className="size-3" />
      )}
      {label}
    </Chip>
  );
}

/** Context length, reasoning, tools and default temperature for a model. */
export function ModelFacts({ card }: { card: CatalogModel | undefined }) {
  if (!card) return null;
  const c = card.capabilities;
  const facts = [
    formatContext(card.max_context_length),
    c["reasoning"] ? "reasoning" : null,
    c["function_calling"] ? "tools" : null,
    c["vision"] ? "vision" : null,
    card.default_model_temperature != null ? `temp ${card.default_model_temperature}` : null,
    card.id !== card.name && card.name ? `→ ${card.name}` : null,
  ].filter(Boolean);
  return <p className="mt-1 font-mono text-[10px] text-muted-foreground">{facts.join(" · ")}</p>;
}

/* ── Inputs ─────────────────────────────────────────────────────────── */

function ModelInput({
  item,
  value,
  onChange,
  catalog,
  listId,
}: {
  item: SettingItem;
  value: string;
  onChange: (v: string) => void;
  catalog: Map<string, CatalogModel>;
  listId: string;
}) {
  const card = catalog.get(value);
  const status = item.model_status?.[value];
  const localWarning =
    !status && catalog.size > 0 && value && value !== "none"
      ? !card
        ? "Not in the Mistral model list"
        : !supports(card, item.capability)
          ? `Does not support ${item.capability?.replace("_", " ")}`
          : null
      : null;
  return (
    <div>
      <div className="flex items-center gap-2">
        <Input
          value={value}
          list={listId}
          disabled={!item.editable}
          onChange={(e) => onChange(e.target.value)}
          className="font-mono text-xs"
          placeholder={item.allow_none ? "none" : "model id"}
        />
        <ModelStatusChip status={status} />
      </div>
      {value !== "none" ? <ModelFacts card={card} /> : null}
      {status && status.status !== "ok" ? (
        <p className="mt-1 text-[11px] text-amber">{status.message}</p>
      ) : localWarning ? (
        <p className="mt-1 text-[11px] text-amber">{localWarning}</p>
      ) : null}
    </div>
  );
}

function ModelListInput({
  item,
  value,
  onChange,
  catalog,
  listId,
}: {
  item: SettingItem;
  value: string[];
  onChange: (v: string[]) => void;
  catalog: Map<string, CatalogModel>;
  listId: string;
}) {
  const [adding, setAdding] = useState("");
  const add = () => {
    const name = adding.trim();
    if (name && !value.includes(name)) onChange([...value, name]);
    setAdding("");
  };
  return (
    <div>
      <div className="flex flex-wrap gap-1.5">
        {value.map((m) => {
          const status = item.model_status?.[m];
          const missing = catalog.size > 0 && !catalog.has(m);
          const bad =
            (status && status.status !== "ok" && status.status !== "unchecked") || missing;
          return (
            <span
              key={m}
              title={status?.message || (missing ? "Not in the Mistral model list" : "")}
              className={cn(
                "inline-flex items-center gap-1 rounded-md border px-2 py-1 font-mono text-[11px]",
                bad
                  ? "border-amber/40 bg-amber/10 text-amber"
                  : "border-border bg-secondary text-foreground",
              )}
            >
              {bad ? <AlertTriangle className="size-3" /> : null}
              {m}
              {item.editable && value.length > 1 ? (
                <button
                  type="button"
                  aria-label={`Remove ${m}`}
                  onClick={() => onChange(value.filter((v) => v !== m))}
                  className="text-muted-foreground hover:text-foreground"
                >
                  <X className="size-3" />
                </button>
              ) : null}
            </span>
          );
        })}
      </div>
      {item.editable ? (
        <div className="mt-2 flex items-center gap-2">
          <Input
            value={adding}
            list={listId}
            onChange={(e) => setAdding(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                add();
              }
            }}
            placeholder="Add a model…"
            className="h-8 font-mono text-xs"
          />
          <button
            type="button"
            onClick={add}
            className="inline-flex h-8 items-center gap-1 rounded-md border border-border bg-secondary px-2.5 text-xs text-foreground hover:bg-accent"
          >
            <Plus className="size-3.5" /> Add
          </button>
        </div>
      ) : null}
    </div>
  );
}

function ValueInput({
  item,
  value,
  onChange,
  catalog,
}: {
  item: SettingItem;
  value: SettingValue;
  onChange: (v: SettingValue) => void;
  catalog: Map<string, CatalogModel>;
}) {
  const listId = `models-${item.capability ?? "any"}`;
  switch (item.type) {
    case "bool":
      return (
        <Switch
          checked={Boolean(value)}
          disabled={!item.editable}
          onCheckedChange={(v) => onChange(v)}
        />
      );
    case "enum":
      return (
        <Select value={String(value ?? "")} disabled={!item.editable} onValueChange={onChange}>
          <SelectTrigger className="h-9 w-full bg-background text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {item.options.map((o) => (
              <SelectItem key={o} value={o}>
                {o}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      );
    case "model":
      return (
        <ModelInput
          item={item}
          value={String(value ?? "")}
          onChange={onChange}
          catalog={catalog}
          listId={listId}
        />
      );
    case "model_list":
      return (
        <ModelListInput
          item={item}
          value={Array.isArray(value) ? value : []}
          onChange={onChange}
          catalog={catalog}
          listId={listId}
        />
      );
    case "secret":
      return (
        <div className="flex h-9 items-center gap-2 rounded-md border border-border bg-secondary/50 px-3 font-mono text-xs text-muted-foreground">
          <Lock className="size-3.5" />
          {item.is_set ? "Set (hidden)" : "Not set"}
        </div>
      );
    case "int":
    case "float":
      return (
        <Input
          type="number"
          value={value === null || value === undefined ? "" : String(value)}
          min={item.min ?? undefined}
          max={item.max ?? undefined}
          step={item.type === "float" ? "any" : 1}
          disabled={!item.editable}
          onChange={(e) => onChange(e.target.value === "" ? "" : Number(e.target.value))}
          className="font-mono text-xs"
        />
      );
    default:
      return (
        <Input
          value={String(value ?? "")}
          disabled={!item.editable}
          onChange={(e) => onChange(e.target.value)}
          className="font-mono text-xs"
        />
      );
  }
}

/* ── One setting ────────────────────────────────────────────────────── */

export function SettingRow({
  item,
  value,
  dirty,
  onChange,
  onReset,
  catalog,
  compact = false,
  hint,
}: {
  item: SettingItem;
  value: SettingValue;
  dirty: boolean;
  onChange: (v: SettingValue) => void;
  onReset: () => void;
  catalog: Map<string, CatalogModel>;
  compact?: boolean;
  hint?: string | null;
}) {
  const [showUse, setShowUse] = useState(false);
  const canReset = item.editable && (item.source === "override" || dirty);
  return (
    <div
      className={cn(
        "min-w-0",
        !compact && "grid gap-3 py-4 md:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]",
      )}
    >
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-1.5">
          <p className="text-sm font-medium text-foreground">{item.label}</p>
          <SourceChip item={item} dirty={dirty} />
          {item.apply === "restart" ? (
            <Chip
              className={cn(
                item.restart_pending
                  ? "border-amber/30 bg-amber/10 text-amber"
                  : "border-border text-muted-foreground",
              )}
              title="Takes effect when the service restarts"
            >
              <RotateCw className="size-3" />
              {item.restart_pending ? "Restart pending" : "Restart"}
            </Chip>
          ) : null}
          {!item.editable && item.type !== "secret" ? (
            <Chip className="border-border text-muted-foreground" title="Change it in .env">
              <Lock className="size-3" /> .env only
            </Chip>
          ) : null}
        </div>
        {!compact ? (
          <p className="mt-0.5 font-mono text-[10px] text-muted-foreground/80">{item.key}</p>
        ) : null}
        {item.description && !compact ? (
          <p className="mt-1 text-xs text-muted-foreground">{item.description}</p>
        ) : null}
      </div>

      <div className={cn("min-w-0", compact && "mt-1.5")}>
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <ValueInput item={item} value={value} onChange={onChange} catalog={catalog} />
          </div>
          {canReset ? (
            <button
              type="button"
              onClick={onReset}
              title={`Reset to default (${displayValue(item.default)})`}
              aria-label={`Reset ${item.label} to default`}
              className="mt-1.5 shrink-0 rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              <RotateCcw className="size-3.5" />
            </button>
          ) : null}
        </div>
        {hint ? <p className="mt-1 text-[11px] text-amber">{hint}</p> : null}
        <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
          {item.type !== "secret" ? (
            <span>
              Default: <span className="font-mono">{displayValue(item.default)}</span>
            </span>
          ) : null}
          {item.used_in.length && !compact ? (
            <button
              type="button"
              onClick={() => setShowUse((v) => !v)}
              className="inline-flex items-center gap-1 hover:text-foreground"
            >
              <MapPin className="size-3" />
              Used in {item.used_in.length} place{item.used_in.length > 1 ? "s" : ""}
              <ChevronDown className={cn("size-3 transition", showUse && "rotate-180")} />
            </button>
          ) : null}
        </div>
        {showUse ? (
          <ul className="mt-1.5 space-y-0.5 rounded-md border border-border/60 bg-background-elevated/60 p-2">
            {item.used_in.map((u) => (
              <li key={u} className="font-mono text-[10.5px] text-muted-foreground">
                {u}
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </div>
  );
}
