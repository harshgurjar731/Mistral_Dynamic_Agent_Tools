/**
 * The run form for a workflow — built from what the workflow needs.
 *
 * Every declared input gets the control its type and meaning call for, is
 * checked as it is filled in, and says which steps read it. Inputs the first
 * step reads but the workflow never declared are surfaced too, because a run
 * without them fails on its first step. Switch to JSON for a raw payload.
 */
import { useEffect, useMemo, useState, type KeyboardEvent, type ReactNode } from "react";
import {
  AlertCircle,
  Banknote,
  Braces,
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  Clock,
  History,
  Link2,
  List,
  Loader2,
  Mail,
  Percent,
  Play,
  RotateCcw,
  Sparkles,
  Type,
  WandSparkles,
  X,
} from "lucide-react";
import type { WorkflowDefinition } from "@/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { BLOCK, blockForMode } from "@/lib/terminology";
import { cn } from "@/lib/utils";
import {
  buildPayload,
  exampleValue,
  initialValue,
  isEmpty,
  resolveFields,
  validate,
  valuesFromPayload,
  type Control,
  type FieldValue,
  type FormValues,
  type ResolvedField,
  readLastInput,
  wrappedCollection,
} from "./fieldModel";

/** The wrapped rows in a list input's JSON text, if that is what it holds. */
function wrappedIn(r: ResolvedField, text: string) {
  if (r.type !== "array") return null;
  try {
    return wrappedCollection(JSON.parse(text));
  } catch {
    return null;
  }
}

/** Offer to replace a whole record with the rows the input actually wants. */
function WrappedHint({
  name,
  found,
  onUse,
}: {
  name: string;
  found: { field: string; rows: unknown[] };
  onUse: () => void;
}) {
  return (
    <div className="mt-1.5 rounded-md border border-amber/30 bg-amber/5 px-2.5 py-2 text-[11px] leading-relaxed text-amber">
      <p>
        <span className="font-mono">{name}</span> expects a list of items, but this is one record
        whose items are in <span className="font-mono">{found.field}</span>.
      </p>
      <button
        type="button"
        onClick={onUse}
        className="mt-1.5 rounded border border-amber/40 px-2 py-0.5 font-medium transition hover:bg-amber/10"
      >
        Use the {found.rows.length} item{found.rows.length === 1 ? "" : "s"} in{" "}
        <span className="font-mono">{found.field}</span>
      </button>
    </div>
  );
}

const CONTROL_BADGE: Record<Control, { label: string; icon: typeof Type }> = {
  text: { label: "Text", icon: Type },
  long_text: { label: "Long text", icon: Type },
  email: { label: "Email", icon: Mail },
  url: { label: "URL", icon: Link2 },
  date: { label: "Date", icon: CalendarDays },
  datetime: { label: "Date & time", icon: Clock },
  number: { label: "Number", icon: Type },
  integer: { label: "Whole number", icon: Type },
  currency: { label: "Amount", icon: Banknote },
  percent: { label: "Percent", icon: Percent },
  boolean: { label: "Yes / no", icon: CheckCircle2 },
  select: { label: "Choice", icon: List },
  choice: { label: "Choice", icon: List },
  list: { label: "List", icon: List },
  json: { label: "JSON", icon: Braces },
};

/* ── Controls ──────────────────────────────────────────────────────────── */

function Adorned({
  prefix,
  suffix,
  children,
}: {
  prefix?: ReactNode;
  suffix?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="relative">
      {prefix ? (
        <span className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-muted-foreground">
          {prefix}
        </span>
      ) : null}
      {children}
      {suffix ? (
        <span className="pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2 text-xs text-muted-foreground">
          {suffix}
        </span>
      ) : null}
    </div>
  );
}

