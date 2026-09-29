import { useCallback, useEffect, useState, type RefObject } from "react";

/**
 * Full screen for one element. Uses the browser Fullscreen API, and falls back
 * to covering the window when the API is unavailable or refused (embedded
 * frames, some mobile browsers). Escape leaves either mode.
 */
export function useFullscreen(ref: RefObject<HTMLElement | null>) {
  const [native, setNative] = useState(false);
  const [fallback, setFallback] = useState(false);

  useEffect(() => {
    const sync = () => setNative(document.fullscreenElement === ref.current);
    document.addEventListener("fullscreenchange", sync);
    return () => document.removeEventListener("fullscreenchange", sync);
  }, [ref]);

  useEffect(() => {
    if (!fallback) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setFallback(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [fallback]);

  const toggle = useCallback(async () => {
    if (native) {
      await document.exitFullscreen().catch(() => undefined);
      return;
    }
    if (fallback) {
      setFallback(false);
      return;
    }
    const el = ref.current;
    if (el?.requestFullscreen && document.fullscreenEnabled) {
      try {
        await el.requestFullscreen();
        return;
      } catch {
        /* fall through to the in-page version */
      }
    }
    setFallback(true);
  }, [native, fallback, ref]);

  return { isFullscreen: native || fallback, isFallback: fallback, toggle };
}
