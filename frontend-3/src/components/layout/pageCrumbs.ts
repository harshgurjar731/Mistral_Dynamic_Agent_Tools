/**
 * What the header's breadcrumb says after the page's menu item.
 *
 * A page that knows what it shows — an agent's name, a tool's name, a trace —
 * says so with `usePageCrumbs`. Until it does (or on a page that does not),
 * `routeCrumbs` names the route itself: "New workflow › Plan with AI", a
 * workflow's name as written, "Run", "Edit", and a short id for something
 * still loading — never a raw path segment like "ai" or a full id.
 */
import { useEffect } from "react";
import { useRouterState } from "@tanstack/react-router";
import { create } from "zustand";

export interface Crumb {
  label: string;
  /** Where the crumb goes, when it is not the last one. */
  to?: string | undefined;
}

type CrumbInput = string | Crumb | null | undefined | false;

interface CrumbState {
  path: string | null;
  crumbs: Crumb[] | null;
  set: (path: string, crumbs: Crumb[]) => void;
  clear: (path: string) => void;
}

export const usePageCrumbStore = create<CrumbState>()((set) => ({
  path: null,
  crumbs: null,
  set: (path, crumbs) => set({ path, crumbs }),
  clear: (path) => set((s) => (s.path === path ? { path: null, crumbs: null } : s)),
}));

const normalise = (items: CrumbInput[]): Crumb[] =>
  items
    .filter((c): c is string | Crumb => Boolean(c))
    .map((c) => (typeof c === "string" ? { label: c } : c))
    .filter((c) => c.label.trim().length > 0);

/**
 * Name what this page shows, after its menu item: `usePageCrumbs([agent?.name])`.
 * Empty entries are skipped, so it can be called before the data has loaded.
 */
export function usePageCrumbs(items: CrumbInput[]): void {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const crumbs = normalise(items);
  const key = JSON.stringify(crumbs);
  useEffect(() => {
    const list = JSON.parse(key) as Crumb[];
    if (!list.length) return;
    usePageCrumbStore.getState().set(pathname, list);
    return () => usePageCrumbStore.getState().clear(pathname);
  }, [pathname, key]);
}

/** The crumbs a page set for the current address, if any. */
export function usePageSetCrumbs(pathname: string): Crumb[] | null {
  return usePageCrumbStore((s) => (s.path === pathname ? s.crumbs : null));
}

/* ── From the route ──────────────────────────────────────────────────── */

const WORDS: Record<string, string> = {
  new: "New",
  edit: "Edit",
  execute: "Run",
  refine: "Refine with AI",
  archived: "Archived",
  execution: "Execution",
  ai: "Plan with AI",
  visual: "Visual builder",
};

/** Ids are shortened while the page loads the name they stand for. */
function looksLikeId(part: string): boolean {
  return (
    /^\d+$/.test(part) ||
    /^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(part) ||
    /^[0-9a-f]{16,}$/i.test(part) ||
    /^(ag|agent|tool|conv|run|wf)_[0-9a-z]{8,}$/i.test(part)
  );
}

function decode(part: string): string {
  try {
    return decodeURIComponent(part);
  } catch {
    return part;
  }
}

function word(part: string): string {
  if (WORDS[part]) return WORDS[part]!;
  if (looksLikeId(part)) return /^\d+$/.test(part) ? `#${part}` : `${part.slice(0, 8)}…`;
  const text = part.replace(/[_-]+/g, " ").trim();
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : part;
}

/** The crumbs after the menu item at `base`, named from the address alone. */
export function routeCrumbs(pathname: string, base: string): Crumb[] {
  if (base === "/" || !pathname.startsWith(`${base}/`)) return [];
  const parts = pathname
    .slice(base.length + 1)
    .split("/")
    .filter(Boolean)
    .map(decode);
  if (!parts.length) return [];

  if (base === "/workflows") {
    const [first, second] = parts;
    if (first === "new") {
      return [
        { label: "New workflow", to: second ? "/workflows/new" : undefined },
        ...(second ? [{ label: word(second) }] : []),
      ];
    }
    if (first === "archived") return [{ label: "Archived" }];
    // A workflow's name is shown as written — it is an identifier, not prose.
    return [
      { label: first!, to: `/workflows/${encodeURIComponent(first!)}` },
      ...parts.slice(1).map((p) => ({ label: word(p) })),
    ];
  }
  if (base === "/mcp")
    return [{ label: parts[0]! }, ...parts.slice(1).map((p) => ({ label: word(p) }))];
  if (base === "/remote-servers" && parts[0] === "new") return [{ label: "New server" }];
  if (base === "/logs" && parts[0] === "execution") {
    return [{ label: "Execution" }, ...parts.slice(1).map((p) => ({ label: word(p) }))];
  }
  return parts.map((p) => ({ label: word(p) }));
}
