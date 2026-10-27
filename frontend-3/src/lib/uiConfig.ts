import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { QK } from "@/api/queryKeys";
import { settingsApi } from "@/api/settings";
import { tabRenames } from "@/components/layout/nav-items";

/**
 * The frontend's own settings (Settings page → Frontend & Design). Defaults
 * match the backend registry; the last values seen are cached in localStorage
 * so a reload paints with them before the API answers.
 */
export const UI_DEFAULTS = {
  UI_ACCENT: "ember",
  /** Day / night default until a viewer picks one (lib/theme.ts). */
  UI_COLOR_MODE: "dark",
  UI_SURFACE_TONE: "neutral",
  UI_RADIUS: "default",
  UI_FONT_BODY: "rubik",
  UI_FONT_DISPLAY: "space-mono",
  UI_TEXT_SCALE: "default",
  UI_BACKGROUND_EFFECTS: true,
  UI_BRAND_TITLE: "Agentic AI",
  UI_BRAND_SUBTITLE: "Design Patterns",
  UI_DOCUMENT_TITLE: "Agentic AI Design Patterns",
  UI_SIDEBAR_COLLAPSED: true,
  /** JSON {order, hidden} of nav routes; "" is the built-in menu. */
  UI_NAV_LAYOUT: "",
  UI_TOAST_POSITION: "top-right",
  UI_API_TIMEOUT_SECONDS: 420,
  UI_HEALTH_POLL_SECONDS: 30,
  UI_HEALTH_PAGE_POLL_SECONDS: 15,
};

export type UiConfig = typeof UI_DEFAULTS;

const CACHE_KEY = "ui-config-v1";

function readCache(): Partial<UiConfig> {
  if (typeof window === "undefined") return {};
  try {
    return JSON.parse(window.localStorage.getItem(CACHE_KEY) ?? "{}") as Partial<UiConfig>;
  } catch {
    return {};
  }
}

export function writeUiCache(cfg: UiConfig) {
  try {
    window.localStorage.setItem(CACHE_KEY, JSON.stringify(cfg));
  } catch {
    /* storage unavailable — the API value still applies */
  }
}

/** Defaults ← cached values ← what the server sent. */
export function effectiveUiConfig(serverUi?: Record<string, unknown>): UiConfig {
  return { ...UI_DEFAULTS, ...readCache(), ...((serverUi ?? {}) as Partial<UiConfig>) };
}

/**
 * The effective frontend settings. The cache is merged only after mount, so
 * the server render and the first client render agree (no hydration mismatch).
 */
export function useUiConfig(): UiConfig {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const { data } = useQuery({
    queryKey: QK.publicConfig(),
    queryFn: settingsApi.public,
    staleTime: 60_000,
  });
  const serverUi = (data?.ui ?? {}) as Partial<UiConfig>;
  return mounted ? effectiveUiConfig(serverUi) : { ...UI_DEFAULTS, ...serverUi };
}

/** The raw server UI settings, for code that applies them outside render. */
export function useServerUi(): Record<string, unknown> | undefined {
  const { data } = useQuery({
    queryKey: QK.publicConfig(),
    queryFn: settingsApi.public,
    staleTime: 60_000,
  });
  return data?.ui as Record<string, unknown> | undefined;
}

/* ── Design tokens per option ──────────────────────────────────────── */

/** Accent: [L C H] of the primary colour, gradient end, and dark text on it. */
const ACCENTS: Record<string, { base: string; end: string; hue: number; darkText?: boolean }> = {
  ember: { base: "0.65 0.18 36", end: "0.71 0.14 55", hue: 45 },
  indigo: { base: "0.585 0.216 277", end: "0.65 0.18 300", hue: 277 },
  violet: { base: "0.628 0.226 302", end: "0.68 0.2 330", hue: 302 },
  blue: { base: "0.623 0.19 259", end: "0.7 0.14 230", hue: 259 },
  cyan: { base: "0.72 0.13 214", end: "0.77 0.12 190", hue: 214, darkText: true },
  emerald: { base: "0.7 0.147 162", end: "0.75 0.14 140", hue: 162, darkText: true },
  amber: { base: "0.77 0.166 70", end: "0.81 0.15 85", hue: 70, darkText: true },
  rose: { base: "0.646 0.222 4", end: "0.7 0.19 20", hue: 4 },
};

/** Surface tones: chroma and hue of the dark backgrounds. "neutral" keeps the stylesheet. */
const TONES: Record<string, { c: number; h: number } | null> = {
  neutral: null,
  warm: { c: 0.012, h: 60 },
  cool: { c: 0.014, h: 250 },
  midnight: { c: 0.035, h: 265 },
};

