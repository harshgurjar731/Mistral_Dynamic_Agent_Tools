import type { CatalogModel, SettingItem, SettingsSection, SettingValue } from "@/api/settings";

/** Draft and override keys: the same key can exist on both services. */
export const draftKey = (s: Pick<SettingItem, "target" | "key">) => `${s.target}:${s.key}`;

/** Capability a setting asks for → the catalog flag that satisfies it. */
const CAPABILITY_FLAG: Record<string, string> = {
  chat: "completion_chat",
  function_calling: "function_calling",
  moderation: "moderation",
  ocr: "ocr",
  vision: "vision",
  reasoning: "reasoning",
};

export function supports(card: CatalogModel | undefined, capability: string | null): boolean {
  if (!card || !capability) return true;
  const flag = CAPABILITY_FLAG[capability];
  return !flag || Boolean(card.capabilities[flag]);
}

/** Every id and alias → its card. */
export function indexCatalog(models: CatalogModel[]): Map<string, CatalogModel> {
  const out = new Map<string, CatalogModel>();
  for (const m of models) {
    if (!out.has(m.id)) out.set(m.id, m);
    for (const a of m.aliases) if (!out.has(a)) out.set(a, m);
  }
  return out;
}

export function sameValue(a: SettingValue, b: SettingValue): boolean {
  if (Array.isArray(a) || Array.isArray(b)) return JSON.stringify(a) === JSON.stringify(b);
  return a === b;
}

export function formatContext(n: number | null | undefined): string {
  if (!n) return "";
  return n >= 1000 ? `${Math.round(n / 1024)}k ctx` : `${n} ctx`;
}

export function formatWhen(epochSeconds: number | null | undefined): string {
  if (!epochSeconds) return "never";
  const diff = Date.now() / 1000 - epochSeconds;
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)} min ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} h ago`;
  return new Date(epochSeconds * 1000).toLocaleString();
}

export function displayValue(v: SettingValue): string {
  if (v === null || v === undefined || v === "") return "—";
  if (Array.isArray(v)) return v.join(", ");
  if (typeof v === "boolean") return v ? "On" : "Off";
  return String(v);
}

/** Every word of ``query`` appears somewhere in what the setting says about itself. */
export function matchesQuery(item: SettingItem, section: SettingsSection, query: string): boolean {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const value = Array.isArray(item.value) ? item.value.join(" ") : String(item.value ?? "");
  const hay = [
    item.label,
    item.key,
    item.description,
    item.group ?? "",
    section.title,
    item.type === "secret" ? "" : value,
    ...item.impact,
    ...item.used_in,
    ...Object.values(item.option_labels ?? {}),
  ]
    .join(" ")
    .toLowerCase();
  return words.every((w) => hay.includes(w));
}
