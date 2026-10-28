/**
 * The strip along the top of every page: page data loading and actions in
 * flight, filled only as far as they have measurably got.
 */
import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { opActivity, opFraction } from "@/lib/ops/describe";
import { useOpsStore } from "@/stores/ops";
import { cn } from "@/lib/utils";
import { LiveBar } from "./LiveBar";
import { loadPercent, usePageLoad, usePageLoadTracking } from "./usePageLoad";

/** Under this, a load is a blink — showing it would only flicker. */
const APPEAR_AFTER_MS = 200;
/** A load this slow gets a caption saying what is loading. */
const CAPTION_AFTER_MS = 800;

export function TopProgressBar() {
  // The one place page loading is counted; every loader reads the result.
  usePageLoadTracking();
  const load = usePageLoad();
  const ops = useOpsStore((s) => s.ops);
  const all = Object.values(ops);
  const actions = all.filter((o) => !o.background && o.status === "pending");
  const slowReads = all.filter((o) => o.background && o.status === "pending");

  const loading = load.navigating || load.started > load.settled;
  const busy = loading || actions.length > 0;

  const [shown, setShown] = useState(false);
  const [captioned, setCaptioned] = useState(false);
  useEffect(() => {
    if (busy) {
      const t = setTimeout(() => setShown(true), APPEAR_AFTER_MS);
      return () => clearTimeout(t);
    }
    // Let the bar reach the end before it fades.
    const t = setTimeout(() => setShown(false), 350);
    return () => clearTimeout(t);
  }, [busy]);
  useEffect(() => {
    if (!loading) {
      setCaptioned(false);
      return;
    }
    const t = setTimeout(() => setCaptioned(true), CAPTION_AFTER_MS);
    return () => clearTimeout(t);
  }, [loading]);

  const parts: Array<number | null> = [];
  if (loading) parts.push(load.started > 0 ? load.settled / load.started : null);
  for (const op of actions) parts.push(opFraction(op));
  const known = parts.filter((p): p is number => p !== null);
  const value = !busy ? 1 : known.length ? known.reduce((a, b) => a + b, 0) / known.length : null;

  // The read holding the page up longest, and what it is doing if it says.
  const slowest = slowReads.sort((a, b) => a.startedAt - b.startedAt)[0];
  const slowText = slowest
    ? slowest.stage || slowest.note || slowest.steps.length || slowest.download?.loaded
      ? opActivity(slowest)
      : slowest.label
    : null;

  return (
    <>
      <div
        aria-hidden={!shown}
        className={cn(
          "pointer-events-none fixed inset-x-0 top-0 z-[80] transition-opacity duration-300",
          shown ? "opacity-100" : "opacity-0",
        )}
      >
        <LiveBar value={value} className="h-[3px] rounded-none bg-transparent" />
      </div>
      {captioned && shown && loading && load.started > 0 ? (
        <div
          role="status"
          className="pointer-events-none fixed top-2 left-1/2 z-[80] flex max-w-[calc(100vw-2rem)] -translate-x-1/2 items-center gap-2 rounded-full border border-border glass-elevated px-3 py-1 text-[11px] text-muted-foreground md:left-[calc(50%+var(--nav-w)/2)]"
        >
          <Loader2 className="size-3 shrink-0 animate-spin text-primary" />
          <span className="shrink-0 text-foreground">Loading page data</span>
          <span className="shrink-0 font-mono tabular-nums">
            {load.settled}/{load.started} ·{" "}
            <span className="font-semibold text-foreground">{loadPercent(load) ?? 0}%</span>
          </span>
          {slowText ? (
            <span className="min-w-0 truncate" title={slowText}>
              · {slowText}
            </span>
          ) : null}
        </div>
      ) : null}
    </>
  );
}
