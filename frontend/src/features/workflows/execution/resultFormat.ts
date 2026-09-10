/**
 * Turning a workflow's return value into something readable.
 *
 * Results reach the UI in whatever shape the last activity happened to return:
 * a markdown string, a fenced code block wrapping markdown, a JSON envelope
 * around the real payload, or a dict keyed by step id. These helpers collapse
 * all of that to markdown, and are shared by the chat transcript and the result
 * panel so both render the same thing.
 *
 * Structured data is rendered as lists and tables, never as a JSON dump: the
 * reader of a result is the person who ran the workflow, not its author.
 */

export interface ResultFormatOptions {
  /**
   * Step ids from the workflow definition. A Mistral-executed workflow returns
   * every step's output keyed by step id, in the order the steps ran; knowing
   * the ids is what tells that shape apart from an ordinary object.
   */
  stepIds?: string[];
}

export function stripMarkdownFence(value: string): string {
  const trimmed = value.trim();
  if (trimmed.startsWith('```markdown') && trimmed.endsWith('```')) {
    return trimmed.slice(11, -3).trim();
  }
  if (trimmed.startsWith('```') && trimmed.endsWith('```')) {
    return trimmed.slice(3, -3).trim();
  }
  return value;
}

export function unescapeNewlines(value: string): string {
  return value.replace(/\\n/g, '\n').replace(/\\t/g, '\t').replace(/\\"/g, '"');
}

/** Keys a workflow commonly uses for "the answer", in priority order. */
const CONTENT_KEYS = [
  'final_response_generation',
  'final_response',
  'final_output',
  'content',
  'result',
  'output',
  'response',
  'answer',
  'summary',
] as const;

const STRUCTURAL_KEYS = new Set(['step_id', 'status', 'execution_id', 'workflow_name']);

/** Past this depth, nesting is shown inline rather than as ever-deeper lists. */
const MAX_DEPTH = 4;

/** Step outputs other than the outcome are context, so long prose is cut short. */
const STEP_PROSE_LIMIT = 400;

/** A string long or structured enough to be a document rather than a field value. */
const DOCUMENT_MIN_LENGTH = 280;

// ── Value helpers ───────────────────────────────────────────────────────────

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function isScalar(value: unknown): boolean {
  return value == null || ['string', 'number', 'boolean'].includes(typeof value);
}

/** `claim_data_extraction` → `Claim Data Extraction`. */
export function humanize(key: string): string {
  return key
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Strings that are really JSON — common once a value crossed an activity boundary. */
function parseMaybeJson(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  const text = value.trim();
  const fenced = text.match(/^```(?:json)?\s*\n([\s\S]*?)\n?```$/);
  const candidate = fenced ? fenced[1].trim() : text;
  if (
    (candidate.startsWith('{') && candidate.endsWith('}')) ||
    (candidate.startsWith('[') && candidate.endsWith(']'))
  ) {
    try {
      return JSON.parse(candidate);
    } catch {
      /* prose that happens to start with a brace */
    }
  }
  return value;
}

/** Some generated tools echo their own schema: `{type, description, value}`. The value is the data. */
function unwrapSchemaEcho(value: unknown): unknown {
  if (
    isRecord(value) &&
    'value' in value &&
    Object.keys(value).every((k) => k === 'value' || k === 'type' || k === 'description')
  ) {
    return value.value;
  }
  return value;
}

function normalise(value: unknown): unknown {
  return unwrapSchemaEcho(parseMaybeJson(value));
}

function scalar(value: unknown): string {
  if (value == null || value === '') return '—';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  const text = String(value);
  // Enum-like values (`requires_review`) read better as words.
  return /^[a-z]+(?:_[a-z]+)+$/.test(text) ? humanize(text) : text;
}

function looksLikeMarkdown(text: string): boolean {
  return (
    /(^|\n)\s*(#{1,6}\s|[-*+]\s|\d+\.\s|\||```|>)/.test(text) || /\*\*[^*\n]+\*\*/.test(text)
  );
}

function isDocument(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const text = value.trim();
  return text.length >= DOCUMENT_MIN_LENGTH || (text.includes('\n') && looksLikeMarkdown(text));
}

/**
 * Free text as markdown. Plain text keeps its line breaks — markdown would
 * otherwise fold `Label: value` lines into one paragraph.
 */
function prose(value: string, limit?: number): string {
  let text = stripMarkdownFence(unescapeNewlines(value)).trim();
  if (limit && text.length > limit) text = `${text.slice(0, limit).trimEnd()}…`;
  return looksLikeMarkdown(text) ? text : text.split(/\r?\n/).join('  \n');
}

/** A value on one list line; embedded line breaks become hard breaks inside the item. */
function inline(value: unknown, pad: string): string {
  const text = scalar(value);
  return text.includes('\n') ? text.trim().split(/\r?\n/).join(`  \n${pad}  `) : text;
}

function table(rows: Record<string, unknown>[]): string | null {
  const columns = [...new Set(rows.flatMap((row) => Object.keys(row)))];
  if (!columns.length || columns.length > 6) return null;
  if (!rows.every((row) => Object.values(row).every(isScalar))) return null;
  const cell = (value: unknown) => scalar(value).replace(/\|/g, '\\|').replace(/\s*\n\s*/g, ' ');
  return [
    `| ${columns.map(humanize).join(' | ')} |`,
    `| ${columns.map(() => '---').join(' | ')} |`,
    ...rows.map((row) => `| ${columns.map((c) => cell(row[c])).join(' | ')} |`),
  ].join('\n');
}

// ── Structured rendering ────────────────────────────────────────────────────

function renderList(record: Record<string, unknown>, depth: number): string[] {
  const pad = '  '.repeat(depth);
  const lines: string[] = [];

  for (const [key, raw] of Object.entries(record)) {
    const value = normalise(raw);
    const label = `${pad}- **${humanize(key)}:**`;

    if (isScalar(value)) {
      lines.push(`${label} ${inline(value, pad)}`);
      continue;
    }

    if (Array.isArray(value)) {
      if (!value.length) {
        lines.push(`${label} None`);
      } else if (value.every(isScalar)) {
        lines.push(`${label} ${value.map(scalar).join(', ')}`);
      } else if (depth >= MAX_DEPTH) {
        lines.push(`${label} \`${JSON.stringify(value)}\``);
      } else {
        const rows = value.map(normalise);
        const grid = depth === 0 && rows.every(isRecord) ? table(rows as Record<string, unknown>[]) : null;
        if (grid) {
          // A table cannot live inside a list item: close the list around it.
          lines.push(label, '', grid, '');
        } else {
          lines.push(label);
          rows.forEach((item, index) => {
            if (isRecord(item)) {
              lines.push(`${pad}  - _Item ${index + 1}_`);
              lines.push(...renderList(item, depth + 2));
            } else {
              lines.push(`${pad}  - ${inline(item, `${pad}  `)}`);
            }
          });
        }
      }
      continue;
    }

    const nested = value as Record<string, unknown>;
    if (!Object.keys(nested).length) {
      lines.push(`${label} —`);
    } else if (depth >= MAX_DEPTH) {
      lines.push(`${label} \`${JSON.stringify(nested)}\``);
    } else {
      lines.push(label, ...renderList(nested, depth + 1));
    }
  }
  return lines;
}

/** An object as markdown: a lead document, if it carries one, then its fields. */
function renderRecord(record: Record<string, unknown>, proseLimit?: number): string {
  const fields = Object.fromEntries(
    Object.entries(record).filter(([key]) => !STRUCTURAL_KEYS.has(key)),
  );
  const documents = Object.entries(fields).filter(([, value]) => isDocument(value));

  if (documents.length === 1) {
    const [docKey, doc] = documents[0];
    const rest = Object.fromEntries(Object.entries(fields).filter(([key]) => key !== docKey));
    const body = prose(doc as string, proseLimit);
    return Object.keys(rest).length ? `${body}\n\n${renderList(rest, 0).join('\n')}` : body;
  }
  if (!Object.keys(fields).length) return '_No output._';
  return renderList(fields, 0).join('\n');
}

function toMarkdown(raw: unknown, proseLimit?: number): string {
  const value = normalise(raw);
  if (typeof value === 'string') return prose(value, proseLimit);
  if (isScalar(value)) return scalar(value);
  if (Array.isArray(value)) {
    if (!value.length) return '_None._';
    if (value.every(isScalar)) return value.map((item) => `- ${scalar(item)}`).join('\n');
    const rows = value.map(normalise);
    const grid = rows.every(isRecord) ? table(rows as Record<string, unknown>[]) : null;
    return grid ?? renderList(Object.fromEntries(rows.map((row, i) => [`item_${i + 1}`, row])), 0).join('\n');
  }
  return renderRecord(value as Record<string, unknown>, proseLimit);
}

// ── Per-step results ────────────────────────────────────────────────────────

function isStepMap(record: Record<string, unknown>, stepIds?: string[]): boolean {
  if (!stepIds?.length) return false;
  const keys = Object.keys(record).filter((key) => !STRUCTURAL_KEYS.has(key));
  if (keys.length < 2) return false;
  const known = new Set(stepIds);
  // Most, not all: a run of an older version may carry a step since renamed.
  return keys.filter((key) => known.has(key)).length >= Math.ceil(keys.length / 2);
}

function stepBody(raw: unknown, proseLimit?: number): string {
  const value = normalise(raw);
  if (isRecord(value)) {
    if ('condition_result' in value && 'next_step' in value) {
      const next = value.next_step ? humanize(String(value.next_step)) : 'the end of the workflow';
      return `Condition **${value.condition_result ? 'met' : 'not met'}** → continued to **${next}**`;
    }
    // A step whose only field wraps text: show the text, not a one-item list.
    const keys = Object.keys(value);
    if (keys.length === 1) {
      const inner = normalise(value[keys[0]]);
      if (typeof inner === 'string') return prose(inner, proseLimit);
    }
  }
  return toMarkdown(value, proseLimit);
}

/**
 * Every step's output as a report: the step that ran last is the outcome, and
 * the rest are listed in the order they ran — which is the order the result
 * object carries them in.
 */
function formatStepMap(record: Record<string, unknown>): string {
  const entries = Object.entries(record).filter(([key]) => !STRUCTURAL_KEYS.has(key));
  const [finalId, finalOutput] = entries[entries.length - 1];
  const sections = [`### Outcome — ${humanize(finalId)}`, '', stepBody(finalOutput)];

  const earlier = entries.slice(0, -1);
  if (earlier.length) {
    sections.push('', '---', '', '### Step results', '');
    earlier.forEach(([id, output], index) => {
      sections.push(`#### ${index + 1}. ${humanize(id)}`, '', stepBody(output, STEP_PROSE_LIMIT), '');
    });
  }
  return sections.join('\n').trim();
}

// ── Entry point ─────────────────────────────────────────────────────────────

/** Best-effort extraction of the presentable body from a workflow result, as markdown. */
export function formatWorkflowResult(raw: unknown, options: ResultFormatOptions = {}): string {
  if (raw == null) return '';

  if (typeof raw === 'string') {
    const text = raw.trim();
    // A result that is really JSON in string clothing is common when the value
    // crossed an activity boundary.
    if (text.startsWith('{') || text.startsWith('[')) {
      try {
        return formatWorkflowResult(JSON.parse(text), options);
      } catch {
        /* not JSON after all — treat as prose */
      }
    }
    return stripMarkdownFence(unescapeNewlines(raw));
  }

  if (typeof raw !== 'object' || Array.isArray(raw)) return toMarkdown(raw);

  const record = raw as Record<string, unknown>;

  // Checked before the content keys: a step can be named `summary` or `result`.
  if (isStepMap(record, options.stepIds)) return formatStepMap(record);

  for (const key of CONTENT_KEYS) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) {
      return stripMarkdownFence(unescapeNewlines(value));
    }
    if (value && typeof value === 'object') {
      const nested = formatWorkflowResult(value, options);
      if (nested) return nested;
    }
  }

  // Approval-gate shape — a small, very common workflow output.
  if ('approved' in record && record.reason) {
    const verdict = record.approved ? '✅ **Approved**' : '❌ **Rejected**';
    let out = `${verdict}\n\n**Reason:** ${record.reason}`;
    if (record.final_output) out += `\n\n**Output:** ${record.final_output}`;
    return unescapeNewlines(out);
  }

  return renderRecord(record);
}

/** True when a result carries nothing worth rendering. */
export function isEmptyResult(raw: unknown): boolean {
  if (raw == null || raw === '') return true;
  if (typeof raw === 'object') return Object.keys(raw as object).length === 0;
  return false;
}
