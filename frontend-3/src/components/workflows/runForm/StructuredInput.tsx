/**
 * A record or list input, as fields instead of a JSON box.
 *
 * The workflow's input schema carries the nested JSON Schema of each
 * structured input (taken from the activity parameter it feeds). This renders
 * it: a record as labelled fields, a list of flat records as an editable
 * table, a list of richer records as cards, a list of values as rows. The
 * form's state stays the JSON text, so validation and the payload are the same
 * whichever view is used — and "JSON" is always one click away.
 */
import { useEffect, useState, type ReactNode } from "react";
import { Braces, Plus, Rows3, Trash2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { humanise, type ResolvedField } from "./fieldModel";

type Schema = Record<string, unknown>;
const MAX_DEPTH = 4;

const isRecord = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === "object" && !Array.isArray(v);

function typeOf(schema: Schema | undefined): string {
  if (!schema) return "string";
  const t = schema["type"];
  if (Array.isArray(t)) return String(t.find((x) => x !== "null") ?? "string");
  if (typeof t === "string") return t;
  if (schema["properties"]) return "object";
  if (schema["items"]) return "array";
  return "string";
}

function propsOf(schema: Schema): Record<string, Schema> {
  const p = schema["properties"];
  return isRecord(p) ? (p as Record<string, Schema>) : {};
}

function requiredOf(schema: Schema): string[] {
  const r = schema["required"];
  return Array.isArray(r) ? r.map(String) : [];
}

function itemsOf(schema: Schema): Schema {
  const i = schema["items"];
  return isRecord(i) ? i : { type: "string" };
}

const isScalarType = (t: string) => ["string", "number", "integer", "boolean"].includes(t);

/** True when the schema gives enough structure to show fields. */
export function canStructure(r: ResolvedField): boolean {
  const s = r.field.schema;
  if (!s) return false;
  const t = typeOf(s);
  if (t === "object") return Object.keys(propsOf(s)).length > 0;
  if (t === "array") {
    const it = itemsOf(s);
    const itType = typeOf(it);
    return isScalarType(itType) || (itType === "object" && Object.keys(propsOf(it)).length > 0);
  }
  return false;
}

/** An empty value of the schema's shape — what "Add" puts in a list. */
function blank(schema: Schema, depth = 0): unknown {
  if (depth > MAX_DEPTH) return null;
  switch (typeOf(schema)) {
    case "object":
      return Object.fromEntries(
        Object.entries(propsOf(schema)).map(([k, v]) => [k, blank(v, depth + 1)]),
      );
    case "array":
      return [];
    case "boolean":
      return false;
    case "number":
    case "integer":
      return null;
    default:
      return "";
  }
}

/* ── Leaves ─────────────────────────────────────────────────────────────── */

function JsonLeaf({
  id,
  value,
  onChange,
}: {
  id: string;
  value: unknown;
  onChange: (v: unknown) => void;
}) {
  const external = JSON.stringify(value ?? null, null, 2);
  const [text, setText] = useState(external);
  const [bad, setBad] = useState(false);
  useEffect(() => {
    setText(external);
    setBad(false);
  }, [external]);
  return (
    <Textarea
      id={id}
      rows={3}
      spellCheck={false}
      value={text}
      onChange={(e) => {
        setText(e.target.value);
        try {
          onChange(JSON.parse(e.target.value) as unknown);
          setBad(false);
        } catch {
          setBad(true);
        }
      }}
      className={cn("font-mono text-xs", bad && "border-red/60")}
    />
  );
}

function ScalarInput({
  id,
  schema,
  value,
  onChange,
  onBlur,
  compact,
}: {
  id: string;
  schema: Schema;
  value: unknown;
  onChange: (v: unknown) => void;
  onBlur: () => void;
  compact?: boolean;
}) {
  const t = typeOf(schema);
  const en = schema["enum"];
  const fmt = String(schema["format"] ?? "").toLowerCase();
  const h = compact ? "h-8" : "h-9";

  if (Array.isArray(en) && en.length) {
    return (
      <select
        id={id}
        value={value == null ? "" : String(value)}
        onChange={(e) => {
          const original = en.find((o) => String(o) === e.target.value);
          onChange(e.target.value === "" ? "" : (original ?? e.target.value));
        }}
        onBlur={onBlur}
        className={cn(
          h,
          "w-full rounded-md border border-input bg-background-elevated/70 px-2 text-xs text-foreground",
        )}
      >
        <option value="">Choose…</option>
        {en.map((o) => (
          <option key={String(o)} value={String(o)}>
            {String(o)}
          </option>
        ))}
      </select>
    );
  }
  if (t === "boolean") {
    return (
      <label htmlFor={id} className={cn("flex cursor-pointer items-center gap-2", h)}>
        <Switch
          id={id}
          checked={value === true}
          onCheckedChange={(c) => {
            onChange(c);
            onBlur();
          }}
        />
        <span className="text-xs text-foreground">{value === true ? "Yes" : "No"}</span>
      </label>
    );
  }
  if (t === "number" || t === "integer") {
    return (
      <Input
        id={id}
        type="number"
        step={t === "integer" ? 1 : "any"}
        inputMode={t === "integer" ? "numeric" : "decimal"}
        min={typeof schema["minimum"] === "number" ? schema["minimum"] : undefined}
        max={typeof schema["maximum"] === "number" ? schema["maximum"] : undefined}
        value={value == null || Number.isNaN(value) ? "" : String(value)}
        onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))}
        onBlur={onBlur}
        className={cn(h, "text-xs tabular-nums")}
      />
    );
  }
  if (t !== "string" && value !== null && typeof value === "object") {
    return <JsonLeaf id={id} value={value} onChange={onChange} />;
  }
  const text = value == null ? "" : String(value);
  if (fmt === "date") {
    return (
      <Input
        id={id}
        type="date"
        value={text.slice(0, 10)}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onBlur}
        className={cn(h, "text-xs")}
      />
    );
  }
  if (fmt === "date-time" || fmt === "datetime") {
    return (
      <Input
        id={id}
        type="datetime-local"
        value={text.slice(0, 16)}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onBlur}
        className={cn(h, "text-xs")}
      />
    );
  }
  const long =
    !compact &&
    (text.length > 80 ||
      text.includes("\n") ||
      (typeof schema["maxLength"] === "number" && schema["maxLength"] > 200));
  if (long) {
    return (
      <Textarea
        id={id}
        rows={3}
        value={text}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onBlur}
        className="resize-y text-xs leading-relaxed"
      />
    );
  }
  return (
    <Input
      id={id}
      type={fmt === "email" ? "email" : fmt === "uri" || fmt === "url" ? "url" : "text"}
      value={text}
      onChange={(e) => onChange(e.target.value)}
      onBlur={onBlur}
      className={cn(h, "text-xs")}
    />
  );
}

