/**
 * The run form's model: how each declared input is shown, checked and sent.
 *
 * Planner-made workflows declare inputs as `name` / `type` / `description` /
 * `required`, sometimes with richer hints (`format`, `enum`, `example`…). When
 * a hint is missing the control is inferred from the type and the name, so an
 * input called `loss_date` gets a date picker and `claim_description` a
 * multi-line box without anyone having annotated them.
 */
import type { InputField, WorkflowDefinition, WorkflowStep } from "@/types";

export type Control =
  | "text"
  | "long_text"
  | "email"
  | "url"
  | "date"
  | "datetime"
  | "number"
  | "integer"
  | "currency"
  | "percent"
  | "boolean"
  | "select"
  | "choice"
  | "list"
  | "json";

export interface ResolvedField {
  field: InputField;
  name: string;
  label: string;
  control: Control;
  required: boolean;
  description: string;
  options: string[];
  placeholder: string;
  /** Declared type, normalised: string | number | integer | boolean | object | array. */
  type: string;
  /** For list controls: what each entry is. */
  itemType: "string" | "number";
  /** True when the control was inferred rather than declared. */
  inferred: boolean;
  /** Read by the entry step but missing from the workflow's input schema. */
  undeclared: boolean;
  /** Steps that read this input, so the user sees why it is asked for. */
  usedBy: Array<{ id: string; type: string }>;
}

/* ── Inference ────────────────────────────────────────────────────────── */

const has = (name: string, re: RegExp) => re.test(name.toLowerCase());

const LONG_TEXT =
  /(description|text|content|body|notes?|message|document|paragraph|summary|details|query|question|prompt|request|ticket|claim|report|letter|feedback|comment|narrative|transcript|email_body|instructions|context|case|(^|_)input$|(^|_)data$)/;

function inferControl(f: InputField): { control: Control; inferred: boolean } {
  const type = normaliseType(f.type);
  const name = f.name ?? "";

  if (Array.isArray(f.enum) && f.enum.length > 0) {
    return { control: f.enum.length <= 4 ? "choice" : "select", inferred: false };
  }
  const declared = (f.format ?? "").toLowerCase();
  if (declared) {
    const map: Record<string, Control> = {
      text: "text",
      long_text: "long_text",
      textarea: "long_text",
      email: "email",
      url: "url",
      uri: "url",
      date: "date",
      datetime: "datetime",
      "date-time": "datetime",
      integer: "integer",
      currency: "currency",
      money: "currency",
      percent: "percent",
      percentage: "percent",
    };
    const c = map[declared];
    if (c) return { control: c, inferred: false };
  }

  switch (type) {
    case "boolean":
      return { control: "boolean", inferred: false };
    case "object":
      return { control: "json", inferred: false };
    case "array":
      // Chips only when the entries are declared scalars; anything else — line
      // items, records — needs structure, so it gets a JSON editor.
      return {
        control: ["string", "number", "integer"].includes(f.items ?? "") ? "list" : "json",
        inferred: false,
      };
    case "integer":
      return { control: "integer", inferred: false };
    case "number":
      if (
        has(
          name,
          /(amount|price|cost|total|salary|premium|fee|budget|revenue|income|payment|balance|limit|principal|loan|deposit)/,
        )
      )
        return { control: "currency", inferred: true };
      if (has(name, /(percent|pct|rate|ratio)/)) return { control: "percent", inferred: true };
      if (has(name, /(count|qty|quantity|days|months|years|age|number_of|num_)/))
        return { control: "integer", inferred: true };
      return { control: "number", inferred: false };
    default:
      break;
  }

  if (has(name, /e_?mail/) && !has(name, /body|content|text/))
    return { control: "email", inferred: true };
  if (has(name, /(^|_)(url|uri|link|website|endpoint|homepage)(_|$)/))
    return { control: "url", inferred: true };
  if (has(name, /(datetime|timestamp|_at$)/)) return { control: "datetime", inferred: true };
  if (has(name, /(date|_on$|(^|_)dob($|_)|deadline|birthday)/))
    return { control: "date", inferred: true };
  if (has(name, LONG_TEXT) || (f.description ?? "").length > 90)
    return { control: "long_text", inferred: true };
  return { control: "text", inferred: true };
}

