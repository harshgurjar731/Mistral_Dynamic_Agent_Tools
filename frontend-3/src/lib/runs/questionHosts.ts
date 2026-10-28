/**
 * Which runs a page is showing the questions of itself, and the question a run
 * is waiting on. Read by the global host (components/runs/RunQuestions.tsx).
 */
import { useEffect, useSyncExternalStore } from "react";
import { parseEventData } from "@/api/sse";
import type { RunDecision } from "@/api";
import { getRunLog } from "./connections";

/* ── Which runs a page is already asking about ──────────────────────── */

const hosted = new Map<string, number>();
const listeners = new Set<() => void>();
let version = 0;

function bump() {
  version += 1;
  listeners.forEach((l) => l());
}

/** A page that shows run ``id``'s questions itself; the global host skips it. */
export function useHostRunQuestions(id: string | null | undefined) {
  useEffect(() => {
    if (!id) return;
    hosted.set(id, (hosted.get(id) ?? 0) + 1);
    bump();
    return () => {
      const n = (hosted.get(id) ?? 1) - 1;
      if (n <= 0) hosted.delete(id);
      else hosted.set(id, n);
      bump();
    };
  }, [id]);
}

export function useHostedVersion() {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => version,
    () => 0,
  );
}

/* ── Finding the waiting question ───────────────────────────────────── */

/** The question run ``id`` is waiting on, if any, from its event log. */
export function pendingQuestion(id: string): RunDecision | null {
  const open = new Map<string, RunDecision>();
  for (const event of getRunLog(id).events) {
    if (event.type === "decision_required") {
      const q = parseEventData<RunDecision>(event);
      if (typeof q !== "string" && q.id) open.set(q.id, q);
    } else if (event.type === "decision_made") {
      const a = parseEventData<{ id?: string }>(event);
      if (typeof a !== "string" && a.id) open.delete(a.id);
    } else if (event.type === "run_end") {
      return null;
    }
  }
  return open.size ? [...open.values()][0]! : null;
}

export const isHosted = (id: string) => hosted.has(id);
