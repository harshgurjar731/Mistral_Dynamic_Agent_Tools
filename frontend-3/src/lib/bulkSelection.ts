/**
 * Selection state and bulk delete for list pages. The matching UI —
 * BulkActionBar and SelectableItem — is in components/shared/BulkSelection.
 *
 *   const selection = useBulkSelection(visibleItems, (x) => x.id, (x) => !x.builtin);
 *   const bulkDelete = useBulkDelete({ noun: "agent", deleteOne: agentsApi.remove,
 *                                      invalidate: [QK.agents()], selection });
 *
 *   <BulkActionBar selection={selection} noun="agent" onDelete={bulkDelete.run}
 *                  deleting={bulkDelete.running} />
 *   {visibleItems.map((x) => (
 *     <SelectableItem key={x.id} selection={selection} id={x.id} label={x.name}>
 *       <AgentCard agent={x} />
 *     </SelectableItem>
 *   ))}
 *
 * Selection follows what the page shows: filtering or paging drops items that
 * are no longer visible, so "Delete 3" never deletes something off-screen.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useQueryClient, type QueryKey } from "@tanstack/react-query";
import { toast } from "sonner";
import { errorMessage } from "@/api/client";

export interface BulkSelection {
  /** Ids that are selected and still visible. */
  selected: string[];
  /** Ids on the page that may be selected. */
  selectable: string[];
  isSelected: (id: string) => boolean;
  canSelect: (id: string) => boolean;
  toggle: (id: string) => void;
  toggleAll: () => void;
  clear: () => void;
  count: number;
  allSelected: boolean;
  someSelected: boolean;
  /** Display name of a selected id, for the confirmation dialog. */
  labelOf: (id: string) => string;
}

export function useBulkSelection<T>(
  items: T[],
  getId: (item: T) => string | number,
  isSelectable: (item: T) => boolean = () => true,
  getLabel?: (item: T) => string,
): BulkSelection {
  const [picked, setPicked] = useState<Set<string>>(() => new Set());

  const selectable = useMemo(
    () => items.filter(isSelectable).map((i) => String(getId(i))),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [items],
  );
  const labels = useMemo(() => {
    const map = new Map<string, string>();
    for (const item of items) map.set(String(getId(item)), getLabel?.(item) ?? String(getId(item)));
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items]);
  const selectableSet = useMemo(() => new Set(selectable), [selectable]);

  // Drop ids that left the page (filtered out, paged away, deleted).
  useEffect(() => {
    setPicked((prev) => {
      const next = new Set([...prev].filter((id) => selectableSet.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [selectableSet]);

  const selected = useMemo(() => selectable.filter((id) => picked.has(id)), [selectable, picked]);

  const toggle = useCallback(
    (id: string) =>
      setPicked((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else if (selectableSet.has(id)) next.add(id);
        return next;
      }),
    [selectableSet],
  );

  const allSelected = selectable.length > 0 && selected.length === selectable.length;

  return {
    selected,
    selectable,
    isSelected: (id) => picked.has(id),
    canSelect: (id) => selectableSet.has(id),
    toggle,
    toggleAll: () => setPicked(allSelected ? new Set() : new Set(selectable)),
    clear: () => setPicked(new Set()),
    count: selected.length,
    allSelected,
    someSelected: selected.length > 0 && !allSelected,
    labelOf: (id) => labels.get(id) ?? id,
  };
}

// ── Deleting ───────────────────────────────────────────────────────────────

export interface BulkResult {
  succeeded: string[];
  failed: { id: string; error: string }[];
}

/** Run ``deleteOne`` over ``ids`` a few at a time; never throws. */
export async function runBulk(
  ids: string[],
  deleteOne: (id: string) => Promise<unknown>,
  concurrency = 4,
): Promise<BulkResult> {
  const result: BulkResult = { succeeded: [], failed: [] };
  const queue = [...ids];
  const worker = async () => {
    for (let id = queue.shift(); id !== undefined; id = queue.shift()) {
      try {
        const reply = await deleteOne(id);
        // Some endpoints answer 200 with {"error": ...} or {"status": "error"}.
        const r = reply as { error?: unknown; status?: unknown; message?: unknown } | null;
        if (r && typeof r === "object" && (r.error || r.status === "error")) {
          result.failed.push({ id, error: String(r.error ?? r.message ?? "refused") });
        } else {
          result.succeeded.push(id);
        }
      } catch (e) {
        result.failed.push({ id, error: errorMessage(e) });
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, ids.length) }, worker));
  return result;
}

export function useBulkDelete({
  noun,
  deleteOne,
  invalidate,
  selection,
  onDone,
}: {
  noun: string;
  deleteOne: (id: string) => Promise<unknown>;
  invalidate: QueryKey[];
  selection: BulkSelection;
  onDone?: (result: BulkResult) => void;
}) {
  const qc = useQueryClient();
  const [running, setRunning] = useState(false);

  const run = async () => {
    const ids = selection.selected;
    if (!ids.length) return;
    setRunning(true);
    try {
      const result = await runBulk(ids, deleteOne);
      const n = result.succeeded.length;
      if (n) toast.success(`Deleted ${n} ${plural(noun, n)}.`);
      const first = result.failed[0];
      if (first) {
        toast.error(
          `${result.failed.length} ${plural(noun, result.failed.length)} could not be deleted` +
            ` — ${selection.labelOf(first.id)}: ${first.error}`,
        );
      }
      await Promise.all(invalidate.map((key) => qc.invalidateQueries({ queryKey: key })));
      selection.clear();
      onDone?.(result);
    } finally {
      setRunning(false);
    }
  };

  return { run, running };
}

export function plural(noun: string, n: number): string {
  if (n === 1) return noun;
  if (noun.endsWith("y") && !/[aeiou]y$/.test(noun)) return `${noun.slice(0, -1)}ies`;
  return noun.endsWith("s") ? noun : `${noun}s`;
}
