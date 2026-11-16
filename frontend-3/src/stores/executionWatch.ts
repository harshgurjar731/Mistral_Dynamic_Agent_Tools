import { create } from "zustand";
import { persist } from "zustand/middleware";

/**
 * Workflow runs this browser started or opened, and what the user should hear
 * about them: a run that finished or failed, a run waiting for a review.
 *
 * Persisted, so a reload still watches the runs that were going and does not
 * announce the same review twice. The watcher (components/runs/ExecutionWatcher)
 * does the polling; this store only holds the state.
 */

export interface WatchedExecution {
  execution_id: string;
  workflow_name: string;
  status: string;
  started_at: number;
  finished_at?: number;
}

export type NotificationKind = "review" | "completed" | "failed";

export interface AppNotification {
  id: string;
  kind: NotificationKind;
  title: string;
  body: string;
  workflow_name: string | null;
  execution_id: string;
  review_id?: number;
  /** The step a failure happened at, or the step waiting for review. */
  step_id?: string | null;
  created_at: number;
  read: boolean;
}

const MAX_WATCHED = 40;
const MAX_NOTIFICATIONS = 50;

interface WatchState {
  watched: Record<string, WatchedExecution>;
  notifications: AppNotification[];
  /** Review ids already announced. */
  announcedReviews: number[];
  watch: (e: { execution_id: string; workflow_name: string; status?: string }) => void;
  settle: (id: string, status: string) => void;
  unwatch: (id: string) => void;
  notify: (n: Omit<AppNotification, "created_at" | "read">) => boolean;
  markRead: (id: string) => void;
  markAllRead: () => void;
  /** Mark everything about one run read, e.g. when its page is open. */
  markExecutionRead: (executionId: string, kind?: NotificationKind) => void;
  clear: () => void;
  announceReview: (id: number) => void;
}

export const useExecutionWatch = create<WatchState>()(
  persist(
    (set, get) => ({
      watched: {},
      notifications: [],
      announcedReviews: [],
      watch: ({ execution_id, workflow_name, status }) =>
        set((s) => {
          const prev = s.watched[execution_id];
          if (prev && (!status || prev.status === status)) return s;
          const next = {
            ...s.watched,
            [execution_id]: {
              execution_id,
              workflow_name,
              status: status ?? prev?.status ?? "RUNNING",
              started_at: prev?.started_at ?? Date.now(),
            },
          };
          const list = Object.values(next).sort((a, b) => b.started_at - a.started_at);
          return {
            watched: Object.fromEntries(list.slice(0, MAX_WATCHED).map((w) => [w.execution_id, w])),
          };
        }),
      settle: (id, status) =>
        set((s) =>
          s.watched[id]
            ? {
                watched: {
                  ...s.watched,
                  [id]: { ...s.watched[id]!, status, finished_at: Date.now() },
                },
              }
            : s,
        ),
      unwatch: (id) =>
        set((s) => {
          const { [id]: _drop, ...rest } = s.watched;
          return { watched: rest };
        }),
      notify: (n) => {
        if (get().notifications.some((x) => x.id === n.id)) return false;
        set((s) => ({
          notifications: [{ ...n, created_at: Date.now(), read: false }, ...s.notifications].slice(
            0,
            MAX_NOTIFICATIONS,
          ),
        }));
        return true;
      },
      markRead: (id) =>
        set((s) => ({
          notifications: s.notifications.map((n) => (n.id === id ? { ...n, read: true } : n)),
        })),
      markAllRead: () =>
        set((s) => ({ notifications: s.notifications.map((n) => ({ ...n, read: true })) })),
      markExecutionRead: (executionId, kind) =>
        set((s) =>
          s.notifications.some(
            (n) => !n.read && n.execution_id === executionId && (!kind || n.kind === kind),
          )
            ? {
                notifications: s.notifications.map((n) =>
                  n.execution_id === executionId && (!kind || n.kind === kind)
                    ? { ...n, read: true }
                    : n,
                ),
              }
            : s,
        ),
      clear: () => set({ notifications: [] }),
      announceReview: (id) =>
        set((s) =>
          s.announcedReviews.includes(id)
            ? s
            : { announcedReviews: [...s.announcedReviews, id].slice(-200) },
        ),
    }),
    { name: "workflow-execution-watch", version: 1 },
  ),
);
