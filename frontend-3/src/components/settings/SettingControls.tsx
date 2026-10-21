import { useState } from "react";
import {
  AlertTriangle,
  ChevronDown,
  CircleCheck,
  Code2,
  Lock,
  RotateCcw,
  RotateCw,
  X,
  Zap,
} from "lucide-react";
import type { CatalogModel, ModelStatus, SettingItem, SettingValue } from "@/api/settings";
import { ModelPicker } from "@/components/shared/ModelPicker";
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
        "inline-flex shrink-0 items-center gap-1 rounded border px-1.5 py-px font-mono text-[9.5px] font-semibold tracking-wide uppercase",
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
  return null;
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
        ? "Not suited"
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
    c["function_calling"] ? "tool use" : null,
    c["vision"] ? "vision" : null,
    card.default_model_temperature != null ? `temp ${card.default_model_temperature}` : null,
    card.id !== card.name && card.name ? `resolves to ${card.name}` : null,
  ].filter(Boolean);
  return <p className="mt-1.5 font-mono text-[10px] text-muted-foreground">{facts.join(" · ")}</p>;
}

/* ── Swatches for the design enums ─────────────────────────────────── */

const SWATCHES: Record<string, Record<string, string>> = {
  UI_ACCENT: {
    ember: "oklch(0.65 0.18 36)",
    indigo: "oklch(0.585 0.216 277)",
    violet: "oklch(0.628 0.226 302)",
    blue: "oklch(0.623 0.19 259)",
    cyan: "oklch(0.72 0.13 214)",
    emerald: "oklch(0.7 0.147 162)",
    amber: "oklch(0.77 0.166 70)",
    rose: "oklch(0.646 0.222 4)",
  },
  UI_SURFACE_TONE: {
    neutral: "oklch(0.2 0 0)",
    warm: "oklch(0.22 0.025 60)",
    cool: "oklch(0.22 0.025 250)",
    midnight: "oklch(0.22 0.05 265)",
  },
};

function SwatchPicker({
  item,
  value,
  onChange,
}: {
  item: SettingItem;
  value: string;
  onChange: (v: string) => void;
}) {
  const colors = SWATCHES[item.key]!;
  return (
    <div className="flex flex-wrap gap-2">
      {item.options.map((o) => (
        <button
          key={o}
          type="button"
          title={item.option_labels[o] ?? o}
          onClick={() => onChange(o)}
          className={cn(
            "flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-xs transition",
            value === o
              ? "border-primary/60 bg-primary/10 text-foreground"
              : "border-border text-muted-foreground hover:border-border-strong hover:text-foreground",
          )}
        >
          <span
            className="size-3.5 rounded-full ring-1 ring-white/15"
            style={{ background: colors[o] }}
          />
          {(item.option_labels[o] ?? o).replace(" (default)", "")}
        </button>
      ))}
    </div>
  );
}

/* ── Inputs ─────────────────────────────────────────────────────────── */

function ModelListInput({
  item,
  value,
  onChange,
  models,
  catalog,
}: {
  item: SettingItem;
  value: string[];
  onChange: (v: string[]) => void;
  models: CatalogModel[];
  catalog: Map<string, CatalogModel>;
}) {
  return (
    <div className="space-y-2">
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
                "inline-flex items-center gap-1.5 rounded-md border px-2 py-1 font-mono text-[11px]",
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
        <ModelPicker
          value=""
          onChange={(m) => !value.includes(m) && onChange([...value, m])}
          models={models}
          capability={item.capability}
          placeholder="Add a model…"
        />
      ) : null}
    </div>
  );
}

