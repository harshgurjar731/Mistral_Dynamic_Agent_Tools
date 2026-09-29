/**
 * List sorting shared by every page: a named set of orders per page, the
 * user's choice remembered per page, and comparators for the common fields.
 */
import { useCallback, useEffect, useState } from "react";
import { parseServerTime } from "@/lib/status";

export interface SortOption<T> {
  key: string;
  label: string;
  compare: (a: T, b: T) => number;
}

const time = (v: unknown): number => {
  if (typeof v !== "string" && typeof v !== "number") return Number.NaN;
  if (v === "") return Number.NaN;
  return parseServerTime(v);
};

/** Newest first; items without a date always sink to the bottom. */
export function byDate<T>(get: (item: T) => unknown, direction: "desc" | "asc" = "desc") {
  return (a: T, b: T) => {
    const ta = time(get(a));
    const tb = time(get(b));
    const na = Number.isNaN(ta);
    const nb = Number.isNaN(tb);
    if (na || nb) return na === nb ? 0 : na ? 1 : -1;
    return direction === "desc" ? tb - ta : ta - tb;
  };
}

export function byText<T>(get: (item: T) => unknown, direction: "asc" | "desc" = "asc") {
  return (a: T, b: T) => {
    const cmp = String(get(a) ?? "").localeCompare(String(get(b) ?? ""), undefined, {
      sensitivity: "base",
      numeric: true,
    });
    return direction === "asc" ? cmp : -cmp;
  };
}

export function byNumber<T>(
  get: (item: T) => number | null | undefined,
  direction: "desc" | "asc" = "desc",
) {
  return (a: T, b: T) => {
    const d = (get(a) ?? 0) - (get(b) ?? 0);
    return direction === "desc" ? -d : d;
  };
}

/** The standard four, for anything with a name and a creation date. */
export function standardSorts<T>(
  name: (item: T) => unknown,
  created: (item: T) => unknown,
): SortOption<T>[] {
  return [
    { key: "newest", label: "Newest first", compare: byDate(created, "desc") },
    { key: "oldest", label: "Oldest first", compare: byDate(created, "asc") },
    { key: "name_asc", label: "Name A–Z", compare: byText(name, "asc") },
    { key: "name_desc", label: "Name Z–A", compare: byText(name, "desc") },
  ];
}

export function applySort<T>(items: readonly T[], options: SortOption<T>[], key: string): T[] {
  const option = options.find((o) => o.key === key) ?? options[0];
  if (!option) return [...items];
  // Stable: equal items keep the order the server gave them.
  return items
    .map((item, i) => ({ item, i }))
    .sort((a, b) => option.compare(a.item, b.item) || a.i - b.i)
    .map((x) => x.item);
}

/** The sort chosen on one page, remembered in this browser. */
export function useSortKey(page: string, fallback = "newest"): [string, (key: string) => void] {
  const storageKey = `sort:${page}`;
  const [key, setKey] = useState(fallback);

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(storageKey);
      if (saved) setKey(saved);
    } catch {
      /* storage unavailable — the default is fine */
    }
  }, [storageKey]);

  const set = useCallback(
    (next: string) => {
      setKey(next);
      try {
        window.localStorage.setItem(storageKey, next);
      } catch {
        /* ignore */
      }
    },
    [storageKey],
  );
  return [key, set];
}
