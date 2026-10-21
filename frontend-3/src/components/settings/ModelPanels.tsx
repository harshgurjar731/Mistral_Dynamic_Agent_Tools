import { useMemo, useState } from "react";
import { AlertTriangle, ArrowRight, Search, Sparkles } from "lucide-react";
import type {
  CatalogIssue,
  CatalogModel,
  RefreshReport,
  SettingItem,
  SettingValue,
} from "@/api/settings";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { ModelStatusChip } from "./SettingControls";
import { draftKey, formatContext } from "./settingsModel";

const TARGET_LABEL = { backend: "Backend", tool_service: "Tool Service" } as const;

/**
 * Every model setting on both services: what it is set to and every place in
 * the code that reads it — the answer to "where does changing this matter".
 */
export function ModelUsageMap({
  items,
  valueOf,
  onJump,
}: {
  items: SettingItem[];
  valueOf: (item: SettingItem) => SettingValue;
  onJump: (item: SettingItem) => void;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] text-left text-xs">
        <thead>
          <tr className="border-b border-border/60 text-[10px] tracking-wider text-muted-foreground uppercase">
            <th className="py-2 pr-3 font-medium">Setting</th>
            <th className="py-2 pr-3 font-medium">Model</th>
            <th className="py-2 font-medium">Where it is used</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => {
            const value = valueOf(item);
            const models = (Array.isArray(value) ? value : [value]).filter(
              (v): v is string => typeof v === "string" && v !== "" && v !== "none",
            );
            return (
              <tr key={draftKey(item)} className="border-b border-border/30 align-top">
                <td className="py-2.5 pr-3">
                  <button
                    type="button"
                    onClick={() => onJump(item)}
                    className="text-left font-medium text-foreground hover:text-primary"
                  >
                    {item.group ? `${item.group} · ${item.label}` : item.label}
                  </button>
                  <p className="text-[10px] text-muted-foreground">{TARGET_LABEL[item.target]}</p>
                </td>
                <td className="py-2.5 pr-3">
                  <div className="flex flex-col gap-1">
                    {models.length === 0 ? (
                      <span className="text-muted-foreground">none</span>
                    ) : null}
                    {models.map((m) => (
                      <span key={m} className="flex flex-wrap items-center gap-1.5">
                        <span className="font-mono text-foreground">{m}</span>
                        <ModelStatusChip status={item.model_status?.[m]} />
                      </span>
                    ))}
                  </div>
                </td>
                <td className="py-2.5">
                  <ul className="space-y-0.5">
                    {item.used_in.map((u) => (
                      <li key={u} className="font-mono text-[10.5px] text-muted-foreground">
                        {u}
                      </li>
                    ))}
                  </ul>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

const CAP_FILTERS = [
  { id: "all", label: "All" },
  { id: "completion_chat", label: "Chat" },
  { id: "function_calling", label: "Tools" },
  { id: "reasoning", label: "Reasoning" },
  { id: "vision", label: "Vision" },
  { id: "ocr", label: "OCR" },
  { id: "moderation", label: "Moderation" },
  { id: "audio", label: "Audio" },
] as const;

const SHOWN_CAPS = [
  "completion_chat",
  "function_calling",
  "reasoning",
  "vision",
  "ocr",
  "moderation",
  "audio_transcription",
  "completion_fim",
];
const CAP_SHORT: Record<string, string> = {
  completion_chat: "chat",
  function_calling: "tools",
  completion_fim: "fim",
  audio_transcription: "transcribe",
};

/** The live Mistral model list, searchable and filterable by capability. */
export function ModelCatalogBrowser({ models }: { models: CatalogModel[] }) {
  const [query, setQuery] = useState("");
  const [cap, setCap] = useState<(typeof CAP_FILTERS)[number]["id"]>("all");
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return models.filter(
      (m) =>
        (cap === "all" || m.capabilities[cap]) &&
        (!q ||
          m.id.toLowerCase().includes(q) ||
          m.aliases.some((a) => a.toLowerCase().includes(q))),
    );
  }, [models, query, cap]);

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[200px] flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search models or aliases…"
            className="h-8 pl-8 text-xs"
          />
        </div>
        <div className="flex flex-wrap gap-1">
          {CAP_FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => setCap(f.id)}
              className={cn(
                "rounded-md border px-2 py-1 text-[11px]",
                cap === f.id
                  ? "border-primary/40 bg-primary/10 text-primary"
                  : "border-border text-muted-foreground hover:text-foreground",
              )}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>
      <div className="mt-3 max-h-[420px] overflow-auto rounded-lg border border-border/60">
        <table className="w-full min-w-[640px] text-left text-xs">
          <thead className="sticky top-0 bg-background-elevated">
            <tr className="text-[10px] tracking-wider text-muted-foreground uppercase">
              <th className="px-3 py-2 font-medium">Model</th>
              <th className="px-3 py-2 font-medium">Capabilities</th>
              <th className="px-3 py-2 font-medium">Context</th>
              <th className="px-3 py-2 font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((m) => (
              <tr key={m.id} className="border-t border-border/30 align-top">
                <td className="px-3 py-2">
                  <p className="font-mono text-foreground">{m.id}</p>
                  {m.aliases.length ? (
                    <p className="mt-0.5 font-mono text-[10px] text-muted-foreground">
                      = {m.aliases.join(", ")}
                    </p>
                  ) : null}
                </td>
                <td className="px-3 py-2">
                  <div className="flex flex-wrap gap-1">
                    {SHOWN_CAPS.filter((c) => m.capabilities[c]).map((c) => (
                      <span
                        key={c}
                        className="rounded border border-border bg-secondary px-1.5 py-0.5 text-[10px] text-muted-foreground"
                      >
                        {CAP_SHORT[c] ?? c}
                      </span>
                    ))}
                  </div>
                </td>
                <td className="px-3 py-2 font-mono text-muted-foreground">
                  {formatContext(m.max_context_length)}
                </td>
                <td className="px-3 py-2">
                  {m.deprecation ? (
                    <span className="text-amber">
                      Deprecated {new Date(m.deprecation).toLocaleDateString()}
                      {m.deprecation_replacement_model
                        ? ` → ${m.deprecation_replacement_model}`
                        : ""}
                    </span>
                  ) : (
                    <span className="text-emerald">Active</span>
                  )}
                </td>
              </tr>
            ))}
            {shown.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-3 py-6 text-center text-muted-foreground">
                  No models match.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** What the last refresh found, with one-click replacements. */
export function RefreshReportCard({
  report,
  onUseReplacement,
}: {
  report: RefreshReport;
  onUseReplacement: (issue: CatalogIssue) => void;
}) {
  return (
    <div className="space-y-3 rounded-lg border border-border/60 bg-background-elevated/60 p-4 text-xs">
      <p className="font-medium text-foreground">
        Read {report.model_count} models from Mistral.
        {report.added.length ? ` ${report.added.length} new.` : ""}
        {report.removed.length ? ` ${report.removed.length} removed.` : ""}
      </p>
      {report.added.length ? (
        <p className="text-muted-foreground">
          <Sparkles className="mr-1 inline size-3 text-emerald" />
          New: <span className="font-mono">{report.added.join(", ")}</span>
        </p>
      ) : null}
      {report.removed.length ? (
        <p className="text-muted-foreground">
          Removed: <span className="font-mono">{report.removed.join(", ")}</span>
        </p>
      ) : null}
      {report.upgraded.length ? (
        <div>
          <p className="font-medium text-emerald">Upgraded automatically</p>
          <ul className="mt-1 space-y-0.5">
            {report.upgraded.map((u) => (
              <li
                key={`${u.target}:${u.key}`}
                className="font-mono text-[11px] text-muted-foreground"
              >
                {TARGET_LABEL[u.target]} · {u.key} → {u.model}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {report.issues.length ? (
        <div>
          <p className="font-medium text-amber">
            {report.issues.length} configured model{report.issues.length > 1 ? "s need" : " needs"}{" "}
            attention
          </p>
          <ul className="mt-1.5 space-y-1.5">
            {report.issues.map((i) => (
              <li
                key={`${i.target}:${i.key}:${i.model}`}
                className="flex flex-wrap items-center gap-2"
              >
                <AlertTriangle className="size-3.5 shrink-0 text-amber" />
                <span className="text-foreground">
                  {TARGET_LABEL[i.target]} · {i.label}
                </span>
                <span className="text-muted-foreground">{i.message}</span>
                {i.replacement ? (
                  <button
                    type="button"
                    onClick={() => onUseReplacement(i)}
                    className="inline-flex items-center gap-1 rounded border border-primary/30 bg-primary/10 px-1.5 py-0.5 text-[11px] text-primary hover:bg-primary/15"
                  >
                    Use {i.replacement} <ArrowRight className="size-3" />
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="text-emerald">Every configured model is available and current.</p>
      )}
    </div>
  );
}