export function normaliseType(type: string | undefined): string {
  const t = (type ?? "string").toLowerCase();
  if (["int", "integer"].includes(t)) return "integer";
  if (["float", "double", "decimal", "number"].includes(t)) return "number";
  if (["bool", "boolean"].includes(t)) return "boolean";
  if (["dict", "object", "json", "map"].includes(t)) return "object";
  if (["list", "array"].includes(t)) return "array";
  return "string";
}

export function humanise(name: string): string {
  const words = name
    .replace(/[_-]+/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : name;
}

const PLACEHOLDER: Partial<Record<Control, string>> = {
  email: "name@company.com",
  url: "https://",
  currency: "e.g. 250000",
  percent: "e.g. 7.5",
  integer: "Whole number",
  number: "Number",
  list: "Type a value and press Enter",
};

/* ── Where each input is used ─────────────────────────────────────────── */

const REF = /\{{2,}\s*([^{}\s]+?)\s*\}{2,}/g;

function collectRefs(value: unknown, into: Set<string>) {
  if (typeof value === "string") {
    for (const m of value.matchAll(REF)) {
      const root = (m[1] ?? "").split(".")[0];
      if (root) into.add(root);
    }
  } else if (Array.isArray(value)) {
    value.forEach((v) => collectRefs(v, into));
  } else if (value && typeof value === "object") {
    Object.values(value).forEach((v) => collectRefs(v, into));
  }
}

function refsOf(step: WorkflowStep): Set<string> {
  const refs = new Set<string>();
  collectRefs(step.config, refs);
  return refs;
}

/**
 * Variables the entry step reads that nothing declares. The entry step runs
 * first, so anything it references can only come from the run's input — a
 * name missing from the schema is an input the planner forgot to declare.
 */
export function undeclaredEntryInputs(def: WorkflowDefinition): string[] {
  const entry = def.steps.find((s) => s.id === def.entry_step);
  if (!entry) return [];
  const declared = new Set((def.input_schema ?? []).map((f) => f.name));
  const seeded = new Set(Object.keys(def.variables ?? {}));
  return [...refsOf(entry)].filter(
    (r) => !declared.has(r) && !seeded.has(r) && !/^step_.+_output$/.test(r),
  );
}

/* ── Resolve ──────────────────────────────────────────────────────────── */

export function resolveFields(def: WorkflowDefinition | undefined): ResolvedField[] {
  if (!def) return [];
  const stepRefs = def.steps.map((s) => ({ step: s, refs: refsOf(s) }));

  const declared = (def.input_schema ?? []).filter((f) => f && f.name);
  const undeclared = new Set(undeclaredEntryInputs(def));
  const extra: InputField[] = [...undeclared].map((name) => ({
    name,
    type: "string",
    required: true,
    description: "Read by the first step but not declared by the workflow.",
  }));

  return [...declared, ...extra].map((f) => {
    const { control, inferred } = inferControl(f);
    const type = normaliseType(f.type);
    const example = f.example ?? f.default;
    return {
      field: f,
      name: f.name,
      label: f.label || humanise(f.name),
      control,
      required: f.required !== false,
      description: f.description ?? "",
      options: (f.enum ?? []).map(String),
      placeholder:
        example !== undefined && example !== null && typeof example !== "object"
          ? String(example)
          : (PLACEHOLDER[control] ?? ""),
      type,
      itemType: f.items === "number" || f.items === "integer" ? "number" : "string",
      inferred,
      undeclared: undeclared.has(f.name) && !declared.some((d) => d.name === f.name),
      usedBy: stepRefs
        .filter(({ refs }) => refs.has(f.name))
        .map(({ step }) => ({ id: step.id, type: String(step.type) })),
    };
  });
}

/* ── A whole record where its rows were expected ──────────────────────── */

/**
 * `[{ invoice_number, …, line_items: [{…}, {…}] }]` given to a list input:
 * one record wrapping one list of records. Returns the inner field and rows,
 * or null. Mirrors the backend's check, which retries a tool with the rows
 * only after the tool rejects the record.
 */
export function wrappedCollection(
  value: unknown,
): { field: string; rows: Record<string, unknown>[] } | null {
  let record = value;
  if (Array.isArray(record)) {
    if (record.length !== 1) return null;
    record = record[0];
  }
  if (!record || typeof record !== "object" || Array.isArray(record)) return null;
  const entries = Object.entries(record as Record<string, unknown>);
  const lists = entries.filter(
    ([, v]) =>
      Array.isArray(v) &&
      v.length > 0 &&
      v.every((i) => i && typeof i === "object" && !Array.isArray(i)),
  );
  if (lists.length !== 1) return null;
  const [field, rows] = lists[0] as [string, Record<string, unknown>[]];
  const othersScalar = entries.every(
    ([k, v]) => k === field || v === null || typeof v !== "object",
  );
  return othersScalar ? { field, rows } : null;
}

/* ── Values ───────────────────────────────────────────────────────────── */

/** Form state: strings for text-like controls, booleans, string lists. */
export type FieldValue = string | boolean | string[];
export type FormValues = Record<string, FieldValue>;

export function initialValue(r: ResolvedField): FieldValue {
  const d = r.field.default;
  if (r.control === "boolean") return d === true || d === "true";
  if (r.control === "list") return Array.isArray(d) ? d.map(String) : [];
  if (d === undefined || d === null) return "";
  return typeof d === "object" ? JSON.stringify(d, null, 2) : String(d);
}

export function isEmpty(v: FieldValue | undefined): boolean {
  if (v === undefined) return true;
  if (typeof v === "boolean") return false;
  if (Array.isArray(v)) return v.length === 0;
  return v.trim() === "";
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** A human message when the value cannot be sent, else null. */
export function validate(r: ResolvedField, v: FieldValue | undefined): string | null {
  if (v === undefined || isEmpty(v)) return r.required ? "Required" : null;
  if (typeof v === "boolean") return null;
  if (Array.isArray(v)) {
    if (r.itemType === "number" && v.some((x) => Number.isNaN(Number(x))))
      return "Every entry must be a number";
    return null;
  }
  const s = v.trim();
  switch (r.control) {
    case "email":
      return EMAIL.test(s) ? null : "Enter a valid email address";
    case "url":
      try {
        const u = new URL(s);
        return u.protocol.startsWith("http") ? null : "Use an http(s) address";
      } catch {
        return "Enter a full URL, including https://";
      }
    case "number":
    case "integer":
    case "currency":
    case "percent": {
      const n = Number(s);
      if (Number.isNaN(n)) return "Enter a number";
      if (r.control === "integer" && !Number.isInteger(n)) return "Enter a whole number";
      if (r.field.min !== undefined && n < r.field.min) return `Must be at least ${r.field.min}`;
      if (r.field.max !== undefined && n > r.field.max) return `Must be at most ${r.field.max}`;
      return null;
    }
    case "select":
    case "choice":
      return r.options.includes(s) ? null : "Choose one of the options";
    case "json":
      try {
        const parsed: unknown = JSON.parse(s);
        if (r.type === "array" && !Array.isArray(parsed)) return "Must be a JSON array";
        if (
          r.type === "object" &&
          (parsed === null || typeof parsed !== "object" || Array.isArray(parsed))
        )
          return "Must be a JSON object";
        return null;
      } catch {
        return "Invalid JSON";
      }
    default:
      return null;
  }
}

/** The value as the workflow expects to receive it. */
export function toPayload(r: ResolvedField, v: FieldValue | undefined): unknown {
  if (typeof v === "boolean") return v;
  if (Array.isArray(v)) return r.itemType === "number" ? v.map(Number) : v;
  const s = (v ?? "").trim();
  switch (r.control) {
    case "number":
    case "integer":
    case "currency":
    case "percent":
      return Number(s);
    case "json":
      return JSON.parse(s) as unknown;
    case "datetime": {
      const d = new Date(s);
      return Number.isNaN(d.getTime()) ? s : d.toISOString();
    }
    case "select":
    case "choice": {
      // Keep numeric enums numeric.
      const original = r.field.enum?.find((o) => String(o) === s);
      return original ?? s;
    }
    default:
      return r.type === "number" || r.type === "integer" ? Number(s) : s;
  }
}

/** Build the run payload; optional empty fields are left out. */
export function buildPayload(fields: ResolvedField[], values: FormValues): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const r of fields) {
    const v = values[r.name];
    if (isEmpty(v) && r.control !== "boolean") continue;
    out[r.name] = toPayload(r, v);
  }
  return out;
}

