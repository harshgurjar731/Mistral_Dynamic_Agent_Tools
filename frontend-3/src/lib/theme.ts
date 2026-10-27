/**
 * Day / night mode.
 *
 * Each viewer chooses light, dark or "system" (follow the OS) with the toggle
 * in the sidebar; the choice is kept in this browser. Until they choose, the
 * default set on Settings → Frontend & design (`UI_COLOR_MODE`) applies.
 *
 * The resolved mode is written to <html> as `data-theme="light|dark"`, the
 * `.dark` class (Tailwind's `dark:` variant) and `color-scheme`, which is all
 * the stylesheet reads. `THEME_BOOT_SCRIPT` does the same before first paint,
 * so a reload never flashes the other theme.
 */
import { useSyncExternalStore } from "react";

export type ThemeMode = "light" | "dark" | "system";
export type ResolvedTheme = "light" | "dark";

export const THEME_STORAGE_KEY = "ui-color-mode";
/** Where AppConfigApplier caches the Settings page values (lib/uiConfig.ts). */
const UI_CACHE_KEY = "ui-config-v1";
const MODES: ThemeMode[] = ["light", "dark", "system"];

const isMode = (v: unknown): v is ThemeMode => MODES.includes(v as ThemeMode);

function readStored(): ThemeMode | null {
  try {
    const v = window.localStorage.getItem(THEME_STORAGE_KEY);
    return isMode(v) ? v : null;
  } catch {
    return null;
  }
}

function systemPrefersDark(): boolean {
  try {
    return window.matchMedia("(prefers-color-scheme: dark)").matches;
  } catch {
    return true;
  }
}

/* ── Store ─────────────────────────────────────────────────────────── */

let defaultMode: ThemeMode = "dark";
let chosen: ThemeMode | null = null;
let loaded = false;
const listeners = new Set<() => void>();

function ensureLoaded() {
  if (loaded || typeof window === "undefined") return;
  loaded = true;
  chosen = readStored();
  try {
    window
      .matchMedia("(prefers-color-scheme: dark)")
      .addEventListener("change", () => currentMode() === "system" && commit());
  } catch {
    /* old browsers: "system" resolves once */
  }
  // Another tab changed it.
  window.addEventListener("storage", (e) => {
    if (e.key !== THEME_STORAGE_KEY) return;
    chosen = isMode(e.newValue) ? e.newValue : null;
    commit();
  });
}

function currentMode(): ThemeMode {
  return chosen ?? defaultMode;
}

export function resolveTheme(mode: ThemeMode): ResolvedTheme {
  if (mode === "system") return systemPrefersDark() ? "dark" : "light";
  return mode;
}

/** Write the resolved theme onto <html>. */
export function applyThemeToDocument(theme: ResolvedTheme) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  if (root.dataset["theme"] !== theme) root.dataset["theme"] = theme;
  root.classList.toggle("dark", theme === "dark");
  root.style.colorScheme = theme;
}

let snapshot: { mode: ThemeMode; resolved: ResolvedTheme; chosen: boolean } = {
  mode: "dark",
  resolved: "dark",
  chosen: false,
};

function commit() {
  const mode = currentMode();
  const next = { mode, resolved: resolveTheme(mode), chosen: chosen !== null };
  applyThemeToDocument(next.resolved);
  if (
    next.mode !== snapshot.mode ||
    next.resolved !== snapshot.resolved ||
    next.chosen !== snapshot.chosen
  ) {
    snapshot = next;
    listeners.forEach((l) => l());
  }
}

export const themeStore = {
  subscribe(listener: () => void) {
    ensureLoaded();
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  get() {
    ensureLoaded();
    const mode = currentMode();
    const resolved = resolveTheme(mode);
    if (
      mode !== snapshot.mode ||
      resolved !== snapshot.resolved ||
      (chosen !== null) !== snapshot.chosen
    ) {
      snapshot = { mode, resolved, chosen: chosen !== null };
    }
    return snapshot;
  },
  /** The viewer's choice; null goes back to the Settings page default. */
  set(mode: ThemeMode | null) {
    ensureLoaded();
    chosen = mode;
    try {
      if (mode) window.localStorage.setItem(THEME_STORAGE_KEY, mode);
      else window.localStorage.removeItem(THEME_STORAGE_KEY);
    } catch {
      /* private mode: the choice lasts until reload */
    }
    // Ease colours across the switch, then get out of the way of other transitions.
    const root = document.documentElement;
    root.classList.add("theme-switching");
    window.setTimeout(() => root.classList.remove("theme-switching"), 260);
    commit();
  },
  /** The Settings page default, used while the viewer has not chosen. */
  setDefault(mode: unknown) {
    ensureLoaded();
    const next = isMode(mode) ? mode : "dark";
    if (next === defaultMode) return;
    defaultMode = next;
    commit();
  },
};

const SERVER_SNAPSHOT = {
  mode: "dark" as ThemeMode,
  resolved: "dark" as ResolvedTheme,
  chosen: false,
};

/** The current mode and the theme it resolves to; re-renders on change. */
export function useTheme() {
  const state = useSyncExternalStore(themeStore.subscribe, themeStore.get, () => SERVER_SNAPSHOT);
  return { ...state, setMode: themeStore.set };
}

/** light → dark → system → light. */
export function nextMode(mode: ThemeMode): ThemeMode {
  return MODES[(MODES.indexOf(mode) + 1) % MODES.length]!;
}

/**
 * Runs in <head> before the page paints: the stored choice, else the cached
 * Settings default, else dark. Kept dependency-free and tiny on purpose.
 */
export const THEME_BOOT_SCRIPT = `(function(){try{var m=localStorage.getItem(${JSON.stringify(
  THEME_STORAGE_KEY,
)});if(m!=="light"&&m!=="dark"&&m!=="system"){var c=JSON.parse(localStorage.getItem(${JSON.stringify(
  UI_CACHE_KEY,
)})||"{}").UI_COLOR_MODE;m=(c==="light"||c==="dark"||c==="system")?c:"dark";}var t=m==="system"?(matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light"):m;var r=document.documentElement;r.dataset.theme=t;r.classList.toggle("dark",t==="dark");r.style.colorScheme=t;}catch(e){}})();`;
