import { useEffect, useLayoutEffect } from "react";
import { api } from "@/api/client";
import { tabRenames } from "@/components/layout/nav-items";
import {
  applyTitle,
  applyUiConfig,
  effectiveUiConfig,
  useServerUi,
  writeUiCache,
} from "@/lib/uiConfig";
import { nextMode, themeStore, useTheme } from "@/lib/theme";

const useIsoLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

/**
 * Applies the Frontend & Design settings to the running app: theme tokens,
 * fonts, text scale, tab title and the API timeout. Renders nothing. Saving on
 * the Settings page refetches the public config, so changes land at once.
 *
 * Also owns day / night mode: the Settings default goes to the theme store,
 * tokens are re-applied when the resolved theme flips, and Shift+Alt+L cycles
 * the mode on any page.
 */
export function AppConfigApplier() {
  const serverUi = useServerUi();
  const serialized = JSON.stringify(serverUi ?? null);
  // Read here, not in render: the cache must not change what the server renders.
  const cfg = typeof window === "undefined" ? effectiveUiConfig({}) : effectiveUiConfig(serverUi);
  const { resolved } = useTheme();

  useIsoLayoutEffect(() => {
    themeStore.setDefault(cfg.UI_COLOR_MODE);
    applyUiConfig(cfg, themeStore.get().resolved);
    writeUiCache(cfg);
    api.defaults.timeout = Math.max(10, Number(cfg.UI_API_TIMEOUT_SECONDS) || 420) * 1000;
  }, [serialized, resolved]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.shiftKey && e.altKey && !e.ctrlKey && !e.metaKey && e.code === "KeyL")) return;
      e.preventDefault();
      themeStore.set(nextMode(themeStore.get().mode));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Pages set their own <title> on navigation; keep the configured product
  // name and renamed page names in it.
  useEffect(() => {
    const titleEl = document.querySelector("title");
    if (!titleEl) return;
    const renames = tabRenames(cfg.UI_NAV_LAYOUT);
    applyTitle(cfg.UI_DOCUMENT_TITLE, renames);
    const observer = new MutationObserver(() => applyTitle(cfg.UI_DOCUMENT_TITLE, renames));
    observer.observe(titleEl, { childList: true, characterData: true, subtree: true });
    return () => observer.disconnect();
  }, [cfg.UI_DOCUMENT_TITLE, cfg.UI_NAV_LAYOUT]);

  return null;
}
