import { useEffect } from "react";
import { create } from "zustand";
import { useQueryClient, type Query } from "@tanstack/react-query";
import { useRouterState } from "@tanstack/react-router";

export interface PageLoad {
  /** Fetches in this burst of loading. */
  started: number;
  /** …of which have answered (or failed, or were cancelled). */
  settled: number;
  /** When this burst began (ms epoch), or null when nothing is loading. */
  since: number | null;
  /** The router itself is resolving a navigation. */
  navigating: boolean;
}

/** One page-load count for the whole app — the top bar and every loader read it. */
export const usePageLoadStore = create<PageLoad>(() => ({
  started: 0,
  settled: 0,
  since: null,
  navigating: false,
}));

export function usePageLoad(): PageLoad {
  return usePageLoadStore();
}

/** Page data is loading right now. */
export const isLoading = (l: PageLoad) => l.navigating || l.started > l.settled;

/** 0–100, or null when nothing is loading. */
export function loadPercent(l: PageLoad): number | null {
  if (!isLoading(l)) return null;
  if (!l.started) return 0;
  return Math.min(99, Math.round((l.settled / l.started) * 100));
}

/** Polling queries refetch on a timer — that is not the page loading. */
function polls(query: Query): boolean {
  const observers = (
    query as unknown as { observers?: Array<{ options?: Record<string, unknown> }> }
  ).observers;
  return !!observers?.some((o) => {
    const interval = o.options?.["refetchInterval"];
    return typeof interval === "function" || (typeof interval === "number" && interval > 0);
  });
}

/**
 * Counts the page's data loading from the query cache: each burst of fetches
 * is one load, measured as answered / started. A burst ends when everything
 * in it has settled; the next fetch starts a new one. Mount once.
 */
export function usePageLoadTracking() {
  const qc = useQueryClient();
  const navigating = useRouterState({ select: (s) => s.status === "pending" });

  useEffect(() => {
    usePageLoadStore.setState({ navigating });
  }, [navigating]);

  useEffect(() => {
    const started = new Set<string>();
    const settled = new Set<string>();
    let since: number | null = null;
    // Cache events can fire while another component renders; publish after.
    let queued = false;
    const publish = () => {
      if (queued) return;
      queued = true;
      queueMicrotask(() => {
        queued = false;
        const busy = started.size > settled.size;
        usePageLoadStore.setState({
          started: started.size,
          settled: settled.size,
          since: busy ? since : null,
        });
      });
    };

    return qc.getQueryCache().subscribe((event) => {
      const query = event.query;
      const hash = query.queryHash;
      if (event.type === "removed") {
        if (started.has(hash) && !settled.has(hash)) {
          settled.add(hash);
          publish();
        }
        return;
      }
      if (event.type !== "updated") return;
      if (event.action.type === "fetch") {
        if (polls(query) && query.state.data !== undefined) return;
        if (started.size === 0 || settled.size === started.size) {
          started.clear();
          settled.clear();
          since = Date.now();
        }
        started.add(hash);
        settled.delete(hash);
        publish();
      } else if (started.has(hash) && !settled.has(hash) && query.state.fetchStatus === "idle") {
        settled.add(hash);
        publish();
      }
    });
  }, [qc]);
}
