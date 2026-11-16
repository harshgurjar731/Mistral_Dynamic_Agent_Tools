/**
 * App-level watcher for workflow runs. Mounted once in the shell, so it keeps
 * going whichever page is open:
 *
 * - polls every watched run until it ends, then says it completed or failed
 *   (with the step it failed at), with a button back to the run;
 * - polls the review inbox and announces each new review a run is waiting on,
 *   with a button that opens the review window on the run's page;
 * - raises a desktop notification too when the tab is in the background and
 *   the user allowed them.
 */
import { useEffect, useRef } from "react";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import { useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { executionsApi, QK, reviewsApi } from "@/api";
import type { HumanReview } from "@/api/knowledge";
import { summariseError } from "@/components/workflows/live/runModel";
import { useCanCall } from "@/lib/policy";
import { useExecutionWatch, type AppNotification } from "@/stores/executionWatch";
import type { ExecutionDetail } from "@/types";

const FAILED = new Set(["FAILED", "TIMED_OUT", "TERMINATED", "CANCELED", "CANCELLED"]);
const TERMINAL = new Set([...FAILED, "COMPLETED", "CONTINUED_AS_NEW"]);

/** A desktop notification, only when the page is not in front. */
export function desktopNotify(title: string, body: string, onClick?: () => void) {
  try {
    if (typeof window === "undefined" || !("Notification" in window)) return;
    if (Notification.permission !== "granted" || document.visibilityState === "visible") return;
    const n = new Notification(title, { body, tag: title });
    n.onclick = () => {
      window.focus();
      onClick?.();
      n.close();
    };
  } catch {
    /* notifications are a convenience */
  }
}

export function useOpenNotification() {
  const navigate = useNavigate();
  return (n: Pick<AppNotification, "workflow_name" | "execution_id" | "review_id">) => {
    if (!n.workflow_name) {
      void navigate({ to: "/reviews" });
      return;
    }
    void navigate({
      to: "/workflows/$workflowName/execute",
      params: { workflowName: n.workflow_name },
      search: {
        execId: n.execution_id,
        ...(n.review_id != null ? { review: n.review_id } : {}),
      },
    });
  };
}

function failedStepOf(detail: ExecutionDetail): { step: string | null; error: string | null } {
  const steps = (detail.steps ?? []).filter((s) => !s.internal);
  const failed = [...steps].reverse().find((s) => String(s.status).toUpperCase() === "FAILED");
  const last = failed ?? [...steps].reverse().find((s) => s.start_time_ms);
  return {
    step: last ? String(last.attributes?.["app.step.id"] ?? last.name ?? last.id) : null,
    error: failed?.error ?? detail.error ?? null,
  };
}

export function ExecutionWatcher() {
  const qc = useQueryClient();
  const open = useOpenNotification();
  const canSeeReviews = useCanCall("GET", "/api/reviews");
  const location = useRouterState({ select: (s) => s.location });
  const watched = useExecutionWatch((s) => s.watched);
  const running = Object.values(watched).filter((w) => !TERMINAL.has(w.status.toUpperCase()));

  // The run whose page is open — its own page shows its state.
  const viewing =
    location.pathname.endsWith("/execute") &&
    typeof (location.search as Record<string, unknown>)["execId"] === "string"
      ? String((location.search as Record<string, unknown>)["execId"])
      : null;
  const viewingRef = useRef(viewing);
  viewingRef.current = viewing;

  /* ── Runs ending ──────────────────────────────────────────────────── */

  const results = useQueries({
    queries: running.map((w) => ({
      queryKey: ["execution-watch", w.execution_id],
      queryFn: () => executionsApi.get(w.execution_id),
      refetchInterval: 4000,
      refetchIntervalInBackground: true,
      retry: 1,
    })),
  });

  const signature = results.map((r) => `${r.data?.execution_id}:${r.data?.status}`).join("|");
  useEffect(() => {
    const store = useExecutionWatch.getState();
    for (const r of results) {
      const detail = r.data;
      if (!detail) continue;
      const status = String(detail.status).toUpperCase();
      const w = store.watched[detail.execution_id];
      if (!w || !TERMINAL.has(status) || TERMINAL.has(w.status.toUpperCase())) continue;
      store.settle(detail.execution_id, status);
      void qc.invalidateQueries({ queryKey: QK.executions() });

      const name = w.workflow_name || detail.workflow_name;
      const short = detail.execution_id.slice(0, 8);
      const target = { workflow_name: name, execution_id: detail.execution_id };
      if (FAILED.has(status)) {
        const { step, error } = failedStepOf(detail);
        const headline = summariseError(error).headline;
        const ended: Record<string, string> = {
          FAILED: "failed",
          TIMED_OUT: "timed out",
          TERMINATED: "was terminated",
          CANCELED: "was cancelled",
          CANCELLED: "was cancelled",
        };
        const title = `${name} ${ended[status] ?? "failed"}`;
        const body = step ? `At step ${step}: ${headline}` : headline;
        store.notify({
          id: `failed:${detail.execution_id}`,
          kind: "failed",
          title,
          body,
          step_id: step,
          ...target,
        });
        toast.error(title, {
          id: `exec-${detail.execution_id}`,
          description: body.length > 220 ? `${body.slice(0, 217)}…` : body,
          duration: 20_000,
          action: { label: "Open run", onClick: () => open(target) },
        });
        desktopNotify(title, body, () => open(target));
      } else {
        const title = `${name} completed`;
        const body = `Run ${short} finished successfully — the result is ready.`;
        store.notify({
          id: `done:${detail.execution_id}`,
          kind: "completed",
          title,
          body,
          ...target,
        });
        toast.success(title, {
          id: `exec-${detail.execution_id}`,
          description: body,
          duration: 10_000,
          action: { label: "View result", onClick: () => open(target) },
        });
        desktopNotify(title, body, () => open(target));
      }
      // Its page is open: the user sees it there, so it is not "unread".
      if (viewingRef.current === detail.execution_id) store.markExecutionRead(detail.execution_id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature]);

  /* ── Reviews waiting ──────────────────────────────────────────────── */

  const reviews = useQuery({
    queryKey: QK.reviews("pending"),
    queryFn: () => reviewsApi.list("pending"),
    enabled: canSeeReviews,
    refetchInterval: 10_000,
    refetchIntervalInBackground: true,
    retry: false,
  });

  useEffect(() => {
    const list = reviews.data?.reviews;
    if (!list) return;
    const store = useExecutionWatch.getState();
    const pendingIds = new Set(list.map((r) => r.id));

    // Decided elsewhere: the announcement is stale.
    for (const n of store.notifications) {
      if (n.kind === "review" && n.review_id != null && !pendingIds.has(n.review_id)) {
        toast.dismiss(`review-${n.review_id}`);
        if (!n.read) store.markRead(n.id);
      }
    }

    const fresh = list.filter(
      (r) => r.engine !== "monitor" && !store.announcedReviews.includes(r.id),
    );
    if (!fresh.length) return;
    for (const r of fresh) {
      store.announceReview(r.id);
      store.notify(reviewNotification(r));
    }
    const toToast = fresh.filter((r) => r.execution_id !== viewingRef.current);
    if (toToast.length > 3) {
      toast.warning(`${toToast.length} workflow steps are waiting for a review`, {
        duration: Infinity,
        action: {
          label: "Open inbox",
          onClick: () => open({ workflow_name: null, execution_id: "" }),
        },
      });
    } else {
      for (const r of toToast) {
        const n = reviewNotification(r);
        toast.warning(n.title, {
          id: `review-${r.id}`,
          description: n.body,
          duration: Infinity,
          action: { label: "Review now", onClick: () => open(n) },
        });
      }
    }
    for (const r of fresh) {
      const n = reviewNotification(r);
      desktopNotify(n.title, n.body, () => open(n));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reviews.data]);

  // Opening a run's page reads its notifications.
  useEffect(() => {
    if (viewing) useExecutionWatch.getState().markExecutionRead(viewing);
  }, [viewing]);

  return null;
}

function reviewNotification(r: HumanReview): Omit<AppNotification, "created_at" | "read"> {
  return {
    id: `review:${r.id}`,
    kind: "review",
    title: `Review needed: ${r.title || r.step_id}`,
    body: `${r.workflow_name ?? "A workflow"} is paused at step ${r.step_id} until someone approves, corrects or rejects it.`,
    workflow_name: r.workflow_name,
    execution_id: r.execution_id,
    review_id: r.id,
    step_id: r.step_id,
  };
}