function ListInput({
  id,
  value,
  onChange,
  onBlur,
  placeholder,
  numeric,
  invalid,
}: {
  id: string;
  value: string[];
  onChange: (v: string[]) => void;
  onBlur: () => void;
  placeholder: string;
  numeric: boolean;
  invalid: boolean;
}) {
  const [draft, setDraft] = useState("");
  const add = (text: string) => {
    const parts = text
      .split(/[\n,]/)
      .map((p) => p.trim())
      .filter(Boolean);
    if (parts.length) onChange([...value, ...parts]);
    setDraft("");
  };
  return (
    <div
      className={cn(
        "flex min-h-9 flex-wrap items-center gap-1.5 rounded-md border border-input bg-background-elevated/70 px-2 py-1.5 focus-within:ring-1 focus-within:ring-ring",
        invalid && "border-red/60",
      )}
    >
      {value.map((item, i) => (
        <span
          key={`${item}-${i}`}
          className="inline-flex items-center gap-1 rounded border border-border bg-surface px-1.5 py-0.5 font-mono text-[11px] text-foreground"
        >
          {item}
          <button
            type="button"
            aria-label={`Remove ${item}`}
            onClick={() => onChange(value.filter((_, idx) => idx !== i))}
            className="text-muted-foreground hover:text-foreground"
          >
            <X className="size-3" />
          </button>
        </span>
      ))}
      <input
        id={id}
        value={draft}
        inputMode={numeric ? "decimal" : undefined}
        placeholder={value.length ? "" : placeholder}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if ((e.key === "Enter" || e.key === ",") && !e.ctrlKey && !e.metaKey) {
            e.preventDefault();
            add(draft);
          } else if (e.key === "Backspace" && !draft && value.length) {
            onChange(value.slice(0, -1));
          }
        }}
        onPaste={(e) => {
          const text = e.clipboardData.getData("text");
          if (/[\n,]/.test(text)) {
            e.preventDefault();
            add(text);
          }
        }}
        onBlur={() => {
          if (draft.trim()) add(draft);
          onBlur();
        }}
        className="min-w-[8rem] flex-1 bg-transparent text-xs text-foreground outline-none placeholder:text-muted-foreground"
      />
    </div>
  );
}