/* ── Containers ─────────────────────────────────────────────────────────── */

function Labelled({
  id,
  name,
  schema,
  required,
  children,
}: {
  id: string;
  name: string;
  schema: Schema;
  required: boolean;
  children: ReactNode;
}) {
  const title = typeof schema["title"] === "string" ? schema["title"] : humanise(name);
  const description = typeof schema["description"] === "string" ? schema["description"] : "";
  return (
    <div className="min-w-0">
      <label htmlFor={id} className="mb-1 block truncate text-[11px] font-medium text-foreground">
        {title}
        {required ? <span className="ml-0.5 text-red">*</span> : null}
      </label>
      {children}
      {description ? (
        <p className="mt-0.5 text-[10px] leading-snug text-muted-foreground">{description}</p>
      ) : null}
    </div>
  );
}

function ObjectFields({
  id,
  schema,
  value,
  onChange,
  onBlur,
  depth,
}: {
  id: string;
  schema: Schema;
  value: unknown;
  onChange: (v: unknown) => void;
  onBlur: () => void;
  depth: number;
}) {
  const record = isRecord(value) ? value : {};
  const required = new Set(requiredOf(schema));
  const props = Object.entries(propsOf(schema));
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {props.map(([key, sub]) => {
        const subId = `${id}-${key}`;
        const t = typeOf(sub);
        const set = (v: unknown) => onChange({ ...record, [key]: v });
        const nested = t === "object" || t === "array";
        return (
          <div key={key} className={cn(nested && "sm:col-span-2")}>
            <Labelled id={subId} name={key} schema={sub} required={required.has(key)}>
              {nested ? (
                <div className="rounded-lg border border-border/70 bg-background-elevated/30 p-2.5">
                  <SchemaNode
                    id={subId}
                    schema={sub}
                    value={record[key]}
                    onChange={set}
                    onBlur={onBlur}
                    depth={depth + 1}
                  />
                </div>
              ) : (
                <ScalarInput
                  id={subId}
                  schema={sub}
                  value={record[key]}
                  onChange={set}
                  onBlur={onBlur}
                />
              )}
            </Labelled>
          </div>
        );
      })}
    </div>
  );
}