const RADII: Record<string, string> = {
  sharp: "0.25rem",
  default: "0.5rem",
  rounded: "0.75rem",
  extra: "1rem",
};

const SCALES: Record<string, string> = {
  compact: "94%",
  default: "100%",
  comfortable: "106%",
  large: "112%",
};

const BODY_FONTS: Record<string, { stack: string; google?: string }> = {
  rubik: { stack: '"Rubik", ui-sans-serif, system-ui, sans-serif' },
  inter: {
    stack: '"Inter", ui-sans-serif, system-ui, sans-serif',
    google: "Inter:wght@400;500;600",
  },
  "ibm-plex-sans": {
    stack: '"IBM Plex Sans", ui-sans-serif, system-ui, sans-serif',
    google: "IBM+Plex+Sans:wght@400;500;600",
  },
  "dm-sans": {
    stack: '"DM Sans", ui-sans-serif, system-ui, sans-serif',
    google: "DM+Sans:wght@400;500;600",
  },
  system: { stack: 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif' },
};

const MONO_FONTS: Record<string, { stack: string; google?: string }> = {
  "space-mono": { stack: '"Space Mono", ui-monospace, monospace' },
  "jetbrains-mono": {
    stack: '"JetBrains Mono", ui-monospace, monospace',
    google: "JetBrains+Mono:wght@400;600;700",
  },
  "ibm-plex-mono": {
    stack: '"IBM Plex Mono", ui-monospace, monospace',
    google: "IBM+Plex+Mono:wght@400;600;700",
  },
};

const DEFAULT_TITLE = UI_DEFAULTS.UI_DOCUMENT_TITLE;

/**
 * Write the design settings onto the document. Idempotent. ``theme`` is the
 * resolved day / night mode: surface tones and the accent tint have a light and
 * a dark value, and these inline values would otherwise override the
 * stylesheet's day palette.
 */
export function applyUiConfig(cfg: UiConfig, theme: "light" | "dark" = "dark") {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  const light = theme === "light";
  const set = (name: string, value: string | null) =>
    value === null ? root.style.removeProperty(name) : root.style.setProperty(name, value);

  // Accent
  const accent = ACCENTS[cfg.UI_ACCENT] ?? ACCENTS["ember"]!;
  const isDefaultAccent = cfg.UI_ACCENT === "ember";
  const primary = `oklch(${accent.base})`;
  const fg = accent.darkText ? "oklch(0.18 0.01 70)" : "oklch(0.985 0.006 70)";
  for (const name of ["--primary", "--ring", "--indigo", "--sidebar-primary", "--sidebar-ring"]) {
    set(name, isDefaultAccent ? null : primary);
  }
  set("--primary-foreground", isDefaultAccent ? null : fg);
  set("--sidebar-primary-foreground", isDefaultAccent ? null : fg);
  set(
    "--accent",
    isDefaultAccent
      ? null
      : light
        ? `oklch(0.93 0.04 ${accent.hue})`
        : `oklch(0.32 0.03 ${accent.hue})`,
  );
  set("--accent-foreground", isDefaultAccent || !light ? null : `oklch(0.25 0.04 ${accent.hue})`);
  set(
    "--gradient-brand",
    isDefaultAccent ? null : `linear-gradient(135deg, var(--primary), oklch(${accent.end}))`,
  );
  set(
    "--shadow-glow",
    isDefaultAccent
      ? null
      : `0 0 0 1px oklch(${accent.base} / 0.28), 0 10px 30px -14px oklch(${accent.base} / 0.32)`,
  );

  // Surface tone
  const tone = TONES[cfg.UI_SURFACE_TONE] ?? null;
  const tinted: [string, string][] = !tone
    ? []
    : light
      ? [
          // Day: the same hue, a whisper of it, on near-white.
          ["--background", `oklch(0.975 ${tone.c * 0.5} ${tone.h})`],
          ["--background-elevated", `oklch(0.995 ${tone.c * 0.3} ${tone.h})`],
          ["--popover", `oklch(1 ${tone.c * 0.2} ${tone.h})`],
          ["--surface", `oklch(1 ${tone.c * 0.3} ${tone.h} / 0.78)`],
          ["--card", `oklch(1 ${tone.c * 0.3} ${tone.h} / 0.86)`],
          ["--secondary", `oklch(0.95 ${tone.c * 0.6} ${tone.h})`],
          ["--muted", `oklch(0.95 ${tone.c * 0.6} ${tone.h})`],
          ["--sidebar", `oklch(0.985 ${tone.c * 0.4} ${tone.h} / 0.96)`],
        ]
      : [
          ["--background", `oklch(0.125 ${tone.c} ${tone.h})`],
          ["--background-elevated", `oklch(0.16 ${tone.c} ${tone.h})`],
          ["--popover", `oklch(0.19 ${tone.c} ${tone.h})`],
          ["--surface", `oklch(0.225 ${tone.c} ${tone.h} / 0.72)`],
          ["--card", `oklch(0.225 ${tone.c} ${tone.h} / 0.76)`],
          ["--secondary", `oklch(0.26 ${tone.c} ${tone.h})`],
          ["--muted", `oklch(0.26 ${tone.c} ${tone.h})`],
          ["--sidebar", `oklch(0.135 ${tone.c} ${tone.h} / 0.96)`],
        ];
  for (const name of [
    "--background",
    "--background-elevated",
    "--popover",
    "--surface",
    "--card",
    "--secondary",
    "--muted",
    "--sidebar",
  ]) {
    set(name, tinted.find(([n]) => n === name)?.[1] ?? null);
  }

  // Shape and scale
  set("--radius", cfg.UI_RADIUS === "default" ? null : (RADII[cfg.UI_RADIUS] ?? null));
  root.style.fontSize = cfg.UI_TEXT_SCALE === "default" ? "" : (SCALES[cfg.UI_TEXT_SCALE] ?? "");

  // Fonts — Tailwind inlines the theme fonts into utilities, so override with a stylesheet.
  const body = BODY_FONTS[cfg.UI_FONT_BODY] ?? BODY_FONTS["rubik"]!;
  const mono =
    cfg.UI_FONT_DISPLAY === "body"
      ? MONO_FONTS["space-mono"]!
      : (MONO_FONTS[cfg.UI_FONT_DISPLAY] ?? MONO_FONTS["space-mono"]!);
  const display = cfg.UI_FONT_DISPLAY === "body" ? body : mono;
  const families = [body.google, mono.google].filter(Boolean);
  let link = document.getElementById("ui-font-link") as HTMLLinkElement | null;
  if (families.length) {
    const href = `https://fonts.googleapis.com/css2?${families.map((f) => `family=${f}`).join("&")}&display=swap`;
    if (!link) {
      link = document.createElement("link");
      link.id = "ui-font-link";
      link.rel = "stylesheet";
      document.head.appendChild(link);
    }
    if (link.href !== href) link.href = href;
  } else {
    link?.remove();
  }
  const isDefaultFonts = cfg.UI_FONT_BODY === "rubik" && cfg.UI_FONT_DISPLAY === "space-mono";
  let style = document.getElementById("ui-font-style");
  if (isDefaultFonts) {
    style?.remove();
  } else {
    if (!style) {
      style = document.createElement("style");
      style.id = "ui-font-style";
      document.head.appendChild(style);
    }
    style.textContent = `
      body, .font-sans { font-family: ${body.stack} !important; }
      h1, h2, h3, h4, h5, h6, .font-display { font-family: ${display.stack} !important; }
      .font-mono, code, pre, kbd { font-family: ${mono.stack} !important; }
    `;
  }

  applyTitle(cfg.UI_DOCUMENT_TITLE, tabRenames(cfg.UI_NAV_LAYOUT));
}

/**
 * Route heads hard-code "<page> — <default product name>"; swap in the
 * configured product name and any renamed page name (built-in → renamed).
 * Idempotent, so the title observer settles after one rewrite.
 */
export function applyTitle(name: string, pageRenames: Record<string, string> = {}) {
  if (typeof document === "undefined") return;
  const current = document.title;
  const wanted = name.trim() || DEFAULT_TITLE;
  let next = current;
  if (wanted !== DEFAULT_TITLE && next.includes(DEFAULT_TITLE)) {
    next = next.replace(DEFAULT_TITLE, wanted);
  }
  const sep = next.indexOf(" — ");
  const page = sep >= 0 ? next.slice(0, sep) : next;
  const renamed = pageRenames[page];
  // A name that is already a rename's result is left alone — two features
  // swapping names would otherwise flip the title back and forth forever.
  const alreadyRenamed = Object.values(pageRenames).includes(page);
  if (renamed && !alreadyRenamed) next = renamed + next.slice(page.length);
  if (next !== current) document.title = next;
}