function FieldControl({
  r,
  id,
  value,
  invalid,
  onChange,
  onBlur,
}: {
  r: ResolvedField;
  id: string;
  value: FieldValue | undefined;
  invalid: boolean;
  onChange: (v: FieldValue) => void;
  onBlur: () => void;
}) {
  const text = typeof value === "string" ? value : "";
  const base = cn("text-xs", invalid && "border-red/60 focus-visible:ring-red/40");
  const numberProps = {
    min: r.field.min,
    max: r.field.max,
  };

  switch (r.control) {
    case "boolean":
      return (
        <label htmlFor={id} className="flex h-9 cursor-pointer items-center gap-2.5">
          <Switch
            id={id}
            checked={value === true}
            onCheckedChange={(checked) => {
              onChange(checked);
              onBlur();
            }}
          />
          <span className="text-xs text-foreground">{value === true ? "Yes" : "No"}</span>
        </label>
      );
    case "choice":
      return (
        <div role="radiogroup" id={id} className="flex flex-wrap gap-1.5">
          {r.options.map((o) => (
            <button
              key={o}
              type="button"
              role="radio"
              aria-checked={text === o}
              onClick={() => {
                onChange(text === o && !r.required ? "" : o);
                onBlur();
              }}
              className={cn(
                "rounded-md border px-2.5 py-1.5 text-xs transition",
                text === o
                  ? "border-primary/50 bg-primary/10 text-primary"
                  : "border-border bg-background-elevated/60 text-muted-foreground hover:border-border-strong hover:text-foreground",
              )}
            >
              {o}
            </button>
          ))}
        </div>
      );
    case "select":
      return (
        <select
          id={id}
          value={text}
          onChange={(e) => onChange(e.target.value)}
          onBlur={onBlur}
          className={cn(
            "h-9 w-full rounded-md border border-input bg-background-elevated/70 px-2 text-xs text-foreground",
            invalid && "border-red/60",
          )}
        >
          <option value="">{r.required ? "Choose…" : "— none —"}</option>
          {r.options.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
      );
    case "list":
      return (
        <ListInput
          id={id}
          value={Array.isArray(value) ? value : []}
          onChange={onChange}
          onBlur={onBlur}
          placeholder={r.placeholder}
          numeric={r.itemType === "number"}
          invalid={invalid}
        />
      );
    case "long_text":
      return (
        <div>
          <Textarea
            id={id}
            rows={4}
            value={text}
            placeholder={r.placeholder}
            onChange={(e) => onChange(e.target.value)}
            onBlur={onBlur}
            className={cn(base, "resize-y leading-relaxed")}
          />
          {text ? (
            <p className="mt-0.5 text-right text-[10px] text-muted-foreground tabular-nums">
              {text.length.toLocaleString()} chars
            </p>
          ) : null}
        </div>
      );
    case "json":
      return (
        <div>
          <Textarea
            id={id}
            rows={5}
            spellCheck={false}
            value={text}
            placeholder={r.type === "array" ? "[]" : "{}"}
            onChange={(e) => onChange(e.target.value)}
            onBlur={onBlur}
            className={cn(base, "font-mono")}
          />
          <div className="mt-1 flex justify-end">
            <button
              type="button"
              onClick={() => {
                try {
                  onChange(JSON.stringify(JSON.parse(text), null, 2));
                } catch {
                  onBlur();
                }
              }}
              className="text-[10px] text-muted-foreground hover:text-foreground"
            >
              Format JSON
            </button>
          </div>
          {(() => {
            const found = wrappedIn(r, text);
            return found ? (
              <WrappedHint
                name={r.name}
                found={found}
                onUse={() => onChange(JSON.stringify(found.rows, null, 2))}
              />
            ) : null;
          })()}
        </div>
      );
    case "currency":
      return (
        <Adorned prefix={<Banknote className="size-3.5" />}>
          <Input
            id={id}
            type="number"
            step="0.01"
            inputMode="decimal"
            {...numberProps}
            value={text}
            placeholder={r.placeholder}
            onChange={(e) => onChange(e.target.value)}
            onBlur={onBlur}
            className={cn(base, "pl-8 tabular-nums")}
          />
        </Adorned>
      );
    case "percent":
      return (
        <Adorned suffix="%">
          <Input
            id={id}
            type="number"
            step="any"
            inputMode="decimal"
            {...numberProps}
            value={text}
            placeholder={r.placeholder}
            onChange={(e) => onChange(e.target.value)}
            onBlur={onBlur}
            className={cn(base, "pr-8 tabular-nums")}
          />
        </Adorned>
      );
    case "number":
    case "integer":
      return (
        <Input
          id={id}
          type="number"
          step={r.control === "integer" ? 1 : "any"}
          inputMode={r.control === "integer" ? "numeric" : "decimal"}
          {...numberProps}
          value={text}
          placeholder={r.placeholder}
          onChange={(e) => onChange(e.target.value)}
          onBlur={onBlur}
          className={cn(base, "tabular-nums")}
        />
      );
    case "date":
    case "datetime":
      return (
        <Input
          id={id}
          type={r.control === "date" ? "date" : "datetime-local"}
          value={text}
          onChange={(e) => onChange(e.target.value)}
          onBlur={onBlur}
          className={cn(base, "[color-scheme:dark]")}
        />
      );
    case "email":
    case "url":
      return (
        <Adorned
          prefix={
            r.control === "email" ? <Mail className="size-3.5" /> : <Link2 className="size-3.5" />
          }
        >
          <Input
            id={id}
            type={r.control}
            value={text}
            placeholder={r.placeholder}
            onChange={(e) => onChange(e.target.value)}
            onBlur={onBlur}
            className={cn(base, "pl-8")}
          />
        </Adorned>
      );
    default:
      return (
        <Input
          id={id}
          value={text}
          placeholder={r.placeholder}
          onChange={(e) => onChange(e.target.value)}
          onBlur={onBlur}
          className={base}
        />
      );
  }
}

function FieldRow({
  r,
  value,
  error,
  showError,
  onChange,
  onBlur,
}: {
  r: ResolvedField;
  value: FieldValue | undefined;
  error: string | null;
  showError: boolean;
  onChange: (v: FieldValue) => void;
  onBlur: () => void;
}) {
  const id = `run-input-${r.name}`;
  const badge = CONTROL_BADGE[r.control];
  const BadgeIcon = badge.icon;
  const undeclared = r.undeclared;
  const filled = !isEmpty(value) && !error;

  return (
    <div id={`${id}-row`} className="scroll-mt-24">
      <div className="mb-1.5 flex items-center gap-2">
        <label htmlFor={id} className="min-w-0 truncate text-xs font-medium text-foreground">
          {r.label}
          {r.required ? <span className="ml-0.5 text-red">*</span> : null}
        </label>
        {filled ? <CheckCircle2 className="size-3 shrink-0 text-emerald" /> : null}
        {undeclared ? (
          <span className="shrink-0 rounded border border-amber/25 bg-amber/10 px-1.5 py-0.5 text-[9px] text-amber">
            not declared
          </span>
        ) : null}
        <span className="ml-auto inline-flex shrink-0 items-center gap-1 rounded border border-border bg-background-elevated/60 px-1.5 py-0.5 text-[9px] text-muted-foreground">
          <BadgeIcon className="size-2.5" />
          {badge.label}
          {r.control === "list" && r.itemType === "number" ? " of numbers" : ""}
        </span>
      </div>
      {r.label !== r.name ? (
        <p className="-mt-1 mb-1.5 font-mono text-[10px] text-muted-foreground/70">{r.name}</p>
      ) : null}

      <FieldControl
        r={r}
        id={id}
        value={value}
        invalid={showError && Boolean(error)}
        onChange={onChange}
        onBlur={onBlur}
      />

      {showError && error ? (
        <p className="mt-1 flex items-center gap-1 text-[11px] text-red">
          <AlertCircle className="size-3" /> {error}
        </p>
      ) : r.description ? (
        <p
          className={cn(
            "mt-1 text-[11px] leading-relaxed",
            undeclared ? "text-amber" : "text-muted-foreground",
          )}
        >
          {r.description}
        </p>
      ) : null}

      {r.usedBy.length > 0 ? (
        <div className="mt-1.5 flex flex-wrap items-center gap-1">
          <span className="text-[10px] text-muted-foreground">Used by</span>
          {r.usedBy.map((u) => {
            const block = blockForMode(u.type);
            return (
              <span
                key={u.id}
                title={block ? BLOCK[block].label : u.type}
                className={cn(
                  "rounded border px-1.5 py-0.5 font-mono text-[9px]",
                  block ? BLOCK[block].chip : "border-border text-muted-foreground",
                )}
              >
                {u.id}
              </span>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

/* ── Form ──────────────────────────────────────────────────────────────── */

export function WorkflowRunForm({
  definition,
  running,
  onRun,
  blockedReason,
}: {
  definition: WorkflowDefinition;
  running: boolean;
  onRun: (input: Record<string, unknown>) => void;
  /** Set while the run must not start (e.g. unmet prerequisites); shown under the button. */
  blockedReason?: string | null | undefined;
}) {
  // Keyed on what the form is built from, so a refetch that returns the same
  // definition never resets what the user has typed.
  const signature = JSON.stringify([
    definition.name,
    definition.entry_step,
    definition.input_schema,
    definition.steps.map((s) => [s.id, s.type, s.config]),
  ]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const fields = useMemo(() => resolveFields(definition), [signature]);
  const usesForm = fields.length > 0;
  const initial = useMemo(
    () => Object.fromEntries(fields.map((r) => [r.name, initialValue(r)])) as FormValues,
    [fields],
  );

  const [mode, setMode] = useState<"form" | "json">(usesForm ? "form" : "json");
  const [values, setValues] = useState<FormValues>(initial);
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [submitted, setSubmitted] = useState(false);
  const [jsonText, setJsonText] = useState("{}");
  const [jsonError, setJsonError] = useState<string | null>(null);
  const [showOptional, setShowOptional] = useState(true);
  const [lastInput, setLastInput] = useState<Record<string, unknown> | null>(null);

  // A different workflow (or a reloaded definition) starts a fresh form.
  useEffect(() => {
    setValues(initial);
    setTouched({});
    setSubmitted(false);
    setMode(usesForm ? "form" : "json");
    setJsonText("{}");
    setJsonError(null);
    setLastInput(readLastInput(definition.name));
  }, [initial, usesForm, definition.name]);

  // A run that just started has stored its input — offer it next time.
  useEffect(() => {
    if (!running) setLastInput(readLastInput(definition.name));
  }, [running, definition.name]);

  const required = fields.filter((r) => r.required);
  const optional = fields.filter((r) => !r.required);
  const errors = useMemo(
    () => Object.fromEntries(fields.map((r) => [r.name, validate(r, values[r.name])])),
    [fields, values],
  );
  const readyRequired = required.filter((r) => !errors[r.name]).length;
  const invalidCount = fields.filter((r) => errors[r.name] && !isEmpty(values[r.name])).length;
  const missingCount = required.filter((r) => isEmpty(values[r.name])).length;
  const canRun = mode === "json" ? !jsonError : invalidCount === 0 && missingCount === 0;

  const set = (name: string, v: FieldValue) => setValues((prev) => ({ ...prev, [name]: v }));
  const touch = (name: string) =>
    setTouched((prev) => (prev[name] ? prev : { ...prev, [name]: true }));

  const toJsonMode = () => {
    const payload: Record<string, unknown> = {};
    for (const r of fields) {
      const v = values[r.name];
      if (isEmpty(v) && r.control !== "boolean") continue;
      try {
        Object.assign(payload, buildPayload([r], { [r.name]: v as FieldValue }));
      } catch {
        payload[r.name] = v; // an unparsable JSON field is carried as typed
      }
    }
    setJsonText(JSON.stringify(payload, null, 2));
    setJsonError(null);
    setMode("json");
  };

  const parseJson = (): Record<string, unknown> | null => {
    try {
      const parsed: unknown = JSON.parse(jsonText || "{}");
      if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
        setJsonError("The payload must be a JSON object.");
        return null;
      }
      setJsonError(null);
      return parsed as Record<string, unknown>;
    } catch (e) {
      setJsonError(e instanceof Error ? `Invalid JSON — ${e.message}` : "Invalid JSON");
      return null;
    }
  };

  // How the raw payload lines up with what the workflow declares. A payload
  // with its own field names starts a run whose first step cannot find its
  // input — say so before it is sent.
  const jsonFit = useMemo(() => {
    if (!usesForm || mode !== "json") return null;
    let parsed: unknown;
    try {
      parsed = JSON.parse(jsonText || "{}");
    } catch {
      return null;
    }
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const payload = parsed as Record<string, unknown>;
    const keys = Object.keys(payload);
    const declared = new Set(fields.map((r) => r.name));
    return {
      payload,
      missing: fields.filter((r) => r.required && !keys.includes(r.name)).map((r) => r.name),
      unknown: keys.filter((k) => !declared.has(k) && !k.startsWith("_")),
      wrapped: fields
        .filter((r) => r.type === "array" && keys.includes(r.name))
        .map((r) => ({ name: r.name, found: wrappedCollection(payload[r.name]) }))
        .filter((w): w is { name: string; found: NonNullable<typeof w.found> } => w.found !== null),
    };
  }, [usesForm, mode, jsonText, fields]);

  const toFormMode = () => {
    const parsed = parseJson();
    if (!parsed) return;
    setValues(valuesFromPayload(fields, parsed));
    setMode("form");
  };

  const submit = () => {
    if (running || blockedReason) return;
    if (mode === "json") {
      const parsed = parseJson();
      if (!parsed) return;
      if (jsonFit && jsonFit.missing.length > 0) {
        setSubmitted(true);
        return;
      }
      onRun(parsed);
      return;
    }
    setSubmitted(true);
    const firstBad = fields.find((r) => errors[r.name]);
    if (firstBad) {
      if (!firstBad.required) setShowOptional(true);
      document
        .getElementById(`run-input-${firstBad.name}-row`)
        ?.scrollIntoView({ behavior: "smooth", block: "center" });
      document.getElementById(`run-input-${firstBad.name}`)?.focus();
      return;
    }
    onRun(buildPayload(fields, values));
  };

  const fillExample = () => {
    setValues((prev) => {
      const next = { ...prev };
      for (const r of fields) if (isEmpty(prev[r.name])) next[r.name] = exampleValue(r);
      return next;
    });
  };

  const useLast = () => {
    if (!lastInput) return;
    if (mode === "json" || !usesForm) {
      setJsonText(JSON.stringify(lastInput, null, 2));
      setJsonError(null);
    } else {
      setValues(valuesFromPayload(fields, lastInput));
    }
  };

  const reset = () => {
    setValues(initial);
    setTouched({});
    setSubmitted(false);
    setJsonText("{}");
    setJsonError(null);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      submit();
    }
  };

  const renderRow = (r: ResolvedField) => (
    <FieldRow
      key={r.name}
      r={r}
      value={values[r.name]}
      error={errors[r.name] ?? null}
      showError={submitted || Boolean(touched[r.name])}
      onChange={(v) => set(r.name, v)}
      onBlur={() => touch(r.name)}
    />
  );

  const blockers: string[] = [];
  if (mode === "form") {
    if (missingCount)
      blockers.push(`${missingCount} required input${missingCount === 1 ? "" : "s"} missing`);
    if (invalidCount) blockers.push(`${invalidCount} invalid`);
  } else if (jsonError) {
    blockers.push("Fix the JSON payload");
  } else if (jsonFit && jsonFit.missing.length > 0) {
    blockers.push(`Missing ${jsonFit.missing.join(", ")}`);
  }

  return (
    <div onKeyDown={onKeyDown} className="flex flex-col">
      {/* Summary + mode */}
      <div className="border-b border-border px-4 py-3">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            {usesForm ? (
              <p className="text-xs text-foreground">
                <span className="font-semibold">{fields.length}</span> input
                {fields.length === 1 ? "" : "s"}
                <span className="text-muted-foreground">
                  {" "}
                  · {required.length} required · {optional.length} optional
                </span>
              </p>
            ) : (
              <p className="text-xs text-muted-foreground">No declared inputs — free-form JSON</p>
            )}
          </div>
          {usesForm ? (
            <div className="flex shrink-0 rounded-md border border-border bg-background-elevated/60 p-0.5">
              {(["form", "json"] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() =>
                    m === "json" ? mode !== "json" && toJsonMode() : mode !== "form" && toFormMode()
                  }
                  className={cn(
                    "rounded px-2.5 py-1 text-[11px] font-medium transition",
                    mode === m
                      ? "bg-surface text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {m === "form" ? "Form" : "JSON"}
                </button>
              ))}
            </div>
          ) : null}
        </div>

        {usesForm && mode === "form" && required.length > 0 ? (
          <div className="mt-2.5">
            <div className="h-1 overflow-hidden rounded-full bg-border/60">
              <div
                className={cn(
                  "h-full rounded-full transition-[width] duration-300",
                  readyRequired === required.length ? "bg-emerald" : "bg-primary",
                )}
                style={{ width: `${Math.round((readyRequired / required.length) * 100)}%` }}
              />
            </div>
            <p className="mt-1 text-[10px] text-muted-foreground tabular-nums">
              {readyRequired} of {required.length} required ready
            </p>
          </div>
        ) : null}

        <div className="mt-2.5 flex flex-wrap gap-1.5">
          {usesForm && mode === "form" ? (
            <button
              type="button"
              onClick={fillExample}
              className="inline-flex items-center gap-1 rounded-md border border-border/60 px-2 py-1 text-[10px] text-muted-foreground transition hover:border-border hover:text-foreground"
            >
              <WandSparkles className="size-3" /> Fill example
            </button>
          ) : null}
          {lastInput ? (
            <button
              type="button"
              onClick={useLast}
              className="inline-flex items-center gap-1 rounded-md border border-border/60 px-2 py-1 text-[10px] text-muted-foreground transition hover:border-border hover:text-foreground"
            >
              <History className="size-3" /> Use last input
            </button>
          ) : null}
          <button
            type="button"
            onClick={reset}
            className="inline-flex items-center gap-1 rounded-md border border-border/60 px-2 py-1 text-[10px] text-muted-foreground transition hover:border-border hover:text-foreground"
          >
            <RotateCcw className="size-3" /> Reset
          </button>
        </div>
      </div>

      {/* Fields */}
      <div className="space-y-5 p-4">
        {mode === "json" ? (
          <div>
            <label htmlFor="run-json" className="eyebrow mb-1.5 block">
              Payload
            </label>
            <Textarea
              id="run-json"
              rows={12}
              spellCheck={false}
              value={jsonText}
              onChange={(e) => {
                setJsonText(e.target.value);
                setJsonError(null);
              }}
              onBlur={() => parseJson()}
              className={cn("font-mono text-xs", jsonError && "border-red/60")}
            />
            {jsonError ? <p className="mt-1 text-[11px] text-red">{jsonError}</p> : null}
            {jsonFit && jsonFit.missing.length > 0 ? (
              <p className="mt-1 flex items-start gap-1 text-[11px] text-red">
                <AlertCircle className="mt-0.5 size-3 shrink-0" />
                <span>
                  Missing required input{jsonFit.missing.length === 1 ? "" : "s"}:{" "}
                  <span className="font-mono">{jsonFit.missing.join(", ")}</span>. This workflow
                  expects <span className="font-mono">{fields.map((r) => r.name).join(", ")}</span>.
                </span>
              </p>
            ) : null}
            {jsonFit?.wrapped.map((w) => (
              <WrappedHint
                key={w.name}
                name={w.name}
                found={w.found}
                onUse={() =>
                  setJsonText(
                    JSON.stringify({ ...jsonFit.payload, [w.name]: w.found.rows }, null, 2),
                  )
                }
              />
            ))}
            {jsonFit && jsonFit.unknown.length > 0 ? (
              <p className="mt-1 flex items-start gap-1 text-[11px] text-amber">
                <AlertCircle className="mt-0.5 size-3 shrink-0" />
                <span>
                  Not inputs of this workflow — no step reads them:{" "}
                  <span className="font-mono">{jsonFit.unknown.join(", ")}</span>
                  {jsonFit.missing.length > 0
                    ? ". Put this data under the expected input instead."
                    : "."}
                </span>
              </p>
            ) : null}
            <p className="mt-1 text-[11px] text-muted-foreground">
              {usesForm
                ? "Edit the exact payload. Switching back to Form keeps the declared inputs."
                : "This workflow declares no inputs, so the object is passed through as the run's variables."}
            </p>
          </div>
        ) : (
          <>
            {required.length > 0 ? (
              <section className="space-y-4">
                <p className="technical-label text-muted-foreground">Required</p>
                {required.map(renderRow)}
              </section>
            ) : null}

            {optional.length > 0 ? (
              <section className="space-y-4">
                <button
                  type="button"
                  onClick={() => setShowOptional((s) => !s)}
                  className="technical-label flex w-full items-center gap-1 text-muted-foreground hover:text-foreground"
                >
                  Optional ({optional.length})
                  <ChevronDown
                    className={cn(
                      "ml-auto size-3 transition-transform",
                      !showOptional && "-rotate-90",
                    )}
                  />
                </button>
                {showOptional ? optional.map(renderRow) : null}
              </section>
            ) : null}

            {fields.some((r) => r.inferred) ? (
              <p className="flex items-start gap-1.5 text-[10px] leading-relaxed text-muted-foreground/80">
                <Sparkles className="mt-0.5 size-3 shrink-0" />
                Some field types were inferred from the input names — the workflow did not declare a
                format for them.
              </p>
            ) : null}
          </>
        )}
      </div>

      {/* Run */}
      <div className="sticky bottom-0 border-t border-border bg-background/85 p-4 backdrop-blur">
        <Button
          className="w-full"
          disabled={running || Boolean(blockedReason) || (mode === "json" && Boolean(jsonError))}
          onClick={submit}
        >
          {running ? <Loader2 className="size-4 animate-spin" /> : <Play className="size-4" />}
          {running ? "Starting…" : "Run workflow"}
        </Button>
        <p className="mt-1.5 text-center text-[10px] text-muted-foreground">
          {blockedReason ? (
            <span className="text-destructive">{blockedReason}</span>
          ) : blockers.length && (submitted || mode === "json") ? (
            <span className="text-amber">{blockers.join(" · ")}</span>
          ) : canRun && !jsonFit?.missing.length ? (
            <>Ready · Ctrl + Enter to run</>
          ) : (
            <>{blockers.join(" · ")} · Ctrl + Enter to run</>
          )}
        </p>
      </div>
    </div>
  );
}