function AddButton({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-1 rounded-md border border-dashed border-border px-2.5 py-1 text-[11px] text-muted-foreground transition hover:border-primary/50 hover:text-primary"
    >
      <Plus className="size-3" /> {label}
    </button>
  );
}

function RemoveButton({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className="rounded p-1 text-muted-foreground transition hover:bg-red/10 hover:text-red"
    >
      <Trash2 className="size-3" />
    </button>
  );
}

function ArrayFields({
  id,
  schema,
  value,
  onChange,
  onBlur,
  depth,
}: {
  id: string;
  schema: Schema;
  value: unknown;
  onChange: (v: unknown) => void;
  onBlur: () => void;
  depth: number;
}) {
  const rows = Array.isArray(value) ? value : [];
  const items = itemsOf(schema);
  const itemType = typeOf(items);
  const props = Object.entries(propsOf(items));
  const required = new Set(requiredOf(items));
  const setRow = (i: number, v: unknown) => onChange(rows.map((r, idx) => (idx === i ? v : r)));
  const remove = (i: number) => onChange(rows.filter((_, idx) => idx !== i));
  const add = () => onChange([...rows, blank(items)]);
  const noun = typeof items["title"] === "string" ? String(items["title"]).toLowerCase() : "item";

  // A list of values: one row each.
  if (isScalarType(itemType)) {
    return (
      <div className="space-y-1.5">
        {rows.map((row, i) => (
          <div key={i} className="flex items-center gap-1.5">
            <span className="w-5 shrink-0 text-right text-[10px] text-muted-foreground tabular-nums">
              {i + 1}
            </span>
            <div className="min-w-0 flex-1">
              <ScalarInput
                id={`${id}-${i}`}
                schema={items}
                value={row}
                onChange={(v) => setRow(i, v)}
                onBlur={onBlur}
                compact
              />
            </div>
            <RemoveButton onClick={() => remove(i)} label={`Remove ${noun} ${i + 1}`} />
          </div>
        ))}
        <AddButton onClick={add} label={`Add ${noun}`} />
      </div>
    );
  }

  // Flat records: an editable table.
  const flat =
    itemType === "object" &&
    props.length > 0 &&
    props.length <= 6 &&
    props.every(([, s]) => isScalarType(typeOf(s)));
  if (flat) {
    return (
      <div className="space-y-2">
        <div className="custom-scrollbar overflow-x-auto rounded-lg border border-border">
          <table className="w-full border-collapse text-xs">
            <thead>
              <tr className="bg-surface">
                <th className="w-8 px-2 py-1.5 text-left font-medium text-muted-foreground">#</th>
                {props.map(([k, s]) => (
                  <th
                    key={k}
                    className="min-w-[110px] px-2 py-1.5 text-left font-medium whitespace-nowrap text-muted-foreground"
                    title={typeof s["description"] === "string" ? s["description"] : undefined}
                  >
                    {typeof s["title"] === "string" ? s["title"] : humanise(k)}
                    {required.has(k) ? <span className="ml-0.5 text-red">*</span> : null}
                  </th>
                ))}
                <th className="w-8" />
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td
                    colSpan={props.length + 2}
                    className="px-3 py-3 text-center text-[11px] text-muted-foreground"
                  >
                    No {noun}s yet.
                  </td>
                </tr>
              ) : (
                rows.map((row, i) => {
                  const record = isRecord(row) ? row : {};
                  return (
                    <tr key={i} className="border-t border-border/60">
                      <td className="px-2 py-1 text-[10px] text-muted-foreground tabular-nums">
                        {i + 1}
                      </td>
                      {props.map(([k, s]) => (
                        <td key={k} className="px-1 py-1">
                          <ScalarInput
                            id={`${id}-${i}-${k}`}
                            schema={s}
                            value={record[k]}
                            onChange={(v) => setRow(i, { ...record, [k]: v })}
                            onBlur={onBlur}
                            compact
                          />
                        </td>
                      ))}
                      <td className="px-1 py-1">
                        <RemoveButton onClick={() => remove(i)} label={`Remove row ${i + 1}`} />
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
        <AddButton onClick={add} label={`Add ${noun}`} />
      </div>
    );
  }

  // Richer records: a card each.
  return (
    <div className="space-y-2">
      {rows.map((row, i) => (
        <div key={i} className="rounded-lg border border-border/70 bg-background-elevated/40 p-2.5">
          <div className="mb-2 flex items-center gap-2">
            <span className="text-[10px] font-semibold tracking-wider text-muted-foreground uppercase">
              {humanise(noun)} {i + 1}
            </span>
            <span className="ml-auto">
              <RemoveButton onClick={() => remove(i)} label={`Remove ${noun} ${i + 1}`} />
            </span>
          </div>
          <SchemaNode
            id={`${id}-${i}`}
            schema={items}
            value={row}
            onChange={(v) => setRow(i, v)}
            onBlur={onBlur}
            depth={depth + 1}
          />
        </div>
      ))}
      <AddButton onClick={add} label={`Add ${noun}`} />
    </div>
  );
}

function SchemaNode(props: {
  id: string;
  schema: Schema;
  value: unknown;
  onChange: (v: unknown) => void;
  onBlur: () => void;
  depth: number;
}) {
  const t = typeOf(props.schema);
  if (props.depth > MAX_DEPTH)
    return <JsonLeaf id={props.id} value={props.value} onChange={props.onChange} />;
  if (t === "object") {
    return Object.keys(propsOf(props.schema)).length ? (
      <ObjectFields {...props} />
    ) : (
      <JsonLeaf id={props.id} value={props.value ?? {}} onChange={props.onChange} />
    );
  }
  if (t === "array") return <ArrayFields {...props} />;
  return (
    <ScalarInput
      id={props.id}
      schema={props.schema}
      value={props.value}
      onChange={props.onChange}
      onBlur={props.onBlur}
    />
  );
}

/* ── The input ─────────────────────────────────────────────────────────── */

export function StructuredInput({
  r,
  id,
  text,
  onChange,
  onBlur,
  jsonEditor,
}: {
  r: ResolvedField;
  id: string;
  text: string;
  onChange: (text: string) => void;
  onBlur: () => void;
  /** The plain JSON editor, for the JSON view and for text that does not parse. */
  jsonEditor: ReactNode;
}) {
  const [view, setView] = useState<"fields" | "json">("fields");
  const schema = r.field.schema!;
  let parsed: unknown;
  let parses = true;
  try {
    parsed = text.trim() ? JSON.parse(text) : blank(schema);
  } catch {
    parses = false;
  }
  const showFields = view === "fields" && parses;

  return (
    <div>
      <div className="mb-1.5 flex items-center justify-end">
        <div className="flex rounded-md border border-border bg-background-elevated/60 p-0.5">
          {(
            [
              ["fields", "Fields", Rows3],
              ["json", "JSON", Braces],
            ] as const
          ).map(([v, label, Icon]) => (
            <button
              key={v}
              type="button"
              disabled={v === "fields" && !parses}
              title={v === "fields" && !parses ? "Fix the JSON to edit it as fields" : undefined}
              onClick={() => setView(v)}
              className={cn(
                "inline-flex items-center gap-1 rounded px-2 py-0.5 text-[10px] font-medium transition disabled:opacity-50",
                (v === "fields") === showFields
                  ? "bg-surface text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              <Icon className="size-2.5" /> {label}
            </button>
          ))}
        </div>
      </div>
      {showFields ? (
        <div className="rounded-lg border border-border/70 bg-background-elevated/30 p-3">
          <SchemaNode
            id={id}
            schema={schema}
            value={parsed}
            onChange={(v) => onChange(JSON.stringify(v, null, 2))}
            onBlur={onBlur}
            depth={0}
          />
        </div>
      ) : (
        jsonEditor
      )}
    </div>
  );
}