/** Inverse of buildPayload, for switching back from the JSON editor. */
export function valuesFromPayload(
  fields: ResolvedField[],
  payload: Record<string, unknown>,
): FormValues {
  const out: FormValues = {};
  for (const r of fields) {
    const v = payload[r.name];
    if (v === undefined || v === null) {
      out[r.name] = initialValue(r);
    } else if (r.control === "boolean") {
      out[r.name] = v === true || v === "true";
    } else if (r.control === "list") {
      out[r.name] = Array.isArray(v) ? v.map(String) : [String(v)];
    } else if (r.control === "datetime" && typeof v === "string") {
      out[r.name] = toLocalDateTime(v);
    } else {
      out[r.name] = typeof v === "object" ? JSON.stringify(v, null, 2) : String(v);
    }
  }
  return out;
}

function toLocalDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** A plausible value, for "Fill example" — the declared example wins. */
export function exampleValue(r: ResolvedField): FieldValue {
  const ex = r.field.example ?? r.field.default;
  if (ex !== undefined && ex !== null) {
    if (r.control === "boolean") return ex === true || ex === "true";
    if (r.control === "list") return Array.isArray(ex) ? ex.map(String) : [String(ex)];
    return typeof ex === "object" ? JSON.stringify(ex, null, 2) : String(ex);
  }
  const today = new Date();
  switch (r.control) {
    case "boolean":
      return false;
    case "email":
      return "jane.doe@example.com";
    case "url":
      return "https://example.com";
    case "date":
      return today.toISOString().slice(0, 10);
    case "datetime":
      return toLocalDateTime(today.toISOString());
    case "currency":
      return String(r.field.min ?? 1000);
    case "percent":
      return String(r.field.min ?? 10);
    case "integer":
    case "number":
      return String(r.field.min ?? 1);
    case "select":
    case "choice":
      return r.options[0] ?? "";
    case "list":
      return r.itemType === "number" ? ["1", "2"] : ["first item", "second item"];
    case "json":
      return r.type === "array" ? "[]" : "{}";
    case "long_text":
      return r.description ? `Example: ${r.description}` : `Example ${r.label.toLowerCase()}`;
    default:
      return `Example ${r.label.toLowerCase()}`;
  }
}

/* ── Last input ───────────────────────────────────────────────────────── */

const lastInputKey = (workflow: string) => `workflow_last_input:${workflow}`;

/** Remember a payload that started a run, for "Use last input". */
export function rememberRunInput(workflow: string, payload: Record<string, unknown>) {
  try {
    localStorage.setItem(lastInputKey(workflow), JSON.stringify(payload));
  } catch {
    /* storage full or disabled — the shortcut is a convenience */
  }
}

export function readLastInput(workflow: string): Record<string, unknown> | null {
  try {
    const raw = localStorage.getItem(lastInputKey(workflow));
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}
