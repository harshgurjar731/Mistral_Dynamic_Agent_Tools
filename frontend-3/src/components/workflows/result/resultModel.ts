/**
 * Turning a workflow run's raw result into something a person can read.
 *
 * A run returns every step's output, keyed by step id, in the order the steps
 * ran — gates, conditions and intermediate calculations included. The answer
 * is usually one of them: the last agent's prose, or the last step's data.
 * Agents also wrap their answers in ```markdown / ```json fences, which a
 * markdown renderer would show as a code block rather than as the document.
 */
import type { WorkflowDefinition } from "@/types";

export interface StepOutput {
  id: string;
  /** agent | tool | condition | connector | transform, when the definition is known. */
  type: string | null;
  value: unknown;
}

export interface ResolvedResult {
  /** The step whose output is the answer, or null when the result is not per-step. */
  stepId: string | null;
  value: unknown;
  /** Every step's output, in run order; empty when the result is not per-step. */
  steps: StepOutput[];
}

/* ── Unwrapping ───────────────────────────────────────────────────────── */

const FENCE = /^\s*```([a-zA-Z]*)\s*\n([\s\S]*?)\n?```\s*$/;

/** Parse JSON strings and strip a fence around the whole value. */
export function normaliseValue(value: unknown): unknown {
  if (typeof value !== "string") return value;
  const fenced = FENCE.exec(value);
  const lang = fenced?.[1]?.toLowerCase() ?? "";
  const body = fenced ? (fenced[2] ?? "") : value;
  const trimmed = body.trim();
  if ((lang === "json" || !fenced) && /^[[{]/.test(trimmed)) {
    try {
      return JSON.parse(trimmed) as unknown;
    } catch {
      /* not JSON after all */
    }
  }
  // ```markdown / ```md / ``` around prose: the prose is the document.
  if (fenced && ["markdown", "md", "", "text", "txt"].includes(lang)) return body;
  return value;
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === "object" && !Array.isArray(v);

/** Envelopes that carry the data without adding anything: {result: X}, {status: success, data: X}, {safe_response: X}. */
export function peel(value: unknown, depth = 6): unknown {
  let v = normaliseValue(value);
  for (let i = 0; i < depth; i++) {
    if (!isRecord(v)) break;
    const keys = Object.keys(v);
    if (v["status"] === "success" && "data" in v) {
      v = normaliseValue(v["data"]);
      continue;
    }
    if (keys.length === 1) {
      const inner = normaliseValue(v[keys[0]!]);
      // Only peel into structure or long prose; {"grand_total": 5} stays labelled.
      if (
        isRecord(inner) ||
        Array.isArray(inner) ||
        (typeof inner === "string" && inner.length > 80)
      ) {
        v = inner;
        continue;
      }
    }
    break;
  }
  return v;
}

/* ── Picking the answer ───────────────────────────────────────────────── */

const isProse = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0;

/** A gate's or condition's verdict, not an answer. */
function isVerdict(v: unknown): boolean {
  if (!isRecord(v)) return false;
  const keys = Object.keys(v);
  if ("condition_result" in v || "next_step" in v) return true;
  const verdictKeys = [
    "is_safe",
    "safe",
    "compliance_status",
    "risk_level",
    "approved",
    "passed",
    "valid",
  ];
  return keys.some((k) => verdictKeys.includes(k)) && keys.length <= 6;
}

function isErrorEnvelope(v: unknown): boolean {
  return isRecord(v) && (v["status"] === "error" || v["status"] === "failed") && "message" in v;
}

export function resolveResult(
  result: unknown,
  definition?: WorkflowDefinition | null,
): ResolvedResult {
  let raw = normaliseValue(result);
  // {result: {...}} / {output: {...}} around the per-step map.
  for (let i = 0; i < 3 && isRecord(raw); i++) {
    const keys = Object.keys(raw);
    if (keys.length === 1 && (keys[0] === "result" || keys[0] === "output"))
      raw = normaliseValue(raw[keys[0]]);
    else break;
  }

  const typeOf = new Map((definition?.steps ?? []).map((s) => [s.id, String(s.type)]));
  const perStep =
    isRecord(raw) &&
    Object.keys(raw).length > 0 &&
    (typeOf.size > 0
      ? Object.keys(raw).every((k) => typeOf.has(k))
      : Object.keys(raw).length > 1 && Object.keys(raw).every((k) => /^[a-z][a-z0-9_]*$/.test(k)));

  if (!perStep || !isRecord(raw)) return { stepId: null, value: peel(raw), steps: [] };

  const steps: StepOutput[] = Object.entries(raw).map(([id, value]) => ({
    id,
    type: typeOf.get(id) ?? null,
    value: peel(value),
  }));
  const candidates = steps.filter(
    (s) =>
      s.type !== "condition" && !isVerdict(s.value) && !isErrorEnvelope(s.value) && s.value != null,
  );

  // Prose from the end first — the last thing an agent wrote for a person.
  const prose = [...candidates].reverse().find((s) => isProse(s.value) && s.type !== "tool");
  const pick = prose ?? candidates[candidates.length - 1] ?? steps[steps.length - 1]!;
  return { stepId: pick.id, value: pick.value, steps };
}

/* ── Export ───────────────────────────────────────────────────────────── */

export function asText(value: unknown): { text: string; ext: "md" | "json"; mime: string } {
  if (typeof value === "string") return { text: value, ext: "md", mime: "text/markdown" };
  return { text: JSON.stringify(value, null, 2), ext: "json", mime: "application/json" };
}

export function humaniseKey(key: string): string {
  const words = key.replace(/[_-]+/g, " ").trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : key;
}
