/**
 * A tool or activity's input schema as form fields, and back to arguments.
 *
 * Every value is held as text while editing, so a half-typed number or JSON
 * object is never lost; it is converted to the parameter's declared type only
 * when the call is made.
 */
import type { Tool } from "@/types";

export type ParamType = "string" | "number" | "integer" | "boolean" | "object" | "array";

export interface ParamField {
  name: string;
  type: ParamType;
  required: boolean;
  description: string;
  enumValues: string[] | null;
}

type JsonSchema = {
  type?: string | string[];
  properties?: Record<string, JsonSchema>;
  required?: string[];
  description?: string;
  enum?: unknown[];
};

/** The input schema a version was built with (its spec), or its function schema. */
export function inputSchemaOf(tool: Tool): JsonSchema {
  const fromSpec = tool.spec?.input_schema as JsonSchema | undefined;
  if (fromSpec?.properties) return fromSpec;
  let schema = tool.schema ?? tool.schema_json;
  if (typeof schema === "string") {
    try {
      schema = JSON.parse(schema) as Record<string, unknown>;
    } catch {
      return {};
    }
  }
  const fn = (schema as { function?: { parameters?: JsonSchema } } | null)?.function;
  return fn?.parameters ?? (schema as JsonSchema | null) ?? {};
}

const KNOWN: ParamType[] = ["string", "number", "integer", "boolean", "object", "array"];

export function paramFields(tool: Tool): ParamField[] {
  const schema = inputSchemaOf(tool);
  const required = new Set(schema.required ?? []);
  return Object.entries(schema.properties ?? {}).map(([name, prop]) => {
    const raw = Array.isArray(prop?.type) ? prop.type.find((t) => t !== "null") : prop?.type;
    const type = KNOWN.includes(raw as ParamType) ? (raw as ParamType) : "string";
    return {
      name,
      type,
      required: required.has(name),
      description: prop?.description ?? "",
      enumValues: Array.isArray(prop?.enum) ? prop.enum.map(String) : null,
    };
  });
}

/** Text for one value, as the form shows it. */
export function toText(field: ParamField, value: unknown): string {
  if (value === undefined || value === null) return "";
  if (field.type === "object" || field.type === "array") return JSON.stringify(value, null, 2);
  return String(value);
}

export function valuesFrom(fields: ParamField[], input: Record<string, unknown>) {
  return Object.fromEntries(fields.map((f) => [f.name, toText(f, input[f.name])]));
}

/** Arguments typed per the schema, plus a problem per field that cannot be. */
export function toArguments(
  fields: ParamField[],
  values: Record<string, string>,
): { args: Record<string, unknown>; errors: Record<string, string> } {
  const args: Record<string, unknown> = {};
  const errors: Record<string, string> = {};
  for (const f of fields) {
    const text = (values[f.name] ?? "").trim();
    if (!text) {
      if (f.required) errors[f.name] = "Required";
      continue;
    }
    switch (f.type) {
      case "number":
      case "integer": {
        const n = Number(text);
        if (Number.isNaN(n)) errors[f.name] = "Must be a number";
        else if (f.type === "integer" && !Number.isInteger(n))
          errors[f.name] = "Must be a whole number";
        else args[f.name] = n;
        break;
      }
      case "boolean":
        if (text !== "true" && text !== "false") errors[f.name] = "Choose true or false";
        else args[f.name] = text === "true";
        break;
      case "object":
      case "array":
        try {
          const parsed: unknown = JSON.parse(text);
          const isArray = Array.isArray(parsed);
          if (f.type === "array" ? !isArray : isArray || typeof parsed !== "object" || !parsed) {
            errors[f.name] = f.type === "array" ? "Must be a JSON list" : "Must be a JSON object";
          } else args[f.name] = parsed;
        } catch {
          errors[f.name] = "Not valid JSON";
        }
        break;
      default:
        args[f.name] = values[f.name];
    }
  }
  return { args, errors };
}
