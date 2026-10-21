/**
 * Drag-to-resize for side panels — the nav rail, settings and config drawers,
 * the refine conversation, sheets.
 *
 * `useResizablePanel` owns the width (clamped, remembered per panel in
 * localStorage); `ResizeHandle` is the grip on the panel's inner edge. Drag it,
 * use the arrow keys when focused, or double-click to go back to the default.
 * The parent must be `position: relative` and must not clip the handle.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { GripVertical } from "lucide-react";
import { cn } from "@/lib/utils";

/** Which edge of the panel the handle sits on. A right-hand drawer resizes from its left edge. */
type Edge = "left" | "right";

const KEY_STEP = 16;
/** Room always left for the rest of the page, whatever the panel's max. */
const VIEWPORT_MARGIN = 320;

export interface ResizablePanel {
  /** Null until the user resizes a panel that has no default — CSS decides until then. */
  width: number | null;
  dragging: boolean;
  edge: Edge;
  min: number;
  max: number;
  setWidth: (w: number) => void;
  reset: () => void;
  setDragging: (d: boolean) => void;
}

export function useResizablePanel({
  storageKey,
  defaultWidth,
  min,
  max,
  edge,
}: {
  /** Omit to resize without remembering the width. */
  storageKey?: string | undefined;
  defaultWidth: number | null;
  min: number;
  max: number;
  edge: Edge;
}): ResizablePanel {
  const [width, setWidthState] = useState<number | null>(defaultWidth);
  const [dragging, setDragging] = useState(false);
  const fullKey = storageKey ? `panel-width:${storageKey}` : null;

  const clamp = useCallback(
    (w: number) => {
      const room =
        typeof window === "undefined" ? max : Math.max(min, window.innerWidth - VIEWPORT_MARGIN);
      return Math.round(Math.min(Math.max(w, min), max, room));
    },
    [min, max],
  );

  // Read after mount: the server render has no localStorage.
  useEffect(() => {
    if (!fullKey) return;
    try {
      const saved = Number(window.localStorage.getItem(fullKey));
      if (saved > 0) setWidthState(clamp(saved));
    } catch {
      /* storage blocked — keep the default */
    }
  }, [fullKey, clamp]);

  const setWidth = useCallback(
    (w: number) => {
      const next = clamp(w);
      setWidthState(next);
      if (!fullKey) return;
      try {
        window.localStorage.setItem(fullKey, String(next));
      } catch {
        /* storage blocked — the width just isn't remembered */
      }
    },
    [clamp, fullKey],
  );

  const reset = useCallback(() => {
    setWidthState(defaultWidth);
    if (!fullKey) return;
    try {
      window.localStorage.removeItem(fullKey);
    } catch {
      /* ignore */
    }
  }, [defaultWidth, fullKey]);

  return { width, dragging, edge, min, max, setWidth, reset, setDragging };
}

export function ResizeHandle({
  panel,
  label = "Resize panel",
  inset = false,
  className,
}: {
  panel: ResizablePanel;
  label?: string;
  /** Keep the handle inside the panel, for panels that clip their overflow. */
  inset?: boolean;
  className?: string;
}) {
  const start = useRef<{ x: number; width: number } | null>(null);
  const { edge, width, setWidth, setDragging } = panel;
  // Dragging toward the panel's outside grows it.
  const sign = edge === "left" ? -1 : 1;

  const currentWidth = (el: HTMLElement) =>
    width ?? el.parentElement?.getBoundingClientRect().width ?? panel.min;

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    start.current = { x: e.clientX, width: currentWidth(e.currentTarget) };
    setDragging(true);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!start.current) return;
    setWidth(start.current.width + sign * (e.clientX - start.current.x));
  };

  const stop = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!start.current) return;
    start.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    setDragging(false);
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const w = currentWidth(e.currentTarget);
    if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
      e.preventDefault();
      const dir = e.key === "ArrowRight" ? 1 : -1;
      setWidth(w + sign * dir * KEY_STEP);
    } else if (e.key === "Home") {
      e.preventDefault();
      setWidth(panel.min);
    } else if (e.key === "End") {
      e.preventDefault();
      setWidth(panel.max);
    }
  };

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuemin={panel.min}
      aria-valuemax={panel.max}
      aria-valuenow={width ?? undefined}
      tabIndex={0}
      title={`${label} — drag, or double-click to reset`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={stop}
      onPointerCancel={stop}
      onDoubleClick={panel.reset}
      onKeyDown={onKeyDown}
      data-dragging={panel.dragging || undefined}
      className={cn(
        "group/resize absolute inset-y-0 z-40 flex w-3 cursor-col-resize touch-none items-center justify-center outline-none",
        edge === "left" ? "left-0" : "right-0",
        !inset && (edge === "left" ? "-translate-x-1/2" : "translate-x-1/2"),
        className,
      )}
    >
      {/* The edge line lights up on hover, focus and drag. */}
      <span
        aria-hidden
        className={cn(
          "pointer-events-none absolute inset-y-0 w-px bg-transparent transition-colors",
          inset ? (edge === "left" ? "left-0" : "right-0") : "left-1/2 -translate-x-1/2",
          "group-hover/resize:bg-primary/50 group-focus-visible/resize:bg-primary group-data-[dragging]/resize:bg-primary",
        )}
      />
      <span
        aria-hidden
        className={cn(
          "pointer-events-none relative grid h-9 w-3.5 place-items-center rounded-md border border-border bg-background-elevated text-muted-foreground shadow-sm transition-colors",
          "group-hover/resize:border-primary/50 group-hover/resize:text-primary",
          "group-focus-visible/resize:border-primary group-focus-visible/resize:text-primary",
          "group-data-[dragging]/resize:border-primary group-data-[dragging]/resize:text-primary",
        )}
      >
        <GripVertical className="size-3" />
      </span>
    </div>
  );
}
