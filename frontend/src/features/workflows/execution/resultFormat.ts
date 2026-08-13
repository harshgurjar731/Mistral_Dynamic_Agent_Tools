/**
 * Turning a workflow's return value into something readable.
 *
 * Results reach the UI in whatever shape the last activity happened to return:
 * a markdown string, a fenced code block wrapping markdown, a JSON envelope
 * around the real payload, or a dict keyed by step id. These helpers collapse
 * all of that to the one string worth showing, and are shared by the chat
 * transcript and the result panel so both render the same thing.
 */

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

function longestString(record: Record<string, unknown>): string {
  let longest = '';
  for (const [key, value] of Object.entries(record)) {
    if (STRUCTURAL_KEYS.has(key)) continue;
    if (typeof value === 'string' && value.length > longest.length) longest = value;
  }
  return longest;
}

/**
 * Best-effort extraction of the presentable body from a workflow result.
 *
 * Returns markdown. Falls back to a fenced JSON dump when there is no obvious
 * prose payload — showing the raw structure beats showing nothing.
 */
export function formatWorkflowResult(raw: unknown): string {
  if (raw == null) return '';

  if (typeof raw === 'string') {
    const text = raw.trim();
    // A result that is really JSON in string clothing is common when the value
    // crossed an activity boundary.
    if (text.startsWith('{') || text.startsWith('[')) {
      try {
        return formatWorkflowResult(JSON.parse(text));
      } catch {
        /* not JSON after all — treat as prose */
      }
    }
    return stripMarkdownFence(unescapeNewlines(raw));
  }

  if (Array.isArray(raw)) {
    return '```json\n' + JSON.stringify(raw, null, 2) + '\n```';
  }

  if (typeof raw !== 'object') return String(raw);

  const record = raw as Record<string, unknown>;

  for (const key of CONTENT_KEYS) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) {
      return stripMarkdownFence(unescapeNewlines(value));
    }
    if (value && typeof value === 'object') {
      const nested = formatWorkflowResult(value);
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

  const longest = longestString(record);
  if (longest && longest.length > 80) {
    return stripMarkdownFence(unescapeNewlines(longest));
  }

  const sections: string[] = [];
  for (const [key, value] of Object.entries(record)) {
    if (STRUCTURAL_KEYS.has(key)) continue;
    const heading = key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
    sections.push(
      typeof value === 'string'
        ? `**${heading}**\n\n${stripMarkdownFence(unescapeNewlines(value))}`
        : `**${heading}**\n\n\`\`\`json\n${JSON.stringify(value, null, 2)}\n\`\`\``,
    );
  }

  if (sections.length) return sections.join('\n\n');
  return '```json\n' + JSON.stringify(raw, null, 2) + '\n```';
}

/** True when a result carries nothing worth rendering. */
export function isEmptyResult(raw: unknown): boolean {
  if (raw == null || raw === '') return true;
  if (typeof raw === 'object') return Object.keys(raw as object).length === 0;
  return false;
}
