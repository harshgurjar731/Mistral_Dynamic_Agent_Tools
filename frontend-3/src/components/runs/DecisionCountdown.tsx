/**
 * The countdown on a question a run is waiting on.
 *
 * Every question carries a deadline (Settings → Decision countdown). When it
 * passes with no answer, the run takes the recommended choice. This shows the
 * time left and that choice, and "Keep waiting" pushes the deadline back for
 * whoever needs longer. The deadline is read from the run's own events, so an
 * extension made in another tab is seen here too.
 */
import { useEffect, useMemo, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { Hourglass } from "lucide-react";
import { errorMessage, runsApi, type RunDecision } from "@/api";
import { parseEventData } from "@/api/sse";
import { Button } from "@/components/ui/button";
import { getRunLog } from "@/lib/runs/connections";
import { cn } from "@/lib/utils";
import { useRunLogVersion } from "@/stores/runs";

/** The question's current deadline: the latest extension, else the one it was asked with. */
function useDeadline(runId: string, decision: RunDecision): number | null {
  const version = useRunLogVersion((s) => s.versions[runId] ?? 0);
  return useMemo(() => {
    void version;
    let deadline = decision.deadline ? Date.parse(decision.deadline) : NaN;
    for (const event of getRunLog(runId).events) {
      if (event.type !== "decision_extended") continue;
      const p = parseEventData<{ id?: string; deadline?: string }>(event);
      if (typeof p !== "string" && p.id === decision.id && p.deadline)
        deadline = Date.parse(p.deadline);
    }
    return Number.isNaN(deadline) ? null : deadline;
  }, [runId, decision.id, decision.deadline, version]);
}

function useNow(active: boolean) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [active]);
  return now;
}

function format(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

export function DecisionCountdown({
  runId,
  decision,
  recommendedLabel,
  compact = false,
}: {
  runId: string;
  decision: RunDecision;
  /** How the recommended choice is named in this dialog. */
  recommendedLabel?: string | undefined;
  compact?: boolean;
}) {
  const deadline = useDeadline(runId, decision);
  const now = useNow(deadline !== null);
  const extend = useMutation({
    mutationFn: () => runsApi.extendDecision(runId, decision.id),
    onError: (e) => toast.error(errorMessage(e)),
  });
  if (deadline === null) return null;

  const left = deadline - now;
  const total = (decision.timeout_s ?? 0) * 1000;
  const urgent = left < 30_000;
  const choice = recommendedLabel ?? decision.recommended ?? decision.default;
  const pct = total > 0 ? Math.max(0, Math.min(100, (left / total) * 100)) : 100;

  if (compact) {
    return (
      <span
        className={cn("font-mono text-[11px] tabular-nums", urgent ? "text-red" : "text-amber")}
      >
        {left > 0 ? `${format(left)} · then “${choice}”` : `Going with “${choice}”…`}
      </span>
    );
  }

  return (
    <div
      className={cn(
        "border-b px-6 py-2.5",
        urgent ? "border-red/30 bg-red/5" : "border-amber/30 bg-amber/5",
      )}
    >
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <Hourglass className={cn("size-3.5 shrink-0", urgent ? "text-red" : "text-amber")} />
        <span className="min-w-0 flex-1 text-foreground">
          {left > 0 ? (
            <>
              No decision in{" "}
              <span className="font-mono font-semibold tabular-nums">{format(left)}</span> and the
              recommended choice is taken: <span className="font-semibold">“{choice}”</span>.
            </>
          ) : (
            <>Going with the recommended choice: “{choice}”…</>
          )}
        </span>
        {left > 0 ? (
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-[11px]"
            disabled={extend.isPending}
            onClick={() => extend.mutate()}
          >
            Keep waiting (+5 min)
          </Button>
        ) : null}
      </div>
      {total > 0 ? (
        <div className="mt-2 h-1 overflow-hidden rounded-full bg-border/60">
          <div
            className={cn(
              "h-full rounded-full transition-[width] duration-1000",
              urgent ? "bg-red" : "bg-amber",
            )}
            style={{ width: `${pct}%` }}
          />
        </div>
      ) : null}
    </div>
  );
}
