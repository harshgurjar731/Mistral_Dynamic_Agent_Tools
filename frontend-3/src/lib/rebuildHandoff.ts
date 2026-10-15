/**
 * Hand a failure from where it was seen (a workflow run's step) to the
 * tool/activity page, which opens "Rebuild from an error" prefilled with it.
 *
 * Session storage rather than the URL: errors and inputs are long, and they
 * should not end up in browser history or shared links.
 */
import type { RebuildPrefill } from "@/components/tools/ToolTestDialog";

const KEY = (toolName: string) => `rebuild-handoff:${toolName}`;

export function handOffRebuild(toolName: string, prefill: RebuildPrefill): void {
  try {
    sessionStorage.setItem(KEY(toolName), JSON.stringify(prefill));
  } catch {
    // Storage unavailable (private mode): the page opens without a prefill.
  }
}

/** The pending handoff for this tool, removed as it is read. */
export function takeRebuildHandoff(toolName: string): RebuildPrefill | null {
  try {
    const raw = sessionStorage.getItem(KEY(toolName));
    if (!raw) return null;
    sessionStorage.removeItem(KEY(toolName));
    const parsed = JSON.parse(raw) as RebuildPrefill;
    return typeof parsed?.error === "string" ? parsed : null;
  } catch {
    return null;
  }
}