function ValueInput({
  item,
  value,
  onChange,
  models,
  catalog,
}: {
  item: SettingItem;
  value: SettingValue;
  onChange: (v: SettingValue) => void;
  models: CatalogModel[];
  catalog: Map<string, CatalogModel>;
}) {
  if (SWATCHES[item.key]) {
    return <SwatchPicker item={item} value={String(value ?? "")} onChange={onChange} />;
  }
  switch (item.type) {
    case "bool":
      return (
        <label className="inline-flex cursor-pointer items-center gap-2.5 text-xs text-muted-foreground">
          <Switch
            checked={Boolean(value)}
            disabled={!item.editable}
            onCheckedChange={(v) => onChange(v)}
          />
          <span className={cn(value ? "text-foreground" : "")}>{value ? "On" : "Off"}</span>
        </label>
      );
    case "enum":
      return (
        <Select value={String(value ?? "")} disabled={!item.editable} onValueChange={onChange}>
          <SelectTrigger className="h-9 w-full bg-background text-xs">
            <SelectValue placeholder="Choose…" />
          </SelectTrigger>
          <SelectContent>
            {item.options.map((o) => (
              <SelectItem key={o} value={o} className="text-xs">
                {item.option_labels[o] ?? o}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      );
    case "model":
      return (
        <ModelPicker
          value={String(value ?? "")}
          onChange={onChange}
          models={models}
          capability={item.capability}
          allowNone={item.allow_none}
          disabled={!item.editable}
        />
      );
    case "model_list":
      return (
        <ModelListInput
          item={item}
          value={Array.isArray(value) ? value : []}
          onChange={onChange}
          models={models}
          catalog={catalog}
        />
      );
    case "secret":
      return (
        <div className="flex h-9 items-center gap-2 rounded-md border border-border bg-secondary/50 px-3 font-mono text-xs text-muted-foreground">
          <Lock className="size-3.5" />
          {item.is_set ? "Set — hidden" : "Not set"}
        </div>
      );
    case "int":
    case "float":
      return (
        <div className="flex items-center gap-2">
          <Input
            type="number"
            value={value === null || value === undefined ? "" : String(value)}
            min={item.min ?? undefined}
            max={item.max ?? undefined}
            step={item.type === "float" ? "any" : 1}
            disabled={!item.editable}
            onChange={(e) => onChange(e.target.value === "" ? "" : Number(e.target.value))}
            className="h-9 font-mono text-xs"
          />
          {item.unit ? (
            <span className="shrink-0 text-[11px] text-muted-foreground">{item.unit}</span>
          ) : null}
        </div>
      );
    default:
      return (
        <Input
          value={String(value ?? "")}
          disabled={!item.editable}
          onChange={(e) => onChange(e.target.value)}
          className="h-9 font-mono text-xs"
        />
      );
  }
}

/** Warning under a model field: catalog review result, else a local check. */
function ModelWarning({
  item,
  value,
  catalog,
}: {
  item: SettingItem;
  value: SettingValue;
  catalog: Map<string, CatalogModel>;
}) {
  if (item.type !== "model" || typeof value !== "string" || !value || value === "none") return null;
  const status = item.model_status?.[value];
  const card = catalog.get(value);
  let message: string | null = null;
  if (status && status.status !== "ok" && status.status !== "unchecked") message = status.message;
  else if (!status && catalog.size > 0) {
    if (!card) message = `'${value}' is not in the Mistral model list for this account`;
    else if (!supports(card, item.capability))
      message = `'${value}' does not support ${item.capability?.replace("_", " ")}`;
  }
  return (
    <>
      <ModelFacts card={card} />
      {message ? (
        <p className="mt-1 flex items-start gap-1 text-[11px] text-amber">
          <AlertTriangle className="mt-px size-3 shrink-0" />
          {message}
        </p>
      ) : null}
    </>
  );
}

/* ── One setting ────────────────────────────────────────────────────── */

export interface SettingTileProps {
  item: SettingItem;
  value: SettingValue;
  dirty: boolean;
  onChange: (v: SettingValue) => void;
  onReset: () => void;
  models: CatalogModel[];
  catalog: Map<string, CatalogModel>;
  /** Inside a group card: smaller, impact shown once on the card. */
  compact?: boolean;
  hint?: string | null;
  /** Scroll target id. */
  anchorId?: string;
}

export function SettingTile({
  item,
  value,
  dirty,
  onChange,
  onReset,
  models,
  catalog,
  compact = false,
  hint,
  anchorId,
}: SettingTileProps) {
  const [showCode, setShowCode] = useState(false);
  const canReset = item.editable && (item.source === "override" || dirty);
  const wide = item.type === "model_list" || Boolean(SWATCHES[item.key]);

  return (
    <div
      id={anchorId}
      className={cn(
        "flex min-w-0 scroll-mt-24 flex-col",
        !compact &&
          "rounded-xl border border-border/50 bg-background-elevated/40 p-4 transition hover:border-border",
        !compact && dirty && "border-blue/40",
        !compact && wide && "xl:col-span-2",
      )}
    >
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <p className={cn("font-medium text-foreground", compact ? "text-xs" : "text-sm")}>
              {item.label}
            </p>
            <SourceChip item={item} dirty={dirty} />
            {item.apply === "restart" ? (
              <Chip
                className={cn(
                  item.restart_pending
                    ? "border-amber/30 bg-amber/10 text-amber"
                    : "border-border text-muted-foreground",
                )}
                title="Saved at once, takes effect when the service restarts"
              >
                <RotateCw className="size-2.5" />
                {item.restart_pending ? "Restart pending" : "On restart"}
              </Chip>
            ) : !compact ? (
              <Chip
                className="border-emerald/25 text-emerald/90"
                title="Applied as soon as you save"
              >
                <Zap className="size-2.5" />
                Live
              </Chip>
            ) : null}
            {!item.editable && item.type !== "secret" ? (
              <Chip className="border-border text-muted-foreground" title="Change it in .env">
                <Lock className="size-2.5" /> .env only
              </Chip>
            ) : null}
          </div>
          {!compact ? (
            <p className="mt-0.5 font-mono text-[10px] text-muted-foreground/70">{item.key}</p>
          ) : null}
        </div>
        {canReset ? (
          <button
            type="button"
            onClick={onReset}
            title={`Reset to default (${displayValue(item.default)})`}
            aria-label={`Reset ${item.label} to default`}
            className="shrink-0 rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <RotateCcw className="size-3.5" />
          </button>
        ) : null}
      </div>

      {item.description ? (
        <p
          className={cn(
            "text-muted-foreground",
            compact ? "mt-0.5 text-[11px]" : "mt-1.5 text-xs leading-relaxed",
          )}
        >
          {item.description}
        </p>
      ) : null}

      <div className={cn(compact ? "mt-2" : "mt-3")}>
        <ValueInput
          item={item}
          value={value}
          onChange={onChange}
          models={models}
          catalog={catalog}
        />
        <ModelWarning item={item} value={value} catalog={catalog} />
        {hint ? (
          <p className="mt-1 flex items-start gap-1 text-[11px] text-amber">
            <AlertTriangle className="mt-px size-3 shrink-0" />
            {hint}
          </p>
        ) : null}
      </div>

      {!compact ? (
        <div className="mt-auto pt-3">
          {item.impact.length ? (
            <div className="flex flex-wrap items-center gap-1">
              <span className="mr-0.5 text-[10px] tracking-wider text-muted-foreground uppercase">
                Impacts
              </span>
              {item.impact.map((a) => (
                <span
                  key={a}
                  className="rounded border border-border/70 bg-secondary/60 px-1.5 py-0.5 text-[10.5px] text-foreground/85"
                >
                  {a}
                </span>
              ))}
            </div>
          ) : null}
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
            {item.type !== "secret" ? (
              <span>
                Default{" "}
                <span className="font-mono text-foreground/80">{displayValue(item.default)}</span>
              </span>
            ) : null}
            {item.used_in.length ? (
              <button
                type="button"
                onClick={() => setShowCode((v) => !v)}
                className="inline-flex items-center gap-1 hover:text-foreground"
              >
                <Code2 className="size-3" />
                {item.used_in.length} code location{item.used_in.length > 1 ? "s" : ""}
                <ChevronDown className={cn("size-3 transition", showCode && "rotate-180")} />
              </button>
            ) : null}
          </div>
          {showCode ? (
            <ul className="mt-2 space-y-0.5 rounded-md border border-border/60 bg-background/60 p-2">
              {item.used_in.map((u) => (
                <li key={u} className="font-mono text-[10.5px] break-words text-muted-foreground">
                  {u}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
